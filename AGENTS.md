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
docker compose run --rm node npm --prefix web run lint:css   # stylelint
docker compose run --rm node npm --prefix web test           # vitest
docker compose run --rm node npm run lint:copy               # style guide lint
docker compose run --rm e2e npx --prefix web playwright test
docker compose run --rm desktop sh -c 'cd desktop && cargo test && cargo clippy --all-targets -- -D warnings'
docker compose run --rm desktop sh -c 'cd desktop && npm ci && npx tauri build --bundles deb,appimage'   # after npm --prefix web run build
docker compose run --rm wsjtx jt9 -8 -d 3 <file.wav>         # reference decodes
docker compose run --rm kiwi record --receiver sarts-web888 --band 40m --minutes 4   # record slots
docker compose run --rm wsjtx reference.py corpus/kiwi        # add jt9 reference decodes
```

## Changes

- Every bug fix comes with a test that fails on the old code.
- Decoder changes carry `rr73-bench compare` output (decodes, false decodes, SNR50, time per slot) in the commit message.
- Run the checks for the code you touched before committing, and state which checks ran. While iterating, run the affected tests and Playwright projects; run the full local suite once before pushing, and let CI do the rest.
- `corpus/` holds recordings and is never committed. Small fixtures go in `fixtures/`.
- GPL code (WSJT-X and its forks, JTDX, MSHV, Decodium, PyFT8, ft8ts, mfsk-core, webft8) is never read or copied. WSJT-X binaries may be run as a reference. ft8_lib (MIT) may be ported with attribution in the file header.

## Branches and releases

- Work on short-lived branches. A branch merges to `main` when CI is green: Rust, the decoder gate, web checks, end-to-end tests and the copy lint.
- Versions follow semantic versioning, at 0.x until the app is ready for operating. One version covers the app and the crates: `Cargo.toml` `[workspace.package]` and `web/package.json`, kept equal by `tools/release/version.mjs check` in CI.
- Every user-visible change adds a line under `## Unreleased` in `CHANGELOG.md`, in the style guide's voice. The app shows the file as Version history.
- Release often: every merge that changes the app or the decoder is followed by a release.
- A minor version (0.x.0) marks a substantial new capability: a new screen or workflow, transmitting, the log, a log destination, a new mode. A patch (0.x.y) covers fixes and improvements to what already exists: decoder accuracy and speed, UI polish, copy, settings. 0.3.0 and 0.4.0 were decoder improvements released as minors before this rule was written down; they stay as published.
- Releases take two steps so CI tests the exact release commit. On the branch, `tools/release/release.sh prepare patch|minor|x.y.z` dates the changelog, bumps both versions and commits "Release x.y.z". After CI is green on the branch and `main` is fast-forwarded to it, `tools/release/release.sh publish` on `main` checks that a CI run passed on that exact commit (the branch's run counts), tags `v<version>`, pushes the tag and publishes the GitHub release with the changelog entries. The tag's CI run skips the tests its commit passed on the branch, builds the app and deploys it to GitHub Pages.

## Code

- Rust: stable toolchain from `rust-toolchain.toml`, `cargo fmt`, `clippy -D warnings`, no `unsafe`, no panics on input data. Public items carry doc comments that state units (Hz, s, dB, samples at 12 kHz).
- TypeScript: strict mode, no `any` in exported signatures. Svelte 5 runes.
- Colours, type sizes and spacing come only from `web/src/styles/tokens.css`.
- Tap targets at least 44 px. Decode rows are 32 px and act by tap, double-tap and touch and hold; slot bars are 22 px.
- Halt is red, always visible in Operate's bottom bar and in every sheet that plays output, and takes one tap.
- Actions take effect on the first tap. No confirmation steps; deleting stored data offers Undo or, failing that, one confirmation.
- Layouts work from 375 x 667 points (iPhone SE) upward, in both light and dark themes.

### Visual review

Check every UI change against these before it ships, and compare the screen side by side with its neighbours in both themes at 375 x 667 and 393 x 852.

`RR73_REVIEW=1 docker compose run --rm e2e npx --prefix web playwright test --project review-375x667 --project review-393x852` saves every screen, sheet and Operate state in both themes at both sizes to `web/test-results/screens` (docs/testing.md).

- Operate is the main screen and starts with its 44 pt top bar. Log, Spots, Settings and their sub-screens open over it and start with `BackLink`: one 44 pt bar, so titles and content line up across screens.
- Content sits 16 pt from the screen edges; text in groups, section headers and footers sits 32 pt in.
- Bar buttons are 44 pt targets side by side, never overlapping, with glyphs of equal size and stroke weight; the last glyph ends 16 pt from the edge, and focus shows a rounded ring.
- Disabled controls show the tint at reduced opacity, never a different grey.
- Status badges share one shape: filled tint capsules of one height.
- Grouped lists follow iOS: 44 pt rows at least, separators inset to the row's text, chevrons on rows that open a screen, a trailing checkmark on the chosen row.
- Placeholders say Required, Optional or the format (YYYY-MM-DD), never a sample value that reads as entered. Fields open the keyboard their values need.
- Values on screen use the style guide's formats, 24-hour UTC times included.

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
- Operate's status line states the event or the new value in a few words, with no full stop: "Tx set to 908 Hz", "No reply from VK2LAW". No reasons or instructions unless the operator has to act. Every line has one style. Its notices live in `web/src/lib/qso/status.ts`, and the copy lint holds them to 6 words.
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

- The README opens with one sentence on what RR73 does and for whom, then its features, the decoder measurements, the requirements and setup.
- Design docs and decision records give the decision, the reason, the alternatives rejected and the open risks. Unknowns are labelled "Unverified" or "Not tested on a device".
- Commit subjects are imperative and under 72 characters: "Add OSD pass to FT8 decoder". The body says what changed and why.
- The changelog lists user-visible changes, one line each.
- Code comments explain intent and constraints. No commented-out code.

## Glossary

| Term | Meaning |
| --- | --- |
| slot | One FT8 (15 s), FT4 (7.5 s) or WSPR (120 s, from an even minute) transmit period, aligned to UTC. Even and odd FT8 and FT4 slots alternate. |
| decode | One message recovered from a slot. |
| QSO | A contact between two stations. |
| callsign | One word. |
| band, mode | 20m, 40m; FT8, FT4, WSPR. |
| Tx, Rx | Transmit, receive. |
| Repeat CQ | The switch in Operate's ••• that keeps CQ going after each QSO: the next caller, or CQ again. Off, Tx goes off after the QSO. Called `run` in the code. |
| Hunt | Answers CQs one after another, logging each QSO, until stopped. |
| tail-end | Calling a station once more as it ends a QSO with another station. |
| activation | Operating from a park, summit or island under one or more references. |
| reference | A POTA, SOTA, WWFF or IOTA identifier, such as SG-0014. |
| destination | Where a copy of the log goes: Wavelog, a file. |
| corpus | Recorded and synthetic slots used to measure decoders. |
| preset | A named decoder configuration, such as `baseline`. |
