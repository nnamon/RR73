# Decode colours

Operate colours each decode as WSJT-X does. Settings › Decode colours sets the categories, their order and their colours. Code: `web/src/lib/decode/highlight.ts` (categories and matcher), `highlight-colour.ts` (text colours), `web/src/lib/log/worked.ts` (log index), `web/src/views/DecodeColours.svelte`.

## Decision

- Background categories come in priority order. The first enabled category that matches a decode tints its row: a 4 px bar in the colour and a tint behind the text.
- Worked before is a text layer outside the order. It greys the text of any decode whose sender is in the log on this band and mode, over whatever background the row has. A CQ from a station already worked shows green with grey text.
- New call, new grid and ending a QSO look at the station sending a CQ, 73 or RR73. Worked before looks at the sender of any message. No category treats the operator's own callsign as a sender.
- My call matches the operator's callsign in any position, with prefixes and suffixes (9V1NE/P, VK3/9V1NE) and as a hashed call.
- Own transmissions match only Sent, and received decodes never match it, so its place in the order changes nothing.
- Calls compare by base callsign: a QSO with ZL1TQK/P counts for ZL1TQK. Grids compare by their first 4 characters.
- Every category is on by default. Settings schema 3 turns them all on, at the defaults below, on phones that ran 0.7.
- The log is indexed once per change of the log, in sets of calls (any band, per band, per band and mode) and grids (any band, per band), so each row costs a fixed number of set lookups.
- Each category stores one colour, #RRGGBB. The decode rows carry the result as `data-hl` (background), `data-ink` (text layer) and the classes `rr-hl` and `rr-ink`, so a change of row layout does not touch the matcher.

## Categories and defaults

Sources: WSJT-X User Guide for version 2.7.0 (`wsjtx-main-2.7.0.html`). Section 4.7 Colors shows the Colors tab in a screenshot; the colours below are read from its pixels, as the text gives no values. Section 6.3 FT8 says CQ decodes are highlighted in green and decodes with your call in red, and its screenshot gives the shades.

| Order | Category | Default | Source |
| --- | --- | --- | --- |
| 1 | My call in the message | #FF6666 | 4.7 screenshot, 6.3 screenshot and text |
| 2 | New grid | #FF8000 | 4.7 screenshot |
| 3 | New grid on this band | #FFCC99 | 4.7 screenshot |
| 4 | New call | #3399FF | Unverified: colour and position |
| 5 | New call on this band | #99CCFF | Unverified: colour and position |
| 6 | Ending a QSO | #FFE2C8 | Unverified: an RR73 category with no WSJT-X counterpart |
| 7 | CQ in the message | #66FF66 | 6.3 screenshot and text; position Unverified |
| 8 | Sent | #C98A1A | Unverified: the app's amber Sent colour |
| Text | Worked before | #8C93A0 | Unverified: an RR73 layer with no WSJT-X counterpart |

- Order. The 4.7 screenshot shows the top of the list: My Call in message, New Continent, New Continent on Band, New CQ Zone, New CQ Zone on Band, New ITU Zone, New ITU Zone on Band, New DXCC, New DXCC on Band, New Grid, New Grid on Band. The rest of the list is scrolled out of view. Unverified: the order of New Call, New Call on Band, LoTW User, CQ in message and Transmitted message. Section 6.4 recommends "My Call in message, New DXCC, New Call on Band, CQ in message and Transmitted message, reading from top to bottom" for contests, which agrees with the order above.
- Each category keeps its WSJT-X position as a rank, with gaps for the categories that need reference data: new continent (2, 3), CQ zone (4, 5), ITU zone (6, 7), DXCC (8, 9), each overall and on the band, and LoTW user (14). When they ship, stored settings take each one after the last stored category that ranks above it.
- Which messages. Section 4.7: "WSJT-X uses colors to highlight decoded CQ messages of particular interest." Its screenshot shows "Highlight also messages with 73 or RR73" ticked; whether that is the default is Unverified.
- On by default. The 4.7 screenshot shows only My Call in message ticked among the rows in view. RR73 turns every category on.
- Sent. The guide gives no colour for Transmitted message. Unlabelled yellow rows (#FFFF00) appear in the 9.4 Q65 screenshot. RR73 keeps its amber.

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
- New call, New call on this band, Ending a QSO and Sent default colours, and the positions of New call, CQ and Sent, are Unverified against a running WSJT-X.
