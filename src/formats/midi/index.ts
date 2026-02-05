import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { Issue, IssueCodes } from '../../core/issues';
import { atomicWriteFile, ensureDirForFile } from '../../core/io';
import { canonicalizeProject, IRMarker, IRProject } from '../../core/ir';
import {
  FormatAdapter,
  ImportOptions,
  ImportResult,
  InspectResult,
  ExportOptions,
  ExportResult,
} from '../types';

const MIDI_HEADER = Buffer.from('MThd');
const MIDI_TRACK = Buffer.from('MTrk');

class MidiParseError extends Error {
  issue: Issue;
  constructor(issue: Issue) {
    super(issue.message);
    this.issue = issue;
    this.name = 'MidiParseError';
  }
}

interface ParsedTrack {
  name: string;
  channel?: number;
  program?: number;
  events: IRProject['tracks'][number]['events'];
}

export const midiAdapter: FormatAdapter = {
  format: 'midi',
  async sniff(input: Buffer, pathHint?: string): Promise<boolean> {
    if (input.length >= 4 && input.slice(0, 4).equals(MIDI_HEADER)) {
      return true;
    }
    if (pathHint) {
      return pathHint.toLowerCase().endsWith('.mid') || pathHint.toLowerCase().endsWith('.midi');
    }
    return false;
  },
  async inspect(path: string): Promise<InspectResult> {
    const data = await fs.readFile(path);
    const parsed = parseMidi(data, {});
    return {
      format: 'midi',
      details: {
        tracks: parsed.tracks.length,
        notes: parsed.tracks.reduce((sum, track) => sum + countNotes(track.events), 0),
        tempoEvents: parsed.timing.tempoMap.length,
        timeSignatures: parsed.timing.timeSignatures.length,
      },
      warnings: parsed.warnings,
    };
  },
  async import(path: string, opts: ImportOptions): Promise<ImportResult> {
    const data = await fs.readFile(path);
    try {
      const parsed = parseMidi(data, opts);
      const ir: IRProject = canonicalizeProject({
        irVersion: '1.0',
        projectId: `midi:${basename(path)}`,
        meta: { sourceFormat: 'midi', sourcePath: path },
        timing: parsed.timing,
        tracks: parsed.tracks.map((track) => ({
          id: '',
          name: track.name,
          type: 'midi',
          midi: { channel: track.channel, program: track.program },
          events: track.events,
        })),
        markers: parsed.markers,
      });

      return {
        ok: true,
        ir,
        warnings: parsed.warnings,
        issues: parsed.issues,
      };
    } catch (error) {
      const issue: Issue =
        error instanceof MidiParseError
          ? error.issue
          : {
              code: IssueCodes.MIDI_UNSUPPORTED_HEADER,
              severity: 'ERROR',
              category: 'STRUCTURE',
              message: `Unsupported or invalid MIDI header: ${(error as Error).message}.`,
            };
      return { ok: false, warnings: [], issues: [], fatalError: issue };
    }
  },
  async export(ir: IRProject, path: string, opts: ExportOptions): Promise<ExportResult> {
    const data = writeMidi(ir);
    if (!opts.overwrite) {
      try {
        await fs.access(path);
        return {
          ok: false,
          warnings: [],
          issues: [],
          fatalError: {
            code: IssueCodes.CORE_OUTPUT_PATH_EXISTS,
            severity: 'ERROR',
            category: 'STRUCTURE',
            message: `Output already exists: ${path}. Use --overwrite to replace.`,
          },
        };
      } catch {
        // ok
      }
    }

    try {
      await ensureDirForFile(path);
      await atomicWriteFile(path, data);
      return { ok: true, warnings: [], issues: [] };
    } catch (error) {
      return {
        ok: false,
        warnings: [],
        issues: [],
        fatalError: {
          code: IssueCodes.CORE_ATOMIC_WRITE_FAILED,
          severity: 'ERROR',
          category: 'STRUCTURE',
          message: `Atomic write failed for ${path}: ${(error as Error).message}.`,
        },
      };
    }
  },
  capabilities() {
    return { supportsImport: true, supportsExport: true, supportsInspect: true };
  },
};

interface MidiParseResult {
  timing: IRProject['timing'];
  tracks: ParsedTrack[];
  markers: IRMarker[];
  warnings: string[];
  issues: ImportResult['issues'];
}

function parseMidi(buffer: Buffer, opts: ImportOptions): MidiParseResult {
  const warnings: string[] = [];
  const issues: ImportResult['issues'] = [];
  let offset = 0;

  const header = buffer.slice(offset, offset + 4);
  if (!header.equals(MIDI_HEADER)) {
    throw new MidiParseError({
      code: IssueCodes.MIDI_UNSUPPORTED_HEADER,
      severity: 'ERROR',
      category: 'STRUCTURE',
      message: 'Unsupported or invalid MIDI header.',
    });
  }
  offset += 4;
  const headerLen = buffer.readUInt32BE(offset);
  offset += 4;
  offset += 2;
  const trackCount = buffer.readUInt16BE(offset);
  offset += 2;
  const division = buffer.readUInt16BE(offset);
  offset += 2;
  offset += Math.max(0, headerLen - 6);

  let ppq = division;
  if (division & 0x8000) {
    ppq = opts.defaultPPQ ?? 960;
    warnings.push(`SMPTE timing approximated to PPQ=${ppq}.`);
    issues.push({
      code: IssueCodes.MIDI_SMPTE_TIME_DIVISION_APPROXIMATED,
      severity: 'WARN',
      category: 'TIMING',
      message: `SMPTE timing approximated to PPQ=${ppq}.`,
    });
  }

  const timing: IRProject['timing'] = {
    ppq,
    tempoMap: [],
    timeSignatures: [],
  };
  const markers: IRMarker[] = [];
  const tracks: ParsedTrack[] = [];

  for (let t = 0; t < trackCount; t += 1) {
    const trackHeader = buffer.slice(offset, offset + 4);
    if (!trackHeader.equals(MIDI_TRACK)) {
      throw new MidiParseError({
        code: IssueCodes.MIDI_UNSUPPORTED_HEADER,
        severity: 'ERROR',
        category: 'STRUCTURE',
        message: `Unsupported or invalid MIDI track header at byte ${offset}.`,
      });
    }
    offset += 4;
    const trackLen = buffer.readUInt32BE(offset);
    offset += 4;
    const trackEnd = offset + trackLen;

    let tick = 0;
    let runningStatus: number | null = null;
    const trackName = `Track ${t + 1}`;
    let name = trackName;
    const events: ParsedTrack['events'] = [];
    const noteStacks = createNoteStacks();
    let channel: number | undefined;
    let program: number | undefined;

    while (offset < trackEnd) {
      const delta = readVarLen(buffer, offset);
      tick += delta.value;
      offset = delta.next;

      let statusByte = buffer[offset];
      if (statusByte < 0x80) {
        if (runningStatus === null) {
          throw new MidiParseError({
            code: IssueCodes.MIDI_RUNNING_STATUS_MALFORMED,
            severity: 'ERROR',
            category: 'STRUCTURE',
            message: `Malformed running status at byte ${offset}.`,
          });
        }
        statusByte = runningStatus;
      } else {
        offset += 1;
        runningStatus = statusByte;
      }

      if (statusByte === 0xff) {
        const type = buffer[offset];
        offset += 1;
        const length = readVarLen(buffer, offset);
        offset = length.next;
        const payload = buffer.slice(offset, offset + length.value);
        offset += length.value;

        if (type === 0x2f) {
          break;
        }
        if (type === 0x51 && payload.length === 3) {
          const micros = payload.readUIntBE(0, 3);
          const bpm = 60000000 / micros;
          timing.tempoMap.push({ id: '', tick, bpm });
        } else if (type === 0x58 && payload.length >= 2) {
          const numerator = payload[0];
          const denomPow = payload[1];
          const denominator = Math.pow(2, denomPow) as 1 | 2 | 4 | 8 | 16 | 32;
          timing.timeSignatures.push({ id: '', tick, numerator, denominator });
        } else if (type === 0x03) {
          name = payload.toString('utf8').trim() || trackName;
        } else if (type === 0x06) {
          const markerName = payload.toString('utf8');
          markers.push({ id: '', tick, name: markerName });
        } else if (type === 0x01) {
          const text = payload.toString('utf8');
          events.push({ kind: 'text', id: '', tick, textType: 'generic', text });
        }
        continue;
      }

      const eventType = statusByte & 0xf0;
      const eventChannel = statusByte & 0x0f;
      channel = channel ?? eventChannel;

      switch (eventType) {
        case 0x80: {
          const pitch = buffer[offset];
          const velocity = buffer[offset + 1];
          offset += 2;
          const note = noteStacks[eventChannel][pitch]?.pop();
          if (note) {
            events.push({
              kind: 'note',
              id: '',
              tick: note.tick,
              duration: Math.max(1, tick - note.tick),
              pitch,
              velocity: note.velocity,
              offVelocity: velocity,
            });
          } else {
            warnings.push(`Missing note-on for pitch ${pitch} ch ${eventChannel}.`);
            issues.push({
              code: IssueCodes.MIDI_NOTE_OFF_MISSING,
              severity: 'WARN',
              category: 'TIMING',
              message: `Missing note-off; note closed at end of track: pitch=${pitch}, ch=${eventChannel}.`,
            });
          }
          break;
        }
        case 0x90: {
          const pitch = buffer[offset];
          const velocity = buffer[offset + 1];
          offset += 2;
          if (velocity === 0) {
            const note = noteStacks[eventChannel][pitch]?.pop();
            if (note) {
              events.push({
                kind: 'note',
                id: '',
                tick: note.tick,
                duration: Math.max(1, tick - note.tick),
                pitch,
                velocity: note.velocity,
              });
            }
          } else {
            noteStacks[eventChannel][pitch] ??= [];
            noteStacks[eventChannel][pitch].push({ tick, velocity });
          }
          break;
        }
        case 0xb0: {
          const controller = buffer[offset];
          const value = buffer[offset + 1];
          offset += 2;
          events.push({ kind: 'cc', id: '', tick, controller, value });
          break;
        }
        case 0xe0: {
          const lsb = buffer[offset];
          const msb = buffer[offset + 1];
          offset += 2;
          const value = ((msb << 7) | lsb) - 8192;
          events.push({ kind: 'pitchbend', id: '', tick, value });
          break;
        }
        case 0xc0: {
          program = buffer[offset];
          offset += 1;
          break;
        }
        default: {
          const dataLen = eventType === 0xd0 ? 1 : 2;
          offset += dataLen;
          break;
        }
      }
    }

    tracks.push({ name, channel, program, events });
  }

  return { timing, tracks, markers, warnings, issues };
}

function writeMidi(ir: IRProject): Buffer {
  const ppq = ir.timing.ppq;
  const tracks: Buffer[] = [];

  const metaEvents: MidiEvent[] = [];
  for (const tempo of ir.timing.tempoMap) {
    const micros = Math.round(60000000 / tempo.bpm);
    metaEvents.push({ tick: tempo.tick, type: 'tempo', data: micros });
  }
  for (const ts of ir.timing.timeSignatures) {
    const denomPow = Math.round(Math.log2(ts.denominator));
    metaEvents.push({
      tick: ts.tick,
      type: 'timesig',
      data: { numerator: ts.numerator, denomPow },
    });
  }
  for (const marker of ir.markers) {
    metaEvents.push({ tick: marker.tick, type: 'marker', data: marker.name });
  }

  tracks.push(writeTrack(metaEvents));

  for (const track of ir.tracks) {
    const events: MidiEvent[] = [];
    events.push({ tick: 0, type: 'trackName', data: track.name });
    if (track.midi?.program !== undefined) {
      events.push({
        tick: 0,
        type: 'program',
        data: { channel: track.midi.channel ?? 0, program: track.midi.program },
      });
    }
    for (const event of track.events) {
      switch (event.kind) {
        case 'note':
          events.push({
            tick: event.tick,
            type: 'noteOn',
            data: {
              channel: track.midi?.channel ?? 0,
              pitch: event.pitch,
              velocity: event.velocity,
            },
          });
          events.push({
            tick: event.tick + event.duration,
            type: 'noteOff',
            data: {
              channel: track.midi?.channel ?? 0,
              pitch: event.pitch,
              velocity: event.offVelocity ?? 0,
            },
          });
          break;
        case 'cc':
          events.push({
            tick: event.tick,
            type: 'cc',
            data: {
              channel: track.midi?.channel ?? 0,
              controller: event.controller,
              value: event.value,
            },
          });
          break;
        case 'pitchbend':
          events.push({
            tick: event.tick,
            type: 'pitchbend',
            data: {
              channel: track.midi?.channel ?? 0,
              value: event.value,
            },
          });
          break;
        case 'text':
          events.push({ tick: event.tick, type: 'text', data: event.text });
          break;
        case 'lyric':
          events.push({ tick: event.tick, type: 'text', data: event.text });
          break;
        default:
          break;
      }
    }
    tracks.push(writeTrack(events));
  }

  const header = Buffer.alloc(14);
  MIDI_HEADER.copy(header, 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(tracks.length > 1 ? 1 : 0, 8);
  header.writeUInt16BE(tracks.length, 10);
  header.writeUInt16BE(ppq, 12);

  return Buffer.concat([header, ...tracks]);
}

type MidiEvent =
  | { tick: number; type: 'tempo'; data: number }
  | { tick: number; type: 'timesig'; data: { numerator: number; denomPow: number } }
  | { tick: number; type: 'marker'; data: string }
  | { tick: number; type: 'trackName'; data: string }
  | { tick: number; type: 'text'; data: string }
  | { tick: number; type: 'program'; data: { channel: number; program: number } }
  | { tick: number; type: 'noteOn'; data: { channel: number; pitch: number; velocity: number } }
  | { tick: number; type: 'noteOff'; data: { channel: number; pitch: number; velocity: number } }
  | { tick: number; type: 'cc'; data: { channel: number; controller: number; value: number } }
  | { tick: number; type: 'pitchbend'; data: { channel: number; value: number } };

function writeTrack(events: MidiEvent[]): Buffer {
  const sorted = [...events].sort((a, b) => {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    return priority(a) - priority(b);
  });

  let lastTick = 0;
  const chunks: Buffer[] = [];

  for (const event of sorted) {
    const delta = event.tick - lastTick;
    lastTick = event.tick;
    chunks.push(writeVarLen(delta));

    switch (event.type) {
      case 'tempo': {
        const payload = Buffer.alloc(3);
        payload.writeUIntBE(event.data, 0, 3);
        chunks.push(Buffer.from([0xff, 0x51]));
        chunks.push(writeVarLen(3));
        chunks.push(payload);
        break;
      }
      case 'timesig': {
        chunks.push(Buffer.from([0xff, 0x58]));
        chunks.push(writeVarLen(4));
        chunks.push(Buffer.from([event.data.numerator, event.data.denomPow, 24, 8]));
        break;
      }
      case 'marker': {
        const text = Buffer.from(event.data, 'utf8');
        chunks.push(Buffer.from([0xff, 0x06]));
        chunks.push(writeVarLen(text.length));
        chunks.push(text);
        break;
      }
      case 'trackName': {
        const text = Buffer.from(event.data, 'utf8');
        chunks.push(Buffer.from([0xff, 0x03]));
        chunks.push(writeVarLen(text.length));
        chunks.push(text);
        break;
      }
      case 'text': {
        const text = Buffer.from(event.data, 'utf8');
        chunks.push(Buffer.from([0xff, 0x01]));
        chunks.push(writeVarLen(text.length));
        chunks.push(text);
        break;
      }
      case 'program': {
        chunks.push(Buffer.from([0xc0 | (event.data.channel & 0x0f), event.data.program & 0x7f]));
        break;
      }
      case 'noteOn': {
        chunks.push(
          Buffer.from([
            0x90 | (event.data.channel & 0x0f),
            event.data.pitch & 0x7f,
            event.data.velocity & 0x7f,
          ]),
        );
        break;
      }
      case 'noteOff': {
        chunks.push(
          Buffer.from([
            0x80 | (event.data.channel & 0x0f),
            event.data.pitch & 0x7f,
            event.data.velocity & 0x7f,
          ]),
        );
        break;
      }
      case 'cc': {
        chunks.push(
          Buffer.from([
            0xb0 | (event.data.channel & 0x0f),
            event.data.controller & 0x7f,
            event.data.value & 0x7f,
          ]),
        );
        break;
      }
      case 'pitchbend': {
        const value = event.data.value + 8192;
        const lsb = value & 0x7f;
        const msb = (value >> 7) & 0x7f;
        chunks.push(Buffer.from([0xe0 | (event.data.channel & 0x0f), lsb, msb]));
        break;
      }
      default:
        break;
    }
  }

  chunks.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));

  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  MIDI_TRACK.copy(header, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function priority(event: MidiEvent): number {
  switch (event.type) {
    case 'tempo':
    case 'timesig':
    case 'trackName':
      return 0;
    case 'marker':
    case 'text':
      return 1;
    case 'noteOff':
      return 2;
    case 'noteOn':
      return 3;
    default:
      return 4;
  }
}

function readVarLen(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let offset = start;
  let continueRead = true;
  while (continueRead) {
    const byte = buffer[offset];
    offset += 1;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      continueRead = false;
    }
  }
  return { value, next: offset };
}

function writeVarLen(value: number): Buffer {
  let buffer = value & 0x7f;
  let result = Buffer.alloc(0);
  let remaining = value;
  while ((remaining >>= 7)) {
    buffer <<= 8;
    buffer |= (remaining & 0x7f) | 0x80;
  }
  let continueWrite = true;
  while (continueWrite) {
    result = Buffer.concat([result, Buffer.from([buffer & 0xff])]);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      continueWrite = false;
    }
  }
  return result;
}

function createNoteStacks(): Array<Array<Array<{ tick: number; velocity: number }>>> {
  return Array.from({ length: 16 }, () => Array.from({ length: 128 }, () => []));
}

function countNotes(events: ParsedTrack['events']): number {
  return events.filter((event) => event.kind === 'note').length;
}
