import {
  IRArticulationEvent,
  IRAudioClipRef,
  IRAudioRefTrack,
  IRCCEvent,
  IRDynamicEvent,
  IREvent,
  IRKeySignature,
  IRLyricEvent,
  IRMarker,
  IRMediaDomain,
  IRNoteEvent,
  IRPitchBendEvent,
  IRProject,
  IRTempoEvent,
  IRTextEvent,
  IRTimeSignature,
  IRTrack,
  IRTrackType,
  IRTiming,
} from './types';
import { makeId, normalizeName } from './ids';

const BPM_PRECISION = 1e6;

const TRACK_TYPE_ORDER: Record<IRTrackType, number> = {
  midi: 0,
  notation: 1,
  audio_ref: 2,
  meta: 3,
};

const EVENT_KIND_ORDER: Record<IREvent['kind'], number> = {
  note: 0,
  cc: 1,
  pitchbend: 2,
  text: 3,
  lyric: 4,
  articulation: 5,
  dynamic: 6,
};

export function canonicalizeProject(project: IRProject): IRProject {
  const timing = canonicalizeTiming(project.timing);
  const markers = canonicalizeMarkers(project.markers);
  const tracks = canonicalizeTracks(project.tracks);
  const media = project.media ? canonicalizeMedia(project.media) : undefined;

  return {
    ...project,
    timing,
    markers,
    tracks,
    media,
  };
}

function canonicalizeTiming(timing: IRTiming): IRTiming {
  return {
    ...timing,
    ppq: roundToInt(timing.ppq),
    tempoMap: canonicalizeTempoMap(timing.tempoMap),
    timeSignatures: canonicalizeTimeSignatures(timing.timeSignatures),
    keySignatures: timing.keySignatures
      ? canonicalizeKeySignatures(timing.keySignatures)
      : undefined,
  };
}

function canonicalizeTempoMap(events: IRTempoEvent[]): IRTempoEvent[] {
  const normalized = events.map((event) => {
    const tick = roundToInt(event.tick);
    const bpm = roundToPrecision(event.bpm, BPM_PRECISION);
    return {
      ...event,
      id: event.id || makeId('tempo', [tick, bpm]),
      tick,
      bpm,
    };
  });

  return normalized.sort((a, b) => compareNumbers(a.tick, b.tick) || compareNumbers(a.bpm, b.bpm));
}

function canonicalizeTimeSignatures(events: IRTimeSignature[]): IRTimeSignature[] {
  const normalized = events.map((event) => {
    const tick = roundToInt(event.tick);
    return {
      ...event,
      id: event.id || makeId('timesig', [tick, event.numerator, event.denominator]),
      tick,
    };
  });

  return normalized.sort(
    (a, b) =>
      compareNumbers(a.tick, b.tick) ||
      compareNumbers(a.numerator, b.numerator) ||
      compareNumbers(a.denominator, b.denominator),
  );
}

function canonicalizeKeySignatures(events: IRKeySignature[]): IRKeySignature[] {
  const normalized = events.map((event) => {
    const tick = roundToInt(event.tick);
    return {
      ...event,
      id: event.id || makeId('keysig', [tick, event.fifths, event.mode ?? '']),
      tick,
    };
  });

  return normalized.sort(
    (a, b) =>
      compareNumbers(a.tick, b.tick) ||
      compareNumbers(a.fifths, b.fifths) ||
      compareStrings(a.mode, b.mode),
  );
}

function canonicalizeMarkers(markers: IRMarker[]): IRMarker[] {
  const normalized = markers.map((marker) => {
    const tick = roundToInt(marker.tick);
    return {
      ...marker,
      id: marker.id || makeId('marker', [tick, marker.name]),
      tick,
    };
  });

  return normalized.sort(
    (a, b) => compareNumbers(a.tick, b.tick) || compareStrings(a.name, b.name),
  );
}

function canonicalizeTracks(tracks: IRTrack[]): IRTrack[] {
  const indexed = tracks.map((track, index) => ({ track, index }));

  indexed.sort((a, b) => {
    const typeOrder = compareNumbers(
      TRACK_TYPE_ORDER[a.track.type],
      TRACK_TYPE_ORDER[b.track.type],
    );
    if (typeOrder !== 0) {
      return typeOrder;
    }

    const nameOrder = compareStrings(normalizeName(a.track.name), normalizeName(b.track.name));
    if (nameOrder !== 0) {
      return nameOrder;
    }

    return compareNumbers(a.index, b.index);
  });

  return indexed.map(({ track, index }) => canonicalizeTrack(track, index));
}

function canonicalizeTrack(track: IRTrack, originalIndex: number): IRTrack {
  const id = track.id || makeId('track', [track.type, normalizeName(track.name), originalIndex]);
  return {
    ...track,
    id,
    events: canonicalizeEvents(track.events, id),
  };
}

function canonicalizeEvents(events: IREvent[], trackId: string): IREvent[] {
  const normalized = events.map((event, index) => ({
    event: normalizeEvent(event, trackId),
    index,
  }));

  normalized.sort((a, b) => {
    const tickOrder = compareNumbers(a.event.tick, b.event.tick);
    if (tickOrder !== 0) {
      return tickOrder;
    }

    const kindOrder = compareNumbers(
      EVENT_KIND_ORDER[a.event.kind],
      EVENT_KIND_ORDER[b.event.kind],
    );
    if (kindOrder !== 0) {
      return kindOrder;
    }

    const fieldOrder = compareEventFields(a.event, b.event);
    if (fieldOrder !== 0) {
      return fieldOrder;
    }

    return compareNumbers(a.index, b.index);
  });

  return normalized.map((entry) => entry.event);
}

function normalizeEvent(event: IREvent, trackId: string): IREvent {
  switch (event.kind) {
    case 'note': {
      const tick = roundToInt(event.tick);
      const duration = Math.max(1, roundToInt(event.duration));
      const id = event.id || makeId('note', [trackId, tick, duration, event.pitch, event.velocity]);
      return {
        ...event,
        id,
        tick,
        duration,
      } satisfies IRNoteEvent;
    }
    case 'cc': {
      const tick = roundToInt(event.tick);
      const id = event.id || makeId('cc', [trackId, tick, event.controller, event.value]);
      return {
        ...event,
        id,
        tick,
      } satisfies IRCCEvent;
    }
    case 'pitchbend': {
      const tick = roundToInt(event.tick);
      const id = event.id || makeId('pitchbend', [trackId, tick, event.value]);
      return {
        ...event,
        id,
        tick,
      } satisfies IRPitchBendEvent;
    }
    case 'text': {
      const tick = roundToInt(event.tick);
      const id = event.id || makeId('text', [trackId, tick, event.textType, event.text]);
      return {
        ...event,
        id,
        tick,
      } satisfies IRTextEvent;
    }
    case 'lyric': {
      const tick = roundToInt(event.tick);
      const id =
        event.id ||
        makeId('lyric', [trackId, tick, event.text, event.syllabic ?? '', event.line ?? '']);
      return {
        ...event,
        id,
        tick,
      } satisfies IRLyricEvent;
    }
    case 'articulation': {
      const tick = roundToInt(event.tick);
      const id = event.id || makeId('articulation', [trackId, tick, event.value]);
      return {
        ...event,
        id,
        tick,
      } satisfies IRArticulationEvent;
    }
    case 'dynamic': {
      const tick = roundToInt(event.tick);
      const id = event.id || makeId('dynamic', [trackId, tick, event.value]);
      return {
        ...event,
        id,
        tick,
      } satisfies IRDynamicEvent;
    }
    default: {
      return event;
    }
  }
}

function compareEventFields(a: IREvent, b: IREvent): number {
  if (a.kind !== b.kind) {
    return compareNumbers(EVENT_KIND_ORDER[a.kind], EVENT_KIND_ORDER[b.kind]);
  }

  switch (a.kind) {
    case 'note': {
      const bNote = b as IRNoteEvent;
      return (
        compareNumbers(a.pitch, bNote.pitch) ||
        compareNumbers(a.duration, bNote.duration) ||
        compareNumbers(a.velocity, bNote.velocity) ||
        compareNumbers(a.offVelocity ?? -1, bNote.offVelocity ?? -1)
      );
    }
    case 'cc': {
      const bCc = b as IRCCEvent;
      return compareNumbers(a.controller, bCc.controller) || compareNumbers(a.value, bCc.value);
    }
    case 'pitchbend': {
      const bPb = b as IRPitchBendEvent;
      return compareNumbers(a.value, bPb.value);
    }
    case 'text': {
      const bText = b as IRTextEvent;
      return compareStrings(a.textType, bText.textType) || compareStrings(a.text, bText.text);
    }
    case 'lyric': {
      const bLyric = b as IRLyricEvent;
      return (
        compareStrings(a.text, bLyric.text) ||
        compareStrings(a.syllabic, bLyric.syllabic) ||
        compareNumbers(a.line ?? -1, bLyric.line ?? -1)
      );
    }
    case 'articulation': {
      const bArticulation = b as IRArticulationEvent;
      return compareStrings(a.value, bArticulation.value);
    }
    case 'dynamic': {
      const bDynamic = b as IRDynamicEvent;
      return compareStrings(a.value, bDynamic.value);
    }
    default:
      return 0;
  }
}

function canonicalizeMedia(media: IRMediaDomain): IRMediaDomain {
  return {
    ...media,
    tracks: media.tracks
      .map((track, index) => canonicalizeMediaTrack(track, index))
      .sort(compareMediaTracks),
  };
}

function canonicalizeMediaTrack(track: IRAudioRefTrack, index: number): IRAudioRefTrack {
  const id = track.id || makeId('audioTrack', [normalizeName(track.name), index]);
  const clips = track.clips.map((clip) => canonicalizeClip(clip, id)).sort(compareClips);
  return {
    ...track,
    id,
    clips,
  };
}

function canonicalizeClip(clip: IRAudioClipRef, trackId: string): IRAudioClipRef {
  const startSample = roundToInt(clip.startSample);
  const durationSamples = Math.max(1, roundToInt(clip.durationSamples));
  const id =
    clip.id || makeId('audioClip', [trackId, startSample, durationSamples, clip.source.uri ?? '']);
  return {
    ...clip,
    id,
    startSample,
    durationSamples,
  };
}

function compareMediaTracks(a: IRAudioRefTrack, b: IRAudioRefTrack): number {
  return compareStrings(normalizeName(a.name), normalizeName(b.name));
}

function compareClips(a: IRAudioClipRef, b: IRAudioClipRef): number {
  return (
    compareNumbers(a.startSample, b.startSample) ||
    compareNumbers(a.durationSamples, b.durationSamples) ||
    compareStrings(a.source.uri, b.source.uri)
  );
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareStrings(a?: string | null, b?: string | null): number {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function roundToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.round(value * precision) / precision;
}

function roundToInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}
