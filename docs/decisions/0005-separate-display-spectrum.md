# 0005. Display spectrum separate from the decoder

Status: accepted, 2026-10-13

## Context

The waterfall needs a steady frame rate on a phone, while decoder experiments keep changing FFT sizes, windows and time steps.

## Decision

The waterfall computes its own spectrum in TypeScript in a worker with OffscreenCanvas. The decoder computes its spectrogram in `rr73-dsp`, configured per experiment.

## Consequences

- Decoder experiments never affect display performance.
- The project maintains two FFT paths, both of them small.
