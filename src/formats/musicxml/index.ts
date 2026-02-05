import { promises as fs } from 'node:fs';
import { basename, extname, posix } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import yauzl from 'yauzl';
import { DEFAULT_CONFIG } from '../../core/config/defaults';
import { UMFTConfig } from '../../core/config/types';
import { Issue, IssueCodes } from '../../core/issues';
import { atomicWriteFile, ensureDirForFile } from '../../core/io';
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
    const config = opts.config ?? DEFAULT_CONFIG;
    const result = buildMusicXml(ir, config);
    await ensureDirForFile(path);
    await atomicWriteFile(path, result.xml);
    return { warnings: result.warnings, issues: result.issues };
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

function buildMusicXml(
  ir: IRProject,
  config: UMFTConfig,
): { xml: string; issues: Issue[]; warnings: string[] } {
  const issues: Issue[] = [];
  const warnings: string[] = [];
  const counters: BuildCounters = {
    quantized: 0,
    quantizeConflicts: 0,
    splitAcrossMeasures: 0,
    unrepresentableTied: 0,
    durationRounded: 0,
  };

  const defaultTimeSig: IRTimeSignature = { id: '', tick: 0, numerator: 4, denominator: 4 };
  const timeSignatures = ir.timing.timeSignatures.length
    ? ir.timing.timeSignatures
    : [defaultTimeSig];
  if (!ir.timing.timeSignatures.length) {
    issues.push({
      code: IssueCodes.CORE_TIME_SIGNATURE_DEFAULTED,
      severity: 'WARN',
      category: 'TEMPO',
      message: 'No time signatures detected; defaulted to 4/4 from start.',
    });
  }

  const measures = buildMeasureMap(timeSignatures, ir.timing.ppq, maxTick(ir));
  const musicxmlConfig = config.musicxml ?? DEFAULT_CONFIG.musicxml;
  const divisions = chooseDivisions(ir.timing.ppq, musicxmlConfig, issues);
  const reps = representableDurations(divisions, musicxmlConfig.inferTuplets ?? false);

  const partList = ir.tracks.map((track, index) => ({
    id: track.notation?.partId ?? `P${index + 1}`,
    'part-name': { text: track.name },
  }));

  const tempoByMeasure = buildTempoByMeasure(
    measures,
    ir.timing.tempoMap,
    ir.timing.ppq,
    musicxmlConfig.tempoRound ?? 0.01,
  );

  const parts = ir.tracks.map((track, index) => {
    const partId = track.notation?.partId ?? `P${index + 1}`;
    const notes = track.events.filter((event) => event.kind === 'note');
    const measuresXml = buildPartMeasures(
      notes,
      measures,
      ir.timing.ppq,
      divisions,
      musicxmlConfig,
      reps,
      counters,
      index === 0 ? tempoByMeasure : undefined,
    );
    return { id: partId, measure: measuresXml };
  });

  if (counters.quantized > 0) {
    issues.push({
      code: IssueCodes.MXML_QUANTIZATION_APPLIED,
      severity: 'WARN',
      category: 'TIMING',
      message: `Quantization applied to ${counters.quantized} notes (grid ${musicxmlConfig.quantize}).`,
      count: counters.quantized,
    });
  }
  if (counters.quantizeConflicts > 0) {
    issues.push({
      code: IssueCodes.MXML_QUANTIZATION_CONFLICT_RESOLVED,
      severity: 'WARN',
      category: 'TIMING',
      message: `Quantization conflicts resolved (overlaps/zero durations): ${counters.quantizeConflicts} notes.`,
      count: counters.quantizeConflicts,
    });
  }
  if (counters.splitAcrossMeasures > 0) {
    issues.push({
      code: IssueCodes.MXML_NOTE_SPLIT_ACROSS_MEASURES,
      severity: 'INFO',
      category: 'NOTATION',
      message: `Notes split across measures with ties: ${counters.splitAcrossMeasures} notes.`,
      count: counters.splitAcrossMeasures,
    });
  }
  if (counters.unrepresentableTied > 0) {
    issues.push({
      code: IssueCodes.MXML_UNREPRESENTABLE_DURATION_TIED,
      severity: 'WARN',
      category: 'NOTATION',
      message: `Unrepresentable durations expressed with ties: ${counters.unrepresentableTied} notes.`,
      count: counters.unrepresentableTied,
    });
  }
  if (counters.durationRounded > 0) {
    issues.push({
      code: IssueCodes.MXML_DURATION_ROUNDED,
      severity: 'WARN',
      category: 'TIMING',
      message: `Duration rounded during import/export: ${counters.durationRounded} notes affected.`,
      count: counters.durationRounded,
    });
  }

  const score = {
    'score-partwise': {
      version: '4.0',
      'part-list': {
        'score-part': partList,
      },
      part: parts,
    },
  };

  return { xml: builder.build(score), issues, warnings };
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
  divisions: number,
  config: UMFTConfig['musicxml'],
  reps: DurationComponent[],
  counters: BuildCounters,
  tempoByMeasure?: Map<number, number[]>,
) {
  const quantizeStep = getQuantizeStep(config, ppq);
  const quantizeEnabled = config.quantize !== 'off' && quantizeStep > 0;
  const quantizedNotes = notes.map((note) => {
    let start = note.tick;
    let end = note.tick + note.duration;
    if (quantizeEnabled) {
      const startQ = quantizeTick(start, quantizeStep);
      const endQ = quantizeTick(end, quantizeStep);
      if (startQ !== start || endQ !== end) {
        counters.quantized += 1;
      }
      start = startQ;
      end = endQ;
      if (end <= start) {
        end = start + Math.max(1, quantizeStep);
        counters.quantizeConflicts += 1;
      }
    }
    return { start, end, pitch: note.pitch };
  });

  const segments = splitNotesAcrossMeasures(quantizedNotes, measures, config, counters);

  return measures.map((measure, idx) => {
    const noteList = segments.get(measure.index) ?? [];
    noteList.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);

    const xmlNotes: Array<Record<string, unknown>> = [];
    const measureLenUnits = ticksToDurationUnits(measure.end - measure.start, ppq, divisions);
    let cursorUnits = 0;

    for (const note of noteList) {
      const onsetUnits = ticksToDurationUnits(note.onset, ppq, divisions);
      if (onsetUnits > cursorUnits) {
        const restUnits = onsetUnits - cursorUnits;
        const restComponents = spellDurationWithTies(restUnits, reps);
        for (const component of restComponents) {
          xmlNotes.push(makeRest(component));
          cursorUnits += component.units;
        }
      }

      const durationUnits = ticksToDurationUnits(note.duration, ppq, divisions, counters, true);
      const components = spellDurationWithTies(durationUnits, reps);
      if (components.length > 1) {
        counters.unrepresentableTied += 1;
      }
      for (let i = 0; i < components.length; i += 1) {
        const component = components[i];
        const tie = mergeTie(note.tie, i, components.length);
        xmlNotes.push(makeNote(note.pitch, component, tie));
        cursorUnits += component.units;
      }
    }

    if (cursorUnits < measureLenUnits) {
      const tailUnits = measureLenUnits - cursorUnits;
      const restComponents = spellDurationWithTies(tailUnits, reps);
      for (const component of restComponents) {
        xmlNotes.push(makeRest(component));
      }
    }

    const attributes: Record<string, unknown> = {};
    if (idx === 0 || measure.timeSig.tick === measure.start) {
      attributes.divisions = divisions;
      attributes.time = {
        beats: measure.timeSig.numerator,
        'beat-type': measure.timeSig.denominator,
      };
    }

    const directions = tempoByMeasure?.get(measure.index);
    const direction = directions?.length
      ? directions.map((tempo) => ({ sound: { tempo } }))
      : undefined;

    return {
      number: measure.index,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      ...(direction ? { direction } : {}),
      note: xmlNotes,
    };
  });
}

interface BuildCounters {
  quantized: number;
  quantizeConflicts: number;
  splitAcrossMeasures: number;
  unrepresentableTied: number;
  durationRounded: number;
}

interface DurationComponent {
  type: string;
  dots: number;
  units: number;
  timeModification?: { 'actual-notes': number; 'normal-notes': number };
}

function makeRest(component: DurationComponent) {
  return {
    rest: {},
    duration: component.units,
    type: component.type,
    ...(component.dots > 0 ? { dot: new Array(component.dots).fill({}) } : {}),
    ...(component.timeModification ? { 'time-modification': component.timeModification } : {}),
  };
}

function makeNote(
  pitchValue: number,
  component: DurationComponent,
  tie?: 'start' | 'stop' | 'continue',
) {
  const { step, alter, octave } = fromMidiPitch(pitchValue);
  const pitch: Record<string, unknown> = { step, octave };
  if (alter !== 0) {
    pitch.alter = alter;
  }
  const tieElements = tie ? tieToElements(tie) : undefined;
  return {
    pitch,
    duration: component.units,
    type: component.type,
    ...(component.dots > 0 ? { dot: new Array(component.dots).fill({}) } : {}),
    ...(component.timeModification ? { 'time-modification': component.timeModification } : {}),
    ...(tieElements ? { tie: tieElements, notations: { tied: tieElements } } : {}),
  };
}

function representableDurations(divisions: number, inferTuplets: boolean): DurationComponent[] {
  const typeOrder = [
    'whole',
    'half',
    'quarter',
    'eighth',
    '16th',
    '32nd',
    '64th',
    '128th',
    '256th',
  ];
  const components: DurationComponent[] = [];
  let units = divisions * 4;

  for (const type of typeOrder) {
    if (Number.isInteger(units) && units >= 1) {
      components.push({ type, dots: 0, units });
      const dotted = units * 1.5;
      if (Number.isInteger(dotted)) {
        components.push({ type, dots: 1, units: dotted });
      }
      const doubleDotted = units * 1.75;
      if (Number.isInteger(doubleDotted)) {
        components.push({ type, dots: 2, units: doubleDotted });
      }
      if (inferTuplets) {
        const triplet = (units * 2) / 3;
        if (Number.isInteger(triplet)) {
          components.push({
            type,
            dots: 0,
            units: triplet,
            timeModification: { 'actual-notes': 3, 'normal-notes': 2 },
          });
        }
      }
    }
    units /= 2;
  }

  const unique = new Map<string, DurationComponent>();
  for (const component of components) {
    const key = `${component.type}|${component.dots}|${component.units}|${
      component.timeModification ? 't' : 'n'
    }`;
    if (!unique.has(key)) {
      unique.set(key, component);
    }
  }

  return [...unique.values()].sort((a, b) => b.units - a.units || a.dots - b.dots);
}

function spellDurationWithTies(
  durationUnits: number,
  reps: DurationComponent[],
): DurationComponent[] {
  let remaining = durationUnits;
  const components: DurationComponent[] = [];
  let safety = 0;

  while (remaining > 0 && safety < 64) {
    const match = reps.find((rep) => rep.units <= remaining);
    if (!match) {
      break;
    }
    components.push(match);
    remaining -= match.units;
    safety += 1;
  }

  if (remaining > 0) {
    const fallback = reps[reps.length - 1] ?? { type: 'quarter', dots: 0, units: remaining };
    components.push({ ...fallback, units: remaining, dots: 0, timeModification: undefined });
  }

  return components;
}

function buildTempoByMeasure(
  measures: Array<{ index: number; start: number; end: number }>,
  tempoMap: IRProject['timing']['tempoMap'],
  ppq: number,
  tempoRound: number,
): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (!tempoMap.length) return result;

  const sortedTempo = [...tempoMap].sort((a, b) => a.tick - b.tick);
  let measureIndex = 0;
  for (const tempo of sortedTempo) {
    while (measureIndex + 1 < measures.length && tempo.tick >= measures[measureIndex].end) {
      measureIndex += 1;
    }
    const measure = measures[measureIndex];
    if (!measure) continue;
    const bpm = roundTo(tempo.bpm, tempoRound);
    const list = result.get(measure.index) ?? [];
    list.push(bpm);
    result.set(measure.index, list);
  }

  return result;
}

function roundTo(value: number, precision: number): number {
  if (!Number.isFinite(precision) || precision <= 0) return value;
  const factor = 1 / precision;
  return Math.round(value * factor) / factor;
}

function getQuantizeStep(config: UMFTConfig['musicxml'], ppq: number): number {
  if (config.quantize === 'off') return 0;
  const steps = resolveQuantizeFractions(config).map((fraction) => fractionToTicks(fraction, ppq));
  if (!steps.length) {
    return Math.round(ppq / 4);
  }
  return Math.max(1, Math.min(...steps));
}

function resolveQuantizeFractions(config: UMFTConfig['musicxml']): Fraction[] {
  const fractions: Fraction[] = [];
  if (config.quantize === 'custom') {
    for (const entry of config.quantizeCustom ?? []) {
      const parsed = parseFraction(entry);
      if (parsed) {
        fractions.push(parsed);
      }
    }
  } else {
    const parsed = parseFraction(config.quantize);
    if (parsed) {
      fractions.push(parsed);
    }
  }
  return fractions;
}

function chooseDivisions(ppq: number, config: UMFTConfig['musicxml'], issues: Issue[]): number {
  const maxDivisions = 480;
  let divisions = 24;

  if (config.quantize !== 'off') {
    const fractions = resolveQuantizeFractions(config);
    const denominators = fractions.map((fraction) => fraction.denominator);
    const maxDen = denominators.length ? Math.max(...denominators) : 16;
    if (maxDen % 4 === 0) {
      divisions = maxDen / 4;
    } else {
      divisions = maxDen;
    }
  } else {
    const candidates = [96, 48, 24];
    const candidate = candidates.find((entry) => entry <= maxDivisions);
    divisions = candidate ?? Math.min(24, maxDivisions);
  }

  if (config.inferTuplets && divisions % 3 !== 0) {
    divisions *= 3;
  }

  if (divisions > maxDivisions) {
    issues.push({
      code: IssueCodes.MXML_DIVISIONS_CLAMPED,
      severity: 'WARN',
      category: 'NOTATION',
      message: `Divisions clamped from ${divisions} to ${maxDivisions} to limit complexity.`,
    });
    divisions = maxDivisions;
  }

  return divisions;
}

interface Fraction {
  numerator: number;
  denominator: number;
}

function parseFraction(value: string): Fraction | null {
  const match = value.trim().match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return { numerator, denominator };
}

function fractionToTicks(fraction: Fraction, ppq: number): number {
  const quarters = (4 * fraction.numerator) / fraction.denominator;
  const ticks = ppq * quarters;
  return Math.max(1, Math.round(ticks));
}

function quantizeTick(tick: number, step: number): number {
  if (step <= 0) return tick;
  return Math.round(tick / step) * step;
}

function ticksToDurationUnits(
  durationTicks: number,
  ppq: number,
  divisions: number,
  counters?: BuildCounters,
  trackRounding = false,
): number {
  if (durationTicks <= 0) return 0;
  const raw = (durationTicks * divisions) / ppq;
  const rounded = Math.round(raw);
  if (trackRounding && counters && Math.abs(raw - rounded) > 1e-6) {
    counters.durationRounded += 1;
  }
  return Math.max(1, rounded);
}

function mergeTie(
  outerTie: 'start' | 'stop' | 'continue' | undefined,
  index: number,
  count: number,
): 'start' | 'stop' | 'continue' | undefined {
  if (count <= 1) return outerTie;
  if (index === 0) {
    return outerTie === 'stop' || outerTie === 'continue' ? 'continue' : 'start';
  }
  if (index === count - 1) {
    return outerTie === 'start' || outerTie === 'continue' ? 'continue' : 'stop';
  }
  return 'continue';
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
  notes: Array<{ start: number; end: number; pitch: number }>,
  measures: Array<{ index: number; start: number; end: number }>,
  config: UMFTConfig['musicxml'],
  counters: BuildCounters,
): Map<
  number,
  Array<{ onset: number; duration: number; pitch: number; tie?: 'start' | 'stop' | 'continue' }>
> {
  const result = new Map<
    number,
    Array<{ onset: number; duration: number; pitch: number; tie?: 'start' | 'stop' | 'continue' }>
  >();
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  let measureIndex = 0;

  for (const note of sorted) {
    while (measureIndex + 1 < measures.length && note.start >= measures[measureIndex].end) {
      measureIndex += 1;
    }
    const start = note.start;
    const end = note.end;

    if (!config.splitAcrossMeasures) {
      const measure = measures[measureIndex];
      if (!measure) {
        continue;
      }
      const list = result.get(measure.index) ?? [];
      list.push({ onset: start - measure.start, duration: end - start, pitch: note.pitch });
      result.set(measure.index, list);
      continue;
    }

    let currentStart = start;
    let currentIndex = measureIndex;
    let split = false;

    while (currentStart < end && currentIndex < measures.length) {
      const measure = measures[currentIndex];
      const segEnd = Math.min(end, measure.end);
      const duration = segEnd - currentStart;
      const onset = currentStart - measure.start;

      const isFirst = currentStart === start;
      const isLast = segEnd === end;
      let tie: 'start' | 'stop' | 'continue' | undefined;
      if (!isFirst || !isLast) {
        split = true;
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

      currentStart = segEnd;
      currentIndex += 1;
    }

    if (split) {
      counters.splitAcrossMeasures += 1;
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
