import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runConvert } from '../src/core/convert';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { ConversionReport } from '../src/core/report/types';

describe('musicxml overwrite protection', () => {
  it('returns CORE_OUTPUT_PATH_EXISTS when overwrite is false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-mxml-overwrite-'));
    const outPath = join(dir, 'out.musicxml');
    const initial = '<placeholder />';
    await writeFile(outPath, initial, 'utf8');

    const result = await runConvert({
      inputPath: join('test', 'fixtures', 'simple.mid'),
      targetFormat: 'musicxml',
      outPath,
      reportPath: join(dir, 'report.json'),
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: {
        overwrite: false,
        reportFormat: 'json',
        noReport: true,
      },
    });

    assert.equal(result.exitCode, 2);
    const report = result.report as ConversionReport;
    assert.ok(report.issues.some((issue) => issue.code === 'CORE_OUTPUT_PATH_EXISTS'));
    assert.equal(await readFile(outPath, 'utf8'), initial);

    await rm(dir, { recursive: true, force: true });
  });
});
