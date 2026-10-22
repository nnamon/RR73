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
| `chromium` | Chromium | Screens, the log, colours, Read Wavelog's log with a mock Wavelog, the bar, Tune, updates and accessibility (axe, light, dark and Sun), the output and input choices, and rig control with a fake IC-705 and a fake KX2 |
| `webkit` | WebKit | Updating beside an older copy of RR73 |
| `webkit-375x667`, `webkit-393x852` | WebKit, iPhone viewports | Layout in the light theme. Theme changes colours only (`tokens.css`), so geometry is checked once. Tests tagged `@ci-375` run at 375 x 667; those that depend on the screen size are also tagged `@ci-393` |
| `webkit-1180x820`, `webkit-852x393`, `chromium-1440x900` | WebKit on an iPad and a phone on its side, Chromium on a desktop | Large screens (`large.spec.ts`) in the light theme: one geometry test per size class, regular width on an iPad on its side and upright (`@ci-regular`) and compact height (`@ci-compact-height`), and the keyboard shortcuts (`@ci-keys`) |
| `transmit`, `tx-cq`, `webkit-tx` | Chromium, WebKit | Transmit timing, Halt, a QSO through the decoder and rig control's PTT, after the projects above |
| `practice` | Chromium | The practice band in real time, after the transmit projects |

CI runs the suite on two machines: `RR73_E2E_PART=transmit` runs the transmit and practice projects, which need a machine with no other test running, and `RR73_E2E_PART=quiet` runs the rest. Unset, one run holds both, the transmit projects last.

`RR73_REVIEW=1` adds the projects that CI leaves out:

- `review-375x667` and `review-393x852` run every layout test in both themes, `layout.spec.ts` and `colours-layout.spec.ts` in Sun as well, and `states.spec.ts`, which walks Operate through receiving, CQ, calling, a QSO and Repeat CQ with real transmissions. They save the screens to `web/test-results/screens` (Operate states in `screens/states`, decode colours in `screens/colours`), named by size, theme and screen, such as `webkit-375x667-dark-log.png`. A run took 4.9 min with 5 workers on a 10-core machine (186 tests, 204 screens), most of it the 4 runs of `states.spec.ts`, 2.3 to 2.6 min each, which wait for real slots.
- `slot-record` checks the lost-audio measure behind the decode test's skip (below).
- `walkthrough` (an iPhone at 393 x 852), `walkthrough-ipad` (1180 x 820) and `walkthrough-desktop` (1440 x 900), all WebKit, take the README's screenshots from the practice band in real time: FT8 receiving and in a QSO, Hound working the practice Fox, WSPR and RTTY (`walkthrough.spec.ts`). They save to `test-results/screens/walkthrough` at the repository root. For `docs/screenshots` they are rendered with SF Pro and SF Mono from a Mac, mounted read-only into the e2e image with a fontconfig file that maps the system font names to them, and scaled to half size; Apple's licence keeps the fonts out of the repository. The Log, activation, Heard you and Settings screenshots come from `review-393x852`.
- `review-820x1180`, `review-1180x820`, `review-1440x900` (WebKit), `review-1440x900-chromium` and `review-852x393` run `large.spec.ts` in both themes and save Operate receiving and in a QSO, the Log with a QSO open, Settings, the station details, band and keyboard shortcuts sheets, WSPR and Spots to `web/test-results/screens/large`, for the side-by-side review with the approved mockup (docs/decisions/0008-large-screens.md). A run took about 2 min with 5 workers.

`e2e/operate.spec.ts` keeps the checks from `states.spec.ts` that CI needs, with decodes injected and no transmission: one bottom bar height in every state, the decode rows on screen, messages to you leading their slot, the dimming of unrelated rows while calling or in a QSO (and none while calling CQ, after End QSO or with Tx off), and a run of empty slots as one bar. The review projects also run it, which saves the empty-slot run in both themes at both sizes.

`e2e/wspr.spec.ts` runs WSPR in Operate with the page clock held at the mockup's moments and spots injected through the review hooks: the band sheet's WSPR dial, the 200 Hz ruler, spots farthest first, Beacon with its Next row, the Tx percentage menu, Halt, on air and Sent (shown through hooks: nothing transmits), the ••• menu and a spot's details. CI runs it in light at 375 x 667 (about 7 s); the review projects run both themes at both sizes and save 8 screens each to `screens/wspr`. The beacon's timing and Stop beacon after are unit tests (`src/lib/wspr/schedule.test.ts`, `src/lib/state/wspr.test.ts`); WSPR decoding is tested in Rust and gated in CI (`bench/wspr.json`).

`e2e/rtty.spec.ts` runs RTTY in Operate with the page clock held at the mockup's moments and the text added through the review hooks (capture is kept from the receiver, so only that text prints): listening, a callsign tapped to fill the strip from the station's text, the Report macro and a typed line on air (a real transmission), the keyboard up with the viewport cut to 516 pt (407 pt at 375 x 667), Halt, logging through the QSO sheet, the Contest set and the other-case reading, weak copy with the squelch and speed menus, the band sheet's RTTY dial, Settings › RTTY and Settings › Macros. CI runs it in light at 375 x 667 (about 20 s); the review projects run both themes at both sizes and save 11 screens each to `screens/rtty`. The keyboard engine's logic is unit tested in `src/lib/keyboard/*.test.ts`.

`e2e/exchange.spec.ts` (project `tx-cq`) sets Custom exchange in Settings › FT8 and FT4, answers a CQ FD from the test hooks with the exchange, sends RR73 after the station's R and exchange, and checks both exchanges in the QSO sheet and as `STX_STRING` and `SRX_STRING` in the ADIF sent to a mock Wavelog. The transmissions are recorded (tap.ts) and decoded in Node.

`e2e/rtty-tx.spec.ts` (project `tx-cq`) records RTTY's output in Chromium (tap.ts) while a line goes out with Return and more is typed on air, and decodes it in Node with `rr73-rtty`'s receiver: the text must come back whole, with no run of silence over 2 ms inside the transmission and no underrun in the stream worklet. It then checks that Halt silences the output within 100 ms and keeps the text not yet sent. The practice project's RTTY test decodes the practice band's RTTY stations in real time through the app's receiver and works JA1XYZ with the Answer macro.

`e2e/rig.spec.ts` (project `chromium`) replaces `navigator.serial` with a fake IC-705 in the page (`e2e/fake-ic705.ts`), which answers CI-V frames in the formats of Icom's CI-V guide and logs each frame with the page's time and the audio clock's. It connects, reads the dial, sets the radio from the band sheet, follows the radio's dial, opens the port again after a reload, and runs Test keying with a radio that answers and one that keeps transmitting.

`e2e/rig-kx2.spec.ts` (project `chromium`) does the same with a fake Elecraft KX2 behind a Digirig (`e2e/fake-kx2.ts`), which answers Elecraft's text commands in the formats of the Programmer's Reference and transmits while RTS is asserted with MIC BTN on PTT, as the Digirig's KX cable wires it. It chooses the KX2, connects with the lines lowered, reads the settings, sets VFO A and DATA A from the band sheet, follows the dial, changes the baud rate, opens the port again after a reload, and runs Test keying with a radio that answers and one that keeps transmitting. `e2e/rig-kx2-tx.spec.ts` (project `tx-cq`) times `TX;` and `RX;` against a CQ's audio on the audio clock, and Halt, as `rig-tx.spec.ts` does for the IC-705.

`e2e/rig-tx.spec.ts` (project `tx-cq`) records the app's output (`tap.ts`) beside the fake IC-705 and times PTT against the audio of a CQ and Tune with Key the radio with CAT off and on, and of RTTY, with Halt, audio stopping and a lost port. PTT and the audio are compared on the audio clock: the fake radio notes `AudioContext.currentTime` as each frame arrives, and the tap the frames of the first and the last sound. Only the start of a CQ is checked against UTC.

These tests needed retries while they ran in the `chromium` project, for two reasons found on 2026-10-16:

- A CQ tapped within about 0.2 s of Start audio was refused with "Audio is not running.", as the audio clock had no mapping to UTC yet, and went a cycle later. The transmit scheduler now times its wait by the page's clock until the mapping exists (`scheduler.test.ts`).
- Beside the rest of the suite, at load averages of 16 to 19, Chromium's fake audio device fell behind real time: 12.8 s of audio clock in 14.9 s. The audio then started up to 0.76 s late against UTC, the tap's mapping of the end was off by 0.6 s, and the keying's limit, timed by the page's clock, ended PTT before the audio ended on the audio clock. The scheduler now stops the audio with PTT at the limit (`scheduler.test.ts`).

`rig-tx.spec.ts` runs after the rest of the suite, as the other transmit tests do, with no retries. Each test measures the audio clock against the page's clock from PTT on to PTT off, and when it fell more than 0.25 s behind it skips with the measurement, such as "Host overloaded: the audio clock fell 1.44 s behind in 14.8 s." On GitHub Actions it fails instead, as `decode.spec.ts` does.

`e2e/hound.spec.ts` runs Hound with injected decodes: the band sheet's dial frequency (refused outside the band, then set), calling the Fox, the report read from a multi-call message, and the Hound item in •••. CI runs it in light at 375 x 667; the review projects run it in both themes at both sizes and save its 4 screenshots.

## A hidden window

Playwright keeps every page visible and starts Chromium with timer throttling off, so the end-to-end tests cannot hide RR73. `web/e2e/hidden-window/measure.mjs` launches Playwright's Chromium itself, in new headless mode, drives it over the DevTools protocol, and hides RR73 behind a second tab. It records each transmission's start against slot + 0.5 s with the output worklet of `tap.ts`, the start the scheduler gave it, how late a chained 250 ms page timer runs, and the slots decoded while hidden, to `web/test-results`:

```sh
docker compose run --rm e2e sh web/e2e/hidden-window/run.sh --build --scenario silent    # CQ after 1 and 10 min hidden
docker compose run --rm e2e sh web/e2e/hidden-window/run.sh --scenario audible           # Tx every 30 s for 11 min hidden
docker compose run --rm e2e sh web/e2e/hidden-window/run.sh --scenario visible           # the same in front, to compare
```

`--scale 0.1` runs the minutes at a tenth for a quick check. The measurements and the decision are in `docs/decisions/0010-hidden-window.md`. `e2e/audio.spec.ts` checks the app's rule with a hidden page simulated: desktop Chromium keeps receiving, and with an iPhone's user agent the page stops audio and waits for Resume audio.

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
