# 0006. Settings per mode family

Status: accepted, 2026-10-13

## Context

Settings › FT8 and FT4 holds Confirm with, Work dupes in Run and Hold Tx frequency, which only the FT8 and FT4 sequencer uses. WSPR, PSK31, RTTY and CW each need settings and controls of their own.

## Decision

- Settings are split by scope. Station, Radio and audio, Logging, Optional features and Appearance apply to every mode.
- Mode settings live per family under Settings › Modes:
  - FT8 and FT4, the WSJT-X sequencer: confirm with, work dupes, hold Tx, CQ slot, answer order, and Rx and Tx Hz per mode.
  - WSPR: Tx percentage, power in dBm and band hopping.
  - PSK31 and RTTY: macros, AFC, squelch, shift and baud.
  - CW: WPM, macros and tracking range.
- Operate keeps its frame: top bar, waterfall, list and bottom bar. The mode supplies the list and the controls. FT8 and FT4 get a decode list with Tx, CQ and Run. Keyboard modes get a receive text pane and macros. WSPR gets a table of stations heard.
- Halt, the watchdog and decode colours apply to every mode that transmits or names callsigns.
- Stored settings take the new structure when the second family lands, likely WSPR, with a one-time migration from today's flat fields.

## Since

- 14 October 2026: the stored settings did not move. WSPR's settings arrived as their own object beside the flat FT8 and FT4 fields (docs/design/wspr.md, Settings).
- 13 October 2026: CW was dropped; the owner uses another app for CW. PSK31 waits for the secondary modes stage, and joins the keyboard family with RTTY.

## Alternatives rejected

- Restructuring now, before a second family exists.
- One global Operating section for every mode.

## Open risks

- JS8 is FT8-based underneath but used as a keyboard mode, so its family is not settled.
- The per-mode Rx and Tx Hz defaults are unverified for FT4.
