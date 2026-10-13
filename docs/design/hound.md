# Hound mode

Hound mode works a DXpedition that runs WSJT-X's FT8 DXpedition mode as the Fox. It is a switch per band, in the band sheet and in Operate's ••• menu, stored and off by default, and applies to FT8 only. The top bar shows "FT8 Hound" while it is on. Code lives in `web/src/lib/qso/sequencer.ts` (`houndDecide`), `web/src/lib/qso/messages.ts` (`parseParts`) and `web/src/lib/practice/fox.ts`.

## Sources

- K1JT, "FT8 DXpedition Mode User Guide", 16 May 2018, written for WSJT-X 1.9 (wsjt.sourceforge.io/FT8_DXpedition_Mode.pdf). The frequency rules, the message sequence, the Fox's retry limits and the Hound's steps come from it.
- WSJT-X 2.7.0 User Guide, section 1.1, for SuperFox.
- K1JT, K9AN and DL3WDG, "SuperFox User Guide", 17 February 2025, and K1JT and K9AN, "SuperFox and FT8: Weak-Signal Performance", 6 September 2024.
- WSJT-X 2.7.0-rc3's `ft8sim` and `jt9`, run in the `wsjtx` container, for the message bits. No GPL source was read.

The 2018 guide predates WSJT-X 2.0's 77-bit messages. Its message sequence and frequency rules carry over; the multi-call message is now type 0.1 (`K1ABC RR73; W9XYZ <KH1/KH7Z> -08`), pinned against ft8sim below.

## Decision

**Messages.** rr73-ft8 already packed every message a Hound sends and reads. `tools/wsjtx/cases.txt` now holds a Hound's whole QSO, and `crates/rr73-ft8/tests/hound.rs` checks each against ft8sim's bits: the Fox's CQ with a compound callsign (type 4) and a standard one, the call `KH7Z K1ABC FN42`, the Fox's report with its callsign in full or hashed (`K1ABC <KH1/KH7Z> -14`), the R-report, RR73 alone, the multi-call message for a compound and a standard Fox, and a Hound with a compound callsign (`<KH7Z> W2/G4XYZ`, `KH7Z <W2/G4XYZ> R-11`). jt9 decodes rr73-ft8's multi-call message for a standard Fox and the compound Hound's call (`fixtures/ft8/wsjtx_decodes.json`). Without the Fox's callsign in its hash table, jt9 and rr73-ft8 both show the Fox as `<...>`; the test checks that the CQ resolves it.

Writing these tests found a bug: an even report below −30 dB wrapped in the multi-call message's 5-bit field, so −32 went out as +32. rr73-ft8 now refuses it.

**Reading the Fox.** `parseParts` splits a multi-call message into two exchanges from the Fox: RR73 to the first station and a report to the second. A part counts as the Fox's when it carries the Fox's callsign, or `<...>` in a multi-call message, which only a Fox sends. A Hound QSO looks only at parts addressed to us, so the Fox working other Hounds, up to 5 streams a slot, never triggers the lost-station notice or a tail-end call.

**Calling.** Tx1 is `<Fox base callsign> <me> <grid>`: the guide has Hounds call a compound Fox (KH1/KH7Z) by its base callsign (KH7Z). Tx1 goes out at the Tx frequency when that is 1000 Hz or above, and at 1000 Hz otherwise, because a Fox does not answer first calls below 1000 Hz. Turning Hound on moves a Tx frequency below 1000 Hz to 1000 Hz, and a Tx frequency chosen on the waterfall stays at 1000 Hz or above. Calling the Fox moves Rx to it and leaves Tx where it is. Tx1 repeats until the Fox answers: the guide says to keep calling, and the watchdog ends it as usual.

**The report.** A report to us, alone or in a multi-call message, gets Tx3 (`KH7Z K1ABC R-11`) at the frequency the Fox sent it on, in the 300 to 900 Hz range. The guide moves later R-reports "300 Hz higher or lower" without saying which; RR73 moves 300 Hz up when that stays at or below 900 Hz, the top of the Fox's range, and 300 Hz down otherwise. A report repeated on another stream moves the R-report to that stream, 300 Hz away. The R-report repeats up to the retry limit (3), then calling stops with "No RR73 from KH7Z after 3 repeats. Not logged." and Tx turns off. The Fox sends RR73 up to 3 times to a Hound that repeats its R-report, so 4 R-reports cover it.

**Logging.** The Fox's RR73 to us, alone or in a multi-call message, logs the QSO once we have its report, and Tx turns off. No 73 goes out. An RR73 before any report to us is ignored: the Fox sends RR73 only after hearing an R-report.

**Status.** The status line names the stage: "Calling the Fox · KH1/KH7Z", "Report received · −12 dB from KH1/KH7Z", "Logged · KH1/KH7Z". The QSO steps end with Logged.

**Switching.** Turning Hound on or off, or moving between a Hound band and another, ends the QSO in progress and stops Tx, as a mode change does: the frequencies and the exchange differ.

**Practice.** The practice band's "Fox (DXpedition)" scenario replaces the band with a Fox and its Hounds (`practice/fox.ts`). The Fox transmits in even slots on 3 streams from 300 Hz, 60 Hz apart, each 9.5 dB below its full SNR. It answers Hounds calling at 1000 Hz or above, sends RR73 alone or with the next Hound's report, drops a Hound after 3 reports, and calls CQ alone in its first slot and every 8th. 3 to 6 Hounds call it in each odd slot between 1000 and 2850 Hz. It answers the operator after 2 to 4 calls; per band, the report comes in a multi-call message or alone.

## Alternatives rejected

- **Sending Tx3 with Tx off.** WSJT-X sends the R-report even when Enable Tx is off. RR73 transmits only after an operator action and stops at the watchdog, Halt and an audio stop; a Fox that answers after those gets no reply.
- **The guide's 2-minute Enable Tx rule.** The watchdog keeps the operator's limit, 6 min by default, as in every other mode.
- **Treating `<...>` as the Fox in every message.** Standard messages from unknown hashes come from many stations; only the multi-call message is the Fox's alone.
- **Tx1 at a random frequency.** 1000 Hz or the operator's own frequency is predictable and shows on the waterfall.

## SuperFox

No public description of the SuperFox waveform or its message format exists, so RR73 has no SuperFox decoder. What is published:

- The SuperFox User Guide gives operation only: a constant-envelope signal 1512 Hz wide, its lowest tone at 750 Hz, in even slots; up to 9 Hounds per transmission, of which up to 4 get reports and the rest RR73; a CQ, free text of up to 26 characters, and a one-time password checked against a server at 9dx.cc. Hounds call anywhere from 200 to 3000 Hz, and their frequency does not move after the Fox calls them.
- The performance note gives a tone spacing "nearly twice that of FT8", noncoherent demodulation and decoding curves 3 to 4 dB above single-stream FT8.
- The WSJT-X 2.7.0 User Guide repeats the 9 Hounds and a system gain of about 10 dB over a 5-stream Fox.
- WSJT-X's reference list (wsjtx.github.io/wsjtx/refs.html, 34 entries, read 2026-10-14) has no SuperFox paper; its only protocol paper is the FT4 and FT8 QEX article of 2020. Web searches for a SuperFox protocol description, frame structure or code found nothing.

A decoder needs the tone count and symbol rate, the sync pattern, the error-correcting code, the CRC, the bit layout of calls, reports, hashes, CQ and free text, and the password's format. None is published. The SuperFox code is open source, inside WSJT-X, under the GPL, which this project does not read. The `wsjtx` container's WSJT-X 2.7.0-rc3 predates SuperFox (2.7.0-rc5), so there is no reference signal to measure either.

Classic Fox and Hound ships. A Hound can call a SuperFox, which hears normal FT8, but RR73 cannot decode its reply, so the QSO never completes.

## Open risks

- Not tested on a device or against a real Fox.
- The guide is from 2018. WSJT-X 2.x Hound behaviour that it does not describe, such as when a repeated R-report moves, is Unverified.
- DXpeditions announce their own dial frequency. The band sheet shows the usual one, and QSOs record it with the right band and the wrong dial frequency.
- A Hound with a compound callsign sends Tx1 with its callsign hashed; the Fox may not know the hash. Not tested.
- The R-report goes below 1000 Hz. A radio whose transmit filter starts above 300 Hz attenuates it.
