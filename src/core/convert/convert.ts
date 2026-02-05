import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { aggregateIssues, Issue, IssueCodes, sortIssues } from '../issues';
import { getContract } from '../contracts';
import { canonicalizeProject, Format, IRProject } from '../ir';
import { diffProjects } from '../diff';
import { atomicWriteFile, ensureDirForFile } from '../io';
import { hashConfig } from '../config';
import { formatReportMarkdown } from '../report/markdown';
import { ConversionReport } from '../report/types';
import { detectFormat, getAdapter } from '../../formats/registry';
import { ConvertJob, ConvertResult } from './types';

export async function runConvert(job: ConvertJob): Promise<ConvertResult> {
  const inputBuffer = await fs.readFile(job.inputPath);
  const detected = job.inputFormat ?? (await detectFormat(inputBuffer, job.inputPath));
  if (!detected) {
    return { exitCode: 2 };
  }

  const inputAdapter = getAdapter(detected);
  const outputAdapter = getAdapter(job.targetFormat);
  const inputCaps = inputAdapter.capabilities();
  const outputCaps = outputAdapter.capabilities();

  if (!inputCaps.supportsImport || !outputCaps.supportsExport) {
    const issues: Issue[] = [
      {
        code: IssueCodes.CORE_UNSUPPORTED_CONVERSION_PAIR,
        severity: 'ERROR',
        category: 'STRUCTURE',
        message: `Unsupported conversion pair: ${detected} -> ${job.targetFormat}.`,
      },
    ];
    const report = buildReport({
      job,
      detected,
      ir0: undefined,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      warnings: [],
    });
    if (!job.flags.noReport) {
      await writeReport(job, undefined, undefined, issues, [], report);
    }
    return { exitCode: 2, report };
  }

  let ir0: IRProject;
  let importIssues: Issue[] = [];
  let importWarnings: string[] = [];

  try {
    const imported = await inputAdapter.import(job.inputPath, {
      defaultPPQ: job.config.midi.defaultPPQ,
    });
    ir0 = canonicalizeProject(imported.ir);
    importIssues = imported.issues;
    importWarnings = imported.warnings;
  } catch (error) {
    return { exitCode: 2 };
  }

  const exportResult = await outputAdapter.export(ir0, job.outPath, {
    overwrite: job.flags.overwrite,
    config: job.config,
    profile: job.profile,
  });
  if (exportResult.issues.some((issue) => issue.severity === 'ERROR')) {
    await writeReport(job, ir0, undefined, exportResult.issues, importWarnings);
    return { exitCode: 2 };
  }

  let ir1: IRProject | undefined;
  let diffIssues: Issue[] = [];
  let addedElements = 0;
  let diffSummary: ReturnType<typeof diffProjects>['summary'] | undefined;

  try {
    const reimported = await outputAdapter.import(job.outPath, {
      defaultPPQ: ir0.timing.ppq,
    });
    ir1 = canonicalizeProject(reimported.ir);
    const contractResult = getContract(detected, job.targetFormat, job.profile);
    const diff = diffProjects(ir0, ir1, contractResult.contract);
    diffIssues = diff.issues;
    addedElements = diff.addedElements;
    diffSummary = diff.summary;
    if (contractResult.usedFallback && contractResult.issueCode) {
      diffIssues.push({
        code: contractResult.issueCode,
        severity: 'WARN',
        category: 'STRUCTURE',
        message: `No specific contract for ${detected}->${job.targetFormat} (profile ${job.profile}); using generic rules.`,
      });
    }
  } catch (error) {
    diffIssues.push({
      code: IssueCodes.DIFF_ROUNDTRIP_IMPORT_FAILED,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: `Round-trip verification failed: could not re-import output (${(error as Error).message}).`,
    });
  }

  const allIssues = aggregateIssues([...importIssues, ...exportResult.issues, ...diffIssues]);
  const report = buildReport({
    job,
    detected,
    ir0,
    ir1,
    issues: allIssues,
    addedElements,
    diffSummary,
    warnings: importWarnings,
  });

  if (!job.flags.noReport) {
    await writeReport(job, ir0, ir1, allIssues, importWarnings, report);
  }

  const exitCode = determineExitCode(job.policy, allIssues);
  return { exitCode, report, ir0, ir1 };
}

function determineExitCode(policy: ConvertJob['policy'], issues: Issue[]): number {
  const hasError = issues.some((issue) => issue.severity === 'ERROR');
  const hasWarn = issues.some((issue) => issue.severity === 'WARN');
  const dropped = issues.some((issue) => issue.code === IssueCodes.DIFF_ELEMENT_DROPPED);
  if (hasError) {
    return policy === 'strict' ? 3 : 2;
  }
  if (policy === 'strict' && dropped) {
    return 3;
  }
  if (hasWarn) {
    return 1;
  }
  return 0;
}

async function writeReport(
  job: ConvertJob,
  ir0?: IRProject,
  ir1?: IRProject,
  issues: Issue[] = [],
  warnings: string[] = [],
  report?: ConversionReport,
): Promise<void> {
  if (!report) {
    report = buildReport({
      job,
      detected: job.inputFormat ?? job.targetFormat,
      ir0,
      ir1,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      warnings,
    });
  }
  if (job.flags.noReport) {
    return;
  }
  await ensureDirForFile(job.reportPath);
  if (job.flags.reportFormat === 'json' || job.flags.reportFormat === 'both') {
    await atomicWriteFile(job.reportPath, JSON.stringify(report, null, 2));
  }
  if (job.flags.reportFormat === 'md' || job.flags.reportFormat === 'both') {
    const mdPath = job.reportPath.replace(extname(job.reportPath), '.md');
    await atomicWriteFile(mdPath, formatReportMarkdown(report));
  }
}

function buildReport(params: {
  job: ConvertJob;
  detected: Format;
  ir0?: IRProject;
  ir1?: IRProject;
  issues: Issue[];
  addedElements: number;
  diffSummary?: ReturnType<typeof diffProjects>['summary'];
  warnings: string[];
}): ConversionReport {
  const contract = getContract(
    params.detected,
    params.job.targetFormat,
    params.job.profile,
  ).contract;
  const summary = params.diffSummary ?? summarizeIssues(params.issues);

  return {
    reportSchemaVersion: '1.0',
    tool: { name: 'umft', version: '0.1.0' },
    run: {
      timestampISO: new Date().toISOString(),
      policy: params.job.policy,
      profile: params.job.profile,
      configHash: hashConfig(params.job.config),
      platform: { node: process.version, os: process.platform, arch: process.arch },
    },
    input: {
      path: params.job.inputPath,
      format: params.detected,
      detectedBy: params.job.inputFormat ? 'user' : 'extension',
    },
    output: { path: params.job.outPath, format: params.job.targetFormat },
    contract: {
      name: contract.name,
      version: contract.version,
      tolerances: contract.tolerances,
    },
    summary,
    stats: {
      tracksIn: params.ir0?.tracks.length ?? 0,
      tracksOut: params.ir1?.tracks.length ?? 0,
      notesIn: countNotes(params.ir0),
      notesOut: countNotes(params.ir1),
      tempoEventsIn: params.ir0?.timing.tempoMap.length ?? 0,
      tempoEventsOut: params.ir1?.timing.tempoMap.length ?? 0,
      markersIn: params.ir0?.markers.length ?? 0,
      markersOut: params.ir1?.markers.length ?? 0,
    },
    trackMappings: [],
    issues: sortIssues(params.issues),
    diffs: { addedElements: params.addedElements },
    diagnostics: params.warnings.length ? { parseWarnings: params.warnings } : undefined,
  };
}

function summarizeIssues(issues: Issue[]) {
  return {
    elementsTotal: issues.length,
    perfect: 0,
    equivalent: 0,
    approximate: issues.filter((issue) => issue.severity === 'WARN').length,
    dropped: issues.filter((issue) => issue.code === IssueCodes.DIFF_ELEMENT_DROPPED).length,
    errors: issues.filter((issue) => issue.severity === 'ERROR').length,
  };
}

function countNotes(ir?: IRProject): number {
  if (!ir) return 0;
  return ir.tracks.reduce(
    (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
    0,
  );
}
