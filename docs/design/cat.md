# Rig control

RR73 controls the radio over Web Serial in desktop Chrome and Edge, inside the same app. The Icom IC-705 comes first, over its USB cable; the Elecraft KX2 follows. The iPhone keeps VOX: Safari has no Web Serial, so the rig control settings never show there.

Two branches built it. The first (0.21.7) added the protocol and the pieces under it: the CI-V crate (`crates/rr73-cat`), its WebAssembly exports (`crates/rr73-wasm/src/cat.rs`), the serial link (`web/src/lib/cat/serial.ts`) and the choice of audio output. The second added Settings › Rig control, the link to the radio (`web/src/lib/cat/radio.ts`, `web/src/lib/state/cat.svelte.ts`), PTT for every transmission, the band sheet and the dial QSOs log, and the input device remembered by name.

## Decision

- Web Serial in desktop Chromium, in the same PWA. The owner's station is a Windows tablet with Edge or Chrome and an IC-705 on one USB cable.
- CI-V over the IC-705's USB (A) port, which Windows lists as IC-705 Serial Port A (CI-V) (CI-V guide p. 2).
- The protocol in Rust, run in the app through `rr73-wasm`. The port, the timing and the user interface in TypeScript.
- Transmit keyed by CI-V command `1C 00`, and only once the operator turns on Key the radio with CAT. It is off by default: a connected radio then has its dial and mode read and set, and transmissions key by VOX as without rig control. Audio both ways over the IC-705's USB audio.
- Connecting sends no PTT and changes no setting on the radio: not its power, its VOX or any menu item. RR73 reads the radio's menu settings and says what to change.
- Protocol facts come only from Icom's published documents, listed below. No other rig-control program's source is read.

## Reason

- One cable carries control and audio, and the radio's dial, mode and transmit state become known to RR73. VOX keys on any sound the tablet makes and cannot be read back.
- Keying by CAT is opt-in so that nothing keys the radio by surprise: the operator checks the dial, the band changes and Test keying first (below, First session).
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

## First session

The owner's first session brings rig control up in stages. Each stage needs the one before, and Key the radio with CAT stays off until stage 6.

1. Before the first Connect radio, on the IC-705: set SET > Connectors > USB SEND/Keying > USB SEND to OFF, its default (Basic Manual p. 8-16). Chromium raises the port's DTR and RTS lines while it opens the port, and with USB SEND on a line that may key the radio until RR73 lowers them (Port settings, below). Check that SET > Function > Time-Out Timer is on (default 5 min, Basic Manual p. 8-4): it is the last limit on the radio's side.
2. Close the other FT8 program: Windows lets one program at a time open the port. In Settings › Rig control, tap Connect radio and choose IC-705 Serial Port A (CI-V). Check that the Dial row and Operate's top bar show the frequency and mode on the radio's screen, and that the Radio settings rows show USB SEND OFF, DATA MOD USB and the Time-Out Timer on.
3. Change band from RR73's band sheet and check that the radio follows in USB-D. Turn the radio's dial into another band and check that RR73 follows within about 1 s.
4. Set the radio to low power into a dummy load or a matched antenna.
5. Tap Test keying. The radio transmits for 1 s with no audio, and the screen says "Keyed and released at 13:14:30 UTC." Any other answer names what went wrong.
6. Only then turn on Key the radio with CAT, and call CQ. Halt (or Esc) sends PTT off at once.

## Web Serial

### Permission

- The first time, a tap on Connect radio calls `navigator.serial.requestPort()`, which needs the tap. Chromium shows its port chooser and the operator picks IC-705 Serial Port A (CI-V). The chooser also lists Serial Port B, which carries decoded RTTY, DV data, weather data or GPS sentences, and nothing with its function off, the default (Basic Manual p. 8-16). A port that sends only bytes that are not CI-V frames is that port, and Rig control says to choose port A.
- RR73 opens only the port the operator chose. Connect radio takes back the browser's permission for every other port it was allowed (`SerialPort.forget()`), so on later visits `navigator.serial.getPorts()` lists the chosen port alone, and RR73 opens it without the chooser. With none listed, Rig control says to plug the radio in and connect it. With more than one of the chosen port's USB IDs listed, as where the browser cannot forget a port, RR73 opens none and asks the operator to choose: it never opens a port to see whether the radio answers.
- `navigator.serial` fires `connect` when an allowed port is plugged in again, and RR73 opens it then.
- Disconnect radio closes the port and takes back its permission. Transmissions key by VOX again.
- The chooser takes no filter. Icom's documents give no USB vendor ID, so RR73 does not assume one.
- Revoking the permission in the browser's site settings empties `getPorts()`; Connect radio then shows the chooser again.
- Where `navigator.serial` is absent (Safari 26.6, measured, and iOS) `serialApi()` returns null and no rig control setting renders.

### Port settings

- 115200 baud, 8 data bits, no parity, 1 stop bit, no flow control (`CIV_PORT` in `lib/cat/serial.ts`).
- The baud rate does not matter on USB: the IC-705 communicates "regardless of the PC software's baud rate setting" (Basic Manual p. 13-2), and its Set mode has no CI-V baud rate item (p. 8-16 lists CI-V Address, CI-V Transceive and CI-V USB Echo Back). The CI-V guide's general advice to set the data communication speed (p. 2) has no item to act on. Unverified with Web Serial on a device.
- The CI-V guide gives no character format for USB (A). The Advanced Manual gives 8 data bits, no parity, 1 stop bit and no flow control for serial data on USB (B) (p. 12-14), and RR73 uses the same. Unverified.
- Chromium on Windows asserts DTR and RTS when a page opens a port with no hardware flow control: `ConfigurePortImpl` in Chromium's `services/device/serial/serial_io_handler_win.cc` sets `fDtrControl = DTR_CONTROL_ENABLE` always, and `fRtsControl = RTS_CONTROL_ENABLE` without CTS flow control, and `FinishOpen` in `serial_io_handler.cc` runs it before `open()` resolves. The IC-705 assigns USB SEND to the DTR or RTS terminal of a port (Advanced Manual p. 9-2), so with USB SEND on a line, opening the port may key the radio. RR73 calls `setSignals({ dataTerminalReady: false, requestToSend: false })` as soon as `open()` resolves, before any write, and closes the port and says so if that fails (`SerialLink.open` in `lib/cat/serial.ts`). Web Serial cannot close the gap between the two. Not measured on a device.
- After the port opens, RR73 waits 100 ms and drops whatever arrived meanwhile, then sends its first request.
- Windows needs Icom's USB driver before the cable goes in (CI-V guide p. 2; driver guide p. 2). The driver supports Windows 11 64-bit, except Windows on ARM (driver guide p. 1).

### Radio settings

| SET > Connectors > ... | Default | RR73 needs | Source |
| --- | --- | --- | --- |
| CI-V > CI-V Address | A4 | A4 | Basic Manual p. 8-16 |
| CI-V > CI-V Transceive | ON | Either: RR73 polls | p. 8-16 |
| CI-V > CI-V USB Echo Back | OFF | Either: echoes are recognised and dropped | p. 8-16 |
| MOD Input > DATA MOD | USB | USB or MIC,USB, so transmit audio from the computer modulates in USB-D | p. 8-15, p. 3-2 |
| MOD Input > USB MOD Level | 50 % | The drive from the computer; with RR73's output level, keep the ALC in its zone | p. 8-15; Advanced Manual p. 2-18 |
| USB AF/IF Output > Output Select | AF | AF; IF gives the 12 kHz IF, which RR73 does not decode | p. 8-15 |
| USB AF/IF Output > AF Output Level | 50 % | The receive level into the computer | p. 8-15 |
| USB AF/IF Output > AF SQL | OFF (Open) | OFF (Open), so receive audio never gates | p. 8-15 |
| USB SEND/Keying > USB SEND | OFF | OFF: RR73 keys by CI-V, and DTR or RTS changes when a port opens must not key the radio | p. 8-16; Advanced Manual p. 9-2 |

SET > Function > Time-Out Timer (default 5 min, Basic Manual p. 8-4) ends a transmission that runs too long. RR73 reads it and shows it; with it off, a stuck transmission has no limit on the radio's side, and Rig control says to set it.

On connecting, RR73 reads USB SEND, DATA MOD and the Time-Out Timer with `1A 05` and shows each with the menu path of any setting to change. It never sets them. A setting that goes unanswered is read again every 5 s until the radio answers it or refuses it with NG. While USB SEND reads 1 to 4 (a line of port A or B, CI-V guide p. 8), RR73 keeps the lines low, refuses every transmission, Tune and Test keying ("Set USB SEND to OFF" in the status line), and Rig control gives the menu path. The CI-V address is A4: an operator who changed it gets "No reply from the IC-705", which names the setting.

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
- OK is `FB` and NG is `FA`, from the radio to the controller (p. 2). `1C 00` is send and read data, `05` and `06` send only, `03` and `04` read only (the table's legend, p. 16).
- A read sends the command and sub-command with no data area, and the answer repeats them before the data, following the layout on p. 2. The guide does not state the read form in words. Unverified.
- The guide does not list which commands answer with OK. RR73 takes OK or NG as the answer to every set command, and NG or a garbled reply as the answer to a read. Unverified.
- The guide gives the data mode's answer as the data mode and its filter (p. 22). The parser also reads an answer with the data mode alone, with no filter.
- The guide's preamble is two `FE` bytes (p. 2). The frame reader also reads a frame whose first `FE` was lost.
- `19 00` reads the transceiver ID (p. 5), but the guide gives no format for its answer, so RR73 does not use it.

### USB-D for FT8, FT4, WSPR and RTTY

RR73 sets USB, FIL1 with `06 01 01`, then data mode on with FIL1 with `1A 06 01 01`. In USB-D, FIL1 is 3.0 kHz by default, FIL2 1.2 kHz and FIL3 500 Hz (Basic Manual p. 4-5), and the transmit passband is 300 Hz to 2700 Hz (p. 4-8).

`26 00 01 01 01` sets the same in one command (p. 27), and the crate has it. `06` and `1A 06` act on the operating mode, while `26` names a VFO and answers NG in the DR function (p. 27). Unverified: how each behaves in memory mode.

## The link

`lib/cat/radio.ts` holds one radio on one open port.

- Requests go out one at a time from a queue. Each waits 500 ms for its answer; one without counts as lost, and 3 lost in a row show "No reply from the IC-705". Unverified timings.
- The radio answers frames in the order they arrive, so an answer goes to the oldest request in flight that it answers. OK and NG carry no command byte. After a request goes unanswered, RR73 drains for 250 ms: nothing but PTT off goes out, and every answer that arrives is dropped as a late one, so a late OK is never taken as the answer to a later request.
- PTT on, PTT off and the read that confirms PTT off jump the queue and go out at once, ahead of the polls waiting in it and beside the one in flight. PTT on and the confirming read wait for a drain to end; PTT off never waits.
- While connected and not keyed, RR73 reads the frequency (`03`) every 1 s and the mode and data mode (`04`, `1A 06`) every 5 s. While RR73 holds PTT on, this polling stops: RR73 reads `1C 00` every 1 s instead, from 100 ms after the radio's OK (Transmit, PTT off). With Key the radio with CAT off, RR73 does not know when VOX keys the radio, and the polling goes on. Transceive frames (`00`, `01`) update the dial at once when they arrive. CI-V Transceive is on by default (Basic Manual p. 8-16), but the operator can turn it off, and the guide gives no transceive frame for the data mode. Polling covers both.
- The guide does not say which receiving address transceive frames carry, so the parser takes every frame from the radio's address. The simulator sends them to `00`. Unverified.
- With Echo Back on, the radio sends each frame back first (Basic Manual p. 8-16; the Bluetooth equivalent "sends back the serial data received", p. 8-22). The parser marks frames from the controller's address to the radio's as echoes, so neither setting needs changing.

## The dial

- The dial RR73 shows and uses is the radio's while a radio is connected and its dial is on RR73's band: the top bar, the band sheet, saved slots, WSPR spots, the web SDR's tuning, PSK Reporter and WSPRnet reports. QSOs log it plus the Tx audio frequency, read at most 1 s before. Without a radio it stays as before: the band's dial from `lib/radio/bands.ts`, or the operator's own.
- Band sheet: with a radio connected, choosing a band or a mode, entering a dial (FT8, FT4, RTTY or Hound) or Go on a spot sets the radio with `05`, then USB-D. Each sets only after a read of `1C 00` says receive: the dial and mode never change while the radio transmits, by CAT, VOX or its own PTT. While it transmits the sheet says the dial goes there when Tx ends, and RR73 tries for 15 s. The radio's OK and the dial it then reports replace the confirmation that decision 0002 asks for without CAT. The sheet shows what the radio reports, or that it refused.
- Turning the radio's dial: RR73 follows within about 1 s, by polling or at once by transceive. A dial read on another band than the last one moves RR73 to that band, and to FT8 there when the mode has no dial on it. On connecting, RR73 moves to the radio's band.
- While the radio's dial is on another band than RR73's, or outside every band RR73 has, transmissions are refused ("Radio on 40m", "Radio outside the bands"), so no QSO logs the wrong band.
- The sequencer's state machine is unchanged: it reads the dial from its configuration, which follows the radio.

## Transmit

With Key the radio with CAT off, transmissions play their audio as without rig control, and the radio keys by VOX. With it on, every transmission keys the radio with `1C 00 01` first.

1. The transmit scheduler (FT8, FT4 and WSPR, `lib/tx/scheduler.ts`) keys the radio at its pre-roll, 500 ms before the audio: the slot edge in FT8 and FT4, slot + 0.5 s in WSPR.
2. The audio goes to the output only after the radio's OK, and starts 100 ms or more after it. The OK has 300 ms, so the audio starts on time at slot + 0.5 s (slot + 1 s in WSPR) whenever it comes: with an OK after 10 ms, the audio starts 490 ms after it. A late start keys at once and starts the audio 100 ms after the OK.
3. Without an OK within 300 ms, or with NG, no audio plays: PTT off goes out at once and is confirmed (PTT off, below), the status line says "Radio did not answer PTT" or "Radio refused PTT", and Tx stays as when audio is refused. FT8 and FT4 try again in the next slot; the WSPR beacon stops.
4. Audio starts only while the keying still holds PTT (`Keying.held`). PTT taken back between PTT on and the audio, by Halt, a fault or another keying, leaves the transmission silent.
5. PTT off goes 100 ms after the last sample is heard: the audio thread ends a sound before its last sample leaves the output, so RR73 adds the context's output latency (`outputLatency` in Chromium, `baseLatency` elsewhere) to the 100 ms.
6. Each keying carries a limit: PTT goes off by itself when a transmission should long be over (the lead, the timeout, the settling time, the audio, the tail and 1 s: about 14.7 s for FT8). Tune's is about 11.5 s. An RTTY stream has no set length, so it has none: RTTY's own watchdog and the radio's Time-Out Timer limit it.

Measured in headless Chromium with the fake radio (`e2e/rig.spec.ts`, which holds the audio within 60 ms of slot + 0.5 s): PTT on 434 ms before an FT8 CQ's audio and PTT off 71 ms after it ended. For RTTY, PTT on came 156 ms before the stream and PTT off 73 ms after it.

- RTTY (`lib/state/keyboard.svelte.ts`): PTT on, the OK, and the stream 100 ms later; PTT off the output latency and 100 ms after it drains, and at once when it stops.
- Tune (`lib/state/station.svelte.ts`): PTT on, the OK, and the tone 100 ms later; PTT off the output latency and 100 ms after the tone ends, and at once on Halt. Without an OK no tone plays and Radio and audio says why.
- The start chime keys nothing while CAT keys the radio: it exists to key VOX for the keying check, and the radio's OK replaces that check. It plays silence then, for iOS's sake.

Unverified: the time from `1C 00 01` to RF output. SET > Function > TX Delay adds 10 to 30 ms per band for slow external equipment and is off by default (Basic Manual p. 8-4; CI-V guide pp. 5 and 6); neither document gives a figure for the radio itself. The 100 ms after the OK is a starting value to measure on a device.

### PTT off

PTT off goes out up to 4 times, 100 ms apart, until the radio answers OK, then a read of `1C 00` must say receive. Until a read says receive, the radio counts as keyed: no dial or mode set goes out. Without that confirmation:

- every mode's status line says "PTT off not confirmed · unkey radio", whether Tx was on or not, and Tx goes off;
- every transmission, Tune and Test keying are refused until a read says receive;
- Rig control's badge says "PTT off not confirmed", and its footer "The IC-705 did not confirm PTT off. If it still transmits, unkey it at the radio or turn it off.";
- RR73 reads `1C 00` every 1 s and sends PTT off again while the radio says transmit. A read that says receive clears the error.

After PTT on goes unanswered, RR73 drains for 250 ms and drops every answer, so the OKs to the first PTT offs are dropped too: all 4 go out, and the read after the drain decides. With the radio answering in 10 ms, the read confirms receive about 0.66 s after PTT on timed out (`radio.test.ts`).

While keyed, RR73 reads `1C 00` every 1 s in place of the dial, from 100 ms after the radio's OK: until then the radio may still be switching to transmit. A radio that stops answering (3 reads in a row), or says receive (its own Time-Out Timer, its PTT), ends the transmission: PTT off, Tx off, and "No reply from radio · Tx off" or "Radio stopped transmitting · Tx off".

### Test keying

Settings › Rig control › Test keying stops any transmission, keys the radio for 1 s with no audio, reads `1C 00` while keyed, sends PTT off, and reports once PTT off is confirmed or has failed (PTT off, above):

- "Keyed and released at 13:14:30 UTC."
- "The IC-705 answered OK but stayed in receive. Check that SET › Function › PTT Lock is off." (PTT Lock "inhibits all transmissions", Basic Manual p. 8-4.)
- "No reply to PTT from the IC-705 within 0.3 s. PTT off was sent and confirmed.", or "The IC-705 refused PTT. PTT off was sent and confirmed."
- "No reply from the IC-705 to PTT on or off." or "Keyed. PTT off was not confirmed.", with Connection's footer saying what to do (PTT off, above).

It works with Key the radio with CAT on or off and needs a radio connected. It is refused while USB SEND reads a line or an earlier PTT off is unconfirmed. Halt, a lost port, a fault and the page going stop it with PTT off.

### Safety paths

The radio must never stay keyed by RR73. Each path below has a test.

| Path | What RR73 does | Tests |
| --- | --- | --- |
| The port opens | DTR and RTS low before any write; the port closes again if they cannot be lowered; 100 ms wait, input dropped | `serial.test.ts`, `cat.test.ts` (the simulator keyed by DTR at open), `rig.spec.ts` (lines low after Connect radio) |
| USB SEND on a line (`0125` reads 1 to 4) | Lines kept low; Tx, Tune and Test keying refused ("Set USB SEND to OFF"); Rig control gives the menu path | `cat.test.ts` |
| Halt, and Esc | Stops all output; PTT off at once while Key the radio with CAT is on or RR73 may hold PTT | `scheduler.test.ts`, `cat.test.ts`, `rig.spec.ts` (Halt during a CQ: PTT off within 50 ms; during Tune) |
| End of a transmission, Tune or Test keying | PTT off the output latency and 100 ms after the audio ends, confirmed by a read | `scheduler.test.ts`, `cat.test.ts`, `rig.spec.ts` (CQ, RTTY, Tune, Test keying) |
| No OK within 300 ms, NG, no link | No audio; PTT off at once, confirmed; the radio counts as keyed until a read says receive | `scheduler.test.ts`, `radio.test.ts`, `cat.test.ts` (Test keying) |
| PTT taken back before the audio starts | No audio: FT8, FT4, WSPR, RTTY and Tune check that the keying still holds PTT | `scheduler.test.ts`, `radio.test.ts` |
| A PTT off without OK | Sent again, 100 ms apart, 4 times at most, then confirmed by a read | `radio.test.ts` |
| PTT off unconfirmed | Status line in every mode, Tx off, Tx refused, Rig control's error; read every 1 s and PTT off again while the radio transmits | `radio.test.ts`, `cat.test.ts` |
| A late OK or NG | Dropped in a 250 ms drain after any request goes unanswered, so it never answers a later request | `radio.test.ts` |
| PTT and the queue | PTT on and off go ahead of queued polls; the dial poll stops while keyed | `radio.test.ts` |
| Dial and mode sets while keyed | Refused while RR73 may hold PTT or a read says transmit (VOX, the radio's own PTT) | `radio.test.ts`, `cat.test.ts` |
| Audio stops or is interrupted | The engine's stop runs Halt: PTT off at once, Tx off | `rig.spec.ts` (the context suspended during a CQ) |
| The page hides or closes (`visibilitychange`, `pagehide`) | Halt: PTT off is written before the page goes. Best effort: the write may not reach the radio | `cat.test.ts` (during a transmission and during Test keying) |
| The serial port is lost | The audio stops at once and Tx goes off, as when audio stops ("Radio disconnected · Tx off"); with CAT keying on, Tx is refused until the radio is back ("Radio not connected"); the next connection in the page reads `1C 00` and sends PTT off if the radio still transmits | `cat.test.ts`, `rig.spec.ts` |
| A CAT error while keyed: no answers, or the radio says receive | PTT off, Tx off | `radio.test.ts`, `cat.test.ts` |
| Disconnect radio while keyed | Halt, then PTT off confirmed before the port closes; unconfirmed, Rig control keeps the error and the next connection sends PTT off if the radio transmits | `cat.test.ts` |
| A stuck keying | PTT goes off by itself at the keying's limit | `radio.test.ts`, `scheduler.test.ts` |

Connecting sends no PTT. The one exception is the recovery above: when this page lost the port while RR73 may have held PTT on, the next connection sends PTT off if the radio reports transmitting. A reload does not know, and the radio's Time-Out Timer is the backstop then.

## Audio

The IC-705's [microUSB] port carries USB audio both ways: "USB Audio Input: Inputting a modulation AF signal" and "USB Audio Output: Outputting a demodulated AF signal or 12 kHz IF signal" (Basic Manual p. 13-2). On Windows the audio driver installs with the USB driver (driver guide p. 4). Icom's documents do not name the audio devices as Windows lists them.

- Receive: Settings › Radio and audio › Input, set to the IC-705's USB audio.
- Transmit: Settings › Radio and audio › Output, set to the IC-705's USB audio. It uses `AudioContext.setSinkId`, which Chromium has and Safari 26.6 and Firefox 155 lack (measured in Playwright's builds), so the row shows only where the browser supports it. FT8, FT4, WSPR and RTTY transmissions, Tune and the start chime play to the chosen output.

Measured in Chromium 153 (headless on Linux, with fake devices):

- `setSinkId` on a running context fires `suspended` and then `running` within 5 ms. The capture engine ignores state changes during the switch, resumes the context if the switch leaves it suspended, and starts the clock mapping over, because each device has its own output latency.
- A context created with a `sinkId` naming a missing device starts and then suspends, with its `sinkId` back to the default. RR73 never passes `sinkId` to the constructor: it calls `setSinkId` after creating the context.
- `setSinkId` with a missing device rejects with `NotFoundError` and leaves the output where it was. RR73 then plays to the system default, the Output row says the chosen output is not connected, and RR73 tries again when a device is plugged in.
- Fake devices list 3 outputs, so the end-to-end test runs in Chromium.
- Playwright's Chromium gives devices new IDs on every page load, as a private window does. RR73 saves the output's and the input's names with their IDs and finds them again by name when the ID is gone (`matchDevice` in `lib/audio/sink.ts`), unless 2 devices share the name. An input under a new ID is found before Start audio opens it, or when opening it by ID fails. Unverified: whether Windows gives a USB audio device a new ID on another USB port.

Changing the output halts Tune and any transmission, so no transmission moves between devices.

## Testing

- `crates/rr73-cat/tests/reference.rs`: frames worked from the guide's layouts, with their pages.
- `crates/rr73-cat/tests/sim.rs`: each request against the simulated IC-705 (`rr73_cat::sim`), with Echo Back and Transceive on and off, transceive frames to `00`, and USB SEND keying on a port A line.
- `crates/rr73-cat/tests/fuzz.rs`: random bytes and frame-shaped input against the frame reader, the parser and the simulator; random frequencies through the BCD format; random requests answered exactly once.
- `crates/rr73-wasm/src/cat.rs` and `web/src/lib/cat/wasm.test.ts`: the JSON form of requests and events through the WebAssembly exports. `CatSimForTests` exposes the simulator to the app's unit tests; the app never uses it.
- `web/src/lib/cat/serial.test.ts`: the serial link against a fake port, the lines lowered before any write.
- `web/src/lib/cat/radio.test.ts`: the link against a fake port answered by the simulator on a fake clock: the queue, PTT ahead of it, polling, transceive, menu settings read again, lost requests and the drain, PTT and its confirmation, the keying limit and whether a keying still holds PTT, sets refused while keyed, faults while keyed and the 100 ms after the OK, the lost port and the recovery.
- `web/src/lib/tx/scheduler.test.ts`: keying around FT8, FT4 and WSPR on a fake audio clock, its timing, refusals, Halt, cancel, late starts and PTT taken back before the audio.
- `web/src/lib/state/cat.test.ts` (jsdom): Settings › Rig control's actions against a fake Web Serial and the simulator: connecting, the port chosen and the others forgotten, opening again, USB SEND on a line, Disconnect (and Disconnect while keyed), the dial followed by transceive and by polling, the dial QSOs log, the dial set, the keying switch off and on for FT8 and WSPR, Halt, page hide, the lost port, faults, PTT off unconfirmed, and Test keying with each of its answers.
- `web/e2e/rig.spec.ts` (Playwright `chromium`): `navigator.serial` replaced by a fake IC-705 in the page (`e2e/fake-ic705.ts`), and the output recorded (`e2e/tap.ts`): connecting, the dial shown, a band change setting the radio, the radio's dial followed, opening again after a reload, Test keying, a CQ with the switch off (no PTT) and on (PTT before and after the audio, at slot + 0.5 s), Halt, Tune with the switch off and on, RTTY, audio stopping and a lost port. `e2e/layout.spec.ts` in WebKit checks that Settings has no Rig control without Web Serial.
- The output and input choices: unit tests of the engine and the settings, and `e2e/output.spec.ts` in the chromium project with fake devices.

The simulator's behaviour where the guide is silent is its own choice and is listed in `crates/rr73-cat/src/sim.rs`.

## Alternatives rejected

- Keying with DTR or RTS (USB SEND, Advanced Manual p. 9-2). It needs a menu change, gives no confirmation, and the line state when a port opens depends on the browser and the driver. `1C 00` answers OK and reads back.
- Keying by CAT as soon as a radio connects: the owner asked for it to wait for the switch, after Test keying.
- VOX on the desktop. It stays for the iPhone and as the default with a radio connected, but it keys on any sound the computer plays and cannot be read back.
- Trying each allowed port to find the radio: it opens ports the operator did not choose for CI-V, and opening one raises its lines.
- Bluetooth: the IC-705 offers CI-V over Bluetooth's Serial Port Profile (Basic Manual p. 8-22), and Web Bluetooth reaches only Bluetooth Low Energy.
- The IC-705's Wi-Fi remote control: it needs UDP, which browsers do not offer (`docs/architecture.md`, platform constraints).
- WebUSB to the radio's USB interfaces: the operating system's serial and audio drivers hold them, and Web Serial reaches the serial port through the driver.
- A helper program on the computer: another install, where the browser already has serial access.
- The protocol in TypeScript: the Rust crate shares the house's testing (random input, a simulated radio) with the other protocol crates.
- `26` for USB-D in one command: kept in the crate and unused for now (above).

## Open risks

Not tested on a device: everything above ran against the simulator and a fake radio. The first session (above) checks each stage on the radio.

- Unverified: whether the IC-705 keys on asserted or de-asserted lines with USB SEND on a line. Icom's documents name the setting (Advanced Manual p. 9-2) and not the line level. Were it de-asserted, lowering the lines would key the radio. USB SEND OFF (First session, stage 1) leaves the lines out of keying either way.
- Unverified: whether `1C 00 00` releases a transmitter held by a line. RR73 refuses to transmit while USB SEND reads a line, so it never relies on it.
- Unverified: whether the IC-705 stops transmitting by itself when the USB port closes while keyed by `1C 00 01`. Icom's documents do not say. With the audio stopped nothing modulates the transmitter, and the Time-Out Timer ends the transmission after 5 min by default (Basic Manual p. 8-4).
- Unverified: how long the IC-705 takes to answer `05` and `06` with OK, and `1C 00 01` with OK. The 500 ms and 300 ms limits are starting values; a radio slower than 300 ms to PTT on gets "Radio did not answer PTT" on every transmission.
- Unverified: the gap between Chromium asserting DTR and RTS in `open()` and `setSignals` lowering them. With USB SEND on a line, the radio may transmit for that long on every connection. Not measured.
- Unverified: whether USB Keying (CW) and USB Keying (RTTY) on a line act on the lines RR73 lowers (RR73 does not read them).
- The tablet's processor: Icom's driver does not support Windows on ARM (driver guide p. 1). On such a tablet the CI-V port does not appear.
- Web Serial through Icom's driver on Windows, `setSignals` on that driver, and the USB audio codec's sample rate through Chromium.
- Every other Unverified point above: the read form, OK for every set, the transceive address, a one-byte data mode answer, the time to RF, memory mode.
- Whether ports A and B report the same USB IDs. If they do and the browser cannot forget the other port, RR73 asks the operator to choose on every visit.
- The answer to PTT on with PTT Lock on: Test keying reports what `1C 00` reads.
- The output and input choices were measured in headless Chromium on Linux.
- Port B in the chooser: an operator who picks it gets no answer from the radio until they pick port A.
