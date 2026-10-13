# Log, destinations and activations

The log in IndexedDB is the record (ADR 0003). Destinations receive copies, and the delivery ledger records what each one holds. Code lives in `web/src/lib/log/`.

## QSO record

Each QSO is an ADIF record plus RR73 fields.

| Field | ADIF | Notes |
| --- | --- | --- |
| Their callsign | `CALL` | |
| Their grid | `GRIDSQUARE` | When received. |
| Mode | `MODE` `FT8`; FT4 as `MODE` `MFSK` with `SUBMODE` `FT4` | ADIF 3.1 rule. |
| Band, frequency | `BAND`, `FREQ` | `FREQ` in MHz = dial + audio frequency. |
| Start, end | `QSO_DATE`, `TIME_ON`, `QSO_DATE_OFF`, `TIME_OFF` | UTC. |
| Reports | `RST_SENT`, `RST_RCVD` | dB, as sent on air, for example `-14`. |
| Station | `STATION_CALLSIGN`, `OPERATOR`, `MY_GRIDSQUARE`, `TX_PWR` | `STATION_CALLSIGN` is the call used on air, such as `VK3/9V1NE`. |
| Activation | `MY_SIG`, `MY_SIG_INFO`, `MY_POTA_REF`, `MY_SOTA_REF`, `MY_WWFF_REF`, `MY_IOTA` | POTA's own docs use `MY_SIG`; both are written. |
| Their reference | `SIG`, `SIG_INFO`, `POTA_REF`, `SOTA_REF`, `WWFF_REF`, `IOTA` | Park to park and summit to summit. |
| Comment | `COMMENT` | |

RR73 fields: `id` (UUID), `createdAt`, `updatedAt`, `activationId`, `deletedAt` (Undo and delete keep a tombstone so destinations can be told), `source` (sequencer or manual) and the decode provenance (preset, SNR, DT, audio frequency).

The sequencer's `logQso(record)` effect calls `logQso(record)` from `lib/log`: it stores the QSO, adds its ledger entries and shows "Logged … · Edit · Undo". The record (`LogQsoRecord` in `lib/log/types.ts`) carries the call, grid, mode, band, dial and audio frequency, start and end, both reports and optionally the activation; the station callsign, operator, grid and references come from the running activation and Settings.

ADIF files are written with UTF-8 byte lengths. Values with characters outside ASCII go last in their record: Wavelog's parser reads a length as characters first and falls back to bytes when that does not end on a field boundary, and the last value always ends on one. A record with several non-ASCII values (only from an import) may still read wrongly in Wavelog. The reader accepts lengths in bytes or characters.

## Delivery ledger

One entry per QSO and destination: `state`, `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError` (plain words), `remoteRef`, `deliveredAt`, `deliveredUpdatedAt`.

| State | Meaning |
| --- | --- |
| not sent | Send automatically is off and the operator has not sent it yet. |
| waiting | In the outbox: queued, and sent while the app is open and online. |
| delivered | The destination confirmed it. |
| refused | The destination said no; `lastError` says why and what to do. |
| changed | Edited or deleted after delivery or submission (`updatedAt` > `deliveredUpdatedAt`). Cleared by Mark handled once the operator made the change there. |
| file ready | File destinations: included in a file not yet confirmed as submitted. |
| submitted | The operator confirmed a file upload. |
| not needed | Outside the destination's scope, such as POTA for a QSO outside an activation, or a QSO undone before it was sent. |

To do counts what needs the operator: not sent, waiting, refused and changed QSOs, and files not yet submitted. Changed is included because the destination holds a copy that no longer matches.

File destinations track each file on its own in the entry's `parts`: a QSO at two parks is in two POTA files and is submitted when both are.

## Outbox

- Send automatically is off by default (0.5.1): the operator reviews the log, then taps Send to Wavelog. QSOs for Wavelog are `not sent` until then, and nothing goes out by itself. Send to Wavelog sends every QSO not sent, oldest first (by start, then by when it was logged), one request each, with progress and a summary; the QSO sheet sends one. A failure or a refusal of the key stops the run, and what is left stays `not sent`.
- A phone that ran 0.5.0, where the default was on, switches it off once at the first start. The kv store records the migration (`migrations`), so turning it on again sticks.
- With Send automatically on, the outbox runs while the app is open and `navigator.onLine` is true, on start, on `online` events, after each new QSO, when a held or backed-off QSO falls due, and every 60 s. Switching it on queues every QSO not sent; switching it off takes what is queued back to `not sent`.
- New QSOs wait 10 s, the life of the logged notice, so Undo never needs a delete at a destination.
- One request at a time per destination, oldest first. Backoff after errors: 30 s doubling to 30 min, per destination, or longer when the destination asks (Wavelog's `retry_after`). Coming online clears the backoff. Refusals are not retried until the operator acts.
- A refusal that applies to the whole destination (a wrong or read-only key, a station location that is gone) refuses every waiting QSO there with the same reason. A new key, address or station location, or a passing Test connection, sends them again.
- After a timeout the next attempt counts as a possible duplicate; destinations that report duplicates (Wavelog does) turn that into `delivered`.
- `lib/log/outbox.ts` takes its clock, storage and destinations as arguments; the tests run it on a fake clock.

## Destination adapters

```ts
interface LogDestination {
  id: string; kind: 'wavelog' | 'adif-file' | 'pota-file' | 'sota-file' | 'wwff-file';
  transport: 'direct' | 'relay' | 'file';
  test(): Promise<Health>;                       // reachable, key valid, can write
  send?(qsos: Qso[]): Promise<Receipt[]>;        // direct and relay transports
  makeFile?(qsos: Qso[], scope: FileScope): Promise<File>;  // file transport
}
```

### Wavelog

From Wavelog's `Api.php`, `Logbook_model.php` and `Adif_parser.php` (read at Wavelog commit 3af1ba5, September 2026) and the owner's instance, `https://log.oriongamercat.com`, which answers CORS preflights with `Access-Control-Allow-Origin: *`.

- `GET /api/auth/<key>`: XML with `<status>Valid</status>` and `<rights>` (`r` or `rw`), or a key-invalid message.
- `GET /api/station_info/<key>`: the station locations; the operator picks one, and each activation may pick another.
- `POST /api/qso` with JSON `{ key, station_profile_id, type: "adif", string }`: 201 `{ status: "created", adif_count, adif_errors }` on success; 400 `{ status: "abort", messages }` with the reasons; 401 for a missing or wrong key or a station location that is not the key owner's; 403 for a read-only key; 429 with `retry_after` when rate limited; 200 `{ status: "failed", reason: "wrong JSON" }` for a body it cannot read. `POST /api/qso/true` is a dry run, used by Test connection: it checks the key's write right and the station location, and stores nothing.
- `POST /api/version` with `{ key }`: the Wavelog version.
- Wavelog's import skips a QSO with the same call, band, mode and minute at the station location and reports "Date/Time: … Callsign: … Band: … Duplicate for …". The first three labels are not translated, so RR73 matches them and counts the QSO as delivered.
- The import refuses a QSO whose `STATION_CALLSIGN` differs from the station location's callsign, or whose `MY_GRIDSQUARE` does not overlap the station location's grid. So the station location follows the activation: VK3/9V1NE needs a location for VK3/9V1NE. The activation form warns before the first QSO, and Fix on such a refusal opens a station location picker.
- The API has no way to change or delete a QSO it holds. Edits and deletes after delivery show as changed until the operator makes them in Wavelog and marks them handled. "Send edits to QSOs already sent" applies to destinations that accept changes; Wavelog does not.
- Each QSO goes in its own request: Wavelog counts errors for the whole batch, so a refusal could not be tied to one QSO otherwise.
- Requests carry the JSON as `text/plain`, a CORS simple request with no preflight: one round trip per QSO on a weak link. Wavelog reads the body whatever its type.
- Errors map to plain words: "Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog."; "The station location no longer exists in Wavelog. Choose another in Settings."; the call on air or grid against the station location, a band missing from Wavelog, rate limits, server errors, timeouts and network failures each have their own message (`lib/log/wavelog.ts`).

The API key is stored only in this phone's IndexedDB. The address must be https: Safari blocks plain http from RR73's https page.

### Files

- ADIF export of any selection, through the share sheet when `navigator.canShare({ files })` allows, else a download. The file is built from memory inside the tap, which the share sheet needs.
- POTA: one file per park and UTC day, named `CALL@PARK-YYYYMMDD.adi`, with `MY_SIG=POTA` and `MY_SIG_INFO` (and `MY_POTA_REF`) naming that park.
- SOTA: one file per summit and UTC day, with `MY_SOTA_REF` and `SOTA_REF`, for import in the SOTA database.
- WWFF: one file per reference and activation, named `CALL@REFERENCE YYYYMMDD.adi` (with a space, as WWFF's log rules write it), with `MY_WWFF_REF`, for the national coordinator.
- ADIF: one file per activation with every field. Off by default.
- A slash cannot appear in a file name: VK3/9V1NE is written VK3-9V1NE, VK3/VC-012 as VK3-VC-012.
- Marking a file submitted moves its QSOs from `file ready` to `submitted`. Files are only for QSOs in an activation.

## Activations

An activation holds one or more references (POTA, SOTA, WWFF, IOTA), the callsign used on air, the grid (from GPS or typed), the Wavelog station location, and start and end times. Counting rules shown during operating: POTA 10 QSOs in one UTC day, SOTA 4 QSOs with different stations, WWFF 44 QSOs accumulated per reference across activations. Reference lists ship with the app (fetched at build time) for offline lookup and the nearest reference from GPS.

As built:

- References are typed and checked against each programme's format (POTA `VK-0921`, SOTA `VK3/VC-012`, WWFF `VKFF-0921`, IOTA `OC-001`). The reference lists are a later task.
- An activation holds several parks, and one summit, one WWFF reference and one island at most.
- POTA counts a repeat of the same call, band and mode in the UTC day once, over every activation at the park that day. SOTA counts different callsigns in the UTC day. WWFF counts every activation at the reference, a repeat of the same call, band, mode and UTC day once.
- Editing an activation restamps its QSOs (references, call on air, grid); QSOs a destination already holds then show as changed.

## Backup

A full ADIF export and a JSON backup with RR73 fields and the ledger, through the share sheet. Import accepts both.

As built: the ADIF export, with `APP_RR73_ID` on each record so a later import can recognise the QSO. The JSON backup and the import screen are not built; the ADIF reader and the record mapping they need are (`lib/log/adif.ts`, `lib/log/qso-adif.ts`).

## Storage

The rr73 IndexedDB database is at version 2: `qsos` (indexed by start time, call, band and activation), `ledger` (keyed by QSO and destination), `destinations` and `activations`, beside version 1's `kv` store, which the upgrade keeps. A QSO and its ledger entries are written in one transaction. The log is held in memory as well; if the phone refuses storage, the Log says so and asks for an ADIF export before closing.

## Open risks

- Unverified with the owner's Wavelog and a real key: the text/plain request, the duplicate match and the station location refusals were checked against Wavelog's source and a mock only.
- Not tested on a device: sharing `.adi` files from the home-screen app, GPS from the home-screen app, and the outbox after iOS suspends and resumes the page.
- Duplicate detection depends on the untranslated "Date/Time:", "Callsign:" and "Band:" labels in Wavelog's message.
