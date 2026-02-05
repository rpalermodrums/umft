export type Format = 'midi' | 'musicxml' | 'aaf' | 'omf';

export interface IRProject {
  irVersion: '1.0';
  projectId: string;
  meta: {
    title?: string;
    sourceFormat?: Format;
    sourcePath?: string;
  };
  timing: IRTiming;
  tracks: IRTrack[];
  markers: IRMarker[];
  media?: IRMediaDomain;
}

export interface IRTiming {
  ppq: number;
  tempoMap: IRTempoEvent[];
  timeSignatures: IRTimeSignature[];
  keySignatures?: IRKeySignature[];
}

export interface IRTempoEvent {
  id: string;
  stableId?: string;
  tick: number;
  bpm: number;
}

export interface IRTimeSignature {
  id: string;
  stableId?: string;
  tick: number;
  numerator: number;
  denominator: 1 | 2 | 4 | 8 | 16 | 32;
}

export interface IRKeySignature {
  id: string;
  tick: number;
  fifths: number;
  mode?: 'major' | 'minor';
}

export type IRTrackType = 'midi' | 'notation' | 'audio_ref' | 'meta';

export interface IRTrack {
  id: string;
  stableId?: string;
  name: string;
  type: IRTrackType;
  midi?: {
    channel?: number;
    program?: number;
  };
  notation?: {
    partId?: string;
    instrumentName?: string;
    staves?: number;
  };
  events: IREvent[];
}

export type IREvent =
  | IRNoteEvent
  | IRCCEvent
  | IRPitchBendEvent
  | IRTextEvent
  | IRLyricEvent
  | IRArticulationEvent
  | IRDynamicEvent;

export interface IRNoteEvent {
  kind: 'note';
  id: string;
  stableId?: string;
  tick: number;
  duration: number;
  pitch: number;
  velocity: number;
  offVelocity?: number;
  voice?: number;
  staff?: number;
  tie?: 'start' | 'stop' | 'continue';
}

export interface IRCCEvent {
  kind: 'cc';
  id: string;
  stableId?: string;
  tick: number;
  controller: number;
  value: number;
}

export interface IRPitchBendEvent {
  kind: 'pitchbend';
  id: string;
  stableId?: string;
  tick: number;
  value: number;
}

export interface IRTextEvent {
  kind: 'text';
  id: string;
  stableId?: string;
  tick: number;
  textType: 'trackName' | 'marker' | 'generic';
  text: string;
}

export interface IRLyricEvent {
  kind: 'lyric';
  id: string;
  stableId?: string;
  tick: number;
  text: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  line?: number;
}

export interface IRArticulationEvent {
  kind: 'articulation';
  id: string;
  stableId?: string;
  tick: number;
  value: string;
}

export interface IRDynamicEvent {
  kind: 'dynamic';
  id: string;
  stableId?: string;
  tick: number;
  value: string;
}

export interface IRMarker {
  id: string;
  stableId?: string;
  tick: number;
  name: string;
  color?: string;
}

export interface IRMediaDomain {
  timebase: {
    sampleRate: number;
    units: 'samples';
  };
  tracks: IRAudioRefTrack[];
}

export interface IRAudioRefTrack {
  id: string;
  name: string;
  clips: IRAudioClipRef[];
}

export interface IRAudioClipRef {
  id: string;
  startSample: number;
  durationSamples: number;
  source: {
    uri?: string;
    embedded?: boolean;
  };
  sourceInSample?: number;
  fades?: {
    in?: { lengthSamples: number; shape: 'linear' };
    out?: { lengthSamples: number; shape: 'linear' };
  };
}
