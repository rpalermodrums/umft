import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IRProject } from '../src/core/ir';
import { midiAdapter } from '../src/formats/midi';
import { musicxmlAdapter } from '../src/formats/musicxml';

function makeProject(): IRProject {
  return {
    irVersion: '1.0',
    projectId: 'test',
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
          { kind: 'pitchbend', id: '', tick: 240, value: 200 },
        ],
      },
    ],
    markers: [],
  };
}

describe('adapter roundtrips', () => {
  it('roundtrips midi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-midi-'));
    const path = join(dir, 'test.mid');

    await midiAdapter.export(makeProject(), path, { overwrite: true });
    const result = await midiAdapter.import(path, { defaultPPQ: 480 });

    const noteCount = result.ir.tracks.reduce(
      (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
      0,
    );
    expect(noteCount).toBe(1);
    expect(result.ir.timing.tempoMap.length).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });

  it('roundtrips musicxml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-mxml-'));
    const path = join(dir, 'test.musicxml');

    await musicxmlAdapter.export(makeProject(), path, { overwrite: true });
    const result = await musicxmlAdapter.import(path, { defaultPPQ: 480 });

    const notes = result.ir.tracks.flatMap((track) =>
      track.events.filter((e) => e.kind === 'note'),
    );
    expect(notes.length).toBe(1);
    expect((notes[0] as { pitch: number }).pitch).toBe(60);

    await rm(dir, { recursive: true, force: true });
  });
});
