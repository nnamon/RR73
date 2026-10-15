# 0009. A priori decoding from the QSO under way

Status: accepted, 2026-10-15

## Context

In a QSO the next message is predictable. The other station's reply starts with the operator's callsign and its own, and the last messages are RRR, RR73 or 73. A decoder that knows those bits can fix them before the LDPC decoder runs, or test a whole message against the channel, and so decode messages too weak for a decode from scratch. The QEX paper on FT4 and FT8 describes this as a priori (AP) decoding. RR73's decoders had none: `DecodeContext` carried the callsign hashes only.

## Decision

- The app gives the decoder the QSO under way with each slot: the operator's callsign, and during a QSO the station being worked and its audio frequency (`qsoContextNow` in `web/src/lib/state/qso.svelte.ts`, `set_qso_context` in `crates/rr73-wasm`, `DecodeContext::ap` in `crates/rr73-decode`). Without a callsign, or with a compound callsign (VK3/9V1NE, sent hashed), no hypothesis applies.
- Hypotheses come from template messages, so the bit layout of each message type stays in the codec (`crates/rr73-decode/src/ap.rs`):
  - `my`: the first callsign field is the operator's (29 code bits).
  - `my_dx`: both callsigns and the message type (61 code bits).
  - `rrr`, `rr73`, `73`: the whole message, all 174 code bits.
- A candidate that fails to decode, or whose codeword fails validation, is tried again. Whole messages come first: the one whose codeword the channel's hard decisions agree with most, if it differs in at most 50 bits, with no LDPC decode. Then `my_dx`, then `my`: the known bits' LLRs are set to ±30, the LDPC decoder runs again, and the codeword must keep the known bits, pass the CRC and the validator, and differ from the channel's hard decisions in at most 45 bits (`my_dx`) or 36 (`my`). AP decodes may report down to -30 dB (`ap.min_snr_db`).
- The QSO hypotheses apply within 50 Hz of the other station's frequency. `my` applies anywhere in the shipped preset, there with belief propagation only, without OSD, which took most of its time. The two later FT8 stages (decision 0007) keep `my` near the other station (`ap.my_anywhere=false`).
- Each decode records the hypothesis that found it (`ap` in the decode and in bench results). The app does not show it.
- CI gates a priori decoding with the shipped preset on the `ap-sweep` set (10 slots per SNR step and subset, 300 noise slots) against `bench/subtract-3-osd2-ap.json`, thresholds in `bench/gate-ap.toml`.

## Measurements

The `ap-sweep` set: messages to 9V1NE from -30 to -18 dB in AWGN, 40 per step and subset. `qso` holds K1ABC's messages ending in turn with a report, an R-report, RRR, RR73 and 73, with the context giving K1ABC's frequency. `callers` holds messages from other stations with a grid, the partner's frequency unknown. `noise` holds 10000 noise slots with the full context and the partner at a frequency drawn from the seed. Release build in the `rust` container on the Apple M4 (10 CPUs), preset `subtract-3-osd2`.

| Set | AP off | AP on |
| --- | --- | --- |
| `qso`, SNR50 | -19.03 dB | -21.70 dB |
| `qso`, recall from -30 to -18 dB | 0.119 (62) | 0.323 (168) |
| `callers`, SNR50 (`my` with OSD) | -18.92 dB | -19.74 dB |
| `callers`, SNR50 (`my` with belief propagation only, shipped) | -18.92 dB | -19.39 dB |
| False decodes: 10000 noise slots, `qso`, `callers` | 0 | 0 |

The limits come from a sweep. With both partial limits at 50, one false decode appeared in 5000 noise slots; at 55 the whole-message test took the first message under the limit and confused RRR and RR73. With the closest whole message taken, 5 confusions remained at 55 and none at 50. On the SARTS recordings, a context for stations not on the air (K9ZZZ with W1XYZ at 1500 Hz) gave one false decode from `my` with a limit of 45 ("K9ZZZ K45MZV R DH78", 45 hard errors); true `my` decodes in the sweep had at most 34, so `my` takes 36. With 36, five contexts on the 410 recorded slots (2050 slot runs) gave no false decode and lost none.

Time per slot on the 410 recorded slots, mean (p90): preset alone 62 ms (122 ms); with `my` anywhere and OSD 83 ms (170 ms); with `my` anywhere, belief propagation only, as shipped 74 ms (145 ms); `my` near the partner only 65 ms (127 ms). The app's three stages: 494 ms (753 ms) without a priori decoding, 515 ms (820 ms) with it.

## Alternatives rejected

- `my` with OSD anywhere: 0.3 dB more for callers at a third more decode time.
- One limit for every hypothesis: `my`, tried on every candidate in the band, needs the tightest one.
- The first whole message under the limit: RRR, RR73 and 73 differ in few bits, and the first could be the wrong one.
- Reports in the whole-message test: 61 more hypotheses per candidate; `my_dx` decodes reports already.

## Open risks

- The synthetic set is AWGN with steady signals; fading, drift and a QSO partner who moves frequency are not measured.
- 2050 slot runs bound the false rate on real recordings only loosely. A false `my` decode is a message to the operator from a station that is not there; the sequencer would answer it.
- Not tested on a device: the decode time on an iPhone, where the stages already take most of the 2 s budget on busy bands.
