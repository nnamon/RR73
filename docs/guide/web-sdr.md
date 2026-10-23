# Web SDR and the relay

A web SDR can supply receive audio in place of the radio, while transmit audio still goes to the radio. RR73 reaches web SDRs and PSK Reporter through a QSP relay.

## The relay

RR73 comes with no relay. Run one yourself, or add one whose address you have.

1. Open Settings › Relay and tap Add relay.
2. Type the relay's API base as Address, such as https://relay.example.org/qsp. An https app cannot use an http address.
3. Choose the relay in the list. None is the default.
4. Type the Access key if the relay needs one.
5. Tap Test relay.

Remove relay takes the chosen relay off the list.

## Receiving from a web SDR

1. Choose a relay in Settings › Relay.
2. Turn on Receive from a web SDR in Settings › Web SDR.
3. Under Receivers, choose one of the relay's receivers.
4. Tap Start audio on Operate.

The receiver tunes to the band's dial, and Operate shows a Web SDR badge. Other listeners on the receiver see your callsign. Web SDR pauses while the practice band is on.

## PSK Reporter

1. Choose a relay that reports to PSK Reporter.
2. Turn on Report to PSK Reporter in Settings › PSK Reporter. It is off by default.
3. Type your Antenna to include it in the reports.

The status under the switch says what holds reports back, such as Needs a relay or Paused in WSPR and RTTY. Once reports go, it shows the spot count and the time of the last one.

Show who heard you lists on Spots the stations that reported your signal in the last 30 min. It reads PSK Reporter's live feed and needs no relay.
