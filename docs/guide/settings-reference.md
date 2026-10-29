# Settings reference

Each setting by the screen it is on, with its default.

## Station

| Setting | Default | Effect |
| --- | --- | --- |
| Callsign, Grid | Empty | Needed to transmit. [Getting started](getting-started.md#callsign-and-grid) |
| Name, QTH | Empty | Sent by the RTTY macros `{MYNAME}` and `{MYQTH}` |

## FT8 and FT4

| Setting | Default | Effect |
| --- | --- | --- |
| Confirm with | RR73 | RR73 or RRR as Tx4. [Calling CQ](making-qsos.md#calling-cq) |
| Work dupes | Off | Repeat CQ and Hunt answer [dupes](making-qsos.md#dupes) last |
| Tail-end | On | [Calls once more](making-qsos.md#a-station-that-answers-someone-else) when a station ends a QSO with another |
| Hunt calls | 4 | Calls to a silent station before [Hunt](making-qsos.md#hunt) moves on, 1 to 99 |
| Watchdog, Stop Tx after | On, 6 min | [Watchdog](making-qsos.md#watchdog) |
| Responses refresh watchdog | Off | Each new message restarts the watchdog |
| Hold Tx frequency | On | Calling moves Rx only. [Operate](operate.md#selecting-and-calling) |
| Exchange, Next serial number | Empty, 1 | [Contest exchange](contest-exchange.md#serial-numbers) |
| Depth | Deep | Fast runs the first decoding stage only and decodes about 3% fewer stations |
| A priori decoding | On | Tries the messages expected next on weak signals near the station you work |

LQ8 QSOs follow these settings too. In LQ8 the screen hides Confirm with, the Contest exchange groups and A priori decoding, which LQ8 has no use for ([LQ8](lq8.md#what-lq8-lacks)).

Hunt order, in Operate's •••: Not worked, the default, puts stations not worked on this band and mode first. Strongest, Newest, Farthest and New call order by signal, by how recently their CQs started, by distance, and stations never worked first.

## WSPR, RTTY and Macros

- [Settings › WSPR](wspr.md#settings-wspr)
- [Settings › RTTY](rtty.md#settings-rtty) and its [Contest](rtty.md#contest) group
- [Macros](rtty.md#macros)

## Radio and audio

| Setting | Default | Effect |
| --- | --- | --- |
| Input, Waterfall contrast | System default, Normal | [Receive audio](your-radio.md#receive-audio) |
| Output, Monitor, Monitor level | System default | [Transmit audio](your-radio.md#transmit-audio) |
| Output level | | [Tune](your-radio.md#setting-levels-with-tune) |
| Start chime | On | Keys the radio by VOX when audio starts |
| Before you transmit | | A checklist. [Your radio](your-radio.md#iphone-and-vox) |
| Correct Tx timing | Off | [Timing](timing.md#correct-tx-timing) |
| Correct with time server, Time server | On, public pool | Desktop app only. [Time server](timing.md#the-desktop-app-s-time-server) |

## Rig control

In Chrome and Edge on a computer, and in the desktop app. [Rig control](your-radio.md#rig-control-in-chrome-or-edge)

| Setting | Default | Effect |
| --- | --- | --- |
| Rig control | Off | Off, VOX keys the radio |
| Radio | Icom IC-705 | Or Elecraft KX2, with Connection and Baud rate |
| Key the radio with CAT | Off | [Keying by CAT](your-radio.md#keying-by-cat) |
| Keep Tx audio centred | Off | IC-705: moves the dial for each transmission |

## Web SDR, PSK Reporter and Relay

| Setting | Default | Effect |
| --- | --- | --- |
| Receive from a web SDR | Off | [Web SDR](web-sdr.md#receiving-from-a-web-sdr) |
| Report to PSK Reporter, Antenna | Off | [PSK Reporter](web-sdr.md#psk-reporter) |
| Show who heard you | Off | Lists on Spots who reported your signal |
| Relay, Access key | None | [The relay](web-sdr.md#the-relay) |

## Logging

| Setting | Default | Effect |
| --- | --- | --- |
| Wavelog | | [Wavelog](logging.md#wavelog) |
| POTA, SOTA, WWFF and ADIF file | | Shown while Activations is on. [Activations](activations.md#where-the-qsos-go) |
| Send automatically | Off | Sends each QSO as it is logged |
| Send edits to QSOs already sent | On | Where the destination takes edits |
| Back up the log, Import a log | | [Backup and import](logging.md#backup-and-import) |

## Practice band

| Setting | Default | Effect |
| --- | --- | --- |
| Practice band | Off | [Practice band](practice-band.md) |
| Crowded band | Off | More stations |
| Play Tx audio | On | Plays practice transmissions and can key a radio |
| Clear practice log | | Empties the practice log, with Undo |

## Optional features

| Setting | Default | Effect |
| --- | --- | --- |
| Activations | Off | [Activations](activations.md) |
| POTA spots | Off | Activators from pota.app, in Spots |
| Cluster spots | Off | The DX cluster from HamQTH, in Spots |

## Appearance

| Setting | Default | Choices |
| --- | --- | --- |
| Theme | Light | Light, Dark, Sun (light, most contrast) or System |
| Font | Automatic | Automatic (Inter on Linux and Android), System or Inter |
| Monospace | System | System, JetBrains or Roboto |
| Decode messages | Interface font | Interface font or Monospace |
| Waterfall colours | RR73 | RR73, Fire or Grey |
| Callsigns on the waterfall | Off | Writes each decode's callsign over its signal |
| Night display | Off | Red on black after 2, 5 or 10 min untouched |
| Decode colours | RR73 | [Colours](operate.md#colours) |

## Guide and About

Guide, the first row of Settings, opens these pages. About holds Version history, Credits, Reload app and Clear cached copy and reload. Both reloads stop audio.
