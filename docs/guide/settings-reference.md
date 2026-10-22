# Settings reference

Every setting, by the screen it is on. Defaults are given where a setting has one.

## Station

- Callsign: your callsign. Needed to transmit. [Getting started](getting-started.md#callsign-and-grid)
- Grid: your grid, 4 or 6 characters. Needed to transmit. Tap Use GPS to fill it in.
- Name: optional. RTTY macros send it as `{MYNAME}`.
- QTH: optional. RTTY macros send it as `{MYQTH}`.

## FT8 and FT4

- Confirm with: RR73 or RRR in Tx4. RR73 by default. [Making QSOs](making-qsos.md#calling-cq)
- Work dupes: Repeat CQ and Hunt answer dupes after everyone else. Off by default. [Dupes](making-qsos.md#dupes)
- Tail-end: call a station once more after it ends a QSO with another. On by default. [Making QSOs](making-qsos.md#a-station-that-answers-someone-else)
- Hunt calls: calls to a silent station before Hunt moves on, 1 to 99. 4 by default. [Hunt](making-qsos.md#hunt)
- Watchdog: stops Tx after a time with no touch. On by default. [Watchdog](making-qsos.md#watchdog)
- Stop Tx after: the watchdog's limit in minutes. 6 by default.
- Responses refresh watchdog: each new message restarts the watchdog. Off by default.
- Hold Tx frequency: calling a station moves Rx only. On by default. [Operate](operate.md#selecting-and-calling)
- Exchange: your contest exchange. Empty by default. [Contest exchange](contest-exchange.md)
- Next serial number: the serial number the exchange sends next. 1 by default. [Serial numbers](contest-exchange.md#serial-numbers)
- Depth: Deep runs every decoding stage, Fast the first only. Fast decodes about 3% fewer stations. Deep by default.
- A priori decoding: during a QSO, tries the messages expected next on weak signals near the station. On by default.

## WSPR

- Tx percentage, Reported power, Tx frequency, Stop beacon after, Message, Sort spots by and Upload spots to WSPRnet. [WSPR](wspr.md#settings-wspr)

## RTTY

- Speed, Shift, Reverse, Unshift on space, Figures, AFC, Squelch, Stop bits, Preamble, Idle, Tail, Start each Tx with a new line, Stop idle Tx after, Watchdog and Repeat CQ gap. [RTTY](rtty.md#settings-rtty)
- Contest, Next serial, Serial digits and Exchange. [RTTY contest](rtty.md#contest)

## Macros

- The QSO and Contest sets of keyboard macros. [Macros](rtty.md#macros)

## Radio and audio

- Input: the audio input. System default by default. [Receive audio](your-radio.md#receive-audio)
- Waterfall contrast: Low, Normal or High. Normal by default.
- Output: the audio output, in Chrome and Edge. [Transmit audio](your-radio.md#transmit-audio)
- Monitor and Monitor level: a second output that plays transmit audio.
- Output level: the transmit audio level. [Tune](your-radio.md#setting-levels-with-tune)
- Start chime: a tone when audio starts, which keys the radio by VOX. On by default.
- Before you transmit: a checklist to tick as you set up the device. [Your radio](your-radio.md#iphone-and-vox)
- Correct Tx timing: moves each transmission by the clock error in the decodes. Off by default. [Timing](timing.md#correct-tx-timing)
- Correct with time server and Time server: in the desktop app, the clock against an NTP server, the public pool when empty. On by default. [Time server](timing.md#the-desktop-app-s-time-server)

## Rig control

Shows in Chrome and Edge on a computer, and in the desktop app. [Rig control](your-radio.md#rig-control-in-chrome-or-edge)

- Rig control: off by default. Off, transmissions key the radio by VOX.
- Radio: Icom IC-705 or Elecraft KX2.
- Connection and Baud rate: for the KX2.
- Key the radio with CAT: keys by PTT over CAT. Off by default. [Keying by CAT](your-radio.md#keying-by-cat)
- Keep Tx audio centred: on the IC-705, moves the dial for each transmission. Off by default.

## Web SDR, PSK Reporter and Relay

- Receive from a web SDR, and the receiver. Off by default. [Web SDR](web-sdr.md#receiving-from-a-web-sdr)
- Report to PSK Reporter, Antenna and Relay. Off by default. [PSK Reporter](web-sdr.md#psk-reporter)
- Show who heard you: lists on Spots who reported your signal. Off by default.
- Relay: None, or a relay you added, with its Access key. None by default. [The relay](web-sdr.md#the-relay)

## Logging

- Wavelog: Address, API key, Station location, Use Wavelog, Send radio status and Read Wavelog's log. [Wavelog](logging.md#wavelog)
- POTA, SOTA, WWFF and ADIF file: files for activations, shown while Activations is on. [Activations](activations.md#where-the-qsos-go)
- Send automatically: sends each QSO as it is logged.
- Send edits to QSOs already sent: where the destination accepts changes.
- Back up the log and Import a log. [Backup and import](logging.md#backup-and-import)

## Practice band

- Practice band: the simulated band. Off by default. [Practice band](practice-band.md)
- Crowded band: more stations. Off by default.
- Play Tx audio: practice transmissions play and can key a connected radio. On by default.
- Clear practice log: empties the practice log, with Undo.

## Optional features

- Activations: POTA, SOTA, WWFF and IOTA activations. Off by default. [Activations](activations.md)
- POTA spots: activators from pota.app, in Spots. Off by default.
- Cluster spots: the DX cluster from HamQTH, in Spots. Off by default.

## Appearance

- Theme: Light, Dark, Sun or System. Sun is light with the most contrast, for direct sunlight. Light by default.
- Font: Automatic, System or Inter. Automatic, the default, uses Inter on Linux and Android.
- Monospace: System, JetBrains or Roboto, for messages, times and callsigns. System by default.
- Decode messages: Interface font, the default, or Monospace.
- Waterfall colours: RR73, Fire or Grey. RR73 by default.
- Callsigns on the waterfall: writes each FT8 and FT4 decode's callsign over its signal. Off by default.
- Night display: shows Operate in dim red on black after 2, 5 or 10 min untouched. Off by default. Night display in ••• turns it on at once, and a tap wakes Operate.
- Decode colours: the colour of each kind of decode, a preset, and the legend. [Colours](operate.md#colours)

## About

- Guide: these pages.
- Version history: the changes in each version.
- Credits: the third-party work in RR73 and its licences.
- Reload app: installs any update. Audio stops.
- Clear cached copy and reload: keeps settings and QSOs. Needs a connection. Audio stops.
