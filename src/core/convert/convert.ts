import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { aggregateIssues, Issue, IssueCodes, sortIssues } from '../issues';
import { GENERIC_CONTRACT, getContract, MappingContract } from '../contracts';
import { canonicalizeProject, Format, IRProject } from '../ir';
import { diffProjects, TrackMappingDiff } from '../diff';
import { atomicWriteFile, ensureDirForFile } from '../io';
import { hashConfig } from '../config';
import { formatReportMarkdown } from '../report/markdown';
import { ConversionReport, TrackMappingReport } from '../report/types';
import { detectFormat, getAdapter } from '../../formats/registry';
import { FormatAdapter } from '../../formats/types';
import { ConvertJob, ConvertResult } from './types';

const EMPTY_DIFF_SUMMARY: ConversionReport['summary'] = {
  elementsTotal: 0,
  perfect: 0,
  equivalent: 0,
  approximate: 0,
  dropped: 0,
  errors: 0,
};

export async function runConvert(job: ConvertJob): Promise<ConvertResult> {
  const configIssues = job.configIssues ?? [];
  const configWarnings = job.configWarnings ?? [];
  const genericContract = applyToleranceOverrides(GENERIC_CONTRACT, job.config.diff);

  const failWithReport = async (params: {
    detected: Format | 'unknown';
    contract: MappingContract;
    issues: Issue[];
    ir0?: IRProject;
    ir1?: IRProject;
    parseWarnings?: string[];
    exportWarnings?: string[];
    trackMappings?: TrackMappingReport[];
    addedElements?: number;
  }): Promise<ConvertResult> => {
    const issues = aggregateIssues(params.issues);
    const report = buildReport({
      job,
      detected: params.detected,
      contract: params.contract,
      ir0: params.ir0,
      ir1: params.ir1,
      issues,
      addedElements: params.addedElements ?? 0,
      diffSummary: undefined,
      trackMappings: params.trackMappings ?? [],
      parseWarnings: params.parseWarnings ?? [],
      exportWarnings: params.exportWarnings ?? [],
      configWarnings,
    });
    if (!job.flags.noReport) {
      await writeReport(job, report);
    }
    return {
      exitCode: determineExitCode({
        policy: job.policy,
        issues,
        fatalFailure: true,
        strictViolation: false,
      }),
      report,
      ir0: params.ir0,
      ir1: params.ir1,
    };
  };

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
    return failWithReport({
      detected: 'unknown',
      contract: genericContract,
      issues: [...configIssues, issue],
    });
  }

  const detected = job.inputFormat ?? (await detectFormat(inputBuffer, job.inputPath));
  if (!detected) {
    const issue: Issue = {
      code: IssueCodes.CORE_INPUT_UNSUPPORTED_FORMAT,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: `Unsupported or unrecognized input format: ${job.inputPath}.`,
    };
    return failWithReport({
      detected: 'unknown',
      contract: genericContract,
      issues: [...configIssues, issue],
    });
  }

  const contractResult = getContract(detected, job.targetFormat, job.profile);
  const effectiveContract = applyToleranceOverrides(contractResult.contract, job.config.diff);

  if (configIssues.some((issue) => issue.severity === 'ERROR')) {
    return failWithReport({
      detected,
      contract: effectiveContract,
      issues: configIssues,
    });
  }

  let inputAdapter: FormatAdapter;
  let outputAdapter: FormatAdapter;
  try {
    inputAdapter = getAdapter(detected);
    outputAdapter = getAdapter(job.targetFormat);
  } catch {
    return failWithReport({
      detected,
      contract: effectiveContract,
      issues: [
        ...configIssues,
        {
          code: IssueCodes.CORE_UNSUPPORTED_CONVERSION_PAIR,
          severity: 'ERROR',
          category: 'STRUCTURE',
          message: `Unsupported conversion pair: ${detected} -> ${job.targetFormat}.`,
        },
      ],
    });
  }

  const inputCaps = inputAdapter.capabilities();
  const outputCaps = outputAdapter.capabilities();

  if (!inputCaps.supportsImport || !outputCaps.supportsExport) {
    return failWithReport({
      detected,
      contract: effectiveContract,
      issues: [
        ...configIssues,
        {
          code: IssueCodes.CORE_UNSUPPORTED_CONVERSION_PAIR,
          severity: 'ERROR',
          category: 'STRUCTURE',
          message: `Unsupported conversion pair: ${detected} -> ${job.targetFormat}.`,
        },
      ],
    });
  }

  const imported = await inputAdapter.import(job.inputPath, {
    defaultPPQ: job.config.midi.defaultPPQ,
  });
  const importWarnings = imported.warnings;
  const importIssues = imported.issues;

  if (!imported.ok || !imported.ir) {
    return failWithReport({
      detected,
      contract: effectiveContract,
      issues: [
        ...configIssues,
        ...importIssues,
        ...(imported.fatalError ? [imported.fatalError] : []),
      ],
      parseWarnings: importWarnings,
    });
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
    return failWithReport({
      detected,
      contract: effectiveContract,
      issues: [
        ...configIssues,
        ...importIssues,
        ...exportIssues,
        ...(exportResult.fatalError ? [exportResult.fatalError] : []),
      ],
      ir0,
      parseWarnings: importWarnings,
      exportWarnings,
    });
  }

  let ir1: IRProject | undefined;
  let diffIssues: Issue[] = [];
  let addedElements = 0;
  let diffSummary: ReturnType<typeof diffProjects>['summary'] | undefined;
  let trackMappings: TrackMappingDiff[] = [];
  let reimportWarnings: string[] = [];
  let reimportIssues: Issue[] = [];
  let fatalFailure = false;
  let strictViolation = false;

  const reimported = await outputAdapter.import(job.outPath, {
    defaultPPQ: ir0.timing.ppq,
  });

  if (reimported.ok && reimported.ir) {
    ir1 = canonicalizeProject(reimported.ir);
    reimportWarnings = reimported.warnings;
    reimportIssues = reimported.issues;
    const diff = diffProjects(ir0, ir1, effectiveContract);
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
    if (job.policy === 'strict' && (diff.summary.dropped > 0 || diff.summary.errors > 0)) {
      strictViolation = true;
      diffIssues.push({
        code: IssueCodes.CORE_STRICT_POLICY_VIOLATION,
        severity: 'ERROR',
        category: 'STRUCTURE',
        message: `Strict policy violation: ${diff.summary.dropped} dropped, ${diff.summary.errors} errors.`,
      });
    }
  } else {
    fatalFailure = true;
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
    contract: effectiveContract,
  });

  if (!job.flags.noReport) {
    await writeReport(job, report);
  }

  const exitCode = determineExitCode({
    policy: job.policy,
    issues: allIssues,
    fatalFailure,
    strictViolation,
  });
  return { exitCode, report, ir0, ir1 };
}

function determineExitCode(params: {
  policy: ConvertJob['policy'];
  issues: Issue[];
  fatalFailure: boolean;
  strictViolation: boolean;
}): number {
  if (params.fatalFailure) {
    return 2;
  }
  if (params.policy === 'strict' && params.strictViolation) {
    return 3;
  }
  const hasWarnOrError = params.issues.some(
    (issue) => issue.severity === 'WARN' || issue.severity === 'ERROR',
  );
  if (hasWarnOrError) {
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
  contract: MappingContract;
  ir0?: IRProject;
  ir1?: IRProject;
  issues: Issue[];
  addedElements: number;
  diffSummary?: ReturnType<typeof diffProjects>['summary'];
  trackMappings: TrackMappingReport[];
  parseWarnings: string[];
  exportWarnings: string[];
  configWarnings: string[];
}): ConversionReport {
  const summary = params.diffSummary ?? EMPTY_DIFF_SUMMARY;
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
      name: params.contract.name,
      version: params.contract.version,
      tolerances: params.contract.tolerances,
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

function applyToleranceOverrides(
  contract: MappingContract,
  diffConfig: ConvertJob['config']['diff'],
): MappingContract {
  return {
    ...contract,
    tolerances: {
      timingTicks: diffConfig.timingToleranceTicks ?? contract.tolerances.timingTicks,
      tempoBpm: diffConfig.tempoToleranceBpm ?? contract.tolerances.tempoBpm,
      velocity: diffConfig.velocityTolerance ?? contract.tolerances.velocity,
    },
  };
}
