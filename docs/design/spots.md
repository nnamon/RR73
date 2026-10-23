# Spots

Spots lists stations spotted on POTA and the DX cluster, so a hunter can find an activator and work them in a few taps. Both sources are off until the operator turns them on in Settings › Optional features.

## Sources

| Source | Request | Notes |
| --- | --- | --- |
| POTA | `GET https://api.pota.app/spot/activator` | The latest spot of each activator. CORS open to every origin. Frequency in kHz as text; `spotTime` in UTC without a zone. |
| HamQTH DX cluster | `GET https://www.hamqth.com/dxc_csv.php?limit=200` | The latest 200 cluster spots, about 90 min. POTA, SOTA, WWFF and IOTA references are read from the comments. HamQTH asks apps to credit it where users see the data, so the list shows "DX cluster data provided by HamQTH.com." |

SOTA has no source of its own: RR73 does not use SOTA's API, so `lib/spots/sota.ts` holds its place and makes no requests. SOTA references in cluster comments still reach the list.

Requests carry no credentials and skip the HTTP cache. Each module header in `lib/spots` records the live format it was checked against on 13 October 2026. `fixtures/spots` holds trimmed recordings of both.

## Load on the services

- The feed polls only while Spots is shown, the page is visible and the phone is online.
- At most one request per source per minute, counted from the start of the last request across pauses and screen changes.
- After a failure the wait doubles, up to 15 min for server errors and 4 min for network errors.
- The practice band pauses both sources: its network guard refuses every request that is not one of the app's own files.

The last good list of each source is kept in IndexedDB and shown offline and after a reload with its time, for up to 60 min.

## The list

- One row per station and band, newest first: callsign, references and park name, frequency and mode, age.
- Chips: the programmes or DX, FT8 and FT4 only (on by default), My bands (bands in the log and the band chosen now), New only.
- From the log: Worked today (grey) for a station worked on the spot's band on the UTC day; New park, New summit, New WWFF or New IOTA (teal) for a reference no QSO names. A station gone QRT reads QRT.
- A tap opens the row with the spotter, the time, a person's comments and Go.

## Go

RR73 cannot tune the radio, so Go does what it can without CAT:

1. Sets the spot's band and mode, for an FT8 or FT4 spot on a band with a dial in `lib/radio/bands.ts`. Other spots open without Go.
2. Opens Operate with the band sheet, which shows the frequency to set the radio to.
3. Chases the station: its rows in the decode list show its first reference where a CQ row has its country ("K-0817"), or Spotted for a DX spot.
4. A QSO the sequencer logs with the station on that band takes the spot's references as theirs (SIG, SIG_INFO and the reference fields), for park to park and summit to summit. That QSO ends the chase; another Go replaces it, and it lapses 60 min after Go.

### Alternatives rejected

- Mark every spotted station in the decode list. It needs the feed polling while Operate is shown, a request a minute for as long as RR73 runs, and references from a spot up to an hour old can be wrong after an activator moves. The chase covers the station the operator chose.
- Fill in their reference for any QSO with a spotted station. Same staleness, and the operator did not ask for it. QSO details can add or change it.
- Set the Rx frequency from the spot's frequency. Spots round to 1 kHz or name the dial frequency, so the audio offset is rarely right.

## Open risks

- The POTA API and HamQTH's CSV feed have no published terms or stability promise. HamQTH calls the CSV feed legacy; the source switches to its JSON API for the session when the CSV fails (`lib/spots/hamqth.ts`).
- The chase lives in memory: a reload drops it.
- Not tested on a device.
