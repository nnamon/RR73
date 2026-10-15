# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## 0.20.2 · 2026-10-15

- FT8 and FT4 decode weaker messages in a QSO: the decoder tries what it expects from the station you work, and calls to you, before giving up on a signal. On the bench, the replies in a QSO decode 2.7 dB lower.

## 0.20.1 · 2026-10-15

- The station detail, from touch and hold on a decode, ends with the station's SNR over its last 8 slots, gaps marked.
- When the audio stops in a QSO whose reports have gone both ways, its banner offers Log QSO beside Resume audio.
- Change band takes your own FT8 or FT4 dial for each band, such as a 60m channel. Saved slots, QSOs and the web SDR use it. An empty field goes back to the usual dial.

## 0.20.0 · 2026-10-15

- Settings › Logging backs up the log to one file, with every QSO, activation and what Wavelog holds, through the share sheet.
- Import a log restores that backup, or takes ADIF from any logger. QSOs the log holds already are skipped, and imported QSOs are not sent to Wavelog. Undo takes an import back out.

## 0.19.12 · 2026-10-15

- The FT8 and FT4 waterfall writes each decoded callsign over its signal, in the decode colour. Settings › Radio and audio turns it off.

## 0.19.11 · 2026-10-15

- Operate's New chip lists the decodes your decode colours mark as new: new DXCC entities, grids and calls, as Settings › Decode colours sets them.
- Hide worked leaves stations already in the log on this band and mode out of the list. Their messages to you stay.
- Repeat CQ can answer the weakest caller first: Answer order in ••• now offers Weakest.
- Band activity keeps the last hour of slots. Older slots appear as you scroll down, and the chip counts cover the hour.

## 0.19.10 · 2026-10-15

- Decode colours add New DXCC entity, New continent, New CQ zone and New ITU zone, each also on this band, placed by the country file. New DXCC is on, in magenta. The others start off.
<!-- lint-copy: off -->
- The WSJT-X preset turns the continent, CQ zone and DXCC colours on, as WSJT-X does.
<!-- lint-copy: on -->
- Callsigns in RTTY text take the DXCC, continent and zone colours too.

## 0.19.9 · 2026-10-15

- Hunt calls directed CQs meant for you: CQ POTA and other activities, your continent, CQ DX from another continent, and your country's prefix. It still skips contest CQs.

## 0.19.8 · 2026-10-15

- Start activation suggests POTA and SOTA references as you type them, with their names.
- Find nearby parks and summits lists the active ones near the phone, nearest first, and sets the grid.
- Their park or summit in Add QSO and Edit QSO suggests references as you type them.

## 0.19.7 · 2026-10-15

- QSP, the relay, comes with each release: binaries for x86-64 and ARM64 Linux, and the image ghcr.io/nnamon/rr73-qsp.
- QSP connects to a receiver again when it drops, after 2 s and then longer. Settings › Web SDR shows Connecting meanwhile.
- Phones on the same receiver and band share one of its channels through QSP.

## 0.19.6 · 2026-10-15

- Light is the default theme. A theme left at System changes to Light once. Light and Dark stay.
- Edit QSO puts a logged QSO into the running activation, or takes it out.
- The LoTW users switch is gone from Settings › Optional features. It marked nothing.

## 0.19.5 · 2026-10-14

- Settings › Web SDR offers only the receivers the relay lists. Receivers added by address are gone.

## 0.19.4 · 2026-10-14

- Settings › Web SDR adds a KiwiSDR or Web-888 by its address, on a relay that allows it. Each relay keeps its own list.
- When the relay refuses a web SDR session, Operate says so. It said the relay was unreachable.

## 0.19.3 · 2026-10-14

- Decode colours start with RR73's scheme, chosen to stay apart with colour blindness: your call vermillion, CQ bluish green, Sent sky blue. Colours left at the old defaults change to it. Colours you changed stay.
<!-- lint-copy: off -->
- The WSJT-X preset takes WSJT-X 2.7's own colours and switches: new grids and new calls off, CQ green, Sent yellow.
<!-- lint-copy: on -->
- Presets for Monokai, Solarized, Dracula, Nord and Gruvbox colour each category from that scheme.
- Each preset in Settings › Decode colours shows its colours.

## 0.19.2 · 2026-10-14

- The Decode colours preset with every category on is now called Full.

## 0.19.1 · 2026-10-14

- With no relay chosen, the web SDR's error points to Settings › Relay. It pointed to Settings › Web SDR, which has no relay field.
- Settings › Relay, PSK Reporter, Web SDR and WSPR, Spots and the activation form have shorter text.
- The spot list's footer reads "Updated 13:14 UTC".

## 0.19.0 · 2026-10-14

- Settings › WSPR uploads your spots to WSPRnet. Off by default. A slot without spots reports your station as listening.

## 0.18.0 · 2026-10-14

- Spots lists the stations that heard you in the last 30 min, live from PSK Reporter's MQTT feed: callsign, grid, distance, band, SNR and time. Turn it on in Settings › PSK Reporter. No relay is needed.
- PSK Reporter reports carry the time each station was decoded. They carried the slot's start, so PSK Reporter placed each report one slot early.

## 0.17.0 · 2026-10-14

- Settings › PSK Reporter reports the stations your radio decodes in FT8 and FT4, through a QSP relay. Off by default. Decodes from the practice band or a web SDR are not reported.
- QSP reports to PSK Reporter by its developer page's rules: one datagram every 5 min at most per station, each callsign once per 5 min.

## 0.16.1 · 2026-10-14

- Settings › Relay, Settings › Web SDR and the relay's error messages have new text.

## 0.16.0 · 2026-10-14

- Settings › Web SDR receives from a KiwiSDR through a QSP relay, tuned to the band's dial. Tx still goes to the radio, and Operate shows a Web SDR badge.
- QSP stamps each audio frame with UTC, so decodes from a web SDR show the DT at the receiver.
- Settings › Relay keeps the relays you add, each with its own access key. None is the default.
- QSP, the relay server, is in `crates/rr73-qsp` with a Dockerfile and a setup guide. Web SDR receive is its first service. Its API reference is at `/docs`.

## 0.15.3 · 2026-10-14

- RTTY on an iPad or a desktop has the transmit panel on the right, as FT8: the status, the QSO as a form, their station (country, distance and bearing, QSOs before) and Halt at its foot. The received text, the text to send and the macros take the left, under a waterfall a quarter of the window high.
- RTTY on an upright iPad keeps the phone's order, with Tx, Log QSO, ••• and Halt along the bottom. On a phone on its side the macros and Halt move under the waterfall on the right.
- In RTTY with a keyboard, F1 to F12 send the macros, also while you type, and ⌥T turns Tx on and off. ⌥T, ⌥C and ⌥H acted on FT8 in RTTY before. The shortcuts sheet lists the keys of the mode in use.

## 0.15.2 · 2026-10-14

- At 50% and below, Transmit next slot also leaves a receive slot after the last WSPR transmission, one on air or the beacon's next one. Tapped while the beacon transmitted, it took the slot right after.

## 0.15.1 · 2026-10-14

- At 50% and below, the WSPR beacon leaves at least one receive slot between transmissions: at 20% the gap is 2 to 8 slots, mean 5. It could send in 2 slots back to back, about 1 gap in 16 at 20%.
- Halt and Beacon on again no longer transmits in the next slot after the one Halt cut short. Transmit next slot no longer leaves the beacon's own slot right after it.
- After Halt the waterfall shows the band again at once. The rest of the slot stayed black: up to 2 min in WSPR, 15 s in FT8. A transmission that starts late shows the band before it too.

## 0.15.0 · 2026-10-14

- Spots lists POTA and DX cluster spots, newest first, while POTA spots or Cluster spots is on in Settings › Optional features. The list refreshes every minute while Spots is open and online, and offline shows the last list with its time.
- Chips choose POTA, SOTA, WWFF, IOTA or DX, FT8 and FT4 only, your bands and New only. A row reads Worked today for a station you worked on its band today, or New park, New summit, New WWFF or New IOTA for a reference not in your log.
- Go on an FT8 or FT4 spot sets its band and mode and opens the band sheet with the frequency to set the radio to. The station's rows in the decode list show its reference, and the QSO with it logs that reference as theirs.
- The practice band pauses spots: it sends nothing over the network.

## 0.14.3 · 2026-10-14

- With Repeat CQ on, a QSO is followed by a station that called in the slot just ended, or by CQ. A caller heard earlier and not since is no longer answered. The report to them repeated for up to 2 min with no reply.
- Switching the practice band to RTTY or WSPR silences its FT8 stations at once. An FT8 slot already under way played on for up to 13 s, and the RTTY receiver chased its tones, garbling JA1XYZ's first CQ. The RTTY stations now start once the receiver is ready.

## 0.14.2 · 2026-10-14

- Calling CQ with Repeat CQ on, the stations waiting read Next, 2nd and so on, or Dupe, on their latest message to you in the decode list, where a CQ row has its country. The callers panel at the top of the list, which repeated those messages, is gone.

## 0.14.1 · 2026-10-14

- The Report macro ends the transmission after its text, as every RTTY macro but Over does. It kept Tx on, sending the idle signal until the 1 min idle stop. A line typed while it goes out follows in the same over. A Report macro you have not edited is changed on update.
- A macro that needs your name, QTH or grid sends nothing while it is empty, and the status line says which to set in Settings › Station. Report went out as "NAME QTH" without them.
- WSPR's ••• menu has Power: a tap shows the 19 levels with their watts, and a choice applies at once, to a transmission waiting for its slot too. Settings › WSPR's Power now updates a waiting transmission as well.

## 0.14.0 · 2026-10-14

- RTTY is a fourth mode in the band sheet. Set the radio to 14.0830 MHz USB on 20m: the pair sits at 1585 and 1415 Hz, and QSOs log the mark frequency.
- In RTTY the band sheet takes the radio's dial, in MHz or kHz, and keeps it per band.
- Operate in RTTY shows the received text with the newest at the bottom, the QSO strip, the text to send and a row of macros, with Tx, Log QSO, ••• and Halt below.
- Tap a signal on the waterfall to tune to it, or drag the mark and space lines. The row under the waterfall holds AFC, the squelch, Rev, and speed and shift.
- Tap a callsign in the text to start a QSO: the strip fills name, QTH and report from that station's text. Tap another word to use it as name, QTH, report or number. A word that lost its FIGS offers its figures: "QWU reads 127".
- Return sends the line typed, and typing alone never transmits. On air, text goes out as it is typed, and Backspace reaches what has not gone yet.
- Macros in a QSO set and a Contest set add their text at once, with callsigns, name, QTH, report and serial number filled in. Edit them in Settings › Macros.
- Repeat CQ in ••• sends CQ again after 3 s of quiet until a station answers.
- A transmission that only idles goes off after 1 min, and the watchdog stops Tx after 10 min without a key press. Settings › RTTY sets both, or turns them off.
- RTTY QSOs log as MODE RTTY with name and QTH, and in the Contest set with serial numbers and CONTEST_ID. They go to Wavelog and ADIF as every QSO does.
- Settings › Station has Name and QTH, for macros.
- The practice band has RTTY stations: one calls CQ, one answers yours and one gives a contest exchange.

## 0.13.0 · 2026-10-14

- iPad, desktop and a phone on its side get layouts of their own, chosen by the window's size. Below 700 pt wide the phone layout stays as it is.
- On iPad and desktop, tabs in the bar at the top open Operate, Log, Spots and Settings. While Tx is on, Log, Spots and Settings show On air and Halt in that bar.
- Operate on iPad and desktop: the waterfall across a third of the height with the ruler labelled every 100 Hz, Band activity and Rx frequency side by side, and a transmit panel on the right with Tx1 to Tx6 and Halt. Upright, the controls run along the bottom.
- Band activity marks the slots you sent in with a grey Tx slot bar. Rx frequency shows decodes within 50 Hz of Rx, messages to you and your own Next, Sending and Sent rows.
- On a phone on its side, the decodes fill the left and the waterfall sits above the controls on the right.
- Log, Spots and Settings show the list and the detail side by side on iPad, desktop and a phone on its side. A QSO opens beside the list, and Save QSO enables after an edit. Settings lists its sections on the left.
- Sheets open as 540 pt form sheets with Done on iPad, desktop and a phone on its side.
- WSPR on iPad and desktop lists spots in named columns, with the sort and Save slot above them.
- Keyboard: Esc halts on every screen and closes an open sheet. Return calls the selected station, ↑ and ↓ move the selection, ⌥T, ⌥C and ⌥H turn Tx on, call CQ and hunt, B changes band, ⌥1 to ⌥3 open Operate, Log and Settings, and ? lists the shortcuts.
- With a mouse, a double-click calls a station and a right-click opens its details. The status line says Double-click to call.

## 0.12.6 · 2026-10-14

- The watchdog counts from your last touch, so Hunt and Repeat CQ stop at its limit however many QSOs they make. Responses refresh watchdog, in Settings › FT8 and FT4, restarts it with each new message as before. It starts off.
- A QSO under way when the watchdog runs out now finishes and logs, then Tx goes off. The watchdog countdown reads Last QSO meanwhile. A call nobody has answered still stops at once.
- Slots are named Even and Odd everywhere, as on the decode list's slot bars. ••• says Transmit in 1st (Even) or 2nd (Odd), and the status line "Tx6 · CQ 9V1NE OJ11 · Even · :30".
- Hunt calls, in Settings › FT8 and FT4, sets how many times Hunt calls a station that does not answer before moving on to the next CQ: 4 by default, 1 for working through CQs fastest. A station that answers gets the usual repeats.
- Calling a station in the first 2 s of a slot your CQ is on air in (1 s in FT4) replaces the CQ with the call. It waited 30 s before. Later in the slot the CQ plays out and the call goes a cycle later, because the part of the CQ already sent would weaken the call. RR73, RRR and 73 always play out.
- A reply can start up to 4.5 s into an FT8 slot and 1.75 s into an FT4 slot, where it waited a full cycle after 2 s and 1.5 s. Later than 1.5 s (FT8) or 0.5 s (FT4) past the usual start, it leaves out its first part and ends on time. It still decodes at −16 dB in FT8 and −12 dB in FT4.
- An FT4 transmission that started about 1 s late, the old limit, could not be decoded at any level. It now leaves out its first part.

## 0.12.5 · 2026-10-14

- The first step of a QSO you answer shows the grid your call sends, "OJ11", where it said Grid. Every step now shows what went out or came in.
- When the station you call answers another station, its messages to that station show a small red Lost where a CQ row has its country, for a minute after.
- A QSO logged on your RR73 ends quietly when its repeats to a caller who keeps sending the R-report run out. It showed "not logged" before.
- A tap or a touch and hold no longer selects text or opens the copy menu anywhere in the app. Text fields, the message editor and the timing report keep selection.

## 0.12.4 · 2026-10-14

- Clear decodes in ••• empties the FT8 and FT4 decode list, and Clear spots the WSPR spot list. A QSO under way, its next transmission and Hunt carry on, and new decodes list as usual.
- Every version carries its country file, Big CTY of 15 September 2026, so CQ rows name the caller's country whatever the country file's website does. Newer releases arrive with app updates.

## 0.12.3 · 2026-10-14

- CQ rows show the caller's country again. Since 0.11.1 the app shipped without its country file, because the country file's download page changed. The build now follows the new page, and when the download fails it ships the 15 September 2026 release.

## 0.12.2 · 2026-10-14

- FT8 decoding goes on after each slot's first decodes with two finer searches of what is left, and adds what they find to the slot in the list within 2 s. It now decodes 95 % of the known messages in the ft8_lib test files, up from 89 %, and 84 % on 40m recordings, up from 74 %. It decodes signals 0.9 dB weaker in steady noise and 1.6 dB weaker with fading. The sequencer, Hunt and Repeat CQ act on these decodes too.

## 0.12.1 · 2026-10-14

- WSPR spot rows show the reported power in dBm after the distance: "8558 km 23 dBm −23 dB 0 Hz". The audio frequency moves to the spot's details, and a tap still marks the trace on the waterfall.

## 0.12.0 · 2026-10-14

- WSPR is a third mode in the band sheet, beside FT8 and FT4. Set the radio to shows WSPRnet's dial for the band: 14.0956 MHz USB on 20m.
- Every band has a WSPR dial from WSPRnet's table, 60m included, and 2m has one for WSPR only.
- In WSPR, Operate lists the spots of each 2-minute slot, farthest first: callsign, grid, distance, SNR, drift and audio frequency. The header of the slot in progress says when its spots arrive.
- Sort spots by distance, SNR or callsign from ••• or Settings › WSPR.
- Tap a spot to mark its trace on the waterfall. Touch and hold it for the frequency on air, DT, bearing, power in W and how often it was heard.
- The WSPR waterfall shows 1400 to 1600 Hz over 2 slots, with a 6 Hz Tx marker. Drag or tap it to set the Tx frequency, from 1410 to 1590 Hz.
- Beacon transmits your callsign, grid and power in a share of slots set beside the Beacon button, 20% by default, starting 1 s into an even minute. The button shows the next Tx slot, then On air.
- Compound callsigns such as 9V1NE/P beacon as WSPR Type 2 and Type 3 messages in turn. Type 3 needs a 6-character grid.
- Stop beacon after turns the beacon off 1 h after Beacon on by default. Set any number of minutes, or Off, in Settings › WSPR or •••.
- ••• in WSPR holds Transmit next slot, Tune for 10 s, Save slot, Sort by and Stop beacon after. Halt ends a transmission and turns the beacon off.
- A change of mode turns the beacon off. A change of band ends a transmission on air and keeps the beacon on.
- Settings has a Modes group: FT8 and FT4 opens the settings that were on the Settings screen, and WSPR its own.
- Spots stay out of the log, ADIF files and Wavelog.

## 0.11.1 · 2026-10-14

- The dB and Hz numbers on decode rows start at one position on every row. A 4-digit frequency pushed them 2 pt left.
- CQ rows name the calling station's country before the numbers, in the short form operators use: "Australia", "Germany", "South Korea". When the row is short of room, the country ends in "…" or drops out, and the message stays whole.
- Practice band stations get callsigns of their own country. In 0.10.5 an Australian station could get a VK9 call, which belongs to Norfolk Island, and a Russian one a UA9 call, from Asiatic Russia.
- CQ tapped before audio runs shows Audio off and tries once a slot. Before, the refusals planned slot after slot until the browser ran out of stack, which left the CQ about 26 hours ahead, so it never went out.
- Decodes from a slot that audio joined partway through report their real SNR. They read up to 50 dB high before, so a QSO started from one sent the wrong report.

## 0.11.0 · 2026-10-14

- Hound mode works DXpeditions in FT8 DXpedition mode. Turn it on per band in the band sheet or •••. Operate shows FT8 Hound next to the band.
- In Hound mode, calls to the Fox go out at 1000 Hz or above. The R-report goes on the frequency the Fox sent your report on, and moves 300 Hz when repeated.
- Hound mode reads your report inside the Fox's multi-call messages and logs the QSO on its RR73, with no 73. The Fox working other Hounds does not read as a lost station.
- The status line names the stage with the Fox: Calling the Fox, Report received, Logged.
- With Hound on, the band sheet takes the DXpedition's dial frequency for the band. Set the radio to, Operate and the QSOs logged use it.
- During the R-report and its repeats the Tx marker shows where it goes, and returns to your Tx frequency after the QSO.
- Practice scenario Fox (DXpedition): a Fox works 3 Hounds a slot and answers you after a few calls.
- A multi-call message with a report below −30 dB is refused. It went out as a high report.

## 0.10.5 · 2026-10-14

- Colours follow iOS: Apple's system colours, grouped backgrounds, system greys and hairline separators, in light and dark.
- The dark theme has a true black background, with groups and sheets in dark grey.
- Secondary text, placeholders, links and errors keep 4.5:1 contrast: where Apple's colour falls short, they use its Increased Contrast value.
- Grouped lists follow iOS 18, with 10 pt corners, 44 pt rows and separators inset to the text.
- Switches are green when on and 51 by 31 pt, as in iOS.
- Halt is a red tint with red text in every state.
- Buttons alone or in a row are capsules, the buttons at the bottom of Operate included.
- Operate's top and bottom bars use the iOS bar material. The mode tag is grey, and the clock uses SF Pro.
- The selected filter in Operate is blue with white text, and the filters use 15 pt type.
- The bar at the top of Log, Spots, Settings and their screens stays in place as the screen scrolls, and takes the bar material once content passes under it.
- Sheets have 10 pt corners.
- Reload app, Clear cached copy and Send to Wavelog show their blue at reduced opacity while they cannot act.
- Hunt leaves a station alone for 10 min once it has answered other stations twice while Hunt called it. Such a station does not hear you well, and Hunt kept calling it after each new CQ.

## 0.10.4 · 2026-10-14

- Messages to your callsign lead their slot, with a solid red edge and bold text. 9V1NE matches VK3/9V1NE and 9V1NE/P.
- While calling a station or in a QSO, unrelated decodes dim to 40 % (60 % with Increase Contrast). That station's messages, messages to you, your own rows and the slot bars keep full contrast.
- Consecutive slots with no decodes share one bar with the span: "22:15:00 to 22:16:15 no decodes".

## 0.10.3 · 2026-10-13

- Hunt moves on to the next CQ as soon as the station it calls answers another station. It used to wait for that QSO to end and call once more, as Tail-end does for a call by hand.
- The frequency ruler lies over the bottom edge of the waterfall, with its ticks on the edge and the numbers above them, so the picture is 22 pt taller. The Tx and Rx markers pass behind the numbers.

## 0.10.2 · 2026-10-13

- The Logged notice and the notices about updates float above Operate's buttons. In 0.10.1 they pushed the buttons up.
- Every line in Operate's status line has one style, and its notices are shorter: "Tx set to 908 Hz", "No reply from VK2LAW", "Watchdog stopped Tx after 6 min".
- Run in ••• is now Repeat CQ. The Run tag in the status line is removed.
- Work dupes in Run, in Settings, is now Work dupes.
- Choosing a practice scenario shows its name in the status line: "Practice · Pile-up".
- While transmitting, the waterfall shows the transmitted tones in their slot over an even floor, and Tune shows its tone. Halt ends them where the audio stopped. In 0.10.1 those slots were blank.
- About in Settings has one Version history row with the version, and the reload rows. The Licence row is removed, and the Decoder row moves to Settings › Radio and audio › Timing.

## 0.10.1 · 2026-10-13

- Decode rows are 32 pt and lead with the message in 16 pt proportional type, with the calling station of a CQ in bold. SNR and audio frequency follow on the right in grey: "−12 dB · 766 Hz".
- DT is in the station's details, opened by touch and hold, with its unit: "DT −0.8 s". In 0.8 the DT column ran into the frequency at values such as −0.8.
- Rows from slots older than the newest slot with decodes fade to grey text and a lighter tint.
- The next transmission shows at the top of the list as soon as it is planned, as Next with a countdown to its slot. On air it reads Sending, with a red line growing to the end of the transmission, and then Sent in its slot.
- The waterfall has a ruler with a tick every 100 Hz, a taller tick every 500 Hz and labels from 500 to 3000 Hz.
- The Tx and Rx markers span a signal's width, from its lowest to its highest tone (50 Hz in FT8, 83 Hz in FT4), with a line at each edge and a light fill. The drag label shows the lowest tone.
- The waterfall levels each frequency against its own noise floor, so the edges of the radio's passband read like the middle, and a signal 3 dB over the noise shows cyan.
- Settings › Radio and audio › Waterfall contrast sets Low, Normal or High.
- The waterfall leaves the slots RR73 transmitted in blank, where the radio's own audio showed as a band. The Tx marker stays.
- A drag on the waterfall no longer moves the screen. In 0.9.1 a drag with a vertical movement slid Operate up by about 470 pt and left a blank area under it. Not tested on a device.
- The waterfall shows no text before audio starts. After a break it shows when audio stopped.
- The bar at the bottom of Operate keeps one height while receiving, calling CQ, calling a station and in a QSO, so the list stays put. Calling CQ has its own steps: CQ, Report, R-report, RR73 and Logged.
- The Tx button shows the state: Tx off in grey, Tx on in a light blue tint, and On air in solid red with a blinking white dot, still with Reduce Motion on. The On air tag in the status line is removed.
- Halt is a red outline in every state.
- The buttons at the bottom of Operate are 36 pt high, inside 44 pt targets.

## 0.10.0 · 2026-10-13

- Hunt, a new button in Operate, answers CQs one after another until you stop it. It calls a CQ from the slot just decoded, completes and logs the QSO, then picks the next.
- Hunt skips stations in a QSO, stations worked today on this band and mode, and for 10 min stations that did not answer it. It answers plain CQs only: CQ DX, CQ NA and other directed CQs wait for reference data.
- Hunt order in ••• picks by Not worked (on this band and mode, strongest first), Strongest, Newest, Farthest or New call. The status line reads "Hunt · calling VJ6X (−12 dB) · 2 QSOs".
- Hunt and CQ stop each other. Halt, End QSO and the watchdog stop Hunt.
- Run is a switch in Operate's •••, stored and off by default. On, CQ answers the next caller or calls CQ again after each QSO. Off, Tx turns off once the QSO ends.
- Double-tapping a station while calling CQ ends CQ until that QSO is done, and the CQ button turns off. An unanswered call from CQ used to go back to CQ after the repeats.
- When the station you call sends a report, R-report, RR73 or 73 to another station, calling stops and the bar says who it answered: "VK2LAW answered DV5CEL".
- Tail-end, in Settings › FT8 and FT4 and on by default, calls that station once more in the slot after its RR73 or 73 to the other station. One unanswered call ends it. It never calls during their QSO.
- Settings › FT8 and FT4 sets the watchdog to any number of minutes, or turns it off. The default stays 6 min.
- Practice scenario Hunt: busy band carries at least 6 CQs a slot. Stations weaker than −10 dB do not hear you.
- In the practice scenario Station works another, the station ends its QSO with RR73 or 73 and answers your next call.

## 0.9.2 · 2026-10-13

- The "Updated to" notice floats over the screen without moving it, and goes by itself after 4 s.
- Version history and the other Settings screens open at the top. Back returns to where you were.

## 0.9.1 · 2026-10-13

- Settings and its screens use shorter text, with the licence as a row in About. The Relay placeholder in Settings › Logging is removed.
- Decode colours has presets with Undo: one with every category on, and Quiet, which colours only My call, Sent, CQ and Ending a QSO. They replace the restore button. What I sent is now Sent.

## 0.9.0 · 2026-10-13

- Settings › Practice band runs a simulated FT8 and FT4 band through the decoder, for practising CQ, answering and logging without a radio or microphone. Turning it on starts the band at once, and Operate shows Practice next to the band.
- The practice band carries 8 to 15 stations a slot from −24 dB to +5 dB, or 25 to 40 with Crowded band on. Stations call CQ, CQ DX and CQ NA, work each other through every step, and some fade.
- ••• in Operate chooses a practice scenario: Random band, One caller, Pile-up, Caller goes quiet, Caller misses RR73, Station answers, Station works another, Station never answers, or CQ DX and CQ NA.
- Practice QSOs go to a practice log of their own. The log returns unchanged when practice is off. Clear practice log empties it in one tap, with Undo.
- In practice, Send to Wavelog goes to a stand-in on the phone that delivers most QSOs and refuses some as Wavelog does. RR73 sends nothing over the network while practice is on.
- Play Tx audio in Settings › Practice band turns transmissions and Tune silent while practising.

## 0.8.1 · 2026-10-13

- Receive timing follows the audio clock frame by frame. Moments when the browser delivered no audio used to shift the DT of every later decode earlier, adding up to seconds over a session. Not tested on a device.
- When the browser stops giving output timestamps, RR73 times audio from the audio clock. The timing used to drift with the audio clock, 0.6 s in 10 minutes at 1000 ppm.
- After a start or Resume audio, receive audio waits about 0.2 s until 5 clock readings agree, so one bad reading no longer moves a slot.
- RR73 corrects receive timing from the median DT of decodes at −10 dB or stronger, once 8 are in, by at most 0.08 s per slot. Transmit timing does not use this correction.
- Settings › Radio and audio › Timing shows the median DT, the receive correction, your own transmission heard back through the radio, the clock source, clock drift, capture lag, the audio gaps bridged and the clock offset around each resume. Copy timing report puts them on the clipboard as text.

## 0.8.0 · 2026-10-13

- Decodes take a colour by category, in this order: my call, new grid, new grid on this band, new call, new call on this band, ending a QSO, CQ and Sent. The first category from the top that matches colours the decode.
- Ending a QSO marks a station sending RR73 or 73 to another station, as it is about to be free.
- Decodes from stations in the log on this band and mode show grey text over any colour.
- Settings › Appearance › Decode colours changes the order, turns each category on or off and sets its colour from 13 swatches or any colour. Restore defaults puts them back, with Undo.
- Decode text keeps 4.5:1 contrast on every colour in light and dark.

## 0.7.2 · 2026-10-13

- Operate, Messages, Save a slot, Spots, Settings, Radio and audio, Logging, Wavelog, Version history, the update notice and the notes for 0.6.0 to 0.7.1 have new text. Settings › Operating is now called FT8 and FT4, as its settings apply only to those modes.

## 0.7.1 · 2026-10-13

- With Spots on, the dial frequency overlapped the slot ring at the top of Operate. It now hides when there is no room for it. Change band still shows it.

## 0.7.0 · 2026-10-13

- Operate is the main screen, and decodes fill most of it. A 393 × 852 iPhone shows 15 decode rows while receiving and 12 in a QSO, up from 5. An iPhone SE shows 12.
- A 44 pt bar at the top of Operate holds band, mode, dial frequency, the slot ring, the UTC clock and the Log and Settings buttons. Spots has a button there while it is on.
- A 2 pt line along the bottom edge of that bar shows the audio level.
- Log, Spots and Settings open over Operate, with a back link to it. The tab bar is removed. Old links still work.
- Drag along the waterfall to move Tx. The red line and its frequency label follow the finger, and lifting the finger sets Tx. A hint shows until the first drag or tap.
- A tap on the waterfall sets Tx where it lands. A drag that starts on the green line moves Rx.
- The Receive here, Transmit here and Both buttons are removed.
- Decode rows are 30 pt high in a monospaced font and show SNR, DT, Hz and the message.
- Each slot starts with a 22 pt bar that shows its time, the decode count and Even or Odd. Even slots are slate and odd slots blue.
- The summary line above the decode list is removed.
- RR73 does not decode the slots it transmits in. It had decoded its own CQ from the radio's receive audio at +45 dB and marked it red, as if addressed to you. The amber row shows what was sent.
- A bar at the bottom of Operate holds Tx on or off, CQ, Run, ••• and Halt.
- While calling or in a QSO, a status line shows the next message and its slot, such as "Tx6 · CQ 9V1NE OJ11 · 1st · :30". The watchdog shows on the same line.
- A step bar shows how far the QSO has got.
- Halt is always shown and takes one tap. It turns solid red while Tx is on.
- The ••• menu holds Edit messages, End QSO, Find clear Tx, Tune for 10 s and Stop after this QSO in Run. It also sets the answer order, the CQ slot (1st or 2nd) and Work dupes.
- In Run, the callers show at the top of the list in answering order, tagged Working, Next and 3rd.
- Every action takes effect on the first tap, including Tune, Reload app and Clear cached copy.
- Choosing a band applies it at once and leaves Tx as it was. Transmitting no longer waits for a band confirmation.
- A double-tap on a decode calls the station and turns Tx on.
- End activation and Remove Wavelog ask once, as they delete data.
- A tap on the selected decode clears the selection.

## 0.6.2 · 2026-10-13

- Updating no longer leaves RR73 blank or without its decoder.
- While an older copy of RR73 holds the log, the new version opens and shows "Close other copies of RR73 to finish updating". The update finishes when that copy closes.
- A new version takes over at the next change of screen while audio is off.
- Settings has Optional features: Activations, POTA spots, Cluster spots and LoTW users. Each is off until you turn it on.
- With Activations and both spot sources off, the Spots tab is hidden and the app has 3 tabs. Activations and QSOs already logged stay on the phone.
- Use GPS in Settings sets the grid from the phone's position. The grid has 6 characters when the fix is within 1 km. Otherwise it has 4, and RR73 shows the reason.
- RR73 stores only the grid. Use GPS in the activation form works the same way.
- Slots and transmissions stay on UTC when the browser's output timestamps disagree with its audio clock. In the WebKit test browser those timestamps gained 1 s every second, so slots drifted and no call went on air. Not tested on an iPhone.

## 0.6.1 · 2026-10-13

- Send automatically is now off by default. QSOs stay in the Log as "not sent" until you tap Send to Wavelog.
- A phone that ran 0.5.0 switches Send automatically off once. Turn it back on in Settings › Logging.
- Send to Wavelog, at the top of the Log, sends every QSO not sent, oldest first. It shows progress, such as "Sending 2 of 4", and then the result, such as "3 delivered. 1 refused: see To do."
- Send to Wavelog in Edit QSO sends that QSO.
- To do counts QSOs not sent to Wavelog.
- QSOs logged in the same second go to Wavelog in the order they were logged.
- Log, Spots and Settings put their large titles in the same place, under the same 44 pt bar.
- Add QSO and Export ADIF are icons of equal size in the accent colour, 16 pt from the edge. Export ADIF dims when there is nothing to export.
- Add QSO and Edit QSO take the date and time in 24-hour UTC, such as 2026-10-13 and 13:14:52. Their report fields open a keyboard with a minus sign.
- Station location lists mark the one in use with a checkmark.
- The Wavelog switch in Settings › Logging › Wavelog is now called Use Wavelog.
- The Logged notice leaves out signal reports that were not received.
- Log badges share one shape. Not sent is grey, delivered green and refused red.

## 0.6.0 · 2026-10-13

- RR73 transmits FT8 and FT4. Each message starts 0.5 s into its slot. Not tested with a radio.
- To answer a station, tap a decode and then Call, or double-tap the decode. Call CQ calls CQ.
- In loopback tests in desktop Chromium, CQ started 20 to 40 ms after the slot start plus 0.5 s. Halt silenced the output 35 to 42 ms after the tap. Not timed on an iPhone.
- RR73 sends Tx1 to Tx6 in the standard QSO sequence and logs the QSO when it completes. Operate shows the steps, the next message and when it starts.
- A call too late for this slot starts up to 1.5 s late in FT8 (1.0 s in FT4) or waits for the next slot. Operate says which.
- Run calls CQ and answers callers in the order you choose: first heard, strongest, farthest or new.
- Run marks stations already in the Log for this UTC day, band and mode as dupes and skips them unless Work dupes is on.
- Stop after this QSO ends Run after the current QSO.
- Touch and hold a decode for the station's details: distance, bearing, SNR and Call.
- Messages edits Tx1 to Tx6 and refuses text that FT8 and FT4 cannot encode.
- What you send appears in the decode list as amber rows. While transmitting, Operate shows a red edge and "On air" with the message.
- Each completed QSO goes to the Log and on to Wavelog and the activation files. The Logged notice offers Edit and Undo.
- While an activation runs, RR73 transmits its callsign and grid.
- The watchdog stops Tx after 6 min without a touch or a new message.
- Transmitting needs your callsign and grid in Settings, the band confirmed in Change band, and audio running.
- Tap the waterfall to set the receive or transmit frequency with Receive here, Transmit here or Both.
- Find clear Tx moves Tx to the quietest 50 Hz in the last 2 to 4 slots.
- Calling a station moves Rx to its frequency. Turn off Hold Tx frequency in Settings to move Tx as well.
- Tune transmits at the Tx frequency and shows it while tuning.
- On iOS, every tap that can start a transmission plays a 0.1 s silent clip, so output works with the ring switch on silent. Not tested on a device.

## 0.5.0 · 2026-10-13

- The Log lists every QSO on this phone by UTC day with where each copy went: Wavelog waiting, delivered, refused or changed. Search by callsign, grid or park.
- After each QSO a notice shows it with its band and reports, with Edit and Undo for 10 s. Nothing is sent before the 10 s are up.
- Add, edit and delete QSOs by hand. Delete offers Undo.
- To do lists QSOs waiting for Wavelog, refused or changed after delivery, and activation files not yet submitted. A refused QSO says why in plain words and has Fix.
- Wavelog as a destination: its address and API key, Test connection (the key's rights, the station locations and a test QSO that Wavelog does not store) and the station location. The key stays on this phone.
- QSOs go to Wavelog while RR73 is open and online, one at a time and oldest first, retrying after 30 s and then less often, up to every 30 min. Send now sends at once.
- Start activation, at the top of Spots, takes POTA, SOTA, WWFF and IOTA references, the callsign used on air, the grid (typed or from GPS) and a Wavelog station location of its own.
- While an activation runs, Spots shows it at the top: progress towards each programme's rule (POTA 10 QSOs in a UTC day, SOTA 4 stations, WWFF 44 QSOs over all activations), the time left in the UTC day, recent QSOs and QSOs per band, with End activation. Operate shows one line with the progress and the time left.
- POTA, SOTA and WWFF files for each activation, shared or downloaded from the Log, with Mark submitted. Sharing files from the home-screen app is not tested on a device.
- Export ADIF in the Log shares the QSOs it shows.
- Settings › Logging holds the destinations, Send automatically and Send edits to QSOs already sent.

## 0.4.3 · 2026-10-13

- The start sound is now a soft rising chime, E5 then A5 (659 and 880 Hz, 0.45 s), in place of the 1500 Hz beep. It still keys the radio for the keying check. The setting is now called Start chime.

## 0.4.2 · 2026-10-13

- Reload app in Settings, under About, checks for a newer version, installs it and reloads, for when the app runs from the home screen and has no reload button. Clear cached copy and reload loads the app fresh from the network. Settings and saved data stay on the phone.
- The app has 4 tabs: Operate, Log, Spots and Settings. Activations move into Spots, above the spots, and old Activate links open Spots.
- A new app icon from the RR73 mark: the slot ring around the RR73 wordmark. iOS keeps the old icon until RR73 is removed from the home screen and added again.

## 0.4.1 · 2026-10-13

- Start audio plays 1500 Hz for 0.4 s at the output level, after 1.5 s of silence. The tone stops iOS muting output while the ring switch is on silent, keys the radio's VOX, and runs the keying check. Turn it off under Start tone in Radio and audio.
- The keying check says whether receive audio dropped during the start tone or during Tune, by how much, and what to check if it did not.

## 0.4.0 · 2026-10-13

- The decoder retries weak signals with ordered-statistics decoding when the first attempt fails. On 350 recorded slots it now decodes 74% of the known messages, up from 70%, with no false decodes in 5000 noise-only slots.

## 0.3.0 · 2026-10-12

- The decoder now makes up to 3 passes over each slot, removing each decoded signal before the next. On recorded test slots it decodes 88% of the known messages, up from 72%, with no false decodes in 200 noise-only slots.

## 0.2.0 · 2026-10-12

- Decodes FT8 in the app: each slot's messages appear in the list about 0.1 s after the slot ends in desktop Chromium. Not yet timed on an iPhone.
- Messages that contain your callsign are marked red, CQ calls green.
- The decode list stays still while you touch it and for 0.5 s after. Newer slots go in on top when you let go.
- Filter chips show all decodes, CQ calls, messages to you or the receive frequency.
- If the decoder cannot load, Operate says so and the waterfall and Save slot keep working.
- Settings shows the decoder version and how long it took to load.

## 0.1.1 · 2026-10-12

- Message packing and display are now correct bit for bit on 303 test messages. Fixes reports from −31 to −50 dB, ARRL Field Day sections, 3DA0 and 3X callsigns, and R RR73.

## 0.1.0 · 2026-10-12

- Live waterfall of the radio audio from 0 to 3000 Hz, with UTC slot boundaries and receive and transmit frequency markers.
- UTC clock with slot progress and an input level meter on the Operate screen.
- Save any of the recent slots as a 12 kHz WAV file with a sidecar, for the decoder corpus.
- Band and mode picker. The chosen dial frequency is recorded with saved slots.
- Radio and audio settings: what the phone applied to the microphone, the real sample rate and channels, a level target, the VOX checklist, and Tune with a confirmation and a 10 second countdown.
- Audio stops are reported with the time, and Resume audio restarts capture.
- Version history in Settings, and a notice after each update.
- Works offline once added to the home screen.
