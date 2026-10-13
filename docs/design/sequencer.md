# QSO sequencer

The sequencer decides what RR73 transmits and when. It covers answering a station (search and pounce), calling CQ, and Run mode. It is a pure state machine in `web/src/lib/qso/`: events in, new state and effects out, no timers or audio inside, so every rule is unit-tested against slot timelines.

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

**Calling CQ.** Tx6 → a caller's grid → Tx2 → their `R<report>` → Tx4 → next caller or Tx6. A caller who sends a report first gets Tx3; a caller who sends `R<report>` first gets Tx4.

**Run mode.** Calling CQ in a loop. Callers queue in the order the operator chose: First (decode order), Strongest, Farthest, New (new DXCC, grid or call first). After Tx4 the sequencer answers the next queued caller in the very next slot, or returns to Tx6 when the queue is empty. Dupes for the band and mode in the current activation, or in the UTC day outside an activation, are skipped unless the operator works dupes.

## Timing

- Our transmissions use one slot parity: the opposite of the station we answer, or the parity the operator chose for CQ.
- A transmission starts 0.5 s after its slot boundary, scheduled on the audio clock.
- Late start: when the decision for a slot is made after its start (decodes arrive about 0.1 to 0.5 s after the previous slot ends), the transmission may start up to 1.5 s late in FT8 and 1.0 s late in FT4. Later than that it moves to the next slot of the same parity, and the dock says which.
- The sequencer decides on the final decoding pass of each slot. An early pass may only add a caller to the queue.

## Retries

- With no reply, the last message repeats in the next slot of our parity, up to 3 times (configurable).
- In Run mode a caller who stays silent after 3 repeats is dropped and the next caller or CQ follows. Answering mode stops after 3 repeats and leaves Tx enabled on the last message, as WSJT-X does.

## Logging

A QSO is complete when both callsigns are known, each side has received a report, and the exchange is acknowledged:

- Calling CQ: we received `R<report>` and sent RR73 (or RRR).
- Answering: we received RR73, RRR or 73 after sending `R<report>`.

The sequencer emits `LogQso` at the moment of completion with start and end times, band, dial frequency, audio frequency, mode, reports, the other station's grid if received, and the activation. The app logs it at once and shows a notice with Edit and Undo; at home an optional prompt replaces the notice.

## Safety

- **Tx on** and **Run** only start from an operator action: CQ, Run, Tx on, or a double-tap on a decode, which calls the station with Tx on.
- **Halt** stops audio within the current audio render quantum, disables Tx and stops Run. It is red, always visible in the bottom bar, and takes one tap.
- **End QSO**, in the ••• menu, stops Tx and Run and returns to idle without logging.
- **Watchdog**, WSJT-X's rule: a counter of minutes since the operator last touched the screen or since the transmitted message last changed. At the limit (default 6 minutes) Tx and Run stop and a notice says why. WSPR beacon schedules are exempt; they are not QSOs.
- **Audio interruption** (another app, a call, the screen locking): Tx and Run stop, the QSO keeps its state, and transmitting needs Resume audio first.
- **Band change**: choosing a band in the band sheet applies it, and Tx and the QSO keep their state; QSOs record the band chosen. A mode change (FT8, FT4) changes the slot length, so it stops Tx and ends the QSO.
- **Own transmissions**: the receive audio of a slot RR73 transmitted in is not decoded or shown. The radio feeds RR73's own signal back at +40 dB or more, which decoded as a strong station; the list shows what was sent in its place.
- Nothing else plays through the output while audio runs.

## Events and effects

```text
events:  slotDecoded(slotStart, parity, pass, decodes) | callStation(decode) | enableTx(on)
         | runMode(on) | halt | txStarted(slotStart) | txEnded(slotStart) | audioStopped
         | endQso | configure(band, mode, dialHz, ...) | touch(t) | tick(t) | editMessage(slot, text)
effects: scheduleTx(text, slotStart, startOffsetS) | cancelTx | logQso(record)
         | notice(kind, text) | queueChanged(callers)
```

`state` holds the mode (idle, answering, calling CQ, running), the current partner and their last decodes, the Tx1 to Tx6 texts, the queue, the retry count, the watchdog counter and the parity. The UI renders from state; the audio layer executes effects.
