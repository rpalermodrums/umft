# MIDI → MusicXML Pseudocode (v0.1)

This pseudocode mirrors the current conservative exporter implementation.

## Measure Map

```
buildMeasureMap(timeSignatures, ppq, endTick):
  if no timeSig at tick 0:
    insert 4/4 at tick 0
  sort timeSignatures by tick

  measures = []
  currentTick = 0
  while currentTick < endTick + ppq:
    ts = active time signature
    ticksPerBeat = ppq * (4 / ts.denominator)
    measureLen = ticksPerBeat * ts.numerator
    measures.append({start: currentTick, end: currentTick + measureLen, ts})
    currentTick += measureLen
  return measures
```

## Note Placement (Simplified)

```
for each track:
  notes = all IR notes sorted by (tick, pitch)
  for each measure:
    cursor = measure.start
    for each note starting in this measure:
      if note.tick > cursor:
        emit rest for (note.tick - cursor)
        cursor = note.tick
      emit note with duration
      cursor += note.duration
    if cursor < measure.end:
      emit rest to fill measure
```

## Duration Mapping (Simplified)

```
# divisions = ppq
# duration units = ticks

noteType(durationTicks, ppq):
  ratio = durationTicks / ppq
  if ratio >= 4: return "whole"
  if ratio >= 2: return "half"
  if ratio >= 1: return "quarter"
  if ratio >= 0.5: return "eighth"
  if ratio >= 0.25: return "16th"
  return "32nd"
```

Notes:

- This v0.1 exporter does not infer tuplets.
- Notes crossing measures are not split (future work).
