# WSPR

Status: accepted 2026-10-14 with the owner's decisions at the end. Operate in WSPR, the beacon and Settings › WSPR are built on `feat/wspr-app` for 0.12.0 (As built, below). The WSPR history in Log, its exports and stored spots are not built yet (Not built yet).

WSPR is the second mode family (ADR 0006). This doc covers mode switching, Operate in WSPR, the beacon schedule, settings, where spots are stored, and what the app needs from the WSPR codec and decoder, which are being written in Rust alongside it.

## Facts the design uses

| | |
| --- | --- |
| Slot | 2 min, starting on even UTC minutes. |
| Transmission | Starts 1 s into the slot. 162 symbols of 8192/12000 s: 110.6 s. |
| Signal | Continuous-phase 4-FSK, 1.4648 Hz tone spacing, about 6 Hz wide. |
| Window | 200 Hz: audio 1400 to 1600 Hz above the standard USB dials. |
| Message | Callsign, 4-character grid and power in dBm. Compound callsigns and 6-character grids take a sequence of two transmissions. |
| SNR | Reported in a 2500 Hz reference bandwidth. |
| Power values | 0 to 60 dBm, ending in 0, 3 or 7: the 19 values the codec packs (`crates/rr73-wspr`), each shown with its power in W (37 dBm · 5 W). |

Source for slot, timing, modulation and message types: the Wikipedia article on WSPR.

## Dial frequencies

`web/src/lib/radio/bands.ts` has a WSPR column, from WSPRnet's frequency sheet (wsprnet.org, wspr-qrg.pdf). The same dials apply everywhere; the operator works within their licence. Signals sit 1400 to 1600 Hz above the dial. 2m is a band of its own with a WSPR dial only: its tile is off while FT8 or FT4 is chosen, and FT8 and FT4 are off on 2m.

| Band | Dial, kHz | Signals, kHz |
| --- | --- | --- |
| 160m | 1836.6 | 1838.0 to 1838.2 |
| 80m | 3568.6 | 3570.0 to 3570.2 |
| 60m | 5287.2 | 5288.6 to 5288.8 |
| 40m | 7038.6 | 7040.0 to 7040.2 |
| 30m | 10138.7 | 10140.1 to 10140.3 |
| 20m | 14095.6 | 14097.0 to 14097.2 |
| 17m | 18104.6 | 18106.0 to 18106.2 |
| 15m | 21094.6 | 21096.0 to 21096.2 |
| 12m | 24924.6 | 24926.0 to 24926.2 |
| 10m | 28124.6 | 28126.0 to 28126.2 |
| 6m | 50293.0 | 50294.4 to 50294.6 |
| 2m | 144488.5 | 144489.9 to 144490.1 |

## Mode switching

- The band sheet's mode control reads FT8, FT4 and WSPR. A tap applies at once and keeps the sheet open, as FT8 and FT4 do today. Set the radio to shows the WSPR dial: 14.0956 MHz USB on 20m.
- Changing mode ends a transmission in progress and turns the beacon off. Changing band ends a transmission in progress and keeps the beacon on, as Tx keeps its state in FT8.
- Reason: RR73 cannot tune the KX2. The operator turns the dial after choosing, and a transmission running through the retune lands on the wrong frequency.
- `Mode` in `lib/clock/slots.ts` gains `WSPR`: 120 000 ms slots, 1 440 000 samples at 12 kHz. Parity does not apply, so WSPR slot headers carry no Even or Odd. `FtMode` names FT8 and FT4 for the code that runs QSOs (the sequencer, the FT decode list, the practice band), so WSPR cannot reach it by mistake.
- Changing to WSPR also stops FT8: Tx, Hunt and a transmission on air, as Halt does.

## Operate

The frame stays: top bar, waterfall, list, bottom bar (ADR 0006). `views/Operate.svelte` keeps the top bar, the audio banner and the waterfall, and takes the middle and the bottom bar from the mode family's pane (`views/operate/panes.ts`): `FtPane` holds FT8 and FT4's list and bar as they were, `WsprPane` WSPR's. RTTY and later families add a pane there without touching FT8's.

- Top bar: band, the WSPR tag, the dial to four decimals (14.0956), a slot ring that sweeps once per 2 min and turns red on air, the UTC clock, Log and Settings.
- Waterfall: 1400 to 1600 Hz across the width, about 2 pt per Hz on a 393 pt screen, and 240 s over 108 pt, so two slots show. The ruler ticks every 10 Hz and labels every 50 Hz. The Tx marker is 6 Hz wide; a tap or a drag sets the Tx frequency as in FT8. There is no Rx marker because the decoder searches the whole window. Tx slots are blank.
- Waterfall resolution: a 6 Hz signal needs bins of about 1.5 Hz, an 8192-point FFT at 12 kHz per line in the waterfall worker (ADR 0005).
- List: one header per slot, newest first. The slot in progress reads "14:04 · receiving, spots at 14:06". A decoded slot reads "14:08 · 9 spots". A Tx slot shows the approved Next, Sending and Sent rows with the message as transmitted, "9V1NE OJ11 37".
- Rows are 32 pt, in option B's style: callsign (16 pt semibold) and grid first, then, per the owner's list, distance, SNR, drift and audio frequency in fixed right-aligned 12 pt columns, such as "3840 km −14 dB 0 Hz 1462 Hz". The slot's time is in its header; power moved to touch and hold. Slots below the newest slot with spots fade. A run of slots with no spots shares one header, as in FT8.
- Distance and bearing: great-circle from the station grid (6 characters when set) to the centre of the spot's grid, in km.
- Sort: distance, farthest first, by default. The ••• menu steps through distance, SNR and callsign; Settings › WSPR has the same three. Newest was dropped: spots are grouped by slot, so every spot in a group is as new as the others.
- Gestures: a tap selects a row and marks its trace on the waterfall with dashed accent lines 6 Hz apart. Touch and hold opens the details: frequency in MHz to 1 Hz, SNR, DT, drift, distance and bearing, power in W, and the times heard in the slots Operate keeps ("2 times since 14:00"). Double-tap does nothing in WSPR.
- Colours: a spot carrying the station's own callsign shows as My call. No other decode-colour category applies, because each compares against QSOs.
- Bottom bar: a status line with the message and Tx frequency ("9V1NE OJ11 37 · 1500 Hz") and, on the right, "Beacon off", "Stops at 16:05" or the time left on air. Below it: Beacon, the Tx percentage, ••• and Halt.
- Beacon button: "Beacon" with a grey dot when off; "Tx at :06" in the accent tint while waiting, as Tx on is in FT8; "On air", solid red with a blinking dot, while transmitting. The mockup's pale red fill sat beside an outlined Halt; since 0.10.5 Halt is itself a pale red tint, so a waiting beacon in red would read as a second Halt.
- The Tx percentage button ("20%" with chevrons) opens a menu of percentages, 5 to 100%. A choice applies at once and redraws the next Tx slot.
- ••• menu: Transmit next slot (once, with Beacon on or off), Tune for 10 s, Save slot (2 min of audio), Clear spots, Power, Sort by and Stop beacon after. Power shows the level in use ("27 dBm") and opens a menu of the 19 levels with their watts ("27 dBm · 500 mW"), the one in use ticked; a choice applies at once and the status line says "Power set to 27 dBm". A transmission waiting for its slot is made again with it while more than 1.5 s remain, as for a new Tx frequency, in the menu and in Settings › WSPR alike. Added in 0.14.1 because the owner changes power often. Sort by and Stop beacon after step through their values on each tap, as FT8's menu items do; Stop beacon after steps through Off, 30 min, 1 h, 2 h, 4 h, 8 h and 12 h, and Settings › WSPR takes any number of minutes. Clear spots empties the spot list and the Sent rows of slots that have ended. The beacon, its Next row and a transmission on air stay.
- Halt ends the transmission and turns the beacon off in one tap. It has FT8's look (a red tint since 0.10.5) and is always visible.
- Beacon off lets a transmission on air finish, as Tx off does in FT8; Halt stops it.
- The status line shows a notice for 20 s, then the message and Tx frequency again. Notices are in `lib/qso/status.ts`: "Beacon stopped after 1 h", "Audio stopped · Beacon off", "Spots sorted by SNR" and others.

## Beacon schedule

- Beacon on: the first Tx is the next slot that starts at least 10 s later, the time needed to build and queue 110.6 s of audio.
- Each later gap is 1 + x slots, where n = 100 ÷ Tx percentage and x is drawn uniformly from 0 to 2(n − 1), then rounded up or down at random in proportion to its fraction. The mean gap is n slots and the longest 2n − 1. At 20%: gaps of 1 to 9 slots, mean 5.
- The next Tx slot is drawn when a transmission ends, when Beacon turns on and when the percentage changes, so the button can show it.
- Reason: a known next slot lets the button say "Tx at :06", and a bounded gap keeps spots arriving at a steady rate. Random gaps stop two beacons on one frequency from colliding every time.
- Stop beacon after: 1 h by default, set to any duration or Off. It counts from Beacon on. When it fires, it stops a transmission on air too, as FT8's watchdog does, and the status line says "Beacon stopped after 1 h". Changing the setting while the beacon runs moves its stop time, still counted from Beacon on.
- A transmission goes to the transmit scheduler 8 s before its slot; synthesis of 110.6 s at 48 kHz takes well under that. After a transmission the next one may be the very next slot (100%), 8.4 s away, so the 10 s lead applies only when Beacon turns on or the percentage changes.
- A transmission that cannot start (audio stopped) turns the beacon off with the reason in the status line. One that would start more than 1 s late is skipped, and the beacon draws its next slot.
- Halt, a change of mode, audio stopping and the page hiding stop the beacon at once, as they stop FT8.

## Settings

Per ADR 0006. Station, Radio and audio, Logging, Optional features and Appearance stay where they are. Today's FT8 and FT4 section becomes a Modes group on the Settings screen with two rows, FT8 and FT4, and WSPR, each opening its own screen (`#/settings/ft8`, `#/settings/wspr`). The WSPR row shows "20% · 37 dBm".

| WSPR setting | Default | Range |
| --- | --- | --- |
| Tx percentage | 20% | 5 to 100% in steps of 5, with a stepper. Also set from the bottom bar. |
| Reported power | 37 dBm (5 W) | WSPR's power values, each shown with its power in W. The radio's output is set on the radio. |
| Tx frequency | 1500 Hz | 1410 to 1590 Hz. Also set on the waterfall. |
| Stop beacon after | 1 h | Off, 30 min, 1 h, 2 h, 4 h, 8 h, 12 h, or Other: any whole number of minutes up to 7 days. |
| Message | Read only | Station callsign, the first 4 characters of the grid and the reported power. A compound callsign shows both messages. |
| Sort spots by | Distance | Distance, SNR or callsign. |

- Report to WSPRnet, Keep spots and band hopping are not on screen until they are built (copy rules: no plans or unbuilt features on screen).
- Transmitting needs the callsign and grid, as in FT8. Settings › WSPR asks the codec whether the callsign packs and says "Callsign cannot be sent in WSPR" when it does not; Beacon refuses it with the same words.
- A compound callsign sends Type 2 and Type 3 in turn. A Type 3 message carries a 6-character grid, so with a 4-character grid only the Type 2 message goes out, and a footer says so. Decision: no grid is made up from 4 characters.
- Migration: decided against moving FT8 and FT4's flat fields. Settings schema 7 adds a `wspr` object at its defaults and leaves every other value where it was. Reason: the move changes nothing the operator sees and touches every FT8 module and its tests, the risk ADR 0006 named. A later family can nest its settings the same way; the FT8 fields can move when something needs them to.
- Reason for a group on the Settings screen: one tap fewer than a separate Modes screen, and four families still fit in one group.

## Spots and logging

- Built: spots never enter the QSO log, ADIF exports or Wavelog. Operate keeps the last 60 slots (2 h) of spots in memory; a reload starts the list empty.
- Not built yet: spots go to their own IndexedDB store, `wsprSpots`, and the station's transmissions to `wsprTx`.
- Reason: a spot is a one-way reception report with no exchange, so storing it as a QSO would put contacts that never happened into ADIF, Wavelog and the worked-before colours.
- The Log screen gains a QSOs and WSPR control at the top. The Log button opens the side for the current mode.
- WSPR side: grouped by UTC day and band, with the day's transmissions and spots in the header ("Today · 20m · 3 Tx · 64 spots"). One row per station, farthest first: callsign, grid, spots, SNR range, power, distance and last time heard. Search by callsign or grid. A tap opens the station's spots.
- Export through the share sheet: WSJT-X-style ALL_WSPR text, one line per spot, or CSV with a header row. The exact ALL_WSPR column layout is Unverified; it will be checked against a WSJT-X run.
- Retention: spots older than Keep spots are removed at start-up.
- Spot record: `id`, `slotStart` (UTC ms), `band`, `dialHz`, `audioHz`, `freqHz` (dial + audio), `snrDb`, `dtS`, `driftHz`, `call`, `grid`, `powerDbm`, `msgType`, `distanceKm`, `bearingDeg`, `decoder` (version and preset).
- Tx record: `slotStart`, `band`, `dialHz`, `audioHz`, `message`, `powerDbm`, `completed` (false when halted).

## Decoder API

What the app needs from the WSPR crate through `rr73-wasm`, in the style of the FT8 functions: stateless calls, JSON out, scheduling in the worker.

### Timing

- Built: the app records each slot from its start, an even UTC minute, and hands the whole 120 s (1 440 000 samples at 12 kHz, gaps zero-filled) to the decoder worker when the slot ends, as FT8 does. The header of the slot in progress says "spots at 14:06". Decoding from 114 s, 6 s sooner, needs the assembler to hand over an open slot and is not built.
- Target: a 20m slot with 30 signals decodes within 10 s on an iPhone 13. Not tested on a device.
- Measured on 2026-10-14 (Docker Desktop on the Apple M4 dev machine, 10 CPUs, load average 0.9 to 2.5), `decode_wspr` with the `wspr` preset in a module worker, the release WebAssembly build, best of 3 runs. The first run of each slot came within 42 ms of the best, apart from the first slot decoded (+139 ms in Chromium, +115 ms in WebKit), which sets up the FFT plans:

  | Slots | Chromium | WebKit |
  | --- | --- | --- |
  | 10 Kiwi recordings, 20m and 40m (31 spots) | 830 to 2435 ms, median 1449 ms | 842 to 2480 ms, median 1480 ms |
  | 5 `wspr-band` slots, 20 signals each (100 spots) | 382 to 601 ms, median 530 ms | 404 to 635 ms, median 545 ms |
  | 5 `wspr-noise` slots | 110 to 187 ms | 106 to 185 ms |

  Real recordings take 2 to 4 times as long as synthetic slots with more signals: most likely the single-symbol retry of candidates the 7-symbol pass fails (docs/experiments/0004-wspr.md). Unverified. The module loaded in 9 to 12 ms from a local server. On an iPhone: not tested on a device.
- Limit: no `max_ms` yet; rr73-wasm's `decode_wspr` has none. The decoder worker holds at most 2 waiting slots, FT8's limit; a WSPR slot that finds 2 waiting reads "not decoded".
- Spots appear when the call returns. Partial results are not streamed in the first version.

### Decode

```rust
/// Decodes one WSPR slot. `samples` are 12 kHz mono, sample 0 at the slot start.
pub fn decode_wspr(samples: &[f32], options: &WsprOptions) -> WsprResult;

pub struct WsprOptions {
    /// Search window, audio Hz. Default 1390 to 1610.
    pub f_min_hz: f32,
    pub f_max_hz: f32,
    /// DT search range, s, relative to the nominal start 1 s into the slot. Default -2.0 to 3.0.
    pub dt_min_s: f32,
    pub dt_max_s: f32,
    /// Largest drift searched, Hz, either sign. Default 4.
    pub drift_max_hz: f32,
    /// Callsigns heard before, to resolve the 15-bit hashes in Type 3 messages.
    pub known_calls: Vec<String>,
    /// Decoder preset, named as for FT8.
    pub preset: String,
    /// Time budget, ms. The decoder returns what it found when it runs out.
    pub max_ms: u32,
}

pub struct WsprSpot {
    /// Message as decoded, such as "K1ABC FN42 37". An unresolved hash reads "<...>".
    pub text: String,
    pub call: Option<String>,
    /// 4 or 6 characters; none in a Type 2 message.
    pub grid: Option<String>,
    pub power_dbm: i8,
    /// 1, 2 or 3.
    pub msg_type: u8,
    /// dB in a 2500 Hz reference bandwidth.
    pub snr_db: f32,
    /// s, relative to the nominal start 1 s into the slot.
    pub dt_s: f32,
    /// Audio frequency of the signal centre, Hz, to 0.1 Hz.
    pub freq_hz: f64,
    /// Linear drift, Hz, in WSPRnet's unit.
    pub drift_hz: f32,
    /// Sync quality, for the bench.
    pub sync: f32,
}

pub struct WsprResult {
    pub spots: Vec<WsprSpot>,
    pub ms: u32,
    pub truncated: bool,
}
```

- Built (rr73-wasm on `feat/wspr-core`): `decode_wspr(samples, preset)` returns a JSON array of `{ text, freq_hz, dt_s, drift_hz_per_s, snr_db }`; the worker keeps the type 3 hash table between slots. The app reads the call, grid, power and message type from the text (`lib/wspr/message.ts`).
- Worker protocol: `{ type: 'decodeWspr', id, preset, samples }` answered by `{ type: 'decodedWspr', id, decodes, ms }`, `ms` measured in the worker.
- Drift: wsprd prints the frequency change over the transmission. On four synthetic slots drifting −0.03, −0.01, 0.01 and 0.03 Hz/s, `wsprd -f 14.0956` printed −3, −1, 0 and 3, against −3.3, −1.1, 1.1 and 3.3 Hz over 110.6 s. The app shows `drift_hz_per_s × 110.6`, rounded.
- Each message appears once per slot. Type 2 and Type 3 messages come back as separate spots; the app pairs them by callsign in the history.
- The app passes `known_calls` from the history (the last 30 days, at most 5000 calls). The decoder holds no state between calls, so a restarted worker loses nothing.
- Display: SNR as an integer dB, DT to 0.1 s, RF frequency = dial + `freq_hz` in MHz to 6 decimals, drift as an integer.

### Encode and synthesize

```rust
/// Checks and packs a message. One transmission for Type 1; two (Type 2, then Type 3)
/// for a compound callsign or a 6-character grid.
pub fn pack_wspr(call: &str, grid: &str, power_dbm: i8) -> Result<Vec<[u8; 162]>, WsprPackError>;

/// 110.6 s of audio for one transmission: 162 symbols of 8192/12000 s, tone spacing
/// 12000/8192 Hz, continuous phase, centred on `f0_hz`, at `sample_rate`.
pub fn synthesize_wspr(symbols: &[u8; 162], f0_hz: f32, sample_rate: u32) -> Vec<f32>;
```

- Built: `pack_wspr(text)` returns `{ ok, text, message_type, error }` and `synthesize_wspr(text, freq_hz, sample_rate)` the audio; the app builds each message's text (`beaconMessages`) and alternates them.
- `WsprPackError` maps to plain words for the Message row: callsign too long, grid not 4 or 6 characters, power not a WSPR value.
- The waveform ramps in and out over a few milliseconds to avoid key clicks.
- The app starts playback 1 s after the slot start, with the Tx timing correction from the timing work.
- `freq_hz` and `f0_hz` both mean the signal centre, between tones 1 and 2. Which point WSPRnet and ALL_WSPR report is Unverified; export converts if it differs.

### Testing

- Round trip: pack, synthesize, add noise in `rr73-chansim`, decode; the message, frequency and DT come back.
- `rr73-bench` gets a WSPR preset and a WSPR corpus: Kiwi recordings of 2-minute slots on 20m and 40m, with reference decodes from WSJT-X's binaries. Running them is allowed; their source is GPL and is never read.
- CI gate for WSPR: decodes, false decodes, SNR50 and time per slot, as for FT8.

## As built (0.12.0)

| Part | Where |
| --- | --- |
| Slot table, `FtMode` | `web/src/lib/clock/slots.ts` |
| WSPR dials, 2m | `web/src/lib/radio/bands.ts` |
| Beacon schedule, Stop beacon after | `web/src/lib/wspr/schedule.ts` |
| Messages, reading decoded text | `web/src/lib/wspr/message.ts` |
| Spots, distance, sorting, drift | `web/src/lib/wspr/spots.ts` |
| The list's headers and rows | `web/src/lib/wspr/list.ts` |
| Power values | `web/src/lib/wspr/power.ts` |
| Runtime: spots, beacon, scheduler | `web/src/lib/state/wspr.svelte.ts` |
| Waterfall view per mode | `web/src/lib/waterfall/spectrum.ts`, `levels.ts`, `renderer.ts`, `axis.ts`, `pick.ts`, `drag.ts` |
| Operate frame and panes | `web/src/views/Operate.svelte`, `web/src/views/operate/` |
| Spot list, bar, menus, details | `web/src/ui/SpotList.svelte`, `WsprBar.svelte`, `BarMenu.svelte`, `SpotDetailSheet.svelte` |
| Settings | `web/src/views/FtSettings.svelte`, `WsprSettings.svelte` |
| Tests | `web/src/lib/wspr/*.test.ts`, `web/src/lib/state/wspr.test.ts`, `web/e2e/wspr.spec.ts` |

- The waterfall in WSPR: an 8192-point FFT per row, 139 bins of 1.46 Hz from 1400 to 1600 Hz, 240 s over its height. Levels: each bin against a ±25 Hz baseline, noise from every bin of the window. Find clear Tx stays an FT8 and FT4 feature.
- Saving a slot in WSPR keeps 2 slots (2 × 5.8 MB) beside the 8 FT8 slots.
- The practice band carries noise only in WSPR: its stations work FT8 and FT4.
- Tune in WSPR plays at the WSPR Tx frequency and, as in FT8, its slot is not decoded.

## Not built yet

- Log › WSPR: the history by day and band, search, a station's spots, ALL_WSPR and CSV export, the `wsprSpots` and `wsprTx` stores and Keep spots.
- Report to WSPRnet and the spot relay (a later round).
- Decoding from 114 s into the slot, and a time limit (`max_ms`) in the decoder.
- WSPR stations in the practice band.
- Moving FT8 and FT4's settings under a family key (decided against for now, see Settings).

## Alternatives rejected

- Spots in the QSO log as ADIF records with mode WSPR: Wavelog would count them as contacts.
- A separate WSPR screen beside Log and Spots: one more entry point, and "Spots" already names POTA and cluster spots.
- The full 0 to 3000 Hz waterfall: a 6 Hz signal would be 0.8 pt wide.
- A filter bar in WSPR: it costs 36 pt, one row more of spots, and Sort by in ••• covers the need.
- DT in the row: it is close to 0 for most stations, so it goes to touch and hold.
- A coin flip per slot: gaps have no upper bound and the next Tx slot is unknown until it starts.
- Fixed spacing between transmissions: it repeats collisions with a station on the same spacing.
- Modes as its own screen under Settings: one more tap.
- Band hopping: RR73 has no CAT control of the radio, so a hop would need the operator to retune by hand.

## Open risks

- Long sessions: Safari stops capture when the screen locks, so a 2 h beacon needs the screen on with the wake lock. Battery use over 2 h is Not tested on a device.
- Decode time on an iPhone: Not tested on a device.
- The 8192-point FFT per waterfall line: its cost on a phone is Not tested on a device.
- KX2 at 110.6 s key-down every few minutes: heat at 5 W and 10 W is Not tested on a device. VOX should hold through the continuous tone; Not tested on a device.
- Storage: at 30 spots a slot, 12 h a day for 30 days, about 320 000 spots or 65 MB. Safari's quota for a home-screen app at that size is Unverified.
- Unverified: the frequency point WSPRnet uses, the ALL_WSPR column layout, and whether WSPRnet accepts a file upload of exported spots, which could report spots before the relay exists. The drift unit follows wsprd's output on four synthetic slots (Decoder API).
- Spots live in memory only: a reload or a crash loses the session's list until the stores are built.
- Decode time on real signals is 2 to 4 times that of synthetic ones in the browser (Decoder API). On an iPhone: not tested on a device.

## Decisions from the owner, 14 October 2026

- Stop beacon after: 1 h by default, settable to any value or Off.
- No band hopping: RR73 has no CAT control.
- Compound callsigns such as 9V1NE/P (Type 2 and 3 messages) ship in the first WSPR release.
- Spots sort by distance, farthest first, by default; the sort can be changed.
- Dials follow WSPRnet's frequency sheet on every band, 60m included. Licensing is the operator's to observe.
