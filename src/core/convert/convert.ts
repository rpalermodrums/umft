import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { aggregateIssues, Issue, IssueCodes, sortIssues } from '../issues';
import { GENERIC_CONTRACT, getContract } from '../contracts';
import { canonicalizeProject, Format, IRProject } from '../ir';
import { diffProjects, TrackMappingDiff } from '../diff';
import { atomicWriteFile, ensureDirForFile } from '../io';
import { hashConfig } from '../config';
import { formatReportMarkdown } from '../report/markdown';
import { ConversionReport, TrackMappingReport } from '../report/types';
import { detectFormat, getAdapter } from '../../formats/registry';
import { ConvertJob, ConvertResult } from './types';

export async function runConvert(job: ConvertJob): Promise<ConvertResult> {
  const configIssues = job.configIssues ?? [];
  const configWarnings = job.configWarnings ?? [];

  let inputBuffer: Buffer | null = null;
  try {
    inputBuffer = await fs.readFile(job.inputPath);
  } catch (error) {
    const issue: Issue = {
      code: IssueCodes.CORE_INPUT_NOT_FOUND,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: `Input not found or unreadable: ${job.inputPath}.`,
    };
    const issues = aggregateIssues([...configIssues, issue]);
    const report = buildReport({
      job,
      detected: 'unknown',
      ir0: undefined,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: [],
      exportWarnings: [],
      configWarnings,
      contractOverride: GENERIC_CONTRACT,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: determineExitCode(job.policy, issues), report };
  }

  const detected = job.inputFormat ?? (await detectFormat(inputBuffer, job.inputPath));
  if (!detected) {
    const issue: Issue = {
      code: IssueCodes.CORE_INPUT_UNSUPPORTED_FORMAT,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: `Unsupported or unrecognized input format: ${job.inputPath}.`,
    };
    const issues = aggregateIssues([...configIssues, issue]);
    const report = buildReport({
      job,
      detected: 'unknown',
      ir0: undefined,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: [],
      exportWarnings: [],
      configWarnings,
      contractOverride: GENERIC_CONTRACT,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: determineExitCode(job.policy, issues), report };
  }

  if (configIssues.some((issue) => issue.severity === 'ERROR')) {
    const issues = aggregateIssues(configIssues);
    const report = buildReport({
      job,
      detected,
      ir0: undefined,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: [],
      exportWarnings: [],
      configWarnings,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: determineExitCode(job.policy, issues), report };
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
      ...configIssues,
    ];
    const report = buildReport({
      job,
      detected,
      ir0: undefined,
      ir1: undefined,
      issues: aggregateIssues(issues),
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: [],
      exportWarnings: [],
      configWarnings,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: 2, report };
  }

  const imported = await inputAdapter.import(job.inputPath, {
    defaultPPQ: job.config.midi.defaultPPQ,
  });
  const importWarnings = imported.warnings;
  const importIssues = imported.issues;

  if (!imported.ok || !imported.ir) {
    const issues = aggregateIssues([
      ...configIssues,
      ...importIssues,
      ...(imported.fatalError ? [imported.fatalError] : []),
    ]);
    const report = buildReport({
      job,
      detected,
      ir0: undefined,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: importWarnings,
      exportWarnings: [],
      configWarnings,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: determineExitCode(job.policy, issues), report };
  }

  const ir0 = canonicalizeProject(imported.ir);

  const exportResult = await outputAdapter.export(ir0, job.outPath, {
    overwrite: job.flags.overwrite,
    config: job.config,
    profile: job.profile,
  });
  const exportWarnings = exportResult.warnings;
  const exportIssues = exportResult.issues;

  if (!exportResult.ok) {
    const issues = aggregateIssues([
      ...configIssues,
      ...importIssues,
      ...exportIssues,
      ...(exportResult.fatalError ? [exportResult.fatalError] : []),
    ]);
    const report = buildReport({
      job,
      detected,
      ir0,
      ir1: undefined,
      issues,
      addedElements: 0,
      diffSummary: undefined,
      trackMappings: [],
      parseWarnings: importWarnings,
      exportWarnings,
      configWarnings,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return { exitCode: determineExitCode(job.policy, issues), report, ir0 };
  }

  let ir1: IRProject | undefined;
  let diffIssues: Issue[] = [];
  let addedElements = 0;
  let diffSummary: ReturnType<typeof diffProjects>['summary'] | undefined;
  let trackMappings: TrackMappingDiff[] = [];
  let reimportWarnings: string[] = [];
  let reimportIssues: Issue[] = [];

  const reimported = await outputAdapter.import(job.outPath, {
    defaultPPQ: ir0.timing.ppq,
  });

  if (reimported.ok && reimported.ir) {
    ir1 = canonicalizeProject(reimported.ir);
    reimportWarnings = reimported.warnings;
    reimportIssues = reimported.issues;
    const contractResult = getContract(detected, job.targetFormat, job.profile);
    const diff = diffProjects(ir0, ir1, contractResult.contract);
    diffIssues = diff.issues;
    addedElements = diff.addedElements;
    diffSummary = diff.summary;
    trackMappings = diff.trackMappings;
    if (contractResult.usedFallback && contractResult.issueCode) {
      diffIssues.push({
        code: contractResult.issueCode,
        severity: 'WARN',
        category: 'STRUCTURE',
        message: `No specific contract for ${detected}->${job.targetFormat} (profile ${job.profile}); using generic rules.`,
      });
    }
  } else {
    const reason = reimported.fatalError?.message ?? 'unknown error';
    diffIssues.push({
      code: IssueCodes.DIFF_ROUNDTRIP_IMPORT_FAILED,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: `Round-trip verification failed: could not re-import output (${reason}).`,
    });
    if (reimported.fatalError) {
      diffIssues.push(reimported.fatalError);
    }
  }

  const allIssues = aggregateIssues([
    ...configIssues,
    ...importIssues,
    ...exportIssues,
    ...reimportIssues,
    ...diffIssues,
  ]);

  const report = buildReport({
    job,
    detected,
    ir0,
    ir1,
    issues: allIssues,
    addedElements,
    diffSummary,
    trackMappings: buildTrackMappings(trackMappings),
    parseWarnings: importWarnings,
    exportWarnings: [...exportWarnings, ...reimportWarnings],
    configWarnings,
  });

  if (!job.flags.noReport) {
    await writeReport(job, report);
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

async function writeReport(job: ConvertJob, report: ConversionReport): Promise<void> {
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
  detected: Format | 'unknown';
  ir0?: IRProject;
  ir1?: IRProject;
  issues: Issue[];
  addedElements: number;
  diffSummary?: ReturnType<typeof diffProjects>['summary'];
  trackMappings: TrackMappingReport[];
  parseWarnings: string[];
  exportWarnings: string[];
  configWarnings: string[];
  contractOverride?: {
    name: string;
    version: string;
    tolerances: { timingTicks: number; tempoBpm: number; velocity: number };
  };
}): ConversionReport {
  const contract =
    params.contractOverride ??
    getContract(params.detected as Format, params.job.targetFormat, params.job.profile).contract;
  const summary = params.diffSummary ?? summarizeIssues(params.issues);
  const diagnostics = buildDiagnostics(
    params.parseWarnings,
    params.exportWarnings,
    params.configWarnings,
  );

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
      detectedBy: params.job.inputFormat ? 'user' : 'sniff',
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
    trackMappings: params.trackMappings,
    issues: sortIssues(params.issues),
    diffs: { addedElements: params.addedElements },
    diagnostics,
  };
}

function summarizeIssues(issues: Issue[]) {
  const counts = issues.reduce(
    (acc, issue) => {
      const count = issue.count ?? 1;
      if (issue.severity === 'ERROR') {
        acc.errors += count;
      }
      if (issue.severity === 'WARN') {
        acc.approximate += count;
      }
      if (issue.code === IssueCodes.DIFF_ELEMENT_DROPPED) {
        acc.dropped += count;
      }
      return acc;
    },
    { approximate: 0, dropped: 0, errors: 0 },
  );

  return {
    elementsTotal: counts.approximate + counts.dropped + counts.errors,
    perfect: 0,
    equivalent: 0,
    approximate: counts.approximate,
    dropped: counts.dropped,
    errors: counts.errors,
  };
}

function countNotes(ir?: IRProject): number {
  if (!ir) return 0;
  return ir.tracks.reduce(
    (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
    0,
  );
}

function buildTrackMappings(mappings: TrackMappingDiff[]): TrackMappingReport[] {
  return mappings.map((mapping) => {
    const source = mapping.source;
    const target = mapping.target;
    const notes = source.events.filter((event) => event.kind === 'note').length;
    const controllers = source.events.filter(
      (event) => event.kind === 'cc' || event.kind === 'pitchbend',
    ).length;
    const perfect = mapping.summary.perfect + mapping.summary.equivalent;
    const dropped = mapping.summary.dropped + mapping.summary.errors;

    return {
      sourceTrackId: source.id,
      sourceName: source.name,
      targetPartId: target.notation?.partId ?? target.id,
      targetName: target.name,
      stats: { notes, controllers },
      fidelity: {
        perfect,
        approximate: mapping.summary.approximate,
        dropped,
      },
      elementIds: mapping.elementIds,
    };
  });
}

function buildDiagnostics(
  parseWarnings: string[],
  exportWarnings: string[],
  configWarnings: string[],
): ConversionReport['diagnostics'] {
  const diagnostics: ConversionReport['diagnostics'] = {};
  if (parseWarnings.length) {
    diagnostics.parseWarnings = parseWarnings;
  }
  if (exportWarnings.length) {
    diagnostics.exportWarnings = exportWarnings;
  }
  if (configWarnings.length) {
    diagnostics.configWarnings = configWarnings;
  }
  return Object.keys(diagnostics).length ? diagnostics : undefined;
}
