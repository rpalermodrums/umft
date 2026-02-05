import { promises as fs } from 'node:fs';
import { basename, extname, posix } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { atomicWriteFile, ensureDirForFile } from '../../core/io';
import { canonicalizeProject, IRMarker, IRProject, IRTimeSignature } from '../../core/ir';
import { IssueCodes } from '../../core/issues';
import {
  FormatAdapter,
  ImportOptions,
  ImportResult,
  InspectResult,
  ExportOptions,
  ExportResult,
} from '../types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

const MAX_MXL_UNCOMPRESSED = 50 * 1024 * 1024;

export const musicxmlAdapter: FormatAdapter = {
  format: 'musicxml',
  async sniff(input: Buffer, pathHint?: string): Promise<boolean> {
    const hint = pathHint?.toLowerCase() ?? '';
    if (hint.endsWith('.musicxml') || hint.endsWith('.xml') || hint.endsWith('.mxl')) {
      return true;
    }
    const head = input.toString('utf8', 0, 64).toLowerCase();
    return head.includes('<score-partwise');
  },
  async inspect(path: string): Promise<InspectResult> {
    const data = await readMusicXmlText(path);
    const parsed = parseMusicXml(data, path);
    return {
      format: 'musicxml',
      details: {
        parts: parsed.tracks.length,
        notes: parsed.tracks.reduce((sum, track) => sum + countNotes(track.events), 0),
        tempoEvents: parsed.timing.tempoMap.length,
        timeSignatures: parsed.timing.timeSignatures.length,
      },
      warnings: parsed.warnings,
    };
  },
  async import(path: string, opts: ImportOptions): Promise<ImportResult> {
    const data = await readMusicXmlText(path);
    const parsed = parseMusicXml(data, path, opts.defaultPPQ ?? 960);
    const ir: IRProject = canonicalizeProject({
      irVersion: '1.0',
      projectId: `musicxml:${basename(path)}`,
      meta: { sourceFormat: 'musicxml', sourcePath: path },
      timing: parsed.timing,
      tracks: parsed.tracks.map((track) => ({
        id: '',
        name: track.name,
        type: 'notation',
        notation: { partId: track.partId, instrumentName: track.name },
        events: track.events,
      })),
      markers: parsed.markers,
    });

    return { ir, warnings: parsed.warnings, issues: parsed.issues };
  },
  async export(ir: IRProject, path: string, opts: ExportOptions): Promise<ExportResult> {
    void opts;
    const xml = buildMusicXml(ir);
    await ensureDirForFile(path);
    await atomicWriteFile(path, xml);
    return { warnings: [], issues: [] };
  },
  capabilities() {
    return { supportsImport: true, supportsExport: true, supportsInspect: true };
  },
};

interface ParsedPart {
  partId: string;
  name: string;
  events: IRProject['tracks'][number]['events'];
}

interface MusicXmlParseResult {
  timing: IRProject['timing'];
  tracks: ParsedPart[];
  markers: IRMarker[];
  warnings: string[];
  issues: ImportResult['issues'];
}

function parseMusicXml(content: string, path: string, ppq = 960): MusicXmlParseResult {
  const warnings: string[] = [];
  const issues: ImportResult['issues'] = [];
  void path;

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`MusicXML parse failed: ${(error as Error).message}`);
  }

  const score = (parsed as { 'score-partwise'?: unknown })['score-partwise'];
  if (!score) {
    throw new Error('Missing <score-partwise> root');
  }

  const scoreRecord = asRecord(score);
  const partList = normalizeArray(asRecord(scoreRecord['part-list'])['score-part']);
  const partNames = new Map<string, string>();
  for (const part of partList) {
    const partRecord = asRecord(part);
    const partId = partRecord.id as string | undefined;
    const partName = asRecord(partRecord['part-name']);
    const name =
      (partName.text as string | undefined) ?? (partRecord['part-name'] as string) ?? partId;
    if (typeof partId === 'string') {
      partNames.set(partId, String(name));
    }
  }

  const timing: IRProject['timing'] = {
    ppq,
    tempoMap: [],
    timeSignatures: [],
  };
  const markers: IRMarker[] = [];
  const tracks: ParsedPart[] = [];

  const parts = normalizeArray(scoreRecord.part);
  for (const part of parts) {
    const partRecord = asRecord(part);
    const partId = (partRecord.id ?? partRecord['@_id'] ?? partRecord['@id']) as string | undefined;
    const name = partNames.get(partId ?? '') ?? `Part ${partId ?? tracks.length + 1}`;
    const events: ParsedPart['events'] = [];

    let divisions = 1;
    let tick = 0;
    const measures = normalizeArray(partRecord.measure);
    for (const measure of measures) {
      const measureRecord = asRecord(measure);
      const attributes = asRecord(measureRecord.attributes);
      if (attributes.divisions) {
        const parsedDiv = Number(attributes.divisions);
        if (Number.isFinite(parsedDiv) && parsedDiv > 0) {
          divisions = parsedDiv;
        }
      }
      if (attributes.time) {
        const time = asRecord(attributes.time);
        const numerator = Number(time.beats ?? time['beats'] ?? 4);
        const denominator = Number(time['beat-type'] ?? time['beat-type'] ?? 4) as
          | 1
          | 2
          | 4
          | 8
          | 16
          | 32;
        if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
          timing.timeSignatures.push({ id: '', tick, numerator, denominator });
        }
      }

      const directions = normalizeArray(measureRecord.direction);
      for (const direction of directions) {
        const sound = asRecord(asRecord(direction).sound);
        const tempo = Number(sound.tempo ?? sound['@tempo']);
        if (Number.isFinite(tempo) && tempo > 0) {
          timing.tempoMap.push({ id: '', tick, bpm: tempo });
        }
      }

      const notes = normalizeArray(measureRecord.note);
      for (const note of notes) {
        const noteRecord = asRecord(note);
        const duration = Number(noteRecord.duration ?? 0);
        const isRest = Object.prototype.hasOwnProperty.call(noteRecord, 'rest');
        const ticks = Math.max(1, Math.round((duration * ppq) / divisions));
        if (!isRest) {
          const pitch = asRecord(noteRecord.pitch);
          const step = pitch.step as string | undefined;
          const alter = Number(pitch.alter ?? 0);
          const octave = Number(pitch.octave ?? 4);
          const midiPitch = toMidiPitch(step ?? 'C', alter, octave);
          events.push({
            kind: 'note',
            id: '',
            tick,
            duration: ticks,
            pitch: midiPitch,
            velocity: 64,
          });
        }
        tick += ticks;
      }
    }

    tracks.push({ partId: String(partId ?? tracks.length + 1), name, events });
  }

  return { timing, tracks, markers, warnings, issues };
}

async function readMusicXmlText(path: string): Promise<string> {
  if (extname(path).toLowerCase() !== '.mxl') {
    return fs.readFile(path, 'utf8');
  }
  return readCompressedMxl(path);
}

async function readCompressedMxl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, strictFileNames: false },
      (error, zipfile) => {
        if (error || !zipfile) {
          reject(
            new Error(
              `${IssueCodes.MXML_COMPRESSED_MXL_READ_FAILED}: ${error?.message ?? 'Unable to open .mxl'}.`,
            ),
          );
          return;
        }

        const entries = new Map<string, yauzl.Entry>();
        const state = { totalRead: 0, limit: MAX_MXL_UNCOMPRESSED };
        let containerXml: string | undefined;
        let fallbackEntry: yauzl.Entry | undefined;
        let finished = false;

        const finalizeError = (message: string) => {
          if (finished) return;
          finished = true;
          zipfile.close();
          reject(new Error(message));
        };

        const finalizeSuccess = (payload: string) => {
          if (finished) return;
          finished = true;
          zipfile.close();
          resolve(payload);
        };

        const readNextEntry = () => {
          if (finished) return;
          zipfile.readEntry();
        };

        zipfile.on('entry', (entry) => {
          const name = entry.fileName.replace(/\\/g, '/');
          if (isUnsafeZipEntry(name)) {
            finalizeError(
              `${IssueCodes.CORE_ZIP_SLIP_BLOCKED}: Blocked unsafe zip path: ${entry.fileName}.`,
            );
            return;
          }
          if (name.endsWith('/')) {
            readNextEntry();
            return;
          }

          entries.set(name, entry);
          if (
            !fallbackEntry &&
            name.toLowerCase().endsWith('.xml') &&
            !name.toLowerCase().startsWith('meta-inf/')
          ) {
            fallbackEntry = entry;
          }

          if (name.toLowerCase() === 'meta-inf/container.xml') {
            void readZipEntryText(zipfile, entry, state)
              .then((xml) => {
                containerXml = xml;
                readNextEntry();
              })
              .catch((err) => {
                finalizeError(err.message);
              });
            return;
          }

          readNextEntry();
        });

        zipfile.on('end', () => {
          if (finished) return;
          let targetEntry: yauzl.Entry | undefined;
          if (containerXml) {
            const rootPath = extractContainerRootPath(containerXml);
            if (rootPath) {
              const normalized = rootPath.replace(/\\/g, '/');
              if (isUnsafeZipEntry(normalized)) {
                finalizeError(
                  `${IssueCodes.CORE_ZIP_SLIP_BLOCKED}: Blocked unsafe zip path: ${rootPath}.`,
                );
                return;
              }
              targetEntry = entries.get(normalized);
            }
          }

          if (!targetEntry) {
            targetEntry = fallbackEntry;
          }

          if (!targetEntry) {
            finalizeError(
              `${IssueCodes.MXML_COMPRESSED_MXL_READ_FAILED}: No MusicXML payload found in ${path}.`,
            );
            return;
          }

          void readZipEntryText(zipfile, targetEntry, state)
            .then((xml) => finalizeSuccess(xml))
            .catch((err) => finalizeError(err.message));
        });

        zipfile.on('error', (err) => {
          const message = (err as Error).message;
          if (message.includes('invalid relative path')) {
            const pathMatch = message.split(':').slice(1).join(':').trim();
            finalizeError(
              `${IssueCodes.CORE_ZIP_SLIP_BLOCKED}: Blocked unsafe zip path: ${pathMatch || message}.`,
            );
            return;
          }
          finalizeError(`${IssueCodes.MXML_COMPRESSED_MXL_READ_FAILED}: ${message}.`);
        });

        readNextEntry();
      },
    );
  });
}

function readZipEntryText(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
  state: { totalRead: number; limit: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const projected = state.totalRead + entry.uncompressedSize;
    if (projected > state.limit) {
      reject(
        new Error(
          `${IssueCodes.CORE_DECOMPRESSION_LIMIT_EXCEEDED}: Decompression limit exceeded while reading ${entry.fileName}.`,
        ),
      );
      return;
    }

    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(
          new Error(
            `${IssueCodes.MXML_COMPRESSED_MXL_READ_FAILED}: ${err?.message ?? 'Unable to read entry'}.`,
          ),
        );
        return;
      }

      const chunks: Buffer[] = [];
      let readBytes = 0;
      stream.on('data', (chunk) => {
        readBytes += chunk.length;
        if (state.totalRead + readBytes > state.limit) {
          stream.destroy(
            new Error(
              `${IssueCodes.CORE_DECOMPRESSION_LIMIT_EXCEEDED}: Decompression limit exceeded while reading ${entry.fileName}.`,
            ),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      stream.on('error', (streamErr) => {
        reject(
          new Error(
            `${IssueCodes.MXML_COMPRESSED_MXL_READ_FAILED}: ${(streamErr as Error).message}.`,
          ),
        );
      });
      stream.on('end', () => {
        state.totalRead += readBytes;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  });
}

function extractContainerRootPath(containerXml: string): string | undefined {
  try {
    const parsed = parser.parse(containerXml) as Record<string, unknown>;
    const container = asRecord(
      (parsed as { container?: unknown })['container'] ?? parsed['container:container'],
    );
    const rootfiles = asRecord(container.rootfiles ?? container['rootfiles']);
    const rootfile = normalizeArray(rootfiles.rootfile ?? rootfiles['rootfile'])[0];
    const record = asRecord(rootfile);
    const fullPath =
      record['full-path'] ??
      record['fullpath'] ??
      record['full_path'] ??
      record['@_full-path'] ??
      record['@full-path'];
    if (typeof fullPath === 'string' && fullPath.length > 0) {
      return fullPath;
    }
  } catch {
    // fallback to regex below
  }

  const match = containerXml.match(/full-path="([^"]+)"/i);
  return match?.[1];
}

function isUnsafeZipEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized)) return true;
  if (normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../')) {
    return true;
  }
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '..')) {
    return true;
  }
  const cleaned = posix.normalize(normalized);
  return cleaned.startsWith('..') || posix.isAbsolute(cleaned);
}

function buildMusicXml(ir: IRProject): string {
  const defaultTimeSig: IRTimeSignature = { id: '', tick: 0, numerator: 4, denominator: 4 };
  const timeSignatures = ir.timing.timeSignatures.length
    ? ir.timing.timeSignatures
    : [defaultTimeSig];

  const measures = buildMeasureMap(timeSignatures, ir.timing.ppq, maxTick(ir));

  const partList = ir.tracks.map((track, index) => ({
    id: track.notation?.partId ?? `P${index + 1}`,
    'part-name': { text: track.name },
  }));

  const parts = ir.tracks.map((track, index) => {
    const partId = track.notation?.partId ?? `P${index + 1}`;
    const notes = track.events.filter((event) => event.kind === 'note');
    const measuresXml = buildPartMeasures(notes, measures, ir.timing.ppq);
    return { id: partId, measure: measuresXml };
  });

  const score = {
    'score-partwise': {
      version: '4.0',
      'part-list': {
        'score-part': partList,
      },
      part: parts,
    },
  };

  return builder.build(score);
}

function buildMeasureMap(timeSigs: IRTimeSignature[], ppq: number, endTick: number) {
  const measures: Array<{ index: number; start: number; end: number; timeSig: IRTimeSignature }> =
    [];
  const sorted = [...timeSigs].sort((a, b) => a.tick - b.tick);
  if (!sorted.length) {
    sorted.push({ id: '', tick: 0, numerator: 4, denominator: 4 });
  }

  let currentTick = 0;
  let measureIndex = 1;
  let tsIndex = 0;
  while (currentTick < endTick + ppq) {
    while (tsIndex + 1 < sorted.length && sorted[tsIndex + 1].tick <= currentTick) {
      tsIndex += 1;
    }
    const ts = sorted[tsIndex];
    const ticksPerBeat = ppq * (4 / ts.denominator);
    const measureLen = ticksPerBeat * ts.numerator;
    const start = currentTick;
    const end = currentTick + measureLen;
    measures.push({ index: measureIndex, start, end, timeSig: ts });
    currentTick = end;
    measureIndex += 1;
  }
  return measures;
}

function buildPartMeasures(
  notes: Array<{ tick: number; duration: number; pitch: number }>,
  measures: Array<{ index: number; start: number; end: number; timeSig: IRTimeSignature }>,
  ppq: number,
) {
  const divisions = ppq;
  const segments = splitNotesAcrossMeasures(notes, measures);

  return measures.map((measure, idx) => {
    const noteList = segments.get(measure.index) ?? [];
    noteList.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);

    const xmlNotes: Array<Record<string, unknown>> = [];
    let cursor = 0;
    const measureLen = measure.end - measure.start;
    for (const note of noteList) {
      if (note.onset > cursor) {
        const restDur = note.onset - cursor;
        xmlNotes.push(makeRest(restDur, divisions, ppq));
        cursor = note.onset;
      }
      xmlNotes.push(makeNote(note.pitch, note.duration, divisions, ppq, note.tie));
      cursor += note.duration;
    }

    if (cursor < measureLen) {
      xmlNotes.push(makeRest(measureLen - cursor, divisions, ppq));
    }

    const attrs: Array<Record<string, unknown>> = [];
    if (idx === 0 || measure.timeSig.tick === measure.start) {
      attrs.push({ divisions });
      attrs.push({
        time: { beats: measure.timeSig.numerator, 'beat-type': measure.timeSig.denominator },
      });
    }

    const attributes = attrs.length ? { attributes: attrs } : {};

    return { number: measure.index, ...attributes, note: xmlNotes };
  });
}

function makeRest(durationTicks: number, divisions: number, ppq: number) {
  const duration = Math.max(1, Math.round((durationTicks * divisions) / ppq));
  const typeInfo = noteType(durationTicks, ppq);
  return {
    rest: {},
    duration,
    type: typeInfo.type,
    ...(typeInfo.timeModification ? { 'time-modification': typeInfo.timeModification } : {}),
  };
}

function makeNote(
  pitchValue: number,
  durationTicks: number,
  divisions: number,
  ppq: number,
  tie?: 'start' | 'stop' | 'continue',
) {
  const { step, alter, octave } = fromMidiPitch(pitchValue);
  const pitch: Record<string, unknown> = { step, octave };
  if (alter !== 0) {
    pitch.alter = alter;
  }
  const duration = Math.max(1, Math.round((durationTicks * divisions) / ppq));
  const typeInfo = noteType(durationTicks, ppq);
  const tieElements = tie ? tieToElements(tie) : undefined;
  return {
    pitch,
    duration,
    type: typeInfo.type,
    ...(typeInfo.timeModification ? { 'time-modification': typeInfo.timeModification } : {}),
    ...(tieElements ? { tie: tieElements, notations: { tied: tieElements } } : {}),
  };
}

function noteType(
  durationTicks: number,
  ppq: number,
): { type: string; timeModification?: { 'actual-notes': number; 'normal-notes': number } } {
  const baseTypes: Array<{ type: string; ticks: number }> = [
    { type: 'whole', ticks: ppq * 4 },
    { type: 'half', ticks: ppq * 2 },
    { type: 'quarter', ticks: ppq },
    { type: 'eighth', ticks: ppq / 2 },
    { type: '16th', ticks: ppq / 4 },
    { type: '32nd', ticks: ppq / 8 },
  ];

  for (const base of baseTypes) {
    if (durationTicks * 3 === base.ticks * 2) {
      return {
        type: base.type,
        timeModification: { 'actual-notes': 3, 'normal-notes': 2 },
      };
    }
  }

  const ratio = durationTicks / ppq;
  if (ratio >= 4) return { type: 'whole' };
  if (ratio >= 2) return { type: 'half' };
  if (ratio >= 1) return { type: 'quarter' };
  if (ratio >= 0.5) return { type: 'eighth' };
  if (ratio >= 0.25) return { type: '16th' };
  return { type: '32nd' };
}

function toMidiPitch(step: string, alter: number, octave: number): number {
  const map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const semitone = map[step?.toUpperCase() ?? 'C'] ?? 0;
  return (octave + 1) * 12 + semitone + alter;
}

function fromMidiPitch(pitch: number) {
  const steps = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const octave = Math.floor(pitch / 12) - 1;
  const index = pitch % 12;
  return { step: steps[index], alter: alters[index], octave };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function splitNotesAcrossMeasures(
  notes: Array<{ tick: number; duration: number; pitch: number }>,
  measures: Array<{ index: number; start: number; end: number }>,
): Map<
  number,
  Array<{ onset: number; duration: number; pitch: number; tie?: 'start' | 'stop' | 'continue' }>
> {
  const result = new Map<
    number,
    Array<{ onset: number; duration: number; pitch: number; tie?: 'start' | 'stop' | 'continue' }>
  >();
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  let measureIndex = 0;

  for (const note of sorted) {
    while (measureIndex + 1 < measures.length && note.tick >= measures[measureIndex].end) {
      measureIndex += 1;
    }
    let start = note.tick;
    const end = note.tick + note.duration;
    let currentIndex = measureIndex;

    while (start < end && currentIndex < measures.length) {
      const measure = measures[currentIndex];
      const segEnd = Math.min(end, measure.end);
      const duration = segEnd - start;
      const onset = start - measure.start;

      const isFirst = start === note.tick;
      const isLast = segEnd === end;
      let tie: 'start' | 'stop' | 'continue' | undefined;
      if (!isFirst || !isLast) {
        if (isFirst && !isLast) {
          tie = 'start';
        } else if (!isFirst && !isLast) {
          tie = 'continue';
        } else {
          tie = 'stop';
        }
      }

      const list = result.get(measure.index) ?? [];
      list.push({ onset, duration, pitch: note.pitch, tie });
      result.set(measure.index, list);

      start = segEnd;
      currentIndex += 1;
    }
  }

  return result;
}

function tieToElements(tie: 'start' | 'stop' | 'continue') {
  if (tie === 'start') {
    return [{ type: 'start' }];
  }
  if (tie === 'stop') {
    return [{ type: 'stop' }];
  }
  return [{ type: 'start' }, { type: 'stop' }];
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function countNotes(events: ParsedPart['events']): number {
  return events.filter((event) => event.kind === 'note').length;
}

function maxTick(ir: IRProject): number {
  let max = 0;
  for (const track of ir.tracks) {
    for (const event of track.events) {
      if (event.kind === 'note') {
        max = Math.max(max, event.tick + event.duration);
      }
    }
  }
  return max;
}
