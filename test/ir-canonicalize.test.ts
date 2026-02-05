import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalizeProject, makeId, type IRProject } from '../src/core/ir';

describe('ir ids', () => {
  it('creates stable ids', () => {
    const first = makeId('note', ['trk', 0, 480, 60, 100]);
    const second = makeId('note', ['trk', 0, 480, 60, 100]);

    assert.equal(first, second);
    assert.equal(first.length, 32);
  });
});

describe('canonicalizeProject', () => {
  it('orders tracks and events deterministically and assigns ids', () => {
    const project: IRProject = {
      irVersion: '1.0',
      projectId: 'project',
      meta: {},
      timing: {
        ppq: 960,
        tempoMap: [{ id: '', tick: 0, bpm: 120.123456789 }],
        timeSignatures: [{ id: '', tick: 0, numerator: 4, denominator: 4 }],
      },
      tracks: [
        {
          id: '',
          name: 'Zeta',
          type: 'notation',
          events: [],
        },
        {
          id: '',
          name: 'alpha',
          type: 'midi',
          events: [
            { kind: 'note', id: '', tick: 10, duration: 5, pitch: 60, velocity: 100 },
            { kind: 'cc', id: '', tick: 5, controller: 1, value: 64 },
            { kind: 'note', id: '', tick: 10, duration: 5, pitch: 55, velocity: 100 },
          ],
        },
      ],
      markers: [{ id: '', tick: 240, name: 'Marker' }],
    };

    const canonical = canonicalizeProject(project);

    assert.equal(canonical.tracks[0].type, 'midi');
    assert.notEqual(canonical.tracks[0].id, '');
    assert.equal(canonical.tracks[1].type, 'notation');

    const events = canonical.tracks[0].events;
    assert.equal(events[0].kind, 'cc');
    assert.equal(events[1].kind, 'note');
    assert.equal((events[1] as { pitch: number }).pitch, 55);
    assert.equal((events[2] as { pitch: number }).pitch, 60);

    assert.equal(canonical.timing.tempoMap[0].bpm, 120.123457);
    assert.ok(canonical.timing.tempoMap[0].stableId);
    assert.ok(canonical.timing.timeSignatures[0].stableId);
    assert.ok(canonical.markers[0].stableId);
  });
});
