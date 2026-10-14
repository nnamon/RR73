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

- On: the next queued caller is answered in the very next slot, or Tx6 when the queue is empty. Callers queue across slots in the order the operator chose: First (decode order), Strongest, Farthest, New (new DXCC, grid or call first). Dupes for the band and mode in the current activation, or in the UTC day outside an activation, are skipped unless the operator works dupes.
- Off: Tx turns off once the QSO ends, as WSJT-X does with "Disable Tx after sending 73". Only callers of the latest slot are candidates.
- A station called by hand from CQ returns to CQ after it is logged only with Run on. An unanswered or lost call never returns to CQ.

Run was a button that started CQ. It became a setting because the CQ button already starts CQ, and the owner wants WSJT-X's choice between stopping after 73 and carrying on.

**Hunt.** A main button. Hunt answers CQs one after another until the operator stops it:

- At each final decoding pass with nobody in a QSO, it calls the first CQ in Hunt's order among the plain CQs heard in the slot just decoded, in the next slot of the opposite parity. Hunt started within the late-start window of a slot picks from the slot before at once.
- It skips stations heard sending anything other than CQ in that slot (in a QSO), dupes (as for Run), and stations that ignored Hunt in the last 10 min: no reply after the repeats, or a second answer to another station while Hunt called them.
- Orders, chosen in •••: Not worked (on this band and mode on any day, then strongest; the default), Strongest, Newest (the station whose run of CQs started most recently), Farthest, New call (never worked).
- Plain CQ only. CQ DX, CQ NA, CQ POTA and other CQs with a modifier are skipped until reference data can say whether the operator is the station asked for.
- Hunt and CQ stop each other. Starting Hunt during a QSO lets the QSO finish and picks after it. Stopping Hunt during a QSO lets it finish, then Tx goes off. Halt, End QSO, an audio stop and the watchdog stop Hunt.
- The status line names the state: "Hunt · calling VJ6X (−12 dB) · 2 QSOs".

**Lost station.** When the station we call, before it has answered us, sends a report, `R<report>`, RR73, RRR or 73 to another station, calling stops and a notice names it: "VK2LAW answered DV5CEL." A CQ or a call with a grid from that station is not a QSO under way, and calling continues.

**Tail-end.** A setting, on by default. After a lost station sends RR73, RRR or 73 to the other station, or calls CQ, the sequencer calls it once more in the next slot of the opposite parity, with the late start allowed. One unanswered call ends the attempt. Nothing goes out while the station is in its QSO, Tx on included. Waiting ends after 8 slots. With tail-end off, the call pauses at once. Hunt never tail-ends: it moves on to the next CQ as soon as the station it calls answers another, whatever the setting, because another CQ is a quicker QSO than waiting out theirs.

## Timing

- Our transmissions use one slot parity: the opposite of the station we answer, or the parity the operator chose for CQ.
- A transmission starts 0.5 s after its slot boundary, scheduled on the audio clock.
- Late start: when the decision for a slot is made after its start (decodes arrive about 0.1 to 0.5 s after the previous slot ends), the transmission may start up to 1.5 s late in FT8 and 1.0 s late in FT4. Later than that it moves to the next slot of the same parity, and the dock says which.
- The sequencer decides on the final decoding pass of each slot. An early pass may only add a caller to the queue.

## Retries

- With no reply, the last message repeats in the next slot of our parity, up to 3 times (configurable).
- Calling CQ, a caller who stays silent after 3 repeats is dropped and the next caller or CQ follows. Answering stops after 3 repeats and leaves Tx enabled on the last message, as WSJT-X does; Hunt moves on to the next CQ.

## Logging

A QSO is complete when both callsigns are known, each side has received a report, and the exchange is acknowledged:

- Calling CQ: we received `R<report>` and sent RR73 (or RRR).
- Answering: we received RR73, RRR or 73 after sending `R<report>`.

The sequencer emits `LogQso` at the moment of completion with start and end times, band, dial frequency, audio frequency, mode, reports, the other station's grid if received, and the activation. The app logs it at once and shows a notice with Edit and Undo; at home an optional prompt replaces the notice.

## Safety

- **Tx on** only starts from an operator action: CQ, Hunt, Tx on, or a double-tap on a decode, which calls the station with Tx on. Run starts nothing by itself.
- **Halt** stops audio within the current audio render quantum, disables Tx and stops Hunt. It is red, always visible in the bottom bar, and takes one tap.
- **End QSO**, in the ••• menu, stops Tx and Hunt and returns to idle without logging.
- **Watchdog**, WSJT-X's rule: a counter of minutes since the operator last touched the screen or since the transmitted message last changed. At the limit Tx and Hunt stop and a notice says why. The limit is a setting: 6 min by default, any number of minutes, or off. WSPR beacon schedules are exempt; they are not QSOs.
- **Audio interruption** (another app, a call, the screen locking): Tx and Hunt stop, the QSO keeps its state, and transmitting needs Resume audio first.
- **Band change**: choosing a band in the band sheet applies it, and Tx and the QSO keep their state; QSOs record the band chosen. A mode change (FT8, FT4) changes the slot length, so it stops Tx and ends the QSO.
- **Own transmissions**: the receive audio of a slot RR73 transmitted in is not decoded or shown. The radio feeds RR73's own signal back at +40 dB or more, which decoded as a strong station; the list shows what was sent in its place.
- Nothing else plays through the output while audio runs.

## Events and effects

```text
events:  slotDecoded(slotStart, parity, pass, decodes) | callStation(decode) | callCq | enableTx(on)
         | hunt(on) | stopAfterQso(on) | halt | txStarted(slotStart) | txEnded(slotStart) | audioStopped
         | endQso | configure(band, mode, dialHz, ...) | touch(t) | tick(t) | editMessage(slot, text)
effects: scheduleTx(text, slotStart, startOffsetS) | cancelTx | logQso(record)
         | notice(kind, text) | queueChanged(callers)
```

`state` holds the phase (idle, answering, calling CQ), Hunt and its tally, the current partner and their last decodes, a lost station's state, the Tx1 to Tx6 texts, the queue, the plain CQs of the last 4 slots, the stations that ignored Hunt, the retry count, the watchdog counter and the parity. Run, tail-end, Hunt's order and the watchdog limit come in through `configure`. The UI renders from state; the audio layer executes effects.

## Open risks

- Hunt's "in a QSO" test only sees the slot just decoded: a station that answered a caller we did not decode looks free. The lost-station check stops the call one slot later.
- Hunt's pick uses the SNR of one decode; fading can make a weaker station look strongest for a slot. Not tested on a device.
- Tail-end waits at most 8 slots. A long QSO with repeats outlasts it, and the call pauses.
