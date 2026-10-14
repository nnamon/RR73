# RTTY

Status: approved 2026-10-14, with every recommendation below accepted. Built on `feat/rtty-app`; "As built" at the end lists where the build departs from this doc.

RTTY is the third mode family and the first keyboard mode (ADR 0006). This doc covers Operate in RTTY, the keyboard engine that PSK31, Olivia, MFSK, DominoEX, THOR, Contestia, Hellschreiber, MT63 and JS8Call will share, logging a keyboard QSO, Settings › RTTY and Settings › Macros, RTTY dial frequencies, and what the app takes from the RTTY receiver and transmitter in `rr73-rtty` (experiment 0005, branch `feat/rtty-core`). It builds on WSPR's Operate frame: one frame, a pane per mode family (`docs/design/wspr.md` on `feat/wspr-app`, 0.12.0).

## Facts the design uses

| | |
| --- | --- |
| Signal | Two tones, mark and space, 170 Hz apart by default. On the amateur bands mark is the higher radio frequency. About 250 Hz wide at 45.45 baud. |
| Rates | 45.45 baud by default: 22 ms a bit, 7.5 bits a character with 1.5 stop bits, 165 ms a character, 6.1 characters a second (60 wpm). 50 baud: 150 ms a character. 75 baud: 100 ms. |
| Code | ITA2, 5 bits, upper case only. LTRS and FIGS switch between letters and figures case. US and ITA2 teleprinters differ in the figures case of 8 letters, D F G H J S V Z: US prints $ ! & # ' BELL ; " and ITA2 prints WRU, nothing for F G H, then BELL ' = +. |
| Unshift on space (USOS) | A space received in figures case returns to letters. The sender repeats FIGS before a figure that follows a space. On by default in the crate and in most RTTY software. |
| Receiver | `rr73-rtty`: characters arrive 0.33 s after their stop bit. Squelch −14 dB SNR in 3000 Hz by default, which prints 0.1 characters a minute of noise. 10 % character errors at −9.1 dB in white noise, 1.5 dB better than minimodem. 0.57 ms of CPU a second of audio in WebKit (experiment 0005). |
| Transmitter | A 1-bit mark lead, 3 LTRS (0.5 s at 45.45 baud), the text, 1 LTRS, and 5 ms ramps. LTRS back to back (the diddle) while the queue is empty. Continuous phase. |
| Tones | The crate's default pair is centred on 1500 Hz: mark 1585 Hz, space 1415 Hz. |
| Ranges | 20 to 150 baud, shifts of 50 to 1000 Hz, tones of 100 to 5000 Hz, 1 to 2 stop bits. |

## Dial frequencies and "Set the radio to"

### Conventions

- An RTTY station's frequency is quoted as its mark frequency, in spots and in contest logs. Unverified: no written standard was found for this doc.
- Classic AFSK puts the radio in LSB with mark at 2125 Hz and space at 2295 Hz audio. LSB inverts the audio, so mark lands 2125 Hz below the dial and space 2295 Hz below: mark is the higher radio frequency, as it should be. Radios with an RTTY (FSK) mode show the mark frequency on the dial.
- RR73 uses USB, as in FT8 and WSPR, with the pair centred on 1500 Hz: mark at 1585 Hz, space at 1415 Hz. In USB mark is the higher audio tone, which the crate calls normal polarity. Mark frequency = USB dial + mark audio. 14.0830 MHz USB with the default pair gives mark 14.084585 MHz.
- Reason: the KX2 and IC-705 stay in the setup FT8 already uses (USB, VOX, the same audio levels), the pair sits in the middle of the SSB filter, and the waterfall keeps FT8's 0 to 3000 Hz. A radio left in LSB shows every RTTY signal reversed: Rev in Operate fixes it.

### Dials

RTTY has no fixed calling frequency. Operators tune across a segment of 10 to 20 kHz, and contests spread further. The table gives the dial the band sheet suggests for each band: the bottom of the usual RTTY segment, moved up where FT8 or FT4 sits at the bottom. The dial is editable in RTTY, as it is for Hound: RR73 cannot read the radio, so the dial field is where the operator says where the radio is, and the log's FREQ depends on it.

| Band | Dial, USB, MHz | Pair centre at 1500 Hz, MHz | Usual RTTY activity, MHz | Note |
| --- | --- | --- | --- | --- |
| 160m | 1.8050 | 1.8065 | 1.800 to 1.820 | Little activity. Many countries start the band at 1.810. |
| 80m | 3.5800 | 3.5815 | 3.580 to 3.600 | Up to 3.650 in contests. |
| 60m | Off | | | No common RTTY frequency. |
| 40m | 7.0400 | 7.0415 | 7.035 to 7.045 outside the Americas, 7.080 to 7.100 in the US | FT4 sits at 7.0477 to 7.0505. |
| 30m | 10.1430 | 10.1445 | 10.140 to 10.150 | FT4 sits at 10.1402 to 10.1430. |
| 20m | 14.0830 | 14.0845 | 14.080 to 14.099 | FT4 sits at 14.0802 to 14.0830. Beacons at 14.100. |
| 17m | 18.1070 | 18.1085 | 18.100 to 18.110 | FT8 and FT4 fill 18.1002 to 18.1070. Unverified. |
| 15m | 21.0800 | 21.0815 | 21.080 to 21.100 | |
| 12m | 24.9220 | 24.9235 | 24.910 to 24.930 | FT8 and FT4 fill 24.9152 to 24.9220. Unverified. |
| 10m | 28.0800 | 28.0815 | 28.080 to 28.100 | |
| 6m | 50.3000 | 50.3015 | Unverified | Little activity. |
| 2m | Off | | | |

Sources: electronics-notes.com, "Amateur radio RTTY frequencies" (read 14 October 2026), and the IARU Region 1 HF band plan (2016 revision: 18.095 to 18.105 narrow band modes). The Region 3 plan's current limits (Rev. 2, November 2024) were not read: Unverified for 9V1.

### What "Set the radio to" shows

- In RTTY the band sheet shows "Set the radio to", the dial as an editable field in MHz, and "USB". The field takes MHz or kHz: "14085" reads as 14.0850 MHz. The footer under it reads "Update this after each retune: QSOs log it as their frequency."
- Changing band fills the field with that band's dial from the table. An edited dial is kept per band until the band's dial is edited again.
- A tap on the dial in Operate's top bar opens the band sheet with the field focused, so a retune after search and pounce takes one tap and a few digits.
- The top bar shows the dial to four decimals (14.0830). The status line shows the mark frequency of the pair (14.0846 MHz), the number an operator spots or logs.

## Mode switching

- The band sheet's mode control reads FT8, FT4, WSPR and RTTY. Four segments fit at 375 pt. With PSK31 and the later modes the control becomes a grid of mode tiles like the band tiles, a separate change.
- Changing to RTTY stops FT8's Tx, Hunt and a transmission on air, and the WSPR beacon, as Halt does. Changing from RTTY ends a transmission in progress and keeps the text typed ahead.
- Changing band in RTTY ends a transmission in progress: the operator retunes the radio. The received text stays, with a divider "40m · 7.0400" at the change. The QSO strip keeps its fields.
- `Mode` in `lib/clock/slots.ts` gains `RTTY` with no slot. `FtMode` stays FT8 and FT4, so the slot code cannot reach RTTY.

## Operate

The frame stays (ADR 0006, wspr.md): top bar, waterfall, the pane's middle and the pane's bottom bar. RTTY adds `KeyboardPane` (family `keyboard`) to `views/operate/panes.ts`. The pane is shared by every keyboard mode and takes a modem adapter: RTTY's adapter adds the tuning row's RTTY chips and the RTTY modem. Heights at 393 x 852:

| Part | Height | Keyboard up |
| --- | --- | --- |
| Top bar | 44 pt | 44 pt |
| Waterfall with ruler | 130 pt | 48 pt, without the ruler |
| Tuning row | 36 pt | hidden |
| Received text | the rest, about 330 pt (16 lines) | the rest, about 165 pt (8 lines) |
| QSO strip | 44 pt | 44 pt |
| Text to send | 52 pt, growing to 3 lines | 52 pt |
| Macro row | 52 pt | 52 pt |
| Status line | 22 pt | hidden |
| Buttons | 52 pt | 52 pt, above the keyboard |

### Top bar

- Band, the RTTY tag, the dial (14.0830), the UTC clock, Log and Settings. There is no slot ring. A red line along the bottom edge while on air, as in FT8.

### Waterfall

- 0 to 3000 Hz across the width, as in FT8: 0.13 pt per Hz, so a 170 Hz pair is 22 pt wide and 10 to 12 stations fit side by side. 30 s over its height (FT8 shows 45 s): a station that starts sending shows within a few seconds. A 2048-point FFT at 12 kHz, 5.9 Hz bins, as in FT8.
- The tuning marker is two lines: mark and space, each 2 pt, labelled M and S at the top, with a faint band between them. Green while receiving; red while on air, because RTTY transmits on the pair it receives.
- A tap on a signal moves the pair to it: `find(tap, 100 Hz)` searches the last second of audio for the strongest pair within 100 Hz and the status line says "Tuned to 1612 Hz". When the search finds nothing, the pair moves to the tap: `tune(mark)`.
- A drag moves the pair with the finger, keeping the shift, through `tune(mark)` on each move. AFC then pulls it onto the signal.
- A transmission keeps the pair it started on. A tap or drag while on air moves the pair for the next transmission and for receive after this one.
- With AFC on, the marker follows the signal (the `afc` events). A search that finds a different shift (`tone_shift`) says "Shift 425 Hz found" and changes the shift chip.
- Hint while no audio has arrived: "Tap a signal to tune", in the place of FT8's "Drag to move Tx".

### Tuning row

- 36 pt, the height of FT8's filter row. Chips from the left: AFC, Squelch, Rev, speed and shift. On the right, the signal indicator.
- AFC: a toggle, filled accent when on. `set_afc_tracking`.
- Squelch "Sq −14": a tap opens a menu of Off and −20 to −6 dB in 2 dB steps. Settings › RTTY takes any value from −30 to 0 dB.
- Rev: a toggle for reversed polarity (a station sending reversed, or the radio in LSB). Filled accent when on. It applies to receive and transmit, so the operator answers a reversed station as they hear it.
- Speed and shift "45.45 · 170": a tap opens the presets 45.45 · 170, 50 · 170, 75 · 170, 45.45 · 425 and 50 · 850, and Other, which opens Settings › RTTY. A choice applies at once: the receiver is rebuilt with the new settings at the same mark.
- Signal indicator: 5 bars for −20 to 0 dB SNR and the value, "−8 dB", from the `signal` event every 0.51 s. Bars are green while the squelch is open and grey while it is closed. A tick on the bars marks the squelch level.
- Reason for a row of chips: each is something an operator changes during a QSO when copy goes bad. USOS and the figures table change rarely and sit in Settings › RTTY.
- Rejected: the crossed-ellipse tuning scope. It needs a square of 60 pt or more, and the marker on the waterfall shows the same alignment.

### Received text

- 15 pt monospace, 40 characters a line at 393 pt, newest at the bottom, as on a teleprinter and in every RTTY program. Lines wrap at the width; a CR LF from the sender starts a new line.
- The pane follows the newest text. Scrolled up, it stays where it is and shows "↓ 3 new lines" at the bottom; a tap returns to the newest.
- Characters with a framing error or a bit confidence (`quality`) under 0.5 print in the third label colour, so garbled copy reads as uncertain. The 0.5 is a starting value, to be set from recordings. Characters below the squelch never print (the crate drops them).
- Sent text appears in the same pane in the transmit text colour as each character is handed to the transmitter, so the conversation reads in order.
- A divider with the UTC time ("14:05") opens the text that follows 20 s with nothing sent or received. Band changes add "40m · 7.0400". A contest exchange runs on without dividers; colour tells sent from received.
- Callsigns in the text are semibold with a dotted underline and carry the decode colours that name a callsign: My call, New call, New call on this band and Worked before. A callsign is a word that matches the callsign pattern and resolves to a country in the app's prefix table, so "599", "5NN" and "TU" never match.
- The pane keeps 2000 lines in memory. A reload starts it empty. Clear text in ••• empties it.

Gestures:

- Tap a callsign: it becomes the QSO's callsign. The strip's call is set, {CALL} in the macros now expands to it, and the strip fills from the text (Logging, below). The status line says "Call set to JA1XYZ".
- Tap another word: a menu by the word offers Name, QTH, RST received, Number received and Notes. When the word reads differently in the other case, the menu says so in its header ("QWU reads 127 in figures") and offers that reading first: "Number received 127". A lost FIGS turns 599 127 into TOO QWU; the reading repairs it in one tap.
- Touch and hold any word, callsign included: the same menu, with Call added.
- Double-tap does nothing in RTTY.

### Text to send

- One text field above the macro row, 52 pt, growing to 3 lines. Upper case only: the field shows capitals and opens the keyboard with `autocapitalize="characters"`, autocorrect, spell check and autocomplete off, and `enterkeyhint="send"`.
- Text typed while receiving waits in the field. Text typed while on air goes out as it is typed: the field holds the queue, and each character leaves the field and appears in red in the received text as it goes to the transmitter.
- The field shows the queue in label colour, the next character underlined, and the queue's length in seconds on the right ("3.8 s"). A clear button empties it.
- Backspace removes queued characters. A character already handed to the transmitter is on air and stays.
- Return while receiving starts a transmission with the line and a new line, and returns to receive when the line is sent. Return while on air adds a new line to the queue and keeps transmitting.
- Characters the figures table cannot send (`rtty_unsendable`, such as @ and % with US figures) show with a red underline in the field and are skipped. The status line says "Not sent: @ %".

### Macro row

- One row of capsule buttons, 44 pt targets, scrolling sideways: "CQ", "Answer", "Over", "Report", "BTU", "73", "QRZ?", "Again" with the default QSO set. About 6 fit at 393 pt; the row scrolls to the rest.
- A tap expands the macro and adds it to the queue at once, so the operator sees the text before it goes out. While receiving, a tap starts a transmission.
- A macro with Return to Rx on (the default for every macro except Over) ends the transmission after its text. Over leaves the transmitter running so the operator types the rest of the over.
- A macro that needs {CALL} with no callsign set adds nothing, and the status line says "No callsign to call".
- ••• › Macros steps between the QSO set and the Contest set. The strip shows numbers in the Contest set.

### QSO strip

- One 44 pt row above the text to send: callsign, RST sent, RST received, name and QTH in the QSO set; callsign, sent "599 042", received and the dupe tag in the Contest set. Each field is editable in place: a tap opens the keyboard in that field.
- Empty fields show their name in the placeholder colour: Call, Rcvd, Name, QTH. Sent starts at 599.
- A "Worked" tag shows when the callsign is in the log on this band and mode (in the Contest set: since the contest started, by its CONTEST_ID). Logging a dupe is allowed.
- A tap on the strip's chevron opens the full QSO sheet (Logging).

### Bottom bar

- Status line: on the left the mark frequency and tones, "14.0846 MHz · 1585 / 1415 Hz"; on the right "Rx", "Tx · 3.8 s" while on air, "Rx in 2 s" while ending, or "CQ in 3 s" while Repeat CQ waits. Notices replace the left side for 20 s, as in FT8.
- Buttons: Tx, Log QSO, ••• and Halt.
- Tx: "Tx off" with a grey dot while receiving. A tap starts a transmission: "On air", solid red with a blinking dot. A tap on On air ends the transmission after the queue: "Rx in 2 s" in the accent tint until the queue is sent, then Tx off. A tap while ending keeps the transmission going.
- Log QSO: logs the strip (Logging). Shown at reduced opacity until the strip has a callsign.
- ••• menu: Repeat CQ (a switch), Macros (QSO or Contest, stepping on each tap), Tune for 10 s, Save 2 min of audio, Clear text.
- Halt: ends the transmission at once, with the 5 ms ramp, turns Repeat CQ off and keeps the unsent text in the field. Red tint, always visible, one tap, as in FT8 and WSPR.

### Keyboard up

- The app sizes itself to `visualViewport.height` while the keyboard is up, so the buttons, the macro row, the text to send and the strip sit on the keyboard and Halt stays visible.
- The waterfall shrinks to a 48 pt strip without its ruler, keeping the marker and taps to tune. The tuning row and the status line hide. The received text keeps the rest: about 165 pt, 8 lines, at 393 x 852 with a 336 pt keyboard and its suggestions bar. Unverified: Safari may add its 44 pt bar of form arrows above the keyboard, which leaves 6 lines.
- The keyboard goes down with a swipe down on the received text or the keyboard's own dismiss. Typing never starts a transmission by itself; Return or Tx does.

### Transmitting with VOX

- A transmission is a stream: the transmitter renders 100 ms blocks in the keyboard worker and posts them to the output worklet. The app keeps at most 0.4 s of text in the transmitter (`queued_s`) and holds the rest in its own queue, which is what makes backspace and the sent and queued display possible. The crate's `push_text` cannot take characters back.
- Key-down to first character: the mark lead and the preamble, 3 LTRS by default (0.5 s at 45.45 baud), give the radio's VOX time to key. The preamble is settable in seconds. "Start each Tx with a new line" (on) sends CR LF after the preamble, so the other station's text starts on a fresh line.
- While the queue is empty the transmitter sends the diddle, which keeps VOX keyed and the other station's receiver in step. Idle can be set to steady mark.
- End: `finish()` sends the queue, the tail (1 LTRS by default) and the ramp. The radio stays keyed for its own VOX delay.
- Stop idle Tx after: a transmission that has sent only the diddle for 1 min ends by itself and the status line says "Tx off after 1 min idle". Settable from 10 s to any length, or Off.
- Watchdog: Tx goes off after 10 min with no key press, macro tap or Log QSO, as in FT8. It stops Repeat CQ too. Settable, or Off.
- The receiver ignores capture while on air (the radio's own audio would print as noise) and calls `reset()` when the transmission ends. Received text resumes on the next character.
- Repeat CQ (••• switch): sends the CQ macro, listens for 3 s, and sends it again, until a character prints, the operator types or taps a macro, or Halt. The listening gap is set in Settings › RTTY.

### Status notices

In `lib/qso/status.ts`, each 6 words or fewer, no full stop: "Tuned to 1612 Hz", "Shift 425 Hz found", "Call set to JA1XYZ", "Logged JA1XYZ" (with the logged notice and Undo, as in FT8), "No callsign to call" (shared with FT8), "Not sent: @ %", "Tx off after 1 min idle", "Watchdog stopped Tx after 10 min" (shared), "Audio stopped · Tx off" (shared), "Speed 50 baud, shift 170 Hz", "Squelch −16 dB".

## Keyboard engine

Shared by every keyboard mode. RTTY is the first user. Each later mode brings a modem adapter and the tuning row chips it needs, and keeps everything below.

| Part | Where | Job |
| --- | --- | --- |
| Modem adapter | `lib/keyboard/modem.ts`, `lib/rtty/modem.ts` | The interface below, and RTTY's implementation over `RttyReceiver` and `RttyTransmitter`. |
| Keyboard worker | `lib/keyboard/keyboard.worker.ts` | Holds the receiver and the transmitter. Takes 12 kHz capture chunks, returns events; renders Tx blocks. |
| Send queue | `lib/keyboard/queue.ts` | Text typed ahead, feeding the transmitter up to 0.4 s ahead; backspace; sent and queued; unsendable characters. |
| Macros | `lib/keyboard/macros.ts` | The macro sets, field expansion, Return to Rx and Log QSO when sent. |
| Words | `lib/keyboard/words.ts` | Callsigns, reports, numbers, names and QTHs in received text; the other-case reading. |
| QSO draft | `lib/keyboard/draft.ts` | The strip's fields, fill from text, serial numbers, dupes, the logged record. |
| Transcript | `lib/keyboard/transcript.ts` | Received and sent text with quality, dividers, 2000 lines. |
| Pane and parts | `views/operate/KeyboardPane.svelte`, `ui/ReceiveText.svelte`, `ui/SendField.svelte`, `ui/MacroRow.svelte`, `ui/QsoStrip.svelte`, `ui/KeyboardBar.svelte`, `ui/TuningRow.svelte` | Operate in a keyboard mode. |

```ts
/** One keyboard mode's modem, as the keyboard worker drives it. */
export interface KeyboardModem {
  readonly mode: 'RTTY'; // later 'PSK31' | 'PSK63' | 'OLIVIA' | ...
  /** True when the mode sends capitals only (RTTY). */
  readonly upperCaseOnly: boolean;
  /** The characters in `text` the mode cannot send, each once. */
  unsendable(text: string): string;
  /** 12 kHz mono capture; returns the events it completed, oldest first. */
  push(samples: Float32Array): ModemEvent[];
  /** Moves the receiver to a signal at `hz` (RTTY: the mark tone). */
  tune(hz: number): void;
  /** Searches near `hz`, within `rangeHz`, and moves to the strongest signal. */
  find(hz: number, rangeHz: number): void;
  /** Clears receive state after a transmission. */
  reset(): void;
  /** A transmitter at the output rate, Hz. */
  transmitter(sampleRate: number): ModemTx;
}

export interface ModemTx {
  /** Queues text; returns the characters skipped. */
  pushText(text: string): number;
  /** Up to `n` samples; fewer only once the transmission has ended. */
  render(n: number): Float32Array;
  /** Sends the queue and the tail, then ends. */
  finish(): void;
  readonly queuedS: number;
  readonly done: boolean;
}

export type ModemEvent =
  | { type: 'char'; ch: string; snrDb: number; quality: number; framingError: boolean }
  | { type: 'signal'; snrDb: number; squelchOpen: boolean }
  | { type: 'tones'; hz: number[] } // RTTY: [mark, space]
  | { type: 'mode'; detail: string }; // RTTY: a shift found, "425 Hz"
```

- Hellschreiber receives a picture: its pane draws a strip of received columns in the place of text, and keeps the send queue, macros and strip. JS8Call frames messages in 15 s slots; whether it takes this engine is open (ADR 0006).

### Macro fields

| Field | Becomes |
| --- | --- |
| {MYCALL} | Station callsign, or the activation's call. |
| {MYNAME}, {MYQTH}, {MYGRID} | Name and QTH from Settings › Station (new rows), and the grid. |
| {CALL} | The strip's callsign. |
| {NAME}, {QTH} | The strip's name and QTH. |
| {RST} | The report to send, from the strip: 599 by default. |
| {NR} | The serial number to send in this QSO, with the digits set (042). |
| {EXCH} | The contest exchange from Settings › RTTY: "599 {NR}" by default. |
| {UTC} | UTC time, 4 digits: 1405. |

- Fields expand when the macro is tapped. Each macro also has two switches: Return to Rx (ends the transmission after the macro) and Log QSO when sent.
- A macro that needs the station's callsign, name, QTH or grid sends nothing while that field is empty, and the status line says which to set: "Set name and QTH in Settings". Without it Report went out as "NAME QTH". The other station's fields may be empty: the spaces around them close up ("TNX 73 ES GL").
- Every macro starts on a new line unless its text starts with a space.

Default QSO set:

<!-- lint-copy: off -->
| Label | Text | Return to Rx | Log |
| --- | --- | --- | --- |
| CQ | CQ CQ CQ DE {MYCALL} {MYCALL} {MYCALL} PSE K | on | off |
| Answer | {CALL} {CALL} DE {MYCALL} {MYCALL} {MYCALL} K | on | off |
| Over | {CALL} DE {MYCALL} | off | off |
| Report | TNX FER CALL. UR RST {RST} {RST}. NAME {MYNAME} {MYNAME} QTH {MYQTH} {MYQTH} | on | off |
| BTU | BTU {CALL} DE {MYCALL} K | on | off |
| 73 | TNX {NAME} 73 ES GL. {CALL} DE {MYCALL} SK | on | off |
| QRZ? | QRZ? DE {MYCALL} K | on | off |
| Again | AGN AGN PSE | on | off |

Default Contest set:

| Label | Text | Return to Rx | Log |
| --- | --- | --- | --- |
| CQ | CQ TEST {MYCALL} {MYCALL} CQ | on | off |
| Exch | {CALL} {EXCH} {NR} {CALL} | on | off |
| TU | TU {MYCALL} TEST | on | on |
| My call | {MYCALL} {MYCALL} | on | off |
| S&P exch | TU {EXCH} {NR} | on | on |
| Again | AGN AGN | on | off |
| Nr? | NR? NR? | on | off |
| Call? | CL? CL? | on | off |
<!-- lint-copy: on -->

### Words in received text

- Callsign: the pattern of an amateur callsign, with an optional prefix or suffix (/P, /M, /QRP, VK3/), that resolves to a country. A word with an uncertain character is left out. Takes the decode colours.
- Report: 5 followed by two digits from 1 to 9, after "RST", "UR" or in a contest exchange.
- Number: 1 to 4 digits after a report in the Contest set.
- Name: the word after "NAME", "NAME IS", "NAME HR IS" or "OP".
- QTH: up to 2 words after "QTH", "QTH IS" or "QTH HR IS", up to a full stop or the end of the line.
- Other-case reading: the US or ITA2 table as set, letters row Q to P against 1 to 0 and the rest of the figures case. The crate owns the table; the app asks `rtty_other_case` (an addition, below).

## Logging

There is no sequencer: the operator decides when a QSO is complete. Log QSO in the bar, or a macro with Log QSO when sent (the Contest set's TU), logs the strip.

- Filling from text: when a callsign is set, the strip fills Name, QTH, RST received and, in the Contest set, Number received from that station's text since its callsign first appeared, within the last 10 min. A filled field shows in label colour like a typed one and can be edited or cleared. A field the operator typed is never overwritten.
- Time on: when the callsign first appeared in the text within the last 10 min, or when it was set. Time off: when logged.
- The record: CALL, QSO_DATE, TIME_ON, TIME_OFF, BAND, FREQ (dial + mark audio of the pair at Log QSO), MODE RTTY with no SUBMODE, RST_SENT and RST_RCVD as 3 digits, NAME, QTH, GRIDSQUARE when entered, COMMENT from Notes, STX and SRX in the Contest set, CONTEST_ID when Settings › RTTY names one, and the station and activation fields as FT8 writes them.
- `Qso` in `lib/log/types.ts` gains `name`, `qth`, `stx`, `srx` and `contestId`; the log migration fills '' and null in older records. `LogQsoRecord.mode` takes RTTY. `QsoSource` gains `keyboard`.
- After logging: the logged notice with Edit and Undo for 10 s, as in FT8 ("Logged JA1XYZ 20m RTTY 599 / 579"). The strip clears; the serial number steps on by 1. Undo removes the QSO and leaves the serial where it is: a gap in serial numbers is allowed in the contests that use them.
- The QSO then takes the paths every QSO takes: the log, the outbox and Wavelog, ADIF files and the activation files. Wavelog takes the ADIF record as it does for FT8. Whether Wavelog keeps NAME, QTH, STX and SRX from the API: Unverified, to be checked against a Wavelog instance.
- The QSO sheet (the strip's chevron, and Add QSO in Log) gains Name, QTH, Number sent and Number received rows, and Mode offers RTTY. Opened from the strip it shows the strip's fields, the band, the frequency and the times, and Log QSO.

## Settings

Per ADR 0006. The Modes group on the Settings screen gains RTTY, after WSPR, showing "45.45 · 170 Hz", and Macros, showing "QSO · 8".

Settings › Station gains Name and QTH, for {MYNAME} and {MYQTH}.

| RTTY setting | Default | Range |
| --- | --- | --- |
| Speed | 45.45 baud | 45.45, 50, 75, or Other: 20 to 150 baud. |
| Shift | 170 Hz | 170, 200, 425, 850, or Other: 50 to 1000 Hz. |
| Stop bits | 1.5 | 1, 1.5, 2. Transmit only: the receiver accepts any. |
| Reverse | Off | Also in Operate. |
| AFC | On | Also in Operate. |
| Squelch | −14 dB | Off, or −30 to 0 dB in 1 dB steps. Also in Operate. |
| Unshift on space | On | Receive and transmit. |
| Figures | US | US or ITA2. |
| Preamble | 0.5 s | 0 to 5 s, sent as LTRS. |
| Idle | Diddle | Diddle or Mark. |
| Tail | 1 character | 0 to 10 LTRS. |
| Start each Tx with a new line | On | |
| Stop idle Tx after | 1 min | 10 s, 30 s, 1 min, 2 min, 5 min, Off, or any number of seconds. |
| Watchdog | 10 min | Off, or any number of minutes. |
| Repeat CQ gap | 3 s | 1 to 60 s. |
| Macros | QSO · 8 | Opens Settings › Macros. |
| Contest | Off | Off, or a CONTEST_ID such as CQ-WPX-RTTY. |
| Next serial | 1 | 1 to 9999. |
| Serial digits | 3 | 1 to 4: 001 or 1. |
| Exchange | 599 {NR} | Text with fields. |

- Settings › Macros is shared by every keyboard mode. A control at the top switches between the QSO and Contest sets. Each row shows the label and the first line of text; a tap opens the macro: Label, Text, a row of field buttons that insert {CALL} and the rest at the cursor, Return to Rx and Log QSO when sent, and Sends now: the text with the fields of the QSO in progress. Rows reorder by drag. Swipe to delete, with Undo. Add macro at the end of the set. Restore defaults with one confirmation, which names the consequence: "Restore 8 default macros? Your 3 edited macros are replaced."
- Settings schema 8 adds an `rtty` object, a `keyboard` object (macro sets, contest, serial) and the station's name and QTH, at their defaults, and leaves every other value where it was, as schema 7 did for WSPR.

## RTTY modem API

The app uses the `rr73-wasm` exports as built on `feat/rtty-core` (experiment 0005, "The WebAssembly API"):

- `new RttyReceiver(json)`, `push(samples)`, `flush()`, `tune(mark_hz)`, `find(near_hz, range_hz)`, `set_afc_tracking(on)`, `reset()`, `config()`, and the getters `mark_hz`, `space_hz`, `shift_hz`, `snr_db`, `samples`.
- `new RttyTransmitter(json)` at the AudioContext rate, `push_text`, `render`, `finish`, `is_done`, `queued_s`.
- `rtty_unsendable(text, figures)` for the send field, and `rtty_defaults()` for Settings' defaults.
- Settings map onto `DecoderConfig` and `TxConfig`: speed, shift, stop bits, polarity, figures and USOS in `params`; `mark_hz`; `afc.track`; `squelch_db`; `preamble_chars` from the preamble in seconds; `postamble_chars`; `idle`.

Additions asked of the crate:

- `rtty_other_case(text, figures)`: the text read in the other case, for the field menu's other-case reading ("QWU reads 127 in figures"). The app could hold its own copy of the ITA2 table; one table in the crate keeps the two from drifting apart.

## Testing

- Unit: the send queue (type ahead, backspace, sent and queued, unsendable), macro expansion, word recognition on recorded RTTY text, the draft's fill from text, serial numbers, the ADIF record for an RTTY QSO.
- End to end: Playwright drives Operate in RTTY with the practice band's noise and a synthetic RTTY station from `rtty_encode`, through a CQ, an answer, a logged QSO and a contest exchange, in both themes at 375 x 667 and 393 x 852. A keyboard-up review screen at 393 x 852 with the viewport cut to 516 pt.
- On a device: the keyboard layout, VOX keying with the preamble on the KX2 and the IC-705, a 10 min over without gaps in the audio, and a QSO with a station running other RTTY software.

## Not in this round

- Split: a Tx pair apart from the Rx pair. Tx follows the Rx pair.
- FSK keying: no serial port or CAT from Safari on iOS.
- RTTY in POTA and cluster spots, and spotting.
- Contest scoring, multipliers, rate and Cabrillo export. The log and its ADIF carry what Cabrillo needs.
- Callbook lookups of name and QTH (QRZ.com, HamQTH).
- Decoding several RTTY signals at once.
- RSID, the other keyboard modes and their modems.
- Saving the received text to a file.

## Alternatives rejected

- Newest text at the top, as FT8's and WSPR's lists show it: a line grows as characters arrive, and at the top each new line would push the text being read down.
- LSB with 2125 and 2295 Hz: the operator would change sideband on the radio at every change between FT8 and RTTY.
- A separate Tx marker: the operator would have to keep two markers together for every normal QSO.
- The full QSO sheet as the only log entry: it covers the received text the fields are filled from.
- A 2 x 4 grid of macro buttons: 96 pt high, 2 lines of received text fewer, which leaves 6 lines with the keyboard up.
- A macro set per mode: a PSK31 operator's CQ and 73 are the same text as their RTTY ones. A mode-specific macro can name the mode in its label.
- Transmitting on each keystroke from receive: a stray tap on the field would key the radio. Return and Tx start a transmission.
- The crossed-ellipse tuning scope: 60 pt or more for what the marker shows.

## Open risks

- The keyboard on iOS: Safari overlays the keyboard on a home-screen app, and the layout depends on `visualViewport` resize events while it opens and closes. The height of the keyboard, its suggestions bar and Safari's form bar are Unverified. Not tested on a device.
- A continuous Tx stream: a gap in the audio is a gap in the keying, which garbles characters and can drop VOX. The worker renders 100 ms blocks and the worklet holds 0.3 s; whether that holds while the operator types and Operate redraws is Not tested on a device.
- VOX: the first characters are lost if the radio keys later than the preamble. The KX2's and IC-705's VOX attack and delay are Not tested on a device with RTTY.
- Duty cycle: RTTY keys the radio for the whole over, 100 % of the time. The KX2's heat at 5 W and 10 W in a 5 min over is Not tested on a device.
- The decoder has met synthetic signals only, and its squelch takes its noise floor from the median of the spectrum, which rises in a full contest band (experiment 0005).
- FREQ in the log is right only while the dial field matches the radio. A forgotten retune logs the wrong kHz on the right band.
- Words: garbled copy can form a callsign-shaped word, such as E3TQ, that takes the decode colours and fills the strip on a tap. Leaving out words with uncertain characters removes some; measured on no real text yet. Unverified.
- Safari stops capture when the screen locks, as for WSPR: a long listening session needs the screen on with the wake lock.

## Questions for the owner

Answered 14 October 2026: every recommendation accepted.

1. Received text: newest at the bottom, as RTTY programs show it, or newest at the top, as RR73's FT8 and WSPR lists? Recommended: bottom.
2. Logging: an always-visible QSO strip that fills from tapped words, or a Log QSO button that opens the full sheet? Recommended: the strip, with the sheet behind its chevron.
3. Fill from text: when a callsign is tapped, fill name, QTH and the report from that station's recent text, or fill only the words the operator taps? Recommended: fill from text, editable.
4. Macros: one scrolling row, or a fixed grid of 8? Recommended: one row.
5. Macros shared by every keyboard mode, or a set per mode? Recommended: shared, with a QSO set and a Contest set.
6. Return in the text field: send the line, starting a transmission when receiving, or only start a new line? Recommended: send the line.
7. Repeat CQ and the Contest set with serial numbers in the first RTTY release, or a later one? Recommended: first release.
8. Keyboard up: keep a 48 pt waterfall strip, or hide the waterfall for 2 more lines of text? Recommended: keep the strip.
9. The dials in the table, with 20m at 14.0830 to clear FT4 at 14.080. Recommended: as listed; 17m, 12m and 6m are Unverified.

## As built

- The practice band has RTTY stations after all: JA1XYZ calls CQ and works the operator with name and QTH, DL5ABC answers the operator's CQ, and OH2BAX calls CQ TEST and gives an exchange. They answer 2 s after the operator's transmission ends. Their audio comes from `rtty_encode` in the keyboard worker.
- `rtty_other_case` exists in the crate and the app; the keyboard worker turns it and `rtty_unsendable` into tables once per setting, so the send field and the word menu read them without a round trip to the worker.
- The whole band and mode button in the top bar opens the band sheet, which focuses the RTTY dial field whenever it opens in RTTY. The top bar has one button for band, mode and dial.
- The QSO sheet shows Name and QTH for RTTY QSOs, and Number sent and Number received with the Contest set in use or when a QSO has them. STX and SRX go to ADIF as integers ("042" as 42); a received exchange that is not a number goes to SRX_STRING.
- Settings › Macros deletes a macro by a swipe to the left, with Undo, and also by Delete macro on the macro's screen. Rows reorder by the handle or by Move up and Move down, which show while focused.
- The word menu is titled "Use QWU as" for screen readers and offers the reading's field once, with the reading.
- Keyboard up follows `visualViewport` while the focus is in the keyboard pane; App sizes itself to the visual viewport through `--rr-app-h`. Not tested on a device.
- The received text's pill reads "3 new lines" with a down chevron.
- Measured in Chromium (e2e/rtty-tx.spec.ts): a 12.6 s transmission typed partly on air came back whole through `rr73-rtty`'s receiver with no gap and no underrun; Halt silenced the output 42 ms after the tap.
