# Web SDR and the relay

A web SDR can supply receive audio in place of the radio. Transmit audio still goes to the radio. RR73 reaches web SDRs, and PSK Reporter's reports, through a QSP relay.

## The relay

A QSP relay connects RR73 to services a web page cannot reach, such as web SDRs. RR73 comes with no relay set up. The relay is a server you run yourself or one you have the address of.

1. Open Settings › Relay and tap Add relay.
2. Type the relay's API base as Address, such as https://relay.example.org/qsp. An https app cannot use an http address.
3. Choose the relay in the list. None is the default.
4. Type the Access key if the relay needs one.
5. Tap Test relay. The result shows under it.

Remove relay takes the chosen relay off the list.

## Receiving from a web SDR

1. Choose a relay in Settings › Relay.
2. Open Settings › Web SDR and turn on Receive from a web SDR.
3. Under Receivers, choose a receiver from those the relay lists. Each shows its location and grid.
4. Tap Start audio on Operate.

The receiver tunes to the band's dial. The status under the switch reads Waiting for Start audio in Operate, then Connecting, then Receiving from the receiver's name. Operate shows a Web SDR badge while the web SDR supplies receive audio.

Other listeners on the receiver see your callsign.

While the practice band is on, Web SDR pauses and the practice band keeps the input.

## PSK Reporter

Settings › PSK Reporter reports the stations your radio decodes to PSK Reporter, through the relay. It is off by default.

1. Choose a relay that reports to PSK Reporter.
2. Turn on Report to PSK Reporter.
3. Type your Antenna if you want it in the reports.

The status under the switch says what holds reports back, such as Needs a relay, Needs your callsign and grid, Paused while receiving from a web SDR or Paused in WSPR and RTTY. Once reports go, it shows the number of spots sent and the time of the last.

Show who heard you lists on Spots the stations that reported hearing your signal in the last 30 min. It reads PSK Reporter's live feed and needs no relay.
