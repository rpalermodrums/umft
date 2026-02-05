# UMFT (Universal Music File Translator)

UMFT is a **local-first, deterministic CLI** that converts between MIDI, MusicXML, AAF, and OMF with **explicit fidelity reporting**. The core promise is **no silent loss**: anything unsupported or changed is reported with stable issue codes.

## Why UMFT

- Deterministic mapping and stable output ordering
- Explicit fidelity classification (PERFECT / EQUIVALENT / APPROXIMATE / DROPPED / ERROR)
- Actionable issue list with stable codes
- Local-only: no network calls, no telemetry

## Status (v0.1 MVP Scope)

Supported:

- MIDI (SMF Type 0/1) import/export
- MusicXML (score-partwise) import/export
- .mxl compressed MusicXML (safe zip handling)

Limited:

- AAF/OMF are **inspect-only** in v0.1 (no conversion). Unsupported conversions fail with explicit errors.

## Install

This repo uses **bun** for dependencies and scripts.

```bash
bun install
```

## CLI Usage

```bash
# Convert MIDI to MusicXML
bun run build
node dist/cli.js convert song.mid --to musicxml --out out/song.musicxml

# Convert MusicXML to MIDI
node dist/cli.js convert score.musicxml --to midi --out out/score.mid

# Inspect a file
node dist/cli.js inspect song.mid

# Validate a file (strict parse + warnings)
node dist/cli.js validate score.musicxml

# Print report schema
node dist/cli.js schema report
```

### Exit Codes

- `0`: success with no WARN/ERROR issues
- `1`: success with WARN issues
- `2`: fatal failure (parse/write/unsupported pair)
- `3`: strict policy violation

## Configuration

UMFT loads config from (last wins):

1. defaults
2. `~/.umft.json`
3. `.umft.json` (search upward from cwd)
4. `--config <path>`
5. CLI flags

Core options (see `src/core/config/types.ts` for full schema):

- `policy`: `best-effort` or `strict`
- `diff.timingToleranceTicks`, `diff.tempoToleranceBpm`, `diff.velocityTolerance`
- `midi.defaultPPQ`, `midi.exportType`
- `musicxml.quantize`, `musicxml.quantizeCustom`, `musicxml.tempoRound`, `musicxml.inferTuplets`, `musicxml.splitAcrossMeasures`

## Reports

`convert` writes a JSON report and a human-readable Markdown report by default.

Report includes:

- tool + run metadata
- input/output format
- contract + tolerances
- summary counts by fidelity class
- issues list (stable codes, locations, suggested fixes)

Schema: `docs/REPORT_SCHEMA.json` and `umft schema report`.

## Determinism Guarantees

- Canonical ordering for tracks/events before export and before diff
- Stable ID hashing for IR elements
- No locale-dependent formatting
- Stable issue ordering

## Development

Scripts:

```bash
bun run build
bun run typecheck
bun run lint
bun run format
bun run test
```

Pre-commit/pre-push hooks are managed by `lefthook`.

## Repository Structure

```
src/
  cli/                # CLI commands
  core/               # IR, diff, contracts, reporting
  formats/            # MIDI, MusicXML, AAF, OMF adapters
  report/             # report writers
  io/                 # atomic writes, hashing

test/
  fixtures/           # input fixtures
  golden/             # golden outputs
```

## Notes on AAF/OMF

AAF and OMF are complex container formats with vendor-specific variance. In v0.1, UMFT supports **inspect-only** mode to surface basic metadata and warn about limitations. Conversion to/from AAF/OMF is not yet implemented and will fail with explicit errors.

## License

TBD.
