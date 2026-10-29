# LQ8

LQ8 is a mode in Operate beside FT8, FT4, WSPR and RTTY: FT8's physical frame with its own Costas array and the LQ message layer, which completes a QSO in 4 messages. RR73 decodes it, transmits it, sequences its QSOs, runs it on the practice band, logs it as `DATA`/`LQ8` and reports it to PSK Reporter as `LQ8`. Not tested on air: there was little LQ8 traffic when this was written (October 2026).

## Sources

- lq_lib by Luis Quesada HB9IPH, MIT licence, commit 00f3bcf: the specification `paper/lq_digitalmode.tex` (sections II to V), `include/lq/*.h`, `src/*.cpp` and the golden vectors in `golden_vectors/`. Read as data; nothing of it was built or run.
- The LQ8 portal, lq8.org, for the dial frequencies and the ADIF fields, as the owner relayed them.
- RR73's own FT8 code for everything LQ8 shares with FT8. No GPL source was read.

## Physical layer

LQ8 is FT8 on the air apart from its sync: 8-GFSK, 6.25 Hz tone spacing, 0.160 s symbols, 79 symbols (12.64 s) in 15 s slots, the Gray map 0 1 3 2 5 6 4 7, the CRC-14 with polynomial 0x2757 over the 77-bit payload zero-extended to 82 bits, the (174,91) LDPC code and no XOR whitening. The Costas array is 2 5 6 1 3 0 4, at symbols 0, 36 and 72 (`tones::LQ8_COSTAS`). Each of these was checked against the reference: `constants.h`, `transport.cpp` (`codeword_to_tones`, `encode_payload`), `crc.cpp`, and every LQ8 golden vector's CRC, codeword and tones (`crates/rr73-ft8/tests/lq8.rs`).

`Mode::Lq8` takes FT8's `ModeParams`. Everywhere the code matches on the mode for a physical parameter (search ranges, block demodulator sets, SNR floors, the subtractor's pulse), LQ8 takes FT8's value. The synthesiser uses FT8's ramp of T/8 at each end; the reference ramps over T/2. The ramp lies inside the first and last symbol and changes no decision at the receiver (Unverified against the reference's decoder).

## Message layer

`rr73_ft8::lq8` ports the reference's message code: the Huffman prefix of the 16 types, the 28-bit standard callsign with its /P flag, base-38 callsigns of up to 9 and 13 characters, the 15-bit locator, the 20-bit CQ modifier, the 5-bit report (−26 to +5 dB), CRC-24/Q hashes in 24 and 20 bits, the 16-bit multiplicative hash, and the 104-character free-text code. `Message::parse` follows `parse_message` rule for rule, and `Display` writes `format_message`'s text. All 49 LQ8 golden vectors the reference publishes round-trip at every layer: text to payload, payload to text, CRC, codeword, tones, and the tones decoded back. They cover 12 types; unit tests cover type 3 and the reserved types 14 to 16.

Where RR73 departs from the reference:

- **A named type 7 target.** The reference hashes `<AB4SS>` in a type 7 call by taking the 24-bit hash and dropping its low 4 bits only when it is 2^20 or more, so a callsign whose CRC-24 is below 2^20 (W1AW, TU2TU) goes out with the wrong 20-bit hash. RR73 hashes a named target in 20 bits from its callsign, as the specification defines. Hexadecimal input is read as the reference reads it.
- **Free text that does not fit.** The reference cuts it short. RR73 refuses it ("free text holds 14 of its 23 characters"), so what goes out is what the operator typed.
- **Unresolved hashes on screen.** The reference shows them in hexadecimal (`<01a4f2>`); RR73 shows `<...>`, as for FT8 (`Message::render`). `Display` keeps the hexadecimal for the golden vectors.

## Callsign hashes

`lq8::CallTable` holds the callsigns heard in full, 4096 at most, and resolves 24-bit and 20-bit hashes to the most recent one. The 16-bit hash names the sender of the multi-station messages; with 65 536 values, a table of every station heard would name the wrong station about once in 16 messages, so it resolves only against the QSO under way: the operator's callsign and the partner's, which `set_qso_context` sets, as the specification asks. The precedence rules of `resolve_callsigns` apply: a type 6 hash never names an unsuffixed standard callsign when the sender is one too, and a type 10 hash never names a standard callsign when the sender is standard. Hashes still unknown at the end of a stage are rendered again with what the slot has taught, as for FT8.

## Decoder

The pipeline is FT8's. LQ8 differs in the layout (its Costas array) and the validator (`validate.rs`, `validate_lq8`):

- The CRC as FT8, then an all-zero payload is refused.
- The reserved types 14 to 16 are refused: nobody sends them, and the specification has receivers ignore them.
- A payload whose unused bits are not zero is refused (types 1 and 2 leave 3 bits, type 8 leaves 4, type 9 leaves 9, type 12 leaves 5). The specification has transmitters zero them; the reference decoder does not check.
- An OSD codeword passes only as type 1, 5, 8 or 9 with callsigns that could have been issued (the FT8 rule's `plausible_callsign`). FT8's rules that read FT8 message bits (`standard-hf`'s R before a locator) have no LQ8 counterpart. `standard-known` reads as `standard`: the validator holds no LQ8 table.
- A priori decoding is off in LQ8: its hypotheses are FT8 messages (`ap.rs`).

FT8, FT4 and WSPR decoding is unchanged. Every CI gate run (`baseline`, `subtract-3-osd2`, the later stages, a priori, early, FT4 early, WSPR) gives the same decodes in every field and counter before and after the change (`rr73-bench compare --exact`, 0 slots differ), so no gate file was recorded again.

### Measurements

`rr73-bench run --synth lq8-sweep --per-step 160 --noise-count 5000` against `--synth snr-sweep --synth noise` with the same counts, on 2026-10-29 (aarch64 container): 3360 slots per sweep, one random message per slot at −28 to −8 dB, and 5000 noise slots. The random messages are FT8's standard ones, which LQ8 reads as its own types.

| Plan | Set | LQ8 SNR50 | FT8 SNR50 | LQ8 false | FT8 false |
| --- | --- | --- | --- | --- | --- |
| `subtract-3-osd2` | White noise | −21.3 dB | −21.3 dB | 0 | 0 |
| `subtract-3-osd2` | Watterson fading | −18.7 dB | −18.5 dB | 0 | 0 |
| `subtract-3-osd2` | Noise only | | | 0 in 5000 | 0 in 5000 |
| App plan (preset and later stages) | White noise | −21.5 dB | −21.5 dB | 0 | 0 |
| App plan | Watterson fading | −18.9 dB | −18.8 dB | 2 | 1 |
| App plan | Noise only | | | 0 in 5000 | 0 in 5000 |

LQ8 decodes as FT8 does, within 0.2 dB. OSD finds 8% of the decodes in both modes. An earlier run of 840 slots per sweep gave one LQ8 false decode, `8Q9NGY PF6AXM FJ12 -14` from OSD in the second stage: a type 5 call. Half of all random payloads carry type 5's 1-bit prefix, and almost every value of its fields is a valid callsign, locator and report, so LQ8's OSD rule passes more random codewords than FT8's. The larger run puts both modes at 1 or 2 false decodes in 6720 slots with a signal.

## The app

**Operate.** LQ8 is a mode in the band sheet, with the portal's dials on 40m to 10m (7.084, 10.146, 14.084, 18.106, 21.084, 24.925 and 28.084 MHz, USB) and a dial of the operator's own per band, as FT8 and FT4. On a band without an LQ8 dial the band sheet falls back to FT8, as FT4 does on 160m. Slots are FT8's: 15 s, even and odd, the same late-start and shift limits, early pass at 13.5 s and the later stages.

**The QSO.** The sequencer runs LQ8 in the machine FT8 uses (`docs/design/sequencer.md`), with LQ8's messages in its slots: Tx1 the call with grid and report (`AB4SS 9V1NE OJ11 -11`), Tx3 REPORT+73 (`AB4SS 9V1NE R-11`), Tx5 73, Tx6 CQ. Tx2 and Tx4 stay empty and the messages sheet lists the 4. Incoming, LQ8's call reads as a report with a grid and REPORT+73 as an R-report that ends the QSO.

```text
Answering:  CQ AB4SS FN42  ->  AB4SS 9V1NE OJ11 -11  ->  9V1NE AB4SS R+05 (logged)  ->  AB4SS 9V1NE 73
Calling CQ: CQ 9V1NE OJ11  ->  9V1NE AB4SS FN42 -15  ->  AB4SS 9V1NE R-14  ->  9V1NE AB4SS 73 (logged)
```

- Answering, the QSO logs when their REPORT+73 arrives, and our 73 follows; the specification logs on sending 73, a slot later. Without their REPORT+73 the call repeats up to the retry limit.
- Calling CQ, the QSO logs on their 73, as the specification says: only their 73 shows that our report arrived. A caller who calls again gets REPORT+73 again; one who stays silent after 3 repeats is dropped unlogged. Log QSO in the audio banner covers a QSO whose 73 was lost.
- A multi-station message (`<OE3OGC> R+05 <9V1NE> R-03 <AB4SS>`, `<OE3OGC> <9V1NE> <AB4SS> 73`) counts as REPORT+73 or 73 to us when one of its targets is us and its sender is the partner. RR73 does not send them.
- Hunt, Repeat CQ, dupes, the watchdog and Halt work as in FT8. Lost station and tail-end take REPORT+73 and 73 as the end of the other QSO: after a station sends REPORT+73 to another, its next slot is the other's 73, so the tail-end call goes there.
- Hound, Contest exchange, Confirm with (RR73 or RRR) and a priori decoding are FT8 and FT4 only, and hide in LQ8.
- Free text goes from an edited message, up to about 17 characters; longer text is refused.

**The decode list and the waterfall.** Colours, the New and Worked marks, the filters and the waterfall's callsigns read LQ8's text as FT8's. A multi-station message to us is marked as ours with its sender in bold. Worked-before counts LQ8 as its own mode.

**Practice band.** In LQ8 the practice stations run LQ8 QSOs: a caller sends grid and report, the station calling CQ answers with REPORT+73, the caller ends with 73. Every scenario but Contest exchanges and Fox runs in LQ8; those two run the random band. "Caller misses RR73" becomes "Caller misses R-report": the caller calls again after the first REPORT+73.

**Logging.** QSOs log as `<MODE:4>DATA <SUBMODE:3>LQ8`, as the portal specifies, and an ADIF import reads a bare `MODE` of `LQ8` the same way. Wavelog gets the same ADIF.

**PSK Reporter.** Spots of LQ8 decodes carry mode `LQ8`. QSP refused any mode but FT8 and FT4 and now takes LQ8 too, so LQ8 spots need a relay at this version.

**Spots.** A spot whose mode or comment names LQ8 reads as LQ8, and Go takes Operate to LQ8 on its band. The frequency alone never says LQ8: the 17m LQ8 dial sits 2 kHz above FT4's, and an FT4 signal there would read as LQ8.

## Alternatives rejected

- **A separate LQ8 sequencer.** Hunt, Repeat CQ, tail-end, dupes, the watchdog and the retries would have been written twice. LQ8's messages map onto the existing machine's steps, with three rules of its own (`replyLq8`).
- **Logging on our REPORT+73 when calling CQ**, as FT8 logs on RR73. FT8's R-report proves our report arrived before RR73 goes; in LQ8 nothing does until their 73.
- **LQ8 a priori decoding.** Its whole messages (`9V1NE AB4SS 73`) would cost little, but every hypothesis needs its own false-decode measurement. Left for when LQ8 is on the air.
- **Detecting LQ8 spots by frequency**: see Spots above.

## Open risks

- Not tested on air or against another LQ8 implementation. The codec matches the reference's golden vectors, which the reference generated itself.
- Unverified: whether Wavelog accepts `MODE` `DATA` with `SUBMODE` `LQ8`. Wavelog checks modes against its own table; a QSO it refuses shows Wavelog's reason under To do, and one it stores with another mode would break its dupe check and confirmations.
- The reference's text rules read some free text as messages: four words ending in 73 are MULTI-73 (`TNX FER QSO 73`), and `73 GL OM` is a 73 to `GL`. RR73 keeps them for compatibility; free text that reads as a message goes out as that message.
- A bracketed callsign of hexadecimal letters and digits (`<DB1ABC>`) reads as a hash, as in the reference.
- The 16-bit hash names only the QSO partner, so a Fox's multi-station message to someone else shows its sender as `<...>`.
- The relay must run this version for LQ8 spots to reach PSK Reporter.
- The dials are the portal's; IARU band plans name none yet. Unverified against on-air use.
