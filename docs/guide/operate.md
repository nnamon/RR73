# Operate

Operate shows FT8 and FT4 as a waterfall over the decode list, with the transmit controls at the bottom. [Making QSOs](making-qsos.md) covers the controls.

## The waterfall

The waterfall shows 0 to 3000 Hz across, newest at the top. A line marks the start of each slot, labelled with its UTC time. A slot you transmitted in shows your own signal, labelled Tx.

The red marker is Tx and the green marker is Rx. Each spans a signal from its lowest to its highest tone.

- Drag sideways to move Tx. A label shows the frequency of the lowest tone. Lift your finger to set it.
- Start the drag on the green marker to move Rx.
- Tap to set Tx where you tap.
- With a mouse, click to set Tx and Shift-click to set Rx.

Frequencies move in 5 Hz steps. Tx stays between 200 and 2800 Hz in FT8, and 200 and 2767 Hz in FT4. A transmission waiting for its slot moves to the new Tx frequency while more than 1.5 s remain before it starts.

Find clear Tx, in •••, sets Tx to the quietest part of the waterfall. The status line confirms it, such as `Tx set to 908 Hz`.

With Callsigns on the waterfall on in Settings › Appearance, each decode's callsign shows over its signal.

## The decode list

The list shows the newest slot first and keeps an hour of slots. Each slot starts with a bar that gives its UTC start, the number of decodes, and Even or Odd. Even bars are slate and odd bars are blue. A run of slots with no decodes shares one bar.

Each row shows the message, then the SNR and the audio frequency, such as −12 dB · 766 Hz. A CQ row also names the caller's country. Rows from older slots fade.

Your own transmissions are rows of their own. Next shows a countdown to its slot, Sending shows a red line that grows while it is on air, and Sent stays in its slot.

New slots wait while you touch the list, and for 0.5 s after. Scrolled down, the rows in view stay put and a pill counts the new decodes. Tap it to go back to the top.

While you call or work a station, rows unrelated to it dim.

## Colours

The first category in Settings › Decode colours that matches a decode tints its row and draws a bar on its left edge. The RR73 scheme, the default, turns on these categories:

- My call in the message
- New grid, and New grid on this band
- New call, and New call on this band
- Ending a QSO: RR73 or 73 to another station
- CQ in the message
- Sent
- Worked before, which greys the text of a dupe

A message to you also has a solid red left edge and heavier text.

## Worked marks

A bar on the right edge of a row shows that you have worked the station on this band and mode.

- Solid grey: a dupe, worked today. With an activation running, only QSOs in that activation count.
- In the New call colour: worked on another day, so you can work it again.

## Tags

Some rows carry a tag in the place of the country:

- Lost: the station you called answered another station.
- Next, 2nd, 3rd: stations calling you while you call CQ with Repeat CQ on, in the order they will be answered.
- Dupe: a caller Repeat CQ skips.
- A reference such as K-0817: the station you tapped Go on in Spots, for 60 min after.

## Selecting and calling

- Tap a row to select it. Rx moves to its frequency. Tap it again to clear the selection.
- While no QSO runs, the status line names the selected station, with its grid and distance, or its SNR.
- Double-tap a row to call the station. With a mouse, double-click.
- Touch and hold a row to open the station's sheet. With a mouse, right-click.
- On a keyboard, the up and down arrows move the selection and Return calls the selected station.

The station's sheet has Call with the time the first message starts and its slot, Even or Odd. Under it are the last decode, the message, your last 3 QSOs with the station, and a chart of its signal over its last slots.

Calling a station moves Rx to its frequency. Hold Tx frequency, in Settings › FT8 and FT4, keeps Tx where it is. It is on by default. Off, Tx moves to the station's frequency too.

## Filters

The chips above the list filter it. Each shows a count.

- All: every decode.
- CQ: CQ calls.
- New: decodes a New category of the decode colours marks. The chip shows while one of those categories is on.
- To me: messages that contain your callsign.
- Rx freq: decodes within 10 Hz of Rx.
- Hide worked: leaves out dupes. Messages to you stay.
- Sort: lists each slot in a fixed order. Messages to you come first, then CQs, calls and grids, reports, R-reports, RR73 and RRR, 73, and the rest. Each group runs from low to high frequency.

On an iPad or a computer, the list splits in 2 panes. Band activity has every decode. Rx frequency has the decodes within 50 Hz of Rx, messages to you and your own messages.

The button at the end of the chips saves a recent slot as a recording.
