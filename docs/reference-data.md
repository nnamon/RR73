# Reference data

RR73 ships three reference lists: the country file, the POTA parks list and the SOTA summits list. The country file is a Big CTY release committed in the repository, in `refdata/bigcty/`; the other two are downloaded when the app is built. `tools/refdata/build.mjs` converts them to JSON in `web/public/data/`, which Vite copies into the app. The app reads them through `web/src/lib/reference/`. Nothing is fetched from these sources while the app runs, and the build makes no request to country-files.com.

0.12.0 to 0.19.5 also built ARRL's LoTW user list, behind a "LoTW users" switch that nothing read. The owner had no use for it, and both are removed.

## Sources and terms

Terms were checked on 13 October 2026. Each source's terms also travel in `data/manifest.json`.

| Source | Publisher | Download | Terms |
| --- | --- | --- | --- |
| Big CTY country file | Jim Reisert AD1C, country-files.com | Committed in `refdata/bigcty/` from the `bigcty-YYYYMMDD.zip` its `release.json` names. `update-bigcty.mjs` fetches newer releases linked from https://www.country-files.com/category/big-cty/ | MIT licence (https://www.country-files.com/copyright/). `cty.json` carries the copyright and permission notice. |
| POTA parks | Parks on the Air | https://pota.app/all_parks_ext.csv | No terms found on docs.pota.app or its resources page. The POTA logo needs a licence; RR73 does not use it. |
| SOTA summits | Summits on the Air | https://storage.sota.org.uk/summitslist.csv | Source: Summits on the Air. No endorsement implied. No licence found for the list. |

SOTA: the SOTA API terms (https://api-db2.sota.org.uk/docs) bar AI-generated software from the SOTA API without approval from the SOTA Management Team. RR73 uses no SOTA API, and the app never contacts SOTA hosts. The build downloads the public summits list file, at most once a day.

Unverified: the copyright line on the country file reads "Copyright © 1994-" with no holder after it, on the site and in the zip; whether ARRL and POTA accept redistribution of their lists inside an app; whether SOTA counts the summits list file under its API terms.

## What the app gets

Measured on the CI build of 14 October 2026 (run 38488353741, sources fetched at 00:08 UTC), from Big CTY of 15 September 2026 and the SOTA list of 13 October. Gzipped sizes are `gzip -9`, close to what GitHub Pages sends.

| File | Records | Size | Gzipped | Loads |
| --- | --- | --- | --- | --- |
| `cty.json` | 346 entities, 29,321 aliases (23,011 exact callsigns) | 341 kB | 111 kB | With the app (precached) |
| `pota/index.<hash>.json` and 238 shards | 96,585 parks (from a 9.5 MB list) | 6.50 MB | 2.0 MB in all; index 16 kB; median shard 0.6 kB; largest FR 388 kB, US 260 kB, AU 193 kB | When "Activations" is on, shard by shard |
| `sota/index.<hash>.json` and 227 shards, one per association | 182,280 summits (from a 25.2 MB list) | 11.0 MB | 3.2 MB in all; index 13 kB; median shard 4.0 kB; largest XE2 159 kB, KLA 146 kB, LA 127 kB | When "Activations" is on, shard by shard |
| `manifest.json` | Sources, dates, counts, sizes, terms | 3 kB | | With the app (precached) |

Fields kept:

- Country file: per entity the name, primary prefix, WAE flag, ADIF DXCC code (from cty.csv), CQ and ITU zones, continent, position, UTC offset, and the alias list in cty.dat syntax. Positions are east positive and offsets hours east of UTC; cty.dat uses the opposite signs.
- POTA: reference, name, position (4 decimals, 11 m) and active flag. 2,783 parks have no usable position (empty, outside ±90° or ±180°, or exactly 0,0) and are kept without one; the list's `K-TEST` row is dropped.
- SOTA: summit code, name, association and region names, position, height (m), points, valid-from and valid-to dates. A valid-to date in 2099 or later means no end date.

## Loading and offline use

The country file is core: the service worker precaches it with the app, and no switch turns it off. The precache is 1.67 MB with it, against the 3 MB limit in `e2e/service-worker.spec.ts`. `reference.countries()` loads it once and `loadedCountries()` returns it synchronously afterwards, for lists of decodes.

### Country on CQ rows

Operate calls `reference.warm()` when it opens. Once the page is idle (after 2 s where `requestIdleCallback` is missing), the country file loads and its index is built. CQ rows then name the calling station's DXCC entity by its short name (below) before the numbers: "Australia" on the row for "CQ VK2LAW QF56", "Germany" for DL1ABC. A WAE entity shows its DXCC entity: Sicily shows Italy, European Turkey shows Turkey. Rows drawn before the file loads show no country and fill in later; the row keeps its 32 pt height. Other rows, our own transmissions and calls with no entity (/MM, /AM, unknown prefixes, hashed calls not heard in full) show none.

The message keeps its whole width. The country takes the space left before the numbers, ends in an ellipsis when short of room and drops out under 36 px (`DecodeList.svelte`).

### Decode colours

The New DXCC entity, continent, CQ zone and ITU zone colours place each CQ, 73 or RR73 sender and each QSO in the log through the same index (`docs/design/decode-colours.md`). The log is indexed again when the country file loads; until then those colours match nothing.

Decision: look up on the main thread, per row as it is drawn. A lookup takes about 1 µs in Node; the index build is the only cost worth measuring (see Open risks). Rejected:

- Lookups in the decoder worker, sent with each decode: a change to the decode protocol and a second copy of the index, for about 50 µs of work per slot.
- A country column of fixed width: it takes room from the message on every row, and most rows are not CQs.

Rows show a short name where the country file's name is longer than 14 characters, or where operators use another name (`lib/reference/names.ts`). Separate DXCC entities keep separate names, and a unit test checks that no two share one. Six names stay longer than 14 characters because operators use no shorter form: European Russia, Franz Josef Land, Minami Torishima, NZ Subantarctic, Papua New Guinea and Tristan da Cunha. The changes, country file name first:

| Country file | Shown |
| --- | --- |
| Agalega & St. Brandon | Agalega |
| Amsterdam & St. Paul Is. | Amsterdam Is. |
| Andaman & Nicobar Is. | Andaman Is. |
| Antigua & Barbuda | Antigua |
| Ascension Island | Ascension |
| Asiatic Turkey | Turkey |
| Austral Islands | Austral Is. |
| Baker & Howland Islands | Baker/Howland |
| Balearic Islands | Balearic Is. |
| Bosnia-Herzegovina | Bosnia |
| British Virgin Islands | Br. Virgin Is. |
| Brunei Darussalam | Brunei |
| Central African Republic | Central Africa |
| Central Kiribati | C. Kiribati |
| Ceuta & Melilla | Ceuta/Melilla |
| Chatham Islands | Chatham Is. |
| Chesterfield Islands | Chesterfield |
| Christmas Island | Christmas Is. |
| Clipperton Island | Clipperton |
| Cocos (Keeling) Islands | Cocos Keeling |
| Dem. Rep. of the Congo | DR Congo |
| Desecheo Island | Desecheo |
| Dominican Republic | Dominican Rep. |
| DPR of Korea | North Korea |
| Eastern Kiribati | E. Kiribati |
| Equatorial Guinea | Eq. Guinea |
| European Turkey | Eur. Turkey |
| Falkland Islands | Falklands |
| Fed. Rep. of Germany | Germany |
| Fernando de Noronha | F. de Noronha |
| French Polynesia | Fr. Polynesia |
| Galapagos Islands | Galapagos |
| Glorioso Islands | Glorioso Is. |
| Johnston Island | Johnston Is. |
| Juan de Nova, Europa | Juan de Nova |
| Juan Fernandez Islands | Juan Fernandez |
| Kerguelen Islands | Kerguelen |
| Kermadec Islands | Kermadec |
| Kingdom of Eswatini | Eswatini |
| Lakshadweep Islands | Lakshadweep |
| Lord Howe Island | Lord Howe |
| Macquarie Island | Macquarie |
| Madeira Islands | Madeira |
| Mariana Islands | Mariana Is. |
| Marquesas Islands | Marquesas |
| Marshall Islands | Marshall Is. |
| N.Z. Subantarctic Is. | NZ Subantarctic |
| North Cook Islands | North Cook Is. |
| North Macedonia | N. Macedonia |
| Northern Ireland | N. Ireland |
| Palmyra & Jarvis Islands | Palmyra/Jarvis |
| Pitcairn Island | Pitcairn |
| Pr. Edward & Marion Is. | Marion Island |
| Republic of Korea | South Korea |
| Republic of Kosovo | Kosovo |
| Republic of South Sudan | South Sudan |
| Republic of the Congo | Congo |
| Rodriguez Island | Rodriguez Is. |
| Saba & St. Eustatius | Saba & Statia |
| San Andres & Providencia | San Andres |
| San Felix & San Ambrosio | San Felix |
| Sao Tome & Principe | Sao Tome |
| Scarborough Reef | Scarborough |
| Shetland Islands | Shetland Is. |
| Slovak Republic | Slovakia |
| Solomon Islands | Solomon Is. |
| South Cook Islands | South Cook Is. |
| South Georgia Island | South Georgia |
| South Orkney Islands | South Orkney |
| South Sandwich Islands | South Sandwich |
| South Shetland Islands | South Shetland |
| Sov Mil Order of Malta | SMOM |
| Spratly Islands | Spratly |
| St. Kitts & Nevis | St. Kitts |
| St. Paul Island | St. Paul Is. |
| St. Peter & St. Paul | St. Peter/Paul |
| St. Pierre & Miquelon | St. Pierre |
| Temotu Province | Temotu |
| `Timor - Leste` | Timor-Leste |
| Tokelau Islands | Tokelau |
| Trindade & Martim Vaz | Trindade |
| Trinidad & Tobago | Trinidad |
| Tristan da Cunha & Gough | Tristan da Cunha |
| Tromelin Island | Tromelin |
| Turks & Caicos Islands | Turks & Caicos |
| UK Base Areas on Cyprus | UK Base Areas |
| United Arab Emirates | UAE |
| United Nations HQ | UN HQ |
| US Virgin Islands | US Virgin Is. |
| Vienna Intl Ctr | Vienna Intl |
| Wallis & Futuna Islands | Wallis/Futuna |
| Western Kiribati | W. Kiribati |

The park and summit lists belong to Activations and are not precached. Their loaders take the switch as a boolean: `reference.parks(settings.activations)`, `reference.summits(settings.activations)`. With the switch off they return null and make no request. With it on, files load on first use and stay on the phone in the Cache API (`rr73-reference`), each under a stable slot name with the content-hashed file it came from. A later load reads the kept copy when it is the current build's file, fetches the new file when it is not, and falls back to the older kept copy, marked stale, when the fetch fails. An operator who updated the app at home therefore keeps the park lists in the field. Turning Activations off keeps the copies; `reference.forget(source)` removes them.

Parks and summits are split by key: the POTA prefix (US, VK) or the SOTA association (W7O, G). Looking up a reference reads one shard. The index lists the Maidenhead squares (2° by 1°) holding each shard's references; a nearest search reads shards in order of their nearest square and stops when no unread shard can hold anything closer. The first search for the 10 nearest parks reads 1 shard from Paris (FR, 388 kB gzipped), Munich (DE, 29 kB), Boston (US, 259 kB) and Melbourne (AU, 193 kB), and 2 from Singapore (SG and MY, 4.6 kB). Squares make the index 17 kB gzipped; with 20° by 10° fields it was 6 kB, but the search from Paris read 22 shards. `suggest(text)` lists the references that begin with a partial reference, reading only the shard its key names ("VK-09" reads VK). `keepNear(position, km)` and `keepAll()` download ahead of a trip; `offline()` reports what is on the phone.

Decision: shards by key, kept on demand. Rejected:

- Precaching every list: 3 MB or more gzipped on every install and data update, for every user, against the rule that an optional feature costs nothing while it is off.
- One file per programme: 2.0 MB gzipped to look up one park.
- Shards by Maidenhead field: a lookup by reference would need an index from every reference to its field.
- Fixed file names read network first: GitHub Pages lets caches keep a file for 10 minutes, so an index could outlive the shards it names after a deploy.

Tested in Chromium through Playwright: lookups online, then offline with the country file and manifest from the precache and park shards from the kept copies; a shard never read reports `unreachable`. Playwright's WebKit bypasses the service worker when offline (the app itself does not load), so WebKit was tested online only. Not tested on a device: offline use and how much the Cache API may hold on iPhone. Safari does not apply its 7-day storage limit to web apps on the home screen.

## Callsign rules

`dxcc.ts` and `callsign.ts` state the rules in full. An exact callsign in the country file wins; /MM and /AM have no entity; a prefix before the home call is the location (VK3/9V1NE is Australia). After the home call, a single digit is a call area (K1ABC/6 uses K6); one letter, LH, AE, AG or 3 or more letters are ignored (/P, /QRP, the Argentine province letters); anything else is the location (9V1NE/VK3). Then the longest prefix wins. WAE entities report their DXCC entity and code for ADIF.

## Refreshing

`build.mjs` asks each downloaded source (POTA and SOTA) at most once per UTC day, with one attempt and no retries. It keeps each source's download, HTTP validators and converted files in `.refdata-cache/`, stamped with a hash of the converter code: a later day's request can come back 304 Not Modified, and a changed converter converts the kept download again without a request. When a download fails, the build ships the older copy (status `stale`) or goes on without the source (status `missing`), and the app reports the source as unavailable. `manifest.json` records each source's status, download and check times, the publisher's data date, sizes and terms.

The country file takes no part in this. Every CQ row reads it, so it does not depend on a download: every build converts the release committed in `refdata/bigcty/`, with no request and no cache entry. The manifest lists it with status `ok`, the release's date and zip URL, and a note that the copy is the one committed in the repository. `verify-dist.mjs` fails a build that has no country file. 0.11.1 to 0.12.2 shipped without one after the site's category page changed, and 0.12.3 fell back to a pinned release when its download failed.

### The committed country file

`refdata/bigcty/` holds one Big CTY release:

| File | Contents |
| --- | --- |
| `cty.dat.gz` | cty.dat as released |
| `cty-columns.csv.gz` | cty.csv without its alias column, which repeats cty.dat. It gives each entity its ADIF DXCC code. |
| `copyright.txt` | The release's copyright and MIT permission notice, as released. `cty.json` carries it. |
| `release.json` | The release date and the URL of the zip the files came from |

The build, the unit tests (`bigCtyFixture` in `web/src/lib/reference/testing.ts`) and the tool tests read these files. There is no other copy.

Big CTY releases a few times a month: the category page listed 10 releases from 27 June to 15 September 2026 when it was read on 14 October 2026, with none after. To take a newer release, in the node container from the repository root:

```sh
docker compose run --rm node node tools/refdata/update-bigcty.mjs
```

The command reads the category page. Since October 2026 the page shows each release as an excerpt, and only the release's own post links its zip. When the newest release is newer than the committed one, the command reads its post, downloads the zip, converts it as the build does and replaces the four files: three requests. Otherwise it reads the category page only and changes nothing. It prints the two release dates, the entity count, the entities added, removed or renamed, and the number of prefixes and callsigns. A failed request, or a zip that lacks cty.dat, cty.csv or copyright.txt or does not convert, leaves the files as they were.

The command commits nothing. Review the diff, run the tool tests and the unit tests, and commit the files with a changelog line. `dxcc.test.ts` checks lookups that the release notes of 15 September 2026 describe, and `names.test.ts` checks that every entity has a display name of at most 14 characters: a failure after an update names the callsign or entity that changed.

In CI the "Reference data" job keeps `.refdata-cache` in the Actions cache under the UTC date and chooses what to ask with `tools/refdata/ci-plan.mjs`:

- Runs on main may ask POTA and SOTA, and the build asks each at most once per UTC day. No run asks for the country file.
- Branches, tags and pull requests restore the newest cache they can read, their own or main's, and build from it with no requests. A run that restores no cache at all asks, so a build before main has a cache still gets the parks list.
- The SOTA list is asked at most once per UTC day across the repository. Actions caches belong to one branch each, so the job lists the repository's caches through the GitHub API (`actions: read`) for an entry `sota-asked-<date>`, and asks only when there is none. It saves that entry before the request goes out. A failed listing counts as asked.
- The build records each attempt in the cache before its request, and the job saves the cache after a failed or cancelled build too, so a second run that day does not ask again.

The web and end-to-end jobs take the output as an artifact, and the web job checks the built app with `tools/refdata/verify-dist.mjs`: every listed file present and readable, the country file and manifest precached, nothing optional precached. A release ships the country file committed at its commit and the other lists from main's newest cache. The end-to-end test of the country on CQ rows serves the country file converted from `refdata/bigcty/` by the test helper and does not depend on a build of the reference data.

Locally, in the node container from the repository root:

```sh
docker compose run --rm node node tools/refdata/build.mjs                  # all sources into web/public/data
docker compose run --rm node node tools/refdata/build.mjs --only cty,pota  # some sources
docker compose run --rm node node tools/refdata/build.mjs --offline        # rebuild from .refdata-cache, no requests
docker compose run --rm node npm --prefix web run build
docker compose run --rm node node tools/refdata/verify-dist.mjs web/dist
docker compose run --rm node npm run test:tools                             # build script tests, no network
docker compose run --rm node node tools/refdata/update-bigcty.mjs           # a newer Big CTY into refdata/bigcty, to review and commit
```

Without `web/public/data` the app builds and runs; every lookup reports its source as unavailable.

## Open risks

- Building the country index runs on the main thread: 7 to 37 ms (50 to 205 ms before alias overrides were read on first match), measured in Node on the build machine under load. `warm()` runs them when the page is idle. Not measured on a phone; a worker would take them off the main thread.
- Two runs allowed to ask SOTA that list the caches within the same few seconds both ask: the entry is saved after the listing. Only main and runs without any cache may ask, so it takes a push to main and a run without a cache at the same moment. When saving the entry fails, a later run that day asks again.
- On the day main first runs the job, a branch that asked SOTA the same day leaves main without the summits list until the next day.
- A search near a country with many parks reads that country's whole shard: 388 kB gzipped for France. Splitting the largest shards by region would cut it.
- `update-bigcty.mjs` finds releases by scraping the category page and the release post. A site redesign stops updates until `findLatestBigCty` follows it. Builds are unaffected and ship the committed release meanwhile.
- The country file is as current as the last update someone committed. Nothing reports that a newer release is out.
