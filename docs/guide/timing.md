# Timing and the clock

FT8, FT4 and WSPR slots run on UTC, so the device's clock sets when RR73 transmits. Each FT8 and FT4 transmission starts 0.5 s into its slot.

## The Clock badge

RR73 measures the clock from the decodes. Stations with good clocks scatter around DT 0, so the median DT of strong decodes, −10 dB and above, shows how far the device's clock is off.

From 1 s off, a Clock badge shows on Operate's bar and the status line says, for example, `Phone clock 1.2 s slow`. The badge goes again once the clock is within 0.8 s. Tap it to open Timing in Settings › Radio and audio.

A clock 1.2 s slow puts every transmission 1.2 s late on the air. A slow audio input reads the same.

## Setting the clock

- iPhone: turn on Set Automatically in Settings › General › Date & Time. It needs a network.
- Windows: in Settings › Time & language › Date & time, turn on Set time automatically and select Sync now.
- Other systems: turn on automatic date and time in the system settings.

## Correct Tx timing

Correct Tx timing, in Settings › Radio and audio › Timing, moves each transmission by the clock error measured from the decodes. It is off by default. On, Timing says how much earlier or later each transmission starts.

Receive needs no setting. RR73 learns an offset for its receive audio from the same decodes, at most 0.08 s per slot and within ±2.5 s. Input offset shows it.

## Timing

Settings › Radio and audio › Timing shows:

- Decoder: the decoder's version and its load time.
- Decode time: how long the last slot took to decode, and the time 95% of slots decode within.
- Slots not decoded: slots skipped while the decoder was busy.
- Phone clock, or Computer clock: how far off the clock is by the decodes.
- Correct with time server and Time server, in the desktop app: the clock against the time server.
- Correct Tx timing.
- Median DT of the strong decodes.
- Input offset on receive audio.
- Your Tx, heard back: the DT of your own transmission in the receive audio.
- Clock source, Clock drift, Capture lag, Audio gaps and Resumes: how the audio clock behaves.

Copy timing report copies all of it as text.

## The desktop app's time server

The desktop app measures the computer's clock against a time server at start and every 10 min. A good measurement corrects the time RR73 uses. Correct with time server, in Timing, shows how far off the computer's clock is and that it is corrected. With no reply it reads No reply, clock not corrected, and the system time stands.

- Time server takes the address of an NTP server, such as a club's or your network's. Empty, RR73 uses the public NTP pool.
- Turn Correct with time server off to use the computer's clock as it is. RR73 then contacts no time server.

The Clock badge and Correct Tx timing work on the corrected time.
