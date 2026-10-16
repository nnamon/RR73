# Read Wavelog's log

Read Wavelog's log (Settings › Logging › Wavelog › Worked before) lets decode colours count the QSOs in the operator's Wavelog log as well as those on the phone. The operator logs most QSOs in Wavelog from other stations, so colours from the phone's log alone miss them. Code: `web/src/lib/log/wavelog-worked.ts` (requests, the read and its schedule), `wavelog-worked-store.ts` (storage), `wavelog-worked.svelte.ts` (state and wiring), `worked.ts` (keys, index and merge).

## Decision

- Cosmetic only, by the owner's rule: Wavelog's data changes what RR73 shows and nothing it does, unless a clearly labelled switch says otherwise, and no such switch exists. What Wavelog's log holds counts for decode colours (Worked before, New call and New grid with their band forms, the DXCC, continent and zone categories), the New chip, Hide worked, the callsign labels on the waterfall, RTTY's callsign colours and the station sheet's Worked before row, where the bands and modes only Wavelog holds follow the phone's QSOs, marked "in Wavelog", such as "20m FT8 at 09:14 · 40m FT4 in Wavelog". It never reaches the sequencer: dupes, Hunt's Not worked and New call orders and Repeat CQ's New order come from the phone's log through `sequencerWorked()` in `state/qso.svelte.ts` (docs/design/sequencer.md, Dupes). No switch lets it do more.
- One switch, Read Wavelog's log, off by default. It shows once Wavelog has an address and a key, and stays while it is on, so it can be turned off with the key gone. Use Wavelog above it governs sending; the two are independent.
- When RR73 knows the server's version (Test connection, or the last full read) and it is below 2.5.1, the footer says so: below 2.4.1, "Wavelog 2.3 has no JSON output, so RR73 cannot read its log. Reading needs Wavelog 2.5.1 or later."; from 2.4.1, "This Wavelog is 2.4.2. Reading its log needs Wavelog 2.5.1 or later, or a proxy that adds CORS headers." The switch stays usable, since a proxy can add the headers.
- Turning the switch off, or Remove Wavelog, deletes what was read, with no Undo and no confirmation. AGENTS.md asks for Undo, or failing that one confirmation, before deleting stored data. This is an exception to that rule: what is deleted is a copy of Wavelog's log that the next read brings back.
- Reading pauses while the practice band is on, where the switch is disabled, and nothing read colours practice decodes. Switching the practice log in and out never deletes; once per start, with the operator's own log loaded and the switch off, a database left behind is deleted.

## Reading

From Wavelog's `Api.php`, `Adif_data.php` and `Rate_limit.php` at tag 3.2.4 (MIT licence). No request was sent to a real Wavelog while building it.

- `POST /api/get_contacts_adif` with `{ key, station_id, fetchfromid, limit: 1000, output_format: "json", fields }` returns the QSOs of the station locations with a primary key above `fetchfromid`, lowest first. The fields are CALL, BAND, MODE, SUBMODE and GRIDSQUARE: the worked rules place a station by its call through the country file, so DXCC, CQZ and ITUZ are left out. About 77 bytes a QSO, 77 kB a request. A reply is parsed in one task on the main thread, which is why it holds 1000 QSOs (Main thread, below).
- A series ends on "No new QSOs available." or when `lastfetchedid` stops moving. A reply with fewer rows than the limit does not end it: with `fields`, Wavelog sends rows equal in every field once per reply. `lastfetchedid` may be a numeric string.
- The station locations come from `GET /api/station_info/<key>`, which lists the key owner's locations, or the active logbook's when the owner has chosen that in Wavelog. Wavelog 3.0.0 and later (from `POST /api/version`) get one series for all of them; older versions, and a version RR73 cannot read, one series per location, since a list in `station_id` before 3.0.0 is refused as a location the key cannot read.
- Requests go as uploads do: JSON as text/plain with credentials left out, a CORS simple request. CORS needs Wavelog 2.5.1, as uploads do.
- A check reads each series from the last id seen: at start, when the phone comes online or RR73 comes back on screen, after Wavelog takes an upload (at most every 2 min for these), and every 5 min while RR73 is on screen. A check that finds nothing new costs one request per series and writes only the times.
- The API reports no edits, deletions or QSOs moved between station locations. A full read every 7 days, and Refresh from Wavelog, read every series from id 0 with a fresh list of station locations, and replace what was read when they finish. Until then the old keys stay in use. A full read waits out a failure with what it has read so far while RR73 stays open.
- A station location read before that the key can no longer read (401 "Station ID not accessible") starts a full read.
- Failures wait 30 s, doubling to 30 min. A 429 waits as long as its `retry_after` asks, and does not count as a failure, so a long first read on a rate-limited server does not slow down. Coming online ends the wait. A refused key (401, 403), a refused request (400, or an ADIF reply where JSON was asked for) and an address that is not Wavelog (404, 405) wait for the operator: Refresh from Wavelog, a new address or key, or the switch. Going offline and back does not hide a refusal.
- Refresh from Wavelog always starts from id 0 with the station locations read again, also when a full read waits on a 429.
- A new address or key, or the switch off and on, starts at once: a request still out for the earlier one drops its answer.
- Offline (`navigator.onLine` false), nothing is sent. RR73 has no rule for cellular data, and Safari does not say which network the phone uses, so reading does not look at it.

Errors under the switch say what happened and what to do: "Could not reach Wavelog at log.example.com. Check that this phone is online. Reading the log needs Wavelog 2.5.1 or later. RR73 tries again later." A CORS failure looks like no network, so the message names the version. A 429 says how long Wavelog asked RR73 to wait; a refused key uses the upload's message.

## Storage

- A database of its own, `rr73-wavelog-worked`. It stays apart from the log: the Log, the JSON backup and the ADIF export never see it, and nothing in it is uploaded. Turning the switch off deletes the database; a phone that never turned it on has none.
- The read (`meta`: a fingerprint of the address and key, the series with their last ids, the times of the last check and the last full read, Wavelog's version, and the generation and number of key records) and the keys in records of 1000. A full read writes its records under a new generation, one transaction each, then the read, so a write cut short leaves the last whole read. A check that finds new QSOs writes one record and the read in one transaction. A load reads the records one at a time and refuses a read whose records are not all there.
- A failed write shows under the switch ("This phone refused to store what RR73 read from Wavelog.") and is tried again with the next read: the stored last ids never run ahead of the stored keys.
- Loads and deletes queue behind writes, so turning the switch off and on at once reads afresh.
- Keys are distinct strings: "CALL band MODE" for each call as logged (whole, so VK3/9V1NE places in Australia), and "GRID band" for each 4-character grid. The mode is the submode, else the mode, so Wavelog's MFSK with SUBMODE FT4 counts as FT4. A station worked many times on one band and mode is one key. 70 000 call keys and 1440 grid keys take 1.2 MB as JSON.
- A new address or key starts afresh: keys stored for another fingerprint are deleted at once.

## Merging

- `IndexBuilder` indexes the keys by the log's own rules (`buildLogIndex` uses it too): calls by base callsign (ZL1TQK/P counts for ZL1TQK), grids by square, places by whole call through the country file.
- `mergeLogIndex` lays that index over the phone's: each set becomes a view that asks both, so nothing is copied when the log changes. Each lookup costs 2 set lookups.

## Main thread

A long task on the main thread can delay a transmission's start, and the transmit tests notice a few hundred ms. Every pass over the keys runs in slices (`slices.ts`): after 5 ms of work the slice gives the main thread back through a message channel, which browsers do not hold back as they hold nested timers. Slices are timed on the device, so a slower phone does less per slice.

- A full read adds each page's rows in slices, and keeps the base callsigns that count the stations as it goes. Storing it builds the records in slices and writes one at a time.
- Loading at start reads one record at a time and fills the sets in slices.
- The index is built in slices at start, after a full read and when the country file arrives, while the old one stays in use. A check's new keys go into the index in place, and into a build under way.

The longest gap between turns of the main thread, measured by a message loop in the page, in Chromium in Docker on an Apple M4 with 70 001 QSOs, the country file and Operate on screen, on 16 October 2026 at a load average of 5 to 6, 1 run before and 2 after. "First read" runs from the switch to a greyed row; "Start" reads what was stored and builds the index; "Check" reads 1 new QSO. 4x is Chromium's CPU slowdown by 4, standing in for an older phone.

| Phase | Before, 1x | After, 1x | Before, 4x | After, 4x |
| --- | --- | --- | --- | --- |
| No reading (control) | 7 ms | 5 to 9 ms | 28 ms | 22 and 167 ms |
| First read | 148 ms | 15 to 16 ms | 822 ms | 27 to 33 ms |
| Start | 102 ms | 10 to 13 ms | 504 ms | 21 to 35 ms |
| Check | 133 ms | 5 to 8 ms | 518 ms | 12 to 18 ms |

Before and after run in turn at a load average of 17 to 21 gave the same picture: 212 to 421 ms before against 10 to 25 ms after at 1x, and 509 to 1492 ms against 19 to 71 ms at 4x, where the control reached 53 to 74 ms. The gaps left over 10 ms are of the size the control shows: drawing the screen, garbage collection and parsing a 77 kB reply.

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
- A full read of a large log: 7.7 MB for 100 000 QSOs in 100 requests. On a server with the rate limit of Wavelog's example, 30 requests in 120 s, that takes about 7 min of waits. Closing RR73 during the first read starts it again next time.
- Edits, deletions and moves in Wavelog show only after the next full read, up to 7 days later or on Refresh from Wavelog.
- New station locations show at the next full read.
- The main-thread figures come from Chromium in Docker, with 4 times CPU slowdown standing in for an older phone. Not tested on a device, nor is IndexedDB with 100 or more records of 1000 keys on iOS. Garbage collection after building 70 000 keys can pause the main thread for 5 to 10 ms on its own.
