# Testing

All tests run in Docker (AGENTS.md). The end-to-end suite runs in Chromium and WebKit through Playwright:

```sh
docker compose run --rm e2e npx --prefix web playwright test                     # the whole suite
docker compose run --rm e2e npx --prefix web playwright test --project decode    # decoding only
```

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

`web/e2e/slot-record.spec.ts` checks that the record shows lost audio: it plays the same loop with 1 s of silence and expects at least 0.95 s lost in a full slot.

On a loaded host, run the decode project alone, and expect skips while the load average stays above about 12. The transmit projects (`tx-cq`, `transmit`) use the fake microphone too and keep 2 retries.
