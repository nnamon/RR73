# RTTY

Choose RTTY in Change band and type the dial in MHz or kHz. RR73 remembers your dial for each band. Speed and shift start at 45.45 baud and 170 Hz.

![RTTY with a QSO under way with AB4SS](img/rtty.webp)

1. The mark and space pair. Tap near a signal to tune to it, or drag the pair.
2. AFC, the squelch and Rev.
3. Speed and shift.
4. Callsigns, in their decode colours. Tap one to make it the QSO's callsign.
5. The QSO strip, filled in from the station's text. Tap a field to edit it.
6. The text to send. Return sends the line.
7. Macros, which F1 to F12 also send.
8. Log QSO.

## Sending

Tap Tx off to start sending the queued text. The button then reads On air, and tapping it stops transmitting once the queue has gone. Halt ends a transmission at once and turns Repeat CQ off, and any unsent text stays in the field.

## Macros

Settings › Macros holds a QSO set and a Contest set, and ••• on Operate switches between them. A macro sends its Text with these fields filled in: `{CALL}`, `{NAME}`, `{QTH}`, `{RST}`, `{NR}`, `{EXCH}`, `{MYCALL}`, `{MYNAME}`, `{MYQTH}`, `{MYGRID}` and `{UTC}`.

## Repeat CQ

Repeat CQ, in •••, sends the macro labelled CQ again after each gap, which is 3 s by default. It stops when text arrives during a gap, or when you type, send a macro or tap Tx.

## Contest

| Setting, in Settings › RTTY › Contest | Example |
| --- | --- |
| Contest: the log's CONTEST_ID | CQ-WPX-RTTY |
| Next serial: the number `{NR}` sends next | 42 |
| Serial digits | 3 sends 042 |
| Exchange: what `{EXCH}` sends | `599 {NR}`, the default |

## Settings › RTTY

| Group | Settings |
| --- | --- |
| Signal | Speed, Shift, Reverse, Unshift on space, Figures (US or ITA2) |
| Receive | AFC, Squelch |
| Transmit | Stop bits, Preamble, Idle, Tail, Start each Tx with a new line, Stop idle Tx after (60 s), Watchdog (10 min), Repeat CQ gap |
