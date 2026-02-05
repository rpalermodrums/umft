# UMFT Technical Spec (v0.1)

This document is the normative technical description for the current codebase. It is intentionally concise and matches the implemented behavior.

## Architecture

Pipeline (convert):

1. Detect format (sniff + extension)
2. Import to IR₀
3. Canonicalize IR₀ (stable IDs + ordering)
4. Export IR₀ → target file
5. Re-import output → IR₁
6. Canonicalize IR₁
7. Diff IR₀ vs IR₁ under mapping contract
8. Emit report (JSON + optional MD)

## IR (Intermediate Representation)

IR types live in `src/core/ir/` and include:

- `IRProject` with timing, tracks, markers, and optional media domain
- `IRTrack` events: note, cc, pitchbend, text, lyric, dynamic, articulation
- Stable IDs via SHA-256 over canonical strings (format-agnostic `stableId` for cross-format diffing)
- Canonical ordering for determinism

## CLI

Commands:

- `umft convert <inputPath> --to <format>`
- `umft inspect <inputPath> [--json]`
- `umft validate <inputPath> [--json]`
- `umft schema report`

Defaults:

- Output path uses `.mid` / `.musicxml` / `.aaf` / `.omf` extensions
- Report path defaults to `<outDir>/report.json`

## Report

Report schema is defined in `docs/REPORT_SCHEMA.json`. The report includes:

- Tool + run metadata
- Input/output info
- Contract + tolerances
- Summary counts
- Issues list (sorted)

Markdown report is derived from JSON with deterministic ordering.

## Determinism

- Canonical ordering for tracks/events/tempo/markers
- Stable rounding for tempo and tick values
- Atomic writes for output and reports

## Adapters (v0.1)

### MIDI

- Import: SMF Type 0/1; tempo, time sig, note on/off, CC, pitch bend
- Export: Type 1 by default; deterministic ordering
- Missing note-off emits warning issue

### MusicXML

- Import: partwise subset (measures, divisions, notes, time sig, tempo)
- Export: partwise with divisions set to PPQ; durations mapped to basic note types
- `.mxl` compressed input supported with zip-slip protection and decompression limits

### AAF / OMF

- Inspect-only subset in v0.1
- Convert/import/export are not implemented and fail explicitly

## Configuration

`src/core/config` provides:

- Defaults
- Merge + load from `.umft.json`
- Config hashing for report provenance

## Build

- TypeScript compiled to `dist/` via `tsconfig.build.json`
- CommonJS output for Node >= 20
