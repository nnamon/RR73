# RR73

RR73 turns an iPhone into a full FT8, FT4, WSPR and RTTY station. Wire the phone to your radio's audio and operate from a park or a summit without a laptop.

It installs from Safari at https://nnamon.github.io/RR73/ and also runs on the iPad and in desktop browsers. It is free and open source, and once installed it opens and decodes without a connection.

<table>
<tr>
<td><img src="docs/screenshots/ft8-receiving.png" width="260" alt="Operate receiving FT8 on 20m: the waterfall and the decodes of the last slot"></td>
<td><img src="docs/screenshots/ft8-qso.png" width="260" alt="Operate in a QSO: the caller's message to 9V1NE, the report being sent and the QSO's steps"></td>
<td><img src="docs/screenshots/ft8-dark.png" width="260" alt="Operate receiving FT8 in the dark theme"></td>
</tr>
</table>

## Decoders built for weak signals

RR73 decodes FT8 and FT4 with its own decoders, written in Rust and compiled to WebAssembly so they run on the phone itself. Each slot gets up to three passes that subtract every decoded signal before the next, ordered-statistics decoding for the signals belief propagation gives up on, and then up to 2 s of finer searching. On the bench's white-noise sweep, half of all FT8 messages decode at −19.9 dB.

During a QSO the decoder knows what the other station is likely to send next, its callsigns, a report, RRR, RR73 or 73, and tests the weak signals near its frequency against those messages. That recovers replies about 2.7 dB weaker than a decode from scratch.

The first decodes of a slot appear 13.5 s into the 15 s FT8 slot (6 s into the 7.5 s FT4 slot), so there is time to pick a station and answer in the next slot. Every change to the decoders is measured on thousands of recorded and simulated slots, and CI refuses one that loses decodes or adds false ones.

## The QSO runs itself

Double-tap a decode and RR73 works the station: each message goes out in its slot with the report filled in, and the QSO is logged when it completes. CQ calls CQ, and Repeat CQ keeps going after each QSO, answering callers from a queue in the order you pick. Hunt answers CQs one after another, the stations you have not worked first. Halt stops the transmission at once, and the watchdog stops a QSO nobody answers.

Decodes are coloured by what they mean to you: messages to you, new DXCC entities, continents, zones, grids and calls, CQs and stations already worked. One colour scheme is chosen to stay distinct with colour blindness. Chips filter the list to CQs, new stations, messages to you or the Rx frequency, and Hide worked drops stations already in the log.

## DXpeditions, WSPR and RTTY

<table>
<tr>
<td><img src="docs/screenshots/hound.png" width="260" alt="FT8 Hound: the Fox's multi-call message with the report to 9V1NE, and the R-report on air"></td>
<td><img src="docs/screenshots/wspr.png" width="260" alt="WSPR on 20m: spots of two slots, farthest first, and the beacon"></td>
<td><img src="docs/screenshots/rtty.png" width="260" alt="RTTY: received text with callsigns marked, the QSO strip with name and QTH, and the macros"></td>
</tr>
</table>

Hound mode works a DXpedition running FT8 in Fox and Hound mode. It calls above 1000 Hz, reads your report out of the Fox's multi-call messages and moves to the Fox's frequency for the R-report.

WSPR decodes every two-minute slot, beacons in the share of slots you set, and uploads the spots to WSPRnet when you turn that on.

RTTY runs at 45.45 baud and 170 Hz shift. Tap a callsign in the received text and RR73 fills in the QSO from what that station sent. Macros send the exchanges, with a contest set that numbers each QSO.

## Activations and the log

<table>
<tr>
<td><img src="docs/screenshots/log.png" width="260" alt="The log by day, with each QSO's state at Wavelog and a refusal with Fix"></td>
<td><img src="docs/screenshots/activation.png" width="260" alt="A POTA and SOTA activation: progress toward 10 QSOs and the summit qualified"></td>
<td><img src="docs/screenshots/heard-you.png" width="260" alt="Heard you: the stations that reported hearing 9V1NE in the last 30 minutes"></td>
</tr>
</table>

Start a POTA, SOTA, WWFF or IOTA activation and RR73 counts every QSO toward each programme's goal, shows the time left in the UTC day, and writes the POTA, SOTA and WWFF log files. It suggests parks and summits near your GPS position as you type a reference.

The log lives on the phone and works with no signal at all. QSOs go to Wavelog when you send them, or automatically. Export ADIF, back the whole log up to one file, or import ADIF from another logger.

Spots shows POTA activators and DX cluster spots on your bands. Heard you lists the stations that PSK Reporter says heard your signal.

## Listen without a radio

Through a relay you add, RR73 receives from a KiwiSDR web SDR in place of your radio and reports your decodes to PSK Reporter. The relay, QSP, is part of this repository and anyone can run one (`crates/rr73-qsp/README.md`).

The practice band simulates a busy band inside the app: stations calling CQ, callers answering yours, an RTTY station and a DXpedition to chase. Nothing is transmitted while it is on, and its QSOs go to a separate practice log. The screenshots here were taken on it.

## On the phone and beyond

Rows are sized for a thumb and the decode colours hold up in sunlight. Every upload and optional feature starts switched off. The night display turns the screen black with the clock, the next transmission and the stations heard in dim red, for long sessions after dark. RR73 also warns when the phone's clock is a second or more off, enough to put your transmissions out of step with the band.

On an iPad or a desktop, band activity, the Rx frequency and the transmit panel sit side by side, and the keyboard drives it: Esc halts, Return calls the selected station, and ? lists the rest.

<img src="docs/screenshots/ipad.png" width="800" alt="Operate on an iPad: band activity, the Rx frequency list and the transmit panel beside the waterfall">

<img src="docs/screenshots/desktop.png" width="800" alt="Operate in a desktop browser in the dark theme">

## Getting started

1. Open https://nnamon.github.io/RR73/ in Safari and choose Share › Add to Home Screen.
2. Connect the radio's audio output to the phone's microphone input and the phone's headphone output to the radio's audio input, through the headset jack or a USB-C or Lightning headset adapter. Set the radio to USB and key it with VOX. RR73 has no CAT control: set the band on the radio and in RR73's band sheet.
3. In Settings, enter your callsign and grid (Use GPS fills the grid), then set the input and output levels in Settings › Radio and audio.
4. In Operate, tap Start audio.

## Repository

| Path | Contents |
| --- | --- |
| `crates/` | Rust: FT8, FT4, WSPR and RTTY codecs, DSP, decoders, channel simulator, corpus format, bench, WebAssembly bindings, and QSP. |
| `web/` | The app: Svelte 5, TypeScript, Vite. |
| `tools/` | ft8_lib oracle, reference decoder tools, KiwiSDR corpus recorder, reference data build, copy lint, release scripts. |
| `docs/` | Architecture, design documents, decision records, experiments, testing. |

## Development

Everything runs in Docker. `AGENTS.md` has the commands and the rules for changes.

```sh
docker compose build
docker compose run --rm rust cargo test --workspace
docker compose run --rm node npm --prefix web ci
docker compose run --rm --service-ports node npm --prefix web run dev
```

## Licence

Dual licensed under the MIT licence or the Apache License 2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.

Portions of `rr73-ft8` are ported from [ft8_lib](https://github.com/kgoba/ft8_lib) by Kārlis Goba (MIT). The FT8 and FT4 protocols are described in Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols", QEX, July/August 2020.
