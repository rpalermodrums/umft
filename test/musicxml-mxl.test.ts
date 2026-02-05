import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { musicxmlAdapter } from '../src/formats/musicxml';

describe('musicxml .mxl', () => {
  it('imports compressed mxl', async () => {
    const fixture = join('test', 'fixtures', 'simple.mxl');
    const result = await musicxmlAdapter.import(fixture, { defaultPPQ: 960 });
    assert.equal(result.ir.tracks.length, 1);
    const notes = result.ir.tracks[0].events.filter((event) => event.kind === 'note');
    assert.equal(notes.length, 2);
  });

  it('blocks zip slip entries', async () => {
    const fixture = join('test', 'fixtures', 'zip-slip.mxl');
    await assert.rejects(async () => {
      await musicxmlAdapter.import(fixture, { defaultPPQ: 960 });
    }, /CORE_ZIP_SLIP_BLOCKED/);
  });
});
