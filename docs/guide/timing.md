# Timing and the clock

The device's clock sets when RR73 transmits, because FT8, FT4 and WSPR slots run on UTC. Each FT8 and FT4 transmission starts 0.5 s into its slot.

## The Clock badge

RR73 takes the median DT of decodes at −10 dB and above as the clock error, since stations with good clocks scatter around DT 0.

A Clock badge shows on Operate's bar from 1 s off and goes once the clock is within 0.8 s. The status line says, for example, `Phone clock 1.2 s slow`. Tap the badge to open Timing.

A clock 1.2 s slow puts every transmission 1.2 s late on the air. A slow audio input gives the same reading.

## Setting the clock

- iPhone: turn on Set Automatically in Settings › General › Date & Time. It needs a network.
- Windows: turn on Set time automatically in Settings › Time & language › Date & time and select Sync now.
- Other systems: turn on automatic date and time in the system settings.

## Correct Tx timing

Correct Tx timing, in Settings › Radio and audio › Timing, moves each transmission by the clock error. It is off by default. On, Timing shows how much earlier or later each transmission starts.

Receive needs no setting. RR73 learns an offset for receive audio from the same decodes, moving it at most 0.08 s per slot and keeping it within ±2.5 s. Input offset shows it.

## Timing

Settings › Radio and audio › Timing shows:

- Decoder: version and load time.
- Decode time: the last slot's, and the time 95% of slots decode within.
- Slots not decoded: slots skipped while the decoder was busy.
- Phone clock, or Computer clock: the clock error from the decodes.
- Correct with time server and Time server, in the desktop app.
- Correct Tx timing.
- Median DT of the strong decodes.
- Input offset on receive audio.
- Your Tx, heard back: the DT of your own transmission in the receive audio.
- Clock source, Clock drift, Capture lag, Audio gaps and Resumes: how the audio clock behaves.

Copy timing report copies it all as text.

## The desktop app's time server

The desktop app measures the computer's clock against a time server at start and every 10 min, and a good measurement corrects the time RR73 uses. Correct with time server shows the error. With no reply it reads No reply, clock not corrected, and RR73 uses the system time.

- Time server: the address of an NTP server. Empty, RR73 uses the public NTP pool.
- Correct with time server: off uses the computer's clock as it is and contacts no time server.

The Clock badge and Correct Tx timing work on the corrected time.
