import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { canonicalizeProject, IRMarker, IRProject, IRTimeSignature } from '../../core/ir';
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
    const data = await fs.readFile(path, 'utf8');
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
    if (extname(path).toLowerCase() === '.mxl') {
      throw new Error('Compressed MusicXML (.mxl) not yet supported');
    }
    const data = await fs.readFile(path, 'utf8');
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
    await fs.writeFile(path, xml, 'utf8');
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
    const name = partNames.get(partId) ?? `Part ${partId ?? tracks.length + 1}`;
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
        const isRest = Boolean(noteRecord.rest);
        const ticks = Math.max(1, Math.round((duration * ppq) / divisions));
        if (!isRest) {
          const pitch = asRecord(noteRecord.pitch);
          const step = pitch.step as string | undefined;
          const alter = Number(pitch.alter ?? 0);
          const octave = Number(pitch.octave ?? 4);
          const midiPitch = toMidiPitch(step, alter, octave);
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
  const grouped = new Map<number, Array<{ tick: number; duration: number; pitch: number }>>();
  for (const note of notes) {
    const measure = measures.find((m) => note.tick >= m.start && note.tick < m.end) ?? measures[0];
    const list = grouped.get(measure.index) ?? [];
    list.push(note);
    grouped.set(measure.index, list);
  }

  return measures.map((measure, idx) => {
    const noteList = grouped.get(measure.index) ?? [];
    noteList.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

    const xmlNotes: Array<Record<string, unknown>> = [];
    let cursor = measure.start;
    for (const note of noteList) {
      if (note.tick > cursor) {
        const restDur = note.tick - cursor;
        xmlNotes.push(makeRest(restDur, divisions, ppq));
        cursor = note.tick;
      }
      const duration = Math.max(1, Math.round((note.duration * divisions) / ppq));
      xmlNotes.push(makeNote(note.pitch, duration, divisions, ppq));
      cursor += note.duration;
    }

    if (cursor < measure.end) {
      xmlNotes.push(makeRest(measure.end - cursor, divisions, ppq));
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
  return {
    rest: {},
    duration,
    type: noteType(durationTicks, ppq),
  };
}

function makeNote(pitchValue: number, duration: number, divisions: number, ppq: number) {
  const { step, alter, octave } = fromMidiPitch(pitchValue);
  const pitch: Record<string, unknown> = { step, octave };
  if (alter !== 0) {
    pitch.alter = alter;
  }
  return {
    pitch,
    duration,
    type: noteType((duration * ppq) / divisions, ppq),
  };
}

function noteType(durationTicks: number, ppq: number): string {
  const ratio = durationTicks / ppq;
  if (ratio >= 4) return 'whole';
  if (ratio >= 2) return 'half';
  if (ratio >= 1) return 'quarter';
  if (ratio >= 0.5) return 'eighth';
  if (ratio >= 0.25) return '16th';
  return '32nd';
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
