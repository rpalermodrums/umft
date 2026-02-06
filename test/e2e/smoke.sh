#!/bin/sh
set -eu

ROOT="${ROOT_DIR:-/workspace}"
OUT_DIR="$ROOT/.e2e-out/smoke"

. "$ROOT/test/e2e/lib/assert.sh"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
assert_dir_exists "$OUT_DIR"

log "Sanity: help + version"
umft --help >/dev/null
VERSION="$(umft --version)"
assert_text_contains "$VERSION" "0.1.0" "umft version output"

log "Convert: midi -> midi with report"
MIDI_OUT="$OUT_DIR/simple.mid"
MIDI_REPORT="$OUT_DIR/simple-report.json"
run_expect_exit 0 umft convert "$ROOT/test/fixtures/simple.mid" --to midi --out "$MIDI_OUT" --report "$MIDI_REPORT" --overwrite --report-format json
assert_file_exists "$MIDI_OUT"
assert_file_exists "$MIDI_REPORT"
node "$ROOT/test/e2e/lib/json_assert.mjs" exists "$MIDI_REPORT" "reportSchemaVersion"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$MIDI_REPORT" "input.format" "midi"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$MIDI_REPORT" "output.format" "midi"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$MIDI_REPORT" "summary.errors" "0"

log "Convert: midi -> musicxml strict should fail with policy violation"
STRICT_OUT="$OUT_DIR/strict.musicxml"
STRICT_REPORT="$OUT_DIR/strict-report.json"
run_expect_exit 3 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --policy strict --out "$STRICT_OUT" --report "$STRICT_REPORT" --overwrite --report-format json
assert_file_exists "$STRICT_OUT"
assert_file_exists "$STRICT_REPORT"
assert_file_contains "$STRICT_REPORT" "CORE_STRICT_POLICY_VIOLATION"

log "Convert: missing input should be fatal"
MISSING_OUT="$OUT_DIR/missing.mid"
MISSING_REPORT="$OUT_DIR/missing-report.json"
run_expect_exit 2 umft convert "$OUT_DIR/does-not-exist.mid" --to midi --out "$MISSING_OUT" --report "$MISSING_REPORT" --report-format json
assert_file_exists "$MISSING_REPORT"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$MISSING_REPORT" "issues[0].code" "CORE_INPUT_NOT_FOUND"

log "Inspect and validate text/json modes"
INSPECT_TEXT="$OUT_DIR/inspect.txt"
umft inspect "$ROOT/test/fixtures/simple.mid" >"$INSPECT_TEXT"
assert_file_contains "$INSPECT_TEXT" "Format: midi"
INSPECT_JSON="$OUT_DIR/inspect.json"
umft inspect "$ROOT/test/fixtures/simple.mid" --json >"$INSPECT_JSON"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$INSPECT_JSON" "format" "midi"
VALIDATE_JSON="$OUT_DIR/validate.json"
run_expect_exit 0 sh -c "umft validate '$ROOT/test/fixtures/simple.mid' --json > '$VALIDATE_JSON'"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$VALIDATE_JSON" "status" "PASS"

log "Invalid enum option should return scriptable single-line error"
INVALID_STDOUT="$OUT_DIR/invalid.stdout"
INVALID_STDERR="$OUT_DIR/invalid.stderr"
set +e
umft convert "$ROOT/test/fixtures/simple.mid" --to wav >"$INVALID_STDOUT" 2>"$INVALID_STDERR"
INVALID_STATUS=$?
set -e
assert_exit_code "$INVALID_STATUS" "2" "invalid --to option"
assert_file_contains "$INVALID_STDERR" "[ERROR]"
LINE_COUNT="$(wc -l < "$INVALID_STDERR" | tr -d ' ')"
assert_eq "$LINE_COUNT" "1" "invalid option stderr line count"

log "Smoke suite passed"
