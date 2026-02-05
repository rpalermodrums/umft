# UMFT MVP Execution Plan

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
