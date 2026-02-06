import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const CLI_PATH = join(process.cwd(), 'dist-test', 'src', 'cli.js');

describe('schema report command', () => {
  it('loads bundled report schema outside repo root', async () => {
    const outsideCwd = await mkdtemp(join(tmpdir(), 'umft-schema-cwd-'));
    const result = spawnSync(process.execPath, [CLI_PATH, 'schema', 'report'], {
      cwd: outsideCwd,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');

    const schema = JSON.parse(result.stdout) as {
      title?: string;
      properties?: Record<string, unknown>;
    };
    assert.equal(schema.title, 'UMFT Conversion Report');
    assert.ok(schema.properties);
    assert.ok('reportSchemaVersion' in schema.properties!);
    assert.ok('summary' in schema.properties!);

    await rm(outsideCwd, { recursive: true, force: true });
  });
});
