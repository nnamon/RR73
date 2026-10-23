# Night display

The night display keeps the screen dark during long sessions at night, such as a WSPR beacon for hours or a run of FT8 from a tent. iOS stops the microphone when a home-screen app goes to the background or the phone locks, so RR73 keeps the screen on. Code: `web/src/lib/display/night.ts` (content), `web/src/lib/state/night.svelte.ts` (on, off and the idle timer), `web/src/ui/NightDisplay.svelte`.

## Decision

- Over Operate in FT8, FT4 and WSPR: black, with the UTC clock, the next transmission or the one on air, and the newest slot's stations, strongest first, at most 6 (each once, by base callsign; the operator and hashed calls left out). WSPR shows the beacon's next slot and the newest spots.
- Text in one red, `--rr-night-text` (#D9362B), 4.5:1 on black: red keeps dark-adapted eyes and stays readable. No tints, no waterfall.
- The text moves a few points each minute, through 8 positions, so no pixel stays lit for long.
- A tap anywhere or a key wakes Operate; the key still reaches the app, so Escape halts. Leaving Operate or switching to a keyboard mode ends the display. Halt stays, as everywhere output can play, while Tx, the beacon or Tune is on; a tap on it halts and leaves the display on.
- It comes on from Night display in ••• (FT8, FT4 and WSPR), or by itself after Settings › Appearance › Night display (Off, 2, 5 or 10 min; Off by default) without a touch or a key while Operate shows.
- Keyboard modes have none: their text is the screen.

## Alternatives rejected

- Dimming the screen: a web page cannot set the brightness.
- Waking on a message to the operator: a sequencer that answers by itself needs no wake; a tap shows the list.

## Open risks

- OLED burn-in from the clock's digits over hours: the shift spreads them over 18 by 10 points. Not tested on a device.
- Brightness stays where iOS has it; the operator sets it low.
