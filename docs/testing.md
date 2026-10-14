# Testing

All tests run in Docker (AGENTS.md). The end-to-end suite runs in Chromium and WebKit through Playwright:

```sh
docker compose run --rm e2e npx --prefix web playwright test                     # the suite CI runs
docker compose run --rm e2e npx --prefix web playwright test --project decode    # decoding only
RR73_REVIEW=1 docker compose run --rm e2e npx --prefix web playwright test --project review-375x667 --project review-393x852   # screenshots for the visual review
```

## What runs where

An end-to-end test covers what the unit tests cannot reach: the browser's audio, workers, storage and layout, and the wiring between screens. Logic that runs without a browser, such as the sequencer, the practice band's stations or the log's outbox, is tested in vitest (`web/src/**/*.test.ts`), where a scenario takes milliseconds; an end-to-end test that only repeats one of those scenarios in real time does not belong in the suite.

| Project | Browser | Runs |
| --- | --- | --- |
| `mic`, `decode` | Chromium, a WAV as the microphone | Receive audio, a real decode, the start chime, Timing |
| `chromium` | Chromium | Screens, the log, colours, the bar, Tune, updates and accessibility (axe, light and dark) |
| `webkit` | WebKit | Updating beside an older copy of RR73 |
| `webkit-375x667`, `webkit-393x852` | WebKit, iPhone viewports | Layout in the light theme. Theme changes colours only (`tokens.css`), so geometry is checked once. Tests tagged `@ci-375` run at 375 x 667; those that depend on the screen size are also tagged `@ci-393` |
| `webkit-1180x820`, `webkit-852x393`, `chromium-1440x900` | WebKit on an iPad and a phone on its side, Chromium on a desktop | Large screens (`large.spec.ts`) in the light theme: one geometry test per size class, regular width on an iPad on its side and upright (`@ci-regular`) and compact height (`@ci-compact-height`), and the keyboard shortcuts (`@ci-keys`) |
| `transmit`, `tx-cq`, `webkit-tx` | Chromium, WebKit | Transmit timing, Halt and a QSO through the decoder, after the projects above |
| `practice` | Chromium | The practice band in real time, after the transmit projects |

`RR73_REVIEW=1` adds the projects that CI leaves out:

- `review-375x667` and `review-393x852` run every layout test in both themes and `states.spec.ts`, which walks Operate through receiving, CQ, calling, a QSO and Repeat CQ with real transmissions. They save the screens to `web/test-results/screens` (Operate states in `screens/states`, decode colours in `screens/colours`), named by size, theme and screen, such as `webkit-375x667-dark-log.png`. A run took 4.9 min with 5 workers on a 10-core machine (186 tests, 204 screens), most of it the 4 runs of `states.spec.ts`, 2.3 to 2.6 min each, which wait for real slots.
- `slot-record` checks the lost-audio measure behind the decode test's skip (below).
- `review-820x1180`, `review-1180x820`, `review-1440x900` (WebKit), `review-1440x900-chromium` and `review-852x393` run `large.spec.ts` in both themes and save Operate receiving and in a QSO, the Log with a QSO open, Settings, the station details, band and keyboard shortcuts sheets, WSPR and Spots to `web/test-results/screens/large`, for the side-by-side review with the approved mockup (docs/decisions/0008-large-screens.md). A run took about 2 min with 5 workers.

`e2e/operate.spec.ts` keeps the checks from `states.spec.ts` that CI needs, with decodes injected and no transmission: one bottom bar height in every state, the decode rows on screen, messages to you leading their slot, the dimming of unrelated rows while calling or in a QSO (and none while calling CQ, after End QSO or with Tx off), and a run of empty slots as one bar. The review projects also run it, which saves the empty-slot run in both themes at both sizes.

`e2e/wspr.spec.ts` runs WSPR in Operate with the page clock held at the mockup's moments and spots injected through the review hooks: the band sheet's WSPR dial, the 200 Hz ruler, spots farthest first, Beacon with its Next row, the Tx percentage menu, Halt, on air and Sent (shown through hooks: nothing transmits), the ••• menu and a spot's details. CI runs it in light at 375 x 667 (about 7 s); the review projects run both themes at both sizes and save 8 screens each to `screens/wspr`. The beacon's timing and Stop beacon after are unit tests (`src/lib/wspr/schedule.test.ts`, `src/lib/state/wspr.test.ts`); WSPR decoding is tested in Rust and gated in CI (`bench/wspr.json`).

`e2e/hound.spec.ts` runs Hound with injected decodes: the band sheet's dial frequency (refused outside the band, then set), calling the Fox, the report read from a multi-call message, and the Hound item in •••. CI runs it in light at 375 x 667; the review projects run it in both themes at both sizes and save its 4 screenshots.

## Audio tests on a loaded host

Tests that need received audio play a WAV as Chromium's fake microphone (`--use-file-for-fake-audio-capture` in `web/playwright.config.ts`). Chromium loops the file from the moment capture starts and feeds it in real time. When the Docker VM runs short of CPU, that feed falls behind: the missing audio comes back as runs of zeros, which the app mostly records as ordinary samples, and the audio after each run sits later than it should. A transmission cut that way decodes badly: slots that lost 0.3 s or more decoded at most 1 of 4 messages.

Measured on 2026-10-13 on the dev machine (Docker Desktop, 10 CPUs, other projects' test suites running alongside), from slots the app saved while it played the decode test's fixture. Lost audio counts exact-zero runs of 2 ms or more after audio began; load is the 1-minute average when the run started.

| Load average | Slots | Audio lost per slot | Slots that decoded all 4 messages |
| --- | --- | --- | --- |
| 9 to 11 | 22 | 0.015 to 1.58 s | All 12 that lost at most 0.075 s; 2 of the 10 that lost 0.15 s or more |
| 16 to 18.5 | 20 | 0.90 to 4.19 s | None |

Capture also started up to 1.9 s into the first slot after a tap 0.2 s before its start, and the loop drifted against the UTC slots by up to 1.6 s over 5 slots. Undisturbed slots lose about 0.027 s, once per loop: most likely Chromium padding the end of the file before it loops (unverified). Neither `--audio-buffer-size=4096` nor running the audio service in the browser process brought the loss below 0.9 s per slot at load 16 to 18 (4 slots each).

## The decode test

`web/e2e/decode.spec.ts` plays `web/e2e/fixtures/ft8-loop.wav`: 4 messages, each sent 4 times, 3.75 s and 90 Hz apart, in a 15 s loop. Whatever the offset between the loop and the UTC slots, each slot holds one copy of each message at a DT the decoder accepts (`rr73-bench loop-fixture`, docs/bench.md). The test passes when each message decodes from at least one copy in the first two decoded slots, within 3 Hz and 4 dB of that copy. `RR73_E2E_TAP_AT_MS` sets when in the slot the test taps Start audio (default 14800, 0.2 s before a boundary).

The test then reads the app's record of the two slots through Save slot: the sidecar's capture fields and the recorded audio (`web/e2e/slot-record.ts`). A slot is complete when audio began within 0.1 s of its start and less than 0.1 s went missing after that.

- A complete slot that misses a message fails the test everywhere.
- When neither slot is complete, the decodes say nothing about the app. Under GitHub Actions the test fails. Elsewhere it is skipped with the audio lost per slot and the load average, such as "Host overloaded: 2.22 s lost in 06:40:00 UTC, 2.06 s lost in 06:40:15 UTC, load 16.8 16.1 15.5. decode.spec needs real-time audio."

`web/e2e/slot-record.spec.ts` checks that the record shows lost audio: it plays the same loop with 1 s of silence and expects at least 0.95 s lost in a full slot. It runs with `RR73_REVIEW=1 ... --project slot-record`: CI does not need it, as there the decode test fails on any missed message, starved slot or not.

On a loaded host, run the decode project alone, and expect skips while the load average stays above about 12. The transmit projects (`transmit`, `tx-cq`) use the fake microphone too and keep 2 retries.
