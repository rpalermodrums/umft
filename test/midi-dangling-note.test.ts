import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { midiAdapter } from '../src/formats/midi';

describe('midi dangling notes', () => {
  it('closes dangling note-on at track end and reports issue', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-dangling-note-'));
    const path = join(dir, 'dangling.mid');

    const header = Buffer.alloc(14);
    header.write('MThd', 0, 4, 'ascii');
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(1, 10);
    header.writeUInt16BE(480, 12);
    const events = Buffer.from([
      0x00,
      0x90,
      60,
      100, // note on
      0x60,
      0xff,
      0x2f,
      0x00, // end of track
    ]);
    const trackHeader = Buffer.alloc(8);
    trackHeader.write('MTrk', 0, 4, 'ascii');
    trackHeader.writeUInt32BE(events.length, 4);
    await writeFile(path, Buffer.concat([header, trackHeader, events]));

    const result = await midiAdapter.import(path, { defaultPPQ: 480 });
    assert.equal(result.ok, true);
    const notes = result.ir!.tracks[0].events.filter((event) => event.kind === 'note');
    assert.equal(notes.length, 1);
    assert.equal((notes[0] as { duration: number }).duration, 96);
    assert.ok(result.issues.some((issue) => issue.code === 'MIDI_NOTE_OFF_MISSING'));

    await rm(dir, { recursive: true, force: true });
  });
});
