# Changelog

User-visible changes to RR73, newest first. Each release is tagged `v<version>` with the same notes. The app shows this file as Version history.

## Unreleased

- Decodes FT8 in the app: each slot's messages appear in the list about 0.1 s after the slot ends in desktop Chromium, marked as in WSJT-X. Not yet timed on an iPhone.
- Messages that contain your callsign are marked red, CQ calls green.
- The decode list stays still while you touch it and for 0.5 s after; newer slots go in on top when you let go.
- Filter chips show all decodes, CQ calls, messages to you or the receive frequency.
- If the decoder cannot load, Operate says so and the waterfall and Save slot keep working.
- Settings shows the decoder version and how long it took to load.

## 0.1.0 · 2026-10-12

- Live waterfall of the radio audio from 0 to 3000 Hz, with UTC slot boundaries and receive and transmit frequency markers.
- UTC clock with slot progress and an input level meter on the Operate screen.
- Save any of the recent slots as a 12 kHz WAV file with a sidecar, for the decoder corpus.
- Band and mode picker. The chosen dial frequency is recorded with saved slots.
- Radio and audio settings: what the phone applied to the microphone, the real sample rate and channels, a level target, the VOX checklist, and Tune with a confirmation and a 10 second countdown.
- Audio stops are reported with the time, and Resume audio restarts capture.
- Version history in Settings, and a notice after each update.
- Works offline once added to the home screen.
