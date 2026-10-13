# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## Unreleased

- Decode rows are 32 pt and lead with the message in 16 pt proportional type, with the calling station of a CQ in bold. SNR and audio frequency follow on the right in grey: "−12 dB · 766 Hz".
- DT is in the station's details, opened by touch and hold, with its unit: "DT −0.8 s". In 0.8 the DT column ran into the frequency at values such as −0.8.
- Rows from slots older than the newest slot with decodes fade to grey text and a lighter tint.
- The next transmission shows at the top of the list as soon as it is planned, as Next with a countdown to its slot. On air it reads Sending, with a red line growing to the end of the transmission, and then Sent in its slot.
- The waterfall has a ruler with a tick every 100 Hz, a taller tick every 500 Hz and labels from 500 to 3000 Hz.
- The Tx and Rx markers span a signal's width, from its lowest to its highest tone (50 Hz in FT8, 83 Hz in FT4), with a line at each edge and a light fill. The drag label shows the lowest tone.
- The waterfall levels each frequency against its own noise floor, so the edges of the radio's passband read like the middle, and a signal 3 dB over the noise shows cyan.
- Settings › Radio and audio › Waterfall contrast sets Low, Normal or High.
- The waterfall leaves the slots RR73 transmitted in blank, where the radio's own audio showed as a band. The Tx marker stays.
- The waterfall shows no text before audio starts. After a break it shows when audio stopped.
- The bar at the bottom of Operate keeps one height while receiving, calling CQ, calling a station and in a QSO, so the list stays put. Calling CQ has its own steps: CQ, Report, R-report, RR73 and Logged.
- The Tx button shows the state: Tx off in grey, Tx on in a light blue tint, and On air in solid red with a blinking white dot, still with Reduce Motion on. The On air tag in the status line is removed.
- Halt is a red outline in every state.
- The buttons at the bottom of Operate are 36 pt high, inside 44 pt targets.

## 0.9.1 · 2026-10-13

- Settings and its screens use shorter text, with the licence as a row in About. The Relay placeholder in Settings › Logging is removed.
- Decode colours has presets with Undo: WSJT-X, with every category on, and Quiet, which colours only My call, Sent, CQ and Ending a QSO. The WSJT-X preset replaces Restore WSJT-X colours. What I sent is now Sent.

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

- Decodes take WSJT-X's colours, in its order: my call, new grid, new grid on this band, new call, new call on this band, ending a QSO, CQ and what you sent. The first category from the top that matches colours the decode.
- Ending a QSO marks a station sending RR73 or 73 to another station, as it is about to be free.
- Decodes from stations in the log on this band and mode show grey text over any colour.
- Settings › Appearance › Decode colours changes the order, turns each category on or off and sets its colour from 13 swatches or any colour. Restore WSJT-X colours puts the defaults back, with Undo.
- Decode text keeps 4.5:1 contrast on every colour in light and dark.

## 0.7.2 · 2026-10-13

- The wording on Operate, Messages, Save a slot, Spots, Settings, Radio and audio, Logging, Wavelog, Version history and the update notice now follows the style guide, as do the notes for 0.6.0 to 0.7.1. Settings › Operating is now called FT8 and FT4, as its settings apply only to those modes.

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
- RR73 sends Tx1 to Tx6 in the WSJT-X sequence and logs the QSO when it completes. Operate shows the steps, the next message and when it starts.
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

- The decoder retries weak signals with ordered-statistics decoding when the first attempt fails. On 350 recorded slots it now finds 74% of WSJT-X's decodes, up from 70%, with no false decodes in 5000 noise-only slots.

## 0.3.0 · 2026-10-12

- The decoder now makes up to 3 passes over each slot, removing each decoded signal before the next. On recorded test slots it finds 88% of WSJT-X's decodes, up from 72%, with no false decodes in 200 noise-only slots.

## 0.2.0 · 2026-10-12

- Decodes FT8 in the app: each slot's messages appear in the list about 0.1 s after the slot ends in desktop Chromium, marked as in WSJT-X. Not yet timed on an iPhone.
- Messages that contain your callsign are marked red, CQ calls green.
- The decode list stays still while you touch it and for 0.5 s after. Newer slots go in on top when you let go.
- Filter chips show all decodes, CQ calls, messages to you or the receive frequency.
- If the decoder cannot load, Operate says so and the waterfall and Save slot keep working.
- Settings shows the decoder version and how long it took to load.

## 0.1.1 · 2026-10-12

- Message packing and display now match WSJT-X 2.7 bit for bit on 303 test messages. Fixes reports from −31 to −50 dB, ARRL Field Day sections, 3DA0 and 3X callsigns, and R RR73.

## 0.1.0 · 2026-10-12

- Live waterfall of the radio audio from 0 to 3000 Hz, with UTC slot boundaries and receive and transmit frequency markers.
- UTC clock with slot progress and an input level meter on the Operate screen.
- Save any of the recent slots as a 12 kHz WAV file with a sidecar, for the decoder corpus.
- Band and mode picker. The chosen dial frequency is recorded with saved slots.
- Radio and audio settings: what the phone applied to the microphone, the real sample rate and channels, a level target, the VOX checklist, and Tune with a confirmation and a 10 second countdown.
- Audio stops are reported with the time, and Resume audio restarts capture.
- Version history in Settings, and a notice after each update.
- Works offline once added to the home screen.
