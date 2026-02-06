#!/bin/sh
set -eu

ROOT="${ROOT_DIR:-/workspace}"
OUT_DIR="$ROOT/.e2e-out/full"

. "$ROOT/test/e2e/lib/assert.sh"

log "Running full suite (includes smoke suite)"
sh "$ROOT/test/e2e/smoke.sh"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
assert_dir_exists "$OUT_DIR"

log "Determinism: repeated conversion should match byte-for-byte and normalized report"
DET_OUT="$OUT_DIR/determinism.mid"
DET_REPORT="$OUT_DIR/determinism.json"
DET_OUT_SNAPSHOT="$OUT_DIR/determinism-first.mid"
DET_REPORT_SNAPSHOT="$OUT_DIR/determinism-first.json"
run_expect_exit 0 umft convert "$ROOT/test/fixtures/simple.mid" --to midi --out "$DET_OUT" --report "$DET_REPORT" --overwrite --report-format json
cp "$DET_OUT" "$DET_OUT_SNAPSHOT"
cp "$DET_REPORT" "$DET_REPORT_SNAPSHOT"
run_expect_exit 0 umft convert "$ROOT/test/fixtures/simple.mid" --to midi --out "$DET_OUT" --report "$DET_REPORT" --overwrite --report-format json
cmp -s "$DET_OUT_SNAPSHOT" "$DET_OUT" || fail "deterministic midi output mismatch"
NORM_1="$OUT_DIR/determinism-1-normalized.json"
NORM_2="$OUT_DIR/determinism-2-normalized.json"
node "$ROOT/test/e2e/lib/json_assert.mjs" normalize "$DET_REPORT_SNAPSHOT" "$NORM_1"
node "$ROOT/test/e2e/lib/json_assert.mjs" normalize "$DET_REPORT" "$NORM_2"
cmp -s "$NORM_1" "$NORM_2" || fail "deterministic normalized report mismatch"

log "Exit code matrix: 0/1/2/3"
run_expect_exit 0 umft convert "$ROOT/test/fixtures/simple.mid" --to midi --out "$OUT_DIR/exit-0.mid" --report "$OUT_DIR/exit-0.json" --overwrite --report-format json
run_expect_exit 1 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --out "$OUT_DIR/exit-1.musicxml" --report "$OUT_DIR/exit-1.json" --overwrite --report-format json
run_expect_exit 2 umft convert "$OUT_DIR/missing.mid" --to midi --out "$OUT_DIR/exit-2.mid" --report "$OUT_DIR/exit-2.json" --report-format json
run_expect_exit 3 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --policy strict --out "$OUT_DIR/exit-3.musicxml" --report "$OUT_DIR/exit-3.json" --overwrite --report-format json

log "Config precedence: config policy/profile should apply when flags omitted"
STRICT_CONFIG="$OUT_DIR/strict-config.json"
cat >"$STRICT_CONFIG" <<'JSON'
{
  "policy": "strict",
  "profile": "default"
}
JSON
run_expect_exit 3 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --config "$STRICT_CONFIG" --out "$OUT_DIR/config-precedence.musicxml" --report "$OUT_DIR/config-precedence.json" --overwrite --report-format json
assert_file_contains "$OUT_DIR/config-precedence.json" "CORE_STRICT_POLICY_VIOLATION"

log "Tolerance overrides should appear in effective report contract"
TOLERANCE_CONFIG="$OUT_DIR/tolerance-config.json"
cat >"$TOLERANCE_CONFIG" <<'JSON'
{
  "diff": {
    "timingToleranceTicks": 7,
    "tempoToleranceBpm": 0.25,
    "velocityTolerance": 9
  }
}
JSON
run_expect_exit 1 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --config "$TOLERANCE_CONFIG" --out "$OUT_DIR/tolerance.musicxml" --report "$OUT_DIR/tolerance.json" --overwrite --report-format json
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/tolerance.json" "contract.tolerances.timingTicks" "7"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/tolerance.json" "contract.tolerances.tempoBpm" "0.25"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/tolerance.json" "contract.tolerances.velocity" "9"

log "MusicXML .mxl security: zip-slip and decompression limit"
run_expect_exit 2 umft convert "$ROOT/test/fixtures/zip-slip.mxl" --to midi --out "$OUT_DIR/zip-slip.mid" --report "$OUT_DIR/zip-slip.json" --report-format json
assert_file_contains "$OUT_DIR/zip-slip.json" "CORE_ZIP_SLIP_BLOCKED"
BIG_MXL="$OUT_DIR/oversize.mxl"
node -e "
const { createWriteStream } = require('node:fs');
const path = process.argv[1];
const yazl = require('yazl');
const zipfile = new yazl.ZipFile();
const containerXml = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\\n  <rootfiles>\\n    <rootfile full-path=\"score.xml\" media-type=\"application/vnd.recordare.musicxml+xml\"/>\\n  </rootfiles>\\n</container>';
zipfile.addBuffer(Buffer.from(containerXml, 'utf8'), 'META-INF/container.xml');
zipfile.addBuffer(Buffer.alloc(50 * 1024 * 1024 + 1024, 0x61), 'score.xml');
zipfile.end();
const out = createWriteStream(path);
zipfile.outputStream.pipe(out);
out.on('error', (error) => { console.error(error); process.exit(1); });
zipfile.outputStream.on('error', (error) => { console.error(error); process.exit(1); });
out.on('close', () => process.exit(0));
" "$BIG_MXL"
run_expect_exit 2 umft convert "$BIG_MXL" --to midi --out "$OUT_DIR/oversize.mid" --report "$OUT_DIR/oversize.json" --report-format json
assert_file_contains "$OUT_DIR/oversize.json" "CORE_DECOMPRESSION_LIMIT_EXCEEDED"

log "AAF/OMF inspect-only scope behavior"
AAF_FILE="$OUT_DIR/sample.aaf"
OMF_FILE="$OUT_DIR/sample.omf"
printf '\320\317\021\340\241\261\032\341sample' >"$AAF_FILE"
printf 'OMFI-sample' >"$OMF_FILE"
umft inspect "$AAF_FILE" --json >"$OUT_DIR/aaf-inspect.json"
umft inspect "$OMF_FILE" --json >"$OUT_DIR/omf-inspect.json"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/aaf-inspect.json" "format" "aaf"
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/omf-inspect.json" "format" "omf"
run_expect_exit 2 umft convert "$AAF_FILE" --to midi --out "$OUT_DIR/aaf.mid" --report "$OUT_DIR/aaf-convert.json" --report-format json
assert_file_contains "$OUT_DIR/aaf-convert.json" "CORE_UNSUPPORTED_CONVERSION_PAIR"
run_expect_exit 2 umft convert "$OMF_FILE" --to midi --out "$OUT_DIR/omf.mid" --report "$OUT_DIR/omf-convert.json" --report-format json
assert_file_contains "$OUT_DIR/omf-convert.json" "CORE_UNSUPPORTED_CONVERSION_PAIR"

log "Overwrite protection path"
OVERWRITE_OUT="$OUT_DIR/existing.musicxml"
printf '<existing/>' >"$OVERWRITE_OUT"
run_expect_exit 2 umft convert "$ROOT/test/fixtures/simple.mid" --to musicxml --out "$OVERWRITE_OUT" --report "$OUT_DIR/overwrite.json" --report-format json
assert_file_contains "$OUT_DIR/overwrite.json" "CORE_OUTPUT_PATH_EXISTS"

log "Schema report command from non-repo CWD"
(
  cd /tmp
  umft schema report >"$OUT_DIR/schema.json"
)
node "$ROOT/test/e2e/lib/json_assert.mjs" equals "$OUT_DIR/schema.json" "title" "UMFT Conversion Report"

log "Full suite passed"
