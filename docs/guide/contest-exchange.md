# Contest exchange

Type your exchange in Contest exchange, in Settings › FT8 and FT4, as you would say it on the air. Leave it empty outside contests and RR73 sends and reads standard messages only.

## What to type

- Field Day: your class and ARRL or RAC section, such as `1D WI`. The class is 1 to 32 transmitters and a letter from A to H.
- RTTY Roundup and FT Roundup: your US state or Canadian province, such as `WI`. Outside the US and Canada, type `#` to send a serial number.
- European VHF contests: `#`, for a serial number and the 6-character grid from Settings › Station.

Each format takes the parts it needs, so `1D WI` works for Field Day and the Roundups. The rows under the field show what goes out to a station at −10 dB, and name any missing part, such as Exchange needs a section.

## When it is used

The exchange goes out when a station calls CQ FD or CQ RU, or sends you an exchange.

- Answering CQ FD or CQ RU, your first message carries the exchange in place of your grid.
- Answering any other CQ, Tx1 carries your grid. A reply with an exchange moves the QSO to that format.
- Calling CQ, each caller's first message sets the format. Edit Tx6 in Edit messages to call CQ FD.
- A grid in a reply moves the QSO back to standard messages.

## What goes on air

Field Day, class and section:

- `K1ABC 9V1NE 1D WI`
- `K1ABC 9V1NE R 1D WI`

Roundups, report with state or serial number:

- `K1ABC 9V1NE 579 WI`
- `K1ABC 9V1NE 579 0013`

European VHF, report, serial number and grid, with both callsigns hashed:

- `<K1ABC> <9V1NE> 570013 OJ11AB`
- `<K1ABC> <9V1NE> R 570013 OJ11AB`

The second message of each pair is the R-exchange. RR73, RRR and 73 go out as usual, with both callsigns in full.

The report digit follows the station's SNR in 4 dB steps from 2 to 9, with 7 at −10 dB. Your exchange is fixed once it first goes out in a QSO.

If Contest exchange lacks a part the QSO needs, the exchange messages stay empty, nothing goes out and the status line names the part, such as `Exchange needs a section`. The message goes out once you type it in.

## Serial numbers

Next serial number shows under the exchange while it is set, starting at 1.

- It goes out as 4 digits, such as 0013.
- It counts up by 1 each time a QSO that sent it is logged. An unlogged QSO leaves it for the next.
- The Roundup format takes 1 to 7999 and the VHF format 0 to 2047. Outside those the status line says `Serial number out of range`.
- Type a new number to change it.

## In the log

- Exchange sent and Exchange received: the exchange without the report, such as `1D WI` or `0013 OJ11AB`.
- Report sent and Report received: the report as on air, such as 579 or 57. Empty for class and section.
- Their grid: the grid of a VHF exchange.

ADIF export writes a serial number to STX and SRX and any other exchange to STX_STRING and SRX_STRING. An exchange that starts with a serial number goes to both.
