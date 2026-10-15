# Decode colours

Operate colours each decode by category, in WSJT-X's order. Settings › Decode colours sets the categories, their order and their colours, or a preset. Code: `web/src/lib/decode/highlight.ts` (categories and matcher), `highlight-colour.ts` (text colours), `web/src/lib/log/worked.ts` (log index), `web/src/lib/reference/dxcc.ts` (callsign to entity and zones), `web/src/views/DecodeColours.svelte`.

## Decision

- Background categories come in priority order. The first enabled category that matches a decode tints its row: a 4 px bar in the colour and a tint behind the text.
- Worked before is a text layer outside the order. It greys the text of any decode whose sender is in the log on this band and mode, over whatever background the row has. A CQ from a station already worked shows green with grey text.
- New call, new grid, the place categories (new continent, CQ zone, ITU zone and DXCC entity) and ending a QSO look at the station sending a CQ, 73 or RR73. Worked before looks at the sender of any message. No category treats the operator's own callsign as a sender.
- The place categories place a station by its whole callsign through the country file (`docs/reference-data.md`): VK3/9V1NE counts for Australia, CQ zone 30 and ITU zone 59. A QSO in the log counts the same way, by the call as logged. DXCC entities compare by their ADIF code, so Sicily (a WAE entity) counts for Italy. Until the country file has loaded, and for /MM and /AM, they match nothing.
- RTTY colours each callsign in the received text by My call, the place categories, New call and New call on this band, and Worked before.
- My call matches the operator's callsign in any position, with prefixes and suffixes (9V1NE/P, VK3/9V1NE) and as a hashed call.
- A message addressed to the operator's callsign (its first callsign, by base call) also leads its slot, with a solid red edge in place of the category's bar and heavier text. This sits outside the categories and holds with My call turned off (`web/src/lib/decode/focus.ts`).
- Own transmissions match only Sent, and received decodes never match it, so its place in the order changes nothing.
- Calls compare by base callsign: a QSO with ZL1TQK/P counts for ZL1TQK. Grids compare by their first 4 characters.
- RR73's scheme, the default, turns every category on but the continent, CQ zone and ITU zone categories and New DXCC on this band (RR73's scheme, below). Settings schema 3 gave phones that ran 0.7 the defaults of the time.
- A stored order that lacks a category, as after an update that adds one, gets it after the last stored category that ranks above it in WSJT-X's order. Its switch and colour come from the preset the stored categories match, so an operator on the WSJT-X preset stays on it, and from RR73's scheme otherwise.
- The log is indexed once per change of the log or the country file, in sets of calls (any band, per band, per band and mode), grids, DXCC entities, continents and zones (any band, per band), so each row costs a fixed number of set lookups. Places are cached per callsign.
- Operate's New chip shows the decodes that any enabled new category matches (the place categories, new grid and new call, overall and on the band), whichever category won the background. With none of them on, the chip leaves the row. Hide worked leaves out decodes whose sender is in the log on this band and mode, by the Worked before rule whether its switch is on or not, and keeps messages to the operator.
- The callsign labels on the FT8 and FT4 waterfall (`web/src/lib/waterfall/calls.ts`) carry the decode's colour on their left edge, and a message to the operator a red one. Where labels would overlap, messages to the operator stay first, then coloured decodes in the operator's order, then CQs, then the strongest.
- Each category stores one colour, #RRGGBB. The decode rows carry the result as `data-hl` (background), `data-ink` (text layer) and the classes `rr-hl` and `rr-ink`, so a change of row layout does not touch the matcher.

## Categories and schemes

The categories keep WSJT-X's order, with Ending a QSO before CQ and Worked before as a text layer. A preset sets a colour scheme and which categories are on; it never changes the order.

| Order | Category | RR73 (default) | WSJT-X 2.7.0 |
| --- | --- | --- | --- |
| 1 | My call in the message | #D55E00 vermillion | #FF6666, on |
| 2 | New continent | #FF0063, off | #FF0063, on |
| 3 | New continent on this band | #FF99C1, off | #FF99C2, on |
| 4 | New CQ zone | #FFBF00, off | #FFBF00, on |
| 5 | New CQ zone on this band | #FFE599, off | #FFE499, on |
| 6 | New ITU zone | #A6FF00, off | #A6FF00, off |
| 7 | New ITU zone on this band | #DBFF99, off | #DDFF99, off |
| 8 | New DXCC entity | #FF00FF magenta | #FF00FF, on |
| 9 | New DXCC entity on this band | #FF99FF, off | #FFAAFF, on |
| 10 | New grid | #E69F00 orange | #FF8000, off |
| 11 | New grid on this band | #F5D999 | #FFCC99, off |
| 12 | New call | #0072B2 blue | #00FFFF, off |
| 13 | New call on this band | #99C7E0 | #99FFFF, off |
| 14 | Ending a QSO | #CC79A7 reddish purple | none in WSJT-X; off, #FFE2C8 |
| 15 | CQ in the message | #009E73 bluish green | #66FF66, on |
| 16 | Sent | #56B4E9 sky blue | Transmitted message, #FFFF00, on |
| Text | Worked before | #8C93A0 | none in WSJT-X; off, #8C93A0 |

- WSJT-X's values were read on 15 October 2026 from WSJT-X 2.7.0-rc3 itself (Ubuntu 24.04 package `2.7.0~rc3+repack-1build2`), run on a virtual display: Settings › Colors after a first start, each row's colour sampled from a screenshot. Its list, top to bottom: My Call in message, New Continent, New Continent on Band, New CQ Zone, New CQ Zone on Band, New ITU Zone, New ITU Zone on Band, New DXCC, New DXCC on Band, New Grid, New Grid on Band, New Call, New Call on Band, LoTW User (a text colour), CQ in message, Transmitted message. Ticked by default: My Call, the continent, CQ zone and DXCC categories, CQ in message and Transmitted message. "Highlight also messages with 73 or RR73" is off. An earlier version of this table read colours from the User Guide's screenshots; New call, New call on this band and Sent were wrong.
- Each "on this band" colour is its category's colour mixed 40:60 with white, the rule behind WSJT-X's pairs: #FF8000 gives #FFCC99 and #00FFFF gives #99FFFF. WSJT-X's place pairs come close to the rule without matching it (#FF00FF and #FFAAFF); RR73's schemes apply the rule to them, and the WSJT-X preset keeps WSJT-X's values.
- Presets: RR73 (the default), Quiet (RR73's colours; My call, Ending a QSO, CQ and Sent on), WSJT-X (its own colours and switches, the 2 categories it lacks off), and Monokai, Solarized, Dracula, Nord and Gruvbox (each palette's accents, RR73's place colours, RR73's switches). The settings show each preset's 10 background colours, without the "on this band" forms, with those it turns off faded.

## RR73's scheme

RR73's colours are the Okabe–Ito palette, designed to stay apart with colour blindness. WSJT-X's red for My call and green for CQ are the pair deuteranopia confuses most.

- Measure. Each colour is tinted as a row shows it, seen through Machado, Oliveira and Fernandes's simulation (2009, severity 1) of protanopia, deuteranopia and tritanopia, and compared in CIELAB (ΔE76) with every other category and with a plain row, in light and dark. A category and its "on this band" form are not compared.
- Assignment. Every assignment of the palette to the 6 colour slots was scored by its closest pair, with My call in the red family, CQ green, New call blue and New grid orange or yellow. The chosen one has its closest pair 5.9 apart (CQ and Sent, tritanopia, dark) and every category 10.2 or more from a plain row. My call and CQ stay 16.9 apart; WSJT-X's colours fall to 11.3 (deuteranopia, dark).
- The editor schemes take the same search over their own accents. Their closest pairs come to 2.8 (Dracula) to 4.7 (Solarized, Nord); they make no claim for colour blindness.
- Place categories. The palette has no colour left, so the search ran again for one more category over 5832 colours (18 levels per channel), with the 6 colours above fixed. The colours that keep the closest pair at 5.9 are dark olives, greens, browns and reds; a red reads as the solid red edge of a message to the operator. New DXCC takes WSJT-X's magenta, #FF00FF, which DXers know: it sits 8.3 from every other category (New call, deuteranopia, dark), so the scheme's closest pair stays 5.9, and 27 or more under normal vision in every scheme. Its "on this band" form, #FF99FF, falls to 4.3 from Sent (protanopia, dark), and the continent and zone categories, in WSJT-X's colours, to 1.4 (New grid on this band and New CQ zone on this band, tritanopia, dark), so RR73's scheme leaves them off. An operator who turns them on gets WSJT-X's colours.
- `highlight-cvd.test.ts` holds RR73's scheme, over the categories it turns on, to 5.5 between categories and 10 from a plain row, and above every other scheme's closest pair.
- Rejected: black for Sent, the search's first pick between categories. Tinted at 30% over the dark theme's background it matched a plain row.

## Earlier defaults

0.8.0 to 0.19.2 shipped WSJT-X's guide colours with every category on: #FF6666, #FF8000, #FFCC99, #3399FF, #99CCFF, #FFE2C8, #66FF66, #C98A1A and #8C93A0. 0.19.3 to 0.19.9 gave a phone still on those RR73's scheme (settings schema 10). Later versions keep stored colours as they are.

## Colours in both themes

- A tint is the colour mixed in sRGB with #FFF at 45% in light and with #0B0D10 at 30% in dark (`--rr-hl-tint-light`, `--rr-hl-tint-dark` in `tokens.css`). Every channel stays at 140 or more in light and 88 or less in dark, so the row's text (#0E1116, #ECEEF2) keeps 5.6:1 and 6.1:1 or more on any colour, including custom ones. On a tint, every column of the row takes the label colour.
- Worked-before text is the chosen colour, darkened toward black in light and lightened toward white in dark, as little as 4.5:1 needs against the tint or the plain row under it.
- 30% in dark leaves room for grey text over a tint: on the CQ tint the default grey stays 1.5:1 or more apart from the row text.
- `highlight-contrast.test.ts` checks every default and palette colour, and a sweep of 4096 colours, in both themes.

## Colours in Sun

Sun, the theme for direct sunlight (Settings › Appearance), asks 7:1 of text and stronger tints.

- A tint is the colour mixed with #FFF at the most share, up to 60%, that keeps its luminance at 0.4 (`sunTint` in `highlight-colour.ts`, set on the row in `--rr-hl-sun`). Black row text keeps 9:1 on any colour; RR73's colours take 50% to 60%, against 45% in light; black takes 34%. A fixed share stronger than light's cannot keep 7:1 for every colour: at 60%, black text on a tint of black falls to 3.7:1.
- Worked-before text keeps 7:1 on a plain row and 4.5:1 on a tint. At 7:1 on a tint it would be near black, as dark as the row text; at 4.5:1 it stays 1.9:1 or more apart from it on every tint of RR73's scheme.
- Rows of older slots take 30% of their colour, and their grey text keeps 7:1.
- The closest pair of RR73's categories, over every vision, is 8.6 ΔE apart in Sun, against 6.4 in light, and the closest to a plain row 13.7, against 10.2 (`highlight-cvd.test.ts`).

## Alternatives rejected

- Worked before as the last category in the order. With every category on, CQ in the message and Ending a QSO take every message it could match, so it never showed.
- Colouring every message's sender for new call and new grid. Most rows on a busy band would be coloured, against the guide's CQ rule.
- One alpha for any tint over any colour, with text colours fixed in CSS. Grey text over a tint cannot keep 4.5:1 for every tint; the text colour has to depend on the tint, so it is worked out per row.
- Exact callsign comparison for new call and worked before. A station worked portable would show as new.
- Every place category on in RR73's scheme, in colours from the search. The best 4 of 512 colours brought the closest pair to 3.8, with pure blue, two browns and a dark teal.

## Open risks

- The country file places a callsign by its prefix. A station in an entity that spans zones (W, VE, UA, VK, BY) counts in its prefix's zone wherever it is, so New CQ zone and New ITU zone can be wrong for it.

- The dark tint at 30% is fainter than the light one. Not tested on a device.
- Worked-before grey over a bright tint in dark comes out close to the row text, 1.5:1 apart on the CQ tint.
- The colour blindness figures come from a simulation. Not tested with operators who have colour blindness.
