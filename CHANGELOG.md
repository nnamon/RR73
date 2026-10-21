# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## Unreleased

- Settings › Rig control › Connection says how a KX2 connects: a Digirig, or a KX2 cable such as KXUSB. Through a KX2 cable, the Digirig’s MIC BTN rule and advice no longer apply, and the port reopens by itself as for the IC-705.

## 0.24.16 · 2026-10-21

- On a computer, Settings › Radio and audio › Monitor plays Tx audio on a second output, such as the speakers, at its own level, while the signal goes to the radio.

## 0.24.15 · 2026-10-21

- A KX2 band change answered `?;` before each read-back still sets the dial and DATA A. It was reported as refused, and DATA A was never set.
- The IC-705 has 400 ms to confirm PTT on, up from 300 ms, still inside the 0.5 s before the audio.
- Rig control reads the KX2’s auto-info mode and says when it sends its dial and mode by itself, which can make a band change read as refused.

## 0.24.14 · 2026-10-21

- The radio badge goes amber with FIL2 or FIL3 when the IC-705 is on a narrow filter that cuts most of the FT8 range.
- An answer from the radio cut short no longer swallows the answer after it.
- Halt sends no PTT off when RR73 holds none and the radio reads receive, so Halt on the KX2 no longer holds other requests back for 0.6 s.
- Settings › Appearance › Font: Automatic uses Apple’s system font on Apple devices and Inter elsewhere, such as Windows. System and Inter fix the choice. Inter comes with the app and works offline.
- Monospaced text on Windows uses Cascadia Mono or Consolas, where it fell back to Courier New.
- When the browser keeps audio paused until a tap, as Chrome can when Web SDR starts with the app, the audio banner says so within 1 s and Resume audio starts it. Audio stayed at starting, with a black waterfall.
- On a computer or tablet, Operate's ••• menu opens over the waterfall in full. Its top rows were cut off behind the waterfall.
- Worked before greys a decode only for a dupe: a station worked today on this band and mode, in the running activation, the rule Hunt and Repeat CQ use. Hide worked hides only dupes.
- Decode rows show worked status on their right edge: solid for a dupe, light for a station worked on this band and mode on another day, which can be worked again.

## 0.24.13 · 2026-10-21

- Operate's Sort chip lists each slot's decodes by kind: messages to you, then CQs, then calls, reports and endings, each from the lowest audio frequency. It stays as set. Off keeps the decoder's order.
- A row of a station calling you names its country, as a CQ row does, where it has no Next, Dupe or Lost tag.
- Log names each QSO's country beside the callsign, from the country file.

## 0.24.12 · 2026-10-21

- Hunt answers a station calling you while the station it called has not answered, unless that caller is a dupe with Work dupes off.
- Rows read Lost only while Tx still calls that station. Calling CQ or another station clears them.

## 0.24.11 · 2026-10-21

- A station that missed RR73 and sends its R-report again gets RR73 again with Repeat CQ and Hunt on too, up to the usual repeats.
- A QSO logged again with the same station, band and mode within 10 minutes, as when RR73 went again by hand, updates the end time of the QSO already in the log. QSOs added by hand in Log are never merged.

## 0.24.10 · 2026-10-21

- After a shifted transmission, a receive dial the IC-705 refuses just after transmit is tried once more, 0.1 s later, before Tx goes off.
- The IC-705's Split row reads a simplex answer as Off, and rig control ignores answers the radio addresses to another program.
- After PTT off, rig control reads transmit or receive every 100 ms for up to 0.5 s before it says PTT off was not confirmed, so a radio still switching to receive no longer turns Tx off.
- On reconnecting, the read that finds a radio still transmitting is tried up to 3 times, so a radio RR73 left keyed gets its PTT off even when the first read goes unanswered.
- Keying the IC-705 by CAT, Tx waits until USB SEND has read OFF. Before, it was allowed while USB SEND was unread.

## 0.24.9 · 2026-10-21

- Settings › Rig control › Copy connection log includes the first 96 bytes RR73 sent to the radio and the first 96 it received, in hex.

## 0.24.8 · 2026-10-16

- New DXCC entity starts off in every decode colour scheme. With a short log nearly every station is a new entity, and its magenta covered most decodes. Turn it on in Settings › Decode colours.

## 0.24.7 · 2026-10-16

- Settings › Rig control has its own switch, off by default. Off, RR73 closes the radio’s port, opens it neither by itself nor on a tap, and transmissions key the radio by VOX. On, it opens the port it used before again.

## 0.24.6 · 2026-10-16

- Settings › Rig control shows Disconnect radio while the radio’s port is closed, as after the cable comes out. It stops RR73 opening the port by itself when the radio is plugged in again. Connect radio opens it.

## 0.24.5 · 2026-10-16

- When the last connection to the radio stopped before it completed, as when the browser closes while connecting, Settings › Rig control says at which step when the app opens.
- Settings › Rig control › Copy connection log copies the steps of the last connection to the radio, with their times, for a report.
- When the IC-705’s USB driver does not let RR73 set DTR and RTS low, rig control still connects if USB SEND reads OFF, and Rig control notes it. With USB SEND on a line, or unread, the port closes and Rig control says to set it to OFF. Before, the port always closed.

## 0.24.4 · 2026-10-16

- After a connection to the radio that never completed, such as one during which Chrome closed, RR73 no longer opens the port by itself when the app opens or the radio is plugged in. Connect radio and Reconnect radio still open it.
- Settings › Rig control has a Baud rate for the IC-705: 4800 to 115200, 115200 by default. A new rate opens the port again at that rate.

## 0.24.3 · 2026-10-16

- With Key the radio with CAT on, a transmission or Tune whose audio would not reach the output chosen in Settings › Radio and audio is refused, and Rig control and Radio and audio say what to choose. Before, the radio keyed with its Tx audio on the system default, or on nothing.
- An output the browser refused is applied again once audio starts and when a device is plugged in or out.
- Settings › Rig control reads the IC-705’s split, duplex, RIT and ΔTX (XIT) and says what to change when one is on: with split, duplex or ΔTX on, the radio transmits away from the frequency RR73 logs. The KX2 shows RIT too.
- With rig control on, Operate shows a radio badge beside the band: Connected, No reply or Port closed, and a tap opens Rig control. In amber it names what is wrong: Transmitting with no PTT from RR73, the radio’s mode outside USB-D or DATA A, such as USB, or Off band. While the radio’s dial is not in use, the band’s own dial shows in amber.
- Settings › Rig control › Reconnect radio opens the radio’s port again without the port chooser after it closed with the cable still in. Connect radio still chooses another port.
- On a phone, the Settings button at the top of Operate ends its glyph 16 pt from the screen’s edge, as every other bar does. It ended 11 pt in.
- The app’s description names both ways to run it: an iPhone through a headset-jack or USB interface, or a computer with rig control.
- The Clock badge’s label for screen readers says computer off iOS and Android, as the status line does.
- With the window hidden, rig control keeps time as transmissions do: the radio’s reply timeouts, PTT off and its retries, and each keying’s limit no longer run up to 1 s late.
- Settings › Practice band › Play Tx audio, now “Can key a connected radio”, decides whether practice keys the radio. On, with Key the radio with CAT on, practice transmissions, Tune and Test keying key it as real ones do. Off, practice plays no Tx audio and keys nothing. Before, it keyed PTT with no audio.

## 0.24.2 · 2026-10-16

- FT8 and FT4 decode stations with tones up to 3200 Hz, beyond the 3000 Hz limit before, such as a strong station at the edge of the radio’s passband.
- The SNR of a station near the edge of the radio’s passband reads within about 2 dB of its true value. Before, it read up to 5 dB high there.
- The first decoding stage finds 93% of the reference decodes in 350 slots recorded on 40m, up from 92%, and all 3 stages 95%, up from 94%. A further set of soft bits gives every symbol the same weight, so a symbol that a neighbour or a fading peak dominates cannot outvote the rest.
- A first-stage decode that names a callsign only by its hash shows the callsign when another decode of the stage carries it in full.

## 0.24.1 · 2026-10-16

- In Chrome and Edge on a computer, RR73 keeps receiving, decoding and transmitting while its window is minimised, covered or in a background tab, with no tap to resume. On the iPhone audio stops when RR73 leaves the screen, as before.
- On Windows the advice names Chrome, Edge and Windows Settings: allowing the microphone and location, keeping the screen on, and syncing the clock in Settings › Time & language › Date & time. Before you transmit asks there for system sounds off, the radio not the default output and sleep set to Never. Off iOS and Android, RR73 says computer where it said phone.
- The level advice under Tune follows the connected radio: within the ALC zone on an IC-705, 4 to 5 ALC bars on a KX2, and both without a radio.
- Settings › Radio and audio › Timing shows how long the decoder takes per slot, the last slot and the 95th percentile of recent ones, and counts the slots it could not decode because it was still busy. The timing report carries both.
- Resume audio finds the radio's audio input after its USB cable moved to another port, in the same tap. It took a second tap, on Start audio.
- Tune's sheet names the radio's dial while rig control reads one, on any band. It named the band's usual dial.
- A keystroke restarts the Tx watchdog, as a tap or a click does, so typing and the keyboard shortcuts count as the operator being there.
- 2m has FT8 on 144.174 MHz and FT4 on 144.170 MHz, and 70cm is a band with FT8 on 432.174 MHz and WSPR on 432.300 MHz. A radio tuned to 144.174 MHz keeps RR73 in FT8: it switched to WSPR.
- WSPR on 2m uses the 144.489 MHz dial that WSPRnet, the WIA and IARU Region 3 give, so its signals sit at 144.4904 to 144.4906 MHz. It was 144.4885 MHz, 500 Hz lower.
- Text on Windows uses Segoe UI, Windows' own font, where it fell back to Arial.

## 0.24.0 · 2026-10-16

- Settings › Logging › Wavelog › Read Wavelog’s log counts the QSOs in your Wavelog log for decode colours, New and Hide worked, so a station worked from another radio or location shows as worked. It is off by default and needs Wavelog 2.5.1 or later. Dupes, Hunt and Repeat CQ still count this phone’s log only.

## 0.23.1 · 2026-10-16

- FT8 decodes transmissions that start up to 4.5 s late, and FT4 up to 1.5 s, such as a reply sent late into the slot. Before, FT8 found none that started more than 2.5 s late, and FT4 none past 1 s.

## 0.23.0 · 2026-10-16

- Settings › Rig control connects an Elecraft KX2 through a Digirig: RR73 reads and sets its dial and DATA A, keys it once Key the radio with CAT is on, and says to set MIC BTN to OFF, as the Digirig’s PTT reaches its MIC jack.
- Rig control shows Transmitting when the radio transmits on its own, and on connecting sends PTT off to a radio still transmitting when Key the radio with CAT is on or RR73 may have left it keyed.
- A CQ tapped right after Start audio goes out in its slot: it no longer waits a cycle for the audio clock.
- Halt during a short wait for late answers no longer lets a held-back PTT on go out after its PTT off, and that wait no longer stops rig control for good when its timer fires early.

## 0.22.3 · 2026-10-16

- Decoding FT8 and FT4 takes about half the time it did, with the same decodes. In Safari's engine on an M4, 95% of recorded slots finish all three decoding stages within 0.5 s, against 1.2 s before.

## 0.22.2 · 2026-10-15

- FT8 and FT4 decode signals 2 to 3.5 dB weaker. The decoder takes its soft bits from blocks of 3 FT8 or 4 FT4 symbols, and its first stage finds 92% of the reference decodes in 350 slots recorded on 40m, up from 74%.

## 0.22.1 · 2026-10-15

- Settings › Rig control › Keep Tx audio centred moves the IC-705’s dial in 500 Hz steps for each FT8 and FT4 transmission, so its audio sits at 1500 to 2000 Hz inside the transmit passband and the signal stays on the Tx frequency. The dial goes back after each transmission. It is off by default and works with Key the radio with CAT on.

## 0.22.0 · 2026-10-15

- Settings › Rig control connects an Icom IC-705 by USB in Chrome and Edge on a computer: RR73 reads its dial and mode, sets them from the band sheet, and logs the dial it reads. Key the radio with CAT, off until turned on, keys the radio for every transmission, and Test keying checks it first.
- Settings › Radio and audio › Input finds the chosen input again by its name when the browser gives it a new ID.
- A CQ or call tapped in the first 0.2 s after Start audio goes out in its slot. It was refused with "Audio is not running."

## 0.21.10 · 2026-10-15

- Settings › Radio and audio › Waterfall colours sets the waterfall in RR73’s colours, Fire or Grey. Fire and Grey get lighter in even steps from the noise to the strongest signals.
- Settings › Appearance has Sun, a light theme for direct sunlight. Text keeps 7:1 contrast or more, decode colours are stronger, and the waterfall’s times and callsigns sit on dark tags.
- Settings › About › Credits shows the licences of ft8_lib and Lucide in full, with what RR73 takes from each.

## 0.21.9 · 2026-10-15

- A dupe is a station worked on the band and mode in the same UTC day and the same activation. After starting an activation at a second park, Repeat CQ and Hunt answer stations worked at the first.
- Hunt follows Work dupes. On, it calls dupes after the other CQs. Off, the default, it skips them.

## 0.21.8 · 2026-10-15

- The dial reset button in the band sheet is a plain anticlockwise arrow in the accent colour, centred on the dial's digits.

## 0.21.7 · 2026-10-15

- Settings › Radio and audio › Output sends transmit audio, Tune and the start chime to a chosen device, such as a radio's USB audio. It shows in browsers that can choose an output, such as Chrome and Edge.

## 0.21.6 · 2026-10-15

- The dial reset button in the band sheet is a round button the height of the digits. On a 375 pt wide screen, such as the iPhone SE, a dial such as 14.0850 shows in full beside it.

## 0.21.5 · 2026-10-15

- FT4 runs the same 2 finer searches after each slot as FT8 and decodes signals about 1.2 dB weaker. Their decodes join the slot within 2 s.

## 0.21.4 · 2026-10-15

- The filter chips over the decode list and the RTTY macro row scroll sideways only. A vertical drag no longer moves them.
- The empty decode list says decodes appear 13.5 s into each FT8 slot (6 s into FT4).
- Callsigns on the waterfall start off. Settings › Radio and audio turns them on.
- The FT8, FT4 and RTTY dial fields in the band sheet have a reset button that goes back to the band's usual dial.

## 0.21.3 · 2026-10-15

- FT4 no longer shows the false decodes noise gave about twice in 10000 slots, all reported at −20 dB or weaker.

## 0.21.2 · 2026-10-15

- Decodes show about 1.5 s before the slot ends: an early pass decodes the first 13.5 s of each FT8 slot and the first 6 s of each FT4 slot. Its rows stay in place when the whole slot's decodes arrive, and new ones follow them.

## 0.21.1 · 2026-10-15

- Clock warning: from 1 s off by the decodes, a Clock badge beside the band and a notice say how far the phone's clock is off. The badge opens Radio and audio at Timing, where Phone clock shows the reading and how to set the clock.

## 0.21.0 · 2026-10-15

- Night display: the UTC clock, the next transmission and the stations heard in dim red on black, from ••• or by itself after an idle time set in Settings › Appearance. A tap wakes Operate, and Halt stays while Tx is on.

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
