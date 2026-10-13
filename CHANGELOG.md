# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## Unreleased

- The Log lists every QSO on this phone by UTC day with where each copy went: Wavelog waiting, delivered, refused or changed. Search by callsign, grid or park.
- After each QSO a notice shows it with its band and reports, with Edit and Undo for 10 s. Nothing is sent before the 10 s are up.
- Add, edit and delete QSOs by hand. Delete offers Undo.
- To do lists QSOs waiting for Wavelog, refused or changed after delivery, and activation files not yet submitted. A refused QSO says why in plain words and has Fix.
- Wavelog as a destination: its address and API key, Test connection (the key's rights, the station locations and a test QSO that Wavelog does not store) and the station location. The key stays on this phone.
- QSOs go to Wavelog while RR73 is open and online, one at a time and oldest first, retrying after 30 s and then less often, up to every 30 min. Send now sends at once.
- Activate starts an activation with POTA, SOTA, WWFF and IOTA references, the callsign used on air, the grid (typed or from GPS) and a Wavelog station location of its own.
- While an activation runs, Activate shows progress towards each programme's rule (POTA 10 QSOs in a UTC day, SOTA 4 stations, WWFF 44 QSOs over all activations), the time left in the UTC day, recent QSOs and QSOs per band.
- POTA, SOTA and WWFF files for each activation, shared or downloaded from the Log, with Mark submitted. Sharing files from the home-screen app is not tested on a device.
- Export ADIF in the Log shares the QSOs it shows.
- Settings › Logging holds the destinations, Send automatically and Send edits to QSOs already sent.

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
