# Making QSOs

RR73 sends each FT8 and FT4 message in its slot, fills in the reports and logs the QSO when it completes. It needs your callsign and grid in Settings and audio running.

## The transmit controls

- Tx: turns transmitting on or off. It reads On air while transmitting.
- CQ: calls CQ.
- Hunt: answers CQs one after another.
- •••: the other actions and switches.
- Halt: stops any transmission at once, turns Tx off and stops Hunt. Esc does the same on every screen.

The status line shows what is on air or goes next, with its slot and second: `Tx1 · K1ABC 9V1NE OJ11 · Odd · :15`. Its right end shows the watchdog's time left.

## Answering a CQ

1. Double-tap the station's CQ row, or a message to you, or tap Call in the station's sheet.
2. Tx1 goes out in the next slot of the other parity: `K1ABC 9V1NE OJ11`.
3. K1ABC sends your report. Tx3 answers with R and its report: `K1ABC 9V1NE R-12`.
4. K1ABC sends RR73 or RRR. The QSO goes in the log and Tx5 sends 73.

A message to you is answered from the step it has reached. Tx turns off after 73. If CQ was running with Repeat CQ on, CQ starts again.

A station that skips the report and sends an R-report gets RR73. A station that sends RR73 before your R-report has gone ends the QSO unlogged, with `K1ABC ended early · not logged`.

To call a station you have not decoded, tap Call a station in •••, type the callsign and tap Call. Tx1 goes out on your Tx frequency in the slot Transmit in sets.

A call made after its slot has started still goes out in that slot if it is no more than 4 s late in FT8 or 1.25 s in FT4. Otherwise it waits for the next slot of that parity.

## No reply

The last message repeats up to 3 times in your next slots. The call then pauses, Tx stays on and the status line says `No reply from K1ABC`. Double-tap the station to call again.

## A station that answers someone else

Calling stops when the station you call sends a report, R-report, RR73 or 73 to another station. The status line says `K1ABC answered JA1KXM` and K1ABC's rows read Lost.

Tail-end, in Settings › FT8 and FT4 and on by default, waits for K1ABC to end that QSO with RR73, RRR, 73 or a new CQ, then calls once more. After 8 slots with no end it stops with `K1ABC is still working JA1KXM`. With Tail-end off the call pauses at once.

## Calling CQ

1. Tap CQ. Tx6 goes out: `CQ 9V1NE OJ11`.
2. K1ABC calls with a grid. Tx2 sends a report: `K1ABC 9V1NE -08`.
3. K1ABC sends an R-report. Tx4 sends RR73 and the QSO goes in the log.

A caller who sends a report first gets an R-report, and one who sends an R-report first gets RR73.

CQ repeats until someone calls. Only callers in the latest decoded slot get an answer. A caller silent through 3 repeats is dropped with `No reply from K1ABC · not logged`, and the next caller or CQ follows.

- Transmit in, in •••: 1st (Even), the default, or 2nd (Odd).
- Confirm with, in Settings › FT8 and FT4: RR73 or RRR.
- Edit messages, in •••: edit Tx6 for CQ POTA or CQ DX, and the edit stays. Edits to Tx1 to Tx5 last until you call another station. Choosing a message sends it next.

## After RR73

Tx stays on for the station's next slot after your RR73 or RRR.

- A repeated R-report means the station missed your RR73. RR73 goes again, up to 3 times, and the log keeps one entry.
- 73, or silence, ends the QSO.

Stop after this QSO, or the watchdog running out, ends the QSO as soon as RR73 has gone.

## Repeat CQ

Repeat CQ, in •••, answers the next caller after each QSO from CQ, or calls CQ again when nobody called. Off, the default, Tx goes off after the QSO.

Answer order, in •••, steps through First, Strongest, Weakest, Farthest and New, where New puts stations you have never worked first. Waiting callers carry the tags Next, 2nd and 3rd.

Stop after this QSO, in •••, turns Tx off when the current QSO ends. It shows while Repeat CQ or Hunt runs.

## Hunt

Hunt calls the first CQ heard in each slot with no QSO under way, in Hunt order, until you stop it. The status line follows it: `Hunt · calling K1ABC (−12 dB) · 2 QSOs`.

- Hunt skips stations heard sending anything but CQ, dupes, and stations that ignored it in the last 10 min.
- It answers a directed CQ only when the CQ includes you. CQ POTA, CQ SOTA, CQ WWFF, CQ IOTA and CQ QRP are open to all. CQ EU and the other continents need you on that continent, CQ DX needs you on another continent from the caller, and a prefix such as CQ JA needs you in that DXCC entity. Hunt skips contest CQs such as CQ TEST and CQ FD.
- It calls a silent station 4 times, then moves on. Hunt calls, in Settings › FT8 and FT4, sets 1 to 99.
- It moves on at once when its station answers someone else.
- A station calling you comes before a station that has not answered.

Hunt order, in •••, steps through Not worked, Strongest, Newest, Farthest and New call.

- Not worked, the default: stations not worked on this band and mode first, then the strongest.
- Newest: the station whose CQs started most recently first.
- New call: stations you have never worked first.

Hunt and CQ stop each other. Stopping Hunt mid-QSO lets the QSO finish.

## Logging and ending

RR73 logs a QSO when it completes. Calling CQ, that is when your RR73 or RRR has gone after their R-report. Answering, it is when their RR73, RRR or 73 arrives after your R-report. The notice `Logged K1ABC 20m FT8 −08 / −11` shows for 10 s with Edit and Undo.

Log QSO, on the audio strip, logs the QSO as it stands if audio stops after reports have gone both ways.

End QSO, in •••, stops Tx and Hunt without logging. A QSO already in the log stays there.

## Dupes

A dupe is a station already in this device's log on the same band, mode and UTC day, in the same activation. QSOs outside an activation count only against each other, and a new activation starts with no dupes.

Repeat CQ and Hunt skip dupes. Work dupes, in ••• or Settings › FT8 and FT4, answers them after every other caller or CQ. A station you call by hand is always called.

QSOs read from Wavelog by Read Wavelog's log are never dupes. They count only for the decode colours, New and Hide worked.

## Watchdog

The watchdog stops Tx and Hunt when you have not touched the screen, clicked or pressed a key for its limit, with `Watchdog stopped Tx after 6 min`.

A QSO under way at the limit finishes first, with `Watchdog ends Tx after this QSO` and Last QSO at the status line's right end. A touch in that time restarts the count and Hunt and Repeat CQ carry on. A call nobody has answered stops at once.

In Settings › FT8 and FT4:

- Watchdog: on by default.
- Stop Tx after: the limit, 6 min by default.
- Responses refresh watchdog: each new message restarts the count. Off by default.
