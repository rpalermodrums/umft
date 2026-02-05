# UMFT Issue Codes (v0.1)

This catalog is **normative** for the codes currently implemented in the codebase. Additional codes from the full spec will be added as those features land. Codes listed here are stable and must not be renamed without a version bump.

## CORE\_\*

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

- `MIDI_SMPTE_TIME_DIVISION_APPROXIMATED`
  - Severity: WARN | Category: TIMING
  - Trigger: SMPTE time division encountered; approximated to PPQ.
  - Message: SMPTE timing approximated to PPQ={ppq}.

- `MIDI_NOTE_OFF_MISSING`
  - Severity: WARN | Category: TIMING
  - Trigger: Note-on without matching note-off.
  - Message: Missing note-off; note closed at end of track: pitch={pitch}, ch={channel}.
