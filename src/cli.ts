#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

const notImplemented = (cmd: string) => {
  console.error(`${cmd} is not implemented yet.`);
  process.exitCode = 2;
};

program
  .name('umft')
  .description('Universal Music File Translator')
  .version('0.1.0');

program
  .command('convert')
  .description('Convert between music file formats')
  .argument('<inputPath>', 'Input path')
  .requiredOption('--to <format>', 'Target format')
  .action(() => notImplemented('convert'));

program
  .command('inspect')
  .description('Inspect an input file')
  .argument('<inputPath>', 'Input path')
  .option('--json', 'Output JSON')
  .action(() => notImplemented('inspect'));

program
  .command('validate')
  .description('Validate an input file')
  .argument('<inputPath>', 'Input path')
  .option('--json', 'Output JSON')
  .action(() => notImplemented('validate'));

const schema = program.command('schema').description('Print schemas');
schema
  .command('report')
  .description('Print report JSON schema')
  .action(() => notImplemented('schema report'));

program.parse();
