# Working on RR73

Rules for everyone changing this repository, people and coding agents alike. Read `docs/architecture.md` before changing code.

## Tooling

All tooling runs in Docker. Never install or run cargo, node, npm, vite, vitest, Playwright, ft8_lib or WSJT-X tools on the host.

```sh
docker compose run --rm rust cargo test --workspace          # Rust unit and integration tests
docker compose run --rm rust cargo clippy --workspace --all-targets -- -D warnings
docker compose run --rm rust cargo fmt --all --check
docker compose run --rm rust rr73-bench run --preset baseline corpus/synthetic/smoke
docker compose run --rm rust wasm-pack build crates/rr73-wasm --target web --out-dir ../../web/src/wasm/pkg
docker compose run --rm node npm --prefix web ci
docker compose run --rm node npm --prefix web run check      # svelte-check
docker compose run --rm node npm --prefix web test           # vitest
docker compose run --rm node npm run lint:copy               # style guide lint
docker compose run --rm e2e npx --prefix web playwright test
docker compose run --rm wsjtx jt9 -8 -d 3 <file.wav>         # reference decodes
docker compose run --rm kiwi record --receiver sarts-web888 --band 40m --minutes 4   # record slots
docker compose run --rm wsjtx reference.py corpus/kiwi        # add jt9 reference decodes
```

## Changes

- Every bug fix comes with a test that fails on the old code.
- Decoder changes carry `rr73-bench compare` output (decodes, false decodes, SNR50, time per slot) in the commit message.
- Run the checks for the code you touched before committing, and state which checks ran.
- `corpus/` holds recordings and is never committed. Small fixtures go in `fixtures/`.
- GPL code (WSJT-X and its forks, JTDX, MSHV, Decodium, PyFT8, ft8ts, mfsk-core, webft8) is never read or copied. WSJT-X binaries may be run as a reference. ft8_lib (MIT) may be ported with attribution in the file header.
- RR73 never allows unattended operation: Tx and Run start by hand, and the watchdog always runs for QSO modes.

## Branches and releases

- Work on short-lived branches. A branch merges to `main` when CI is green: Rust, the decoder gate, web checks, end-to-end tests and the copy lint.
- Versions follow semantic versioning, at 0.x until the app is ready for operating. One version covers the app and the crates: `Cargo.toml` `[workspace.package]` and `web/package.json`, kept equal by `tools/release/version.mjs check` in CI.
- Every user-visible change adds a line under `## Unreleased` in `CHANGELOG.md`, in the style guide's voice. The app shows the file as Version history.
- Release often: every merge that changes the app or the decoder is followed by a release. Patch for fixes, minor for features.
- `tools/release/release.sh patch|minor|x.y.z` on an up-to-date `main` dates the changelog, bumps both versions, commits, tags `v<version>`, pushes, and publishes the GitHub release with the changelog entries. The tag deploys the app to GitHub Pages.

## Code

- Rust: stable toolchain from `rust-toolchain.toml`, `cargo fmt`, `clippy -D warnings`, no `unsafe`, no panics on input data. Public items carry doc comments that state units (Hz, s, dB, samples at 12 kHz).
- TypeScript: strict mode, no `any` in exported signatures. Svelte 5 runes.
- Colours, type sizes and spacing come only from `web/src/styles/tokens.css`.
- Tap targets at least 44 px. Decode rows 40 px. Halt is the largest control in every transmit dock.
- Layouts work from 375 x 667 points (iPhone SE) upward, in both light and dark themes.

## Style guide

Applies to every string on screen, the README, docs, changelogs, commit messages and code comments. `npm run lint:copy` enforces the mechanical parts.

### Voice

- Lead with the fact, the action or the decision. No preamble.
- Use numbers, units and names: "Decodes arrive 0.4 s after the slot ends."
- One idea per sentence. Active voice.
- The operator's vocabulary from the glossary below. No internal names on screen.
- State uncertainty once, plainly: "Not tested on a device." No stacked hedges.
- British spelling, sentence case, numbers as digits.

### Interface text

- Buttons are a verb and an object: "Log QSO", "Resume audio", "Change band".
- Status says what is true now: "Transmitting", "Waiting for signal", "Refused by Wavelog".
- Errors say what happened, the cause if known, and what to do: "Wavelog refused the API key: it can read but not write. Create a read-write key in Wavelog." Never raw exception text.
- Confirmations name the consequence: "End activation? The 7 QSOs stay on this phone."
- Empty states say what will appear and when.
- Formats: 14.074 MHz, 1500 Hz, −15 dB, 5 W, 37 dBm, 13:14:30 UTC. FT8 message text appears exactly as transmitted.

### Never write

<!-- lint-copy: off -->
| Pattern | Examples | Write |
| --- | --- | --- |
| Meta narration | "This section describes the log." "Here's how it works." "Let's look at…" | The content: "The log stores each QSO as an ADIF record." |
| Throat-clearing and wrap-ups | "It's worth noting that", "Importantly,", "In summary", "Overall" | Delete. |
| Hype | seamless, robust, powerful, intuitive, effortless, cutting-edge, comprehensive, delightful, blazing fast | A measurement or a concrete property. |
| Corporate verbs | leverage, unlock, empower, elevate, supercharge, harness, streamline, dive into | The specific action: use, add, show, send. |
| Contrast clichés | "X, not Y." "Not X, but Y." "It's not just X, it's Y." "Not X. Y." "X over Y" as a slogan. "rather than" or "instead of" added for emphasis. | State X. Mention Y only when the reader would otherwise assume it. |
| Cadence devices | Triplets for rhythm, rhetorical questions, "The result?", one-word dramatic sentences, colon reveals | Plain statements. |
| Em dashes | "fast — really fast" | A full stop, comma, colon or brackets. |
| Fillers | simply, just, easily, obviously, of course, basically, actually, really | Delete. |
| Hedge stacks | "may potentially", "could possibly help to" | "may", or the measured fact. |
| Personality in the product | "Oops", "Great job", "RR73 is thinking…", "We're excited to…", emoji, exclamation marks | The event and its effect: "Wavelog is unreachable. 3 QSOs are waiting." |
| Formatting as emphasis | Bold phrases in every paragraph, a heading every two lines, title-case names for ordinary features | Structure only where it carries information. |

<!-- lint-copy: on -->

### Documentation, commits and comments

- The README opens with one sentence on what RR73 does and for whom, then setup.
- Design docs and decision records give the decision, the reason, the alternatives rejected and the open risks. Unknowns are labelled "Unverified" or "Not tested on a device".
- Commit subjects are imperative and under 72 characters: "Add OSD pass to FT8 decoder". The body says what changed and why.
- The changelog lists user-visible changes, one line each.
- Code comments explain intent and constraints. No commented-out code.

## Glossary

| Term | Meaning |
| --- | --- |
| slot | One FT8 (15 s) or FT4 (7.5 s) transmit period, aligned to UTC. Even and odd slots alternate. |
| decode | One message recovered from a slot. |
| QSO | A contact between two stations. |
| callsign | One word. |
| band, mode | 20m, 40m; FT8, FT4, WSPR. |
| Tx, Rx | Transmit, receive. |
| Run | Run mode: the CQ loop that answers callers and logs QSOs until stopped. |
| activation | Operating from a park, summit or island under one or more references. |
| reference | A POTA, SOTA, WWFF or IOTA identifier, such as SG-0014. |
| destination | Where a copy of the log goes: Wavelog, a file. |
| corpus | Recorded and synthetic slots used to measure decoders. |
| preset | A named decoder configuration, such as `baseline`. |
