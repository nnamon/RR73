# Rig control

RR73 controls the radio over Web Serial in desktop Chrome and Edge, inside the same app. The Icom IC-705 comes first, over its USB cable; the Elecraft KX2 follows, through a Digirig (Elecraft KX2, below). The iPhone keeps VOX: Safari has no Web Serial, so the rig control settings never show there.

Two branches built it. The first (0.21.7) added the protocol and the pieces under it: the CI-V crate (`crates/rr73-cat`), its WebAssembly exports (`crates/rr73-wasm/src/cat.rs`), the serial link (`web/src/lib/cat/serial.ts`) and the choice of audio output. The second added Settings › Rig control, the link to the radio (`web/src/lib/cat/radio.ts`, `web/src/lib/state/cat.svelte.ts`), PTT for every transmission, the band sheet and the dial QSOs log, and the input device remembered by name. A third added Keep Tx audio centred, the dial shift that keeps FT8 and FT4 transmit audio in the middle of the transmit passband (Passband shift, below). A fourth added the KX2: Elecraft's text commands in the same crate, and the radio's traits that the one link takes (`web/src/lib/cat/radios.ts`).

## Decision

- Web Serial in desktop Chromium, in the same PWA. The owner's station is a Windows tablet with Edge or Chrome and an IC-705 on one USB cable.
- CI-V over the IC-705's USB (A) port, which Windows lists as IC-705 Serial Port A (CI-V) (CI-V guide p. 2).
- The protocol in Rust, run in the app through `rr73-wasm`. The port, the timing and the user interface in TypeScript.
- Transmit keyed by CI-V command `1C 00`, and only once the operator turns on Key the radio with CAT. It is off by default: a connected radio then has its dial and mode read and set, and transmissions key by VOX as without rig control. Audio both ways over the IC-705's USB audio.
- With Keep Tx audio centred on as well (off by default), each FT8 and FT4 transmission moves the dial in 500 Hz steps so its audio sits at 1500 to 2000 Hz, on the same RF, and the receive dial goes back after it.
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
| IC-705 CI-V Reference Guide | A7560-8EX-6, January 2023 | Frame layout, command table, data formats, the range of the SSB-D transmit bandwidth |
| IC-705 Basic Manual | A7560D-1EX-9, December 2025 | Menu items and defaults, filters, coverage, the USB port, the USB-D transmit passband, RIT, split, the RIT/ΔTX key, troubleshooting |
| IC-705 Advanced Manual | A7560-7EX-5, April 2026 | USB SEND and keying, serial port settings, data modes, ΔTX, duplex |
| IC-705 Firmware Update Information | Versions 1.11 to 1.40 | Checked for changed CI-V commands: none of those below changed |
| USB Driver Installation Guide (Windows 11) | A7560-9EX-5, August 2026 | Windows support, port names, USB audio driver |
| USB Driver download page | Version 1.80, 26 August 2026 | The driver's version and its Web Serial fix |

The CI-V guide prints the frame layout and the data formats but no complete example frames. The test frames in `crates/rr73-cat/tests/reference.rs` are worked from those layouts, each with its page.

## First session

The owner's first session brings rig control up in stages. Each stage needs the one before, and Key the radio with CAT stays off until stage 7.

On the Windows tablet, before stage 1:

- Driver: install Icom's USB Driver, version 1.80 or later, before the radio is plugged in: "DO NOT connect the USB cable between the radio and the PC until AFTER the USB driver has been installed" (driver guide p. 2). The USB audio driver installs with it (p. 4). Version 1.80 "Fixed a bug where the browser would stop responding when connecting to the radio from the browser using the Web Serial API" (download page). Device Manager then lists IC-705 Serial Port A (CI-V) and IC-705 Serial Port B (Advanced Manual p. 9-2).
- Audio devices: in Settings › Radio and audio, choose the IC-705's USB audio as Input and as Output. Icom's documents do not name the devices; Windows usually lists them as USB Audio CODEC (Unverified on the owner's tablet).
- Receive level: the radio's AF Output Level (Connectors set mode, 50 % by default, Basic Manual p. 8-15) and the device's Input volume in Windows Settings › System › Sound › Input. The Level meter in Radio and audio shows the band's noise well below the top.
- Transmit level: the radio's USB MOD Level (Connectors set mode, 50 % by default, p. 8-15) and RR73's Output level. During Tune, with the TX meter on ALC, the reading stays within the ALC zone: "When operating in the SSB data mode, adjust the device's output level within the ALC zone" (Advanced Manual p. 2-18). The zone is marked on the meter's ALC scale (Basic Manual p. 3-9). Tune at low power into a dummy load, as in stage 4.
- Windows sound settings: another device stays the default output in Settings › System › Sound › Output, so Windows and other programs never play to the radio. System sounds go off with the No Sounds scheme on the Sounds tab of Settings › System › Sound › More sound settings.
- USB selective suspend: Disabled, in Control Panel › Power Options › Change plan settings › Change advanced power settings › USB settings › USB selective suspend setting. Windows may otherwise power down the radio's USB connection, and RR73 then loses the port and the audio. Microsoft documents the path for earlier Windows versions; Unverified that every Windows 11 build shows it.
- Mains power: the tablet on its charger, and the screen and sleep timeouts at Never in Settings › System › Power & battery (Screen and sleep, or Screen, sleep, & hibernate timeouts in newer builds). Sleep stops capture and closes the port.
- Other windows: RR73 keeps receiving and transmitting with its window minimised or covered, or in a background tab (`docs/decisions/0010-hidden-window.md`). The screen wake lock does not hold while it is hidden, so the sleep timeout above applies.

1. Before the first Connect radio, on the IC-705: set SET > Connectors > USB SEND/Keying > USB SEND to OFF, its default (Basic Manual p. 8-16). Chromium raises the port's DTR and RTS lines while it opens the port, and with USB SEND on a line that may key the radio until RR73 lowers them (Port settings, below). Check that SET > Function > Time-Out Timer is on (default 5 min, Basic Manual p. 8-4): it is the last limit on the radio's side.
2. Close the other FT8 program: Windows lets one program at a time open the port. In Settings › Rig control, tap Connect radio and choose IC-705 Serial Port A (CI-V). Check that the Dial row and Operate's top bar show the frequency and mode on the radio's screen, that Operate's radio badge reads Connected, and that the Radio settings rows show USB SEND OFF, DATA MOD USB, the Time-Out Timer on, and Split, RIT and ΔTX Off.
3. Change band from RR73's band sheet and check that the radio follows in USB-D, and that the radio badge turns from amber to green. Turn the radio's dial into another band and check that RR73 follows within about 1 s.
4. Set the radio to low power into a dummy load or a matched antenna.
5. Tap Test keying. The radio transmits for 1 s with no audio, and the screen says "Keyed and released at 13:14:30 UTC." Any other answer names what went wrong.
6. In Settings › Radio and audio, set Input and Output to the IC-705's USB audio, tap Start audio, and check that no line under Output says the output is not connected or refused. With Key the radio with CAT on, every transmission and Tune is refused until the Output is the chosen device and plays there (Transmit, below).
7. Only then turn on Key the radio with CAT, check that Rig control shows no advice about the Tx output and that the practice band is off (it never keys the radio by CAT), and call CQ. Halt (or Esc) sends PTT off at once. Should the port close with the cable still in, Rig control's Reconnect radio opens it again without the chooser.

## Web Serial

### Permission

- The first time, a tap on Connect radio calls `navigator.serial.requestPort()`, which needs the tap. Chromium shows its port chooser and the operator picks IC-705 Serial Port A (CI-V). The chooser also lists Serial Port B, which carries decoded RTTY, DV data, weather data or GPS sentences, and nothing with its function off, the default (Basic Manual p. 8-16). A port that sends only bytes that are not CI-V frames is that port, and Rig control says to choose port A.
- RR73 opens only the port the operator chose. Connect radio takes back the browser's permission for every other port it was allowed (`SerialPort.forget()`), so on later visits `navigator.serial.getPorts()` lists the chosen port alone, and RR73 opens it without the chooser. With none listed, Rig control says to plug the radio in and connect it. With more than one of the chosen port's USB IDs listed, as where the browser cannot forget a port, RR73 opens none and asks the operator to choose: it never opens a port to see whether the radio answers.
- `navigator.serial` fires `connect` when an allowed port is plugged in again, and RR73 opens it then.
- A port can close with the cable still in (the driver or the USB link dropping it), and then no `connect` event comes. Rig control then offers Reconnect radio, which opens the port the browser allows (`getPorts()`) without the chooser, by the rule RR73 uses on opening the app: exactly one of the chosen port's USB IDs allowed, or Rig control asks the operator to choose (`reconnectRadio` in `lib/state/cat.svelte.ts`). It shows while the radio the operator connected is not open: the port closed or did not open. Connect radio stays below it, with "Choose another port". The lost link lets the port go before Reconnect radio opens it again. Unverified: whether Chromium on Windows opens a port again after it closed that way, with the cable still in.
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

Split, duplex, RIT and ΔTX are front panel functions, read every 5 s with the mode (Commands, below) and shown under Radio settings with what to do:

| Row | Read | Suits RR73 | Advice | Source |
| --- | --- | --- | --- | --- |
| Split | `0F`: `00` off, `01` on, `11` DUP−, `12` DUP+ | Off | On: the radio transmits on the other VFO, away from the frequency RR73 logs; touch SPLIT on the FUNCTION screen. DUP− or DUP+: it transmits at the duplex offset; on FUNCTION screen 2 touch DUP until it shows OFF | CI-V guide p. 3; Basic Manual pp. 4-10, 10-4; Advanced Manual p. 2-18 |
| RIT | `21 01`, with the offset from `21 00` | Off | On: the radio receives the offset away from the dial it transmits on, so replies land that far from the station they answer; push the RIT/ΔTX key | CI-V guide pp. 15, 27; Basic Manual pp. 2-1, 4-2 |
| ΔTX | `21 02`, with the offset from `21 00` | Off | On: the radio transmits the offset away from the dial, away from the frequency RR73 logs; push the RIT/ΔTX key | CI-V guide p. 15; Advanced Manual p. 2-3 |

ΔTX is Icom's name for XIT: it "shifts your transmit frequency up to 9.99 kHz without shifting the displayed frequency" (Advanced Manual p. 2-3), and RIT "shifts your receive frequency up to 9.99 kHz without shifting the transmit frequency" (Basic Manual p. 4-2). Each answer leaves a row as Reading until it comes. RR73 warns and never sets any of them, and does not refuse to transmit, as for the KX2 (Elecraft KX2, Radio settings): the operator may mean it.

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
| Read split and duplex | `0F` | `0F`, then `00` split off, `01` split on, `11` DUP− or `12` DUP+ | p. 3 |
| Read the RIT frequency | `21 00` | `21 00`, then 10 Hz and 1 Hz, 1 kHz and 100 Hz, and `00` plus or `01` minus | p. 15, p. 27 |
| Read RIT, ΔTX | `21 01`, `21 02` | `21 01` or `21 02`, then `00` off or `01` on | p. 15 |
| Transceive from the radio | `00` and 5 frequency bytes; `01`, mode, filter | none | p. 3, p. 17 |

- Frequencies are 5 bytes of binary-coded decimal, least significant first: 10 Hz and 1 Hz in the first byte, up to the 1 GHz digit (fixed at 0) and the 100 MHz digit (0 to 4) in the last (p. 17). 14.074 MHz is `00 40 07 14 00`.
- Mode codes: `00` LSB, `01` USB, `02` AM, `03` CW, `04` RTTY, `05` FM, `06` WFM, `07` CW-R, `08` RTTY-R, `17` DV. Filters: `01` FIL1, `02` FIL2, `03` FIL3 (p. 17).
- OK is `FB` and NG is `FA`, from the radio to the controller (p. 2). `1C 00` is send and read data, `05` and `06` send only, `03` and `04` read only (the table's legend, p. 16).
- A read sends the command and sub-command with no data area, and the answer repeats them before the data, following the layout on p. 2. The guide does not state the read form in words. Unverified.
- The guide does not list which commands answer with OK. RR73 takes OK or NG as the answer to every set command, and NG or a garbled reply as the answer to a read. Unverified.
- The guide gives the data mode's answer as the data mode and its filter (p. 22). The parser also reads an answer with the data mode alone, with no filter.
- The guide's preamble is two `FE` bytes (p. 2). The frame reader also reads a frame whose first `FE` was lost.
- `19 00` reads the transceiver ID (p. 5), but the guide gives no format for its answer, so RR73 does not use it.
- The RIT frequency's 3 bytes carry 4 digits, so up to 9999 Hz; +1230 Hz is `30 12 00`, −50 Hz `50 00 01` (p. 27). The guide calls `21 00` the RIT frequency and has no command for a ΔTX offset; the radio shows one readout for both ("RIT/ΔTX/SPLIT/DUPLEX FREQUENCY READOUT", Basic Manual p. 2-4), so RR73 shows the `21 00` offset for ΔTX too. Unverified.
- `0F` lists its answers in the Data column with no sub-command (p. 3), and its sets as `00`, `01`, `10` simplex, `11` and `12`. RR73 reads `0F` with no data and takes the one byte that follows as the answer. Unverified.

### USB-D for FT8, FT4, WSPR and RTTY

RR73 sets USB, FIL1 with `06 01 01`, then data mode on with FIL1 with `1A 06 01 01`. In USB-D, FIL1 is 3.0 kHz by default, FIL2 1.2 kHz and FIL3 500 Hz (Basic Manual p. 4-5), and the transmit passband is 300 Hz to 2700 Hz (p. 4-8).

`26 00 01 01 01` sets the same in one command (p. 27), and the crate has it. `06` and `1A 06` act on the operating mode, while `26` names a VFO and answers NG in the DR function (p. 27). Unverified: how each behaves in memory mode.

## The link

`lib/cat/radio.ts` holds one radio on one open port.

- Requests go out one at a time from a queue. Each waits 500 ms for its answer; one without counts as lost, and 3 lost in a row show "No reply from the IC-705". Unverified timings.
- The radio answers frames in the order they arrive, so an answer goes to the oldest request in flight that it answers. OK and NG carry no command byte. After a request goes unanswered, RR73 drains for 250 ms: nothing but PTT off goes out, and every answer that arrives is dropped as a late one, so a late OK is never taken as the answer to a later request.
- PTT on, PTT off and the read that confirms PTT off jump the queue and go out at once, ahead of the polls waiting in it and beside the one in flight. PTT on and the confirming read wait for a drain to end; PTT off never waits. A PTT on held back that way goes out only if its keying still holds and no PTT off has gone out since: Halt inside a drain sends PTT off and nothing after it.
- A drain ends when its timer fires, even when the timer fires a moment before the page's clock reaches the drain's end. The 1 s poll skips while a request waits, so a drain that outlived its timer would stop the link.
- Every 5 s the poll also reads transmit or receive (`1C 00`): a radio keyed by VOX, its own PTT or another program shows as Transmitting in Rig control.
- While connected and not keyed, RR73 reads the frequency (`03`) every 1 s, and the mode and data mode (`04`, `1A 06`), split (`0F`), RIT, ΔTX and their offset (`21 01`, `21 02`, `21 00`) every 5 s. While RR73 holds PTT on, this polling stops: RR73 reads `1C 00` every 1 s instead, from 100 ms after the radio's OK (Transmit, PTT off). With Key the radio with CAT off, RR73 does not know when VOX keys the radio, and the polling goes on. Transceive frames (`00`, `01`) update the dial at once when they arrive. CI-V Transceive is on by default (Basic Manual p. 8-16), but the operator can turn it off, and the guide gives no transceive frame for the data mode. Polling covers both.
- The guide does not say which receiving address transceive frames carry, so the parser takes every frame from the radio's address. The simulator sends them to `00`. Unverified.
- With Echo Back on, the radio sends each frame back first (Basic Manual p. 8-16; the Bluetooth equivalent "sends back the serial data received", p. 8-22). The parser marks frames from the controller's address to the radio's as echoes, so neither setting needs changing.

## The dial

- The dial RR73 shows and uses is the radio's while a radio is connected and its dial is on RR73's band: the top bar, the band sheet, saved slots, WSPR spots, the web SDR's tuning, PSK Reporter and WSPRnet reports. QSOs log it plus the Tx audio frequency, read at most 1 s before. Without a radio it stays as before: the band's dial from `lib/radio/bands.ts`, or the operator's own.
- Band sheet: with a radio connected, choosing a band or a mode, entering a dial (FT8, FT4, RTTY or Hound) or Go on a spot sets the radio with `05`, then USB-D. Each sets only after a read of `1C 00` says receive: the dial and mode never change while the radio transmits, by CAT, VOX or its own PTT. While it transmits the sheet says the dial goes there when Tx ends, and RR73 tries for 15 s. The radio's OK and the dial it then reports replace the confirmation that decision 0002 asks for without CAT. The sheet shows what the radio reports, or that it refused.
- Turning the radio's dial: RR73 follows within about 1 s, by polling or at once by transceive. A dial read on another band than the last one moves RR73 to that band, and to FT8 there when the mode has no dial on it. On connecting, RR73 moves to the radio's band.
- While the radio's dial is on another band than RR73's, or outside every band RR73 has, transmissions are refused ("Radio on 40m", "Radio outside the bands"), so no QSO logs the wrong band.
- The sequencer's state machine is unchanged: it reads the dial from its configuration, which follows the radio.
- When the radio drops (the port lost or failed), or its dial leaves RR73's band, the dial in use falls back to the band's own (`rigDialInUse` in `lib/state/radio.svelte.ts`). Operate's top bar then shows that dial in the warning tint, its band button's label says it is the band's own, and the radio badge (below) says why.

### Operate's radio badge

While rig control is on (a radio connected or connecting, or the one the operator connected gone), Operate's top bar shows a radio badge beside the band, in the shape of the other status badges: a filled tint capsule 21 pt high in a 44 pt link that opens Rig control (`rigBadge` in `lib/state/radio.svelte.ts`, `TopBar.svelte`).

| Badge | Tint | When |
| --- | --- | --- |
| Connected | Green | The radio answers, in the data mode RR73 sets, on RR73's band, and not transmitting by itself |
| Connected | Amber | Not in USB-D (IC-705) or DATA A (KX2), or its mode not read yet; its dial on another band or outside every band; or transmitting while RR73 holds no PTT (VOX, its own PTT, another program) |
| Connecting | Amber | The port is opening, or the chooser is open |
| No reply | Red | 3 requests in a row went unanswered |
| Port closed | Red | The port went away |
| Not connected | Red | The port did not open, or a KX2's port waits for Connect radio |
| Transmitting | Red | PTT off went unconfirmed |

The label for screen readers says why it is amber ("IC-705 connected, in USB. Open Rig control"), and Rig control says what to do. The badge shows only where the browser has Web Serial, so never on the iPhone.

Short of room the band button's chevron and dial give way first, as for the Practice and Clock badges. The band and mode keep their room next; then the badge shows Rig control's plug glyph in its tint in place of the text, in a 44 pt target, and with less room none of it (`fitRadio` in `TopBar.svelte` measures the row on every resize and change). Measured in Chromium (`rig.spec.ts`): the badge whole at 375 x 667 and wider, the glyph alone at 350 pt; with Spots shown and the practice band on, none of it below 700 pt, and whole in compact height and regular width. Rendered with Apple's fonts in WebKit at 375 x 667, the badge shows whole in every state, and none of it with the practice band on. At 350 x 667, 375 x 667, 393 x 852, 852 x 393, 1024 x 768 and 1440 x 900, with and without Spots and the practice band: everything in the bar left to right with no overlap, the band button and the badge 44 pt targets or more whenever the badge shows, the bar's buttons 44 pt, no sideways scroll, and the right edge unchanged by the badge. The last glyph's ink ends 16 pt from the edge in the regular top bar (the clock) and 11 pt in the compact one (the Settings icon, with or without the badge): the compact bar's own spacing, which the badge does not move. Open: the compact bar's 11 pt against the 16 pt of AGENTS.md.
- While a shifted transmission has the radio on its Tx dial, everything above keeps the receive dial (Passband shift, below).

## Transmit

With Key the radio with CAT off, transmissions play their audio as without rig control, and the radio keys by VOX. With it on, every transmission keys the radio with `1C 00 01` first.

Keying by CAT, a transmission goes only to the output chosen in Settings › Radio and audio › Output. FT8, FT4, WSPR and RTTY transmissions and Tune are refused while no output is chosen (System default: "No Tx output chosen"), while the chosen device is not connected or has left the browser's list ("Tx output not connected"), while the browser refuses it ("Browser refused the Tx output"), and while the output is still moving to it ("Tx output switching"). Otherwise the radio would transmit with its Tx audio on whatever the computer plays to, or nothing. The check runs before PTT on and again after the radio's OK, before the audio starts (`rigGate` and `tuneGate` in `lib/state/radio.svelte.ts`, `TxOutput` from `lib/state/station.svelte.ts`). Rig control says which, with the device to choose. VOX keying needs no such check: VOX keys only on audio that reaches the radio. Where the browser cannot choose an output (Firefox), no transmission is refused for it.

The practice band never keys the radio by CAT, whatever Key the radio with CAT says (`catKeys` in `lib/state/radio.svelte.ts`): its FT8, FT4, WSPR and RTTY transmissions and Tune play their audio with no PTT, no dial shift, and no refusal for a radio that is not connected. Test keying is refused while it is on, and turning it on or off runs Halt first, so a keying started for the radio ends before practice starts. With Play Tx audio on, the practice band's transmissions play through the Tx output, and a radio on that output with VOX on transmits them: Settings › Practice band says so, and RR73 adds no lock there. Rig control and Settings › Practice band state the CAT rule.

1. The transmit scheduler (FT8, FT4 and WSPR, `lib/tx/scheduler.ts`) keys the radio at its pre-roll, 500 ms before the audio: the slot edge in FT8 and FT4, slot + 0.5 s in WSPR.
2. The audio goes to the output only after the radio's OK, and starts 100 ms or more after it. The OK has 300 ms, so the audio starts on time at slot + 0.5 s (slot + 1 s in WSPR) whenever it comes: with an OK after 10 ms, the audio starts 490 ms after it. A late start keys at once and starts the audio 100 ms after the OK.
   The sequencer decides most messages on the last slot's decodes, after the slot has begun: a repeated CQ, each reply in a QSO. It plans them 0.2 s after the decision at the earliest (`LEAD_S`, docs/design/sequencer.md). These key at once, and the audio starts at the planned time or 100 ms after the OK, whichever is later. With the fake radio, a repeated CQ decided 0.19 s into its slot keyed at 0.27 s and started on time at 0.5 s.
3. Without an OK within 300 ms, or with NG, no audio plays: PTT off goes out at once and is confirmed (PTT off, below), the status line says "Radio did not answer PTT" or "Radio refused PTT", and Tx stays as when audio is refused. FT8 and FT4 try again in the next slot; the WSPR beacon stops.
4. Audio starts only while the keying still holds PTT (`Keying.held`). PTT taken back between PTT on and the audio, by Halt, a fault or another keying, leaves the transmission silent.
5. PTT off goes 100 ms after the last sample is heard: the audio thread ends a sound before its last sample leaves the output, so RR73 adds the context's output latency (`outputLatency` in Chromium, `baseLatency` elsewhere) to the 100 ms.
6. Each keying carries a limit: PTT goes off by itself when a transmission should long be over (the lead, the timeout, the settling time, the audio, the tail and 1 s: about 14.7 s for FT8), and the transmission's audio stops with it, so no audio reaches a radio in receive, where its VOX could key it. Tune's is about 11.5 s, and Tune's own limit stops the tone. An RTTY stream has no set length, so it has none: RTTY's own watchdog and the radio's Time-Out Timer limit it.

Measured in headless Chromium with the fake radio on 2026-10-16 (`e2e/rig-tx.spec.ts`, on the audio clock): an FT8 CQ tapped in the slot before started 0 ms from slot + 0.5 s, with PTT on 499 ms before its audio and PTT off 132 ms after it ended. Tune: PTT on 130 ms before the tone and off 142 ms after it. RTTY: PTT on 119 ms before the stream and off 138 ms after it.

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

It works with Key the radio with CAT on or off and needs a radio connected. It is refused while the practice band is on, while USB SEND reads a line, or while an earlier PTT off is unconfirmed. Halt, a lost port, a fault and the page going stop it with PTT off.

### Safety paths

The radio must never stay keyed by RR73. Each path below has a test.

| Path | What RR73 does | Tests |
| --- | --- | --- |
| The port opens | DTR and RTS low before any write; the port closes again if they cannot be lowered; 100 ms wait, input dropped | `serial.test.ts`, `cat.test.ts` (the simulator keyed by DTR at open), `rig.spec.ts` (lines low after Connect radio) |
| USB SEND on a line (`0125` reads 1 to 4) | Lines kept low; Tx, Tune and Test keying refused ("Set USB SEND to OFF"); Rig control gives the menu path | `cat.test.ts` |
| Keying by CAT with the Tx output on System default, or the chosen device missing, refused or still switching | Tx and Tune refused before PTT on; checked again after the OK, and a refusal then sends PTT off with no audio; Rig control names the device to choose | `cat.test.ts`, `rig-tx.spec.ts`, `rig-kx2-tx.spec.ts` (the advice with System default) |
| The browser refuses the chosen output (`setSinkId` rejects other than `NotFoundError`), as before microphone permission | Tried again once audio runs and on every device change while the device is listed | `sink.test.ts`, `output.spec.ts` |
| The practice band on, with Key the radio with CAT on | No PTT for any transmission or Tune, no dial shift; Test keying refused; turning the practice band on or off runs Halt first. Halt still sends PTT off, which keys nothing | `cat.test.ts`, `rig-practice.spec.ts` (a practice CQ and Tune send no PTT frame to the fake IC-705) |
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
| The serial port is lost | The audio stops at once and Tx goes off, as when audio stops ("Radio disconnected · Tx off"); with CAT keying on, Tx is refused until the radio is back ("Radio not connected"); the next connection in the page, Reconnect radio included, lowers the lines first, reads `1C 00` and sends PTT off if the radio still transmits | `cat.test.ts`, `rig.spec.ts` (Reconnect radio without the chooser) |
| A CAT error while keyed: no answers, or the radio says receive | PTT off, Tx off | `radio.test.ts`, `cat.test.ts` |
| Disconnect radio while keyed | Halt, then PTT off confirmed before the port closes; unconfirmed, Rig control keeps the error and the next connection sends PTT off if the radio transmits | `cat.test.ts` |
| A stuck keying, or audio that outlasts it (an audio clock that falls behind) | PTT goes off by itself at the keying's limit, and the transmission's audio stops with it | `radio.test.ts`, `scheduler.test.ts` |
| A shifted keying's Tx dial | Set before PTT on, only once any earlier PTT off is confirmed; PTT on only after the radio's OK; no PTT and no audio without it ("Radio did not set Tx dial"), and the receive dial goes back | `radio.test.ts`, `scheduler.test.ts`, `cat.test.ts`, `rig-tx.spec.ts` |
| Any dial or mode set while RR73 may hold PTT | Refused at the wire, whoever asked; the simulated IC-705 counts sets that arrive while it transmits, and the tests expect none | `radio.test.ts`, `cat.test.ts`, `sim.rs` |
| Halt, a fault, audio stopping or the page going during a shifted transmission | PTT off at once, then the receive dial once a read confirms receive; Halt before PTT on went out sends no PTT and sets the receive dial back | `radio.test.ts`, `cat.test.ts`, `rig-tx.spec.ts` |
| The receive dial refused or unanswered | "Rx dial not restored · Tx off": Tx goes off, and RR73 reads the dial and uses what the radio reports | `radio.test.ts`, `cat.test.ts` |
| The port lost or Disconnect radio during a shifted transmission | Lost: the next connection in the page sets the receive dial back if the radio still reads the Tx dial. Disconnect: PTT off confirmed and the receive dial back before the port closes | `radio.test.ts`, `cat.test.ts` |

Connecting sends no PTT, with one exception. When the radio reports transmitting at connecting, RR73 sends PTT off and confirms it if RR73 may have left it keyed, or if Key the radio with CAT is on. "May have left it keyed" is a flag kept with the settings across reloads: set at PTT on, cleared when a read confirms receive. It covers a lost port, a crash, a reload and an app update during a transmission. With neither, Rig control shows Transmitting and says that VOX, the radio's own PTT or another program keys it.

## Passband shift

Settings › Rig control › Keep Tx audio centred moves the radio's dial for each FT8 and FT4 transmission so the transmit audio sits in the middle of the IC-705's transmit passband, at the RF the operator chose on the waterfall. It is off by default and works only with Key the radio with CAT on: the dial moves before PTT on and back after PTT off, an order only CAT keying can hold. The arithmetic is in `lib/cat/passband.ts`, the decision when it applies in `txShiftHz` (`lib/state/radio.svelte.ts`), and the dial sets in `CatRadio.key` (`lib/cat/radio.ts`).

### Decision

- Window: the lowest tone at 1500 Hz up to 2000 Hz (`TX_WINDOW_LOW_HZ`, `TX_WINDOW_HIGH_HZ`). A Tx frequency inside it needs no shift.
- Step: 500 Hz, the window's width. Outside the window the dial moves by the whole number of steps that brings the audio into it: Tx dial = receive dial + shift, Tx audio = Tx frequency − shift, so the RF (dial + audio in USB) is the receive dial plus the Tx frequency, as without the shift. A Tx frequency of 2800 Hz on 14.074 MHz goes out as 1800 Hz of audio on 14.075 MHz. The FT8 and FT4 range, 200 to 2800 Hz, takes shifts from −1500 to +1000 Hz.
- Only while the radio reads USB, with or without data mode. In another mode the dial and the audio do not add up to the same RF, and transmissions go out unshifted.
- FT8 and FT4 transmissions, and Tune in those modes. WSPR and RTTY are left out (below).
- Each transmission: the Tx dial and its OK, PTT on and its OK, the audio, PTT off confirmed by a read, the receive dial and its OK, and a read of the dial.

### Reason

- In USB-D the IC-705 transmits 300 Hz to 2700 Hz of audio by default (Basic Manual p. 4-8). SET > Tone Control/TBW > TX > SSB-D > TBW changes the edges (p. 8-2): the lower edge is 100, 200, 300 or 500 Hz and the upper edge 2500, 2700, 2800 or 2900 Hz (CI-V guide p. 20, item `0022` on p. 5). Audio near an edge is attenuated on the filter's skirt. The window, with an FT4 signal's 83 Hz above its lowest tone, sits 600 Hz or more inside the default edges and 400 Hz or more inside every setting, so RR73 does not read the setting.
- A tone at 1500 Hz or above has its second harmonic at 3000 Hz or above, outside the widest upper edge. Below 1350 Hz the second harmonic of the computer's audio falls inside the default passband and goes out on the air with the signal.
- A step equal to the window's width gives every Tx frequency exactly one shift: a larger step leaves gaps, and a smaller one gives a choice of two.

### Order and timing

1. At the pre-roll, 500 ms before the audio on the audio clock, where PTT on went without the shift, the keying sends `05` with the Tx dial and waits up to 300 ms (`DIAL_TIMEOUT_MS`) for the radio's OK. PTT on goes out on the OK.
2. The audio goes to the output after PTT's OK, 100 ms or more after it, as without the shift. The dial's OK and PTT's OK share the 500 ms pre-roll, so the audio starts on time at slot + 0.5 s while the two take 400 ms or less together. A slower radio starts the audio late, as a late start does, and the transmission is missed past the late-start limit (1.5 s in FT8).
3. After the audio, PTT off as without the shift (PTT off, above). Once a read confirms receive, `05` with the receive dial, and a read of the dial.

The pre-roll runs on the audio clock, which the page's clock places up to the output latency before the slot edge: the dial goes out at the moment PTT on went out before, and the receiver leaves the receive dial then, one dial round trip earlier than it went into transmit without the shift. Setting the dial earlier would move the end of the slot before, so the dial gets no more time than this.

Measured on 2026-10-16:

| Where | Tx dial | PTT on | Audio start | PTT off | Receive dial |
| --- | --- | --- | --- | --- | --- |
| Simulated IC-705, answers after 10 ms, fake clocks (`cat.test.ts`) | Slot edge | 10 ms after the dial | Slot + 0.5 s | After the audio and the tail | After the read that confirms receive |
| Fake IC-705, answers after 5 ms, headless Chromium under load, audio clock (`rig-tx.spec.ts`) | 32 ms before the slot edge on the page's clock | 12 ms after the dial, 486 ms before the audio | 0 ms from slot + 0.5 s | 134 ms after the audio | 12 ms after PTT off |

Without the shift the same test measured PTT on 499 ms before the audio and off 132 ms after it (Transmit, above): the shift costs the PTT lead one dial round trip.

### Consecutive transmissions

The receive dial goes back after every transmission, Repeat CQ and the messages of a QSO included. In FT8 and FT4 every transmission is followed by a slot RR73 decodes. Keeping the Tx dial into it would shift that slot's decodes, the waterfall, saved slots and the dial QSOs log by the shift. The receive dial is back about 150 ms after the audio ends (measured above), at about 13.3 s into the FT8 slot, 1.7 s before the next one. The cost is 2 dial sets and 2 reads per transmission.

### Receive

- From the Tx dial set until the receive dial is back, `CatRadio` keeps the receive dial in its state: reads and transceive frames of the frequency leave it alone, the dial is not polled, and the band sheet's dial and mode sets wait (`busy`) and go out after. The top bar, decoding, the waterfall, saved slots, spots and reports use the receive dial.
- A QSO logs the receive dial plus the Tx frequency, as before: the RF of the transmission.
- The radio's own screen shows the Tx dial while it transmits.

### WSPR, RTTY and Tune

- WSPR: left out. Its Tx frequency stays at 1410 to 1590 Hz (`FREQ_LIMITS` in `lib/waterfall/pick.ts`), within 100 Hz of the passband's middle and 1100 Hz from either default edge.
- RTTY: left out. RR73 places the pair at 1415 and 1585 Hz (`RTTY_DEFAULTS`, centre 1500 Hz), in the middle of the passband, and the pair moves only when the operator tunes it to another station, anywhere from 200 to 2900 Hz (`TONE_LIMITS`). A stream has no set length, and its transmitter is set up in the keyboard worker, so a shift would retune that transmitter for each transmission. Open risk below.
- Tune: in FT8 and FT4 it shifts as a transmission at the same Tx frequency would, and plays the tone at the Tx frequency less the shift: the carrier goes out on the Tx frequency's RF with its audio in the window. In WSPR and RTTY, Tune is unshifted.

### Safety

- No dial or mode set goes out while RR73 may hold PTT: the link refuses them at the wire (`CatRadio.send`) from PTT on until a read confirms receive. A shifted keying that finds PTT held by an earlier keying, or in its tail, sends PTT off first and waits for its confirmation.
- The Tx dial refused (NG) or unanswered within 300 ms: no PTT on and no audio, "Radio did not set Tx dial" in the status line, and the receive dial goes back, after the 250 ms drain when the answer went missing. FT8 and FT4 try again in the next slot, as after a refused PTT.
- Halt, a fault, audio stopping and the page going send PTT off at once, as before, and the receive dial goes back once a read confirms receive. Released before its PTT on went out, a keying sends no PTT and sets the receive dial back.
- The receive dial refused or unanswered: "Rx dial not restored · Tx off", Tx goes off, and RR73 reads the dial and uses the one the radio reports, so decodes and logged QSOs follow the radio.
- The port lost while the radio is on a Tx dial: Tx goes off as for any lost port, and the next connection in the page sets the receive dial back if the radio still reads the Tx dial. A dial the operator turned meanwhile stays. A reload does not know.
- Disconnect radio: Halt, PTT off confirmed, and the receive dial back before the port closes.
- A transmission whose shift changed between its synthesis and the pre-roll (the switch, the keying or the radio's mode changed) lets its slot go by, and the next is made again.

### Alternatives rejected

- Keeping the Tx dial between transmissions: the slots between them would be decoded at the wrong dial.
- Setting the Tx dial earlier than the pre-roll for more time: the end of the slot before would be received on the Tx dial.
- Reading the SSB-D transmit bandwidth (`1A 05 0022`) and centring in it: the window sits inside every setting the radio offers.
- Split (`0F`, CI-V guide p. 3), with the Tx dial on the other VFO: it changes a radio setting that outlasts RR73, so after a crash or a lost port the radio's own PTT would transmit on the other VFO, and it needs the other VFO kept in USB-D. RR73 changes no radio setting.
- A smaller window: more Tx frequencies would need a shift, for no gain inside a 2400 Hz passband.

## Audio

The IC-705's [microUSB] port carries USB audio both ways: "USB Audio Input: Inputting a modulation AF signal" and "USB Audio Output: Outputting a demodulated AF signal or 12 kHz IF signal" (Basic Manual p. 13-2). On Windows the audio driver installs with the USB driver (driver guide p. 4). Icom's documents do not name the audio devices as Windows lists them.

- Receive: Settings › Radio and audio › Input, set to the IC-705's USB audio.
- Transmit: Settings › Radio and audio › Output, set to the IC-705's USB audio. It uses `AudioContext.setSinkId`, which Chromium has and Safari 26.6 and Firefox 155 lack (measured in Playwright's builds), so the row shows only where the browser supports it. FT8, FT4, WSPR and RTTY transmissions, Tune and the start chime play to the chosen output.

Measured in Chromium 153 (headless on Linux, with fake devices):

- `setSinkId` on a running context fires `suspended` and then `running` within 5 ms. The capture engine ignores state changes during the switch, resumes the context if the switch leaves it suspended, and starts the clock mapping over, because each device has its own output latency.
- A context created with a `sinkId` naming a missing device starts and then suspends, with its `sinkId` back to the default. RR73 never passes `sinkId` to the constructor: it calls `setSinkId` after creating the context.
- `setSinkId` with a missing device rejects with `NotFoundError` and leaves the output where it was. RR73 then plays to the system default, the Output row says the chosen output is not connected, and RR73 tries again when a device is plugged in.
- Any other rejection counts as refused. The engine switches a new context to the chosen output as the context starts, which for Start audio is before the browser asks for the microphone. A browser that refuses a device until then would leave the output on the system default for good, so RR73 applies a refused or missing output again once audio runs, and on every device change while the device is listed. Unverified: whether Chromium on Windows refuses `setSinkId` before microphone permission; the retry covers it either way.
- Fake devices list 3 outputs, so the end-to-end test runs in Chromium.
- Playwright's Chromium gives devices new IDs on every page load, as a private window does. RR73 saves the output's and the input's names with their IDs and finds them again by name when the ID is gone (`matchDevice` in `lib/audio/sink.ts`), unless 2 devices share the name. An input under a new ID is found before Start audio opens it, or when Start audio or Resume audio fails to open it by ID. Unverified: whether Windows gives a USB audio device a new ID on another USB port.

Changing the output halts Tune and any transmission, so no transmission moves between devices.

## Testing

- `crates/rr73-cat/tests/reference.rs`: frames worked from the guide's layouts, with their pages, `0F` and `21` included.
- `crates/rr73-cat/tests/sim.rs`: each request against the simulated IC-705 (`rr73_cat::sim`), with Echo Back and Transceive on and off, transceive frames to `00`, USB SEND keying on a port A line, split, duplex, RIT and ΔTX read, and the dial, mode, split, RIT and ΔTX sets that arrive while it transmits (`sets_while_transmitting`).
- `crates/rr73-cat/tests/fuzz.rs`: random bytes and frame-shaped input against the frame reader, the parser and the simulator; random frequencies through the BCD format; random requests answered exactly once.
- `crates/rr73-wasm/src/cat.rs` and `web/src/lib/cat/wasm.test.ts`: the JSON form of requests and events through the WebAssembly exports. `CatSimForTests` exposes the simulator to the app's unit tests; the app never uses it.
- `web/src/lib/cat/serial.test.ts`: the serial link against a fake port, the lines lowered before any write.
- `web/src/lib/cat/radio.test.ts`: the link against a fake port answered by the simulator on a fake clock: the queue, PTT ahead of it, polling, split, RIT and ΔTX read every 5 s and never while keyed, transceive, menu settings read again, lost requests and the drain, PTT and its confirmation, the keying limit and whether a keying still holds PTT, sets refused while keyed, faults while keyed and the 100 ms after the OK, the lost port and the recovery. With a dial shift: the Tx dial before PTT on and the receive dial after PTT off is confirmed, the state on the receive dial through reports of the Tx dial, a refused and an unanswered Tx dial, Halt, a release before PTT on, PTT off for an earlier keying first, the band sheet held back, a refused restore, and the receive dial set back after a lost port.
- `web/src/lib/cat/passband.test.ts`: every FT8 and FT4 Tx frequency lands in the window in whole steps, with the RF unchanged.
- `web/src/lib/tx/scheduler.test.ts`: keying around FT8, FT4 and WSPR on a fake audio clock, its timing, refusals, Halt, cancel, late starts, PTT taken back before the audio, and the audio stopped at the keying's limit. With a shift: the synthesis at the Tx frequency less the shift, the keying with it, no shift inside the window or with the switch off, a shift changed before the pre-roll, and a refused Tx dial.
- `web/src/lib/state/cat.test.ts` (jsdom): Settings › Rig control's actions against a fake Web Serial and the simulator: connecting, the port chosen and the others forgotten, opening again, USB SEND on a line, Disconnect (and Disconnect while keyed), the dial followed by transceive and by polling, the dial QSOs log, the dial set, the keying switch off and on for FT8 and WSPR, Halt, page hide, the lost port and Reconnect radio, faults, PTT off unconfirmed, and Test keying with each of its answers. Keep Tx audio centred: off by default, a CQ at 2800 Hz with its frames and timing and the RF it goes out on, no shift with the switch off, inside the window or without CAT keying, USB only, a refused Tx dial, Halt, a lost port, a refused restore and Disconnect radio.
- `web/e2e/rig.spec.ts` (Playwright `chromium`): `navigator.serial` replaced by a fake IC-705 in the page (`e2e/fake-ic705.ts`): connecting, the dial shown, a band change setting the radio, the radio's dial followed, split, duplex, RIT and ΔTX shown with their advice, opening again after a reload, Test keying with a radio that answers and one that keeps transmitting, and Keep Tx audio centred off by default and usable only with CAT keying on.
- `web/src/lib/state/cat.test.ts` also checks Operate's radio badge in each state, and `rig.spec.ts` the badge on Operate: amber in USB, green in USB-D, amber while the radio transmits by itself, red with the dial in the warning tint once the port closes, a tap opening Rig control, and the top bar's geometry at six window sizes.
- `web/e2e/rig-practice.spec.ts` (Playwright `practice`): the fake IC-705 connected with Key the radio with CAT on, the practice band turned on, a practice CQ on air and Tune send no PTT frame, and Test keying is off.
- `web/e2e/rig-tx.spec.ts` (Playwright `tx-cq`, after the rest of the suite): the output recorded (`e2e/tap.ts`) and PTT timed against it on the audio clock: a CQ with the switch off (no PTT) and on (PTT before and after the audio, at slot + 0.5 s), Halt, Tune with the switch off and on, RTTY, audio stopping and a lost port. With Keep Tx audio centred: a CQ at 2800 Hz sends the Tx dial, PTT on, the audio at 1800 Hz (decoded) on time, PTT off and the receive dial, with the fake radio reporting each dial set by transceive and Operate showing the receive dial throughout, then Halt; and Tune at 2800 Hz plays 1800 Hz on the dial 1000 Hz up. It skips, and fails on GitHub Actions, when the audio clock falls behind real time (docs/testing.md).
- `e2e/layout.spec.ts` in WebKit checks that Settings has no Rig control without Web Serial.
- The output and input choices: unit tests of the engine and the settings, and `e2e/output.spec.ts` in the chromium project with fake devices, including an output refused until the microphone is allowed and one refused while audio runs, tried again on a device change. `rig-tx.spec.ts` and `rig-kx2-tx.spec.ts` choose a fake output before keying by CAT, and check Rig control's advice with System default.

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
- Unverified: how long the IC-705 takes to answer `05` with OK. The shift's audio starts on time while that and PTT's OK take 400 ms or less together.
- Unverified: whether the IC-705 sends a transceive frame for a frequency set by CI-V. RR73 ignores frequency reports while shifted, so either way the receive dial stays on screen.
- Unverified: whether moving the dial by up to 1500 Hz just before PTT on changes anything on the transmitter, such as an antenna tuner or a band filter, or affects the first symbols. The shift stays within the band.
- Unverified: `05` with the radio in split, memory mode or with ΔTX on. RR73 reads split, duplex and ΔTX and warns in Rig control, and does not read memory mode. With split on, the radio may transmit on the other VFO, unshifted.
- A dial the operator turns on the radio during a shifted transmission is set back to the receive dial afterwards.
- RTTY transmits unshifted: a pair tuned within about 100 Hz of a passband edge, or below 1350 Hz with its harmonics in the passband, goes out attenuated or with them. Not measured on a device.

## Elecraft KX2

Settings › Rig control › Radio offers the Elecraft KX2 beside the IC-705, which stays the default. The owner's KX2 reaches a Windows tablet (Edge or Chrome) through a Digirig Mobile, a USB interface that the computer sees as a USB sound card and a USB serial port.

### Decision

- One link drives both radios. `CatRadio` (`lib/cat/radio.ts`) takes a codec and the radio's traits (`lib/cat/radios.ts`): the requests that set the data mode, the reads of the mode, the settings read on connecting, the answers that take longer, and how PTT on is confirmed. The safety paths above hold for the KX2, with its commands in place of CI-V's. Two have no KX2 counterpart: USB SEND, and the dial shift (Passband shift, below).
- Elecraft's text protocol in `crates/rr73-cat/src/elecraft.rs`, a simulated KX2 behind a Digirig in `sim_kx2.rs`, and their WebAssembly exports in `crates/rr73-wasm/src/cat_kx2.rs` (`cat_kx2_encode`, `cat_kx2_answers`, `cat_kx2_accepts`, `CatKx2Parser`, `CatKx2SimForTests`).
- Transmit keyed by `TX;` and released by `RX;`, each followed by `TQ;`, and only with Key the radio with CAT on, off by default as for the IC-705. Audio both ways through the Digirig's sound card.
- RR73 never keys the KX2 through the Digirig's RTS line, and holds RTS low. It opens a KX2's port by itself (on starting, when the port comes back, on a new baud rate) only after its last read of MIC BTN was OFF.
- Connecting sends no `TX;` and no set, and changes no menu setting. It reads the radio, MIC BTN included, and says what to change.
- Keep Tx audio centred stays with the IC-705 (Passband shift, below).
- The KX2's protocol and hardware facts come only from Elecraft's and Digirig's published documents, listed below. No other rig-control program's source is read.

### Reason

- The Digirig and its KX cable are the owner's interface. Its serial port carries CAT to the KX2's ACC jack, and its sound card the audio to the PHONES and MIC jacks.
- `TX;` and `TQ;` give the same keying and confirmation as the IC-705's `1C 00`: RR73 knows when the radio transmits. Keying by the Digirig's RTS gives no confirmation and depends on MIC BTN (below).
- One link keeps one set of safety paths and one set of tests.

### Sources

Downloaded on 16 October 2026. Page numbers are the printed numbers.

| Document | Revision, date | Where | Used for |
| --- | --- | --- | --- |
| Elecraft K3S/K3/KX3/KX2 Programmer's Reference | Rev. G5, 20 February 2019 | elecraft.com, KX2 manuals | Command format, `?;`, response time, auto-info, every command below, the KX2's menu numbers |
| Elecraft KX2 Owner's Manual | Rev. B2, 22 March 2023 | elecraft.com, KX2 manuals | Jacks and pinouts, MENU entries and defaults, data modes, VOX, specifications |
| Elecraft KX Digirig Cable Set (product page and its wiring diagram) | Image of January 2022 | digirig.net | The KX cable's wiring: serial plug, PHONES plug, MIC plug with PTT |
| Digirig Mobile Rev 1.9 | 19 April 2022, updated 29 September 2023 | digirig.net | The PTT switch, the RS-232 configuration |
| Digirig Mobile 1.9 schematic | Rev 1.9 | digirig.net | The PTT transistors on RTS, DTR unconnected |
| Getting Started with Digirig Mobile | 24 August 2022, updated 30 August 2024 | digirig.net | PTT by RTS, the Windows device names |
| Selecting Digirig Mobile Serial Configuration | 22 February 2024, updated 5 September 2024 | digirig.net | The KX2 needs the RS-232 configuration |
| Understanding Rig Control Options | 16 September 2021, updated 29 September 2023 | digirig.net | RS-232 levels, the PTT driver |
| Troubleshooting Digital Modes | 30 November 2021, updated 25 March 2025 | digirig.net | RTS used for flow control causes unwanted transmission |
| Digirig Mobile (product page) | Revision 1.11 listing | digirig.net | The PTT switch on RTS in the current revision |
| Elecraft K3 Owner's Manual | Rev. D10, 24 August 2011 | elecraft.com | The serial character format, DTR and RTS on the K3, DATA A's VFO display, the K3's normalised DATA filter |
| Elecraft KX3 Owner's Manual | Rev. C5, 16 June 2014 | elecraft.com | The KX3's normal SSB receive bandwidth |

### Connection

- CAT goes through the KX2's 3.5 mm ACC jack: tip RX Data, ring 1 TX Data, ring 2 Key Out, sleeve ground (Owner's Manual p. 9). Its levels are those of RS-232 or USB "depending on selected adapter" (p. 69); Elecraft's own cables are KXUSB for USB and KXSER for RS-232 (p. 34).
- The Digirig's serial socket connects to the ACC jack through the serial lead of Digirig's KX cable, whose plug at the radio end is black; the audio lead ends at the radio in a green plug for PHONES and a red one for MIC (product page). The colours are those of the radio-end plugs: the Digirig's RIG_RXD to the tip, RIG_TXD to the ring, ground to the sleeve; its 3.3 V pin is not connected (the cable's wiring diagram). A 3-circuit plug in the ACC jack shorts Key Out to ground, which does no damage (Owner's Manual p. 9).
- The cable "requires Digirig Mobile Revision 1.6 or later preconfigured for RS-232" (KX cable product page); Digirig gives the KX2 the RS-232 configuration, lines between −12 V and +12 V (Selecting Digirig Mobile Serial Configuration; Digirig Mobile Rev 1.9). A Digirig left at its default logic levels does not talk to the KX2.
- Windows lists the Digirig as "Silicon Labs CP210x USB to UART Bridge (COMx)" and "USB PnP Sound Device" or "USB audio device" (Getting Started with Digirig Mobile; Troubleshooting Digital Modes). The Silicon Labs driver may be needed (Getting Started). Rig control says to choose the Digirig's CP210x serial port. Unverified: the name Chromium's chooser gives it.

### Port settings

- Baud rate: MENU › RS232, "the RS232 (or USB) communications rate", default 4800 (Owner's Manual p. 49); the rates are 4800, 9600, 19200 and 38400 (`BR`, Programmer's Reference p. 8). Rig control's Baud rate offers those four, 4800 by default, so a KX2 as delivered needs no menu change. A new rate closes the port, PTT off confirmed first, and opens it again only after MIC BTN last read OFF; otherwise Connect radio opens it. RR73 never sends `BR`.
- 8 data bits, no parity, 1 stop bit, no flow control (`kx2Port` in `lib/cat/serial.ts`). The KX2's manual gives the rate only; Elecraft gives "8 data bits, no parity, 1 stop bit" for the K3, whose commands the KX2 shares, and says DTR and RTS "are not used as serial I/O handshaking lines" there (K3 Owner's Manual D10 p. 18).
- Chromium on Windows asserts DTR and RTS while it opens a port (Port settings, above). RR73 lowers both as soon as `open()` resolves, before any write, as for the IC-705, and closes the port if it cannot. It then waits 100 ms and drops the input, as above.

### The Digirig's PTT

- The Digirig Mobile has "an open-collector BJT transistor shorting PTT line to the ground when RTS signal of the serial port is activated" (Digirig Mobile Rev 1.9). On the schematic the CP2102N's RTS pin drives Q1, which drives Q2 to ground the PTT line; DTR is not connected (Digirig Mobile 1.9 schematic). Since revision 1.6 the PTT line is on ring 2 of the audio socket, whatever the serial configuration (Rev 1.9 page; Understanding Rig Control Options), and the revision 1.11 listing still has the PTT switch on RTS (product page).
- Digirig's KX cable takes that PTT line to the ring of the red MIC plug, with the Digirig's audio output on its tip (the cable's wiring diagram). In the KX2's MIC jack the ring is Ring 1, "PTT/UP/DN" (Owner's Manual p. 8). MENU › MIC BTN decides whether the KX2 reads it: default PTT UP.DN; OFF for a mic without a KX2-compatible PTT (p. 48). The ACC jack has no PTT input (p. 9).
- So with Digirig's KX cable and MIC BTN at its default, RTS asserted grounds the KX2's PTT line. Elecraft's documents do not state the line's active level; Digirig wires the cable for PTT, and says a PTT line is "typically pulled up ... and a button, relay or an electronic switch shorts it to ground to initiate the transmit" (Understanding Rig Control Options). RR73 takes it as keying. Digirig warns that RTS used for handshake or flow control "will cause unwanted transmission" (Troubleshooting Digital Modes).
- Verdict: the hazard is real in the owner's likely setup. Chromium raises RTS in `open()`, so the KX2 may transmit from then until RR73 lowers RTS, on every Connect radio, every reopen when the app opens, and every baud rate change. RR73 lowers DTR and RTS before any write, as for the IC-705's USB SEND, and refuses to go on if it cannot. Web Serial cannot close the gap. Not measured on a device.
- What the operator does: set MENU › MIC BTN to OFF before the first Connect radio (First session, below). The KX2 then ignores the MIC plug's ring, RTS keys nothing, and RR73 keys by `TX;` or the KX2 by VOX. Rig control says so in the KX2's Off state, before any port opens, as an error once a read found PTT, and shows MIC BTN with PTT as an error.
- RR73 opens a KX2's port by itself only after its last read of MIC BTN was OFF (`kx2MicBtn` in the settings): not on starting, when the port comes back or on a new baud rate otherwise. Connect radio stays the operator's: the advice above comes before it, and nothing locks it.
- RR73 does not refuse to transmit while MIC BTN reads PTT, unlike USB SEND on the IC-705. The IC-705 refusal covers a line level Icom does not document; Digirig documents the level (RTS asserted keys), and RR73 holds RTS de-asserted, which keys nothing.

### Commands

| Purpose | Sent | Answer | Programmer's Reference |
| --- | --- | --- | --- |
| Read VFO A | `FA;` | `FA` and 11 digits, Hz | p. 11 |
| Set VFO A | `FA00014074000;FA;` | as the read | p. 11 |
| Read the mode | `MD;` | `MD` and a digit: 1 LSB, 2 USB, 3 CW, 4 FM, 5 AM, 6 DATA, 7 CW-REV, 9 DATA-REV | p. 16 |
| Set the mode | `MD6;MD;` | as the read | p. 16 |
| Read the data sub-mode | `DT;` | `DT` and a digit: 0 DATA A, 1 AFSK A, 2 FSK D, 3 PSK D | p. 11 |
| Set the data sub-mode | `DT0;DT;` | as the read | p. 11 |
| Transmit | `TX;TQ;` | `TQ1;` | p. 28, p. 27 |
| Receive | `RX;TQ;` | `TQ0;` | p. 23, p. 27 |
| Read transmit or receive | `TQ;` | `TQ0;` receive, `TQ1;` transmit | p. 27 |
| Read the option modules and product | `OM;` | `OM`, a space, 12 characters, the last two 01 on a KX2 | p. 21 |
| Read VOX in the present mode | `VX;` | `VX0;`, `VX1;` | p. 28 |
| Read the menu entry shown | `MN;` | `MN255;` with no menu | p. 17 |
| Read MIC BTN | `MN082;MP;MN255;` | `MP` and 3 digits: bit 0 PTT, bit 2 UP/DN | pp. 17, 19, 20 |
| Leave the menu | `MN255;MN;` | `MN255;` | p. 17 |
| General information | `IF;`, or by itself with auto-info | `IF`, 11 frequency digits, the RIT/XIT sign and offset, RIT, XIT, ..., the transmit flag, the mode and split | p. 14, p. 4 |
| Read the receive filter's bandwidth | `BW;` | `BW` and 4 digits, 10 Hz units | p. 8 |
| Read the K2 command mode | `K2;` | `K2` and a digit, 0 to 3 | pp. 4, 14 |

- A command is 2 or 3 letters, optional data and a semicolon; a read is the letters alone, and its answer has the set's format (p. 3). Answers are upper case (p. 3).
- A set has no answer of its own. RR73 sends each set with the read of the same command, and the read-back decides: equal to the set, the set is taken; anything else, refused (`accepted_by` in `elecraft.rs`). VFO A counts as taken to 10 Hz: "The Hz digit is ignored if the K3 is not in FINE mode" (p. 11). The read-back also covers a set the radio carries out differently: a frequency outside its ranges moves the KX2 to the nearest amateur band (p. 11).
- `?;`: "If a command cannot respond due to such a condition [a busy state, such as transmit, or a limited-access state], the K3 will return ?;" (p. 3). It carries no command, as NG carries none, and it may answer the set of a set and its read, with the read's answer after it. RR73 takes `?;` as the answer to the oldest request in flight, refused, and starts the 250 ms drain: what arrives in it is dropped. A `?;` to `TX;TQ;` may have answered `TX` alone, with the radio keyed: once the drain ends RR73 reads `TQ;`, and `TQ1` within the 0.3 s PTT window keys.
- `TQ1` also covers TX TEST and the radio armed to transmit (p. 27). `TX` "is ignored" in FSK D and PSK D (p. 28): in those sub-modes PTT on fails (Transmit, below).
- `DT` is valid only in DATA (p. 11); RR73 reads it only after `MD` reads 6 or 9.
- `OM` names the product (p. 21). MIC BTN is entry 082 in the K3's, the KX3's and the KX2's tables (pp. 17 to 19), but `MP` gives its bits on the KX3 and the KX2 only (p. 20; the K3's table does not mark it for `MP`). RR73 reads MIC BTN after `OM` reads 01 or 02.
- `MN` opens a menu entry and `MN255` leaves the menu (p. 17). RR73 reads `MN;` first and reads MIC BTN only while it says 255: never while the operator has a menu entry open, and never between PTT on and the confirmation of PTT off. After the read, `MN;` must read 255, or `MN255;MN;` goes out. A radio found in entry 082 on connecting, as a read cut off by a lost port leaves it, gets "Tap DISP on the KX2 to leave the menu": the MENU switch leaves the menu (Owner's Manual p. 41), and on the KX2 MENU is the hold of DISP (Programmer's Reference Table 8A, p. 26). Unverified: what `MN` and `MP` do to the radio's keying.
- `K2;` reads the K2 command mode. In modes 1 and 3, which another program may leave, `MD` and `IF` report DATA as LSB or USB (p. 4; p. 16, note 2), so every band change's read-back reads as refused. Rig control names the mode and says to close that program and turn the KX2 off and on. Unverified: whether the mode survives a power cycle.
- RR73 never sends `AI`. With MENU › AUTO INF at ANT CTRL the KX2 sends `IF` by itself (Owner's Manual pp. 35 and 44); RR73 reads its frequency and mode as transceive. RR73 reads `IF;` itself on connecting and every 5 s, for split, RIT, XIT and their offset (p. 14). It shows the `IF` transmit flag and never takes it as confirming receive: only `TQ` does. On a band change the radio sends `IF`, `FA`, `FB`, `FR`, `FT` and more by itself (p. 11, note 7); `FA` among them may answer the frequency set, with the same frequency.

### The link

- Response time: "typically ... less than 10 milliseconds. General worst-case latency is around 100 ms, except for commands that change bands, which can take up to 500 ms" (p. 3); "Band changes typically take 0.5 seconds; all command handling is deferred until this process is complete" (p. 11). Requests wait 500 ms as for the IC-705, and a frequency set 2 s (`KX2_BAND_CHANGE_MS`): at 4800 baud the answers the radio sends by itself after a band change (p. 11, note 7), about 100 characters, take about 0.2 s more. After a frequency set's answer the link drains for 250 ms, so those answers are dropped and never taken for the next request. Unverified on a device.
- At 4800 baud, `FA;` and its answer are 17 characters, 35 ms on the wire; `TX;TQ;` and `TQ1;` 10, 21 ms.
- Polling: `FA;` every 1 s; `MD;` (and `DT;` in DATA), `VX;`, `IF;`, `BW;` and `TQ;` every 5 s. The reference says polling during transmit should not be used unless necessary, and that fast polling (under 100 ms) should be tested (p. 3). From PTT on until a read confirms PTT off, only `TQ;` goes out besides `TX;` and `RX;`: queued polls and the MIC BTN read wait, so a `?;` to one of them cannot start a drain that holds back PTT's reads. The 1 s read of transmit while keyed is the confirmation that the radio is still keyed and still answers, and p. 3 points to `TQ` for that. While the radio transmits by VOX or its own PTT, the poll reads only `TQ;` too.
- Answers a drain drops still show that the radio answers: they reset the count of lost requests, so a good unkey after a lost PTT on never shows "No reply".
- Bytes that are not answers (control characters, bytes above 7E, text that does not start with a letter, 64 bytes without a semicolon) count as noise. A port at another baud rate gives noise only, and Rig control says to match Baud rate to MENU › RS232 and check that the Digirig is set for RS-232.

### The dial

- The band sheet sets VFO A, then `MD6` and `DT0`: DATA A, the KX2's mode for a computer's audio, "Upper sideband is the default" (Owner's Manual p. 28). The frequency goes first so the mode applies on the new band (Programmer's Reference p. 5, note 2). Each set is read back; the first refusal stops the rest. RR73 reads `TQ` first and sets nothing while it says transmit.
- DATA A makes DATA the mode and DATA A the sub-mode. `MD6` selects "the data sub-mode that was last in effect on the present band" (p. 16), so `DT0` follows it, and then `MD6` again: normal or reverse is held per pair of sub-modes, DATA A with PSK D and AFSK A with FSK D (p. 16, note 2), so `DT0` may bring DATA A on the reverse sideband (MENU › ALT MD, Owner's Manual p. 43), and the second `MD6` sets DATA A's pair to normal. Its read-back must say 6.
- In DATA-REV, or with MENU › ALT MD at ALT, DATA A goes out on LSB (Owner's Manual p. 43): Rig control and the band sheet show "DATA A REV" and the band sheet says to set DATA A.
- Rig control and Operate show the mode as the KX2 names it: DATA A, AFSK A, FSK D, PSK D, USB.
- QSOs log VFO A plus the Tx audio frequency, as for the IC-705. In DATA A "The VFO displays the suppressed-carrier frequency, just as when SSB modes are used for data" (K3 Owner's Manual D10 p. 31), so VFO A plus the audio is the RF. The KX2's manual is silent on it; it says to refer to the data software's manual "to determine how to set up the KX2's VFO for accurate frequency display" (p. 28), and in AFSK A the VFO shows the mark frequency (p. 28).
- Rig control reads the receive filter (`BW`) and advises below 2.70 kHz. RR73 decodes FT8 and FT4 from 200 to 2800 Hz, 2.6 kHz wide (`FREQ_LIMITS` in `lib/waterfall/pick.ts`); Elecraft's SSB filters are 2.7 or 2.8 kHz (K3 Owner's Manual D10 p. 24) and the KX3's normal SSB receive bandwidth about 2.8 kHz (KX3 Owner's Manual C5 p. 22). The KX2 keeps the width per mode, set by the operator (Owner's Manual p. 17); the K3 normalises DATA to 400 Hz (K3 Owner's Manual D10 p. 24), too narrow for FT8.

### Transmit

With Key the radio with CAT off, the KX2 keys by VOX, as without rig control: VOX in audio data modes "starts transmit when a computer connected to the mic jack outputs an audio signal" (MENU › VOX MD, Owner's Manual p. 53; default OFF in voice and audio data). VOX needs an external audio source in the MIC jack (pp. 20 and 53), as the Digirig is. Rig control reads `VX` and says when VOX is off in DATA with Key the radio with CAT off: nothing would key the radio then.

With it on:

1. At the pre-roll, 500 ms before the audio, `TX;TQ;`. `TQ1` is the KX2's OK. A `TQ0` may come while the radio switches over: RR73 reads `TQ;` again, 50 ms apart (`PTT_READ_MS`), until `TQ1` or 300 ms after `TX;`.
2. The audio starts 100 ms or more after `TQ1`, as for the IC-705.
3. `TQ0` for 300 ms, or `?;` and then no `TQ1` before 300 ms: PTT on failed ("Radio refused PTT"), `RX;TQ;` at once, confirmed. No answer within 300 ms: "Radio did not answer PTT", the same.
4. PTT off: `RX;TQ;`. `TQ0` takes it; `TQ1` or no answer, `RX;TQ;` again, 100 ms apart, 4 times at most, then a `TQ;` that must say receive. Until a read says receive the radio counts as keyed, as for the IC-705: the status line, the badge, Tx refused, and `RX;` again every 1 s while `TQ` says transmit.

Measured with the fake KX2 (5 ms answers) in headless Chromium on 2026-10-16 (`e2e/rig-kx2-tx.spec.ts`, on the audio clock): a CQ started 1 ms early against slot + 0.5 s, with `TX;` 498 ms before its audio and `RX;` 133 ms after it.

Unverified: the time from `TX;` to RF. MENU › TX DLY sets the "delay in milliseconds between key-down and RF output", 5 ms at NOR and up to 20 ms (Owner's Manual pp. 51 and 52). The 100 ms after `TQ1` is a starting value to measure.

`TX` keys the KX2 in any mode: in USB with compression and EQ, in AM with its carrier, in DATA-REV with the RF below the dial while the log records it above, and in CW only arms it while `TQ` reads 1 (p. 27). RR73 does not refuse: a transmission keyed outside DATA A says the mode in the status line ("Radio in USB · set DATA A"), Rig control warns while the KX2 is in another mode, and Test keying says the mode it keyed in.

The KX2 has no transmit time-out in Elecraft's documents, and Digirig reports that RF can stop its interface from returning to receive ("doesn't return to receive ... re-plug the interface", Troubleshooting Digital Modes). Keyed by CAT, a stuck interface leaves the KX2 transmitting until the operator unkeys it; keyed by VOX, it stops when the audio stops. Rig control states this beside Key the radio with CAT, which stays off by default.

### Test keying

As for the IC-705: 1 s on `TX;`, a `TQ;` while keyed, `RX;`, and the result once PTT off is confirmed or not. The KX2's answers:

- "Keyed and released at 13:14:30 UTC."
- "Keyed and released at 13:14:30 UTC, in CW. The KX2 was not in DATA A: choose a band to set it." when the KX2 read another mode.
- "The KX2 did not key on TX. PTT off was sent and confirmed. It ignores TX in FSK D and PSK D: choose a band to set DATA A." (`TX`, p. 28.)
- "The KX2 keyed, then returned to receive. Check its screen for a warning, such as high SWR or temperature." The KX2 drops out of transmit by itself at a high PA temperature or a load it cannot drive (Owner's Manual p. 56).
- "No reply to PTT from the KX2 within 0.3 s. PTT off was sent and confirmed.", "No reply from the KX2 to PTT on or off." and "Keyed. PTT off was not confirmed." as for the IC-705.

### Safety paths

Each path of the IC-705's table holds for the KX2. Their tests against the simulated KX2 (`rr73_cat::sim_kx2`, `CatKx2SimForTests`) and the fake KX2 in the page (`e2e/fake-kx2.ts`):

| Path | What RR73 does | Tests |
| --- | --- | --- |
| The port opens | DTR and RTS low before any write: the Digirig's PTT goes off; the port closes again if they cannot be lowered; 100 ms wait, input dropped | `cat-kx2.test.ts` (the simulated KX2 keyed by RTS through MIC BTN at open, unkeyed by the lines going low; MIC BTN OFF keys nothing; lines that fail; input in the wait dropped), `rig-kx2.spec.ts` |
| The port opens by itself | On starting, when the port comes back and on a new baud rate, only after the last read of MIC BTN was OFF; the Off state says to set it first | `cat-kx2.test.ts`, `rig-kx2.spec.ts` |
| A radio transmitting at connecting | Shown as Transmitting; PTT off, confirmed, when RR73 may have left it keyed (kept across reloads) or CAT keying is on | `cat-kx2.test.ts`, `cat.test.ts` (IC-705), `rig-kx2.spec.ts` |
| PTT on held back by a drain | Goes out only while its keying holds and no PTT off has gone since | `radio-kx2.test.ts`, `radio.test.ts` (IC-705) |
| Keyed | From PTT on until PTT off is confirmed, only `TQ;`, `TX;` and `RX;` go out; the menu read waits | `radio-kx2.test.ts` |
| PTT on | `TX;TQ;` confirmed by `TQ1`; `TQ0` read again 50 ms apart until 300 ms | `radio-kx2.test.ts` |
| PTT on fails: `TQ0` for 300 ms (FSK D), `?;` and no `TQ1` after its drain, or no answer | No audio; `RX;TQ;` at once, confirmed; a `?;` or a lost answer starts the drain | `radio-kx2.test.ts`, `cat-kx2.test.ts` (Test keying in FSK D) |
| A `?;` to `TX;TQ;` with the radio keyed | `TQ;` after the drain; `TQ1` within 0.3 s keys | `radio-kx2.test.ts` |
| PTT off | `RX;TQ;` until `TQ0`, 100 ms apart, 4 times at most, then a `TQ;` that must say receive | `radio-kx2.test.ts`, `cat-kx2.test.ts` |
| PTT off unconfirmed | Status line, badge, Tx refused; `TQ;` every 1 s and `RX;` again while it says transmit | `radio-kx2.test.ts`, `cat-kx2.test.ts`, `rig-kx2.spec.ts` |
| A late answer | `?;`, a request that goes unanswered and a frequency set's answer start the 250 ms drain; answers in it are dropped, and count as the radio answering | `radio-kx2.test.ts` (`?;` followed by another dial; a band change's own reports; no "No reply" during a good unkey) |
| PTT and the queue | `TX;` and `RX;` go ahead of queued polls; while keyed only `TQ;` is read | `radio-kx2.test.ts` |
| Dial and mode sets while keyed | Refused while RR73 may hold PTT and while `TQ` says transmit (the radio's own XMIT); the simulated KX2 counts sets that arrive while it transmits, and the tests expect none | `radio-kx2.test.ts`, `cat-kx2.test.ts`, `rig-kx2-tx.spec.ts` |
| Halt, and the page going | `RX;` at once | `cat-kx2.test.ts`, `rig-kx2-tx.spec.ts` (Halt during a CQ: `RX;` within 50 ms) |
| End of a transmission | `RX;` the output latency and 100 ms after the audio, confirmed | `cat-kx2.test.ts`, `rig-kx2-tx.spec.ts` |
| The keying's limit | `RX;` at the limit, whatever else happens | `radio-kx2.test.ts` |
| The radio says receive while keyed, or stops answering | Fault: `RX;`, Tx off | `radio-kx2.test.ts` |
| The port is lost | Tx off, "Radio disconnected · Tx off"; the next connection in the page reads `TQ;` and sends `RX;` if it says transmit | `radio-kx2.test.ts`, `cat-kx2.test.ts` |
| Disconnect radio while keyed | Halt, `RX;` confirmed before the port closes | `cat-kx2.test.ts` |
| Key the radio with CAT | Off by default: no `TX;` with it off | `cat-kx2.test.ts`, `rig-kx2-tx.spec.ts` |
| Connecting | No `TX;` or set, and `RX;` only to a radio transmitting at connecting (above); MIC BTN read only on a KX2 or KX3 with no menu entry open, and the menu checked left after | `radio-kx2.test.ts`, `cat-kx2.test.ts`, `rig-kx2.spec.ts` |
| Another baud rate | The port closes, PTT off confirmed first; it opens again, lines lowered, only after MIC BTN read OFF, and otherwise on Connect radio | `cat-kx2.test.ts`, `rig-kx2.spec.ts` |
| Choosing the other radio | Disconnects and forgets the port first: one radio's port never opens with the other's protocol | `cat-kx2.test.ts` |

### Radio settings

On connecting RR73 reads, and shows under Radio settings:

| Row | Read | Suits RR73 | Advice |
| --- | --- | --- | --- |
| Model | `OM` | KX2 (01) | Another product than the KX2 or KX3: RR73 does not read MIC BTN; check it at the radio |
| MIC BTN | `MN082;MP;MN255;` | OFF only | PTT: an error, set MENU › MIC BTN to OFF (The Digirig's PTT, above). UP.DN: the Digirig's line on the ring may move VFO A ("VFO A frequency changes by itself: If using a mic other than the MH3, set MIC BTN to OFF", Owner's Manual p. 56). Refused: "Not read", check it at the radio. Left in entry 082: tap DISP |
| VOX | `VX`, the present mode | In DATA: on, or any with Key the radio with CAT on | Off in DATA with Key the radio with CAT off: turn one of them on |
| Filter | `BW` | 2.70 kHz or more | Narrower: tap FIL and turn AF/MON to widen it (Owner's Manual p. 17) |
| Split | `IF` | Off | On: the KX2 transmits on VFO B, away from the frequency RR73 logs |
| XIT | `IF` | Off | On: the KX2 transmits the offset from VFO A; set MENU › XIT to OFF |
| RIT | `IF` | Off | On: the KX2 receives the offset from VFO A, so replies land that far from the station they answer; tap RIT (Owner's Manual p. 16) |

`K2;` is read on connecting too, with advice for modes 1 and 3 (Commands, above). A setting that goes unanswered is read again every 5 s; MIC BTN also waits for `OM` and for no menu entry open, and is read again each time Rig control opens. RR73 sets none of them.

Two more notes, as advice: ERR PTT at power-on, a PTT line active while the KX2 starts, "VOX transmit is disabled in all modes" until MENU › VOX is set again (Owner's Manual p. 61); the Digirig's PTT line, held while RTS is asserted, causes it, which matters with VOX keying. MENU › AUTO OFF turns the KX2 off after 5 to 100 minutes without use of its controls, restarted "by any transmission" (p. 44); Rig control says to keep it at INFINITE. Unverified: whether CAT commands restart it.

MIC BTN is not read in the 5 s poll. Every read opens the entry on the radio for a moment, and a read every 5 s would keep pulling the radio's screen into its menu. Rig control reads it again when it opens, as the operator looks at it then.

### First session

As for the IC-705, in stages, with Key the radio with CAT off until stage 8.

1. Before the first Connect radio, on the KX2: set MENU › MIC BTN to OFF (Owner's Manual p. 48). The Digirig keys the MIC jack's PTT while RTS is asserted, and Chromium asserts it while it opens the port. Rig control's Off state says so. Check that the Digirig is configured for RS-232 (Selecting Digirig Mobile Serial Configuration) and that MENU › RS232 is the rate under Baud rate, 4800 by default (p. 49). Keep MENU › AUTO OFF at INFINITE (p. 44).
2. Plug the Digirig's serial lead into the ACC jack (black plug at the radio end), and the audio lead's red plug into MIC and green plug into PHONES (the KX cable's wiring diagram; Owner's Manual p. 28 for the audio). Turn the KX2 on after the cables are in; if it shows ERR PTT, VOX is off in every mode until MENU › VOX MD is set again (p. 61). Close any other program that has the Digirig's port open.
3. In Settings › Rig control choose Elecraft KX2, tap Connect radio and choose the Digirig's CP210x serial port. Check that the Dial row and Operate's top bar show the KX2's frequency and mode, and that Radio settings shows Model KX2, MIC BTN OFF, and Split, RIT and XIT Off, with no advice about the K2 command mode.
4. Change band from the band sheet and check that the KX2 follows in DATA A, with no REV on its screen. Turn the KX2's VFO A into another band and check that RR73 follows within about 1 s. Check that the Filter row reads 2.70 kHz or more in DATA A.
5. Settings › Radio and audio: Input and Output to the Digirig's sound card ("USB PnP Sound Device" or "USB audio device"). Set PWR to 5 W or lower: "5.0 watts or lower is recommended in all data modes" (Owner's Manual p. 27). Into a dummy load, adjust the transmit level for "no more than 4 to 5 bars of ALC indication" (p. 29).
6. Tap Test keying in DATA A. The KX2 transmits for 1 s with no audio, and the screen says "Keyed and released at 13:14:30 UTC."
7. Unplug the Digirig's USB cable and plug it back in, then reload the app: with MIC BTN read OFF, RR73 opens the port by itself; check that the KX2 did not transmit on either open.
8. Only then turn on Key the radio with CAT, and call CQ. Halt (or Esc) sends `RX;` at once. With it on, VOX can stay off.

### Passband shift

Keep Tx audio centred stays with the IC-705: the switch is not shown with the KX2 chosen, and `txShiftHz` gives 0. The shift centres the audio in a transmit passband whose edges the IC-705's documents give. Elecraft's documents give none for DATA A: the Owner's Manual says DATA A "disables compression and RX/TX EQ" (p. 28) and gives TX EQ, with bands up to 3.2 kHz, for voice modes only (pp. 50 and 52), and the specifications give no transmit audio response (pp. 69 and 70). Without edges there is nothing to centre in, and a shift would move the dial before every transmission for no measured gain. Open risk below.

### Audio

- Receive: the KX2's PHONES jack to the Digirig's input through the green plug (Owner's Manual p. 28: "Connect the KX2's PHONES jack to your computer's line-audio input"). Settings › Radio and audio › Input to the Digirig's sound card.
- Transmit: the Digirig's output to the KX2's MIC jack through the red plug ("Connect your computer's line-audio output to the MIC jack", p. 28). In DATA A or AFSK A an external source must be in the MIC jack, which turns off the built-in mic (p. 63). Settings › Radio and audio › Output to the Digirig's sound card.
- Digirig's audio input has a −20 dB attenuator option for a radio whose audio is too high (Digirig Mobile Rev 1.9); the Owner's Manual says an attenuator may be needed (p. 28).

### Testing

- `crates/rr73-cat/tests/elecraft_reference.rs`: commands and answers from the Programmer's Reference, its printed examples (`FA00014060000;` p. 11, `MD1;` p. 3, `OM A-F-------02;` p. 21) and the `IF` layout (p. 14), with pages.
- `crates/rr73-cat/tests/sim_kx2.rs`: each request against the simulated KX2: reads, sets and their read-back, `TX` in FSK D and PSK D, the Digirig's PTT on the MIC jack with MIC BTN and RTS, the menu read, band-change reports, auto-info, and sets while transmitting.
- `crates/rr73-cat/tests/elecraft_fuzz.rs`: random bytes in any chunks against the parser, answer-shaped input, frequencies through the format, random requests answered once by the simulator in any state, and random bytes to the simulator.
- `crates/rr73-wasm/src/cat_kx2.rs` and `web/src/lib/cat/wasm.test.ts`: the JSON through the WebAssembly exports.
- `web/src/lib/cat/radio-kx2.test.ts`: `CatRadio` with the KX2's traits against the simulator on a fake clock: the reads on connecting (`IF`, `BW`, `K2`, `DT` only in DATA), polling, auto-info, the menu read with its guard, its check that the menu is left and a refused read, PTT on and its re-reads, `?;` to PTT on with and without the radio keyed, the failures of PTT on, PTT off and its retries, a PTT on held back by a drain and Halt, only `TQ;` while keyed, the drain after `?;` and after a frequency set, no "No reply" during a good unkey, sets refused while keyed, the band change and DATA A's sideband, a refused dial, noise, the lost port and the recovery, the keying limit and a fault.
- `web/src/lib/state/cat-kx2.test.ts` (jsdom): Settings › Rig control with the KX2: the lines and the Digirig's PTT at open, the input in the wait, opening by itself only after MIC BTN read OFF, the baud rate, a radio transmitting at connecting with and without CAT keying and after a reload, choosing the other radio, the dial QSOs log, the band sheet's DATA A, the switch off and on, the mode notice outside DATA A, Halt, page hide, the lost port, Disconnect while keyed, PTT off unconfirmed, and Test keying's answers.
- `web/e2e/rig-kx2.spec.ts` (Playwright `chromium`) with `e2e/fake-kx2.ts`: choosing the KX2, the Off state's MIC BTN advice, connecting, the settings read and MIC BTN as an error, the warning outside DATA A, the band sheet, the dial followed, the baud rate, no automatic open after a PTT read and one after an OFF read, a radio transmitting at connecting, and Test keying with a radio that answers and one that keeps transmitting.
- `web/e2e/rig-kx2-tx.spec.ts` (Playwright `tx-cq`): `TX;` and `RX;` timed against a CQ's audio on the audio clock, and Halt. It skips, and fails on GitHub Actions, when the audio clock falls behind, as `rig-tx.spec.ts` does.

The simulator's choices where Elecraft's documents are silent are listed in `crates/rr73-cat/src/sim_kx2.rs`.

### Alternatives rejected

- Keying by the Digirig's RTS (PTT by RTS): no confirmation, it depends on MIC BTN, and the line state at open is Chromium's. `TX;` reads back with `TQ`.
- Auto-info (`AI1`, `AI2`) for the dial: it changes how the radio talks to every program after RR73. RR73 polls, and reads `IF` when the operator has AUTO INF on.
- Reading the KX2's other menu settings (VOX MD, VOX GN, TX GATE): `MP` reads only the entries marked in Table 6A (p. 19), VOX MD among the unmarked; each read also opens the entry on the radio. `VX` gives VOX in the present mode without the menu.
- Finding the baud rate by trying each: every open raises RTS, which keys the radio through the MIC jack with MIC BTN on PTT.
- The passband shift for the KX2 (Passband shift, above).
- Locking Connect radio until MIC BTN reads OFF: the operator controls their setup, and MIC BTN can be read only once the port is open. Rig control advises before it, and RR73 opens the port by itself only after an OFF read.
- Refusing transmissions outside DATA A: the operator may mean another mode. RR73 says the mode instead, in the status line, in Rig control and in Test keying's result.
- Reading MIC BTN every 5 s: each read opens the entry on the radio (MIC BTN, above).

### Open risks

Not tested on a device: everything above ran against the simulated KX2 and a fake KX2. The first session checks each stage on the radio.

- CAT keying on a radio with no transmit time-out in any Elecraft document, through an interface that Digirig says RF can stop from returning to receive (Troubleshooting Digital Modes). After a lost port, a crash or a stuck interface while keyed by `TX;`, the KX2 transmits until RR73 sends `RX;` on the next connection, or the operator unkeys it or turns it off. With the audio stopped, DATA A transmits the suppressed carrier, more than 50 dB down (Owner's Manual p. 70). VOX keying stops when the audio stops. Key the radio with CAT stays off by default.
- Unverified: how long RTS stays asserted at `open()` before `setSignals` lowers it, and whether that keys the KX2 through the KX cable with MIC BTN on PTT. Elecraft's documents do not give the MIC jack's PTT level. MIC BTN OFF leaves the line out of keying either way.
- Unverified: the CP2102N's RTS during a USB reset, enumeration, suspend and the port closing. RR73 cannot hold the line then. MIC BTN OFF covers these too.
- Unverified: whether `RX` ends a transmission held by the MIC jack's PTT line. RR73 holds RTS low and never relies on it.
- Unverified: whether `TQ` says transmit at once after `TX;`. RR73 reads it again until 300 ms; a radio slower than that gets "Radio did not answer PTT" or "Radio refused PTT" on every transmission.
- Unverified: which commands answer `?;` while the radio transmits (p. 3 lists none). RR73 sends only `TQ;`, `TX;` and `RX;` while it may hold the radio keyed, and no set while the radio transmits.
- Unverified: whether the KX2 leaves transmit by itself when its ACC port goes quiet during a CAT keying.
- Unverified: the KX2's transmit passband in DATA A. Below about 300 Hz or above about 2700 Hz the audio may be attenuated; RR73 does not know. Measure it before offering Keep Tx audio centred for the KX2.
- Unverified: what `MN` and `MP` do to the radio's keying. RR73 reads the menu only in receive, never between PTT on and the confirmation of PTT off, and checks that the menu is left.
- Unverified: whether the K2 command mode and the auto-info mode survive a power cycle. Rig control's advice for K2 modes 1 and 3 says to turn the KX2 off and on.
- Unverified: what MIC BIAS (default ON, Owner's Manual p. 48) does to the Digirig's output on the MIC jack's tip. Digirig puts capacitors in its audio input and output (Understanding Rig Control Options).
- Unverified: whether CAT commands restart MENU › AUTO OFF's countdown (p. 44). Rig control says to keep it at INFINITE.
- Unverified: the name Chromium's port chooser gives the Digirig's serial port, and its USB IDs.
- Unverified: Web Serial through the Silicon Labs driver at 4800 baud.
- `MN082;MP;MN255;` opens MIC BTN in the radio's menu for a moment, on connecting and each time Rig control opens. A link lost between `MN082` and `MN255` leaves the radio in its menu: RR73 sends `MN255` again when it can, and otherwise says to tap DISP.
