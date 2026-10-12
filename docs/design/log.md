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

## Delivery ledger

One entry per QSO and destination: `state`, `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError` (plain words), `remoteRef`, `deliveredAt`, `deliveredUpdatedAt`.

| State | Meaning |
| --- | --- |
| waiting | In the outbox. |
| delivered | The destination confirmed it. |
| refused | The destination said no; `lastError` says why and what to do. |
| changed | Edited after delivery (`updatedAt` > `deliveredUpdatedAt`). |
| file ready | File destinations: included in a file not yet confirmed as submitted. |
| submitted | The operator confirmed a file upload. |
| not needed | Outside the destination's scope, such as POTA for a QSO outside an activation. |

## Outbox

- Runs while the app is open and `navigator.onLine` is true, on start, on `online` events, after each new QSO and every 60 s.
- One request at a time per destination, oldest first. Backoff after errors: 30 s doubling to 30 min. Refusals are not retried until the operator acts.
- After a timeout the next attempt counts as a possible duplicate; destinations that report duplicates (Wavelog does) turn that into `delivered`.

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

From Wavelog's `Api.php` (checked October 2026) and the owner's instance, `https://log.oriongamercat.com`, which answers CORS preflights with `Access-Control-Allow-Origin: *`.

- `GET /api/auth/<key>`: XML with `<status>Valid</status>` and `<rights>` (`r` or `rw`), or a key-invalid message.
- `GET /api/station_info/<key>`: the station locations; the operator picks one, and each activation may pick another.
- `POST /api/qso` with JSON `{ key, station_profile_id, type: "adif", string }`: 201 `{ status: "created", adif_count, adif_errors }` on success; 400 `{ status: "abort", messages }` with the reason; 401 for a missing key, a read-only key or a station that is not the key owner's. `POST /api/qso/true` is a dry run, used by Test connection.
- `POST /api/version` with `{ key }`: the Wavelog version.
- Errors map to plain words: "Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog."; "The station location no longer exists in Wavelog. Choose another in Settings."; a duplicate counts as delivered.

The API key is stored only in this phone's IndexedDB.

### Files

- ADIF export of any selection, through the share sheet when `navigator.canShare({ files })` allows, else a download.
- POTA: one file per park and UTC day, named `CALL@PARK-YYYYMMDD.adi`, with `MY_SIG=POTA` and `MY_SIG_INFO`.
- SOTA: ADIF with `MY_SOTA_REF` and `SOTA_REF`, for import in the SOTA database.
- WWFF: one file per reference, named `callsign@referenceYYYYMMDD.adi`, with `MY_WWFF_REF`, for the national coordinator.
- Marking a file submitted moves its QSOs from `file ready` to `submitted`.

## Activations

An activation holds one or more references (POTA, SOTA, WWFF, IOTA), the callsign used on air, the grid (from GPS or typed), the Wavelog station location, and start and end times. Counting rules shown during operating: POTA 10 QSOs in one UTC day, SOTA 4 QSOs with different stations, WWFF 44 QSOs accumulated per reference across activations. Reference lists ship with the app (fetched at build time) for offline lookup and the nearest reference from GPS.

## Backup

A full ADIF export and a JSON backup with RR73 fields and the ledger, through the share sheet. Import accepts both.
