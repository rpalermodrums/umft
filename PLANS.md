# UMFT MVP Execution Plan

## UMFT Dockerization + Real-UX E2E Plan

### Scope

Add first-class container workflows for UMFT using Docker Compose + Docker Buildx Bake, and add black-box E2E tests that execute packaged CLI binaries in containers against mounted files.

### Milestones

1. **Container Build Pipeline**
   - Add a multi-stage `Dockerfile` (`deps`, `build`, `test`, `runtime`).
   - Add `.dockerignore` to shrink context and improve cache hits.
   - Ensure runtime image uses a non-root user and exposes `umft` entrypoint.

2. **Compose + Bake Topology**
   - Add `compose.yaml` with `umft`, `e2e-smoke`, and `e2e-full` services.
   - Add `docker-bake.hcl` with local runtime, e2e image, and multi-arch validation targets.
   - Configure groups: `default`, `ci-smoke`, `ci-nightly`.

3. **Black-Box E2E Harness**
   - Add shared assertions and JSON helpers in `test/e2e/lib/`.
   - Add PR smoke script covering help/version, convert/inspect/validate, strict/fatal exits, and invalid enum errors.
   - Add nightly full script covering determinism, config precedence, tolerance overrides, `.mxl` security cases, AAF/OMF inspect-only behavior, overwrite protection, and schema command outside repo root.

4. **Developer + CI Integration**
   - Add `package.json` scripts for Docker build/smoke/full/multi-arch workflows.
   - Add GitHub Actions Docker E2E workflow:
     - PR/push: smoke.
     - Nightly: full + multi-arch build validation.
   - Keep existing Bun-native CI checks unchanged.

5. **Docs and Rollout**
   - Add README Docker quickstart, command references, and troubleshooting.
   - Record assumptions and rollback path in this plan.

### Acceptance Criteria

- Local `docker compose run --rm umft ...` works with mounted workspace files and correct exit code propagation.
- PR smoke E2E runs in CI and verifies user-facing CLI behavior as packaged.
- Nightly full E2E validates deterministic output/report behavior and multi-arch image buildability.
- Existing `bun run lint`, `bun run typecheck`, and `bun run test` remain green.

### Test Strategy

- Keep current unit/golden tests as source-of-truth for internals.
- Add containerized black-box E2E as additive confidence layer:
  - Smoke suite for fast regressions.
  - Full suite for deep and security-sensitive flows.

### Rollback Notes

- Docker assets are isolated (`Dockerfile`, `compose.yaml`, `docker-bake.hcl`, `test/e2e/`, CI workflow), so rollback is straightforward by reverting those files and scripts.

## UMFT v0.1 Hardening Plan (Correctness + Coverage + UX)

### Scope

Harden existing v0.1 behavior without broadening format scope:

- Correctness fixes for convert exit semantics, CLI validation/config precedence, diff matching, and adapter no-silent-loss behavior.
- Targeted maintainability refactors in CLI entry structure and convert/report helpers.
- Expanded tests for uncovered regressions and edge cases.
- Core CLI UX improvements (script-friendly output and clearer summaries).

### Milestones

1. **Conversion Semantics + CLI Safety**
   - Fix fatal vs strict exit precedence.
   - Emit `CORE_STRICT_POLICY_VIOLATION` on strict fidelity failures.
   - Enforce CLI enum validation with deterministic errors.
   - Ensure config values are used when optional flags are omitted.

2. **Contract + Diff Correctness**
   - Apply config diff tolerance overrides to effective contract.
   - Improve deterministic event pairing to avoid false dropped classifications.
   - Stabilize cross-format note matching behavior.

3. **MIDI Adapter No-Silent-Loss**
   - Close dangling note-ons at track end with explicit issues.
   - Skip unsupported system/sysex events safely with issue emission.
   - Prevent synthetic track multiplication in round-trips.
   - Honor `midi.exportType`.

4. **MusicXML Timing + Explicit Unsupported**
   - Add export overwrite protection.
   - Support `<chord/>`, `<backup>`, and `<forward>` timing import behavior.
   - Emit explicit issues for unsupported import/export constructs.

5. **Refactor + Runtime Schema Packaging**
   - Split CLI into `src/cli/` modules with thin entrypoint.
   - Keep report schema loading independent of CWD.

6. **Coverage + Docs Sync**
   - Add focused tests for all corrected behaviors.
   - Update goldens where behavior correction is intentional.
   - Align TECH_SPEC / ISSUE_CODES / CONTRACTS / README.

### Acceptance Criteria

- Full `bun run typecheck`, `bun run lint`, and `bun run test` pass.
- Fatal failures always return `2`; strict fidelity violations return `3`.
- Config tolerance overrides are reflected in diff behavior and report contract tolerances.
- No silent drops for newly covered unsupported MIDI/MusicXML paths.
- `schema report` works outside repo root.

### Test Strategy

- Unit-style tests for exit code logic, config precedence, diff matching, and schema loading behavior.
- Adapter-focused tests for MIDI dangling notes and MusicXML timing/overwrite behavior.
- Golden tests updated only for intentional deterministic behavior corrections.

### Rollback Notes

- Refactors are modular and reversible (CLI module split and schema loader changes).
- Behavior changes are constrained to tested paths with stable issue-code additions only (append-only).

## Scope

Deliver a deterministic, test-backed CLI that converts MIDI and MusicXML with fidelity reporting via IR round-trip diffing. AAF/OMF are inspect-only in MVP with explicit unsupported reporting.

## Milestones

1. **Repo Scaffold + Tooling**
   - Initialize TypeScript project structure.
   - Add build, test, lint, format, typecheck scripts.
   - Add lefthook pre-commit and pre-push hooks.
   - Provide a minimal CLI entrypoint.

2. **Core IR + Canonicalization + Stable IDs**
   - Implement IR types and canonicalization rules.
   - Stable ID hashing (SHA-256, deterministic).
   - Unit tests for ordering and ID stability.

3. **Issues + Contracts + Diff Engine**
   - Implement issue code catalog and aggregation rules.
   - Define mapping contracts for core pairs.
   - Diff engine with tolerances and fidelity classification.

4. **Report Writers + Schema**
   - JSON report writer + schema output.
   - Markdown report writer.
   - Deterministic ordering for issues and summaries.

5. **IO + Config + Logging**
   - Atomic write utilities.
   - Config load/merge/validate with config hash.
   - Structured logging with levels.

6. **MIDI Adapter (Import/Export)**
   - SMF Type 0/1 import/export.
   - Tempo, time sig, notes, CC, pitch bend.
   - MIDI round-trip golden tests.

7. **MusicXML Adapter (Import/Export)**
   - Partwise import/export with quantization.
   - .mxl safe zip handling.
   - MIDI↔MusicXML golden tests and issues.

8. **CLI Commands + Orchestration**
   - `convert`, `inspect`, `validate`, `schema report`.
   - Conversion pipeline with IR re-import diffing.
   - Exit codes per policy.

9. **AAF/OMF Inspect-Only Adapters**
   - Inspect subset detection and reporting.
   - Convert path fails cleanly with issues.

10. **Polish + Docs + Fixtures**
    - Add fixtures and golden outputs.
    - Align `docs/` with behavior.
    - CI-ready scripts and deterministic output checks.

## Acceptance Criteria

- MIDI→MIDI round-trip yields PERFECT/EQUIVALENT for core events.
- MIDI→MusicXML on quantized fixtures yields ≥90% perfect pitch+duration notes.
- MusicXML→MIDI preserves core timing; repeats ignored with explicit issues.
- Report schema stable and deterministic ordering enforced.
- Strict policy returns exit code 3 when DROPPED/ERROR exist.

## Test Strategy

- Unit tests: canonicalization, ID hashing, diff tolerances, quantization helpers.
- Golden tests: MIDI↔MIDI and MIDI↔MusicXML report summaries.
- Negative tests: malformed MIDI/XML, zip-slip, decompression bomb.

## Rollback Notes

- Each milestone lands in small, reversible commits.
- Contracts and issue codes only expand, never rename.
