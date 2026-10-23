# WSPR

Choose WSPR in Change band. WSPR slots are 2 min long and start on an even UTC minute. The band's dial is WSPRnet's dial for that band.

## Receiving

The waterfall shows 1400 to 1600 Hz over 2 slots. The decoder searches the whole window, so the waterfall has no Rx marker.

The list shows the spots of each slot under a bar, newest slot first. Each row shows the callsign and grid, then the distance, the reported power, the SNR and the drift, such as 8558 km 5 W −23 dB 0 Hz. Spots of older slots fade. A spot of your own callsign shows in the My call colour.

- Tap a spot to mark its trace on the waterfall. Tap it again to clear the mark.
- Touch and hold a spot to open its details: the frequency on air to 1 Hz, DT, drift, distance and bearing, the power in watts, and how often the station was heard.

Sort spots by, in Settings › WSPR and in •••, orders the spots by Distance, SNR or Callsign. Distance, farthest first, is the default.

## The beacon

The bar at the bottom has Beacon, the Tx percentage, ••• and Halt.

- Beacon turns the beacon on or off. It reads Tx at :06 while a transmission waits for its slot, and On air in solid red with a blinking dot.
- The Tx percentage sets the share of slots the beacon transmits in, from 5% to 100% in steps of 5. The default is 20%.
- Halt ends a transmission and turns the beacon off.

The status line shows the message and the Tx frequency, such as `9V1NE OJ11 37 · 1500 Hz`. Its right end shows Beacon off, the time the beacon stops, or the time left on air.

A transmission starts 1 s into its slot and lasts about 110.6 s. At 50% and below, at least 1 receive slot separates 2 transmissions. The gaps vary at random around the mean. At 20% they run from 2 to 8 slots, 5 on average.

••• holds Transmit next slot, Tune for 10 s, Save slot, Clear spots, Power, Sort by and Stop beacon after.

## Settings › WSPR

- Tx percentage: the share of slots the beacon transmits in.
- Reported power: the power the message reports, 0 to 60 dBm. The default is 37 dBm, 5 W.
- Tx frequency: the audio frequency of the signal centre, 1410 to 1590 Hz. Dragging or tapping on the waterfall sets it too.
- Stop beacon after: Off, or 30 min to 12 h. The default is 1 h, counted from Beacon on. Other takes a number of minutes.
- Message: shows what the beacon sends, built from your callsign, grid and power. A compound callsign sends its grid only with a 6-character grid.
- Sort spots by: Distance, SNR or Callsign.
- Upload spots to WSPRnet: sends your spots to WSPRnet. WSPRnet sends no confirmation, so check your spots on wsprnet.org.

The watchdog does not stop the beacon. Stop beacon after ends it.
