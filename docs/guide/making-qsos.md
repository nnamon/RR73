# Making QSOs

RR73 sends each FT8 and FT4 message in its slot, fills in the reports and logs the QSO when it completes. Callsign and grid must be set in Settings, and audio must run.

## The transmit controls

The bar at the bottom of Operate has a status line, a row of steps, and the buttons Tx, CQ, Hunt, ••• and Halt.

- Tx shows the state. Tx off is grey, Tx on has a light tint, and On air is solid red with a blinking dot. Tap it to turn transmitting on or off.
- CQ calls CQ. It shows solid in the accent colour while CQ runs.
- Hunt answers CQs one after another. It shows solid green while Hunt runs.
- ••• holds the other actions and switches.
- Halt stops any transmission at once, turns Tx off and stops Hunt. On a keyboard, Esc does the same on every screen.

The status line says what is on air or goes next, in which slot and at which second, such as `Tx1 · K1ABC 9V1NE OJ11 · Odd · :15`. Its right end shows the time left on the watchdog, such as Watchdog 5:42.

The steps row shows how far the QSO has got. Answering a CQ, the steps are your grid, their report, your R-report, their RR73 and your 73. Calling CQ, they are CQ, your report, their R-report, your RR73 and Logged. Each step fills in with the report once it is known.

## Answering a CQ

1. Double-tap the CQ row of the station, or tap Call in its sheet.
2. Tx1 goes out in the next slot of the other parity: `K1ABC 9V1NE OJ11`.
3. K1ABC sends your report. Tx3 answers with R and its report: `K1ABC 9V1NE R-12`.
4. K1ABC sends RR73 or RRR. The QSO is logged and Tx5 sends 73.

After 73, Tx turns off. With Repeat CQ on and CQ running before the call, CQ starts again.

A station that skips the report and sends an R-report gets RR73 in reply. A station that sends RR73 before your R-report has gone ends the QSO, and it is not logged: `K1ABC ended early · not logged`.

Double-tapping a message to you answers it in the same way, from the step it has reached.

A call decided after its slot has started can still go out in that slot. It starts up to 4 s late in FT8 and 1.25 s late in FT4. Later than that it goes in the next slot of the same parity.

## No reply

With no reply, the last message repeats in the next slot of your parity, up to 3 times. Then the call pauses on its last message and the status line says `No reply from K1ABC`. Tx stays on. Double-tap the station again to call it again.

## A station that answers someone else

When the station you call sends a report, an R-report, RR73 or 73 to another station, calling stops. The status line says `K1ABC answered JA1KXM`, and K1ABC's rows read Lost.

With Tail-end on in Settings › FT8 and FT4, the default, RR73 waits for K1ABC to end that QSO with RR73, RRR, 73 or a new CQ. It then calls K1ABC once more in the next slot. After 8 slots with no end, it stops and the status line says `K1ABC is still working JA1KXM`. With Tail-end off, the call pauses at once.

## Calling CQ

1. Tap CQ. Tx6 goes out: `CQ 9V1NE OJ11`.
2. K1ABC calls with a grid. Tx2 sends a report: `K1ABC 9V1NE -08`.
3. K1ABC sends an R-report. Tx4 sends RR73, and the QSO is logged.

A caller that sends a report first gets an R-report. A caller that sends an R-report first gets RR73.

CQ repeats while nobody calls. Only stations that called in the latest decoded slot are answered. A caller who stays silent through 3 repeats is dropped, with `No reply from K1ABC · not logged`, and the next caller or CQ follows.

Transmit in, in •••, sets the slot CQ goes out in: 1st (Even), the default, or 2nd (Odd). Confirm with, in Settings › FT8 and FT4, sends RR73 or RRR.

To call CQ POTA or CQ DX, edit Tx6 in Edit messages, in •••. Tx6 keeps its text. Edits to Tx1 to Tx5 last until you call another station. Choosing a message there sends it next.

## After RR73

The QSO is logged as soon as your RR73 or RRR has gone. Tx stays on for the station's next slot, whether you called CQ or called the station.

- A repeated R-report means the station missed your RR73. RR73 goes again, up to 3 times, and the QSO stays one entry in the log.
- 73, or no message from the station, ends the QSO.

With Stop after this QSO on, or the watchdog running out, the QSO ends as soon as RR73 has gone.

## Repeat CQ

Repeat CQ, in •••, decides what follows a QSO from CQ. It is off by default.

- Off: Tx goes off after the QSO.
- On: the next station that called is answered in the next slot, or CQ goes out again when none did.

Answer order, in •••, sets which caller goes first. Tap it to step through First, Strongest, Weakest, Farthest and New. New answers stations you have never worked first. The waiting callers carry the tags Next, 2nd and 3rd in the decode list.

While Repeat CQ runs, the status line's right end adds the QSO count and rate, such as 3 QSOs · 18/h.

Stop after this QSO, in ••• while Repeat CQ or Hunt runs, turns Tx off once the QSO under way ends.

## Hunt

Tap Hunt to answer CQs one after another until you stop it. The status line follows it, such as `Hunt · calling K1ABC (−12 dB) · 2 QSOs`.

- After each slot with no QSO under way, Hunt calls the first CQ heard in that slot, in Hunt order.
- It skips stations heard sending anything other than CQ, dupes, and stations that ignored it in the last 10 min.
- It answers a directed CQ only when you are the station it asks for. CQ POTA, CQ SOTA, CQ WWFF, CQ IOTA and CQ QRP are open to all. CQ EU and the other continents need you on that continent. CQ DX needs you on another continent from the caller. A prefix such as CQ JA needs you in that DXCC entity. Contest CQs such as CQ TEST and CQ FD are skipped.
- Hunt calls a station that does not answer 4 times, then moves to the next CQ. Hunt calls, in Settings › FT8 and FT4, takes 1 to 99.
- When the station Hunt calls answers someone else, Hunt moves on at once.
- While Hunt calls a station that has not answered, a station calling you comes first.

Hunt order, in •••, steps through Not worked, Strongest, Newest, Farthest and New call. Not worked, the default, puts stations not worked on this band and mode first, then the strongest. Newest puts the station whose CQs started most recently first. New call puts stations you have never worked first.

Hunt and CQ stop each other. Stopping Hunt during a QSO lets the QSO finish, then Tx goes off.

## Logging and ending

A QSO is logged when it completes. Calling CQ, that is when your RR73 has gone after their R-report. Answering, it is when their RR73, RRR or 73 arrives after your R-report. A notice such as `Logged K1ABC 20m FT8 −08 / −11` shows for 10 s with Edit and Undo.

If audio stops after the reports have gone both ways, the audio strip offers Log QSO. It logs the QSO as it stands.

End QSO, in •••, stops Tx and Hunt and leaves the QSO unlogged. A QSO already in the log stays there.

## Dupes

A dupe is a station in the log on this device on the same band, in the same mode, on the same UTC day and in the same activation. QSOs logged outside an activation count only against each other. A new activation starts with no dupes.

Repeat CQ and Hunt skip dupes. Turn on Work dupes, in ••• or Settings › FT8 and FT4, to answer them after every other caller or CQ. A station you call by hand is always called.

QSOs that Read Wavelog's log reads from Wavelog do not count as dupes. They count for the decode colours, New and Hide worked only.

## Watchdog

The watchdog counts the time since you last touched the screen, clicked or pressed a key. At the limit Tx and Hunt stop, and the status line says `Watchdog stopped Tx after 6 min`.

A QSO under way at the limit finishes first. The status line says `Watchdog ends Tx after this QSO`, and the right end reads Last QSO. A touch in that time restarts the count, and Hunt and Repeat CQ carry on. A call nobody has answered stops at once.

Settings › FT8 and FT4 holds the watchdog's settings:

- Watchdog turns it on or off. It is on by default.
- Stop Tx after sets the limit in minutes, 6 by default.
- Responses refresh watchdog restarts the count each time a new message goes out. It is off by default.
