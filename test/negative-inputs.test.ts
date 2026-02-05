import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import yazl from 'yazl';
import { midiAdapter } from '../src/formats/midi';
import { musicxmlAdapter } from '../src/formats/musicxml';

describe('negative inputs', () => {
  it('rejects malformed midi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-bad-midi-'));
    const path = join(dir, 'bad.mid');
    const header = Buffer.alloc(14);
    header.write('MThd', 0, 4, 'ascii');
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(1, 8);
    header.writeUInt16BE(1, 10);
    header.writeUInt16BE(480, 12);
    await writeFile(path, header);

    await assert.rejects(async () => {
      await midiAdapter.import(path, { defaultPPQ: 480 });
    });

    await rm(dir, { recursive: true, force: true });
  });

  it('rejects malformed musicxml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-bad-xml-'));
    const path = join(dir, 'bad.musicxml');
    await writeFile(path, '<score-partwise><part');

    await assert.rejects(async () => {
      await musicxmlAdapter.import(path, { defaultPPQ: 480 });
    });

    await rm(dir, { recursive: true, force: true });
  });

  it('rejects mxl over decompression limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umft-bad-mxl-'));
    const path = join(dir, 'big.mxl');

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>\n  </rootfiles>\n</container>`;

    const zipfile = new yazl.ZipFile();
    zipfile.addBuffer(Buffer.from(containerXml, 'utf8'), 'META-INF/container.xml');
    const payload = Buffer.alloc(50 * 1024 * 1024 + 1024, 0x61);
    zipfile.addBuffer(payload, 'score.xml');
    zipfile.end();

    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(path);
      zipfile.outputStream.pipe(out);
      out.on('close', () => resolve());
      out.on('error', reject);
      zipfile.outputStream.on('error', reject);
    });

    await assert.rejects(async () => {
      await musicxmlAdapter.import(path, { defaultPPQ: 480 });
    }, /CORE_DECOMPRESSION_LIMIT_EXCEEDED/);

    await rm(dir, { recursive: true, force: true });
  });
});
