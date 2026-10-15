# RR73

RR73 is an FT8, FT4, WSPR and RTTY app for amateur radio operators, made for the iPhone. It runs in Safari and connects to the radio through an audio cable, keying the transmitter by VOX.

The app is at https://nnamon.github.io/RR73/. Once added to the home screen it opens and decodes without a network connection.

<table>
<tr>
<td><img src="docs/screenshots/ft8-receiving.png" width="260" alt="Operate receiving FT8 on 20m: the waterfall and the decodes of the last slot"></td>
<td><img src="docs/screenshots/ft8-qso.png" width="260" alt="Operate in a QSO: the caller's message to 9V1NE, the report being sent and the QSO's steps"></td>
<td><img src="docs/screenshots/ft8-dark.png" width="260" alt="Operate receiving FT8 in the dark theme"></td>
</tr>
</table>

## Features

Every upload and optional feature is off until turned on in Settings.

### Operating

- Double-tap a decode to work the station. Each message goes out in its slot with the report filled in, and the QSO is logged when it completes.
- Repeat CQ keeps calling CQ after each QSO and answers callers from a queue, in the order chosen.
- Hunt answers CQs one after another until stopped, unworked stations first.
- Hound mode works FT8 DXpeditions running Fox and Hound, reading the report out of the Fox's multi-call messages.
- Halt is always on screen. The watchdog stops Tx after 6 min without a touch, adjustable in Settings.
- Decode colours mark messages to your call, CQs, new DXCC entities, continents, zones, grids and calls, and stations already worked. One colour scheme stays distinguishable with colour blindness.
- Chips filter the list to CQ, New, To me or Rx freq. Hide worked drops stations already logged on the band and mode.
- A Clock badge shows when the phone's clock is 1 s or more off.

### Decoding

- The FT8, FT4, WSPR and RTTY decoders are RR73's own, written in Rust and compiled to WebAssembly. They run on the phone.
- Up to 3 passes per FT8 or FT4 slot, each decoded signal subtracted before the next. Ordered-statistics decoding (OSD) takes the candidates belief propagation fails on.
- After the slot, 2 later stages search finer time and frequency grids for up to 2 s.
- First decodes appear 13.5 s into an FT8 slot (6 s into FT4).
- During a QSO, a priori decoding tests weak signals near the other station against the messages expected next.

### Logging and activations

- The log is stored on the phone and works offline.
- QSOs go to Wavelog on request or automatically. A refused QSO shows the reason and a Fix button.
- ADIF export and import, and a backup of the whole log to one file.
- POTA, SOTA, WWFF and IOTA activations, with progress toward each programme's goal and the time left in the UTC day.
- Park and summit suggestions by name, or from the phone's GPS position.
- POTA, SOTA and WWFF upload files for each activation.
- Spots lists POTA activators and DX cluster spots.
- Decodes can be reported to PSK Reporter through a relay. Heard you lists the stations that heard your signal in the last 30 min.

<table>
<tr>
<td><img src="docs/screenshots/log.png" width="260" alt="The log by day, with each QSO's state at Wavelog and a refusal with Fix"></td>
<td><img src="docs/screenshots/activation.png" width="260" alt="A POTA and SOTA activation: progress toward 10 QSOs and the summit qualified"></td>
<td><img src="docs/screenshots/heard-you.png" width="260" alt="Heard you: the stations that reported hearing 9V1NE in the last 30 minutes"></td>
</tr>
</table>

### WSPR and RTTY

- WSPR decodes each 2-minute slot and lists the spots farthest first.
- The WSPR beacon transmits in a set share of slots, 20% by default.
- WSPR spots can be uploaded to WSPRnet.
- RTTY runs at 45.45 baud and 170 Hz shift by default, with other speeds and shifts as presets.
- Tap a callsign in the RTTY text to start a QSO. Name, QTH and report fill in from what that station sent.
- RTTY macros, including a contest set that numbers each QSO.

<table>
<tr>
<td><img src="docs/screenshots/hound.png" width="260" alt="FT8 Hound: the Fox's multi-call message with the report to 9V1NE, and the R-report on air"></td>
<td><img src="docs/screenshots/wspr.png" width="260" alt="WSPR on 20m: spots of two slots, farthest first, and the beacon"></td>
<td><img src="docs/screenshots/rtty.png" width="260" alt="RTTY: received text with callsigns marked, the QSO strip with name and QTH, and the macros"></td>
</tr>
</table>

### Receiving without a radio

- A KiwiSDR web SDR can stand in for the radio's receive audio through a QSP relay. Tx still goes to the radio.
- The practice band simulates a busy band with CQs, callers, RTTY stations and a DXpedition. Its QSOs go to a separate log.
- Tx audio still plays in practice and can key a connected radio. Play Tx audio in Settings › Practice band turns it off.

### Display

- Light and dark themes, and a night display in dim red on black.
- On an iPad or a desktop, Band activity, Rx frequency and the transmit panel sit side by side.
- On a keyboard, Esc halts and ? lists the other shortcuts.

<img src="docs/screenshots/ipad.png" width="800" alt="Operate on an iPad: band activity, the Rx frequency list and the transmit panel beside the waterfall">

<img src="docs/screenshots/desktop.png" width="800" alt="Operate in a desktop browser in the dark theme">

## Decoder measurements

Figures from `rr73-bench`. SNR is in a 2500 Hz bandwidth, and SNR50 is the SNR at which half the messages decode.

| | First stage | With the later stages |
| --- | --- | --- |
| FT8 SNR50, white noise | −19.0 dB | −19.9 dB |
| FT8 SNR50, Watterson fading | −15.7 dB | −17.3 dB |
| FT4 SNR50, white noise | −14.2 dB | −15.4 dB |
| FT8, reference decodes found in 350 slots recorded on 40m | 74% | 84% |

Neither column gave a false decode in 5000 FT8 or 10000 FT4 noise-only slots. A priori decoding moves the SNR50 of FT8 replies in a QSO from −19.0 to −21.7 dB, with none in 10000 noise-only slots. Method and data sets: `docs/bench.md` and decision records 0007 and 0009.

## Requirements

- An iPhone with iOS 26 and Safari. An iPad or a desktop browser also works.
- A cable between the phone's headset audio and the radio's audio in and out, through the headset jack or a USB-C or Lightning headset adapter.
- The radio in USB, keyed by VOX.

There is no CAT control. Set the band on the radio and in the band sheet. Rig control over Web Serial in desktop Chrome and Edge is planned.

## Getting started

1. Open https://nnamon.github.io/RR73/ in Safari and choose Share › Add to Home Screen.
2. Connect the cable. Set the radio to USB with VOX on.
3. In Settings, enter the callsign and grid. Use GPS fills in the grid.
4. Set the input and output levels in Settings › Radio and audio.
5. In Operate, choose the band and tap Start audio. A short chime keys the radio through VOX.

Settings › Practice band runs a simulated band for trying RR73 without a radio.

## Relay

QSP, in `crates/rr73-qsp`, is an optional relay server. It carries KiwiSDR audio, which a page in Safari cannot open over plain `ws://`, and PSK Reporter reports, which travel over UDP. The app ships with no relay set up. Relays are added in Settings › Relay.

Anyone can run a relay. Each release includes QSP binaries for x86-64 and ARM64 Linux and the image `ghcr.io/nnamon/rr73-qsp`. Setup is in `crates/rr73-qsp/README.md`.

## Repository

| Path | Contents |
| --- | --- |
| `crates/` | Rust: FT8, FT4, WSPR and RTTY codecs, DSP, decoders, channel simulator, corpus format, bench, WebAssembly bindings, and QSP. |
| `web/` | The app: Svelte 5, TypeScript, Vite. |
| `tools/` | FT8 codec test oracle, reference decoder tools, KiwiSDR corpus recorder, reference data build, copy lint, release scripts. |
| `docs/` | Architecture, design documents, decision records, experiments, testing. |

## Development

Everything runs in Docker. `AGENTS.md` lists the commands and the rules for changes.

```sh
docker compose build
docker compose run --rm rust cargo test --workspace
docker compose run --rm node npm --prefix web ci
docker compose run --rm --service-ports node npm --prefix web run dev
```

## Licence

Dual licensed under the MIT licence or the Apache License 2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.

Portions of `rr73-ft8` are ported from [ft8_lib](https://github.com/kgoba/ft8_lib) by Kārlis Goba (MIT). The FT8 and FT4 protocols are described in Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols", QEX, July/August 2020.
