#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { loadConfig } from './core/config';
import { runConvert } from './core/convert/convert';
import { createLogger } from './core/logging';
import { loadReportSchema } from './core/report/schema';
import { detectFormat, getAdapter } from './formats/registry';

const program = new Command();

program.name('umft').description('Universal Music File Translator').version('0.1.0');

program
  .command('convert')
  .description('Convert between music file formats')
  .argument('<inputPath>', 'Input path')
  .requiredOption('--to <format>', 'Target format')
  .option('--out <path>', 'Output path')
  .option('--report <path>', 'Report path')
  .option('--policy <policy>', 'best-effort|strict', 'best-effort')
  .option('--profile <name>', 'Profile name', 'default')
  .option('--config <path>', 'Config file path')
  .option('--overwrite', 'Overwrite output', false)
  .option('--report-format <format>', 'json|md|both', 'both')
  .option('--no-report', 'Disable report output', false)
  .option('--log-level <level>', 'silent|error|warn|info|debug', 'info')
  .action(async (inputPath, options) => {
    const logger = createLogger(options.logLevel);
    const { config } = await loadConfig({ cwd: process.cwd(), configPath: options.config });

    const outPath = options.out ?? defaultOutPath(inputPath, options.to);
    const reportPath =
      typeof options.report === 'string' ? options.report : join(dirname(outPath), 'report.json');
    const noReport = options.report === false;

    const result = await runConvert({
      inputPath,
      targetFormat: options.to,
      outPath,
      reportPath,
      policy: options.policy,
      profile: options.profile,
      config,
      flags: {
        overwrite: options.overwrite,
        reportFormat: options.reportFormat,
        noReport,
      },
    });

    logger.info(`Output: ${outPath}`);
    if (!noReport) {
      logger.info(`Report: ${reportPath}`);
    }
    process.exitCode = result.exitCode;
  });

program
  .command('inspect')
  .description('Inspect an input file')
  .argument('<inputPath>', 'Input path')
  .option('--json', 'Output JSON')
  .action(async (inputPath, options) => {
    const buffer = await readFile(inputPath);
    const format = await detectFormat(buffer, inputPath);
    if (!format) {
      throw new Error('Unable to detect input format');
    }
    const adapter = getAdapter(format);
    const result = await adapter.inspect(inputPath);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`Format: ${result.format}\n`);
      process.stdout.write(`Warnings: ${result.warnings.length}\n`);
    }
  });

program
  .command('validate')
  .description('Validate an input file')
  .argument('<inputPath>', 'Input path')
  .option('--json', 'Output JSON')
  .action(async (inputPath, options) => {
    const buffer = await readFile(inputPath);
    const format = await detectFormat(buffer, inputPath);
    if (!format) {
      throw new Error('Unable to detect input format');
    }
    const adapter = getAdapter(format);
    const { ir, warnings, issues } = await adapter.import(inputPath, {});
    const payload = {
      format,
      warnings,
      issues,
      stats: {
        tracks: ir.tracks.length,
        notes: ir.tracks.reduce(
          (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
          0,
        ),
      },
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`Format: ${format}\n`);
      process.stdout.write(`Warnings: ${warnings.length}\n`);
      process.stdout.write(`Issues: ${issues.length}\n`);
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

program.parse();

function defaultOutPath(inputPath: string, target: string): string {
  const base = basename(inputPath, extname(inputPath));
  const extMap: Record<string, string> = {
    midi: '.mid',
    musicxml: '.musicxml',
    aaf: '.aaf',
    omf: '.omf',
  };
  const ext = extMap[target] ?? `.${target}`;
  return join(dirname(inputPath), `${base}${ext}`);
}
