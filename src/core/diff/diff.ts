import {
  IRCCEvent,
  IRArticulationEvent,
  IRDynamicEvent,
  IREvent,
  IRMarker,
  IRNoteEvent,
  IRPitchBendEvent,
  IRProject,
  IRTempoEvent,
  IRTextEvent,
  IRTimeSignature,
  IRTrack,
} from '../ir';
import {
  ContractElementKind,
  FidelityExpectation,
  MappingContract,
  getExpectation,
} from '../contracts';
import { Issue, IssueCodes } from '../issues';
import { DiffResult, DiffSummary, FidelityClass } from './types';

interface CompareResult {
  className: FidelityClass;
  issues: Issue[];
}

interface CollectionDiffResult {
  summary: DiffSummary;
  issues: Issue[];
  added: number;
}

const EMPTY_SUMMARY: DiffSummary = {
  elementsTotal: 0,
  perfect: 0,
  equivalent: 0,
  approximate: 0,
  dropped: 0,
  errors: 0,
};

export function diffProjects(
  ir0: IRProject,
  ir1: IRProject,
  contract: MappingContract,
): DiffResult {
  const issues: Issue[] = [];
  let addedElements = 0;
  let summary = { ...EMPTY_SUMMARY };

  const tempo = diffById(
    'tempo',
    ir0.timing.tempoMap,
    ir1.timing.tempoMap,
    (event) => event.id,
    (a, b) => compareTempo(a, b, contract),
    contract,
  );
  summary = mergeSummary(summary, tempo.summary);
  issues.push(...tempo.issues);
  addedElements += tempo.added;

  const timesig = diffById(
    'timesig',
    ir0.timing.timeSignatures,
    ir1.timing.timeSignatures,
    (event) => event.id,
    (a, b) => compareTimeSignature(a, b, contract),
    contract,
  );
  summary = mergeSummary(summary, timesig.summary);
  issues.push(...timesig.issues);
  addedElements += timesig.added;

  const markers = diffById(
    'marker',
    ir0.markers,
    ir1.markers,
    (marker) => marker.id,
    (a, b) => compareMarker(a, b, contract),
    contract,
  );
  summary = mergeSummary(summary, markers.summary);
  issues.push(...markers.issues);
  addedElements += markers.added;

  const trackResult = diffTracks(ir0.tracks, ir1.tracks, contract);
  summary = mergeSummary(summary, trackResult.summary);
  issues.push(...trackResult.issues);
  addedElements += trackResult.added;

  if (ir0.media && ir1.media) {
    const clips0 = ir0.media.tracks.flatMap((track) => track.clips);
    const clips1 = ir1.media.tracks.flatMap((track) => track.clips);
    const clips = diffById(
      'audioClip',
      clips0,
      clips1,
      (clip) => clip.id,
      (a, b) => compareAudioClip(a, b, contract),
      contract,
    );
    summary = mergeSummary(summary, clips.summary);
    issues.push(...clips.issues);
    addedElements += clips.added;
  }

  if (addedElements > 0) {
    issues.push({
      code: IssueCodes.DIFF_ADDED_ELEMENTS_IGNORED,
      severity: 'INFO',
      category: 'STRUCTURE',
      message: `Additional elements created by exporter were ignored in diff: ${addedElements}.`,
      count: addedElements,
    });
  }

  return {
    summary,
    issues,
    addedElements,
  };
}

function diffTracks(
  tracks0: IRTrack[],
  tracks1: IRTrack[],
  contract: MappingContract,
): CollectionDiffResult {
  const result: CollectionDiffResult = { summary: { ...EMPTY_SUMMARY }, issues: [], added: 0 };

  if (tracks0.length !== tracks1.length) {
    result.issues.push({
      code: IssueCodes.DIFF_TRACK_MAPPING_CHANGED,
      severity: 'INFO',
      category: 'STRUCTURE',
      message: `Track mapping changed: ${tracks0.length} -> ${tracks1.length}.`,
    });
  }

  const byId = new Map(tracks1.map((track) => [track.id, track]));

  for (const track of tracks0) {
    const match = byId.get(track.id);
    if (!match) {
      const dropped = diffEvents(track.events, [], contract);
      result.summary = mergeSummary(result.summary, dropped.summary);
      result.issues.push(...dropped.issues);
      result.added += dropped.added;
      continue;
    }

    const trackDiff = diffEvents(track.events, match.events, contract);
    result.summary = mergeSummary(result.summary, trackDiff.summary);
    result.issues.push(...trackDiff.issues);
    result.added += trackDiff.added;
  }

  return result;
}

function diffEvents(
  events0: IREvent[],
  events1: IREvent[],
  contract: MappingContract,
): CollectionDiffResult {
  const grouped0 = groupByKind(events0);
  const grouped1 = groupByKind(events1);

  let summary = { ...EMPTY_SUMMARY };
  let added = 0;
  const issues: Issue[] = [];

  for (const kind of Object.keys(grouped0) as IREvent['kind'][]) {
    const result = diffById(
      kind,
      grouped0[kind] ?? [],
      grouped1[kind] ?? [],
      (event) => event.id,
      (a, b) => compareEvent(kind, a, b, contract),
      contract,
    );

    summary = mergeSummary(summary, result.summary);
    issues.push(...result.issues);
    added += result.added;
  }

  return { summary, issues, added };
}

function groupByKind(events: IREvent[]): Record<IREvent['kind'], IREvent[]> {
  return events.reduce(
    (acc, event) => {
      acc[event.kind] ??= [];
      acc[event.kind].push(event);
      return acc;
    },
    {
      note: [],
      cc: [],
      pitchbend: [],
      text: [],
      lyric: [],
      articulation: [],
      dynamic: [],
    } as Record<IREvent['kind'], IREvent[]>,
  );
}

function diffById<T>(
  kind: ContractElementKind,
  left: T[],
  right: T[],
  getId: (item: T) => string,
  compare: (a: T, b: T) => CompareResult,
  contract: MappingContract,
): CollectionDiffResult {
  const expectation = getExpectation(contract, kind);
  const leftMap = new Map(left.map((item) => [getId(item), item]));
  const rightMap = new Map(right.map((item) => [getId(item), item]));
  const allIds = new Set([...leftMap.keys(), ...rightMap.keys()]);

  let summary = { ...EMPTY_SUMMARY };
  const issues: Issue[] = [];
  let added = 0;

  for (const id of allIds) {
    const a = leftMap.get(id);
    const b = rightMap.get(id);
    if (!a && b) {
      added += 1;
      continue;
    }

    summary.elementsTotal += 1;

    if (!b) {
      const dropResult = classifyDrop(expectation, kind);
      summary = applyClass(summary, dropResult.className);
      issues.push(...dropResult.issues);
      continue;
    }

    const comparison = compare(a as T, b);
    summary = applyClass(summary, comparison.className);
    issues.push(...comparison.issues);
  }

  return { summary, issues, added };
}

function classifyDrop(expectation: FidelityExpectation, kind: ContractElementKind): CompareResult {
  if (expectation === 'lossless') {
    return {
      className: 'ERROR',
      issues: [
        {
          code: IssueCodes.DIFF_ELEMENT_MISSING_LOSSLESS,
          severity: 'ERROR',
          category: 'STRUCTURE',
          message: `Lossless element missing after conversion: ${kind}.`,
        },
      ],
    };
  }

  return {
    className: 'DROPPED',
    issues: [
      {
        code: IssueCodes.DIFF_ELEMENT_DROPPED,
        severity: expectation === 'unsupported' ? 'INFO' : 'WARN',
        category: 'STRUCTURE',
        message: `Element dropped during conversion (${kind}).`,
      },
    ],
  };
}

function compareTempo(a: IRTempoEvent, b: IRTempoEvent, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  const bpmDelta = Math.abs(a.bpm - b.bpm);

  if (tickDelta > contract.tolerances.timingTicks) {
    issues.push({
      code: IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TIMING',
      message: `Timing mismatch over tolerance (${contract.tolerances.timingTicks} ticks): tempo event.`,
    });
  }

  if (bpmDelta > contract.tolerances.tempoBpm) {
    issues.push({
      code: IssueCodes.DIFF_TEMPO_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TEMPO',
      message: `Tempo mismatch over tolerance (${contract.tolerances.tempoBpm} BPM): tempo event.`,
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'tempo'));
}

function compareTimeSignature(
  a: IRTimeSignature,
  b: IRTimeSignature,
  contract: MappingContract,
): CompareResult {
  const issues: Issue[] = [];

  if (a.tick !== b.tick || a.numerator !== b.numerator || a.denominator !== b.denominator) {
    issues.push({
      code: IssueCodes.DIFF_TIME_SIGNATURE_MISMATCH,
      severity: 'WARN',
      category: 'TEMPO',
      message: 'Time signature mismatch detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'timesig'));
}

function compareMarker(a: IRMarker, b: IRMarker, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks || a.name !== b.name) {
    issues.push({
      code: IssueCodes.DIFF_MARKER_MISMATCH,
      severity: 'INFO',
      category: 'METADATA',
      message: 'Marker differences detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'marker'));
}

function compareAudioClip(
  a: { startSample: number; durationSamples: number },
  b: { startSample: number; durationSamples: number },
  contract: MappingContract,
): CompareResult {
  const issues: Issue[] = [];
  if (a.startSample !== b.startSample || a.durationSamples !== b.durationSamples) {
    issues.push({
      code: IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'MEDIA',
      message: 'Audio clip timing mismatch detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'audioClip'));
}

function compareEvent(
  kind: IREvent['kind'],
  a: IREvent,
  b: IREvent,
  contract: MappingContract,
): CompareResult {
  switch (kind) {
    case 'note':
      return compareNote(a as IRNoteEvent, b as IRNoteEvent, contract);
    case 'cc':
      return compareCC(a as IRCCEvent, b as IRCCEvent, contract);
    case 'pitchbend':
      return comparePitchBend(a as IRPitchBendEvent, b as IRPitchBendEvent, contract);
    case 'text':
      return compareText(a as IRTextEvent, b as IRTextEvent, contract);
    case 'lyric':
      return compareLyric(a as IRTextEvent, b as IRTextEvent, contract);
    case 'articulation':
      return compareArticulation(a as IRArticulationEvent, b as IRArticulationEvent, contract);
    case 'dynamic':
      return compareDynamic(a as IRDynamicEvent, b as IRDynamicEvent, contract);
    default:
      return {
        className: 'APPROXIMATE',
        issues: [
          {
            code: IssueCodes.DIFF_UNKNOWN_KIND_SKIPPED,
            severity: 'WARN',
            category: 'STRUCTURE',
            message: `Unknown IR element kind skipped during diff: ${kind}.`,
          },
        ],
      };
  }
}

function compareNote(a: IRNoteEvent, b: IRNoteEvent, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks) {
    issues.push({
      code: IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TIMING',
      message: `Timing mismatch over tolerance (${contract.tolerances.timingTicks} ticks): note event.`,
    });
  }

  const durationDelta = Math.abs(a.duration - b.duration);
  if (durationDelta > contract.tolerances.timingTicks) {
    issues.push({
      code: IssueCodes.DIFF_DURATION_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TIMING',
      message: 'Duration mismatch over tolerance: note event.',
    });
  }

  if (a.pitch !== b.pitch) {
    issues.push({
      code: IssueCodes.DIFF_PITCH_MISMATCH,
      severity: 'ERROR',
      category: 'NOTATION',
      message: 'Pitch mismatch detected.',
    });
  }

  const velocityDelta = Math.abs(a.velocity - b.velocity);
  if (velocityDelta > contract.tolerances.velocity) {
    issues.push({
      code: IssueCodes.DIFF_VELOCITY_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'CONTROLLERS',
      message: `Velocity mismatch (> ${contract.tolerances.velocity}): note event.`,
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'note'));
}

function compareCC(a: IRCCEvent, b: IRCCEvent, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks) {
    issues.push({
      code: IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TIMING',
      message: `Timing mismatch over tolerance (${contract.tolerances.timingTicks} ticks): CC event.`,
    });
  }

  if (a.controller !== b.controller || Math.abs(a.value - b.value) > contract.tolerances.velocity) {
    issues.push({
      code: IssueCodes.DIFF_CONTROLLER_VALUE_MISMATCH,
      severity: 'WARN',
      category: 'CONTROLLERS',
      message: `Controller mismatch: CC${a.controller} affected.`,
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'cc'));
}

function comparePitchBend(
  a: IRPitchBendEvent,
  b: IRPitchBendEvent,
  contract: MappingContract,
): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks) {
    issues.push({
      code: IssueCodes.DIFF_TIMING_MISMATCH_OVER_TOLERANCE,
      severity: 'WARN',
      category: 'TIMING',
      message: `Timing mismatch over tolerance (${contract.tolerances.timingTicks} ticks): pitch bend event.`,
    });
  }

  if (Math.abs(a.value - b.value) > contract.tolerances.velocity) {
    issues.push({
      code: IssueCodes.DIFF_CONTROLLER_VALUE_MISMATCH,
      severity: 'WARN',
      category: 'CONTROLLERS',
      message: 'Pitch bend mismatch detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'pitchbend'));
}

function compareText(a: IRTextEvent, b: IRTextEvent, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (
    tickDelta > contract.tolerances.timingTicks ||
    a.textType !== b.textType ||
    a.text !== b.text
  ) {
    issues.push({
      code: IssueCodes.DIFF_MARKER_MISMATCH,
      severity: 'INFO',
      category: 'METADATA',
      message: 'Text event differences detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'text'));
}

function compareLyric(a: IRTextEvent, b: IRTextEvent, contract: MappingContract): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks || a.text !== b.text) {
    issues.push({
      code: IssueCodes.DIFF_MARKER_MISMATCH,
      severity: 'WARN',
      category: 'NOTATION',
      message: 'Lyric differences detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'lyric'));
}

function compareArticulation(
  a: IRArticulationEvent,
  b: IRArticulationEvent,
  contract: MappingContract,
): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks || a.value !== b.value) {
    issues.push({
      code: IssueCodes.DIFF_MARKER_MISMATCH,
      severity: 'INFO',
      category: 'NOTATION',
      message: 'Articulation differences detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'articulation'));
}

function compareDynamic(
  a: IRDynamicEvent,
  b: IRDynamicEvent,
  contract: MappingContract,
): CompareResult {
  const issues: Issue[] = [];
  const tickDelta = Math.abs(a.tick - b.tick);
  if (tickDelta > contract.tolerances.timingTicks || a.value !== b.value) {
    issues.push({
      code: IssueCodes.DIFF_MARKER_MISMATCH,
      severity: 'INFO',
      category: 'NOTATION',
      message: 'Dynamic differences detected.',
    });
  }

  return classifyComparison(issues, getExpectation(contract, 'dynamic'));
}

function classifyComparison(issues: Issue[], expectation: FidelityExpectation): CompareResult {
  if (issues.length === 0) {
    return {
      className: expectationToClass(expectation, true),
      issues: [],
    };
  }

  if (expectation === 'lossless') {
    const hasError = issues.some((issue) => issue.severity === 'ERROR');
    return {
      className: hasError ? 'ERROR' : 'APPROXIMATE',
      issues,
    };
  }

  if (expectation === 'unsupported') {
    return {
      className: 'APPROXIMATE',
      issues,
    };
  }

  return {
    className: 'APPROXIMATE',
    issues,
  };
}

function expectationToClass(expectation: FidelityExpectation, isExact: boolean): FidelityClass {
  switch (expectation) {
    case 'lossless':
      return isExact ? 'PERFECT' : 'APPROXIMATE';
    case 'equivalent':
      return 'EQUIVALENT';
    case 'approximate':
      return 'APPROXIMATE';
    case 'unsupported':
      return 'DROPPED';
    default:
      return 'APPROXIMATE';
  }
}

function mergeSummary(base: DiffSummary, next: DiffSummary): DiffSummary {
  return {
    elementsTotal: base.elementsTotal + next.elementsTotal,
    perfect: base.perfect + next.perfect,
    equivalent: base.equivalent + next.equivalent,
    approximate: base.approximate + next.approximate,
    dropped: base.dropped + next.dropped,
    errors: base.errors + next.errors,
  };
}

function applyClass(summary: DiffSummary, className: FidelityClass): DiffSummary {
  switch (className) {
    case 'PERFECT':
      summary.perfect += 1;
      break;
    case 'EQUIVALENT':
      summary.equivalent += 1;
      break;
    case 'APPROXIMATE':
      summary.approximate += 1;
      break;
    case 'DROPPED':
      summary.dropped += 1;
      break;
    case 'ERROR':
      summary.errors += 1;
      break;
    default:
      summary.approximate += 1;
  }
  return summary;
}
