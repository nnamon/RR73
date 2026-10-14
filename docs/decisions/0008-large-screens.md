# 0008. Layouts for iPad, desktop and a phone on its side

Status: accepted, 2026-10-14 (the owner approved the large-screens mockup with every recommendation)

## Context

Up to 0.12 every screen was the phone layout stretched to the window: at 1440 x 900 the waterfall was 95 pt tall, Halt 700 pt wide and the decode list mostly empty. The mockup (large-screens.html, 14 October 2026) drew Operate, Log, Settings and the sheets at 820 x 1180, 1180 x 820, 1440 x 900 and 852 x 393 with the options side by side.

## Decision

- Three size classes from the window, never the device (`web/src/lib/app/layout.svelte.ts`): compact under 700 pt wide; compact height at 700 pt wide or more and under 500 pt tall (a phone on its side); regular otherwise. iPad Slide Over and Split View up to half the screen are compact. The class rides on the root element as `data-size`; a regular window taller than wide also carries `data-upright`.
- Compact is the phone layout, unchanged.
- Regular: one 52 pt top bar above every screen with the band, tabs for Operate, Log, Spots (while it shows) and Settings in the middle, and the clock. On Log, Spots and Settings, while Tx is on, it says so ("On air · Tx3", "Tx on") and carries Halt.
- Operate in regular width: the waterfall across at a third of the window's height, four FT8 slots tall, its ruler labelled every 100 Hz in 12 pt where it has room. Under it, Band activity (every decode, the All, CQ and To me filters, Save slot, a grey Tx slot bar for each slot we sent in) and Rx frequency (decodes within 50 Hz of Rx, messages to us, our Next, Sending and Sent rows), and the 336 pt transmit panel on the right: status, steps, Tx1 to Tx6 (a click sends one next), Tx, CQ, Hunt and ••• at their own widths, Halt 304 x 64 pt. Taller than wide, the panel becomes a bar along the bottom with Halt 240 x 64 pt. On its side, the waterfall gives way down to a quarter of the height so the panel shows Tx1 to Tx6 and Halt whole.
- Compact height: Operate keeps the phone's top bar and one decode list on the left at full height; the waterfall (128 pt) sits above the controls in a 334 pt column on the right, Halt across it.
- Log, Spots and Settings beside each other in compact height and regular width: list and detail. A QSO opens in the detail pane, with Save QSO in its bar once something changes. Settings follows iPadOS Settings: each phone group a section, a group of one row that row, the chosen section or sub-screen in a column of at most 680 pt.
- Sheets become form sheets 540 pt wide with Done: centred over the dimmed screen in regular width, at the full height on a phone on its side. Station details stay a sheet.
- Each mode family's pane brings its middle and its controls as two parts (`data-part`), and Operate's frame places them by size class (`web/src/views/operate/panes.ts`). WSPR shows its spots in named columns with the sort and Save slot in the header, and its Beacon controls in the panel.
- Keyboard (`web/src/lib/app/shortcuts.ts`): Esc halts on every screen, also while typing, and the same press closes an open sheet or menu. Return calls the selected station, the arrows move the selection, ⌥T, ⌥C and ⌥H turn Tx on, call CQ and hunt, B opens the band sheet, ⌥1 to ⌥3 open Operate, Log and Settings, and ? lists them. The keys other than Esc act only with no text field focused and no sheet open.
- With a mouse as the main pointer, a click selects, a double-click calls and a right-click opens the details; rows show the pointer, and the status line says "Double-click to call".
- Type keeps the phone's sizes in every class; only the ruler's labels grow, from 10 to 12 pt.

## Alternatives rejected

- A sidebar: it suits apps with many sections. RR73 has three, four with Spots, and the sidebar would take 300 pt, leaving 520 pt in iPad portrait, too narrow for two decode panes.
- The phone's Log and Settings icons: Log and Settings would cover Operate, and the clock, the waterfall and Halt would leave the screen.
- One wide decode list: during a QSO the exchange would sit among about 10 rows per slot.
- Esc closing a sheet first: a sheet that swallows Esc could cost a transmission the operator meant to stop.
- The waterfall across the top on a phone on its side: 64 pt of height, about one slot.

## Deviations from the mockup

- The top bar keeps the phone's 17 pt band and clock, as type keeps phone sizes; the mockup drew them at 20 pt.
- The QSO in the Log's pane keeps the sheet's fields, Date and Time included, without the mockup's Exchange and Wavelog headers.
- The transmit panel's Messages header carries Edit messages, which opens the messages sheet; ••• drops the item there. Without it Tx1 to Tx5 could not be edited on large screens.
- Tx1 to Tx6 are 34 pt rows, as drawn, below the 44 pt target the rest of the app keeps: dense rows like the 32 pt decode rows. The CI geometry test exempts them.
- WSPR has three sorts (Distance, SNR, Callsign); the mockup drew a fourth, Newest.
- The status line keeps the watchdog on a phone on its side; the mockup left it out.

## Open risks

- Not tested on a device: iPad, iPad with a keyboard and a trackpad, a phone on its side with its safe-area insets (Playwright reports none, so the 59 pt side insets of the mockup do not show in the screenshots).
- An iPad with a trackpad attached keeps the touch wording, as its main pointer stays the finger.
- Resizing from list and detail to compact while a QSO is open in the pane closes it.
