# QSO sequencer

The sequencer decides what RR73 transmits and when. It covers answering a station (search and pounce), calling CQ, Run and Hunt. It is a pure state machine in `web/src/lib/qso/`: events in, new state and effects out, no timers or audio inside, so every rule is unit-tested against slot timelines.

## Messages

| Slot | Text | Sent when |
| --- | --- | --- |
| Tx1 | `<DX> <ME> <grid>` | Calling a station that called CQ. |
| Tx2 | `<DX> <ME> <report>` | Answering a station that called us with a grid. |
| Tx3 | `<DX> <ME> R<report>` | Acknowledging the report we received. |
| Tx4 | `<DX> <ME> RR73` | Confirming the exchange; `RRR` if the operator prefers. |
| Tx5 | `<DX> <ME> 73` | Closing after the other station's RR73 or RRR. |
| Tx6 | `CQ [modifier] <ME> <grid>` | Calling CQ. The modifier is optional: `DX`, `POTA`, `SOTA`, a number. |

Messages are built with `rr73-ft8` through `rr73-wasm`, which also validates operator edits. Reports are the SNR of the other station's last decode, rounded to whole dB and clamped to −50 to +49.

## Flows

**Answering a CQ.** Tx1 → their report → Tx3 → their RR73 or RRR → Tx5. If they send `R<report>` directly, we answer Tx4. If they send RR73 after our Tx1, the QSO is incomplete and is not logged.

A station the operator calls by hand always follows the answering path, also while calling CQ: the double-tap ends CQ until that QSO is done, and the CQ button shows off. On the air, calling VK2LAW from CQ stayed in the CQ flow and went back to CQ after the repeats ran out.

**Calling CQ.** Tx6 → a caller's grid → Tx2 → their `R<report>` → Tx4 → their 73 or silence. A caller who sends a report first gets Tx3; a caller who sends `R<report>` first gets Tx4. CQ repeats while nobody calls. A caller who repeats `R<report>` after our RR73 gets RR73 again.

**Run.** A switch in Operate's ••• menu, stored, off by default. It decides what follows a QSO from CQ:

- On: a station that called in the slot just decoded is answered in the very next slot, or Tx6 goes out when none did. The callers of that slot queue in the order the operator chose: First (decode order), Strongest, Farthest, New (new DXCC, grid or call first). Dupes for the band and mode in the current activation, or in the UTC day outside an activation, are skipped unless the operator works dupes.
  - Only the latest slot's callers count, as with Run off. Until 0.14.3 a caller stayed queued for 4 slots, but on the air a station that loses a pileup usually moves on to another CQ, and a report to one that has gone repeats into silence for up to 4 transmissions, 2 min of FT8, before the drop. A station that still wants the QSO calls in the next slot or answers the next CQ.
  - The decode list marks the callers waiting on their latest message to you, where a CQ row has its country: Next in the tint, then 2nd, 3rd in grey, and Dupe for one Repeat CQ skips. The station being worked has no mark. Until 0.14.2 a panel at the top of the list repeated those messages in answering order; with one caller it only repeated the row under it, so it went.
- Off: Tx turns off once the QSO ends, as WSJT-X does with "Disable Tx after sending 73".
- A station called by hand from CQ returns to CQ after it is logged only with Run on. An unanswered or lost call never returns to CQ.

Run was a button that started CQ. It became a setting because the CQ button already starts CQ, and the owner wants WSJT-X's choice between stopping after 73 and carrying on.

**Hunt.** A main button. Hunt answers CQs one after another until the operator stops it:

- At each final decoding pass with nobody in a QSO, it calls the first CQ in Hunt's order among the plain CQs heard in the slot just decoded, in the next slot of the opposite parity. Hunt started within the late-start window of a slot picks from the slot before at once.
- It skips stations heard sending anything other than CQ in that slot (in a QSO), dupes (as for Run), and stations that ignored Hunt in the last 10 min: no reply after the repeats, or a second answer to another station while Hunt called them.
- Orders, chosen in •••: Not worked (on this band and mode on any day, then strongest; the default), Strongest, Newest (the station whose run of CQs started most recently), Farthest, New call (never worked).
- Plain CQ only. CQ DX, CQ NA, CQ POTA and other CQs with a modifier are skipped until reference data can say whether the operator is the station asked for.
- Hunt and CQ stop each other. Starting Hunt during a QSO lets the QSO finish and picks after it. Stopping Hunt during a QSO lets it finish, then Tx goes off. Halt, End QSO, an audio stop and the watchdog stop Hunt.
- The status line names the state: "Hunt · calling VJ6X (−12 dB) · 2 QSOs".

**Hound.** A switch per band, in the band sheet and •••, for working a DXpedition in FT8 DXpedition mode (`docs/design/hound.md`). Tx1 goes to the Fox's base callsign at 1000 Hz or above and repeats until the Fox answers. The Fox's report to us, alone or inside its multi-call message (`K1ABC RR73; 9V1NE <KH1/KH7Z> -08`), gets Tx3 at the frequency the Fox sent it on; repeats move 300 Hz. The Fox's RR73 to us logs the QSO and Tx turns off, with no 73. Only parts addressed to us count, so the Fox working other Hounds never reads as a lost station or starts a tail-end call.

**Lost station.** When the station we call, before it has answered us, sends a report, `R<report>`, RR73, RRR or 73 to another station, calling stops and a notice names it: "VK2LAW answered DV5CEL." A CQ or a call with a grid from that station is not a QSO under way, and calling continues.

**Tail-end.** A setting, on by default. After a lost station sends RR73, RRR or 73 to the other station, or calls CQ, the sequencer calls it once more in the next slot of the opposite parity, with the late start allowed. One unanswered call ends the attempt. Nothing goes out while the station is in its QSO, Tx on included. Waiting ends after 8 slots. With tail-end off, the call pauses at once. Hunt never tail-ends: it moves on to the next CQ as soon as the station it calls answers another, whatever the setting, because another CQ is a quicker QSO than waiting out theirs.

## Timing

- Our transmissions use one slot parity: the opposite of the station we answer, or the parity the operator chose for CQ.
- A transmission starts 0.5 s after its slot boundary, scheduled on the audio clock.
- Late start: when the decision for a slot is made after its start (decodes arrive about 0.1 to 0.5 s after the previous slot ends, and a tap on a decode comes seconds later), the transmission may start up to 4 s late in FT8 and 1.25 s late in FT4, that is up to 4.5 s and 1.75 s into the slot. Later than that it moves to the next slot of the same parity, and the dock says which.
  - Up to 1.5 s late in FT8 and 0.5 s in FT4 the whole message goes out late. Later, it keeps its place in the slot and leaves out its first part, faded in over 5 ms, so it ends on time with DT near 0.
  - Measured with the `late-start` bench set (docs/bench.md), 25 slots per cell, WSJT-X 2.7.0-rc3's `jt9 -d 3` as the receiving station, SNR50 being the level at which half decode:

    | | On time | Whole, late | First part left out |
    | --- | --- | --- | --- |
    | FT8 | -21.2 dB | -20.1 dB at 2.0 s; at 2.5 s jt9 decodes 15 of 25 at -8 dB; from 3 s none | -20.3 dB at 2.0 s, -19.7 at 3.0, -18.6 at 4.0, -15.7 at 5.0, -8.6 at 6.0 |
    | FT4 | -17.7 dB | -17.1 dB at 0.875 s; from 1.0 s none, at any level | -16.0 dB at 1.0 s, -15.7 at 1.25, -14.2 at 1.5, -12.3 at 2.0 |

  - At the limits jt9 decodes every slot at -16 dB and stronger in FT8 and -12 dB in FT4, and the late start costs 2.6 dB (FT8) and 2 dB (FT4) at the weak end. A reply that weak would otherwise wait 30 s (FT8) or 15 s (FT4).
  - Our own decoder loses more with the first part left out: SNR50 -19.4 dB on time, -16.2 at 3 s and -11.8 at 4 s in FT8. Most stations we answer run WSJT-X or a decoder like it, so the limits follow jt9.
  - Rejected: sending the whole message later than the shift limits. jt9 finds no FT8 transmission sent whole from 3 s late, or FT4 from 1.0 s late. The previous FT4 limit, 1.0 s, sat on that edge.
  - Unverified: WSJT-X decodes the slot as audio arrives, so a whole message that ends past about 14.5 s may lose its end there; jt9 on a 15 s file does not show this. The shift limits end FT8 by 14.64 s, as before, and FT4 by 6.04 s, 0.5 s earlier than before.
  - Measured with exact DT values, jt9 missed 8 of 75 FT8 signals at -12 to -8 dB sent whole exactly 0.50 s late, and none at 0, 1.5 or 2.0 s. Our decoder found all 75. Real late starts are never exactly 0.5 s.
- The sequencer decides on the final decoding pass of each slot. An early pass may only add a caller to the queue. A later pass (the decoder's deeper FT8 stages, up to 2 s after the slot) brings only new decodes and acts on them as the final pass would: a reply, a lost station, a caller, a CQ for Hunt. The answer starts late in the slot under way when the late-start limit allows, else a cycle later. A later pass never repeats a message or counts a retry for what it lacks.
- A newer message for the slot under way replaces ours on air in it early in the slot: a call to a CQ heard while our CQ plays goes out in that slot, and so does the answer a later pass finds while a repeat plays. RR73, RRR and 73 play out, since they end a QSO, as does the same message; the new one then goes a cycle later. Before 0.12.6 a transmission on air always kept its slot, so a call made while calling CQ waited 30 s.
  - The replacement goes only while the new message can go out whole: up to 1.5 s late in FT8 and 0.5 s in FT4, as the late start's shift limits. Measured with the `late-start` set's `replace` and `splice` subsets (part of our CQ at the same frequency, then the reply), jt9 SNR50 for the reply:

    | | On time | Reply whole after the CQ | Reply with its first part left out after the CQ |
    | --- | --- | --- | --- |
    | FT8 | -21.1 dB | -20.6 dB at 1.5 s, -20.5 at 2.0, then as a whole message late | -20.8 dB at 1.5 s, -19.5 at 2.0, -14.3 at 3.0; from 3.5 s at most 8 of 25 at any level |
    | FT4 | -17.8 dB | -17.2 dB at 0.5 s, -16.9 at 0.875 | -16.6 dB at 0.5 s, -14.5 at 0.875, -12.8 at 1.0; from 1.25 s at most 12 of 25 at any level |

  - Rejected: replacing up to the late-start limit. Past the shift limits the reply would have to leave out its first part, and the CQ symbols sent before the switch then spoil it: the reply fails and the CQ is lost as well. Neither decoder decoded the cut-short CQ in any slot.

## Retries

- With no reply, the last message repeats in the next slot of our parity, up to 3 times.
- Calling CQ, a caller who stays silent after 3 repeats is dropped and the next caller or CQ follows. Answering stops after 3 repeats and leaves Tx enabled on the last message, as WSJT-X does.
- Hunt calls a station that has not answered 4 times by default, then moves on to the next CQ. Hunt calls, in Settings › FT8 and FT4, takes 1 to 99: 1 works through the CQs fastest. Once the station answers, the QSO keeps the usual 3 repeats, so a lost R-report does not end a QSO half done.

## Logging

A QSO is complete when both callsigns are known, each side has received a report, and the exchange is acknowledged:

- Calling CQ: we received `R<report>` and sent RR73 (or RRR).
- Answering: we received RR73, RRR or 73 after sending `R<report>`.

The sequencer emits `LogQso` at the moment of completion with start and end times, band, dial frequency, audio frequency, mode, reports, the other station's grid if received, and the activation. The app logs it at once and shows a notice with Edit and Undo; at home an optional prompt replaces the notice.

## Safety

- **Tx on** only starts from an operator action: CQ, Hunt, Tx on, or a double-tap on a decode, which calls the station with Tx on. Run starts nothing by itself.
- **Halt** stops audio within the current audio render quantum, disables Tx and stops Hunt. It is red, always visible in the bottom bar, and takes one tap.
- **End QSO**, in the ••• menu, stops Tx and Hunt and returns to idle without logging.
- **Watchdog**: a counter of minutes since the operator last touched the screen. At the limit Tx and Hunt stop and the status line says "Watchdog stopped Tx after 6 min". The limit is a setting: 6 min by default, any number of minutes, or off. WSPR beacon schedules are exempt; they are not QSOs.
  - A QSO under way at the limit finishes first: the status line says "Watchdog ends Tx after this QSO", the dock shows Last QSO, and once the QSO logs or ends Tx goes off with Hunt, Repeat CQ and the queue starting nothing after it. A QSO is under way once the station has sent us a message, or has called us after our CQ. A call nobody has answered yet stops at once, because Tx1 to a silent station, and a Hound's Tx1 to the Fox above all, has no end of its own. A QSO that pauses after its retries stops at once too. A touch while the last QSO finishes restarts the count, and Hunt and Repeat CQ carry on after it.
  - Responses refresh watchdog, a setting off by default, also restarts the count each time the transmitted message changes, as WSJT-X does. Off, Hunt and Repeat CQ run for the limit from the last touch however many QSOs they make, which is what the operator expects of a timer they set.
  - Rejected: stopping mid-QSO at the limit. It leaves the other station without its RR73 or 73 and a QSO half-logged at their end.
- **Audio interruption** (another app, a call, the screen locking): Tx and Hunt stop, the QSO keeps its state, and transmitting needs Resume audio first.
- **Band change**: choosing a band in the band sheet applies it, and Tx and the QSO keep their state; QSOs record the band chosen. A mode change (FT8, FT4) changes the slot length, so it stops Tx and ends the QSO.
- **Own transmissions**: the receive audio of a slot RR73 transmitted in is not decoded or shown. The radio feeds RR73's own signal back at +40 dB or more, which decoded as a strong station; the list shows what was sent in its place.
- Nothing else plays through the output while audio runs.

## Events and effects

```text
events:  slotDecoded(slotStart, parity, pass, decodes) | callStation(decode) | callCq | enableTx(on)
         | hunt(on) | stopAfterQso(on) | halt | txStarted(slotStart) | txEnded(slotStart) | audioStopped
         | endQso | configure(band, mode, dialHz, ...) | touch(t) | tick(t) | editMessage(slot, text)
effects: scheduleTx(text, slotStart, startOffsetS, freqHz) | cancelTx | logQso(record)
         | notice(kind, text) | queueChanged(callers)
```

`state` holds the phase (idle, answering, calling CQ), Hunt and its tally, the current partner and their last decodes, a lost station's state, the Tx1 to Tx6 texts, the queue, the plain CQs of the last 4 slots, the stations that ignored Hunt, the retry count, the watchdog counter and the parity. Run, tail-end, Hunt's order, Hound and the watchdog limit come in through `configure`. `freqHz` is null except where Hound sets the Tx frequency. The UI renders from state; the audio layer executes effects.

## Open risks

- Hunt's "in a QSO" test only sees the slot just decoded: a station that answered a caller we did not decode looks free. The lost-station check stops the call one slot later.
- Hunt's pick uses the SNR of one decode; fading can make a weaker station look strongest for a slot. Not tested on a device.
- Tail-end waits at most 8 slots. A long QSO with repeats outlasts it, and the call pauses.
- A late start that leaves out its first part, and a CQ replaced on air, are measured on synthetic slots only. Not tested on a device: between the CQ stopping and the call starting the output is silent while the call synthesises, up to the 0.2 s the sequencer allows for it, which VOX hang time should bridge.
