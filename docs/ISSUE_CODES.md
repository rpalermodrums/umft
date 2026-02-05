# UMFT Issue Codes (v0.1)

This catalog is **normative** for the codes currently implemented in the codebase. Additional codes from the full spec will be added as those features land. Codes listed here are stable and must not be renamed without a version bump.

## CORE\_\*

- `CORE_INPUT_NOT_FOUND`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Input path missing/unreadable.
  - Message: Input not found or unreadable: {path}.

- `CORE_INPUT_UNSUPPORTED_FORMAT`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Format detection fails or unsupported input.
  - Message: Unsupported or unrecognized input format: {path}.

- `CORE_UNSUPPORTED_CONVERSION_PAIR`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: No adapter path or contract for {from}->{to}.
  - Message: Unsupported conversion pair: {from} -> {to}.

- `CORE_ATOMIC_WRITE_FAILED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Temp write/rename/fsync fails.
  - Message: Atomic write failed for {path}: {reason}.

- `CORE_CONFIG_INVALID`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Config schema validation fails or config cannot be parsed.
  - Message: Invalid config: {details}.

- `CORE_CONFIG_UNKNOWN_KEYS`
  - Severity: WARN | Category: STRUCTURE
  - Trigger: Unknown config keys encountered.
  - Message: Unknown config keys ignored: {keys}.

- `CORE_NO_SPECIFIC_CONTRACT`
  - Severity: WARN | Category: STRUCTURE
  - Trigger: No specific contract found; generic fallback used.
  - Message: No specific contract for {from}->{to} (profile {profile}); using generic rules.

- `CORE_STRICT_POLICY_VIOLATION`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Strict policy with any DROPPED/ERROR elements.
  - Message: Strict policy violation: {dropped} dropped, {errors} errors.

- `CORE_OUTPUT_PATH_EXISTS`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Output path exists and overwrite disabled.
  - Message: Output already exists: {path}. Use --overwrite to replace.

- `CORE_TIME_SIGNATURE_DEFAULTED`
  - Severity: WARN | Category: TEMPO
  - Trigger: No time signatures detected; defaulted to 4/4 from start.
  - Message: No time signatures detected; defaulted to 4/4 from start.

- `CORE_ZIP_SLIP_BLOCKED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Zip entry attempts directory traversal.
  - Message: Blocked unsafe zip path: {entryName}.

- `CORE_DECOMPRESSION_LIMIT_EXCEEDED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Decompressed size exceeds configured limit.
  - Message: Decompression limit exceeded while reading {path}.

## DIFF\_\*

- `DIFF_ROUNDTRIP_IMPORT_FAILED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Re-import of exported output fails.
  - Message: Round-trip verification failed: could not re-import output ({reason}).

- `DIFF_ELEMENT_DROPPED`
  - Severity: WARN | Category: STRUCTURE
  - Trigger: Element present in IR₀ missing in IR₁, expectation not lossless.
  - Message: Element dropped during conversion ({elementKind}).

- `DIFF_ELEMENT_MISSING_LOSSLESS`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Element dropped but contract expects lossless.
  - Message: Lossless element missing after conversion: {elementKind}.

- `DIFF_TIMING_MISMATCH_OVER_TOLERANCE`
  - Severity: WARN | Category: TIMING
  - Trigger: Tick differs beyond tolerance.
  - Message: Timing mismatch over tolerance ({tolerance} ticks): {count} events.

- `DIFF_DURATION_MISMATCH_OVER_TOLERANCE`
  - Severity: WARN | Category: TIMING
  - Trigger: Duration differs beyond tolerance.
  - Message: Duration mismatch over tolerance: {count} notes.

- `DIFF_TEMPO_MISMATCH_OVER_TOLERANCE`
  - Severity: WARN | Category: TEMPO
  - Trigger: Tempo differs beyond tolerance.
  - Message: Tempo mismatch over tolerance ({tolerance} BPM): {count} events.

- `DIFF_TIME_SIGNATURE_MISMATCH`
  - Severity: WARN | Category: TEMPO
  - Trigger: Time signatures differ.
  - Message: Time signature mismatch: {count} events.

- `DIFF_PITCH_MISMATCH`
  - Severity: ERROR | Category: NOTATION
  - Trigger: Pitch differs for matched note ID.
  - Message: Pitch mismatch detected: {count} notes.

- `DIFF_VELOCITY_MISMATCH_OVER_TOLERANCE`
  - Severity: WARN | Category: CONTROLLERS
  - Trigger: Velocity differs beyond tolerance.
  - Message: Velocity mismatch (> {tolerance}): {count} notes.

- `DIFF_CONTROLLER_VALUE_MISMATCH`
  - Severity: WARN | Category: CONTROLLERS
  - Trigger: CC value differs beyond tolerance or controller missing.
  - Message: Controller mismatch: CC{controller} affected ({count} events).

- `DIFF_MARKER_MISMATCH`
  - Severity: INFO | Category: METADATA
  - Trigger: Marker/name/time differs.
  - Message: Marker differences detected: {count} markers.

- `DIFF_TRACK_MAPPING_CHANGED`
  - Severity: INFO | Category: STRUCTURE
  - Trigger: Track counts or grouping changed.
  - Message: Track mapping changed: {tracksIn} -> {tracksOut}.

- `DIFF_ADDED_ELEMENTS_IGNORED`
  - Severity: INFO | Category: STRUCTURE
  - Trigger: IR₁ contains extra elements; ignored in diff.
  - Message: Additional elements created by exporter were ignored in diff: {count}.

- `DIFF_UNKNOWN_KIND_SKIPPED`
  - Severity: WARN | Category: STRUCTURE
  - Trigger: Diff engine sees unknown event kind.
  - Message: Unknown IR element kind skipped during diff: {kind}.

## MIDI\_\*

- `MIDI_UNSUPPORTED_HEADER`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Header invalid / unsupported.
  - Message: Unsupported or invalid MIDI header: {details}.

- `MIDI_RUNNING_STATUS_MALFORMED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Running status sequence invalid.
  - Message: Malformed running status at byte {offset}.

- `MIDI_SMPTE_TIME_DIVISION_APPROXIMATED`
  - Severity: WARN | Category: TIMING
  - Trigger: SMPTE time division encountered; approximated to PPQ.
  - Message: SMPTE timing approximated to PPQ={ppq}.

- `MIDI_NOTE_OFF_MISSING`
  - Severity: WARN | Category: TIMING
  - Trigger: Note-on without matching note-off.
  - Message: Missing note-off; note closed at end of track: pitch={pitch}, ch={channel}.

## MXML\_\*

- `MXML_PARSE_FAILED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: XML parse error.
  - Message: MusicXML parse failed: {reason}.

- `MXML_COMPRESSED_MXL_READ_FAILED`
  - Severity: ERROR | Category: STRUCTURE
  - Trigger: Failed to read compressed MusicXML (.mxl).
  - Message: Failed to read compressed MusicXML (.mxl): {reason}.

- `MXML_QUANTIZATION_APPLIED`
  - Severity: WARN | Category: TIMING
  - Trigger: Quantization changed note onsets/offsets.
  - Message: Quantization applied to {count} notes (grid {grid}).

- `MXML_QUANTIZATION_CONFLICT_RESOLVED`
  - Severity: WARN | Category: TIMING
  - Trigger: Quantization created overlaps/zero durations; corrected.
  - Message: Quantization conflicts resolved (overlaps/zero durations): {count} notes.

- `MXML_NOTE_SPLIT_ACROSS_MEASURES`
  - Severity: INFO | Category: NOTATION
  - Trigger: Notes split into tied segments across measure boundaries.
  - Message: Notes split across measures with ties: {count} notes.

- `MXML_UNREPRESENTABLE_DURATION_TIED`
  - Severity: WARN | Category: NOTATION
  - Trigger: Duration cannot be expressed as a single note type; emitted ties.
  - Message: Unrepresentable durations expressed with ties: {count} notes.

- `MXML_DIVISIONS_CLAMPED`
  - Severity: WARN | Category: NOTATION
  - Trigger: Computed divisions exceeded max; clamped.
  - Message: Divisions clamped from {computed} to {max} to limit complexity.

- `MXML_DURATION_ROUNDED`
  - Severity: WARN | Category: TIMING
  - Trigger: Tick-to-duration rounding above threshold.
  - Message: Duration rounded during import/export: {count} notes affected.
