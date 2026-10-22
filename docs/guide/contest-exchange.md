# Contest exchange

Contest exchange, in Settings › FT8 and FT4, holds your exchange as you would say it on the air. Leave it empty outside contests. Empty, RR73 sends and reads standard messages only.

## What to type

- Field Day: your class and ARRL or RAC section, such as `1D WI`. The class is 1 to 32 transmitters and a letter from A to H.
- RTTY Roundup and FT Roundup: your US state or Canadian province, such as `WI`. Outside the US and Canada, type `#` to send a serial number.
- European VHF contests: `#`. The exchange sends a serial number and the 6-character grid from Settings › Station.

Each format takes the parts it needs and ignores the rest. `1D WI` serves Field Day and the Roundups, as WI is both a section and a state.

Under the field, a row for each format shows what goes out to a station heard at −10 dB. A row that lacks a part names it, such as Exchange needs a section.

## When it is used

The exchange goes out when a station calls CQ FD or CQ RU, or sends you an exchange.

- Answering CQ FD or CQ RU, your first message carries the exchange in place of your grid.
- Answering any other CQ, Tx1 carries your grid. A reply with an exchange moves the QSO to that format.
- Calling CQ, Tx6 goes out as written. Each caller's first message sets the format. To call CQ FD, edit Tx6 in Edit messages.
- A grid in a reply moves the QSO back to standard messages.

## What goes on air

Class and section, for Field Day:

- `K1ABC 9V1NE 1D WI`
- `K1ABC 9V1NE R 1D WI`

Report with state or serial number, for the Roundups:

- `K1ABC 9V1NE 579 WI`
- `K1ABC 9V1NE 579 0013`

Report, serial number and grid, for European VHF contests:

- `<K1ABC> <9V1NE> 570013 OJ11AB`
- `<K1ABC> <9V1NE> R 570013 OJ11AB`

The first message of each pair is the exchange, the second the R-exchange. RR73, RRR and 73 go out as in any QSO, with both callsigns in full. The VHF format sends both callsigns as hashes.

The report digit follows the station's SNR in steps of 4 dB, from 2 to 9, with 7 at −10 dB. Your exchange is fixed once it first goes out in a QSO, as a report is.

The steps row reads Exchange and R exchange in place of Report and R-report, with the exchanges once known.

When Contest exchange lacks a part the QSO needs, the exchange messages stay empty and nothing goes out. The status line names the part, such as `Exchange needs a section`. Once you type it in, the message goes out.

## Serial numbers

Next serial number shows under the exchange while it is set. It starts at 1.

- The number goes out as 4 digits, such as 0013.
- It counts up by 1 each time a QSO that sent it is logged. A QSO that is not logged leaves it for the next.
- The Roundup format takes 1 to 7999, and the VHF format 0 to 2047. Outside those, the status line says `Serial number out of range`.
- Type a new number in Next serial number to change it.

## In the log

- Exchange sent and Exchange received hold the exchanges without the report, such as `1D WI`, `WI`, `0013` or `0013 OJ11AB`.
- Report sent and Report received hold the report as on air, such as 579 or 57. They stay empty for class and section.
- The grid of a VHF exchange goes in Their grid.

ADIF export writes a serial number to STX and SRX, and any other exchange to STX_STRING and SRX_STRING. An exchange that starts with a serial number, such as `0013 OJ11AB`, goes to both.
