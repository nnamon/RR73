# Practice band

A simulated FT8 and FT4 band for practising and testing calling CQ, answering CQs and logging with no radio connected. Settings › Practice band turns it on; it is off by default. Code lives in `web/src/lib/practice/`.

## Decision

The practice band is audio. Each slot's transmissions are synthesised with rr73-wasm's `synthesize`, mixed at their SNR into white noise and fed into the capture path the microphone uses. The waterfall, the slot assembler, the decoder, the decode list and the sequencer then run unchanged, so practice exercises the same code as the air.

- **Input seam.** `lib/audio/input.ts` defines `InputSource`: `open(ctx)` returns an audio node that the capture engine connects to the capture worklet. `microphoneInput` holds the `getUserMedia` code that was in the engine; `PracticeInput` (`practice/source.ts`) is the band. `CaptureEngine.useSource` switches between them. Nothing else in the engine changed: clock mapping and chunk stamps are as before. The practice band never calls `getUserMedia`, so it needs no microphone permission.
- **Audio.** A 9.7 s noise buffer at 12 kHz loops without a break (RMS 0.02, the channel simulator's reference). Each slot is rendered 2.5 s (FT8) or 2.0 s (FT4) before it starts, after the operator's latest start in the slot before, and scheduled on the audio clock at the slot's UTC start: `currentTime + (slotStart − Date.now()) / 1000`. Transmissions start 0.5 s plus their DT into the slot. A buffer starts earlier when a transmission starts before the slot, and runs past the slot end when one ends after it; buffers that overlap mix. SNR follows the WSJT-X convention: signal power against noise power in 2500 Hz. Buffers are 12 kHz; the context resamples them to its rate and the worklet back to 12 kHz, as it does the microphone. The band's node connects only to the worklet, so nothing plays through the speaker.
- **Stations** (`practice/sim.ts`). Each slot carries 8 to 15 stations, or 25 to 40 with Crowded band on, from −24 dB to +5 dB. 30 % fade (QSB of 6 to 15 dB peak to peak, period 3 to 10 s). Callsigns and grids come from a weighted table of 30 countries, with real prefixes and drawn suffixes. On the random, activation and weak bands 8 % of CQs and 5 % of callers sign a compound callsign: /P, /M or a portable prefix (F/G4XYZ). /P packs as a standard callsign; the others call CQ without a grid, send their call in full in calls and 73 and hashed in reports and RR73, and half of them are heard first in a QSO, hashed, so the decoder shows `<...>` until their next full message.
- **The band as on the air.** Each station's surroundings come from a seeded stream of its own, so they leave the band's other choices alone.
  - DT: most stations −0.5 to +0.8 s, 15 % +0.8 to +2.5 s, 3 % several seconds off (+2.6 to +4 s, or −1 to −2 s). Stations the scenario relies on keep to −0.3 to +0.6 s, now and then up to 1.4 s.
  - 15 % of background stations drift 0.02 to 0.3 Hz/s, through each transmission and between them. 8 % of background stations sit 3 to 20 Hz from another in the same slot.
  - 20 % of background paths (10 % of the scenario's stations, gentler) carry two-path fading after the Watterson model: Doppler spread 0.1 to 1.5 Hz, the second path 0.5 to 3 ms later, each path's gain a sum of 8 complex sinusoids (render.ts). The gains and the drift act on the signal's analytic form, whose quadrature part is the signal delayed by a quarter period of its centre frequency.
  - The band opens and closes over 10 to 20 minutes each way. The station count follows it, the strongest new stations come in up to 10 dB lower on a closed band, and a background station's level moves with it by up to 14 dB, most for stations on other continents, until it fades under −26 dB and leaves.
  - `conditions()` gives each slot a noise floor 0 to 3 dB over the band's own (3 to 6 dB in Weak and crowded), changing smoothly from slot to slot, static crashes in about 15 % of slots and, now and then, a carrier for 1 to 4 minutes. SNRs count the risen floor for background stations; the scenario's stations keep theirs.
  - Callers: on the random band some open with a report and end with 73 in place of RR73, some called stations end with 73, 25 % of the operator's QSOs from CQ get a tail-ender, and 15 % of CQs a late caller a cycle later. Every station reacts to the messages of the slot before as an operator with auto-sequencing does, so stations work each other through grid, report, R-report and RR73 or 73, and some messages are missed and repeated. CQ DX and CQ NA stations answer only the continents they ask for.
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
| Practice: Caller misses RR73 | The caller sends its R-report again after the first RR73, then 73. |
| Practice: Station answers | A called station answers with a report and ends with RR73. |
| Practice: Station works another | A called station answers another caller, works that station to RR73 or 73, then answers the operator 60 % of the time if the operator is still calling. |
| Practice: Station never answers | A called station keeps calling CQ. |
| Practice: Activation callers | Each CQ gets 1 or 2 callers, 80 % of QSOs a tail-ender and 30 % of CQs a late caller, so Repeat CQ runs an activation to 10 QSOs in about 15 minutes. |
| Practice: Weak and crowded | A CQ gets 1 to 3 callers near −22 dB, on a band of 25 to 40 stations with the noise 3 to 6 dB up and more static crashes. |
| Practice: Station answers someone else | A called station answers another caller each time the operator calls, so the QSO is lost every time. |
| Practice: Hunt: a station calls you | The stations calling CQ never answer; each new station the operator calls brings another station calling the operator, which Hunt answers first. |
| Practice: Contest exchanges | The band carries CQ FD and CQ RU from the US and Canada and CQ TEST from Europe. They reply in their format: their exchange to a call, R and their exchange to the operator's. Callers to the operator's CQ come in Field Day and Roundup formats (their exchange first) and EU VHF (the grid, then type 5), the format the CQ names or any of the three. They keep calling while Contest exchange lacks a part. |
| Practice: Worked stations | The practice log gets 6 QSOs: 2 today on this band and mode (dupes), 2 on earlier days, 1 today on another band, 1 on another mode. Those stations call CQ on the band, and a dupe calls each CQ of the operator's with a new station. |
| Practice: New ones | The practice log gets a QSO on earlier days with a station from each of the band's 30 entities. The band carries at least 2 CQs a slot from 14 entities it otherwise leaves out, in grids the log does not hold; an entity worked here gives way to others. |
| Practice: Clock off | Every station is 1.5 s early or late (one of the two for the band), so the Clock badge comes up and Correct Tx timing has an error to correct. |
| Practice: Fox (DXpedition) | A Fox works 3 Hounds a slot in FT8 DXpedition mode and answers the operator after 2 to 4 calls at 1000 Hz or above, with the report alone or in a multi-call message. It replaces the band while chosen (`practice/fox.ts`, `docs/design/hound.md`). |
| Practice: CQ DX and CQ NA | The band carries CQ DX and CQ NA in every slot. CQ NA answers only North America; CQ DX answers only other continents. |

## Isolation

Nothing from practice reaches the log, Wavelog or the network.

- **Seeded QSOs.** Worked stations and New ones write their QSOs to the practice database directly (`practice/seed-log.ts`), whichever log is in use when the write lands, once for each band and scenario, and again when the scenario is chosen again; a QSO already there (callsign, band, mode, UTC day) is not added twice. They carry the comment `Practice: <scenario>` and no ledger entries, so nothing sends them.
- **Practice log.** A second IndexedDB database, `rr73-practice`, with the same stores as `rr73`. `lib/log/store.ts` picks the database each write goes to before its first await, so a write lands where it was made. Turning practice on or off reloads the log screens from the chosen database. Clear practice log empties the practice database's QSOs, ledger and activations in one transaction and offers Undo for 10 s.
- **Wavelog stand-in** (`practice/wavelog-stand-in.ts`). The practice log's Wavelog points at `https://wavelog.invalid` and the log's fetch is replaced (`setFetch`) by a function on the phone that answers as Wavelog's API does. One callsign in 4, chosen by a hash so tests know which, is refused on the first attempt as Wavelog refuses a band missing from the station location's configuration; Send again delivers it.
- **Network guard** (`practice/guard.ts`). `main.ts` wraps `window.fetch` once. While practice is on, a request goes out only when it is same origin and GET or HEAD: the app's own files. Spots, cluster spots, Wavelog, PSK Reporter reports through the relay and WSPRnet uploads all use fetch.
- **The radio.** Play Tx audio ("Can key a connected radio") lets practice key a connected radio, so the operator can test Tx on the practice band. On, practice transmissions play through the Tx output, where a radio with VOX on transmits them, and with Key the radio with CAT on they key the radio by CAT as real ones do, Tune and Test keying included (`docs/design/cat.md`, Transmit). Off, practice plays no Tx audio and keys nothing. Turning the practice band on or off runs Halt first.
- **Settings.** Practice state is stored under its own kv key, `practice`, outside the settings record, so the settings schema and its migrations are untouched.

## Tests

- `practice/sim.test.ts` drives the real sequencer (`lib/testing/qso-sim.ts`) against the band, one scenario at a time with fixed seeds, and checks station counts, SNR range, fading, QSOs between practice stations, determinism, that every message packs, the DT spread, drift, overlaps, multipath, the band's opening, the slot conditions, compound and hashed callsigns, callers who open with a report, tail-enders, and each new scenario.
- `practice/seed-log.test.ts` seeds on fake IndexedDB with the log in use and checks that only the practice database changes.
- `practice/render.test.ts` checks SNR calibration, timing and fading, drift by zero crossings, the two-path fading's mean power and depth, the risen floor, crashes and a carrier's phase across slots, and decodes rendered slots with the wasm decoder, early, late, drifting, fading and compound signals among them.
- `practice/practice-log.test.ts` logs and sends in practice on fake IndexedDB and checks that the log, its Wavelog settings and the page's fetch are untouched.
- `practice/guard.test.ts` covers the guard for strings, URLs and Request objects.
- `e2e/practice.spec.ts` (project `practice`) turns practice on in Chromium with no microphone and checks the tag and decodes, a CQ QSO logged to the practice log, an answered CQ, the station who works another, the log untouched afterwards, the guard, the Wavelog stand-in Clear practice log with Undo, Worked stations (the dupe and worked-before edges and Hide worked, the log untouched) and Contest exchanges (a CQ FD answered with Contest exchange and logged with both exchanges). Every test fails if a request leaves for another origin or with a method other than GET or HEAD.

## Alternatives rejected

- **Decodes without audio.** Injecting decode results would skip the waterfall, the slot assembler, timing and the decoder, which are what practice should exercise.
- **Rendering in a worker of its own.** Synthesis goes through the decoder worker's encoder, which is idle when a slot is rendered (1.5 s before the slot, after the previous decode). Mixing 15 signals takes a few ms on the main thread.
- **A namespaced store in `rr73`.** Adding stores needs a database version change, which waits for every other open copy of RR73 to close (ADR 0003). A second database needs no upgrade.
- **Practice state in the settings record.** Another change bumps the settings schema; a key of its own avoids two migrations meeting.
- **Blocking only the known senders.** One guard at fetch covers senders added later.

## Open risks

- Not tested on a device. iOS timing of a 12 kHz buffer scheduled ahead on the audio clock is unverified.
- Practice stays on across a reload. The Practice badge in Operate's top bar and the Practice log title show it.
- The guard covers fetch on the page. Workers fetch only the app's own files today; `navigator.sendBeacon` and XMLHttpRequest are not guarded because RR73 does not use them. The WebSockets RR73 opens, the web SDR stream and the feed for who heard you, close while the practice band is on (`relay.svelte.ts`, `heard.svelte.ts`).
- Mixing a slot with drift or multipath on some stations takes tens of ms on the main thread; on a phone it is Unverified. The quadrature by delay leaves an image about 20 dB down near 2400 Hz.
- Clock off does not move the operator's transmissions as the stations hear them: the band reads them from the sequencer, so Correct Tx timing changes nothing the stations do.
- Drawn callsigns use real prefixes with random suffixes, so some may match issued callsigns.
- Slot audio is scheduled against `currentTime` paired with `Date.now()`, off by the output latency (tens of ms), which the DT-based offset correction absorbs.
