# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## Unreleased

- Transmits FT8 and FT4. Tap a decode and Call, or double-tap it, to answer a station; Call CQ to call CQ. Each message starts 0.5 s into its slot. Not tested with a radio.
- In loopback tests in desktop Chromium, transmissions started within START ms of slot + 0.5 s, and Halt silenced the output HALT ms after the tap.
- The sequencer sends Tx1 to Tx6 as WSJT-X does and logs the QSO when it completes. The dock shows the steps, the next message and when it starts.
- A call too late for this slot starts up to 1.5 s late in FT8 (1.0 s in FT4) or waits for the next slot, and the dock says which.
- Run calls CQ and answers callers in order: first heard, strongest, farthest or new. Dupes are marked and skipped unless Work dupes is on. Stop after this QSO ends Run after the current QSO.
- Touch and hold a decode for the station's details: distance, bearing, SNR and Call.
- Messages edits Tx1 to Tx6. Text that cannot be encoded is refused before it is sent.
- What you send appears in the decode list as amber rows. While transmitting, Operate shows a red edge and "On air" with the message.
- Each logged QSO shows "Logged JA1KXM 20m FT8 −14 / −09" with Edit and Undo. QSOs are kept until the app closes.
- The watchdog stops Tx after 6 min without a touch or a new message.
- Transmitting needs your callsign and grid in Settings, the band confirmed in the band sheet, and audio running.
- Tap the waterfall to set the receive or transmit frequency: a bar offers Receive here, Transmit here and Both. Find clear Tx moves Tx to the quietest 50 Hz in the last 2 to 4 slots.
- Calling a station moves Rx to its frequency. Turn off Hold Tx frequency in Settings to move Tx as well.
- Tune transmits at the Tx frequency, and the Tune sheet says which.
- On iOS, every tap that can start a transmission plays a 0.1 s silent clip, so output works with the ring switch on silent. Not tested on a device.

## 0.4.3 · 2026-10-13

- The start sound is now a soft rising chime, E5 then A5 (659 and 880 Hz, 0.45 s), in place of the 1500 Hz beep. It still keys the radio for the keying check. The setting is now called Start chime.

## 0.4.2 · 2026-10-13

- Reload app in Settings, under About, checks for a newer version, installs it and reloads, for when the app runs from the home screen and has no reload button. Clear cached copy and reload loads the app fresh from the network; settings and saved data stay on the phone.
- Four tabs: Operate, Log, Spots and Settings. Activations move into Spots, above the spots, and old Activate links open Spots.
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
- The decode list stays still while you touch it and for 0.5 s after; newer slots go in on top when you let go.
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
