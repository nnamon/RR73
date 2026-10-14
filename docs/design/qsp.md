# QSP

QSP, after the Q-code for relaying, is a small server RR73 can use for the few things a web page on an iPhone cannot do by itself: receive from a web SDR, report decodes to PSK Reporter and upload WSPR spots. It is optional. RR73 works without one, and anyone can run their own from this repository. Approved by the owner on 15 October 2026; the planning page is https://claude.ai/artifact/FeuzcBQMBs32Eh9sRuBHry.

## Principles

- No relay is built into the app. Settings › Relay is None by default. The operator adds each relay by its API base, and the list keeps the relays added, each with its own access key, to choose from. Remove relay takes one off, with Undo.
- QSP carries no credentials for other services. It does only what needs no account. Logbooks are reached from the phone directly (Wavelog, later Cloudlog) or through Wavelog, which uploads to QRZ Logbook, eQSL and Club Log.
- Nothing goes out one callsign at a time. Every link batches, and each service gets the fewest requests its own published rules allow.
- No self-spotting.
- Open source in this repository, under the workspace licence. Each release can publish a container image.

## What needs it

Checked on 14 and 15 October 2026 by asking each service, from outside a browser, whether it answers the RR73 site's origin. No keys were sent.

| Service | Route | Why |
| --- | --- | --- |
| KiwiSDR receivers, other web SDR kinds later | QSP | KiwiSDRs serve plain `ws://`; Safari refuses it from the https app. |
| PSK Reporter, reports | QSP | IPFIX over UDP to port 4739; a web page cannot send UDP. |
| PSK Reporter, who heard you | Direct | Its MQTT feed accepts a WebSocket from the RR73 site at `wss://mqtt.pskreporter.info:1886` (checked 15 October). It pushes; nothing polls. Topic names and terms of use: Unverified. |
| WSPRnet | QSP | An upload can go out from the page, but its answer cannot be read. |
| Wavelog, Cloudlog | Direct | The operator's own server. Cloudlog is not scheduled. |
| QRZ XML, HamQTH | Direct | Open to browsers. Not scheduled. |

## Deployment

- One program, `rr73-qsp` (`crates/rr73-qsp`), configured by one TOML file (`crates/rr73-qsp/qsp.example.toml`).
- It listens on plain HTTP on the loopback interface behind an HTTPS front. The front strips the API base's path: the app's address is the API base and every request joins onto it, so QSP serves from its own root and has no path to configure.
- The first instance is `https://dmr.pwn.sg/qsp`, behind the Caddy that already serves that host:

  ```
  dmr.pwn.sg {
      handle_path /qsp/* {
          reverse_proxy 127.0.0.1:7373
      }
  }
  ```

## The API

Versioned under `/v1`; `/docs`, `/openapi.json`, `/about` and `/health` are not. Requests carry `Authorization: Bearer <key>` when the instance lists access keys. Errors are JSON: `{"error": {"code": "…", "message": "…"}}`. CORS answers the origins the settings list, or any origin when they list none: no request carries cookies.

| Request | Purpose |
| --- | --- |
| `GET /docs` | The API on one page, rendered from the OpenAPI document the endpoints are built with. No key. |
| `GET /openapi.json` | That document. No key. |
| `GET /about` | Name, version, services offered, whether a key is needed, whether users may add receivers. No key. |
| `GET /health` | `ok`. No key. |
| `GET /v1/sdr/receivers` | The receivers the instance offers. |
| `POST /v1/sdr/sessions` | Start listening: a receiver id, or a kind and address where the instance allows user receivers; the dial frequency in Hz; the encoding. Returns the session and a one-time ticket for its stream. |
| `GET /v1/sdr/sessions/{id}` | The session's state. |
| `PATCH /v1/sdr/sessions/{id}` | Retune: a new dial frequency. |
| `DELETE /v1/sdr/sessions/{id}` | Stop listening. |
| `GET /v1/sdr/sessions/{id}/stream?ticket=` | The audio as a WebSocket. A browser cannot set headers on a WebSocket, so the ticket from the session stands in for the key, once. |
| `POST /v1/pskreporter/receptions` | A batch of decodes and the receiving station. Answers taken, repeats and when the next report goes. |
| `GET /v1/pskreporter/status` | Waiting, sent and the next report. |
| `POST /v1/wsprnet/uploads` | One or more WSPR slots of spots. |
| `GET /v1/wsprnet/uploads/{id}` | Waiting, sent or refused, tries made, next try. |

### The audio stream

Binary WebSocket messages, one frame each, big-endian:

| Bytes | Field |
| --- | --- |
| 1 | Format version, 1 |
| 1 | Encoding: 0 PCM, 16-bit signed; 1 IMA ADPCM, 4-bit |
| 2 | Flags: bit 0 set when the time comes from the receiver's GPS |
| 4 | Sequence number of the frame |
| 8 | UTC of the first sample, microseconds since 1970 |
| 4 | Samples in the frame |
| 4 | ADPCM only: the predictor (i16) and step index (u8) at the frame's start, and a padding byte |
| n | Samples at 12 000 per second, mono |

Text messages carry the session's state as JSON: `{"type": "status", "state": "connecting" | "streaming" | "ended", "reason": …}`. ADPCM is the default: about 6 kB/s, some 22 MB an hour. PCM is 24 kB/s. Each ADPCM frame starts from its own predictor and index, so a lost frame costs only itself.

Time comes from QSP's clock, which its host keeps by NTP. A receiver's GPS time is used only where it is usable; the SARTS Web-888's IQ stream carries none (tools/kiwi).

## Building order

Real services first, owner's call on 15 October 2026: each part is built against the real service and tested against a small stand-in, with no mock mode in QSP itself.

1. QSP with KiwiSDR receive, `/docs`, and Settings › Relay and Settings › Web SDR in the app.
2. PSK Reporter: reports through QSP, who heard you from the MQTT feed.
3. WSPRnet uploads.

## PSK Reporter

From its developer page (https://pskreporter.info/pskdev.html, read 15 October 2026):

- Datagrams go to `report.pskreporter.info` port 4739, all from one UDP source port.
- At most one datagram every 5 min, unless one fills up. The timer counts from start-up and never from the clock, with a random part, so instances do not send in step.
- Each callsign at most once per 5 min, and once per hour while nothing about it changes. A change of band counts as a change.
- The record format descriptors go in the first 3 datagrams and then once an hour. The receiver information record goes in every datagram.
- The header's sequence number is the count of reports sent so far. Its observation domain is a random number kept for the session.
- informationSource is 1, automatically extracted. While developing, the 0x80 test bit is set (`test = true` in the settings).
- Sender records use the page's fourth descriptor: senderCallsign, frequency, sNR, iMD, mode, informationSource, senderLocator, flowStartSeconds. RR73 has no IMD figure and sends 0; the page offers no descriptor with sNR and without iMD, and asks software that fits none to ask for one. A locator not received is an empty string.
- Receiver records: receiverCallsign, receiverLocator, decodingSoftware (`RR73 0.x.y`) and antennaInformation when the operator gives one.
- Frequency is the RF frequency: dial plus audio, in Hz. Mode is the ADIF mode or submode: FT8, FT4.
- A datagram stays under 1400 bytes.

The phone sends its decodes to QSP at most once a minute. It sends each station once per band and slot and keeps what QSP has not acknowledged.

## WSPRnet

One upload per 2-minute slot with spots, none for an empty slot; slots that waited go together. After a failure the wait doubles to 30 min at most, and Retry-After is honoured. WSPRnet's upload interface is checked against its own documentation before the live side is built: Unverified.

## Web SDRs

- The settings list the receivers an instance offers: id, kind, name, address, location, grid. Users may add their own (kind and address) only where the settings allow it.
- One upstream connection per receiver and dial; two sessions on the same receiver and dial share it. Audio only, no waterfall.
- Reconnects wait longer each time and stop at the receiver's own time limit. The politeness rules of `tools/kiwi` apply.
- The KiwiSDR client is written from scratch for QSP. The kiwiclient package the corpus recorder fetches carries no licence for its core files and is not read or copied.

## Security

- Access keys, compared in constant time; none means open. An open instance still reaches only the services and receivers its settings list, so it cannot be used as an open proxy.
- A limit on requests per key.
- Logs carry no request bodies.
- No third-party credentials, ever.

## Testing

- Unit: the KiwiSDR client's handling of the receiver's messages; ADPCM round trip; frame encoding. With PSK Reporter: the IPFIX encoder reproduces the developer page's example datagram byte for byte, and the batching rules.
- API: every endpoint through the router; the stream over a real WebSocket from a stand-in KiwiSDR.
- No test reaches a real service.

## Alternatives rejected

- Credentials for QRZ Logbook, eQSL, Club Log and HRDLog through QSP: the owner will not have credentials in transit. Wavelog uploads to the first three.
- Cloudflare Workers: no UDP, so no PSK Reporter reports.
- The NAS at home behind a tunnel: down whenever the house is offline.
- Who heard you through QSP's polling of PSK Reporter's query API: limited to once per 5 min and unreadable from the page; the MQTT feed pushes to the page directly.
- QSP passing the KiwiSDR protocol through to the app: every new SDR kind would need an app release.

## Open risks

- The SARTS receiver's session limits and channels in use by others.
- PSK Reporter's MQTT feed: its topic names and terms of use, checked before building who heard you.
- WSPRnet's upload interface and its load.
- A server needs looking after: updates, renewals and a check that it is up. A self-hosted instance puts that on its operator.
