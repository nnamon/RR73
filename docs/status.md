# Project status

This page records where RR73 stands, so that anyone picking the project up (a person or a coding agent) can carry on from the last release without the history of earlier sessions. Update it whenever a release changes what is open, waiting or decided. AGENTS.md has the rules for working in the repository, and `docs/writing-style.md` governs every word.

## Where it stands

The latest release is 0.28.6 (13 November 2026), live at https://nnamon.github.io/RR73/ with desktop installers on the GitHub release. Nothing is in progress: `main` is the release commit, and no branch carries unreleased work.

The last releases, newest first:

| Version | Change |
| --- | --- |
| 0.28.6 | On-screen text, the guide, the README and Version history rewritten to the style guide; the copy lint stops forcing fragments |
| 0.28.5 | Desktop app shows when a newer release exists; tauri-driver smoke tests run against the Linux build in CI |
| 0.28.4 | Decoder experiment 0015: stage 3 rebuilds its residual strongest first, and OSD decodes whose locator lies far from the sender's country are dropped |
| 0.28.3 | Guide has its own icon |
| 0.28.2 | LQ8 resolves 20-bit hashes sent in the reference library's form |
| 0.28.0, 0.28.1 | LQ8 as a mode; POTA files log LQ8 as MFSK |

## Waiting on the owner

These need the owner's radio or devices, and nothing that depends on them should be built first:

- **IC-705 on Windows.** Rig control opens the port and the radio never answers. Since 0.24.9, Copy connection log records the first 96 bytes each way, and that log is the next step.
- **Desktop app.** Rig control through the native serial bridge, the time server and the update notice on real machines. Whether the guide's links to other websites open from the desktop app is unverified.
- **Timing on the air.** Correct Tx timing, decode timing on a phone, and the Tx delay through Bluetooth audio on iOS.
- **On the air.** Contest exchange, LQ8 against another LQ8 station, and whether Wavelog accepts LQ8 as `MODE DATA` with `SUBMODE LQ8` (a refusal shows the QSO under To do, which the owner accepted).
- **Weekly data refresh.** A scheduled CI job that refreshes the country file and the POTA and SOTA lists between releases. The owner hasn't decided whether they want it.

Held until rig control is tested on the radios: warnings about radio settings (NR, NB and similar), ALC and SWR meters in Tune, WSPR power read from the radio, radio profiles, and the IC-705 level profile for the iPhone.

## Open work

In the owner's order of priority, decoding first:

1. **Decoder.** Overlap is still the largest cause of misses, with 831 of the 1890 left on the 6 public receivers; experiment 0015's "Next" section proposes re-estimating each decode's amplitude with its neighbours removed. The 156 strong, isolated misses need frequency drift and fading measured across a transmission. LDPC and OSD take 45 % of WebKit time, most of it the CQ hypothesis.
2. **FT4 recordings.** `tools/kiwi` records FT8 only. FT4 needs its dials and 7.5 s slots in the recorder before the decoder can be measured on real FT4.
3. **Android and iOS apps** through Tauri: Android self-signed and built in Docker, iOS signed with the owner's free Apple ID every 7 days. No paid accounts or certificates.
4. **Writing pass on code comments** and on the design, decision and experiment records. The on-screen text, the guide, the README and the changelog were rewritten in 0.28.6.
5. **Low priority:** other web SDR sources (the owner picks), and FST4W, Q65, PSK31 or CW.

## Decisions to keep

The owner has dropped these, and they are not to come back: activator mode, the decoder lab, decode history, the IC-705 GPS grid, Club Log, eQSL and HRDLog destinations, LoTW signing, a minimum dB to reply, SuperFox, re-decoding past slots, waterfall controls other than the palette, a log prompt, and park-to-park flags on callers.

Rules the owner has set that AGENTS.md doesn't spell out:

- Never contact anyone: no emails, issues, forms or requests to operators or organisations.
- Respect web SDR operators who block program clients (`ext_api` 0, `too_busy`): drop the receiver, never work around the block.
- The relay carries no third-party credentials. Tests never reach real services, and test spots never go to the production relay.
- No one-time migrations or compatibility shims: change a default and leave stored choices alone.
- The operator controls every setting; defaults stay sane and nothing is locked or lectured about.
- CAT keying stays opt-in.
- Rig control comes from the manufacturers' documents only. Nobody implementing it reads Hamlib or other rig libraries, and nothing in the repository cites them.
- Example callsigns are 9V1NE (the operator), AB4SS, 9V1DE and OE3OGC. Real callsigns stay where they are real data.
- Interface text is dense and frictionless: no confirmation steps, and as much room for the decode list as possible.

## Working setup

- **Worktrees.** Work happens in a worktree per task beside the main checkout (`git worktree add ../rr73-<task> -b <branch> origin/main`), with `.env` copied in. Remove the worktree and its Docker volumes (`docker volume ls`, named after the worktree) once its branch is merged; build output runs to gigabytes per worktree.
- **Corpus.** Recordings live outside the repository on an external drive, at the path `RR73_CORPUS` gives in `.env`; `docker compose` mounts it at `corpus/`.
- **Releasing.** `tools/release/release.sh prepare patch|minor` on the branch, push, then `tools/release/ship.sh <worktree> <version> <previous version> <full commit SHA>`, which waits for CI, fast-forwards `main`, publishes and checks the deploy. AGENTS.md lists the checks to run first.
- **Relay deployment.** The owner runs a QSP relay at the app's version and updates it after each release. Its access details are kept outside this public repository.
