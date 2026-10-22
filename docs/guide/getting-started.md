# Getting started

RR73 runs in Safari on an iPhone or iPad, and in Chrome or Edge on a computer. The desktop app for Windows, macOS and Linux runs the same app in its own window. [Your radio](your-radio.md) covers the cable, rig control and the desktop app.

## On an iPhone

1. Open RR73 in Safari.
2. Choose Share › Add to Home Screen.
3. Open RR73 from its Home Screen icon.

Opened from the Home Screen, RR73 starts and decodes with no network connection.

## On a computer

Open RR73 in Chrome or Edge. Rig control works in these 2 browsers and in the desktop app.

## Callsign and grid

1. Tap Settings, the gear at the right end of the bar along the top of Operate.
2. Under Station, enter your Callsign, such as 9V1NE.
3. Enter your Grid, 4 or 6 characters, such as OJ11 or OJ11ab. Tap Use GPS to fill it in from the phone's position.

RR73 transmits only with both set. Without them the status line reads `Set callsign and grid in Settings`. FT8 and FT4 messages carry the first 4 characters of the grid.

Name and QTH are optional. RTTY macros send them.

## Starting audio

Operate opens with the strip Audio is off.

1. Connect the radio's audio. [Your radio](your-radio.md) has the cables and levels.
2. Tap Start audio.
3. Allow the microphone if the browser asks.

With Start chime on in Settings › Radio and audio, a short chime plays as audio starts. It keys the radio through VOX.

Decodes appear 13.5 s into each 15 s FT8 slot, and 6 s into each 7.5 s FT4 slot.

When audio stops, the strip reads Audio stopped at the UTC time, with the reason, and Tx goes off. Tap Resume audio to carry on. On an iPhone, iOS stops the microphone while RR73 is in the background, so audio stops when you leave the app.

## The bar along the top

Operate's bar holds, from left to right:

- The band, the mode and the dial frequency, such as 20m FT8 14.074. Tap it to open Change band. Without rig control, set the radio to the dial shown there.
- A Practice badge while the practice band runs in place of the radio, and a Web SDR badge while a web SDR supplies receive audio.
- A Clock badge while the clock is 1 s or more off. Tap it to open Timing. [Timing and the clock](timing.md) has the details.
- With rig control on, the radio's badge. Connected shows in green. Connecting, Off band, a mode such as USB, or FIL2 show in amber. Not connected, No reply and Port closed show in red. Tap it to open Rig control.
- The UTC time and a ring that fills through the slot: blue while receiving, red while transmitting, grey with audio off.
- Spots, Log and Settings. Spots shows while Activations, POTA spots or Cluster spots is on in Settings › Optional features, or Show who heard you in Settings › PSK Reporter.

A line along the bottom edge shows the input level: green inside the target range, amber outside it. While RR73 transmits, a red line runs along the top edge.

On an iPad or a computer window, the bar stays above every screen. Tabs for Operate, Log, Spots and Settings sit in its middle. On the other screens it shows On air or Tx on while Tx is on, with Halt.
