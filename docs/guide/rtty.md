# RTTY

Choose RTTY in Change band and type the dial in MHz or kHz. RTTY has no calling frequency, so RR73 keeps your dial for each band. The default is 45.45 baud with a 170 Hz shift.

## Tuning

The waterfall shows 0 to 3000 Hz over 30 s, with the mark and space tones marked M and S.

- Tap near a signal to tune to the strongest one there.
- Drag to move the pair. The shift stays the same.

The tuning row has AFC, the squelch, Rev, and the speed and shift chip: 45.45, 50 and 75 baud at 170 Hz, 45.45 baud at 425 Hz, and 50 baud at 850 Hz. Its 5 bars show the signal from −20 to 0 dB SNR, green while the squelch is open.

## The text

Callsigns in the received text are underlined in their decode colours.

- Tap a callsign to make it the QSO's call. The QSO strip fills in from that station's text.
- Tap another word to choose the strip field it fills.
- Touch and hold any word for the same menu, with Call added.

## Sending

1. Type the text to send, or tap a macro. A macro's text goes to the queue at once.
2. Tap Tx off to start transmitting the queue.
3. Tap On air to stop after the queue. Tx reads Rx in 2 s until the queue is sent.

Return sends the line, and F1 to F12 send the macros. A red underline marks characters RTTY cannot send.

Halt ends a transmission at once and turns Repeat CQ off. Unsent text stays in the field.

## The QSO strip

The strip above the text field holds the QSO. The QSO set has callsign, RST sent and received, name and QTH. The Contest set has callsign, exchange sent (such as 599 042), exchange received, and Worked for a dupe. Tap a field to edit it, or the chevron for the full QSO.

Log QSO, beside Tx, logs the QSO once the strip has a callsign.

## Macros

Settings › Macros holds 2 sets, QSO and Contest. Switch between them in ••• on Operate.

A macro has a Label, its Text, Return to Rx and Log QSO when sent. These fields fill in from the QSO and Settings: `{CALL}`, `{NAME}`, `{QTH}`, `{RST}`, `{NR}`, `{EXCH}`, `{MYCALL}`, `{MYNAME}`, `{MYQTH}`, `{MYGRID}` and `{UTC}`. A field with no value sends nothing. Sends now shows the text as it would go out.

Drag the handle to reorder macros and swipe left to delete one, with Undo. Restore defaults puts back the shipped set.

## Repeat CQ

Repeat CQ, in •••, sends the macro labelled CQ and repeats it after each gap. Repeat CQ gap, in Settings › RTTY, sets the gap, 3 s by default. Repeat CQ stops when text arrives in a gap, or when you type, tap a macro or tap Tx.

## Contest

In Settings › RTTY › Contest:

- Contest: the CONTEST_ID for the log, such as CQ-WPX-RTTY.
- Next serial: the number `{NR}` sends next.
- Serial digits: how many digits the number fills, such as 042 with 3.
- Exchange: what `{EXCH}` sends, `599 {NR}` by default.

## Settings › RTTY

- Signal: Speed, Shift, Reverse, Unshift on space and Figures (US or ITA2).
- Receive: AFC and Squelch.
- Transmit: Stop bits, Preamble, Idle (Diddle or Mark), Tail, Start each Tx with a new line, Stop idle Tx after, Watchdog and Repeat CQ gap.

Stop idle Tx after ends a transmission once the queue has been empty that long, 60 s by default. Watchdog stops Tx and Repeat CQ after 10 min, by default, with no typing or taps.
