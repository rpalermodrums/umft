import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runConvert } from '../src/core/convert';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { ConversionReport } from '../src/core/report/types';

describe('midi roundtrip track count', () => {
  it('does not introduce synthetic tracks on midi->midi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-midi-roundtrip-tracks-'));

    const result = await runConvert({
      inputPath: join('test', 'fixtures', 'simple.mid'),
      targetFormat: 'midi',
      outPath: join(dir, 'out.mid'),
      reportPath: join(dir, 'report.json'),
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: {
        overwrite: true,
        reportFormat: 'json',
        noReport: true,
      },
    });

    assert.equal(result.exitCode, 0);
    const report = result.report as ConversionReport;
    assert.equal(report.stats.tracksOut, report.stats.tracksIn);
    assert.ok(!report.issues.some((issue) => issue.code === 'DIFF_TRACK_MAPPING_CHANGED'));

    await rm(dir, { recursive: true, force: true });
  });
});
