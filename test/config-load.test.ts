import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/core/config/load';
import { IssueCodes } from '../src/core/issues';

describe('config loading', () => {
  it('emits issues for unknown keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-config-'));
    const configPath = join(dir, '.umft.json');
    await writeFile(configPath, JSON.stringify({ profile: 'default', unknownKey: true }, null, 2));

    const result = await loadConfig({ cwd: dir });
    const codes = result.issues.map((issue) => issue.code);
    assert.ok(codes.includes(IssueCodes.CORE_CONFIG_UNKNOWN_KEYS));

    await rm(dir, { recursive: true, force: true });
  });
});
