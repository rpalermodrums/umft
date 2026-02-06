import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runConvert } from '../src/core/convert';
import { DEFAULT_CONFIG } from '../src/core/config';
import { midiAdapter } from '../src/formats/midi';

async function createMidiWithDroppedEvents(path: string): Promise<void> {
  const project = {
    irVersion: '1.0',
    projectId: 'exit-codes',
    meta: {},
    timing: {
      ppq: 480,
      tempoMap: [{ id: '', tick: 0, bpm: 120 }],
      timeSignatures: [{ id: '', tick: 0, numerator: 4, denominator: 4 }],
    },
    tracks: [
      {
        id: '',
        name: 'Piano',
        type: 'midi',
        midi: { channel: 0, program: 0 },
        events: [
          { kind: 'note', id: '', tick: 0, duration: 480, pitch: 60, velocity: 100 },
          { kind: 'cc', id: '', tick: 0, controller: 1, value: 64 },
        ],
      },
    ],
    markers: [],
  };

  const exported = await midiAdapter.export(project as never, path, { overwrite: true });
  assert.equal(exported.ok, true);
}

describe('convert exit codes', () => {
  it('returns 2 for fatal failures even in strict mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-exit-fatal-'));
    const result = await runConvert({
      inputPath: join(dir, 'missing.mid'),
      targetFormat: 'midi',
      outPath: join(dir, 'out.mid'),
      reportPath: join(dir, 'report.json'),
      policy: 'strict',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: { overwrite: true, reportFormat: 'json', noReport: true },
    });

    assert.equal(result.exitCode, 2);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 3 for strict fidelity violations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-exit-strict-'));
    const inputPath = join(dir, 'input.mid');
    await createMidiWithDroppedEvents(inputPath);

    const result = await runConvert({
      inputPath,
      targetFormat: 'musicxml',
      outPath: join(dir, 'out.musicxml'),
      reportPath: join(dir, 'report.json'),
      policy: 'strict',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: { overwrite: true, reportFormat: 'json', noReport: true },
    });

    assert.equal(result.exitCode, 3);
    const codes = (result.report as { issues: Array<{ code: string }> }).issues.map((i) => i.code);
    assert.ok(codes.includes('CORE_STRICT_POLICY_VIOLATION'));
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 1 for best-effort runs with warnings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-exit-warn-'));
    const inputPath = join(dir, 'input.mid');
    await createMidiWithDroppedEvents(inputPath);

    const result = await runConvert({
      inputPath,
      targetFormat: 'musicxml',
      outPath: join(dir, 'out.musicxml'),
      reportPath: join(dir, 'report.json'),
      policy: 'best-effort',
      profile: DEFAULT_CONFIG.profile,
      config: DEFAULT_CONFIG,
      flags: { overwrite: true, reportFormat: 'json', noReport: true },
    });

    assert.equal(result.exitCode, 1);
    await rm(dir, { recursive: true, force: true });
  });
});
