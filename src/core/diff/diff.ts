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
import { normalizeName } from '../ir/ids';
import {
  ContractElementKind,
  FidelityExpectation,
  MappingContract,
  getExpectation,
} from '../contracts';
import { Issue, IssueCodes } from '../issues';
import {
  DiffResult,
  DiffSummary,
  ElementIdBuckets,
  FidelityClass,
  TrackMappingDiff,
} from './types';

interface CompareResult {
  className: FidelityClass;
  issues: Issue[];
}

interface CollectionDiffResult {
  summary: DiffSummary;
  issues: Issue[];
  added: number;
  elementIds: ElementIdBuckets;
}

interface TrackDiffResult extends CollectionDiffResult {
  trackMappings: TrackMappingDiff[];
}

const EMPTY_SUMMARY: DiffSummary = {
  elementsTotal: 0,
  perfect: 0,
  equivalent: 0,
  approximate: 0,
  dropped: 0,
  errors: 0,
};

const EMPTY_ELEMENT_IDS: ElementIdBuckets = {
  perfect: [],
  equivalent: [],
  approximate: [],
  dropped: [],
  errors: [],
};

export function diffProjects(
  ir0: IRProject,
  ir1: IRProject,
  contract: MappingContract,
): DiffResult {
  const issues: Issue[] = [];
  let addedElements = 0;
  let summary = { ...EMPTY_SUMMARY };

  const tempo = diffByIdThenContent(
    'tempo',
    ir0.timing.tempoMap,
    ir1.timing.tempoMap,
    tempoContentKey,
    (a, b) => compareTempo(a, b, contract),
    contract,
  );
  summary = mergeSummary(summary, tempo.summary);
  issues.push(...tempo.issues);
  addedElements += tempo.added;

  const timesig = diffByIdThenContent(
    'timesig',
    ir0.timing.timeSignatures,
    ir1.timing.timeSignatures,
    timeSignatureContentKey,
    (a, b) => compareTimeSignature(a, b, contract),
    contract,
  );
  summary = mergeSummary(summary, timesig.summary);
  issues.push(...timesig.issues);
  addedElements += timesig.added;

  const markers = diffByIdThenContent(
    'marker',
    ir0.markers,
    ir1.markers,
    markerContentKey,
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
    trackMappings: trackResult.trackMappings,
  };
}

function diffTracks(
  tracks0: IRTrack[],
  tracks1: IRTrack[],
  contract: MappingContract,
): TrackDiffResult {
  const result: TrackDiffResult = {
    summary: { ...EMPTY_SUMMARY },
    issues: [],
    added: 0,
    elementIds: cloneElementIds(EMPTY_ELEMENT_IDS),
    trackMappings: [],
  };

  if (tracks0.length !== tracks1.length) {
    result.issues.push({
      code: IssueCodes.DIFF_TRACK_MAPPING_CHANGED,
      severity: 'INFO',
      category: 'STRUCTURE',
      message: `Track mapping changed: ${tracks0.length} -> ${tracks1.length}.`,
    });
  }

  const byStableId = new Map<string, IRTrack>();
  for (const track of tracks1) {
    if (track.stableId) {
      byStableId.set(track.stableId, track);
    }
  }
  const byId = new Map(tracks1.map((track) => [track.id, track]));
  const byName = new Map<string, IRTrack[]>();
  for (const track of tracks1) {
    const key = normalizeName(track.name);
    const list = byName.get(key) ?? [];
    list.push(track);
    byName.set(key, list);
  }
  const used = new Set<string>();

  for (const track of tracks0) {
    let match = track.stableId ? byStableId.get(track.stableId) : undefined;
    if (!match) {
      match = byId.get(track.id);
    }
    if (!match) {
      const key = normalizeName(track.name);
      const list = byName.get(key);
      match = list?.find((candidate) => !used.has(candidate.id));
    }
    if (!match) {
      const dropped = diffEvents(track.events, [], contract);
      result.summary = mergeSummary(result.summary, dropped.summary);
      result.issues.push(...dropped.issues);
      result.added += dropped.added;
      continue;
    }

    used.add(match.id);
    const trackDiff = diffEvents(track.events, match.events, contract);
    result.trackMappings.push({
      source: track,
      target: match,
      summary: trackDiff.summary,
      elementIds: trackDiff.elementIds,
    });
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
  let elementIds = cloneElementIds(EMPTY_ELEMENT_IDS);

  for (const kind of Object.keys(grouped0) as IREvent['kind'][]) {
    const result = diffByIdThenContent(
      kind,
      grouped0[kind] ?? [],
      grouped1[kind] ?? [],
      eventContentKey,
      (a, b) => compareEvent(kind, a, b, contract),
      contract,
      resolveEventId,
    );

    summary = mergeSummary(summary, result.summary);
    issues.push(...result.issues);
    added += result.added;
    elementIds = mergeElementIds(elementIds, result.elementIds);
  }

  return { summary, issues, added, elementIds };
}

function eventContentKey(event: IREvent): string {
  switch (event.kind) {
    case 'note':
      return `note:${event.tick}:${event.duration}:${event.pitch}:${event.velocity}`;
    case 'cc':
      return `cc:${event.tick}:${event.controller}:${event.value}`;
    case 'pitchbend':
      return `pitchbend:${event.tick}:${event.value}`;
    case 'text':
      return `text:${event.tick}:${event.textType}:${event.text}`;
    case 'lyric':
      return `lyric:${event.tick}:${event.text}`;
    case 'articulation':
      return `articulation:${event.tick}:${event.value}`;
    case 'dynamic':
      return `dynamic:${event.tick}:${event.value}`;
  }
  return '';
}

function resolveEventId(event: IREvent): string {
  return event.stableId ?? event.id ?? eventContentKey(event);
}

function tempoContentKey(event: IRTempoEvent): string {
  return `tempo:${event.tick}:${event.bpm}`;
}

function timeSignatureContentKey(event: IRTimeSignature): string {
  return `timesig:${event.tick}:${event.numerator}:${event.denominator}`;
}

function markerContentKey(marker: IRMarker): string {
  return `marker:${marker.tick}:${marker.name}`;
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
  const elementIds = cloneElementIds(EMPTY_ELEMENT_IDS);

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

  return { summary, issues, added, elementIds };
}

function diffByIdThenContent<T extends { id?: string; stableId?: string }>(
  kind: ContractElementKind,
  left: T[],
  right: T[],
  keyFn: (item: T) => string,
  compare: (a: T, b: T) => CompareResult,
  contract: MappingContract,
  elementIdFor?: (item: T) => string,
): CollectionDiffResult {
  const expectation = getExpectation(contract, kind);
  const leftByStable = new Map<string, T>();
  const rightByStable = new Map<string, T>();
  for (const item of left) {
    if (item.stableId) {
      leftByStable.set(item.stableId, item);
    }
  }
  for (const item of right) {
    if (item.stableId) {
      rightByStable.set(item.stableId, item);
    }
  }

  const matchedStableIds = new Set<string>();
  const matchedLeftStable = new Set<T>();
  const matchedRightStable = new Set<T>();
  for (const stableId of leftByStable.keys()) {
    const rightItem = rightByStable.get(stableId);
    if (rightItem) {
      matchedStableIds.add(stableId);
      matchedLeftStable.add(leftByStable.get(stableId) as T);
      matchedRightStable.add(rightItem);
    }
  }

  let summary = { ...EMPTY_SUMMARY };
  const issues: Issue[] = [];
  let added = 0;
  let elementIds = cloneElementIds(EMPTY_ELEMENT_IDS);

  for (const stableId of matchedStableIds) {
    const a = leftByStable.get(stableId);
    const b = rightByStable.get(stableId);
    if (!a || !b) continue;
    summary.elementsTotal += 1;
    const comparison = compare(a, b);
    summary = applyClass(summary, comparison.className);
    issues.push(...comparison.issues);
    if (elementIdFor) {
      addElementId(elementIds, comparison.className, elementIdFor(a));
    }
  }

  const leftAfterStable = left.filter((item) => !matchedLeftStable.has(item));
  const rightAfterStable = right.filter((item) => !matchedRightStable.has(item));

  const leftById = new Map(leftAfterStable.map((item) => [item.id ?? '', item]));
  const rightById = new Map(rightAfterStable.map((item) => [item.id ?? '', item]));
  const matchedIds = new Set<string>();

  for (const id of leftById.keys()) {
    if (!id) continue;
    if (rightById.has(id)) {
      matchedIds.add(id);
    }
  }

  const matchedLeftById = new Set<T>();
  const matchedRightById = new Set<T>();
  for (const id of matchedIds) {
    const a = leftById.get(id);
    const b = rightById.get(id);
    if (!a || !b) continue;
    matchedLeftById.add(a);
    matchedRightById.add(b);
    summary.elementsTotal += 1;
    const comparison = compare(a, b);
    summary = applyClass(summary, comparison.className);
    issues.push(...comparison.issues);
    if (elementIdFor) {
      addElementId(elementIds, comparison.className, elementIdFor(a));
    }
  }

  const leftRemaining = leftAfterStable.filter((item) => !matchedLeftById.has(item));
  const rightRemaining = rightAfterStable.filter((item) => !matchedRightById.has(item));
  const contentResult = diffByContent(
    kind,
    leftRemaining,
    rightRemaining,
    keyFn,
    compare,
    expectation,
    elementIdFor,
  );

  summary = mergeSummary(summary, contentResult.summary);
  issues.push(...contentResult.issues);
  added += contentResult.added;
  elementIds = mergeElementIds(elementIds, contentResult.elementIds);

  return { summary, issues, added, elementIds };
}

function diffByContent<T>(
  kind: ContractElementKind,
  left: T[],
  right: T[],
  keyFn: (item: T) => string,
  compare: (a: T, b: T) => CompareResult,
  expectation: FidelityExpectation,
  elementIdFor?: (item: T) => string,
): CollectionDiffResult {
  const leftMap = buildKeyedMap(left, keyFn);
  const rightMap = buildKeyedMap(right, keyFn);
  const allIds = new Set([...leftMap.keys(), ...rightMap.keys()]);

  let summary = { ...EMPTY_SUMMARY };
  const issues: Issue[] = [];
  let added = 0;
  const elementIds = cloneElementIds(EMPTY_ELEMENT_IDS);

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
      if (elementIdFor && a) {
        addElementId(elementIds, dropResult.className, elementIdFor(a));
      }
      continue;
    }

    const comparison = compare(a as T, b);
    summary = applyClass(summary, comparison.className);
    issues.push(...comparison.issues);
    if (elementIdFor && a) {
      addElementId(elementIds, comparison.className, elementIdFor(a));
    }
  }

  return { summary, issues, added, elementIds };
}

function buildKeyedMap<T>(items: T[], keyFn: (item: T) => string): Map<string, T> {
  const counts = new Map<string, number>();
  const map = new Map<string, T>();
  for (const item of items) {
    const base = keyFn(item);
    const index = counts.get(base) ?? 0;
    counts.set(base, index + 1);
    map.set(`${base}#${index}`, item);
  }
  return map;
}

function cloneElementIds(source: ElementIdBuckets): ElementIdBuckets {
  return {
    perfect: [...source.perfect],
    equivalent: [...source.equivalent],
    approximate: [...source.approximate],
    dropped: [...source.dropped],
    errors: [...source.errors],
  };
}

function mergeElementIds(target: ElementIdBuckets, incoming: ElementIdBuckets): ElementIdBuckets {
  const merged = cloneElementIds(target);
  mergeIdList(merged.perfect, incoming.perfect);
  mergeIdList(merged.equivalent, incoming.equivalent);
  mergeIdList(merged.approximate, incoming.approximate);
  mergeIdList(merged.dropped, incoming.dropped);
  mergeIdList(merged.errors, incoming.errors);
  return merged;
}

function mergeIdList(target: string[], incoming: string[], cap = 50): void {
  for (const id of incoming) {
    if (target.length >= cap) {
      break;
    }
    target.push(id);
  }
}

function addElementId(
  buckets: ElementIdBuckets,
  className: FidelityClass,
  id?: string,
  cap = 50,
): void {
  if (!id) return;
  let bucket: string[] | undefined;
  switch (className) {
    case 'PERFECT':
      bucket = buckets.perfect;
      break;
    case 'EQUIVALENT':
      bucket = buckets.equivalent;
      break;
    case 'APPROXIMATE':
      bucket = buckets.approximate;
      break;
    case 'DROPPED':
      bucket = buckets.dropped;
      break;
    case 'ERROR':
      bucket = buckets.errors;
      break;
  }
  if (!bucket || bucket.length >= cap) return;
  bucket.push(id);
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
