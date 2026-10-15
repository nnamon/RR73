# QSP

QSP, named after the Q-code for relaying, is a server for the services a web page on an iPhone cannot reach directly. Web SDR receive shipped in 0.16.0 and reports to PSK Reporter in 0.17.0. WSPRnet uploads go from the phone directly. RR73 works without a relay, and anyone can run one from this repository. The design was approved on 15 October 2026.

## Principles

- No relay is built into the app. Settings › Relay is None by default. The operator adds each relay by its API base, and the list keeps the relays added, each with its own access key, to choose from. Remove relay takes one off, with Undo.
- QSP carries no credentials for other services. It does only what needs no account. Logbooks are reached from the phone directly (Wavelog) or through Wavelog, which uploads to QRZ Logbook, eQSL and Club Log.
- Nothing goes out one callsign at a time. Every link batches, and each service gets the fewest requests its own published rules allow.
- No self-spotting.
- Open source in this repository, under the workspace licence, and released with the app at its version. Each release carries QSP's binaries for x86-64 and ARM64 Linux and publishes the image `ghcr.io/nnamon/rr73-qsp` (`docker/qsp-release.Dockerfile`); `docker/qsp.Dockerfile` builds the same program from source.

## What needs it

Checked on 14 and 15 October 2026 by asking each service, from outside a browser, whether it answers the RR73 site's origin. No keys were sent.

| Service | Route | Why |
| --- | --- | --- |
| KiwiSDR receivers, other web SDR kinds later | QSP | KiwiSDRs serve plain `ws://`; Safari refuses it from the https app. |
| PSK Reporter, reports | QSP | IPFIX over UDP to port 4739; a web page cannot send UDP. |
| PSK Reporter, who heard you | Direct | Its MQTT feed accepts a WebSocket from the RR73 site at `wss://mqtt.pskreporter.info:1886` (checked 15 October). The feed pushes reports to the page. |
| WSPRnet | Direct | `https://wsprnet.org/post/` takes the form-encoded POST as a simple request; it sends no CORS headers, so its answer cannot be read (checked 15 October). |
| Wavelog | Direct | The operator's own server. |

## Deployment

- One program, `rr73-qsp` (`crates/rr73-qsp`), configured by one TOML file (`crates/rr73-qsp/qsp.example.toml`).
- It listens on plain HTTP on the loopback interface behind an HTTPS front. The front strips the API base's path: the app's address is the API base and every request joins onto it, so QSP serves from its own root and has no path to configure.
- The owner's instance runs at `https://dmr.pwn.sg/qsp` under systemd (`crates/rr73-qsp/qsp.service`), behind Caddy. It is open, with no access key.

## The API

Versioned under `/v1`; `/docs`, `/openapi.json`, `/about` and `/health` are not. Requests carry `Authorization: Bearer <key>` when the instance lists access keys. Errors are JSON: `{"error": {"code": "…", "message": "…"}}`. CORS allows the origins the settings list, or any origin when the list is empty. No request carries cookies.

| Request | Purpose |
| --- | --- |
| `GET /docs` | The API on one page, rendered from the OpenAPI document the endpoints are built with. No key. |
| `GET /openapi.json` | That document. No key. |
| `GET /about` | Name, version, services offered, whether a key is needed. No key. |
| `GET /health` | `ok`. No key. |
| `GET /v1/sdr/receivers` | The receivers the instance offers. |
| `POST /v1/sdr/sessions` | Start listening: the id of a receiver the instance lists, the dial frequency in Hz, the encoding. Returns the session and a one-time ticket for its stream. |
| `GET /v1/sdr/sessions/{id}` | The session's state. |
| `PATCH /v1/sdr/sessions/{id}` | Retune: a new dial frequency. |
| `DELETE /v1/sdr/sessions/{id}` | Stop listening. |
| `GET /v1/sdr/sessions/{id}/stream?ticket=` | The audio as a WebSocket. A browser cannot set headers on a WebSocket, so the ticket from the session stands in for the key, once. |
| `POST /v1/pskreporter/receptions` | A batch of decodes and the receiving station. Answers taken, repeats and when the next report goes. |
| `GET /v1/pskreporter/status` | Waiting, sent and the next report. |

### The audio stream

Binary WebSocket messages, one frame each, big-endian:

| Bytes | Field |
| --- | --- |
| 1 | Format version, 1 |
| 1 | Encoding: 0 PCM, 16-bit signed; 1 IMA ADPCM, 4-bit |
| 2 | Flags: bit 0 set when the time comes from the receiver's GPS; bit 1 set when audio is missing before this frame, after a drop, a reconnect or a move to another connection |
| 4 | Sequence number of the frame |
| 8 | UTC of the first sample, microseconds since 1970 |
| 4 | Samples in the frame |
| 4 | ADPCM only: the predictor (i16) and step index (u8) at the frame's start, and a padding byte |
| n | Samples at 12 000 per second, mono |

Text messages carry the session's state as JSON: `{"type": "status", "state": "connecting" | "streaming" | "ended", "reason": …}`, and the receiver's notices as `{"type": "notice", "text": …}`. A stream says connecting again while QSP reconnects to the receiver or moves the session to another connection. ADPCM is the default: about 6 kB/s, some 22 MB an hour. PCM is 24 kB/s. Each ADPCM frame starts from its own predictor and index, so a lost frame costs only itself.

Time comes from QSP's clock, which its host keeps by NTP. A receiver's GPS time is used only where it is usable; the SARTS Web-888's IQ stream carries none (tools/kiwi).

## Building order

Each part is built against the real service and tested against a small stand-in. QSP has no mock mode.

1. QSP with KiwiSDR receive, `/docs`, and Settings › Relay and Settings › Web SDR in the app. Shipped in 0.16.0.
2. PSK Reporter: reports through QSP, and who heard you from the MQTT feed. Built.
3. WSPRnet uploads, straight from the phone. Built.

## PSK Reporter

From its developer page (https://pskreporter.info/pskdev.html, read 15 October 2026):

- Datagrams go to `report.pskreporter.info` port 4739, all from one UDP source port.
- At most one datagram every 5 min, unless one fills up. The timer counts from start-up and never from the clock, with a random part, so instances do not send in step.
- Each callsign at most once per 5 min, and once per hour while nothing about it changes. A change of band counts as a change.
- The record format descriptors go in the first 3 datagrams and then once an hour. The receiver information record goes in every datagram.
- The header's sequence number is the count of reports sent so far. Its observation domain is a random number kept for the session.
- informationSource is 1, automatically extracted. While developing, the 0x80 test bit is set (`test = true` in the settings).
- Sender records use the page's fourth descriptor: senderCallsign, frequency, sNR, iMD, mode, informationSource, senderLocator, flowStartSeconds. RR73 has no IMD figure and sends 0, since the page offers no descriptor with sNR and without iMD. A locator not received is an empty string.
- Receiver records: receiverCallsign, receiverLocator, decodingSoftware (`RR73 0.x.y`) and antennaInformation when the operator gives one.
- Frequency is the RF frequency: dial plus audio, in Hz. Mode is the ADIF mode or submode: FT8, FT4.
- flowStartSeconds is the time the callsign was recognised: when the decode arrived. PSK Reporter keeps a list of software that sends the start of the transmission instead (https://pskreporter.info/api/characteristics), and reads the time as a decode time for software not on it.
- A datagram stays under 1400 bytes.

- Port 14739 on the same host is a test listener. Its analysis page (https://pskreporter.info/cgi-bin/psk-analysis.pl) lists the last packets from the address that opens it. `pskreporter.info` itself is behind Cloudflare and takes no UDP.

QSP keeps one report stream per receiving station: its own observation domain, sequence number and timer. All streams send from one UDP socket. `POST /v1/pskreporter/receptions` takes a station and up to 500 spots and answers what was taken, what repeated a recent report, and what was refused. `GET /v1/pskreporter/status?callsign=` shows what waits and what went.

The app reports only what the operator's radio hears. Decodes from the practice band or a web SDR are left out: their signals or antenna belong to someone else. It reports FT8 and FT4, the sender of each message once per band and slot, with the grid the message carried. Hashed callsigns are left out. It sends to QSP at most once a minute, 500 spots at most, and keeps up to 1000 while the relay is unreachable. A refusal from the relay drops them. Settings › PSK Reporter turns reports on, off by default, and takes the antenna.

## Who heard you

The phone subscribes to PSK Reporter's MQTT feed directly, with no relay (https://www.mqtt.pskreporter.info, read 15 October 2026). The feed is run by Tom M0LTE with PSK Reporter's permission. Its page invites any client, asks for no account, and lists apps that use it; it publishes no other terms.

- Port 1886 is MQTT over WebSocket and TLS, for pages on https. RR73's client (`lib/pskreporter/mqtt.ts`) speaks MQTT 3.1.1: a clean session, one subscription at QoS 0, a ping every 50 s.
- Topics are `pskr/filter/v2/{band}/{mode}/{tx}/{rx}/{tx_grid}/{rx_grid}/{tx_dxcc}/{rx_dxcc}`; RR73 subscribes to `pskr/filter/v2/+/+/{callsign}/#`. A callsign's `/` is `.` in a topic: 7 of 161 messages sampled on 15 October showed it, such as `AI4UC/T` as `AI4UC.T`.
- Each message is one spot as JSON. RR73 uses the receiver (`rc`, `rl`), band, mode, SNR (`rp`, which can be null) and time: `t_tx`, the transmission's start, when the feed gives it, else `t`.
- Spots lists the reports of the last 30 min, one per receiver and band. Settings › PSK Reporter turns it on, off by default. The feed reconnects after 5 s, doubling to 5 min, and closes while the practice band is on.

## WSPRnet

The phone uploads straight to WSPRnet: the owner's call on 15 October 2026, once WSPRnet was found to take the upload over HTTPS. The interface follows the owner's description of what WSJT-X sends, read from its traffic; WSPRnet publishes none, and wsprnet.org answered 403 to every page fetched.

- One record per `POST https://wsprnet.org/post/`, form-encoded, with no batching, credentials or cookies. `/` stays as it is; a space is `%20`. An empty POST answers "Nothing to do." (checked 15 October).
- A slot with spots sends one `function=wspr` record per spot within 10 kHz of the reporter's frequency (dial + 1500 Hz): date and time of the slot, SNR, DT to one decimal, drift in Hz, the spot's frequency in MHz to 6 decimals, callsign, grid, power, version, the reporter's callsign, grid and frequency, and mode 2. Type 2 messages go with an empty grid, Type 3 without the hash brackets; an unresolved hash does not go.
- A slot without spots sends one `function=wsprstat` record: the reporter, its frequency, its Tx percentage (0 while the beacon is off), Tx frequency and power.
- A slot's records go a random 0 to 20 s after it is decoded, one every 200 ms.
- WSPRnet sends no CORS headers, so the page cannot read "spot(s) added". A record counts as sent once the request goes out. One that never left the phone goes again after 2, 4, 8, 16 and 30 min; one that went out is not sent twice, since WSPRnet may have stored it.
- Only what the operator's radio hears goes, as for PSK Reporter; a slot the decoder skipped sends nothing. The version is `RR73 x.y.z`, which WSPRnet takes in a field where WSJT-X sends `3.0.2`: Unverified, since the answer cannot be read.
- Settings › WSPR turns uploads on, off by default.

## Web SDRs

- The settings list the receivers an instance offers: id, kind, name, address, location, grid. QSP connects to those and no others, and the app offers only those.
- One connection per receiver and dial (`src/upstream.rs`): sessions on the same receiver and dial share it, and `max_sessions` counts connections. A session that retunes keeps its connection when it listens there alone and no connection is on the new dial; otherwise it moves to the connection there, opening it when needed. The last session to leave a connection closes it. Audio only, no waterfall.
- A connection that streamed and then dropped is opened again after 2, 4, 8, 16 and 30 s; the count starts over once it streams (`kiwi::run`). The receiver's refusals, a full receiver, and a close after one of its notices, such as its time limit, end the session. The first frame after a reconnect, a move or a lag carries the gap flag. The politeness rules of `tools/kiwi` apply.
- QSP names itself `RR73-QSP/<version> (+https://github.com/nnamon/RR73)` on the status page and the stream.
- The KiwiSDR client is written from scratch for QSP. The kiwiclient package the corpus recorder fetches carries no licence for its core files and is not read or copied.

## Security

- Access keys, compared in constant time; none means open. An open instance still reaches only the services and receivers its settings list, so it cannot be used as an open proxy.
- A limit on requests per key.
- Logs carry no request bodies.

## Testing

- Unit: the KiwiSDR client's handling of the receiver's messages; ADPCM round trip; frame encoding. With PSK Reporter: the IPFIX encoder reproduces the developer page's example datagram byte for byte, and the batching rules.
- API: every endpoint through the router; the stream over a real WebSocket from a stand-in KiwiSDR, two sessions sharing one connection, a retune that moves a session and one that keeps it, and a reconnect after the stand-in drops the stream.
- No test reaches a real service.

## Alternatives rejected

- Credentials for QRZ Logbook, eQSL, Club Log and HRDLog through QSP: the owner will not have credentials in transit. Wavelog uploads to the first three.
- Cloudflare Workers: no UDP, so no PSK Reporter reports.
- The NAS at home behind a tunnel: down whenever the house is offline.
- Who heard you through QSP's polling of PSK Reporter's query API: limited to once per 5 min and unreadable from the page; the MQTT feed pushes to the page directly.
- QSP passing the KiwiSDR protocol through to the app: every new SDR kind would need an app release.
- Cloudlog, and callsign lookups through QRZ XML or HamQTH: dropped for now, the owner's call on 15 October 2026.
- Receivers users add by address, built in 0.19.4 and removed in 0.19.5: the owner's call. A relay reaches only the receivers its operator lists, so it needs no checks on addresses users send.

## Open risks

- The SARTS receiver's session limits and channels in use by others.
- WSPRnet's upload interface is undocumented, and its answers cannot be read from the page: a change on its side would go unnoticed.
- A server needs looking after: updates, renewals and a check that it is up. A self-hosted instance puts that on its operator.
