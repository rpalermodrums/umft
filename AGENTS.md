```md
# UMFT — Codex Agent Instructions (AGENTS.md)

This repository is a **local-first CLI tool** named **umft** (Universal Music File Translator). It converts between **MIDI**, **MusicXML**, **AAF**, and **OMF** with **deterministic mapping** and a **fidelity report** (perfect vs approximate vs dropped + actionable issues list).

## Mission

Implement a robust, test-backed conversion pipeline:

1. Import input format → canonical **IR₀**
2. Export IR₀ → target format file
3. Re-import exported file → canonical **IR₁**
4. Diff IR₀ vs IR₁ under a versioned **mapping contract**
5. Emit output file(s) + report.json (+ report.md) + exit code based on policy

Primary promise: **no silent loss**. Anything unsupported or changed must be surfaced as an issue.

## Working agreements

- Keep changes **small, incremental, and testable**. Prefer multiple small commits over one large commit.
- Prefer **determinism and transparency** over “smart” inference.
- If a format feature is not supported, **do not guess**. Drop it and emit a structured issue with a stable code.
- Do not add runtime dependencies unless they are necessary. If adding one, keep it small and widely used.
- No network calls, no telemetry, no background daemons.

## Non-negotiable invariants

- **Deterministic output**: same input + config must produce identical semantics and stable report ordering.
- **Atomic writes**: output and report written via temp + rename.
- **Stable IDs**: IR element IDs are stable hashes derived from canonical content.
- **Stable issue codes**: issue `code` values are treated as public API. Only add new codes; do not rename/remove without a version bump.
- **Report schema stability**: bump `reportSchemaVersion` on breaking changes.
- **Strict mode behavior**: in `--policy strict`, any DROPPED/ERROR must yield a non-zero exit code (but still write report if possible).

## Supported scope (v0.1)

- MIDI: SMF Type 0/1 import/export with tempo, time signatures, notes, CC, pitch bend.
- MusicXML: score-partwise import/export with deterministic quantization + ties.
- AAF/OMF: **subset only**. Prefer `inspect` + limited import/export of timeline/media refs where feasible.
  - If only `inspect` is implemented for AAF/OMF, ensure convert fails with a clear ERROR and issues.

Never claim full AAF/OMF fidelity. Always report subset limitations.

## Repository layout (target)

- `src/cli/` CLI entrypoints and subcommands (convert/inspect/validate/schema)
- `src/core/ir/` IR types, canonicalization, stable IDs
- `src/core/convert/` orchestration pipeline
- `src/core/diff/` diff engine + tolerances
- `src/core/contracts/` mapping contracts + evaluation
- `src/core/issues/` issue codes + builders + aggregation rules
- `src/core/report/` report writers (json + md)
- `src/core/io/` atomic writes, hashing, path utilities
- `src/formats/{midi,musicxml,aaf,omf}/` adapters (import/export/inspect)
- `test/fixtures/` input fixtures
- `test/golden/` expected outputs + report assertions
- `docs/` canonical specs (see below)

## Canonical specs (source of truth)

Keep these docs up to date as code evolves; treat them as normative:

- `docs/TECH_SPEC.md` — complete technical specification (pipeline, IR, CLI, report schema)
- `docs/ISSUE_CODES.md` — stable issue code catalog (with severity, trigger, templates)
- `docs/CONTRACTS.md` — conversion contract matrix + profile definitions
- `docs/PSEUDOCODE.md` — MIDI→MusicXML quantization + tie splitting + divisions/duration spelling pseudocode
- `docs/REPORT_SCHEMA.json` — JSON schema for `report.json` (printed by `umft schema report`)

If behavior changes, update docs and tests in the same change.

## CLI behavior requirements

Commands to implement:

- `umft convert <inputPath> --to <format> [--out ...] [--report ...] [--policy best-effort|strict] [--profile ...] [--config ...]`
- `umft inspect <inputPath> [--json]`
- `umft validate <inputPath> [--json]`
- `umft schema report`

Exit codes:
- `0` success with no WARN/ERROR issues
- `1` success with WARN issues
- `2` fatal failure (parse/write/unsupported)
- `3` strict policy violation

Always ensure CLI output is scriptable and consistent across platforms.

## Determinism checklist (apply to every feature)

- Canonical sort order for tracks/events/tempo/markers applied before export and before diff.
- No locale-sensitive formatting.
- No reliance on object key order. Use arrays + explicit sorting.
- Stable rounding rules for floats and tick conversions.
- Report ordering stable: issues sorted by (severity desc, code asc, category asc, location asc).

## Testing requirements

Minimum test suite expectations:

- Unit tests for:
  - canonicalization
  - stable ID hashing
  - quantization and tie splitting
  - diff tolerance logic
- Golden tests for:
  - MIDI→MIDI (lossless expectations)
  - MIDI→MusicXML (quantized fixtures)
  - MusicXML→MIDI (core rhythm/pitch)
- Negative tests:
  - malformed MIDI, invalid XML, unsafe zip paths, oversize decompression
- CI should run:
  - typecheck
  - lint
  - unit tests
  - golden tests

If golden outputs change, the change must be explained in docs (contract update) and issues list.

## Dependency policy

Preferred approach:
- Implement MIDI parsing/writing in-house unless a dependency is clearly better and stable.
- XML parsing may use a small library; avoid DOM-heavy dependencies if possible.
- Zip reading for `.mxl` must defend against zip-slip and decompression bombs.

If introducing a new runtime dependency:
- justify it in the PR description (what it replaces and why)
- add focused tests around it
- ensure it does not reduce determinism

## Review guidelines

When reviewing changes (including automated reviews), prioritize:

- No silent drops: every unsupported feature yields an issue code.
- Contract correctness: fidelity classifications match the contract matrix.
- Backwards compatibility of `report.json`, issue codes, and CLI flags.
- Safety: no path traversal, safe zip handling, atomic writes, no network I/O.
- Maintainability: small modules, typed interfaces, clear naming, comments only where non-obvious.

Treat typos in docs as WARN-level issues if they affect clarity of the specs.

## ExecPlans (for large work)

If asked to implement a multi-step feature (new adapter, major refactor, contract overhaul):
- Create or update an execution plan in `PLANS.md` (or `docs/plans/<topic>.md`) before coding.
- The plan must include: scope, milestones, acceptance criteria, test strategy, and rollback notes.
- Keep the plan updated as work progresses.

## Default build conventions (create these if missing)

Use Node.js + TypeScript. Establish these scripts in `package.json`:

- `npm run build` (tsc compile to `dist/`)
- `npm run test` (unit + golden)
- `npm run lint`
- `npm run format` (optional)
- `npm run typecheck`

Keep the tool runnable via:
- `node dist/cli.js ...`
- and installable as `umft` via `bin` in `package.json`.

```
