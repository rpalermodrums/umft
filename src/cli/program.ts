import { Command, CommanderError } from 'commander';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { loadConfig } from '../core/config';
import { runConvert } from '../core/convert/convert';
import { createLogger } from '../core/logging';
import { loadReportSchema } from '../core/report/schema';
import { ConversionReport } from '../core/report/types';
import { IssueCodes } from '../core/issues';
import { Format } from '../core/ir';
import { detectFormat, getAdapter } from '../formats/registry';

const FORMAT_VALUES = ['midi', 'musicxml', 'aaf', 'omf'] as const;
const POLICY_VALUES = ['best-effort', 'strict'] as const;
const REPORT_FORMAT_VALUES = ['json', 'md', 'both'] as const;
const LOG_LEVEL_VALUES = ['silent', 'error', 'warn', 'info', 'debug'] as const;

class CliError extends Error {
  code: string;
  exitCode: number;
  constructor(code: string, message: string, exitCode = 2) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

interface ConvertOptions {
  to: string;
  out?: string;
  report?: string | false;
  policy?: string;
  profile?: string;
  config?: string;
  overwrite?: boolean;
  reportFormat?: string;
  logLevel?: string;
}

interface InspectValidateOptions {
  json?: boolean;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    handleCliError(error);
  }
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('umft')
    .description('Universal Music File Translator')
    .version('0.1.0')
    .exitOverride()
    .configureOutput({
      outputError: () => {
        // CLI errors are handled centrally so output stays single-line and scriptable.
      },
    });

  program
    .command('convert')
    .description('Convert between music file formats')
    .argument('<inputPath>', 'Input path')
    .requiredOption('--to <format>', 'Target format')
    .option('--out <path>', 'Output path')
    .option('--report <path>', 'Report path')
    .option('--policy <policy>', 'best-effort|strict')
    .option('--profile <name>', 'Profile name override')
    .option('--config <path>', 'Config file path')
    .option('--overwrite', 'Overwrite output', false)
    .option('--report-format <format>', 'json|md|both', 'both')
    .option('--no-report', 'Disable report output')
    .option('--log-level <level>', 'silent|error|warn|info|debug', 'info')
    .action(async (inputPath: string, options: ConvertOptions) => {
      const {
        config,
        warnings: configWarnings,
        issues: configIssues,
      } = await loadConfig({
        cwd: process.cwd(),
        configPath: options.config,
      });

      const targetFormat = parseEnum('to', options.to, FORMAT_VALUES);
      const policy = parseEnum('policy', options.policy ?? config.policy, POLICY_VALUES);
      const reportFormat = parseEnum(
        'report-format',
        options.reportFormat ?? 'both',
        REPORT_FORMAT_VALUES,
      );
      const logLevel = parseEnum('log-level', options.logLevel ?? 'info', LOG_LEVEL_VALUES);
      const profile = options.profile ?? config.profile;
      if (!profile.trim()) {
        throw new CliError('CLI_INVALID_OPTION', 'Invalid --profile: value must be non-empty.');
      }

      const logger = createLogger(logLevel);
      const outPath = options.out ?? defaultOutPath(inputPath, targetFormat);
      const reportPath =
        typeof options.report === 'string' ? options.report : join(dirname(outPath), 'report.json');
      const noReport = options.report === false;

      const result = await runConvert({
        inputPath,
        targetFormat,
        outPath,
        reportPath,
        policy,
        profile,
        config,
        configWarnings,
        configIssues,
        flags: {
          overwrite: options.overwrite ?? false,
          reportFormat,
          noReport,
        },
      });

      const report = result.report as ConversionReport | undefined;
      if (report) {
        logger.info(
          `Summary: PERFECT=${report.summary.perfect} EQUIVALENT=${report.summary.equivalent} APPROXIMATE=${report.summary.approximate} DROPPED=${report.summary.dropped} ERRORS=${report.summary.errors}`,
        );
      }

      logger.info(`Output: ${outPath}`);
      if (!noReport) {
        logger.info(`Report: ${reportPath}`);
      }

      if (result.exitCode >= 2 && report?.issues.length) {
        const issue = report.issues[0];
        logger.error(`Failure: ${issue.code} ${issue.message}`);
      }
      process.exitCode = result.exitCode;
    });

  program
    .command('inspect')
    .description('Inspect an input file')
    .argument('<inputPath>', 'Input path')
    .option('--json', 'Output JSON')
    .action(async (inputPath: string, options: InspectValidateOptions) => {
      const buffer = await readFile(inputPath);
      const format = await detectFormat(buffer, inputPath);
      if (!format) {
        throw new CliError(
          IssueCodes.CORE_INPUT_UNSUPPORTED_FORMAT,
          `Unsupported or unrecognized input format: ${inputPath}.`,
        );
      }
      const adapter = getAdapter(format);
      const result = await adapter.inspect(inputPath);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      process.stdout.write(`Format: ${result.format}\n`);
      printInspectDetails(result.details);
      process.stdout.write(`Warnings: ${result.warnings.length}\n`);
    });

  program
    .command('validate')
    .description('Validate an input file')
    .argument('<inputPath>', 'Input path')
    .option('--json', 'Output JSON')
    .action(async (inputPath: string, options: InspectValidateOptions) => {
      const buffer = await readFile(inputPath);
      const format = await detectFormat(buffer, inputPath);
      if (!format) {
        throw new CliError(
          IssueCodes.CORE_INPUT_UNSUPPORTED_FORMAT,
          `Unsupported or unrecognized input format: ${inputPath}.`,
        );
      }
      const adapter = getAdapter(format);
      const result = await adapter.import(inputPath, {});
      const allIssues = [...result.issues, ...(result.fatalError ? [result.fatalError] : [])];
      if (!result.ok || !result.ir) {
        const payload = {
          status: 'FAIL',
          format,
          warnings: result.warnings,
          issues: allIssues,
          error: result.fatalError?.message,
        };
        if (options.json) {
          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        } else {
          process.stdout.write(`Status: FAIL\n`);
          process.stdout.write(`Format: ${format}\n`);
          process.stdout.write(`Warnings: ${result.warnings.length}\n`);
          process.stdout.write(`Issues: ${allIssues.length}\n`);
          if (result.fatalError) {
            process.stdout.write(`Error: ${result.fatalError.code} ${result.fatalError.message}\n`);
          }
        }
        process.exitCode = 2;
        return;
      }

      const payload = {
        status: 'PASS',
        format,
        warnings: result.warnings,
        issues: allIssues,
        stats: {
          tracks: result.ir.tracks.length,
          notes: result.ir.tracks.reduce(
            (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
            0,
          ),
          tempoEvents: result.ir.timing.tempoMap.length,
          timeSignatures: result.ir.timing.timeSignatures.length,
        },
      };
      if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        process.stdout.write(`Status: PASS\n`);
        process.stdout.write(`Format: ${format}\n`);
        process.stdout.write(`Tracks: ${payload.stats.tracks}\n`);
        process.stdout.write(`Notes: ${payload.stats.notes}\n`);
        process.stdout.write(`Tempo events: ${payload.stats.tempoEvents}\n`);
        process.stdout.write(`Time signatures: ${payload.stats.timeSignatures}\n`);
        process.stdout.write(`Warnings: ${result.warnings.length}\n`);
        process.stdout.write(`Issues: ${allIssues.length}\n`);
      }
    });

  const schema = program.command('schema').description('Print schemas');
  schema
    .command('report')
    .description('Print report JSON schema')
    .action(() => {
      const schemaDoc = loadReportSchema();
      process.stdout.write(`${JSON.stringify(schemaDoc, null, 2)}\n`);
    });

  return program;
}

function handleCliError(error: unknown): void {
  if (error instanceof CliError) {
    process.stderr.write(`[ERROR] ${error.code}: ${error.message}\n`);
    process.exitCode = error.exitCode;
    return;
  }

  if (error instanceof CommanderError) {
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exitCode = 0;
      return;
    }
    const message = error.message.replace(/^error:\s*/i, '');
    process.stderr.write(`[ERROR] CLI_PARSE_ERROR: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  if (error instanceof Error) {
    process.stderr.write(`[ERROR] CLI_UNEXPECTED: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  process.stderr.write('[ERROR] CLI_UNEXPECTED: unknown error\n');
  process.exitCode = 2;
}

function parseEnum<T extends string>(flagName: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new CliError(
    'CLI_INVALID_OPTION',
    `Invalid --${flagName}: ${value}. Expected one of: ${allowed.join(', ')}.`,
  );
}

function printInspectDetails(details: Record<string, unknown>): void {
  const keyOrder = ['tracks', 'parts', 'notes', 'tempoEvents', 'timeSignatures', 'size'];
  const printed = new Set<string>();
  for (const key of keyOrder) {
    if (!(key in details)) {
      continue;
    }
    process.stdout.write(`${toLabel(key)}: ${String(details[key])}\n`);
    printed.add(key);
  }

  const remaining = Object.keys(details).filter((key) => !printed.has(key));
  if (remaining.length) {
    for (const key of remaining.sort()) {
      process.stdout.write(`${toLabel(key)}: ${JSON.stringify(details[key])}\n`);
    }
  }
}

function toLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (m) => m.toUpperCase());
}

function defaultOutPath(inputPath: string, target: Format): string {
  const base = basename(inputPath, extname(inputPath));
  const extMap: Record<Format, string> = {
    midi: '.mid',
    musicxml: '.musicxml',
    aaf: '.aaf',
    omf: '.omf',
  };
  return join(dirname(inputPath), `${base}${extMap[target]}`);
}
