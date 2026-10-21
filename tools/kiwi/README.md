# rr73-kiwi

`rr73-kiwi` records FT8 and WSPR slots from KiwiSDR receivers into the RR73 corpus, holding one channel per receiver and leaving channels free for other listeners.

## Setup

```sh
docker compose build kiwi
docker compose run --rm kiwi record --help
```

The image is `python:3.12-slim` with numpy 2.2.6, pytest and ruff, plus the official KiwiSDR client, [kiwiclient](https://github.com/jks-prv/kiwiclient), at commit `4eb733e6b6147f7fbeb97ced64cdac029b202d18` (v1.11, 3 August 2026). The build downloads the commit's archive, checks its SHA-256 and unpacks it to `/opt/kiwiclient`; kiwiclient is never stored in this repository. The recorder code runs from the mounted workspace (`tools/kiwi`), so code changes need no rebuild. The image takes about 360 MB on disk.

kiwiclient has no licence file and its core files (`kiwi/client.py`, `kiwi/wsclient.py`) carry no licence statement. Its bundled `mod_pywebsocket` is BSD-3-Clause (Google), `chunk` is under the Python licence, `samplerate` is MIT, and `kiwi/rigctld.py` is GPL-2.0-or-later. rr73-kiwi loads only `kiwi.client`, `kiwi.wsclient` and `mod_pywebsocket`: `rr73_kiwi/kiwiclient.py` skips the package's `__init__.py`, which would also load `kiwi.rigctld`. Because the core files grant no licence, kiwiclient is fetched at build time for local use and not redistributed.

## Recording

```sh
docker compose run --rm kiwi record --check                          # status and plan, no connection
docker compose run --rm kiwi record --receiver sarts-web888 --band 40m --minutes 4
docker compose run --rm kiwi record --sessions 0 --hours 6          # follow the plan for 6 hours
docker compose run --rm wsjtx reference.py corpus/kiwi               # then add jt9 reference decodes
```

Every slot gets `reference.jt9-d3` in a second step, because jt9 lives in the `wsjtx` image. `reference.py` skips slots that already have it, so running it over `corpus/kiwi` after each `record` run decodes only the new slots. For one reference pass per session, run `record --sessions 1` in a loop followed by `reference.py`; the recorder honours the break between sessions across process restarts.

| Option | Meaning |
| --- | --- |
| `--receiver ID` | Receiver from `receivers.toml`; repeat for more. Default: all. |
| `--band 40m` | Band to record; repeat to rotate per session. Default: the receiver's plan for the UTC time. Bands named with `-wspr` (`20m-wspr`, dial 14.0956 MHz; also 40m, 30m, 17m, 15m and 10m) record WSPR. |
| `--minutes N` | Session length, 1 to 15 minutes. Default: the receiver's `session_minutes`. |
| `--sessions N` | Sessions to record before exiting; 0 for no limit. Default: 1. |
| `--hours H` | Start no session after H hours. |
| `--ntp-server` | NTP server for the host clock offset, `none` to skip. Default: `pool.ntp.org`. |
| `--check` | Read each receiver's `/status` and print the plan and the next allowed attempt. |

The exit status is 0 when the requested sessions were recorded, 3 when a signal or the deadline stopped the run first, and 1 for configuration errors. SIGINT and SIGTERM end the session cleanly: the WebSocket closes with status 1001 and the partial slot is discarded.

## Receivers

`receivers.toml` lists the receivers kept in the repository; `--config` takes another file, such as a list kept with the corpus. The first is the SARTS Web-888 in Singapore, `167.172.88.10:80` behind nginx, operated by 9V1YC for SARTS: KiwiSDR software v2026.205, 13 channels, Wellbrook loop, grid OJ11.

| Field | Meaning |
| --- | --- |
| `id` | Directory name under `corpus/kiwi/`; lower-case letters, digits and hyphens. |
| `host`, `port` | Receiver address. Port defaults to 80. |
| `access` | `club` for receivers of a club the RR73 owner belongs to; `public` for any other receiver. |
| `antenna`, `grid` | Copied into every sidecar's `source`. |
| `session_minutes` | 1 to 15. Default 12. |
| `break_minutes` | At least 5 for club receivers and 30 for public receivers. Defaults 5 and 45. |
| `latency_s` | Correction for NTP timing, 0 to 10 s; subtracted from every sample time. Default 0. |
| `[[receiver.plan]]` | `from`, `to` (UTC `HH:MM`) and `bands`. The windows must cover all 24 hours. |

## Politeness rules

The rules are in `rr73_kiwi/politeness.py` and apply to every receiver. A receiver's entry can make them stricter and never looser; the configuration loader rejects shorter breaks or longer sessions.

| Rule | Club | Public |
| --- | --- | --- |
| Channels per receiver | 1 | 1 |
| Read `/status` before connecting; connect only if this many channels stay free afterwards | 2 | 3 |
| Session length | at most 15 min | at most 15 min |
| Break after a session | at least 5 min | at least 30 min |
| Wait after finding the receiver busy | 10 min | 30 min |
| Backoff after an error, doubling per consecutive error | 2 min to 2 h | 10 min to 6 h |
| Minimum gap between attempts | 1 min | 5 min |

- The user name is `RR73 corpus 9V1NE` (sent URL-encoded as `SET ident_user=`), and `/status` requests carry it in the User-Agent.
- During a session the recorder reads `/status` every 2 minutes and ends the session when other listeners leave 1 channel or fewer free.
- The receiver's own limits come from its configuration after connecting (`inactivity_timeout_mins`, `ip_limit_mins`). Sessions end 1 minute before the inactivity timeout. With a per-address daily limit, the recorder counts its connected time over 24 hours and stops starting sessions when less than 2 minutes would remain. The SARTS receiver reports a 90-minute inactivity timeout and no daily limit.
- A receiver that closes a running session counts as an error. Any message from the receiver whose name or value mentions a limit, timeout, inactivity or kick (configuration messages aside), or kiwiclient's time-limit error, marks the session as time-limited and gives a 6-hour wait. The messages a real receiver sends at its limits have not been observed, so this match is broad on purpose. `too_busy`, a redirect or a password refusal counts as busy. The WebSocket opens with one HTTP handshake: a redirect ends the attempt, and rr73-kiwi never follows it to another host.
- The next allowed attempt is saved before every connection in `corpus/kiwi/<receiver>/.rr73-kiwi-state`, so restarts keep the waits. An exclusive `flock` on `.rr73-kiwi-lock` in the same directory, held for the whole session, keeps a second process off the receiver. The kernel releases it when the holder exits, so a crash leaves no stale lock. Tested across two containers on a Docker Desktop bind mount; on a file system without `flock` the recorder stops with exit status 1.

## WSPR

A `-wspr` band tunes the WSPR dial frequency (USB; signals sit 1400 to 1600 Hz above it) and cuts the stream into 120 s slots starting in even UTC minutes: 1 440 000 samples, sidecar mode `WSPR`. Everything else (passband, resampling, timing, politeness) is as for FT8. A 12-minute session gives 5 slots. Reference decodes come from `wsprd`:

```sh
docker compose run --rm kiwi record --receiver sarts-web888 --band 20m-wspr --minutes 12
docker compose run --rm wsjtx python3 tools/wsjtx/wspr_reference.py corpus/kiwi
```

## Audio and timing

- The channel runs in IQ mode at the FT8 dial frequency with a 100 to 3000 Hz passband and the receiver's default AGC, with compression off. The SARTS Web-888 applies the passband to the IQ stream: in a 40m capture the lower sideband sat 70 dB below the upper. The recorder also keeps only positive frequencies from 100 to 3000 Hz (50 Hz raised-cosine edges) and takes the real part, which is the USB audio.
- Audio is resampled to exactly 12000 Hz by Kaiser-windowed sinc interpolation (64 taps) at the exact output sample times. Against exact tones from 100 to 3000 Hz at input rates of 11998.7, 12000, 12001.135 and 20250 Hz the error is at most −91.6 dB. A slot takes about 0.9 s to process on one core.
- Slots start on UTC multiples of 15 s and hold exactly 180000 samples. The first second after connecting or after a gap is not used. A slot is written only when the stream covers it, plus 0.25 s on each side, without a sequence gap. Partial slots are discarded.
- GPS timing: in IQ mode each frame of 512 samples carries a GPS time of week and the number of frames since the last fix. When the fresh timestamps agree with each other to within 1 sample and with the host clock to within 10 s, a least-squares fit gives the true sample rate and the time of every sample, and the slot is written with `timing.reference = "gps"` and `offset_s = 0`. GPS time and UTC-based timestamps are both recognised; GPS minus UTC is taken as 18 s.
- NTP timing: otherwise the sample times come from the host clock at frame arrival. The lower envelope of arrival times gives the mapping, late by the smallest network and receiver delay. The envelope also gives a sample rate: the smallest delay in each 10 s stretch, fitted with a line. It replaces the receiver's reported rate only when its standard error is below 2 ppm, which with delays that vary by a few milliseconds takes tens of minutes of stream; otherwise the reported rate is used. Both are logged. `offset_s` records the correction added to every sample time: the measured host clock offset from NTP minus `latency_s`. The offset comes from the best of 3 SNTP queries; replies from unsynchronised servers, replies that do not echo the request and offsets over 60 s are ignored, and the GPS check uses the corrected host clock.
- The SARTS Web-888 sends placeholder GPS fields: every frame claims a fresh fix, the seconds step once per second with a constant nanosecond value, and the time is about 2078 s from GPS time. Its slots are therefore written with NTP timing. It reports a sample rate of exactly 12000 Hz.

## Files

| Path | Contents |
| --- | --- |
| `corpus/kiwi/<receiver>/<YYYYMMDD>/<YYMMDD_HHMMSS>.wav` | 12000 Hz, 16-bit, mono, 180000 samples; sample 0 at the slot start. |
| `corpus/kiwi/<receiver>/<YYYYMMDD>/<YYMMDD_HHMMSS>.json` | Sidecar as in `docs/corpus.md`, with `reference: {}` until `reference.py` runs. |
| `corpus/kiwi/<receiver>/sessions.jsonl` | One line per attempt: outcome, status before connecting, receiver version, reported and measured sample rate, timing, gaps, slots written and discarded, NTP offset. |
| `corpus/kiwi/<receiver>/.rr73-kiwi-state` | Waits, failure count, band rotation and the last 24 hours of sessions. |

The WAV is written first and the sidecar second, each through a temporary file and a rename, so a sidecar always has a complete WAV. Existing slots are never overwritten.

## Tests

```sh
docker compose run --rm kiwi python -m pytest tools/kiwi
docker compose run --rm kiwi ruff check tools/kiwi tools/wsjtx
docker compose run --rm kiwi ruff format --check tools/kiwi tools/wsjtx
```

The tests cover slot alignment (a pulse placed 1.000 s after each slot start lands on sample 12000 within 0.3 samples with GPS timing), exact sample counts, gaps, resampling accuracy, the GPS checks (including Web-888-style placeholders), NTP timing and its correction, sidecar contents, the status rules against a fake `/status` endpoint, receiver limits, the scheduler's waits with a simulated clock, and whole sessions against a fake KiwiSDR that speaks the WebSocket protocol to kiwiclient.

## Test on the SARTS receiver

Two sessions on 12 October 2026 (UTC) on 40m (7.074 MHz), at 05:49 and 05:59 local time in Singapore, with 9 of 13 channels in use before each. Both were followed by `reference.py`.

| Session (UTC) | Length | Slots written | jt9 decodes | Decodes per slot | Median DT |
| --- | --- | --- | --- | --- | --- |
| 21:48:54 to 21:52:46 | 4 min | 15 (21:49:00 to 21:52:30) | 660 | 33 to 53, median 45 | 0.2 s |
| 21:58:39 to 22:01:31 | 3 min | 11 (21:58:45 to 22:01:15) | 410 | 30 to 50, median 37 | 0.3 s |

- Every slot is 12000 Hz, mono, 16-bit, 180000 samples. No sequence gaps and no clipped samples: peaks were 13328 to 14597 of 32767. One partial slot was discarded at the end of each session.
- Timing: NTP, because the Web-888's GPS fields failed the checks ("GPS timestamps differ from the host clock by −2095 s"). The host clock was 3 ms from pool.ntp.org (round trip 7 ms), so `offset_s` is −0.003 s.
- The median DT of 0.2 to 0.3 s includes the smallest network and receiver delay, which NTP timing cannot see, plus the stations' own timing. `latency_s` is left at 0 for the SARTS receiver until it is measured against a GPS-timed reference. Unverified.
- Sample rate: the receiver reports 12000.000 Hz. The second session measured 11999.82 ± 0.21 Hz from arrival times over 3 minutes, consistent with 12000 Hz, so the reported rate was used. The first session used a measured 11999.51 Hz for its later slots, before the fix in commit 77035f6. That moves tones by up to 0.06 Hz and slot alignment by up to 9 ms.
- The receiver's configuration reports a 90-minute inactivity timeout and no daily limit per address.

## Unverified

- GPS timing has been tested only with synthetic frames. The SARTS receiver's IQ stream has no usable GPS time, and no other receiver has been tried.
- Whether real KiwiSDRs send GPS time or UTC in the IQ frames: the recorder accepts either by comparing with the host clock.
- GPS minus UTC is fixed at 18 s. Check IERS Bulletin C for leap seconds after 2026.
- The messages a receiver sends when its inactivity timeout or daily limit ends a session have not been observed.
