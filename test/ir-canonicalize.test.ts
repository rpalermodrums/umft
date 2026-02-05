import { describe, expect, it } from 'vitest';
import { canonicalizeProject, makeId, type IRProject } from '../src/core/ir';

describe('ir ids', () => {
  it('creates stable ids', () => {
    const first = makeId('note', ['trk', 0, 480, 60, 100]);
    const second = makeId('note', ['trk', 0, 480, 60, 100]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
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
      markers: [],
    };

    const canonical = canonicalizeProject(project);

    expect(canonical.tracks[0].type).toBe('midi');
    expect(canonical.tracks[0].id).not.toEqual('');
    expect(canonical.tracks[1].type).toBe('notation');

    const events = canonical.tracks[0].events;
    expect(events[0].kind).toBe('cc');
    expect(events[1].kind).toBe('note');
    expect((events[1] as { pitch: number }).pitch).toBe(55);
    expect((events[2] as { pitch: number }).pitch).toBe(60);

    expect(canonical.timing.tempoMap[0].bpm).toBe(120.123457);
  });
});
