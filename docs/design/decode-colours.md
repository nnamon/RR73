# Decode colours

Operate colours each decode by category, in WSJT-X's order. Settings › Decode colours sets the categories, their order and their colours, or a preset. Code: `web/src/lib/decode/highlight.ts` (categories and matcher), `highlight-colour.ts` (text colours), `web/src/lib/log/worked.ts` (log index), `web/src/views/DecodeColours.svelte`.

## Decision

- Background categories come in priority order. The first enabled category that matches a decode tints its row: a 4 px bar in the colour and a tint behind the text.
- Worked before is a text layer outside the order. It greys the text of any decode whose sender is in the log on this band and mode, over whatever background the row has. A CQ from a station already worked shows green with grey text.
- New call, new grid and ending a QSO look at the station sending a CQ, 73 or RR73. Worked before looks at the sender of any message. No category treats the operator's own callsign as a sender.
- My call matches the operator's callsign in any position, with prefixes and suffixes (9V1NE/P, VK3/9V1NE) and as a hashed call.
- A message addressed to the operator's callsign (its first callsign, by base call) also leads its slot, with a solid red edge in place of the category's bar and heavier text. This sits outside the categories and holds with My call turned off (`web/src/lib/decode/focus.ts`).
- Own transmissions match only Sent, and received decodes never match it, so its place in the order changes nothing.
- Calls compare by base callsign: a QSO with ZL1TQK/P counts for ZL1TQK. Grids compare by their first 4 characters.
- Every category is on by default. Settings schema 3 turns them all on, at the defaults below, on phones that ran 0.7.
- The log is indexed once per change of the log, in sets of calls (any band, per band, per band and mode) and grids (any band, per band), so each row costs a fixed number of set lookups.
- Each category stores one colour, #RRGGBB. The decode rows carry the result as `data-hl` (background), `data-ink` (text layer) and the classes `rr-hl` and `rr-ink`, so a change of row layout does not touch the matcher.

## Categories and schemes

The categories keep WSJT-X's order, with Ending a QSO before CQ and Worked before as a text layer. A preset sets a colour scheme and which categories are on; it never changes the order.

| Order | Category | RR73 (default) | WSJT-X 2.7.0 |
| --- | --- | --- | --- |
| 1 | My call in the message | #D55E00 vermillion | #FF6666, on |
| 2 | New grid | #E69F00 orange | #FF8000, off |
| 3 | New grid on this band | #F5D999 | #FFCC99, off |
| 4 | New call | #0072B2 blue | #00FFFF, off |
| 5 | New call on this band | #99C7E0 | #99FFFF, off |
| 6 | Ending a QSO | #CC79A7 reddish purple | none in WSJT-X; off, #FFE2C8 |
| 7 | CQ in the message | #009E73 bluish green | #66FF66, on |
| 8 | Sent | #56B4E9 sky blue | Transmitted message, #FFFF00, on |
| Text | Worked before | #8C93A0 | none in WSJT-X; off, #8C93A0 |

- WSJT-X's values were read on 15 October 2026 from WSJT-X 2.7.0-rc3 itself (Ubuntu 24.04 package `2.7.0~rc3+repack-1build2`), run on a virtual display: Settings › Colors after a first start, each row's colour sampled from a screenshot. Its list, top to bottom: My Call in message, New Continent, New Continent on Band, New CQ Zone, New CQ Zone on Band, New ITU Zone, New ITU Zone on Band, New DXCC, New DXCC on Band, New Grid, New Grid on Band, New Call, New Call on Band, LoTW User (a text colour), CQ in message, Transmitted message. Ticked by default: My Call, the continent, CQ zone and DXCC categories, CQ in message and Transmitted message. "Highlight also messages with 73 or RR73" is off. An earlier version of this table read colours from the User Guide's screenshots; New call, New call on this band and Sent were wrong.
- Each "on this band" colour is its category's colour mixed 40:60 with white, the rule behind WSJT-X's pairs: #FF8000 gives #FFCC99 and #00FFFF gives #99FFFF.
- Presets: RR73 (every category on), Quiet (RR73's colours; My call, Ending a QSO, CQ and Sent on), WSJT-X (its own colours and switches, the 2 categories it lacks off), and Monokai, Solarized, Dracula, Nord and Gruvbox (each palette's accents, every category on). The settings show each preset's 8 background colours, with those it turns off faded.

## RR73's scheme

RR73's colours are the Okabe–Ito palette, designed to stay apart with colour blindness. WSJT-X's red for My call and green for CQ are the pair deuteranopia confuses most.

- Measure. Each colour is tinted as a row shows it, seen through Machado, Oliveira and Fernandes's simulation (2009, severity 1) of protanopia, deuteranopia and tritanopia, and compared in CIELAB (ΔE76) with every other category and with a plain row, in light and dark. A category and its "on this band" form are not compared.
- Assignment. Every assignment of the palette to the 6 colour slots was scored by its closest pair, with My call in the red family, CQ green, New call blue and New grid orange or yellow. The chosen one has its closest pair 5.9 apart (CQ and Sent, tritanopia, dark) and every category 10.2 or more from a plain row. My call and CQ stay 16.9 apart; WSJT-X's colours fall to 11.3 (deuteranopia, dark).
- The editor schemes take the same search over their own accents. Their closest pairs come to 2.8 (Dracula) to 4.7 (Solarized, Nord); they make no claim for colour blindness.
- `highlight-cvd.test.ts` holds RR73's scheme to 5.5 between categories and 10 from a plain row, and above every other scheme's closest pair.
- Rejected: black for Sent, the search's first pick between categories. Tinted at 30% over the dark theme's background it matched a plain row.

## Earlier defaults

0.8.0 to 0.19.2 shipped WSJT-X's guide colours with every category on: #FF6666, #FF8000, #FFCC99, #3399FF, #99CCFF, #FFE2C8, #66FF66, #C98A1A and #8C93A0. Settings schema 10 gives a phone still on those, every category on or as Quiet, RR73's scheme in the same form. Colours the operator changed, moved or switched stay.

## Colours in both themes

- A tint is the colour mixed in sRGB with #FFF at 45% in light and with #0B0D10 at 30% in dark (`--rr-hl-tint-light`, `--rr-hl-tint-dark` in `tokens.css`). Every channel stays at 140 or more in light and 88 or less in dark, so the row's text (#0E1116, #ECEEF2) keeps 5.6:1 and 6.1:1 or more on any colour, including custom ones. On a tint, every column of the row takes the label colour.
- Worked-before text is the chosen colour, darkened toward black in light and lightened toward white in dark, as little as 4.5:1 needs against the tint or the plain row under it.
- 30% in dark leaves room for grey text over a tint: on the CQ tint the default grey stays 1.5:1 or more apart from the row text.
- `highlight-contrast.test.ts` checks every default and palette colour, and a sweep of 4096 colours, in both themes.

## Alternatives rejected

- Worked before as the last category in the order. With every category on, CQ in the message and Ending a QSO take every message it could match, so it never showed.
- Colouring every message's sender for new call and new grid. Most rows on a busy band would be coloured, against the guide's CQ rule.
- One alpha for any tint over any colour, with text colours fixed in CSS. Grey text over a tint cannot keep 4.5:1 for every tint; the text colour has to depend on the tint, so it is worked out per row.
- Exact callsign comparison for new call and worked before. A station worked portable would show as new.

## Open risks

- The dark tint at 30% is fainter than the light one. Not tested on a device.
- Worked-before grey over a bright tint in dark comes out close to the row text, 1.5:1 apart on the CQ tint.
- The colour blindness figures come from a simulation. Not tested with operators who have colour blindness.
