import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runConvert } from '../src/core/convert';
import { DEFAULT_CONFIG } from '../src/core/config';
import { midiAdapter } from '../src/formats/midi';

async function createTempoFixture(path: string): Promise<void> {
  const project = {
    irVersion: '1.0',
    projectId: 'tempo-fixture',
    meta: {},
    timing: {
      ppq: 480,
      tempoMap: [{ id: '', tick: 0, bpm: 120.009 }],
      timeSignatures: [{ id: '', tick: 0, numerator: 4, denominator: 4 }],
    },
    tracks: [
      {
        id: '',
        name: 'Piano',
        type: 'midi',
        midi: { channel: 0, program: 0 },
        events: [{ kind: 'note', id: '', tick: 0, duration: 480, pitch: 60, velocity: 100 }],
      },
    ],
    markers: [],
  };
  const exported = await midiAdapter.export(project as never, path, { overwrite: true });
  assert.equal(exported.ok, true);
}

describe('convert tolerance overrides', () => {
  it('applies config diff tolerances to contract and diff behavior', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-tolerance-'));
    const inputPath = join(dir, 'input.mid');
    await createTempoFixture(inputPath);

    const strictTolerance = {
      ...DEFAULT_CONFIG,
      diff: {
        ...DEFAULT_CONFIG.diff,
        tempoToleranceBpm: 0,
        timingToleranceTicks: 0,
        velocityTolerance: 0,
      },
    };
    const permissiveTolerance = {
      ...DEFAULT_CONFIG,
      diff: {
        ...DEFAULT_CONFIG.diff,
        tempoToleranceBpm: 0.01,
        timingToleranceTicks: 2,
        velocityTolerance: 1,
      },
    };

    const strictResult = await runConvert({
      inputPath,
      targetFormat: 'musicxml',
      outPath: join(dir, 'strict.musicxml'),
      reportPath: join(dir, 'strict.json'),
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: strictTolerance,
      flags: { overwrite: true, reportFormat: 'json', noReport: true },
    });
    const permissiveResult = await runConvert({
      inputPath,
      targetFormat: 'musicxml',
      outPath: join(dir, 'permissive.musicxml'),
      reportPath: join(dir, 'permissive.json'),
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: permissiveTolerance,
      flags: { overwrite: true, reportFormat: 'json', noReport: true },
    });

    const strictReport = strictResult.report as {
      contract: { tolerances: { tempoBpm: number } };
      issues: Array<{ code: string }>;
    };
    const permissiveReport = permissiveResult.report as {
      contract: { tolerances: { tempoBpm: number } };
      issues: Array<{ code: string }>;
    };

    assert.equal(strictReport.contract.tolerances.tempoBpm, 0);
    assert.equal(permissiveReport.contract.tolerances.tempoBpm, 0.01);
    assert.ok(
      strictReport.issues.some((issue) => issue.code === 'DIFF_TEMPO_MISMATCH_OVER_TOLERANCE'),
    );
    assert.ok(
      !permissiveReport.issues.some((issue) => issue.code === 'DIFF_TEMPO_MISMATCH_OVER_TOLERANCE'),
    );

    await rm(dir, { recursive: true, force: true });
  });
});
