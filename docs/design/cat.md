# Rig control

RR73 controls the radio over Web Serial in desktop Chrome and Edge, inside the same app. The Icom IC-705 comes first, over its USB cable; the Elecraft KX2 follows. The iPhone keeps VOX: Safari has no Web Serial, so the rig control settings never show there.

This branch adds the protocol and the pieces under it: the CI-V crate (`crates/rr73-cat`), its WebAssembly exports (`crates/rr73-wasm/src/cat.rs`), the serial link (`web/src/lib/cat/serial.ts`) and the choice of audio output. Connect radio, PTT in the transmit scheduler, the band sheet and the log frequency come in later branches, as designed below.

## Decision

- Web Serial in desktop Chromium, in the same PWA. The owner's station is a Windows tablet with Edge or Chrome and an IC-705 on one USB cable.
- CI-V over the IC-705's USB (A) port, which Windows lists as IC-705 Serial Port A (CI-V) (CI-V guide p. 2).
- The protocol in Rust, run in the app through `rr73-wasm`. The port, the timing and the user interface in TypeScript.
- Transmit keyed by CI-V command `1C 00`. Audio both ways over the IC-705's USB audio.
- RR73 reads the radio's menu settings and says what to change. It never changes them.
- Protocol facts come only from Icom's published documents, listed below. No other rig-control program's source is read.

## Reason

- One cable carries control and audio, and the radio's dial, mode and transmit state become known to RR73. VOX keys on any sound the tablet makes and cannot be read back.
- Web Serial is the only serial access a web page has. Chromium ships it on desktop, and Safari does not. Playwright's Firefox 155 build has `navigator.serial` too (measured); RR73 checks for the API, so Firefox would get rig control where it has it. Firefox is not tested.
- One app on the phone and the desktop keeps one decoder, one sequencer and one log.
- The protocol code sits with the other protocol crates, where random-input tests and a simulated radio run natively.

## Sources

Downloaded from Icom's site (icomjapan.com/support/manual) on 15 October 2026. Page numbers are the printed numbers.

| Document | Code, date | Used for |
| --- | --- | --- |
| IC-705 CI-V Reference Guide | A7560-8EX-6, January 2023 | Frame layout, command table, data formats |
| IC-705 Basic Manual | A7560D-1EX-9, December 2025 | Menu items and defaults, filters, coverage, the USB port |
| IC-705 Advanced Manual | A7560-7EX-5, April 2026 | USB SEND and keying, serial port settings, data modes |
| IC-705 Firmware Update Information | Versions 1.11 to 1.40 | Checked for changed CI-V commands: none of those below changed |
| USB Driver Installation Guide (Windows 11) | A7560-9EX-5, August 2026 | Windows support, port names, USB audio driver |

The CI-V guide prints the frame layout and the data formats but no complete example frames. The test frames in `crates/rr73-cat/tests/reference.rs` are worked from those layouts, each with its page.

## Web Serial

### Permission

- The first time, a tap on Connect radio calls `navigator.serial.requestPort()`, which needs the tap. Chromium shows its port chooser and the operator picks IC-705 Serial Port A (CI-V). The chooser also lists Serial Port B, which carries decoded RTTY, DV data, weather data or GPS sentences, and nothing with its function off, the default (Basic Manual p. 8-16). A port that gives no answer, or only noise, is that port, and RR73 says to pick port A.
- On later visits `navigator.serial.getPorts()` returns the ports the operator granted, and RR73 reopens the saved one without the chooser. When more than one granted port has the same USB IDs, RR73 sends a frequency read to each and keeps the one that answers. Unverified: whether ports A and B report the same USB IDs.
- The chooser takes no filter. Icom's documents give no USB vendor ID, so RR73 does not assume one.
- Revoking the permission in the browser's site settings empties `getPorts()`; Connect radio then shows the chooser again.
- Where `navigator.serial` is absent (Safari 26.6, measured, and iOS) `serialApi()` returns null and no rig control setting renders.

### Port settings

- 115200 baud, 8 data bits, no parity, 1 stop bit, no flow control (`CIV_PORT` in `lib/cat/serial.ts`).
- The baud rate does not matter on USB: the IC-705 communicates "regardless of the PC software's baud rate setting" (Basic Manual p. 13-2), and its Set mode has no CI-V baud rate item (p. 8-16 lists CI-V Address, CI-V Transceive and CI-V USB Echo Back). The CI-V guide's general advice to set the data communication speed (p. 2) has no item to act on. Unverified with Web Serial on a device.
- The CI-V guide gives no character format for USB (A). The Advanced Manual gives 8 data bits, no parity, 1 stop bit and no flow control for serial data on USB (B) (p. 12-14), and RR73 uses the same. Unverified.
- Windows needs Icom's USB driver before the cable goes in (CI-V guide p. 2; driver guide p. 2). The driver supports Windows 11 64-bit, except Windows on ARM (driver guide p. 1).

### Radio settings

| SET > Connectors > ... | Default | RR73 needs | Source |
| --- | --- | --- | --- |
| CI-V > CI-V Address | A4 | A4, or the address the operator enters in RR73 | Basic Manual p. 8-16 |
| CI-V > CI-V Transceive | ON | Either: RR73 polls | p. 8-16 |
| CI-V > CI-V USB Echo Back | OFF | Either: echoes are recognised and dropped | p. 8-16 |
| MOD Input > DATA MOD | USB | USB or MIC,USB, so transmit audio from the computer modulates in USB-D | p. 8-15, p. 3-2 |
| MOD Input > USB MOD Level | 50 % | The drive from the computer; with RR73's output level, keep the ALC in its zone | p. 8-15; Advanced Manual p. 2-18 |
| USB AF/IF Output > Output Select | AF | AF; IF gives the 12 kHz IF, which RR73 does not decode | p. 8-15 |
| USB AF/IF Output > AF Output Level | 50 % | The receive level into the computer | p. 8-15 |
| USB AF/IF Output > AF SQL | OFF (Open) | OFF (Open), so receive audio never gates | p. 8-15 |
| USB SEND/Keying > USB SEND | OFF | OFF: RR73 keys by CI-V, and DTR or RTS changes when a port opens cannot key the radio | p. 8-16; Advanced Manual p. 9-2 |

SET > Function > Time-Out Timer (default 5 min, Basic Manual p. 8-4) ends a transmission that runs too long. RR73 reads it and shows it in the connection details; with it off, a stuck transmission has no limit on the radio's side.

On connecting, RR73 reads DATA MOD, USB SEND and the Time-Out Timer with `1A 05` and names any setting to change, with its menu path.

## Commands

| Purpose | Frame data after `FE FE A4 E0` | Answer | CI-V guide |
| --- | --- | --- | --- |
| Read the operating frequency | `03` | `03` and 5 frequency bytes | p. 3, p. 17 |
| Set the operating frequency | `05` and 5 frequency bytes | OK or NG | p. 3, p. 17 |
| Read the operating mode | `04` | `04`, mode, filter | p. 3, p. 17 |
| Set the operating mode | `06`, mode, filter | OK or NG | p. 3, p. 17 |
| Read the data mode | `1A 06` | `1A 06`, `00` or `01`, filter | p. 14, p. 22 |
| Data mode on or off | `1A 06 01` and filter, or `1A 06 00 00` | OK or NG | p. 14, p. 22 |
| Transmit on, off | `1C 00 01`, `1C 00 00` | OK or NG | p. 14 |
| Read transmit or receive | `1C 00` | `1C 00`, `00` receive or `01` transmit | p. 14 |
| A VFO's frequency | `25`, `00` selected or `01` unselected, [5 frequency bytes] | data or OK | p. 15, p. 27 |
| A VFO's mode, data mode and filter | `26`, VFO, [mode, data, filter] | data or OK | p. 15, p. 27 |
| Read a menu setting | `1A 05` and the item: `0043` Time-Out Timer, `0118` DATA OFF MOD, `0119` DATA MOD, `0125` USB SEND, `0131` CI-V Transceive, `0132` CI-V USB Echo Back | `1A 05`, the item, the value | p. 6, p. 8 |
| Transceive from the radio | `00` and 5 frequency bytes; `01`, mode, filter | none | p. 3, p. 17 |

- Frequencies are 5 bytes of binary-coded decimal, least significant first: 10 Hz and 1 Hz in the first byte, up to the 1 GHz digit (fixed at 0) and the 100 MHz digit (0 to 4) in the last (p. 17). 14.074 MHz is `00 40 07 14 00`.
- Mode codes: `00` LSB, `01` USB, `02` AM, `03` CW, `04` RTTY, `05` FM, `06` WFM, `07` CW-R, `08` RTTY-R, `17` DV. Filters: `01` FIL1, `02` FIL2, `03` FIL3 (p. 17).
- OK is `FB` and NG is `FA`, from the radio to the controller (p. 2).
- A read sends the command and sub-command with no data area, and the answer repeats them before the data, following the layout on p. 2. The guide does not state the read form in words. Unverified.
- The guide does not list which commands answer with OK. RR73 takes OK or NG as the answer to every set command, and NG or a garbled reply as the answer to a read. Unverified.
- `19 00` reads the transceiver ID (p. 5), but the guide gives no format for its answer, so RR73 does not use it.

### USB-D for FT8, FT4 and WSPR

RR73 sets USB, FIL1 with `06 01 01`, then data mode on with FIL1 with `1A 06 01 01`. In USB-D, FIL1 is 3.0 kHz by default, FIL2 1.2 kHz and FIL3 500 Hz (Basic Manual p. 4-5), and the transmit passband is 300 Hz to 2700 Hz (p. 4-8).

`26 00 01 01 01` sets the same in one command (p. 27), and the crate has it. `06` and `1A 06` act on the operating mode, while `26` names a VFO and answers NG in the DR function (p. 27). Unverified: how each behaves in memory mode.

## The dial

While connected and idle, RR73 reads the frequency (`03`) every 1 s and the mode and data mode (`04`, `1A 06`) every 5 s, one request in flight at a time. Transceive frames (`00`, `01`) update the dial at once when they arrive.

- CI-V Transceive is on by default (Basic Manual p. 8-16), but the operator can turn it off, and the guide gives no transceive frame for the data mode. Polling covers both.
- The guide does not say which receiving address transceive frames carry, so the parser takes every frame from the radio's address. Unverified.
- An answer is expected within 500 ms; a request with none counts as lost, and 3 lost in a row show "No reply from the IC-705". Unverified timings.
- With Echo Back on, the radio sends each frame back first (Basic Manual p. 8-16; the Bluetooth equivalent "sends back the serial data received", p. 8-22). The parser marks frames from the controller's address to the radio's as echoes, so neither setting needs changing.

## Transmit

The transmit scheduler keeps its timing and adds the radio around the audio:

1. `1C 00 01` 100 ms before the audio starts (slot edge plus 0.5 s for FT8 and FT4, plus 1 s for WSPR).
2. The audio plays only after the radio's OK. Without an OK within 500 ms the transmission is cut and the status line says so.
3. `1C 00 00` when the audio ends.

Tune and RTTY do the same: `1C 00 01` before the tone or the stream, `1C 00 00` after it. Halt sends `1C 00 00` and stops the audio in the same tap, without waiting for an answer.

Unverified: the time from `1C 00 01` to RF output. SET > Function > TX Delay adds 10 to 30 ms per band for slow external equipment and is off by default (Basic Manual p. 8-4; CI-V guide pp. 5 and 6); neither document gives a figure for the radio itself. The 100 ms lead is a starting value to measure on a device.

### When the port closes during a transmission

- A `disconnect` event or a failed read ends the link with `lost`. RR73 then stops the audio at once, as when audio stops, and the status line says the radio is disconnected.
- On the next connection RR73 reads `1C 00` and sends `1C 00 00` if the radio still transmits.
- On `pagehide` RR73 writes `1C 00 00` before the page goes. The write may not reach the radio.
- Unverified: whether the IC-705 stops transmitting by itself when the USB port closes while keyed by `1C 00 01`. Icom's documents do not say. With the audio stopped nothing modulates the transmitter, and the Time-Out Timer ends the transmission after 5 min by default (Basic Manual p. 8-4).

## Band sheet, log and sequencer

- Band sheet: with the radio connected, picking a band sends `05` with the band's dial (the band's FT8 or FT4 dial, or the operator's own from the dial fields), then USB-D. The radio's OK replaces the confirmation that decision 0002 asks for without CAT. The sheet shows the dial the radio reports.
- Turning the radio's dial: RR73 follows it. The band follows the frequency read, and the dial shown is the radio's.
- Log: a QSO's frequency is the radio's dial, read at most 1 s before, plus the Tx audio frequency. Without the radio connected it stays as now, the band's dial from `lib/radio/bands.ts`.
- Sequencer: its state machine is unchanged. Only the transmit scheduler talks to the radio.

## Audio

The IC-705's [microUSB] port carries USB audio both ways: "USB Audio Input: Inputting a modulation AF signal" and "USB Audio Output: Outputting a demodulated AF signal or 12 kHz IF signal" (Basic Manual p. 13-2). On Windows the audio driver installs with the USB driver (driver guide p. 4). Icom's documents do not name the audio devices as Windows lists them.

- Receive: Settings › Radio and audio › Input, set to the IC-705's USB audio.
- Transmit: Settings › Radio and audio › Output, set to the IC-705's USB audio (this branch). It uses `AudioContext.setSinkId`, which Chromium has and Safari 26.6 and Firefox 155 lack (measured in Playwright's builds), so the row shows only where the browser supports it. FT8, FT4, WSPR and RTTY transmissions, Tune and the start chime play to the chosen output.

Measured in Chromium 153 (headless on Linux, with fake devices):

- `setSinkId` on a running context fires `suspended` and then `running` within 5 ms. The capture engine ignores state changes during the switch, resumes the context if the switch leaves it suspended, and starts the clock mapping over, because each device has its own output latency.
- A context created with a `sinkId` naming a missing device starts and then suspends, with its `sinkId` back to the default. RR73 never passes `sinkId` to the constructor: it calls `setSinkId` after creating the context.
- `setSinkId` with a missing device rejects with `NotFoundError` and leaves the output where it was. RR73 then plays to the system default, the Output row says the chosen output is not connected, and RR73 tries again when a device is plugged in.
- Fake devices list 3 outputs, so the end-to-end test runs in Chromium.
- Playwright's Chromium gives devices new IDs on every page load, as a private window does. RR73 saves the output's name with its ID and finds it again by name when the ID is gone (`matchOutput` in `lib/audio/sink.ts`), unless 2 outputs share the name. Unverified: whether Windows gives a USB audio device a new ID on another USB port.

Changing the output halts Tune and any transmission, so no transmission moves between devices.

## Testing

- `crates/rr73-cat/tests/reference.rs`: frames worked from the guide's layouts, with their pages.
- `crates/rr73-cat/tests/sim.rs`: each request against the simulated IC-705 (`rr73_cat::sim`), with Echo Back and Transceive on and off.
- `crates/rr73-cat/tests/fuzz.rs`: random bytes and frame-shaped input against the frame reader, the parser and the simulator; random frequencies through the BCD format; random requests answered exactly once.
- `crates/rr73-wasm/src/cat.rs` and `web/src/lib/cat/wasm.test.ts`: the JSON form of requests and events through the WebAssembly exports.
- `web/src/lib/cat/serial.test.ts`: the serial link against a fake port.
- The output choice: unit tests of the engine and the settings, and `e2e/output.spec.ts` in the chromium project with fake devices.

The simulator's behaviour where the guide is silent is its own choice and is listed in `crates/rr73-cat/src/sim.rs`.

## Alternatives rejected

- Keying with DTR or RTS (USB SEND, Advanced Manual p. 9-2). It needs a menu change, gives no confirmation, and the line state when a port opens depends on the driver. `1C 00` answers OK and reads back.
- VOX on the desktop. It stays for the iPhone and as a fallback, but it keys on any sound the computer plays and cannot be read back.
- Bluetooth: the IC-705 offers CI-V over Bluetooth's Serial Port Profile (Basic Manual p. 8-22), and Web Bluetooth reaches only Bluetooth Low Energy.
- The IC-705's Wi-Fi remote control: it needs UDP, which browsers do not offer (`docs/architecture.md`, platform constraints).
- WebUSB to the radio's USB interfaces: the operating system's serial and audio drivers hold them, and Web Serial reaches the serial port through the driver.
- A helper program on the computer: another install, where the browser already has serial access.
- The protocol in TypeScript: the Rust crate shares the house's testing (random input, a simulated radio) with the other protocol crates.
- `26` for USB-D in one command: kept in the crate and unused for now (above).

## Open risks

- The tablet's processor: Icom's driver does not support Windows on ARM (driver guide p. 1). On such a tablet the CI-V port does not appear.
- Every Unverified point above: the read form, OK for every set, the transceive address, the time to RF, the radio's behaviour when the port closes, memory mode.
- Web Serial through Icom's driver on Windows, and the USB audio codec's sample rate through Chromium. Not tested on a device.
- The output choice was measured in headless Chromium on Linux. Not tested on a device.
- Port B in the chooser: an operator who picks it gets no answer from the radio until they pick port A.
