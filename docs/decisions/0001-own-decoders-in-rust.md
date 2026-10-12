# 0001. Own decoders, written in Rust

Status: accepted, 2026-10-13

## Context

iFTx decodes slowly and finds fewer stations than WSJT-X. ft8_lib (MIT) finds 8 decodes on WSJT-X's sample file, where WSJT-X finds 19 at Normal depth. The decoders that beat WSJT-X (JTDX, jtdx_contest, WSJT-X's multithreaded decoder) are GPL.

## Decision

Write the FT8 and FT4 decoders from the protocol paper (Franke, Somerville and Taylor, QEX 2020) in Rust, compiled to WebAssembly for the app and natively for the bench. ft8_lib serves as a bit-exact oracle for the codec and may be ported with attribution. GPL decoder code is never read.

## Consequences

- The project stays MIT OR Apache-2.0.
- Decoder quality is measured, never assumed: every decoder change carries bench numbers against `jt9`.
- More upfront work than wrapping ft8_lib.
