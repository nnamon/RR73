# WSPR

Status: proposed, 2026-10-14. Waiting for the owner's approval of the mockup reviewed with this doc.

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
| Power values | 0 to 60 dBm, ending in 0, 3 or 7. Unverified: to be confirmed against the codec's tests. |

Source for slot, timing, modulation and message types: the Wikipedia article on WSPR.

## Dial frequencies

`web/src/lib/radio/bands.ts` gains a WSPR column. Signals sit 1400 to 1600 Hz above the dial. Checked against the WSPR table at qsl.net/oz5em (160m to 6m) and the Signal Identification Wiki (160m to 17m).

| Band | Dial, MHz | Signals, MHz | Checked |
| --- | --- | --- | --- |
| 160m | 1.8366 | 1.8380 to 1.8382 | Two sources |
| 80m | 3.5686 | 3.5700 to 3.5702 | Two sources |
| 60m | 5.3647 | 5.3661 to 5.3663 | Unverified. Neither source lists 60m. This dial puts the signals inside the WRC-15 allocation, 5351.5 to 5366.5 kHz. |
| 40m | 7.0386 | 7.0400 to 7.0402 | Two sources |
| 30m | 10.1387 | 10.1401 to 10.1403 | Two sources |
| 20m | 14.0956 | 14.0970 to 14.0972 | Two sources |
| 17m | 18.1046 | 18.1060 to 18.1062 | Two sources |
| 15m | 21.0946 | 21.0960 to 21.0962 | One source |
| 12m | 24.9246 | 24.9260 to 24.9262 | One source |
| 10m | 28.1246 | 28.1260 to 28.1262 | One source |
| 6m | 50.2930 | 50.2944 to 50.2946 | One source |

A 2010 guide gives 80m as 3.5926 MHz; both current lists use 3.5686 MHz. 60m ships as `null` until confirmed, so the band sheet greys WSPR out there, as it does FT4 on 160m.

## Mode switching

- The band sheet's mode control reads FT8, FT4 and WSPR. A tap applies at once and keeps the sheet open, as FT8 and FT4 do today. Set the radio to shows the WSPR dial: 14.0956 MHz USB on 20m.
- Changing mode ends a transmission in progress and turns the beacon off. Changing band ends a transmission in progress and keeps the beacon on, as Tx keeps its state in FT8.
- Reason: RR73 cannot tune the KX2. The operator turns the dial after choosing, and a transmission running through the retune lands on the wrong frequency.
- `Mode` in `lib/clock/slots.ts` gains `WSPR`: 120 000 ms slots, 1 440 000 samples at 12 kHz. Parity does not apply, so WSPR slot headers carry no Even or Odd.

## Operate

The frame stays: top bar, waterfall, list, bottom bar (ADR 0006).

- Top bar: band, the WSPR tag, the dial to four decimals (14.0956), a slot ring that sweeps once per 2 min and turns red on air, the UTC clock, Log and Settings.
- Waterfall: 1400 to 1600 Hz across the width, about 2 pt per Hz on a 393 pt screen, and 240 s over 108 pt, so two slots show. The ruler ticks every 10 Hz and labels every 50 Hz. The Tx marker is 6 Hz wide; a tap or a drag sets the Tx frequency as in FT8. There is no Rx marker because the decoder searches the whole window. Tx slots are blank.
- Waterfall resolution: a 6 Hz signal needs bins of about 1.5 Hz, an 8192-point FFT at 12 kHz per line in the waterfall worker (ADR 0005).
- List: one header per slot, newest first. The slot in progress reads "14:04 · receiving, spots at 14:06". A decoded slot reads "14:08 · 9 spots". A Tx slot shows the approved Next, Sending and Sent rows with the message as transmitted, "9V1NE OJ11 37".
- Rows are 32 pt, in option B's style: callsign (16 pt semibold) and grid first, then dBm, SNR, drift and distance in fixed right-aligned 12 pt columns, such as "37 dBm −14 dB 0 Hz 3840 km". Slots below the newest slot with spots fade.
- Distance and bearing: great-circle from the station grid (6 characters when set) to the centre of the spot's grid, in km.
- Sort: distance, farthest first, by default. The ••• menu offers SNR and callsign.
- Gestures: a tap selects a row and marks its trace on the waterfall. Touch and hold opens the details: frequency in MHz to 1 Hz, DT, drift, bearing, power in W and the times heard today. Double-tap does nothing in WSPR.
- Colours: a spot carrying the station's own callsign shows as My call. No other decode-colour category applies, because each compares against QSOs.
- Bottom bar: a status line with the message and Tx frequency ("9V1NE OJ11 37 · 1500 Hz") and, on the right, "Beacon off", "Stops at 16:05" or the time left on air. Below it: Beacon, the Tx percentage, ••• and Halt.
- Beacon button: "Beacon" with a grey dot when off; "Tx at :06" in red on a pale red fill while waiting; "On air", solid red with a blinking dot, while transmitting.
- The Tx percentage button opens a menu of percentages. A choice applies at once and redraws the next Tx slot.
- ••• menu: Transmit next slot (once, with Beacon on or off), Tune for 10 s, Save slot (2 min of audio), Sort by, Stop beacon after.
- Halt ends the transmission and turns the beacon off in one tap. It is outlined and always visible.

## Beacon schedule

- Beacon on: the first Tx is the next slot that starts at least 10 s later, the time needed to build and queue 110.6 s of audio.
- Each later gap is 1 + x slots, where n = 100 ÷ Tx percentage and x is drawn uniformly from 0 to 2(n − 1), then rounded up or down at random in proportion to its fraction. The mean gap is n slots and the longest 2n − 1. At 20%: gaps of 1 to 9 slots, mean 5.
- The next Tx slot is drawn when a transmission ends, when Beacon turns on and when the percentage changes, so the button can show it.
- Reason: a known next slot lets the button say "Tx at :06", and a bounded gap keeps spots arriving at a steady rate. Random gaps stop two beacons on one frequency from colliding every time.
- Stop beacon after: 2 h by default; 30 min, 1, 2, 4, 8 or 12 h, or Off. It counts from Beacon on. When it fires, a notice says "Beacon stopped after 2 h."
- Reason: AGENTS.md says RR73 never runs unattended, and `sequencer.md` exempts WSPR from the QSO watchdog. A default limit stops a forgotten phone. Off serves an operator who runs a beacon on purpose.

## Settings

Per ADR 0006. Station, Radio and audio, Logging, Optional features and Appearance stay where they are. Today's FT8 and FT4 section becomes a Modes group on the Settings screen with two rows, FT8 and FT4, and WSPR, each opening its own screen. The WSPR row shows "20% · 37 dBm".

| WSPR setting | Default | Range |
| --- | --- | --- |
| Tx percentage | 20% | 5 to 100% in steps of 5. Also set from the bottom bar. |
| Reported power | 37 dBm (5 W) | WSPR's power values, each shown with its power in W. The radio's output is set on the radio. |
| Tx frequency | 1500 Hz | 1410 to 1590 Hz. Also set on the waterfall. |
| Stop beacon after | 2 h | 30 min to 12 h, or Off. |
| Message | Read only | Station callsign, the first 4 characters of the grid and the reported power. |
| Band hopping | Off, disabled | Later round. |
| Report to WSPRnet | Off, disabled | Later round. Needs the spot relay. |
| Keep spots | 30 days | 1 day to 1 year, or Forever. |

- Transmitting needs the callsign and grid, as in FT8. Until Type 2 and 3 messages are built, a compound callsign disables Beacon and the Message row reads "Standard callsigns only".
- Migration: the first start of the release with WSPR moves today's flat FT8 and FT4 fields into the per-family structure once, keeping every value, and records it in the kv store's `migrations` as the log does.
- Reason for a group on the Settings screen: one tap fewer than a separate Modes screen, and four families still fit in one group.

## Spots and logging

- Decision: spots go to their own IndexedDB store, `wsprSpots`, and the station's transmissions to `wsprTx`. They never enter the QSO log, ADIF exports or Wavelog.
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

- The app records each slot from its start, an even UTC minute, and calls the decoder at slot start + 114 s with 114 s of 12 kHz mono: 1 368 000 samples. Gaps the capture worklet bridged are zero-filled.
- Reason for 114 s: a transmission ends 111.6 s into the slot, a late station adds up to 2 s of DT, and 6 s remain before the next slot.
- Target: a 20m slot with 30 signals decodes within 10 s on an iPhone 13. Not tested on a device.
- Limit: the decoder stops at `max_ms` (default 60 000) and returns what it found with `truncated: true`. A decode still running when the next slot's audio arrives does not delay it.
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

- Wasm: `decode_wspr(samples: &[f32], options_json: &str) -> Result<String, JsError>` returns `{ "spots": [...], "ms": 812, "truncated": false }` with the fields above in snake case.
- Worker protocol: `{ type: 'decodeWspr', id, samples, options }` answered by `{ type: 'decodedWspr', id, spots, ms, truncated }`.
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

- Wasm: `pack_wspr(call, grid, power_dbm) -> String` returns `{ ok, text, types: [1] or [2, 3], error }`; `synthesize_wspr(call, grid, power_dbm, part, f0_hz, sample_rate) -> Float32Array`, where `part` picks the transmission.
- `WsprPackError` maps to plain words for the Message row: callsign too long, grid not 4 or 6 characters, power not a WSPR value.
- The waveform ramps in and out over a few milliseconds to avoid key clicks.
- The app starts playback 1 s after the slot start, with the Tx timing correction from the timing work.
- `freq_hz` and `f0_hz` both mean the signal centre, between tones 1 and 2. Which point WSPRnet and ALL_WSPR report is Unverified; export converts if it differs.

### Testing

- Round trip: pack, synthesize, add noise in `rr73-chansim`, decode; the message, frequency and DT come back.
- `rr73-bench` gets a WSPR preset and a WSPR corpus: Kiwi recordings of 2-minute slots on 20m and 40m, with reference decodes from WSJT-X's binaries. Running them is allowed; their source is GPL and is never read.
- CI gate for WSPR: decodes, false decodes, SNR50 and time per slot, as for FT8.

## Alternatives rejected

- Spots in the QSO log as ADIF records with mode WSPR: Wavelog would count them as contacts.
- A separate WSPR screen beside Log and Spots: one more entry point, and "Spots" already names POTA and cluster spots.
- The full 0 to 3000 Hz waterfall: a 6 Hz signal would be 0.8 pt wide.
- A filter bar in WSPR: it costs 36 pt, one row more of spots, and Sort by in ••• covers the need.
- DT in the row: it is close to 0 for most stations, so it goes to touch and hold.
- A coin flip per slot: gaps have no upper bound and the next Tx slot is unknown until it starts.
- Fixed spacing between transmissions: it repeats collisions with a station on the same spacing.
- Modes as its own screen under Settings: one more tap.
- Band hopping in this round: RR73 cannot tune the KX2, because Safari on iOS has no Web Serial or Web Bluetooth, so hopping means the operator retunes by hand at each hop.

## Open risks

- Long sessions: Safari stops capture when the screen locks, so a 2 h beacon needs the screen on with the wake lock. Battery use over 2 h is Not tested on a device.
- Decode time on an iPhone: Not tested on a device.
- The 8192-point FFT per waterfall line: its cost on a phone is Not tested on a device.
- KX2 at 110.6 s key-down every few minutes: heat at 5 W and 10 W is Not tested on a device. VOX should hold through the continuous tone; Not tested on a device.
- Storage: at 30 spots a slot, 12 h a day for 30 days, about 320 000 spots or 65 MB. Safari's quota for a home-screen app at that size is Unverified.
- Unverified: the 60m dial, the set of power values, the drift unit and frequency point WSPRnet uses, the ALL_WSPR column layout, and whether WSPRnet accepts a file upload of exported spots, which could report spots before the relay exists.

## Questions for the owner

1. Stop beacon after: 2 h by default, or Off by default?
2. Band hopping means retuning the KX2 by hand at each hop. Keep it for a later round as a prompt to change band, or drop it?
3. Transmitting with a compound callsign such as 9V1NE/P needs Type 2 and 3 messages. Include it in the first WSPR release, or ship standard callsigns first?
4. Sort spots by distance by default, or by SNR?
5. Which 60m channel applies to 9V1, if any?
