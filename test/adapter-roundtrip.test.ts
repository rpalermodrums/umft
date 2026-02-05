import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

    const exportResult = await midiAdapter.export(makeProject(), path, { overwrite: true });
    assert.equal(exportResult.ok, true);
    const result = await midiAdapter.import(path, { defaultPPQ: 480 });
    assert.equal(result.ok, true);

    const noteCount = result.ir!.tracks.reduce(
      (sum, track) => sum + track.events.filter((e) => e.kind === 'note').length,
      0,
    );
    assert.equal(noteCount, 1);
    assert.equal(result.ir!.timing.tempoMap.length, 1);

    await rm(dir, { recursive: true, force: true });
  });

  it('roundtrips musicxml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-mxml-'));
    const path = join(dir, 'test.musicxml');

    const exportResult = await musicxmlAdapter.export(makeProject(), path, { overwrite: true });
    assert.equal(exportResult.ok, true);
    const result = await musicxmlAdapter.import(path, { defaultPPQ: 480 });
    assert.equal(result.ok, true);

    const notes = result.ir!.tracks.flatMap((track) =>
      track.events.filter((e) => e.kind === 'note'),
    );
    assert.equal(notes.length, 1);
    assert.equal((notes[0] as { pitch: number }).pitch, 60);

    await rm(dir, { recursive: true, force: true });
  });
});
