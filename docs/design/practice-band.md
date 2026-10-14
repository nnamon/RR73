# Practice band

A simulated FT8 and FT4 band for practising and testing calling CQ, answering CQs and logging with no radio connected. Settings › Practice band turns it on; it is off by default. Code lives in `web/src/lib/practice/`.

## Decision

The practice band is audio. Each slot's transmissions are synthesised with rr73-wasm's `synthesize`, mixed at their SNR into white noise and fed into the capture path the microphone uses. The waterfall, the slot assembler, the decoder, the decode list and the sequencer then run unchanged, so practice exercises the same code as the air.

- **Input seam.** `lib/audio/input.ts` defines `InputSource`: `open(ctx)` returns an audio node that the capture engine connects to the capture worklet. `microphoneInput` holds the `getUserMedia` code that was in the engine; `PracticeInput` (`practice/source.ts`) is the band. `CaptureEngine.useSource` switches between them. Nothing else in the engine changed: clock mapping and chunk stamps are as before. The practice band never calls `getUserMedia`, so it needs no microphone permission.
- **Audio.** A 9.7 s noise buffer at 12 kHz loops without a break (RMS 0.02, the channel simulator's reference). Each slot is rendered 1.5 s (FT8) or 1.0 s (FT4) before it starts and scheduled on the audio clock at the slot's UTC start: `currentTime + (slotStart − Date.now()) / 1000`. Transmissions start 0.5 s plus their DT into the slot. SNR follows the WSJT-X convention: signal power against noise power in 2500 Hz. Buffers are 12 kHz; the context resamples them to its rate and the worklet back to 12 kHz, as it does the microphone. The band's node connects only to the worklet, so nothing plays through the speaker.
- **Stations** (`practice/sim.ts`). Each slot carries 8 to 15 stations, or 25 to 40 with Crowded band on, from −24 dB to +5 dB. 30 % fade (QSB of 6 to 15 dB peak to peak, period 3 to 10 s). Callsigns and grids come from a weighted table of 30 countries. Every station reacts to the messages of the slot before as an operator with auto-sequencing does, so stations work each other through grid, report, R-report and RR73 or 73, and some messages are missed and repeated. CQ DX and CQ NA stations answer only the continents they ask for.
- **The operator's transmissions** reach the band from the sequencer: the slot after a transmission reads `qso.sent`, so no audio round trip is needed. A station the operator calls, or a station answering the operator's CQ, follows the scenario.
- **Determinism.** The band is a pure function of its seed and the operator's transmissions. Each station draws its decisions from its own seeded generator. Unit tests fix the seed; the app draws a new one at start.

## Scenarios

Chosen from ••• in Operate while practice is on. A new scenario applies to the stations already on the band from their next call.

| Menu item | Behaviour |
| --- | --- |
| Practice: Random band | A CQ gets 1 caller, a pile-up, a caller who goes quiet or one who misses RR73, or nobody. A called station answers (60 %), works another first (25 %) or never answers (15 %). |
| Practice: One caller | A CQ gets 1 caller, who completes the QSO. |
| Practice: Pile-up | A CQ gets 3 to 5 callers. Those not worked keep calling, more often as a QSO ends. |
| Practice: Caller goes quiet | The caller stops after the operator's report. |
| Practice: Caller misses RR73 | The caller sends his R-report again after the first RR73, then 73. |
| Practice: Station answers | A called station answers with a report and ends with RR73. |
| Practice: Station works another | A called station answers another caller, works him to RR73 or 73, then answers the operator 60 % of the time if he is still calling. |
| Practice: Station never answers | A called station keeps calling CQ. |
| Practice: Fox (DXpedition) | A Fox works 3 Hounds a slot in FT8 DXpedition mode and answers the operator after 2 to 4 calls at 1000 Hz or above, with the report alone or in a multi-call message. It replaces the band while chosen (`practice/fox.ts`, `docs/design/hound.md`). |
| Practice: CQ DX and CQ NA | The band carries CQ DX and CQ NA in every slot. CQ NA answers only North America; CQ DX answers only other continents. |

## Isolation

Nothing from practice reaches the log, Wavelog or the network.

- **Practice log.** A second IndexedDB database, `rr73-practice`, with the same stores as `rr73`. `lib/log/store.ts` picks the database each write goes to before its first await, so a write lands where it was made. Turning practice on or off reloads the log screens from the chosen database. Clear practice log empties the practice database's QSOs, ledger and activations in one transaction and offers Undo for 10 s.
- **Wavelog stand-in** (`practice/wavelog-stand-in.ts`). The practice log's Wavelog points at `https://wavelog.invalid` and the log's fetch is replaced (`setFetch`) by a function on the phone that answers as Wavelog's API does. One callsign in 4, chosen by a hash so tests know which, is refused on the first attempt as Wavelog refuses a band missing from the station location's configuration; Send again delivers it.
- **Network guard** (`practice/guard.ts`). `main.ts` wraps `window.fetch` once. While practice is on, a request goes out only when it is same origin and GET or HEAD: the app's own files. Spots, cluster and LoTW downloads, Wavelog and later reporting all use fetch.
- **Settings.** Practice state is stored under its own kv key, `practice`, outside the settings record, so the settings schema and its migrations are untouched.

## Tests

- `practice/sim.test.ts` drives the real sequencer (`lib/testing/qso-sim.ts`) against the band, one scenario at a time with fixed seeds, and checks station counts, SNR range, fading, QSOs between practice stations, determinism and that every message packs.
- `practice/render.test.ts` checks SNR calibration, timing and fading, and decodes a rendered slot with the wasm decoder.
- `practice/practice-log.test.ts` logs and sends in practice on fake IndexedDB and checks that the log, its Wavelog settings and the page's fetch are untouched.
- `practice/guard.test.ts` covers the guard for strings, URLs and Request objects.
- `e2e/practice.spec.ts` (project `practice`) turns practice on in Chromium with no microphone and checks the tag and decodes, a CQ QSO logged to the practice log, an answered CQ, the station who works another, the log untouched afterwards, the guard, the Wavelog stand-in and Clear practice log with Undo. Every test fails if a request leaves for another origin or with a method other than GET or HEAD.

## Alternatives rejected

- **Decodes without audio.** Injecting decode results would skip the waterfall, the slot assembler, timing and the decoder, which are what practice should exercise.
- **Rendering in a worker of its own.** Synthesis goes through the decoder worker's encoder, which is idle when a slot is rendered (1.5 s before the slot, after the previous decode). Mixing 15 signals takes a few ms on the main thread.
- **A namespaced store in `rr73`.** Adding stores needs a database version change, which waits for every other open copy of RR73 to close (ADR 0003). A second database needs no upgrade.
- **Practice state in the settings record.** Another change bumps the settings schema; a key of its own avoids two migrations meeting.
- **Blocking only the known senders.** One guard at fetch covers senders added later.

## Open risks

- Not tested on a device. iOS timing of a 12 kHz buffer scheduled ahead on the audio clock is unverified.
- Practice stays on across a reload. The Practice badge in Operate's top bar and the Practice log title show it.
- The guard covers fetch on the page. Workers fetch only the app's own files today; `navigator.sendBeacon`, WebSocket and XMLHttpRequest are not guarded because RR73 does not use them.
- Slot audio is scheduled against `currentTime` paired with `Date.now()`, off by the output latency (tens of ms), which the DT-based offset correction absorbs.
