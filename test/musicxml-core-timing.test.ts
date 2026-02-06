import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { musicxmlAdapter } from '../src/formats/musicxml';

const CORE_TIMING_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Timing</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
      </note>
      <backup>
        <duration>1</duration>
      </backup>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>1</duration>
      </note>
      <forward>
        <duration>1</duration>
      </forward>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
      </note>
    </measure>
  </part>
</score-partwise>
`;

describe('musicxml core timing', () => {
  it('parses chord + backup/forward into expected ticks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-mxml-timing-'));
    const inputPath = join(dir, 'timing.musicxml');
    await writeFile(inputPath, CORE_TIMING_FIXTURE, 'utf8');

    const result = await musicxmlAdapter.import(inputPath, { defaultPPQ: 480 });
    assert.equal(result.ok, true);
    assert.ok(result.ir);

    const notes = result.ir!.tracks[0].events.filter((event) => event.kind === 'note');
    assert.equal(notes.length, 4);

    const byPitch = new Map(notes.map((note) => [note.pitch, note]));
    assert.equal(byPitch.get(60)?.tick, 0); // C4
    assert.equal(byPitch.get(64)?.tick, 0); // E4 (<chord/>)
    assert.equal(byPitch.get(55)?.tick, 0); // G3 (after <backup>)
    assert.equal(byPitch.get(62)?.tick, 960); // D4 (after note + <forward>)

    assert.equal(byPitch.get(60)?.duration, 480);
    assert.equal(byPitch.get(64)?.duration, 480);
    assert.equal(byPitch.get(55)?.duration, 480);
    assert.equal(byPitch.get(62)?.duration, 480);

    await rm(dir, { recursive: true, force: true });
  });
});
