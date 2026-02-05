import { describe, expect, it } from 'vitest';
import { diffProjects } from '../src/core/diff';
import { getContract } from '../src/core/contracts';
import { IRProject } from '../src/core/ir';

function baseProject(): IRProject {
  return {
    irVersion: '1.0',
    projectId: 'proj',
    meta: {},
    timing: {
      ppq: 960,
      tempoMap: [],
      timeSignatures: [],
    },
    tracks: [],
    markers: [],
  };
}

describe('diffProjects', () => {
  it('flags missing lossless elements as errors', () => {
    const ir0 = baseProject();
    const ir1 = baseProject();

    ir0.tracks.push({
      id: 'trk1',
      name: 'Track',
      type: 'midi',
      events: [
        {
          kind: 'note',
          id: 'note-1',
          tick: 0,
          duration: 480,
          pitch: 60,
          velocity: 100,
        },
      ],
    });

    const contract = getContract('midi', 'midi').contract;
    const result = diffProjects(ir0, ir1, contract);

    expect(result.summary.errors).toBe(1);
  });

  it('classifies approximate mismatches under non-lossless expectation', () => {
    const ir0 = baseProject();
    const ir1 = baseProject();

    ir0.tracks.push({
      id: 'trk1',
      name: 'Track',
      type: 'midi',
      events: [
        {
          kind: 'note',
          id: 'note-1',
          tick: 0,
          duration: 480,
          pitch: 60,
          velocity: 100,
        },
      ],
    });

    ir1.tracks.push({
      id: 'trk1',
      name: 'Track',
      type: 'midi',
      events: [
        {
          kind: 'note',
          id: 'note-1',
          tick: 10,
          duration: 470,
          pitch: 60,
          velocity: 100,
        },
      ],
    });

    const contract = getContract('midi', 'musicxml').contract;
    const result = diffProjects(ir0, ir1, contract);

    expect(result.summary.approximate).toBe(1);
    expect(result.summary.errors).toBe(0);
  });
});
