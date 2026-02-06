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

Enum validation:

- `convert --to`: `midi|musicxml|aaf|omf`
- `convert --policy`: `best-effort|strict`
- `convert --report-format`: `json|md|both`
- `convert --log-level`: `silent|error|warn|info|debug`

Invalid enum values are treated as usage failures with deterministic single-line errors and exit code `2`.

Defaults:

- Output path uses `.mid` / `.musicxml` / `.aaf` / `.omf` extensions
- Report path defaults to `<outDir>/report.json`
- `policy` and `profile` default from loaded config when flags are omitted (flags act as overrides)

## Exit Code Semantics

Exit code precedence for `convert`:

1. Fatal failure (input/read/import/export/write/unsupported pair/round-trip import failure) => `2`
2. Strict fidelity violation (`--policy strict` and diff has `DROPPED > 0` or `ERROR > 0`) => `3`
3. Non-fatal WARN/ERROR issues => `1`
4. Clean run => `0`

When strict fidelity fails, UMFT emits `CORE_STRICT_POLICY_VIOLATION`.

## Report

Report schema is defined in `docs/REPORT_SCHEMA.json`. The report includes:

- Tool + run metadata
- Input/output info
- Contract + tolerances
- Summary counts
- Issues list (sorted)

Diff summary counts remain zero when diff is not performed (for example on fatal pre-diff failures).

Markdown report is derived from JSON with deterministic ordering.

## Determinism

- Canonical ordering for tracks/events/tempo/markers
- Stable rounding for tempo and tick values
- Atomic writes for output and reports

## Adapters (v0.1)

### MIDI

- Import: SMF Type 0/1; tempo, time sig, note on/off, CC, pitch bend
- Export: deterministic ordering; honors `config.midi.exportType` (`0` merged, `1` multitrack)
- Missing note-off emits `MIDI_NOTE_OFF_MISSING` and note is closed at track end
- Unsupported system/sysex events are skipped safely with `MIDI_SYSTEM_EVENT_SKIPPED`
- Meta-only empty tracks are not emitted as musical tracks on import

### MusicXML

- Import: partwise subset with core timing support for `<chord/>`, `<backup>`, and `<forward>`
- Export: partwise with divisions set to PPQ; durations mapped to basic note types
- Unsupported constructs are surfaced explicitly (`MXML_UNSUPPORTED_IMPORT_CONSTRUCT`, `MXML_UNSUPPORTED_EXPORT_EVENT`)
- Export honors overwrite protection (`CORE_OUTPUT_PATH_EXISTS`)
- `.mxl` compressed input supported with zip-slip protection and decompression limits

### AAF / OMF

- Inspect-only subset in v0.1
- Convert/import/export are not implemented and fail explicitly

## Configuration

`src/core/config` provides:

- Defaults
- Merge + load from `.umft.json`
- Config hashing for report provenance
- `diff` tolerance overrides (`timingToleranceTicks`, `tempoToleranceBpm`, `velocityTolerance`) are applied to the selected mapping contract before diff and report emission

## Diff Matching

- Timing/tempo/marker matching uses stable identity first, then deterministic key-based pairing, then comparator tolerances
- Notes match in deterministic stages: `stableId`, then `id`, then bucket pairing by `pitch|voice|staff` ordered by tick/duration
- Approximate note deltas are reported as approximate mismatches instead of false dropped+added pairs

## Build

- TypeScript compiled to `dist/` via `tsconfig.build.json`
- CommonJS output for Node >= 20
- `schema report` loads a bundled schema object (not CWD-relative file lookup)
