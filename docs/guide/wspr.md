# WSPR

Choose WSPR in Change band. The dial is WSPRnet's for the band, and slots are 2 min long from each even UTC minute.

## Receiving

The waterfall shows 1400 to 1600 Hz over 2 slots. The decoder searches all of it, so there is no Rx marker.

Spots are listed by slot, newest first. Each row has the callsign and grid, distance, reported power, SNR and drift: 8558 km 5 W −23 dB 0 Hz. Your own callsign shows in the My call colour.

- Tap a spot to mark its trace on the waterfall, and tap again to clear it.
- Touch and hold a spot for its frequency to 1 Hz, DT, drift, distance and bearing, power in watts, and how often the station was heard.

## The beacon

- Beacon: turns the beacon on or off. It reads Tx at :06 while a transmission waits, and On air in solid red while transmitting.
- Tx percentage: the share of slots the beacon transmits in, 5% to 100% in steps of 5, 20% by default.
- Halt: ends a transmission and turns the beacon off.

The status line shows the message and Tx frequency, such as `9V1NE OJ11 37 · 1500 Hz`, and at its right end Beacon off, the stop time or the time left on air.

A transmission starts 1 s into its slot and lasts about 110.6 s. At 50% and below, at least 1 receive slot separates 2 transmissions. The gaps vary at random: at 20%, from 2 to 8 slots, 5 on average.

••• holds Transmit next slot, Tune for 10 s, Save slot, Clear spots, Power, Sort by and Stop beacon after.

## Settings › WSPR

- Tx percentage: as on the beacon bar.
- Reported power: 0 to 60 dBm, 37 dBm (5 W) by default.
- Tx frequency: the audio frequency of the signal centre, 1410 to 1590 Hz. Tapping or dragging on the waterfall also sets it.
- Stop beacon after: Off, or 30 min to 12 h counted from Beacon on, 1 h by default. Other takes minutes.
- Message: what the beacon sends, from your callsign, grid and power. A compound callsign sends its grid only with a 6-character grid.
- Sort spots by: Distance (farthest first, the default), SNR or Callsign. ••• has it too.
- Upload spots to WSPRnet: WSPRnet sends no confirmation, so check your spots on wsprnet.org.

The watchdog does not stop the beacon. Stop beacon after does.
