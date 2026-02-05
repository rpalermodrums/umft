# UMFT Contracts (v0.1)

This document describes the mapping contracts implemented in `src/core/contracts/`.

## Element Taxonomy

- Timing: `tempo`, `timesig`
- Structure/metadata: `marker`, `text`
- Musical events: `note`, `lyric`, `dynamic`, `articulation`
- Performance controls: `cc`, `pitchbend`
- Media: `audioClip`

Expectations:

- `lossless`: must be preserved (missing is ERROR)
- `equivalent`: semantics preserved (representation may differ)
- `approximate`: expected approximation
- `unsupported`: expected to drop

## Contracts

### midi->midi@1.0

| Element      | Expectation |
| ------------ | ----------- |
| tempo        | lossless    |
| timesig      | lossless    |
| marker       | equivalent  |
| note         | lossless    |
| cc           | lossless    |
| pitchbend    | lossless    |
| lyric        | equivalent  |
| text         | equivalent  |
| dynamic      | unsupported |
| articulation | unsupported |
| audioClip    | unsupported |

### midi->musicxml@1.0

| Element      | Expectation |
| ------------ | ----------- |
| tempo        | approximate |
| timesig      | approximate |
| marker       | equivalent  |
| note         | approximate |
| cc           | unsupported |
| pitchbend    | unsupported |
| lyric        | approximate |
| text         | equivalent  |
| dynamic      | approximate |
| articulation | approximate |
| audioClip    | unsupported |

### musicxml->midi@1.0

| Element      | Expectation |
| ------------ | ----------- |
| tempo        | approximate |
| timesig      | lossless    |
| marker       | equivalent  |
| note         | lossless    |
| cc           | unsupported |
| pitchbend    | unsupported |
| lyric        | approximate |
| text         | equivalent  |
| dynamic      | approximate |
| articulation | approximate |
| audioClip    | unsupported |

### generic@1.0

Fallback when no specific contract exists.

| Element      | Expectation |
| ------------ | ----------- |
| note         | approximate |
| tempo        | approximate |
| timesig      | approximate |
| marker       | equivalent  |
| text         | equivalent  |
| cc           | unsupported |
| pitchbend    | unsupported |
| lyric        | unsupported |
| dynamic      | unsupported |
| articulation | unsupported |
| audioClip    | unsupported |
