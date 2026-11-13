# LQ8

LQ8 uses FT8's signal with its own sync and messages that carry more, so a QSO takes 4 messages, or 60 s. Choose LQ8 in Change band. It has dials on 40m to 10m only, and on other bands the sheet switches to FT8. Few stations run LQ8 yet, so try it on the practice band first.

| Band | Dial |
| --- | --- |
| 40m | 7.084 MHz |
| 30m | 10.146 MHz |
| 20m | 14.084 MHz |
| 17m | 18.106 MHz |
| 15m | 21.084 MHz |
| 12m | 24.925 MHz |
| 10m | 28.084 MHz |

Set the radio to USB at the dial shown, as for FT8. The slots are FT8's, 15 s long and alternating even and odd.

## Answering a CQ

```ladder
Them: CQ AB4SS EM73
You: AB4SS 9V1NE OJ11 -11 | Tx1: your grid and their report, after a double-tap
Them: 9V1NE AB4SS R+05 | Their report and 73. Logged
You: AB4SS 9V1NE 73 | Tx5, then Tx goes off
```

If they don't reply, Tx1 repeats up to 3 times.

## Calling CQ

```ladder
You: CQ 9V1NE OJ11 | Tx6, after a tap on CQ
Them: 9V1NE AB4SS EM73 -14 | Their grid and your report
You: AB4SS 9V1NE R-12 | Tx3: their report and 73
Them: 9V1NE AB4SS 73 | Logged
```

A caller who calls again has missed your Tx3, and RR73 sends it again. If a caller goes silent through 3 repeats, RR73 drops them without logging, because only their 73 shows that your report arrived. Repeat CQ, Hunt and tail-end work as in [Making QSOs](making-qsos.md).

## Hashed callsigns

When a message has a portable or compound callsign in it, the other callsign goes as a hash. RR73 shows `<...>` for a hashed callsign until it has heard it in full, and your own callsign always shows.

```ladder
Them: CQ AB4SS EM73
You: <AB4SS> 9V1NE/P OJ11 -11 | A portable call hashes the station called
```

## Messages to several stations

A station working a pile-up can confirm 2 callers in one message. RR73 reads the part with your callsign as their report and 73, and logs the QSO as usual.

```ladder
You: AB4SS 9V1NE OJ11 -11
Them: <...> R-03 <9V1NE> R+05 <AB4SS> | Your report is the second
You: AB4SS 9V1NE 73
```

## Free text

To send free text, edit a message in Edit messages and type the text. LQ8 fits up to about 17 characters, and common letters take less room. RR73 refuses longer text and tells you how much fits.

## What LQ8 lacks

Hound, Contest exchange, Confirm with and a priori decoding work in FT8 and FT4 only, and RR73 hides them in LQ8.

LQ8 QSOs log as mode `DATA` with submode `LQ8`. POTA files write them as `MFSK` with no submode, because POTA requires that. PSK Reporter spots carry `LQ8`.
