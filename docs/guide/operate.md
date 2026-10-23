# Operate

Operate holds the FT8 and FT4 waterfall, the decode list and the [transmit controls](making-qsos.md).

## The waterfall

The waterfall runs from 0 to 3000 Hz, newest at the top, with a line and the UTC time at the start of each slot. The red marker is Tx and the green marker is Rx.

- Tap to set Tx.
- Drag sideways to move Tx, and lift your finger to set it. The label shows the frequency of the lowest tone.
- Start the drag on the green marker to move Rx.
- With a mouse, click sets Tx and Shift-click sets Rx.

Tx moves in 5 Hz steps and stays within 200 to 2800 Hz in FT8 and 200 to 2767 Hz in FT4. A transmission waiting for its slot takes the new frequency while more than 1.5 s remain before it starts.

Find clear Tx, in •••, moves Tx to the quietest part of the waterfall.

Callsigns on the waterfall, in Settings › Appearance, writes each decode's callsign over its signal.

## The decode list

The list keeps an hour of slots, newest first, each under a bar with its UTC start, decode count and parity. Rows end with the SNR and audio frequency, and a CQ row names the caller's country.

The list holds still while you touch it and for 0.5 s after. Scrolled down, a pill counts the new decodes. Tap it to go back to the top.

Rows unrelated to the station you call or work dim.

## Colours

Settings › Decode colours sets the colour categories. The first category that matches a decode tints its row. The default RR73 scheme marks:

- My call in the message
- New grid, and New grid on this band
- New call, and New call on this band
- Ending a QSO: RR73 or 73 to another station
- CQ in the message
- Sent
- Worked before, which greys the text of a dupe

A message to you also gets a solid red left edge and heavier text.

## Worked marks

A bar on a row's right edge means you have worked the station on this band and mode.

- Solid grey: a dupe, worked today. During an activation only its own QSOs count.
- New call colour: worked on another day. You can work it again.

## Tags

A tag replaces the country on some rows.

- Lost: the station you called answered another station.
- Next, 2nd, 3rd: stations calling you while Repeat CQ runs, in answer order.
- Dupe: a caller Repeat CQ skips.
- A reference such as K-0817: the station you tapped Go on in Spots, for 60 min.

## Selecting and calling

- Select: tap a row, and Rx moves to it. Tap again to clear. On a keyboard, use the up and down arrows.
- Call: double-tap or double-click the row. On a keyboard, press Return.
- Open the station's sheet: touch and hold, or right-click.

The station's sheet has Call, the last decode, your last 3 QSOs with the station and a chart of its signal.

Calling a station moves Rx to it. Tx stays put while Hold Tx frequency, in Settings › FT8 and FT4, is on (the default). Turn it off and Tx follows the station.

## Filters

The chips above the list filter it, each with a count.

- All: every decode.
- CQ: CQ calls.
- New: decodes a New colour category marks. It shows while one of those categories is on.
- To me: messages with your callsign.
- Rx freq: decodes within 10 Hz of Rx.
- Hide worked: leaves out dupes but keeps messages to you.
- Sort: orders each slot as messages to you, CQs, calls and grids, reports, R-reports, RR73 and RRR, 73, then the rest, each group from low to high frequency.

On an iPad or a computer the list splits into Band activity, with every decode, and Rx frequency, with decodes within 50 Hz of Rx, messages to you and your own messages.

The button at the end of the chips saves a recent slot as a recording.
