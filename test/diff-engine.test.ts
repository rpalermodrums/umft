import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffProjects } from '../src/core/diff';
import { getContract } from '../src/core/contracts';
import { IRProject, canonicalizeProject } from '../src/core/ir';

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

    assert.equal(result.summary.errors, 1);
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

    assert.equal(result.summary.approximate, 1);
    assert.equal(result.summary.errors, 0);
  });

  it('matches tracks by stable id across type changes', () => {
    const ir0 = canonicalizeProject({
      ...baseProject(),
      tracks: [
        {
          id: '',
          name: 'Piano',
          type: 'midi',
          events: [
            {
              kind: 'note',
              id: '',
              tick: 0,
              duration: 480,
              pitch: 60,
              velocity: 100,
            },
          ],
        },
      ],
    });

    const ir1 = canonicalizeProject({
      ...baseProject(),
      tracks: [
        {
          id: '',
          name: 'Piano',
          type: 'notation',
          events: [
            {
              kind: 'note',
              id: '',
              tick: 0,
              duration: 480,
              pitch: 60,
              velocity: 100,
            },
          ],
        },
      ],
    });

    const contract = getContract('midi', 'midi').contract;
    const result = diffProjects(ir0, ir1, contract);

    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.dropped, 0);
  });
});
