# RTTY

Choose RTTY in Change band. RTTY has no calling frequency, so Change band takes the dial in MHz or kHz and keeps it for each band. RTTY runs at 45.45 baud with a 170 Hz shift by default.

## Tuning

The waterfall shows 0 to 3000 Hz over 30 s. Lines labelled M and S mark the mark and space tones, green while receiving and red on air.

- Tap near a signal to tune to the strongest signal there.
- Drag to move the pair. The shift stays as it is.

The tuning row under the waterfall has AFC, the squelch, Rev, and the speed and shift. On the right, 5 bars show the signal from −20 to 0 dB SNR, green while the squelch is open and grey while it is closed. The speed and shift chip offers 45.45, 50 and 75 baud at 170 Hz, 45.45 baud at 425 Hz, and 50 baud at 850 Hz.

## The text

Received text runs down the screen with the newest line at the bottom. Text you sent shows in the transmit colour. Callsigns are semibold with a dotted underline, in their decode colours.

- Tap a callsign to set it as the QSO's call. The QSO strip fills in from that station's text.
- Tap another word to choose which field of the strip it fills.
- Touch and hold any word for the same menu, with Call added.

Scrolled up, the text stays where it is and a pill counts the new lines. Tap the pill to go back to the newest.

## Sending

1. Type in the text to send, or tap a macro. A macro's text goes to the queue at once.
2. Tap Tx off to start transmitting. The queue goes out character by character.
3. Tap On air to end after the queue. Tx reads Rx in 2 s until the queue is sent.

Return sends the line. Characters RTTY cannot send have a red underline. The field shows how long the queue takes to send, and a button that empties it.

With a keyboard, F1 to F12 send the macros in order.

Halt ends a transmission at once and turns Repeat CQ off. The text not yet sent stays in the field.

## The QSO strip

The strip above the text to send holds the QSO. The QSO set has the callsign, RST sent and received, name and QTH. The Contest set has the callsign, the exchange sent, such as 599 042, the exchange received, and Worked when the callsign is a dupe. Tap a field to edit it. The chevron opens the full QSO.

Log QSO, beside Tx, logs the QSO once the strip has a callsign.

## Macros

Settings › Macros holds 2 sets, QSO and Contest. Switch between them in ••• on Operate.

A macro has a Label, its Text, Return to Rx and Log QSO when sent. Fields in braces fill in from the QSO and Settings: `{CALL}`, `{NAME}`, `{QTH}`, `{RST}`, `{NR}`, `{EXCH}`, `{MYCALL}`, `{MYNAME}`, `{MYQTH}`, `{MYGRID}` and `{UTC}`. Sends now shows the text with the fields of the QSO in progress. A field with no value sends nothing.

Drag the handle to reorder macros. Swipe left to delete one, with Undo. Restore defaults puts back the shipped set.

## Repeat CQ

Repeat CQ, in •••, sends the macro labelled CQ, and sends it again after each gap. Repeat CQ gap, in Settings › RTTY, sets the gap, 3 s by default. Repeat CQ stops when text arrives in a gap, and when you type, tap a macro or tap Tx.

## Contest

Settings › RTTY › Contest holds the serial number for the Contest set.

- Contest: the contest's CONTEST_ID for the log, such as CQ-WPX-RTTY.
- Next serial: the number `{NR}` sends next.
- Serial digits: how many digits the number fills, such as 042 with 3.
- Exchange: what `{EXCH}` sends, `599 {NR}` by default.

## Settings › RTTY

- Signal: Speed, Shift, Reverse, Unshift on space and Figures (US or ITA2).
- Receive: AFC and Squelch.
- Transmit: Stop bits, Preamble, Idle (Diddle or Mark), Tail, Start each Tx with a new line, Stop idle Tx after, Watchdog and Repeat CQ gap.

Stop idle Tx after ends a transmission when the queue has been empty that long, 60 s by default. Watchdog stops Tx and Repeat CQ once you have typed nothing and tapped no control for its time, 10 min by default.
