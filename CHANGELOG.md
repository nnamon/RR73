# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## 0.28.5 · 2026-11-13

- The desktop app says when a newer release is out and opens its page in your browser.
- Check for new versions in Settings › About turns that daily check off.

## 0.28.4 · 2026-11-13

- FT8 and FT4 decode more signals that overlap others on busy bands (about 0.4 % more decodes on 6 busy receivers).
- The decoder drops weak decodes whose locator lies far from the sender's country.

## 0.28.3 · 2026-11-13

- Guide has its own open-book icon in Settings, and Logging keeps the closed book.

## 0.28.2 · 2026-11-13

- LQ8 resolves callsign hashes from stations that send the 20-bit hash in the reference library's form.

## 0.28.1 · 2026-10-29

- POTA files write LQ8 QSOs as mode MFSK with no submode (POTA accepts LQ8 only that way).

## 0.28.0 · 2026-10-29

- New mode LQ8 in Change band, on 40m to 10m. A QSO takes 4 messages.
- Hunt, Repeat CQ and tail-end work in LQ8 as in FT8.
- In LQ8, a message that confirms several stations counts as your report and 73 when it names you.
- LQ8 free text holds about 17 characters, and longer text is refused.
- Hound, Contest exchange, Confirm with and a priori decoding hide in LQ8.
- The practice band runs LQ8 QSOs in LQ8, in every scenario except Contest exchanges and Fox.
- LQ8 QSOs log as mode DATA, submode LQ8.
- PSK Reporter spots of LQ8 decodes carry mode LQ8 (relays need this version).
- Spots of LQ8 stations show LQ8, and Go opens LQ8 on their band.
- The mode filter chip in Spots reads FT8, FT4, LQ8.

## 0.27.8 · 2026-10-24

- The guide's Operate and WSPR screenshots show live signals on the waterfall.

## 0.27.7 · 2026-10-24

- Guide is the first row of Settings.
- Until a callsign is set, Operate's empty decode list links to Getting started.
- The guide has annotated screenshots, tables and QSO ladders, and every page was rewritten around them in about a third of the words.

## 0.27.6 · 2026-10-23

- The guide, Version history and 12 on-screen messages follow the new writing style.

## 0.27.5 · 2026-10-23

- Call a station in Operate's ••• calls a callsign you type, on your Tx frequency and in the slot set by Transmit in.

## 0.27.4 · 2026-10-23

- Log rows show the contest exchanges sent and received after the reports.
- Practice scenario in Operate's ••• opens the scenarios in a sheet of their own (the list had made the menu long).

## 0.27.3 · 2026-10-23

- FT8 decodes about 1% more stations on busy bands, with fewer false decodes.

## 0.27.2 · 2026-10-23

- FT8 and FT4 decoding takes about a quarter less time, with the same decodes.

## 0.27.1 · 2026-10-22

- In the desktop app, Settings › Radio and audio › Timing chooses the time server and can turn the clock correction off.

## 0.27.0 · 2026-10-22

- Settings › About › Guide has 13 pages on using RR73, readable offline.
- Contest exchange in Settings › FT8 and FT4 links to its guide page.

## 0.26.5 · 2026-10-22

- After you send RR73 to a station you called, Tx stays on for their next slot.
- If they repeat the R-report they get RR73 again, and 73 or silence turns Tx off.

## 0.26.4 · 2026-10-22

- Settings › FT8 and FT4 › Contest exchange lists what to type for each kind of contest.

## 0.26.3 · 2026-10-22

- Custom exchange in Settings › FT8 and FT4 is renamed Contest exchange.

## 0.26.2 · 2026-10-22

- Practice band stations can be off in time and frequency, overlap each other, fade by multipath, and use compound callsigns.
- The practice band adds changing noise, band openings and tail-enders.
- 8 new practice scenarios in •••.
- The Worked stations and New ones scenarios add QSOs to the practice log only.

## 0.26.1 · 2026-10-22

- Settings › FT8 and FT4 › Contest exchange shows what goes out in each format, or what is missing.

## 0.26.0 · 2026-10-22

- Settings › FT8 and FT4 › Contest exchange sets your exchange.
- Replies follow the other station's exchange format.
- The log keeps the exchange sent and the exchange received.

## 0.25.1 · 2026-10-22

- Selecting a decode moves Rx to its frequency.
- Shift-click on the waterfall sets Rx.

## 0.25.0 · 2026-10-21

- Desktop app for Windows, macOS and Linux.
- The desktop app has rig control over the computer's own serial ports.
- The desktop app corrects slot and Tx timing against an NTP server.

## 0.24.29 · 2026-10-21

- Web SDR keeps streaming past the first 10 s from receivers on software v1.902.

## 0.24.28 · 2026-10-21

- Web SDR connects to receivers running software v1.902.

## 0.24.27 · 2026-10-21

- Web SDR connects to receivers whose audio rate is up to 1% off 12000 Hz.

## 0.24.26 · 2026-10-21

- Turning off Read Wavelog's log keeps the QSOs already read.
- Turning it back on reads only the QSOs added since.

## 0.24.25 · 2026-10-21

- WSPR spots show the reported power in watts.
- Settings › Radio and audio › Timing › Correct Tx timing moves each transmission by the clock error measured from decodes (off by default).
- A station worked on this band and mode on another day gets a right edge in the New call colour.

## 0.24.24 · 2026-10-21

- The first decoding stage finds 95% of the reference decodes in 350 slots recorded on 40m (was 93%).
- All 3 stages together find 96% (was 95%).

## 0.24.23 · 2026-10-21

- Settings › Appearance › Font › Automatic uses Segoe UI on Windows.
- Web SDR decodes when this computer's clock runs fast.

## 0.24.22 · 2026-10-21

- Settings › Decode colours › Show legend shows each row style in your colours, with its meaning.

## 0.24.21 · 2026-10-21

- Decode messages use the interface font by default.

## 0.24.20 · 2026-10-21

- Settings › Appearance › Decode messages chooses the monospace font or the interface font for decode messages (monospace by default).
- The monospace font lines up callsigns, grids and reports.
- Waterfall colours and Callsigns on the waterfall moved from Radio and audio to Settings › Appearance.

## 0.24.19 · 2026-10-21

- Settings › Appearance › Monospace sets the font for Tx messages, times and the waterfall scale: System, JetBrains Mono or Roboto Mono.

## 0.24.18 · 2026-10-21

- Settings › Logging › Wavelog › Send radio status sends the dial and mode to Wavelog on each change and every 2 min (off by default).
- Depth, in Settings › FT8 and FT4 › Decoding, can be set to Fast, which runs only the first decoding stage (Deep by default).
- A priori decoding can be turned off (on by default).
- Settings › Rig control hides Disconnect radio while the port is closed.

## 0.24.17 · 2026-10-21

- Settings › Rig control › Connection says how a KX2 connects: Digirig or KX2 cable.
- With a KX2 cable, RR73 skips the MIC BTN check and reopens the port by itself.

## 0.24.16 · 2026-10-21

- On a computer, Settings › Radio and audio › Monitor plays Tx audio on a second output, at its own level.

## 0.24.15 · 2026-10-21

- A KX2 band change answered with `?;` now sets the dial and DATA A (it had been reported as refused, with DATA A left unset).
- The IC-705 gets 400 ms to confirm PTT on, up from 300 ms.
- Rig control warns when the KX2's auto-info is on, since it can make a band change look refused.

## 0.24.14 · 2026-10-21

- The radio badge shows FIL2 or FIL3 in amber when the IC-705's filter cuts off most of the FT8 range.
- A reply from the radio that is cut short no longer spoils the next one.
- Halt sends no PTT off when RR73 isn't holding PTT and the radio reads receive.
- On the KX2, Halt no longer holds up other requests for 0.6 s.
- New setting Settings › Appearance › Font: Automatic, System or Inter.
- Font › Automatic uses Apple's system font on Apple devices and Inter elsewhere.
- Monospaced text on Windows uses Cascadia Mono or Consolas.
- When the browser keeps audio paused until a tap, the audio banner says so within 1 s and Resume audio starts it (audio had stuck at starting, with a black waterfall).
- On a computer or tablet, Operate's ••• menu opens over the waterfall (its top rows had been hidden behind it).
- Worked before greys only dupes: stations worked today on this band and mode, in the running activation.
- Hide worked hides only dupes.
- Decode rows show worked status on their right edge: solid for a dupe, light for a station worked on this band and mode on another day.

## 0.24.13 · 2026-10-21

- Operate's Sort chip orders each slot's decodes: messages to you, CQs, calls, reports, then endings.
- Within each kind, Sort goes up from the lowest audio frequency. With Sort off, decodes keep the decoder's order.
- Rows of stations calling you show the country, as CQ rows do, unless they carry a Next, Dupe or Lost tag.
- Log shows each QSO's country beside the callsign.

## 0.24.12 · 2026-10-21

- Hunt answers a station calling you while the station Hunt called hasn't answered.
- A dupe caller is answered only with Work dupes on.
- Rows read Lost only while Tx is calling that station.

## 0.24.11 · 2026-10-21

- With Repeat CQ or Hunt on, a station that sends its R-report again gets RR73 again, up to the usual repeats.
- Logging the same station, band and mode again within 10 min updates the end time of the QSO already logged (QSOs added by hand are never merged).

## 0.24.10 · 2026-10-21

- After a shifted transmission, if the IC-705 refuses the receive dial just after transmit, RR73 sends it again 0.1 s later.
- The IC-705's Split row reads a simplex answer as Off.
- Rig control ignores answers addressed to another program.
- After PTT off, rig control checks for receive every 100 ms for up to 0.5 s before it reports PTT off not confirmed (a radio slow to return to receive had turned Tx off).
- On reconnecting, RR73 tries up to 3 times to read whether the radio is still transmitting.
- Keying the IC-705 by CAT waits until USB SEND reads OFF (it had been allowed before USB SEND was read).

## 0.24.9 · 2026-10-21

- Settings › Rig control › Copy connection log includes the first 96 bytes sent to and received from the radio, in hex.

## 0.24.8 · 2026-10-16

- New DXCC entity is off by default in every decode colour scheme (turn it on in Settings › Decode colours).

## 0.24.7 · 2026-10-16

- Settings › Rig control has its own switch, off by default.
- Turning it off closes the radio's port and keys by VOX. Turning it on reopens the last port.

## 0.24.6 · 2026-10-16

- Settings › Rig control shows Disconnect radio while the radio's port is closed, so the port doesn't reopen when the radio is plugged in again.

## 0.24.5 · 2026-10-16

- When the last connection to the radio didn't complete, Settings › Rig control shows the step where it stopped.
- Settings › Rig control › Copy connection log copies the timed steps of the last connection.
- If the IC-705's USB driver refuses to set DTR and RTS low, rig control still connects when USB SEND reads OFF.
- Otherwise the port closes and Rig control asks you to set USB SEND to OFF.

## 0.24.4 · 2026-10-16

- After a connection that didn't complete, RR73 leaves the port closed until you tap Connect radio or Reconnect radio.
- New setting Settings › Rig control › Baud rate for the IC-705, from 4800 to 115200 (115200 by default, and a new rate reopens the port).

## 0.24.3 · 2026-10-16

- With Key the radio with CAT on, RR73 refuses to transmit or Tune if the audio wouldn't reach the output set in Settings › Radio and audio.
- That refusal names the output to choose.
- An output the browser refused is tried again when audio starts and when a device is plugged in or out.
- Settings › Rig control reads the IC-705's split, duplex, RIT and ΔTX (XIT) and says which to turn off (with any of them on, the radio transmits away from the logged frequency).
- Settings › Rig control shows the KX2's RIT.
- With rig control on, Operate shows a radio badge beside the band: Connected, No reply or Port closed.
- Tap the radio badge to open Rig control.
- An amber radio badge names the fault: Transmitting with no PTT from RR73, a mode other than USB-D or DATA A, or Off band.
- The band's dial shows in amber while the radio's dial isn't in use.
- Settings › Rig control › Reconnect radio reopens the radio's port without the port chooser.
- Connect radio chooses another port.
- On a phone, the Settings button at the top of Operate ends 16 pt from the screen edge, as on every other bar.
- The app's description names both setups: an iPhone with a headset-jack or USB interface, or a computer with rig control.
- Off iOS and Android, the Clock badge's screen reader label says computer.
- With the window hidden, rig control timeouts, PTT off retries and keying limits run on time (they had run up to 1 s late).
- Settings › Practice band › Play Tx audio is renamed Can key a connected radio.
- With it on and Key the radio with CAT on, practice transmissions, Tune and Test keying key the radio.
- With it off, practice plays no Tx audio and keys nothing (it had keyed PTT with no audio).

## 0.24.2 · 2026-10-16

- FT8 and FT4 decode tones up to 3200 Hz, up from 3000 Hz.
- The SNR of a station near the edge of the radio's passband reads within about 2 dB (it had read up to 5 dB high).
- The first decoding stage finds 93% of the reference decodes in 350 slots recorded on 40m (was 92%).
- All 3 stages together find 95% (was 94%).
- A first-stage decode that shows a callsign as a hash shows the full callsign when another decode in that stage carries it.

## 0.24.1 · 2026-10-16

- In Chrome and Edge on a computer, RR73 keeps receiving, decoding and transmitting while minimised, covered or in a background tab.
- On Windows the setup advice covers Chrome, Edge and Windows Settings.
- That advice covers microphone and location access, keeping the screen on, and clock sync in Settings › Time & language › Date & time.
- On a computer, Before you transmit asks you to turn system sounds off, keep the radio from being the default output and set sleep to Never.
- Off iOS and Android, RR73 says computer where it said phone.
- The level advice under Tune follows the connected radio: the ALC zone on an IC-705, 4 to 5 ALC bars on a KX2, and both with no radio connected.
- Settings › Radio and audio › Timing shows decode time per slot, for the last slot and the 95th percentile.
- Timing also counts slots skipped while the decoder was busy, and the timing report includes both.
- Resume audio finds the radio's audio input after its USB cable moves to another port (it had taken a second tap, on Start audio).
- Tune's sheet shows the radio's dial while rig control reads one.
- A key press restarts the Tx watchdog, as a tap or a click does.
- 2m has FT8 on 144.174 MHz and FT4 on 144.170 MHz.
- New band 70cm, with FT8 on 432.174 MHz and WSPR on 432.300 MHz.
- A radio on 144.174 MHz keeps RR73 in FT8 (it had switched to WSPR).
- WSPR on 2m dials 144.489 MHz, 500 Hz up from 144.4885 MHz.
- Text on Windows uses Segoe UI.

## 0.24.0 · 2026-10-16

- Settings › Logging › Wavelog › Read Wavelog's log adds the QSOs in your Wavelog log to decode colours, New and Hide worked (off by default, needs Wavelog 2.5.1 or later).
- Dupes, Hunt and Repeat CQ still count only this phone's log.

## 0.23.1 · 2026-10-16

- FT8 decodes transmissions that start up to 4.5 s late (was 2.5 s), such as a reply sent late in the slot.
- FT4 decodes transmissions up to 1.5 s late (was 1 s).

## 0.23.0 · 2026-10-16

- Settings › Rig control connects an Elecraft KX2 through a Digirig.
- RR73 reads and sets the KX2's dial and DATA A, and keys it once Key the radio with CAT is on.
- Rig control asks you to set the KX2's MIC BTN to OFF, because the Digirig's PTT reaches the MIC jack.
- Rig control shows Transmitting when the radio transmits on its own.
- On connecting, rig control sends PTT off to a radio that is still transmitting, if Key the radio with CAT is on or RR73 may have left it keyed.
- A CQ tapped right after Start audio goes out in its slot (it had waited a cycle for the audio clock).
- Halt during the short wait for late answers stops a held-back PTT on from going out after its PTT off.
- A timer that fires early during that wait leaves rig control running (it had stopped rig control for good).

## 0.22.3 · 2026-10-16

- FT8 and FT4 decoding takes about half the time, with the same decodes.
- In Safari's engine on an M4, 95% of recorded slots finish all 3 decoding stages within 0.5 s (was 1.2 s).

## 0.22.2 · 2026-10-15

- FT8 and FT4 decode signals 2 to 3.5 dB weaker.
- The first decoding stage finds 92% of the reference decodes in 350 slots recorded on 40m (was 74%).

## 0.22.1 · 2026-10-15

- New setting Settings › Rig control › Keep Tx audio centred (off by default, needs Key the radio with CAT).
- It moves the IC-705's dial in 500 Hz steps for each FT8 and FT4 transmission. The audio then sits at 1500 to 2000 Hz in the transmit passband, and the signal stays on the Tx frequency.

## 0.22.0 · 2026-10-15

- Settings › Rig control connects an Icom IC-705 by USB, in Chrome and Edge on a computer.
- RR73 reads the IC-705's dial and mode, sets them from the band sheet and logs the dial it reads.
- Key the radio with CAT keys the IC-705 for every transmission (off by default).
- Test keying checks CAT keying before you use it.
- Settings › Radio and audio › Input finds the chosen input again by its name when the browser gives it a new ID.
- A CQ or call tapped in the first 0.2 s after Start audio goes out in its slot (it had been refused with "Audio is not running.").

## 0.21.10 · 2026-10-15

- New setting Settings › Radio and audio › Waterfall colours: RR73, Fire or Grey.
- Fire and Grey get lighter in even steps from the noise up to the strongest signals.
- New theme Sun in Settings › Appearance, a light theme for direct sunlight.
- Sun has text at 7:1 contrast or more, stronger decode colours, and the waterfall's times and callsigns on dark tags.
- Settings › About › Credits shows the licences of ft8_lib and Lucide in full, with what RR73 takes from each.

## 0.21.9 · 2026-10-15

- A dupe is a station worked on the band and mode in the same UTC day and the same activation.
- In an activation at a second park, Repeat CQ and Hunt answer stations you worked at the first.
- Hunt follows Work dupes: with it on, Hunt calls dupes after the other CQs, and with it off (the default) Hunt skips them.

## 0.21.8 · 2026-10-15

- The dial reset button in the band sheet is a plain anticlockwise arrow in the accent colour, centred on the dial's digits.

## 0.21.7 · 2026-10-15

- Settings › Radio and audio › Output sends transmit audio, Tune and the start chime to a device you choose, such as a radio's USB audio.
- This works only in browsers that can choose an output.

## 0.21.6 · 2026-10-15

- The dial reset button in the band sheet is a round button the height of the digits, so a dial such as 14.0850 fits beside it on a 375 pt wide screen.

## 0.21.5 · 2026-10-15

- FT4 runs the same 2 finer searches after each slot as FT8, and decodes signals about 1.2 dB weaker.
- Decodes from those searches join the FT4 slot within 2 s.

## 0.21.4 · 2026-10-15

- The filter chips over the decode list and the RTTY macro row scroll sideways only.
- The empty decode list says decodes appear 13.5 s into each FT8 slot (6 s into FT4).
- Callsigns on the waterfall is off by default (turn it on in Settings › Radio and audio).
- The FT8, FT4 and RTTY dial fields in the band sheet have a reset button that goes back to the band's usual dial.

## 0.21.3 · 2026-10-15

- FT4 no longer gives the false decodes noise produced about twice in 10000 slots, all at −20 dB or weaker.

## 0.21.2 · 2026-10-15

- Decodes show about 1.5 s before the slot ends.
- An early pass decodes the first 13.5 s of each FT8 slot and the first 6 s of each FT4 slot.
- Rows from the early pass stay in place when the full decode arrives.

## 0.21.1 · 2026-10-15

- When decodes show the phone's clock 1 s or more off, a Clock badge beside the band and a notice say by how much.
- The Clock badge opens Radio and audio at Timing, where Phone clock shows the reading and how to set the clock.

## 0.21.0 · 2026-10-15

- New night display: the UTC clock, the next transmission and the stations heard, in dim red on black.
- The night display opens from ••• or after an idle time set in Settings › Appearance.
- A tap wakes Operate, and Halt stays on the night display while Tx is on.

## 0.20.2 · 2026-10-15

- In a QSO, FT8 and FT4 decode weaker messages by trying the messages expected next from the station you work and from stations calling you.
- On the bench, replies decode 2.7 dB lower.

## 0.20.1 · 2026-10-15

- The station details, from touch and hold on a decode, end with the station's SNR over its last 8 slots, with gaps marked.
- When audio stops in a QSO whose reports have gone both ways, the banner offers Log QSO beside Resume audio.
- Change band takes your own FT8 or FT4 dial for each band, such as a 60m channel.
- Saved slots, QSOs and the web SDR use that dial, and clearing the field goes back to the usual dial.

## 0.20.0 · 2026-10-15

- Settings › Logging backs up the log to one file through the share sheet, with every QSO, every activation and what Wavelog holds.
- Import a log restores that backup, or reads ADIF from any logger.
- Import skips QSOs the log already holds and sends no imported QSO to Wavelog.
- Undo takes an import back out.

## 0.19.12 · 2026-10-15

- The FT8 and FT4 waterfall writes each decoded callsign over its signal, in the decode colour (turn it off in Settings › Radio and audio).

## 0.19.11 · 2026-10-15

- Operate's New chip lists the decodes your decode colours mark as new DXCC entities, grids or calls, as set in Settings › Decode colours.
- Hide worked leaves out stations already logged on this band and mode, but keeps their messages to you.
- Answer order in ••• offers Weakest, so Repeat CQ can answer the weakest caller first.
- Band activity keeps the last hour of slots, and older slots appear as you scroll down.
- The chip counts cover the whole hour.

## 0.19.10 · 2026-10-15

- Decode colours add New DXCC entity, New continent, New CQ zone and New ITU zone, each with an "on this band" version, placed by the country file.
- New DXCC is on, in magenta. The other new categories start off.
<!-- lint-copy: off -->
- The WSJT-X preset turns the continent, CQ zone and DXCC colours on, as WSJT-X does.
<!-- lint-copy: on -->
- Callsigns in RTTY text take the DXCC, continent and zone colours too.

## 0.19.9 · 2026-10-15

- Hunt calls directed CQs meant for you: CQ POTA and other activities, CQ to your continent, CQ DX from another continent, and CQ to your country's prefix.
- Hunt still skips contest CQs.

## 0.19.8 · 2026-10-15

- Start activation suggests POTA and SOTA references, with their names, as you type.
- Find nearby parks and summits lists the active ones near the phone, nearest first, and sets the grid.
- Their park or summit, in Add QSO and Edit QSO, suggests references as you type.

## 0.19.7 · 2026-10-15

- QSP, the relay, comes with each release as binaries for x86-64 and ARM64 Linux and as the image ghcr.io/nnamon/rr73-qsp.
- QSP reconnects to a receiver that drops, after 2 s and then at longer intervals, and Settings › Web SDR shows Connecting until it's back.
- Phones on the same receiver and band share one of its channels through QSP.

## 0.19.6 · 2026-10-15

- Light is the default theme.
- A theme left at System changes to Light once, and Light and Dark stay as they are.
- Edit QSO puts a logged QSO into the running activation, or takes it out.
- The LoTW users switch is removed from Settings › Optional features (it marked nothing).

## 0.19.5 · 2026-10-14

- Settings › Web SDR offers only the receivers the relay lists.
- Receivers added by address are removed.

## 0.19.4 · 2026-10-14

- Settings › Web SDR adds a web SDR by its address, on a relay that allows it.
- Each relay keeps its own list of web SDRs.
- When the relay refuses a web SDR session, Operate says so (it had said the relay was unreachable).

## 0.19.3 · 2026-10-14

- Decode colours start with RR73's scheme, chosen to stay distinct with colour blindness: your call vermillion, CQ bluish green, Sent sky blue.
- Colours still at the old defaults change to the new scheme, and colours you changed stay.
<!-- lint-copy: off -->
- The WSJT-X preset takes WSJT-X 2.7's own colours and switches: new grids and new calls off, CQ green, Sent yellow.
<!-- lint-copy: on -->
- Presets for Monokai, Solarized, Dracula, Nord and Gruvbox colour each category from that scheme.
- Each preset in Settings › Decode colours shows its colours.

## 0.19.2 · 2026-10-14

- The Decode colours preset with every category on is renamed Full.

## 0.19.1 · 2026-10-14

- With no relay chosen, the web SDR's error points to Settings › Relay (it had pointed to Settings › Web SDR, which has no relay field).
- Settings › Relay, PSK Reporter, Web SDR and WSPR, Spots and the activation form have shorter text.
- The spot list's footer reads "Updated 13:14 UTC".

## 0.19.0 · 2026-10-14

- Settings › WSPR uploads your spots to WSPRnet (off by default).
- A slot with no spots reports your station as listening.

## 0.18.0 · 2026-10-14

- Spots lists the stations that heard you in the last 30 min, live from PSK Reporter's MQTT feed (Settings › PSK Reporter, no relay needed).
- Each of those spots shows callsign, grid, distance, band, SNR and time.
- PSK Reporter reports carry the time each station was decoded (they had carried the slot's start, which put each report one slot early).

## 0.17.0 · 2026-10-14

- Settings › PSK Reporter reports the stations your radio decodes in FT8 and FT4, through a QSP relay (off by default).
- Decodes from the practice band or a web SDR aren't reported.
- QSP follows the rules on PSK Reporter's developer page: at most one datagram every 5 min per station, and each callsign once per 5 min.

## 0.16.1 · 2026-10-14

- Settings › Relay, Settings › Web SDR and the relay's error messages have new text.

## 0.16.0 · 2026-10-14

- Settings › Web SDR receives from a web SDR through a QSP relay, tuned to the band's dial.
- With a web SDR, Tx still goes to the radio and Operate shows a Web SDR badge.
- QSP stamps each audio frame with UTC, so decodes from a web SDR show the DT at the receiver.
- Settings › Relay keeps the relays you add, each with its own access key. None is the default.
- QSP, the relay server, lives in `crates/rr73-qsp` with a Dockerfile, a setup guide and an API reference at `/docs`.
- Web SDR receive is QSP's first service.

## 0.15.3 · 2026-10-14

- RTTY on an iPad or a desktop has the transmit panel on the right, as FT8 does, with the status, the QSO form, their station and Halt.
- The RTTY text and macros take the left, under a waterfall a quarter of the window high.
- RTTY on an upright iPad keeps the phone's order, with Tx, Log QSO, ••• and Halt along the bottom.
- RTTY on a phone on its side puts the macros and Halt under the waterfall, on the right.
- In RTTY with a keyboard, F1 to F12 send the macros, even while you type.
- In RTTY, ⌥T turns Tx on and off (⌥T, ⌥C and ⌥H had acted on FT8).
- The shortcuts sheet lists the keys for the mode in use.

## 0.15.2 · 2026-10-14

- At 50% and below, Transmit next slot also leaves a receive slot after the last WSPR transmission (tapped while the beacon was transmitting, it had taken the very next slot).

## 0.15.1 · 2026-10-14

- At 50% and below, the WSPR beacon leaves at least 1 receive slot between transmissions (it had sent in 2 slots back to back in about 1 gap in 16).
- At 20%, 2 to 8 receive slots separate transmissions, 5 on average.
- After Halt, turning Beacon on again skips the slot after the one Halt cut short.
- Transmit next slot keeps a receive slot after the beacon's own slot.
- After Halt the waterfall shows the band again at once (the rest of the slot had stayed black, for up to 2 min in WSPR).
- A transmission that starts late shows the band before it.

## 0.15.0 · 2026-10-14

- Spots lists POTA and DX cluster spots, newest first, while POTA spots or Cluster spots is on in Settings › Optional features.
- Spots refreshes every minute while open and online. Offline, it shows the last list with its time.
- Chips in Spots filter to POTA, SOTA, WWFF, IOTA or DX, to FT8 and FT4 only, to your bands, and to New only.
- A spot reads Worked today for a station worked on its band today.
- A spot reads New park, New summit, New WWFF or New IOTA for a reference not in your log.
- Go on an FT8 or FT4 spot sets its band and mode and opens the band sheet with the frequency to set on the radio.
- After Go, the station's decode rows show its reference, and the QSO logs it as theirs.
- The practice band pauses spots, so it sends nothing over the network.

## 0.14.3 · 2026-10-14

- With Repeat CQ on, a QSO is followed by a station that called in the slot just ended, or by CQ (a caller heard earlier and not since had got its report repeated for up to 2 min).
- Switching the practice band to RTTY or WSPR silences its FT8 stations at once (an FT8 slot under way had played on for up to 13 s and garbled the first RTTY CQ).
- Practice RTTY stations start once the receiver is ready.

## 0.14.2 · 2026-10-14

- While you call CQ with Repeat CQ on, waiting stations read Next, 2nd and so on, or Dupe, on their latest message to you in the decode list.
- The callers panel at the top of the list is removed (it repeated those messages).

## 0.14.1 · 2026-10-14

- The Report macro ends the transmission after its text, as every RTTY macro except Over does (it had kept Tx on, idling until the 1 min idle stop).
- A line typed while a macro goes out follows in the same over.
- An unedited Report macro is updated along with the app.
- A macro that needs your name, QTH or grid sends nothing while that field is empty, and the status line says which to set in Settings › Station (Report had gone out as "NAME QTH").
- WSPR's ••• menu has Power, with the 19 levels and their watts.
- A Power choice applies at once, including to a transmission that is waiting.
- Power in Settings › WSPR also updates a waiting transmission.

## 0.14.0 · 2026-10-14

- RTTY is a fourth mode in the band sheet.
- On 20m, set the radio to 14.0830 MHz USB. The tone pair sits at 1585 and 1415 Hz, and QSOs log the mark frequency.
- In RTTY the band sheet takes the radio's dial in MHz or kHz, and keeps it for each band.
- Operate in RTTY shows the received text with the newest at the bottom, then the QSO strip, the text to send and a row of macros.
- Tx, Log QSO, ••• and Halt sit below the RTTY macros.
- Tap a signal on the waterfall to tune to it, or drag the mark and space lines.
- The row under the RTTY waterfall holds AFC, the squelch, Rev, and speed and shift.
- Tap a callsign in the text to start a QSO, and the strip fills in name, QTH and report from that station's text.
- Tap another word to use it as name, QTH, report or number.
- A word that lost its FIGS shift offers its figures: "QWU reads 127".
- Return sends the line you typed, and typing alone never transmits.
- On air, text goes out as you type it, and Backspace reaches what hasn't gone yet.
- Macros come in a QSO set and a Contest set, with callsigns, name, QTH, report and serial number filled in (edit them in Settings › Macros).
- A macro adds its text at once.
- Repeat CQ in ••• sends CQ again after 3 s of quiet until a station answers.
- An RTTY transmission that only idles goes off after 1 min.
- The RTTY watchdog stops Tx after 10 min without a key press. Settings › RTTY sets both limits or turns them off.
- RTTY QSOs log as MODE RTTY with name and QTH, and Contest set QSOs add serial numbers and CONTEST_ID.
- RTTY QSOs go to Wavelog and ADIF like every other QSO.
- Settings › Station has Name and QTH, for the macros.
- The practice band has RTTY stations: one calls CQ, one answers yours and one gives a contest exchange.

## 0.13.0 · 2026-10-14

- iPad, desktop and a phone on its side get layouts of their own, chosen by the window's size. Below 700 pt wide, the phone layout stays.
- On iPad and desktop, tabs in the bar at the top open Operate, Log, Spots and Settings.
- While Tx is on, Log, Spots and Settings show On air and Halt in the bar at the top.
- Operate on iPad and desktop has the waterfall across a third of the height, with the ruler labelled every 100 Hz.
- Below the waterfall, Band activity and Rx frequency sit side by side.
- A transmit panel on the right holds Tx1 to Tx6 and Halt (along the bottom when the iPad is upright).
- Band activity marks the slots you sent in with a grey Tx slot bar.
- Rx frequency shows decodes within 50 Hz of Rx, messages to you, and your own Next, Sending and Sent rows.
- On a phone on its side, the decodes fill the left and the waterfall sits above the controls on the right.
- Log, Spots and Settings show the list and the detail side by side on iPad, desktop and a phone on its side.
- Save QSO becomes active after an edit.
- On iPad, desktop and a phone on its side, sheets open as 540 pt form sheets with Done.
- WSPR on iPad and desktop lists spots in named columns, with the sort and Save slot above them.
- Keyboard shortcuts: Esc halts on every screen and closes an open sheet.
- Return calls the selected station, and ↑ and ↓ move the selection.
- ⌥T turns Tx on, ⌥C calls CQ and ⌥H starts Hunt.
- B changes band, ⌥1 to ⌥3 open Operate, Log and Settings, and ? lists the shortcuts.
- With a mouse, a double-click calls a station and a right-click opens its details.

## 0.12.6 · 2026-10-14

- The watchdog counts from your last touch, so Hunt and Repeat CQ stop at its limit however many QSOs they make.
- New setting Responses refresh watchdog, in Settings › FT8 and FT4, restarts the count with each new message (off by default).
- A QSO under way when the watchdog runs out finishes and logs before Tx goes off, and the countdown reads Last QSO.
- A call nobody has answered still stops at once when the watchdog runs out.
- Slots are named Even and Odd everywhere, as on the decode list's slot bars.
- ••• says Transmit in 1st (Even) or 2nd (Odd), and the status line reads "Tx6 · CQ 9V1NE OJ11 · Even · :30".
- New setting Hunt calls, in Settings › FT8 and FT4, sets how many times Hunt calls a silent station before the next CQ (4 by default).
- A station that answers Hunt gets the usual repeats.
- Calling a station in the first 2 s of your CQ's slot (1 s in FT4) replaces the CQ with the call (it had waited 30 s).
- Later in the slot the CQ plays out and the call goes a cycle later (the part of the CQ already sent would weaken the call).
- A reply can start up to 4.5 s into an FT8 slot and 1.75 s into an FT4 slot (was 2 s and 1.5 s).
- A late reply leaves out its first part and ends on time, and still decodes at −16 dB in FT8 and −12 dB in FT4.
- An FT4 transmission that starts about 1 s late leaves out its first part (at the old limit it couldn't be decoded at any level).

## 0.12.5 · 2026-10-14

- The first step of a QSO you answer shows the grid your call sends, such as "OJ11".
- Every QSO step shows what went out or came in.
- When the station you call answers another station, its messages to that station show a small red Lost for a minute, where a CQ row has its country.
- A QSO logged on your RR73 ends quietly when the repeats to a caller who keeps sending the R-report run out (it had shown "not logged").
- A tap or a touch and hold doesn't select text or open the copy menu, except in text fields, the message editor and the timing report.

## 0.12.4 · 2026-10-14

- Clear decodes in ••• empties the FT8 and FT4 decode list, and Clear spots empties the WSPR spot list.
- A QSO under way, its next transmission and Hunt carry on after a clear.
- Every version carries its own country file (Big CTY of 15 September 2026), so CQ rows name the country even when the file's website is down.
- App updates bring newer country file releases.

## 0.12.3 · 2026-10-14

- CQ rows show the caller's country again (from 0.11.1 the app had shipped without its country file, after the file's download page changed).

## 0.12.2 · 2026-10-14

- FT8 runs 2 finer searches of what is left after each slot's first decodes, and adds what they find within 2 s.
- FT8 now finds 95% of the known messages in the reference test files (was 89%) and 84% in 40m recordings (was 74%).
- FT8 decodes 0.9 dB weaker in steady noise and 1.6 dB weaker with fading.

## 0.12.1 · 2026-10-14

- WSPR spot rows show the reported power in dBm after the distance, such as "8558 km 23 dBm −23 dB 0 Hz".
- The spot's audio frequency moves to its details.

## 0.12.0 · 2026-10-14

- WSPR is a third mode in the band sheet, beside FT8 and FT4.
- In WSPR, Set the radio to shows WSPRnet's dial for the band, such as 14.0956 MHz USB on 20m.
- Every band has a WSPR dial from WSPRnet's table, 60m included, and 2m has one for WSPR only.
- In WSPR, Operate lists the spots of each 2 min slot, farthest first, with callsign, grid, distance, SNR, drift and audio frequency.
- The header of the slot in progress says when its spots arrive.
- Sort spots by distance, SNR or callsign from ••• or Settings › WSPR.
- Tap a WSPR spot to mark its trace on the waterfall.
- Touch and hold a WSPR spot for the frequency on air, DT, bearing, power in W and how often it was heard.
- The WSPR waterfall shows 1400 to 1600 Hz over 2 slots, with a 6 Hz Tx marker.
- Drag or tap on the WSPR waterfall to set the Tx frequency, from 1410 to 1590 Hz.
- Beacon transmits your callsign, grid and power in a share of slots set beside the Beacon button (20% by default).
- Each beacon transmission starts 1 s into an even minute, and the button shows the next Tx slot, then On air.
- Compound callsigns such as 9V1NE/P beacon as WSPR Type 2 and Type 3 messages in turn (Type 3 needs a 6-character grid).
- Stop beacon after turns the beacon off 1 h after Beacon on by default.
- Set Stop beacon after to any number of minutes, or Off, in Settings › WSPR or •••.
- ••• in WSPR holds Transmit next slot, Tune for 10 s, Save slot, Sort by and Stop beacon after.
- Halt in WSPR ends a transmission and turns the beacon off.
- Changing mode turns the beacon off.
- Changing band ends a transmission on air and keeps the beacon on.
- Settings has a Modes group. FT8 and FT4 opens the settings that were on the Settings screen, and WSPR opens its own.
- Spots stay out of the log, ADIF files and Wavelog.

## 0.11.1 · 2026-10-14

- The dB and Hz numbers on decode rows line up on every row (a 4-digit frequency had pushed them 2 pt left).
- CQ rows name the calling station's country before the numbers, in the short form operators use, such as "South Korea".
- When room is short, the country ends in "…" or drops out, and the message stays whole.
- Practice band stations get callsigns of their own country (in 0.10.5 an Australian station could get a VK9 call, which belongs to Norfolk Island).
- A CQ tapped before audio runs shows Audio off and tries once a slot (the refusals had scheduled the CQ about 26 hours ahead, so it never went out).
- Decodes from a slot that audio joined partway through report their real SNR (they had read up to 50 dB high, so a QSO started from one sent the wrong report).

## 0.11.0 · 2026-10-14

- Hound mode works FT8 DXpeditions.
- Turn on Hound for each band in the band sheet or •••, and Operate shows FT8 Hound next to the band.
- In Hound mode, calls to the Fox go out at 1000 Hz or above.
- The R-report goes on the frequency the Fox sent your report on, and moves 300 Hz when repeated.
- Hound mode reads your report inside the Fox's multi-call messages and logs the QSO on the Fox's RR73, with no 73.
- The Fox working other Hounds doesn't count as a lost station.
- The status line names the stage with the Fox: Calling the Fox, Report received, Logged.
- With Hound on, the band sheet takes the DXpedition's dial frequency for the band, which Set the radio to, Operate and logged QSOs use.
- During the R-report and its repeats, the Tx marker shows where the report goes, and it returns to your Tx frequency after the QSO.
- New practice scenario Fox (DXpedition): a Fox works 3 Hounds a slot and answers you after a few calls.
- A multi-call message with a report below −30 dB is refused (it had gone out as a high report).

## 0.10.5 · 2026-10-14

- Colours follow iOS: Apple's system colours, grouped backgrounds, system greys and hairline separators, in light and dark.
- The dark theme has a true black background, with groups and sheets in dark grey.
- Secondary text, placeholders, links and errors keep 4.5:1 contrast, using Apple's Increased Contrast value where its standard colour falls short.
- Grouped lists follow iOS 18, with 10 pt corners, 44 pt rows and separators inset to the text.
- Switches are green when on and 51 by 31 pt, as in iOS.
- Halt is a red tint with red text in every state.
- Buttons, alone or in a row, are capsules, including the buttons at the bottom of Operate.
- Operate's bars use the iOS bar material, the mode tag is grey, and the clock uses SF Pro.
- The selected filter in Operate is blue with white text, and the filters use 15 pt type.
- The bar at the top of Log, Spots, Settings and their screens stays put as the screen scrolls, and takes the bar material once content passes under it.
- Sheets have 10 pt corners.
- Reload app, Clear cached copy and Send to Wavelog show their blue at reduced opacity while they can't act.
- Hunt leaves a station alone for 10 min once it has answered other stations twice while Hunt called it (it isn't hearing you).

## 0.10.4 · 2026-10-14

- Messages to your callsign lead their slot, with a solid red edge and bold text.
- 9V1NE matches VK3/9V1NE and 9V1NE/P.
- While you call a station or work one, unrelated decodes dim to 40% (60% with Increase Contrast).
- Consecutive slots with no decodes share one bar showing the span: "22:15:00 to 22:16:15 no decodes".

## 0.10.3 · 2026-10-13

- Hunt moves on to the next CQ as soon as the station it calls answers another station (it had waited for that QSO to end and called once more).
- The frequency ruler sits over the bottom edge of the waterfall, which makes the picture 22 pt taller.

## 0.10.2 · 2026-10-13

- The Logged notice and the update notices float above Operate's buttons (in 0.10.1 they pushed the buttons up).
- Every line in Operate's status line has one style, and its notices are shorter: "Tx set to 908 Hz", "No reply from AB4SS", "Watchdog stopped Tx after 6 min".
- Run in ••• is renamed Repeat CQ, and the Run tag in the status line is removed.
- Work dupes in Run, in Settings, is renamed Work dupes.
- Choosing a practice scenario shows its name in the status line: "Practice · Pile-up".
- While transmitting, the waterfall shows the transmitted tones in their slot, and Tune shows its tone.
- Halt ends the tones on the waterfall where the audio stopped.
- About in Settings has one Version history row with the version, plus the reload rows.
- The Licence row is removed from About, and the Decoder row moves to Settings › Radio and audio › Timing.

## 0.10.1 · 2026-10-13

- Decode rows are 32 pt and lead with the message in 16 pt proportional type, with the calling station of a CQ in bold.
- SNR and audio frequency sit on the right of each row in grey: "−12 dB · 766 Hz".
- DT moves to the station's details, opened by touch and hold, with its unit: "DT −0.8 s" (in 0.8 the DT column ran into the frequency).
- Rows from slots older than the newest slot with decodes fade to grey text and a lighter tint.
- The next transmission shows at the top of the list as Next with a countdown, then Sending with a red line growing to its end, then Sent in its slot.
- The waterfall has a ruler with a tick every 100 Hz, a taller tick every 500 Hz and labels from 500 to 3000 Hz.
- The Tx and Rx markers span a signal's width from its lowest to its highest tone (50 Hz in FT8, 83 Hz in FT4), and the drag label shows the lowest tone.
- The waterfall levels each frequency against its own noise floor, so the edges of the radio's passband read like the middle.
- A signal 3 dB over the noise shows cyan on the waterfall.
- New setting Settings › Radio and audio › Waterfall contrast: Low, Normal or High.
- The waterfall leaves the slots RR73 transmitted in blank (the radio's own audio had shown as a band).
- A drag on the waterfall leaves the screen in place (in 0.9.1 a vertical drag slid Operate up by about 470 pt; not tested on a device).
- The waterfall shows no text before audio starts, and after a break it shows when audio stopped.
- The bar at the bottom of Operate keeps one height in every state, so the list stays put.
- Calling CQ has its own steps: CQ, Report, R-report, RR73 and Logged.
- The Tx button shows the state: Tx off in grey, Tx on in a light blue tint, and On air in solid red with a blinking white dot, also with Reduce Motion on.
- The On air tag in the status line is removed.
- Halt is a red outline in every state.
- The buttons at the bottom of Operate are 36 pt high, inside 44 pt targets.

## 0.10.0 · 2026-10-13

- New Hunt button in Operate answers CQs one after another until you stop it, logging each QSO.
- Hunt skips stations in a QSO, stations worked today on this band and mode, and, for 10 min, stations that didn't answer it.
- Hunt answers plain CQs only, until reference data covers directed CQs.
- Hunt order in ••• picks by Not worked (on this band and mode, strongest first), Strongest, Newest, Farthest or New call.
- During Hunt the status line reads "Hunt · calling 9V1DE (−12 dB) · 2 QSOs".
- Hunt and CQ stop each other, and Halt, End QSO and the watchdog stop Hunt.
- Run is a switch in Operate's •••, remembered and off by default.
- With Run on, CQ answers the next caller or calls CQ again after each QSO. With it off, Tx turns off once the QSO ends.
- Double-tapping a station while calling CQ ends CQ until that QSO is done (an unanswered call had gone back to CQ after the repeats).
- When the station you call sends a report, R-report, RR73 or 73 to another station, calling stops and the bar says who it answered: "AB4SS answered OE3OGC".
- Tail-end, in Settings › FT8 and FT4 and on by default, calls a station once more in the slot after its RR73 or 73 to the other station, never during their QSO.
- If that tail-end call goes unanswered, tail-end gives up.
- Settings › FT8 and FT4 sets the watchdog to any number of minutes, or off (6 min by default).
- The practice scenario Hunt: busy band carries at least 6 CQs a slot, and stations weaker than −10 dB don't hear you.
- In the practice scenario Station works another, the station ends its QSO with RR73 or 73 and answers your next call.

## 0.9.2 · 2026-10-13

- The "Updated to" notice floats over the screen without moving it, and goes by itself after 4 s.
- Version history and the other Settings screens open at the top, and Back returns to where you were.

## 0.9.1 · 2026-10-13

- Settings and its screens use shorter text, with the licence as a row in About.
- The Relay placeholder in Settings › Logging is removed.
- Decode colours has presets with Undo in place of the restore button: one with every category on, and Quiet.
- Quiet colours only My call, Sent, CQ and Ending a QSO.
- What I sent is renamed Sent.

## 0.9.0 · 2026-10-13

- New practice band in Settings › Practice band: a simulated FT8 and FT4 band, run through the decoder, for practising CQ, answering and logging without a radio.
- Turning the practice band on starts it, and Operate shows Practice next to the band.
- The practice band carries 8 to 15 stations a slot from −24 to +5 dB, or 25 to 40 with Crowded band on.
- Practice stations call CQ, CQ DX and CQ NA, and work each other through every step.
- ••• in Operate chooses a practice scenario: Random band, One caller, Pile-up, Caller goes quiet, Caller misses RR73, Station answers, Station works another, Station never answers, or CQ DX and CQ NA.
- Practice QSOs go to a practice log of their own, and the real log comes back unchanged when practice is off.
- Clear practice log empties the practice log in 1 tap, with Undo.
- In practice, Send to Wavelog goes to a stand-in on the phone that refuses some QSOs as Wavelog does.
- In practice, RR73 sends nothing over the network.
- Play Tx audio in Settings › Practice band silences transmissions and Tune while practising.

## 0.8.1 · 2026-10-13

- Receive timing follows the audio clock frame by frame (gaps in the browser's audio had shifted the DT of every later decode, by up to seconds over a session; not tested on a device).
- When the browser stops giving output timestamps, RR73 times audio from the audio clock (timing had drifted 0.6 s in 10 min at 1000 ppm).
- After Start audio or Resume audio, receive audio waits about 0.2 s for 5 clock readings to agree, so 1 bad reading can't move a slot.
- Once 8 decodes at −10 dB or stronger are in, RR73 corrects receive timing from their median DT, by at most 0.08 s per slot.
- Transmit timing doesn't use that correction.
- Settings › Radio and audio › Timing shows the median DT, the receive correction and your own transmission heard back.
- Timing also shows the clock source, clock drift, capture lag, audio gaps and the clock offset around each resume.
- Copy timing report copies the timing to the clipboard as text.

## 0.8.0 · 2026-10-13

- Decodes take a colour by category, checked in this order: my call, new grid, new grid on this band, new call, new call on this band, ending a QSO, CQ and Sent.
- The first category that matches colours the decode.
- Ending a QSO marks a station sending RR73 or 73 to another station, which will soon be free to work.
- Decodes from stations in the log on this band and mode show grey text over any colour.
- Settings › Appearance › Decode colours changes the order and turns each category on or off.
- Each category's colour comes from 13 swatches or any colour you pick.
- Restore defaults puts the colours back, with Undo.
- Decode text keeps 4.5:1 contrast on every colour, in light and dark.

## 0.7.2 · 2026-10-13

- Operate, Messages, Save a slot, Spots, Settings, Radio and audio, Logging, Wavelog, Version history, the update notice and the notes for 0.6.0 to 0.7.1 have new text.
- Settings › Operating is renamed FT8 and FT4, since its settings apply only to those modes.

## 0.7.1 · 2026-10-13

- With Spots on, the dial frequency hides when there's no room at the top of Operate (it had overlapped the slot ring; Change band still shows it).

## 0.7.0 · 2026-10-13

- Operate is the main screen, and decodes fill most of it.
- A 393 × 852 iPhone shows 15 decode rows while receiving and 12 in a QSO (was 5), and an iPhone SE shows 12.
- A 44 pt bar at the top of Operate holds band, mode, dial frequency, the slot ring, the UTC clock and the Log and Settings buttons, plus Spots while it is on.
- A 2 pt line along the bottom edge of that bar shows the audio level.
- Log, Spots and Settings open over Operate with a back link to it, and the tab bar is removed (old links still work).
- Drag along the waterfall to move Tx, and lift your finger to set it. A hint shows until the first drag or tap.
- A tap on the waterfall sets Tx where it lands.
- A drag that starts on the green line moves Rx.
- The Receive here, Transmit here and Both buttons are removed.
- Decode rows are 30 pt high in a monospaced font and show SNR, DT, Hz and the message.
- Each slot starts with a 22 pt bar with its time, the decode count and Even (slate) or Odd (blue).
- The summary line above the decode list is removed.
- RR73 doesn't decode the slots it transmits in (it had decoded its own CQ from the radio's receive audio at +45 dB and marked it as addressed to you).
- The amber row shows what was sent.
- A bar at the bottom of Operate holds Tx on or off, CQ, Run, ••• and Halt.
- While calling or in a QSO, a status line shows the next message and its slot, such as "Tx6 · CQ 9V1NE OJ11 · 1st · :30", and the watchdog.
- A step bar shows how far the QSO has got.
- Halt is always shown, takes 1 tap and turns solid red while Tx is on.
- The ••• menu holds Edit messages, End QSO, Find clear Tx, Tune for 10 s and, in Run, Stop after this QSO.
- ••• also sets the answer order, the CQ slot (1st or 2nd) and Work dupes.
- In Run, the callers show at the top of the list in answering order, tagged Working, Next and 3rd.
- Every action takes effect on the first tap, including Tune, Reload app and Clear cached copy.
- Choosing a band applies it at once and leaves Tx as it was, with no band confirmation before transmitting.
- A double-tap on a decode calls the station and turns Tx on.
- End activation and Remove Wavelog ask once, since they delete data.
- A tap on the selected decode clears the selection.

## 0.6.2 · 2026-10-13

- Updating keeps RR73's screen and decoder working (an update could leave the app blank or without its decoder).
- While an older copy of RR73 holds the log, the new version shows "Close other copies of RR73 to finish updating" and finishes when that copy closes.
- A new version takes over at the next change of screen while audio is off.
- Settings has Optional features: Activations, POTA spots, Cluster spots and LoTW users, each off until you turn it on.
- With Activations and both spot sources off, the Spots tab is hidden and the app has 3 tabs. Activations and QSOs already logged stay on the phone.
- Use GPS in Settings sets the grid from the phone's position: 6 characters with a fix within 1 km, otherwise 4 characters and the reason.
- RR73 stores only the grid, and Use GPS in the activation form works the same way.
- Slots and transmissions stay on UTC when the browser's output timestamps disagree with its audio clock (in the WebKit test browser they had gained 1 s every second and no call went on air; not tested on an iPhone).

## 0.6.1 · 2026-10-13

- Send automatically is off by default, so QSOs stay in the Log as "not sent" until you tap Send to Wavelog.
- A phone that ran 0.5.0 switches Send automatically off once (turn it back on in Settings › Logging).
- Send to Wavelog, at the top of the Log, sends every QSO not yet sent, oldest first, showing progress such as "Sending 2 of 4" and then the result.
- Send to Wavelog in Edit QSO sends that QSO.
- To do counts QSOs not sent to Wavelog.
- QSOs logged in the same second go to Wavelog in the order they were logged.
- Log, Spots and Settings put their large titles in the same place, under the same 44 pt bar.
- Add QSO and Export ADIF are icons of equal size in the accent colour, 16 pt from the edge.
- Export ADIF dims when there's nothing to export.
- Add QSO and Edit QSO take the date and time in 24-hour UTC, such as 2026-10-13 and 13:14:52.
- Their report fields open a keyboard with a minus sign.
- Station location lists mark the one in use with a checkmark.
- The Wavelog switch in Settings › Logging › Wavelog is renamed Use Wavelog.
- The Logged notice leaves out signal reports that weren't received.
- Log badges share one shape: Not sent in grey, delivered in green, refused in red.

## 0.6.0 · 2026-10-13

- RR73 transmits FT8 and FT4, each message starting 0.5 s into its slot (not tested with a radio).
- To answer a station, tap a decode and then Call, or double-tap the decode. Call CQ calls CQ.
- In loopback tests in desktop Chromium, CQ started 20 to 40 ms after the slot start plus 0.5 s, and Halt silenced the output 35 to 42 ms after the tap (not timed on an iPhone).
- RR73 sends Tx1 to Tx6 in the standard QSO sequence and logs the QSO when it completes.
- Operate shows the QSO's steps, the next message and when it starts.
- A call too late for this slot starts up to 1.5 s late in FT8 (1.0 s in FT4) or waits for the next slot, and Operate says which.
- Run calls CQ and answers callers in the order you choose: first heard, strongest, farthest or new.
- Run marks stations already in the Log for this UTC day, band and mode as dupes, and skips them unless Work dupes is on.
- Stop after this QSO ends Run after the current QSO.
- Touch and hold a decode for the station's details: distance, bearing, SNR and Call.
- Messages edits Tx1 to Tx6 and refuses text that FT8 and FT4 can't encode.
- What you send appears in the decode list as amber rows.
- While transmitting, Operate shows a red edge and "On air" with the message.
- Each completed QSO goes to the Log and on to Wavelog and the activation files.
- The Logged notice offers Edit and Undo.
- While an activation runs, RR73 transmits its callsign and grid.
- The watchdog stops Tx after 6 min without a touch or a new message.
- Transmitting needs your callsign and grid in Settings, the band confirmed in Change band, and audio running.
- Tap the waterfall to set the receive or transmit frequency with Receive here, Transmit here or Both.
- Find clear Tx moves Tx to the quietest 50 Hz in the last 2 to 4 slots.
- Calling a station moves Rx to its frequency. Turn off Hold Tx frequency in Settings to move Tx as well.
- Tune transmits at the Tx frequency and shows the frequency while tuning.
- On iOS, every tap that can start a transmission plays a 0.1 s silent clip, so output works with the ring switch on silent (not tested on a device).

## 0.5.0 · 2026-10-13

- The Log lists every QSO on this phone by UTC day, with where each copy went: Wavelog waiting, delivered, refused or changed.
- Log search finds QSOs by callsign, grid or park.
- After each QSO a notice shows it with its band and reports, with Edit and Undo for 10 s.
- Nothing is sent before those 10 s are up.
- Add, edit and delete QSOs by hand (Delete offers Undo).
- To do lists QSOs waiting for Wavelog, refused or changed after delivery, and activation files not yet submitted.
- A refused QSO says why in plain words and has Fix.
- New destination Wavelog, set up with its address, API key and station location.
- Test connection shows the key's rights and the station locations, and sends a test QSO that Wavelog doesn't store.
- QSOs go to Wavelog one at a time, oldest first, while RR73 is open and online.
- A failed send retries after 30 s, then less often, up to every 30 min.
- Send now sends at once.
- Start activation, at the top of Spots, takes POTA, SOTA, WWFF and IOTA references, the callsign on air, the grid (typed or from GPS) and a Wavelog station location of its own.
- While an activation runs, Spots shows its progress towards each programme's target: POTA 10 QSOs in a UTC day, SOTA 4 stations, WWFF 44 QSOs over all activations.
- The activation also shows the time left in the UTC day, recent QSOs, QSOs per band and End activation.
- Operate shows 1 line with the activation's progress and the time left.
- POTA, SOTA and WWFF files for each activation, shared or downloaded from the Log, with Mark submitted (sharing from the Home Screen app not tested on a device).
- Export ADIF in the Log shares the QSOs it shows.
- Settings › Logging holds the destinations, Send automatically and Send edits to QSOs already sent.

## 0.4.3 · 2026-10-13

- The start sound is a soft rising chime, E5 then A5 (659 and 880 Hz, 0.45 s), in place of the 1500 Hz beep.
- The chime still keys the radio for the keying check.
- The start sound setting is renamed Start chime.

## 0.4.2 · 2026-10-13

- Reload app, in Settings › About, checks for a newer version, installs it and reloads (the Home Screen app has no reload button).
- Clear cached copy and reload loads the app fresh from the network, keeping settings and saved data.
- The app has 4 tabs: Operate, Log, Spots and Settings.
- Activations move into Spots, above the spots, and old Activate links open Spots.
- New app icon: the slot ring around the RR73 wordmark (iOS keeps the old icon until RR73 is removed from the Home Screen and added again).

## 0.4.1 · 2026-10-13

- Start audio plays 1500 Hz for 0.4 s at the output level, after 1.5 s of silence (Start tone in Radio and audio turns it off).
- The start tone stops iOS muting output on silent, keys the radio's VOX and runs the keying check.
- The keying check says whether receive audio dropped during the start tone or during Tune, and by how much.
- If receive audio didn't drop, the keying check says what to check.

## 0.4.0 · 2026-10-13

- The decoder retries weak signals with ordered-statistics decoding when the first attempt fails.
- It decodes 74% of the known messages in 350 recorded slots (was 70%), with no false decodes in 5000 noise-only slots.

## 0.3.0 · 2026-10-12

- The decoder makes up to 3 passes over each slot, removing each decoded signal before the next pass.
- It decodes 88% of the known messages in recorded test slots (was 72%), with no false decodes in 200 noise-only slots.

## 0.2.0 · 2026-10-12

- RR73 decodes FT8. Each slot's messages appear about 0.1 s after the slot ends in desktop Chromium (not yet timed on an iPhone).
- Messages with your callsign are marked red, and CQ calls green.
- The decode list stays still while you touch it and for 0.5 s after, and newer slots go in on top when you let go.
- Filter chips show all decodes, CQ calls, messages to you or the receive frequency.
- If the decoder can't load, Operate says so, and the waterfall and Save slot keep working.
- Settings shows the decoder version and how long it took to load.

## 0.1.1 · 2026-10-12

- Message packing and display are correct bit for bit on 303 test messages.
- That fixes reports from −31 to −50 dB, ARRL Field Day sections, 3DA0 and 3X callsigns, and R RR73.

## 0.1.0 · 2026-10-12

- Live waterfall of the radio audio from 0 to 3000 Hz, with UTC slot boundaries and markers for the receive and transmit frequencies.
- UTC clock with slot progress, and an input level meter, on the Operate screen.
- Save any of the recent slots as a 12 kHz WAV file with a sidecar, for the decoder corpus.
- Band and mode picker. The chosen dial frequency is recorded with saved slots.
- Radio and audio settings show what the phone applied to the microphone, the real sample rate and channels, a level target and the VOX checklist.
- Tune in Radio and audio has a confirmation and a 10 s countdown.
- Audio stops are reported with the time, and Resume audio restarts capture.
- Version history in Settings, and a notice after each update.
- Works offline once added to the Home Screen.
