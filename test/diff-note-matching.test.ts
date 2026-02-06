import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffProjects } from '../src/core/diff';
import { getContract } from '../src/core/contracts';
import { canonicalizeProject } from '../src/core/ir';
import { IssueCodes } from '../src/core/issues';

describe('diff note matching', () => {
  it('classifies timing/velocity deltas as approximate instead of dropped', () => {
    const ir0 = canonicalizeProject({
      irVersion: '1.0',
      projectId: 'left',
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
          events: [{ kind: 'note', id: '', tick: 0, duration: 480, pitch: 60, velocity: 100 }],
        },
      ],
      markers: [],
    });

    const ir1 = canonicalizeProject({
      irVersion: '1.0',
      projectId: 'right',
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
          events: [{ kind: 'note', id: '', tick: 2, duration: 482, pitch: 60, velocity: 98 }],
        },
      ],
      markers: [],
    });

    const contractLookup = getContract('midi', 'midi', 'default');
    const contract = {
      ...contractLookup.contract,
      tolerances: {
        ...contractLookup.contract.tolerances,
        timingTicks: 0,
        velocity: 0,
      },
    };

    const diff = diffProjects(ir0, ir1, contract);
    assert.equal(diff.summary.approximate, 1);
    assert.equal(diff.summary.dropped, 0);
    assert.equal(diff.summary.errors, 0);

    assert.ok(
      diff.issues.some((issue) => issue.code === IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE),
    );
    assert.ok(
      !diff.issues.some(
        (issue) =>
          issue.code === IssueCodes.DIFF_ELEMENT_DROPPED ||
          issue.code === IssueCodes.DIFF_ELEMENT_MISSING_LOSSLESS,
      ),
    );
  });
});
