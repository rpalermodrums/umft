import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const CLI_PATH = join(process.cwd(), 'dist-test', 'src', 'cli.js');
const INPUT_PATH = join(process.cwd(), 'test', 'fixtures', 'simple.mid');

function runInvalid(args: string[]) {
  return spawnSync(process.execPath, [CLI_PATH, 'convert', INPUT_PATH, ...args], {
    encoding: 'utf8',
  });
}

describe('cli invalid options', () => {
  it('fails on invalid target format', () => {
    const result = runInvalid(['--to', 'wav']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLI_INVALID_OPTION/);
    assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
  });

  it('fails on invalid policy', () => {
    const result = runInvalid(['--to', 'midi', '--policy', 'aggressive']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLI_INVALID_OPTION/);
  });

  it('fails on invalid report format', () => {
    const result = runInvalid(['--to', 'midi', '--report-format', 'yaml']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLI_INVALID_OPTION/);
  });

  it('fails on invalid log level', () => {
    const result = runInvalid(['--to', 'midi', '--log-level', 'trace']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLI_INVALID_OPTION/);
  });
});
