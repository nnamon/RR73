# Reference data

RR73 ships four reference lists, fetched when the app is built: the country file, the LoTW user list, the POTA parks list and the SOTA summits list. `tools/refdata/build.mjs` downloads them and converts them to JSON in `web/public/data/`, which Vite copies into the app. The app reads them through `web/src/lib/reference/`. Nothing is fetched from these sources while the app runs.

## Sources and terms

Terms were checked on 13 October 2026. Each source's terms also travel in `data/manifest.json`.

| Source | Publisher | Download | Terms |
| --- | --- | --- | --- |
| Big CTY country file | Jim Reisert AD1C, country-files.com | The newest `bigcty-YYYYMMDD.zip` linked from https://www.country-files.com/category/big-cty/ (cty.dat, cty.csv, copyright.txt) | MIT licence (https://www.country-files.com/copyright/). `cty.json` carries the copyright and permission notice. |
| LoTW user activity | ARRL, Logbook of The World | https://lotw.arrl.org/lotw-user-activity.csv | No terms published for the file. ARRL documents it for logging software at https://lotw.arrl.org/lotw-help/developer-query-lotw-users/ and updates it about once a week. |
| POTA parks | Parks on the Air | https://pota.app/all_parks_ext.csv | No terms found on docs.pota.app or its resources page. The POTA logo needs a licence; RR73 does not use it. |
| SOTA summits | Summits on the Air | https://storage.sota.org.uk/summitslist.csv | Source: Summits on the Air. No endorsement implied. No licence found for the list. |

SOTA: the SOTA API terms (https://api-db2.sota.org.uk/docs) bar AI-generated software from the SOTA API without approval from the SOTA Management Team. RR73 uses no SOTA API, and the app never contacts SOTA hosts. The build downloads the public summits list file, at most once a day.

Unverified: the copyright line on the country file reads "Copyright © 1994-" with no holder after it, on the site and in the zip; whether ARRL and POTA accept redistribution of their lists inside an app; whether SOTA counts the summits list file under its API terms.

## What the app gets

Measured on 13 October 2026. Gzipped sizes are `gzip -9`, close to what GitHub Pages sends.

| File | Records | Size | Gzipped | Loads |
| --- | --- | --- | --- | --- |
| `cty.json` | 346 entities, 29,321 aliases (23,011 exact callsigns) | 341 kB | 111 kB | With the app (precached) |
| `lotw.<hash>.json` | 236,500 callsigns | 1.73 MB | 957 kB | When "LoTW users" is on |
| `pota/index.<hash>.json` and 238 shards | 96,536 parks | 6.49 MB | 2.0 MB in all; index 17 kB; median shard 0.6 kB; largest FR 388 kB, US 259 kB, AU 193 kB | When "Activations" is on, shard by shard |
| `sota/index.<hash>.json` and one shard per association | 182,280 summits in 227 associations (from a 25.2 MB list) | Reported by CI | Reported by CI | When "Activations" is on, shard by shard |
| `manifest.json` | Sources, dates, counts, sizes, terms | 2 kB | | With the app (precached) |

Fields kept:

- Country file: per entity the name, primary prefix, WAE flag, ADIF DXCC code (from cty.csv), CQ and ITU zones, continent, position, UTC offset, and the alias list in cty.dat syntax. Positions are east positive and offsets hours east of UTC; cty.dat uses the opposite signs.
- LoTW: callsign and the date of its last upload, grouped by date. Upload times are dropped.
- POTA: reference, name, position (4 decimals, 11 m) and active flag. 2,783 parks have no usable position (empty, outside ±90° or ±180°, or exactly 0,0) and are kept without one; the list's `K-TEST` row is dropped.
- SOTA: summit code, name, association and region names, position, height (m), points, valid-from and valid-to dates. A valid-to date in 2099 or later means no end date.

## Loading and offline use

The country file is core: the service worker precaches it with the app. `reference.countries()` loads it once and `loadedCountries()` returns it synchronously afterwards, for lists of decodes.

The LoTW list and the park and summit lists belong to optional features and are not precached. Their loaders take the feature switch as a boolean: `reference.lotw(settings.lotwUsers)`, `reference.parks(settings.activations)`, `reference.summits(settings.activations)`. With the switch off they return null and make no request. With it on, files load on first use and stay on the phone in the Cache API (`rr73-reference`), each under a stable slot name with the content-hashed file it came from. A later load reads the kept copy when it is the current build's file, fetches the new file when it is not, and falls back to the older kept copy, marked stale, when the fetch fails. An operator who updated the app at home therefore keeps the park lists in the field. `reference.forget(source)` removes a source when its feature is turned off.

Parks and summits are split by key: the POTA prefix (US, VK) or the SOTA association (W7O, G). Looking up a reference reads one shard. The index lists the Maidenhead squares (2° by 1°) holding each shard's references; a nearest search reads shards in order of their nearest square and stops when no unread shard can hold anything closer. The first search for the 10 nearest parks reads 1 shard from Paris (FR, 388 kB gzipped), Munich (DE, 29 kB), Boston (US, 259 kB) and Melbourne (AU, 193 kB), and 2 from Singapore (SG and MY, 4.6 kB). Squares make the index 17 kB gzipped; with 20° by 10° fields it was 6 kB, but the search from Paris read 22 shards. `keepNear(position, km)` and `keepAll()` download ahead of a trip; `offline()` reports what is on the phone.

Decision: shards by key, kept on demand. Rejected:

- Precaching every list: 3 MB or more gzipped on every install and data update, for every user, against the rule that an optional feature costs nothing while it is off.
- One file per programme: 2.0 MB gzipped to look up one park.
- Shards by Maidenhead field: a lookup by reference would need an index from every reference to its field.
- Fixed file names read network first: GitHub Pages lets caches keep a file for 10 minutes, so an index could outlive the shards it names after a deploy.

Tested in Chromium through Playwright: lookups online, then offline with the country file and manifest from the precache and LoTW and park shards from the kept copies; a shard never read reports `unreachable`. Playwright's WebKit bypasses the service worker when offline (the app itself does not load), so WebKit was tested online only. Not tested on a device: offline use and how much the Cache API may hold on iPhone. Safari does not apply its 7-day storage limit to web apps on the home screen.

## Callsign rules

`dxcc.ts` and `callsign.ts` state the rules in full. In short: an exact callsign in the country file wins; /MM and /AM have no entity; a prefix before the home call is the location (VK3/9V1NE is Australia). After the home call, a single digit is a call area (K1ABC/6 uses K6); one letter, LH, AE, AG or 3 or more letters are ignored (/P, /QRP, the Argentine province letters); anything else is the location (9V1NE/VK3). Then the longest prefix wins. WAE entities report their DXCC entity and code for ADIF.

## Refreshing

`build.mjs` asks each source at most once per UTC day, with one attempt and no retries. It keeps each source's converted files and HTTP validators in `.refdata-cache/`, so a later day's request can come back 304 Not Modified. When a download fails, the build ships the older copy (status `stale`) or goes on without the source (status `missing`), and the app reports the source as unavailable. `manifest.json` records each source's status, download and check times, the publisher's data date, sizes and terms.

In CI the "Reference data" job runs the build with `.refdata-cache` in `actions/cache` keyed by the UTC date, so every run after the first on a given day makes no requests. The web and end-to-end jobs take its output as an artifact, and the web job checks the built app with `tools/refdata/verify-dist.mjs`: every listed file present and readable, the country file and manifest precached, nothing optional precached. Each release ships the data its build fetched.

Locally, in the node container from the repository root:

```sh
docker compose run --rm node node tools/refdata/build.mjs                  # all sources into web/public/data
docker compose run --rm node node tools/refdata/build.mjs --only cty,lotw  # some sources
docker compose run --rm node node tools/refdata/build.mjs --offline        # rebuild from .refdata-cache, no requests
docker compose run --rm node npm --prefix web run build
docker compose run --rm node node tools/refdata/verify-dist.mjs web/dist
docker compose run --rm node npm run test:tools                             # build script tests, no network
```

Without `web/public/data` the app builds and runs; every lookup reports its source as unavailable.

## Open risks

- The LoTW list grows each year and changes each week, so every release with "LoTW users" on downloads about 1 MB again.
- A search near a country with many parks reads that country's whole shard: 388 kB gzipped for France. Splitting the largest shards by region would cut it.
- Big CTY is found by scraping the category page for the newest zip link. A site redesign stops updates until `latestBigCty` follows it; the cached copy keeps shipping meanwhile.
