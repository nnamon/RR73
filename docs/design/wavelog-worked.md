# Read Wavelog's log

Read Wavelog's log (Settings › Logging › Wavelog › Worked before) lets decode colours count the QSOs in the operator's Wavelog log as well as those on the phone. The operator logs most QSOs in Wavelog from other stations, so colours from the phone's log alone miss them. Code: `web/src/lib/log/wavelog-worked.ts` (requests, the read and its schedule), `wavelog-worked-store.ts` (storage), `wavelog-worked.svelte.ts` (state and wiring), `worked.ts` (keys, index and merge).

## Decision

- Cosmetic only, by the owner's rule: "It should only be cosmetic unless very clearly enabled to affect behavior." What Wavelog's log holds counts for decode colours (Worked before, New call and New grid with their band forms, the DXCC, continent and zone categories), the New chip, Hide worked, the callsign labels on the waterfall, RTTY's callsign colours and an In Wavelog row on the station sheet. It never reaches the sequencer: dupes, Hunt's Not worked and New call orders and Repeat CQ's New order come from the phone's log through `sequencerWorked()` in `state/qso.svelte.ts` (docs/design/sequencer.md, Dupes). No switch lets it do more.
- One switch, Read Wavelog's log, off by default. It shows once Wavelog has an address and a key. Use Wavelog above it governs sending; the two are independent.
- Turning the switch off, or Remove Wavelog, deletes what was read. It is a copy of Wavelog's log that the next read brings back, so there is no Undo and no confirmation. Reading pauses while the practice band is on, and nothing read colours practice decodes.

## Reading

From Wavelog's `Api.php`, `Adif_data.php` and `Rate_limit.php` at tag 3.2.4 (MIT licence). No request was sent to a real Wavelog while building it.

- `POST /api/get_contacts_adif` with `{ key, station_id, fetchfromid, limit: 5000, output_format: "json", fields }` returns the QSOs of the station locations with a primary key above `fetchfromid`, lowest first. The fields are CALL, BAND, MODE, SUBMODE and GRIDSQUARE: the worked rules place a station by its call through the country file, so DXCC, CQZ and ITUZ are left out. About 77 bytes a QSO, 0.4 MB a request.
- A series ends on "No new QSOs available." or when `lastfetchedid` stops moving. A reply with fewer rows than the limit does not end it: with `fields`, Wavelog sends rows equal in every field once per reply. `lastfetchedid` may be a numeric string.
- The station locations come from `GET /api/station_info/<key>`, which lists the key owner's locations, or the active logbook's when the owner has chosen that in Wavelog. Wavelog 3.0.0 and later (from `POST /api/version`) get one series for all of them; older versions, and a version RR73 cannot read, one series per location, since a list in `station_id` before 3.0.0 is refused as a location the key cannot read.
- Requests go as uploads do: JSON as text/plain with credentials left out, a CORS simple request. CORS needs Wavelog 2.5.1, as uploads do.
- A check reads each series from the last id seen: at start, when the phone comes online or RR73 comes back on screen, after Wavelog takes an upload (at most every 2 min for these), and every 5 min while RR73 is on screen. A check that finds nothing new costs one request per series and writes only the times.
- The API reports no edits, deletions or QSOs moved between station locations. A full read every 7 days, and Refresh from Wavelog, read every series from id 0 with a fresh list of station locations, and replace what was read when they finish. Until then the old keys stay in use. A full read waits out a failure with what it has read so far while RR73 stays open.
- A station location read before that the key can no longer read (401 "Station ID not accessible") starts a full read.
- Failures wait 30 s, doubling to 30 min, or as long as a 429's `retry_after` asks. Coming online ends the wait. A refused key (401, 403), a refused request (400, or an ADIF reply where JSON was asked for) and an address that is not Wavelog (404, 405) wait for the operator: Refresh from Wavelog, a new address or key, or the switch.
- Offline (`navigator.onLine` false), nothing is sent. RR73 has no rule for cellular data, and Safari does not say which network the phone uses, so reading does not look at it.

Errors under the switch say what happened and what to do: "Could not reach Wavelog at log.example.com. Check that this phone is online. Reading the log needs Wavelog 2.5.1 or later. RR73 tries again later." A CORS failure looks like no network, so the message names the version. A 429 says how long Wavelog asked RR73 to wait; a refused key uses the upload's message.

## Storage

- A database of its own, `rr73-wavelog-worked`, with two records: the read (a fingerprint of the address and key, the series with their last ids, the times of the last check and the last full read) and the keys. It stays apart from the log: the Log, the JSON backup and the ADIF export never see it, and nothing in it is uploaded. Turning the switch off deletes the database; a phone that never turned it on has none.
- Keys are distinct strings: "CALL band MODE" for each call as logged (whole, so VK3/9V1NE places in Australia), and "GRID band" for each 4-character grid. The mode is the submode, else the mode, so Wavelog's MFSK with SUBMODE FT4 counts as FT4. A station worked many times on one band and mode is one key. 70 000 call keys and 1440 grid keys take 1.2 MB as JSON.
- A new address or key starts afresh: keys stored for another fingerprint are deleted at once.

## Merging

- `buildKeysIndex` indexes the keys with `buildLogIndex`, the log's own rules: calls by base callsign (ZL1TQK/P counts for ZL1TQK), grids by square, places by whole call through the country file. It runs once per change of the keys or the country file, however many screens ask. For 70 000 call keys it took 340 ms the first time and 110 to 130 ms after, with the places cached, and 56 to 98 ms without the country file (Node in Docker on an Apple M4, 16 October 2026).
- `mergeLogIndex` lays that index over the phone's: each set becomes a view that asks both, so nothing is copied when the log changes. Each lookup costs 2 set lookups.

## Alternatives rejected

- Importing Wavelog's QSOs into the log. They would show in the Log, go into backups and exports, count as dupes and change Hunt.
- A switch that lets Wavelog's log count for dupes and Hunt. The owner asked for none.
- 100 000 records, one per QSO. The colours need only the distinct calls and grids per band and mode.
- Wavelog's DXCC, CQZ and ITUZ fields. The log's QSOs are placed by their call through the country file; taking Wavelog's values would place the same call two ways.
- A list in `station_id` for every version. Wavelog before 3.0.0 refuses it as a location the key cannot read, which reads as a refused key.
- Only the station location chosen for uploads. Most of what the operator worked from other stations sits in other locations.
- Keeping what was read when the switch goes off. The operator turned it off; a copy of another log should not stay on the phone.

## Open risks

- Unverified against a real Wavelog: the requests, the replies and the CORS headers were checked against Wavelog's source and a mock only.
- Wavelog older than 3.0.0 with many station locations: each check costs one request per location. With a rate limit set on the server, checks may wait on 429s.
- A full read of a large log on a weak connection: 7.7 MB for 100 000 QSOs in 20 requests. Closing RR73 during the first read starts it again next time.
- Edits, deletions and moves in Wavelog show only after the next full read, up to 7 days later or on Refresh from Wavelog.
- New station locations show at the next full read.
- Indexing runs on the main thread: at start, when the country file loads, and after each read that adds keys. An iPhone is slower than the measurement above, so a large log may hold the screen for part of a second then. Not tested on a device, nor is a 1.2 MB record in IndexedDB on iOS.
