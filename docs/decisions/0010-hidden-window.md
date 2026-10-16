# 0010. Receiving and transmitting with the window hidden

Status: accepted, 2026-10-16

## Context

iOS stops the microphone when RR73 leaves the screen. Up to 0.24.0 RR73 applied that rule everywhere: hiding the page stopped capture and turned Tx off, and Resume audio needed a tap. Chrome and Edge on a desktop keep a page's microphone and AudioContext running while it is hidden: in a background tab, or with the window minimised or covered. On a Windows tablet an operator who switches to another window, such as to spot on POTA, lost receive and the QSO under way.

Chromium throttles a hidden page's timers. Chrome's documentation ("Heavy throttling of chained JS timers beginning in Chrome 88") lists timers checked once per second in a hidden page that has been silent for 30 s, and once per minute for chained timers after 5 minutes hidden. RR73 starts transmissions from timers: each transmit scheduler waits with a timeout until 0.5 s before the start (the pre-roll), and the 1 s ticks of the sequencer, the WSPR beacon and the keyboard modes hand transmissions over and run the watchdog. The audio itself plays on the audio clock, so a timer that fires late costs nothing up to about 0.48 s and makes a late start beyond that.

## Decision

- Where capture survives a hidden page, RR73 keeps receiving, decoding and transmitting while hidden. That is Chromium on a desktop system: `navigator.userAgentData.mobile` false and not iOS (`capturesHidden` in `web/src/lib/app/platform.ts`). iOS, Android, Firefox and desktop Safari keep the old rule: hiding stops capture and turns Tx off.
- The pre-roll waits of the FT8, FT4 and WSPR schedulers and the three 1 s ticks run on wake timers (`web/src/lib/clock/wake.ts`): each timeout also runs in a dedicated worker, whose timers Chromium does not throttle, and the worker's message wakes the page. The page's own timeout runs too, and whichever fires first runs the callback once, so a worker that fails to load leaves the old timing.
- The browser stopping capture while hidden (the context suspended, the track ended or muted) stops audio as any other interruption, and Tx with it. Closing the page halts as before.

## Measurements

Chrome for Testing 153 in new headless mode, Linux arm64, in the Playwright 1.63 image. Playwright keeps its pages visible and launches Chromium with timer throttling off, so the measurement launches Chromium itself and drives it over the DevTools protocol (`web/e2e/hidden-window/`, docs/testing.md). A second tab in front hides RR73, and `document.visibilityState` reads `hidden`. The fake microphone plays `web/e2e/fixtures/ft8-loop.wav`, in which a station calls 9V1NE, so a CQ turns into a QSO with a reply every 30 s. A worklet on the output records each transmission and times its first sample against UTC with `getOutputTimestamp()`, as the transmit tests do. Each round ran 4 measurements at once on a 10-core host, and round 2 also shared it with a full unit test run. "Page timers" is the same build with the worker turned off, which times as before this change.

Timers in the hidden page, capture running:

| Timer | Silent page | Tx audio every 30 s |
| --- | --- | --- |
| A chained 250 ms page timer | 750 to 995 ms late, in 37 of 47 windows of 30 s (2 runs, 10 min hidden each) | at most 260 ms late after the first transmission |
| 1 s ticks on page timers | up to 1005 ms late, 324 of 2448 over 100 ms | up to 1000 ms late, 13 of 1308 over 100 ms |
| 1 s ticks on wake timers | up to 195 ms late, 10 of 2758 over 100 ms | up to 195 ms late, 4 of 2638 over 100 ms |

The schedulers' pre-roll and start timeouts, both cases together: on page timers up to 211 ms late (31 timeouts in 3 runs, 8 over 20 ms); on wake timers at most 11 ms late (57 timeouts in 4 runs). No timer fired more than about 1 s late in 10 minutes hidden: the once-a-minute throttling did not show with capture running.

Transmission starts against slot + 0.5 s, wake timers:

| Case | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| CQ after 1 min hidden and silent | +0.2 ms | −0.1 ms | +40.2 ms |
| CQ after 10 min hidden and silent | −0.2 ms | 0.0 ms | +0.6 ms |
| Tx audio every 30 s, the transmission nearest 1 min hidden | +0.4 ms | −0.5 ms | +6.1 ms |
| Tx audio every 30 s, the transmission nearest 10 min hidden | +0.2 ms | 0.0 ms | −0.5 ms |
| Tx audio every 30 s, worst of 21 in 11 min hidden | +11.0 ms | +112.5 ms | +159.1 ms |
| Page visible, worst of 21 in 11 min | | | +170.6 ms |

The scheduler's own start, from the clock mapping, was on time for every CQ. The worst cases are as large with the page visible: on the shared host the clock mapping moved by up to 200 ms for a moment (round 3's mapping offset ran from −169 to +43 ms across its runs, −116 to +41 ms in the visible one), and two replies were decided after their pre-roll, when the decoder's answer came late, and started 45 and 130 ms late as late starts. The transmit tests run alone on a machine of their own for that reason, and allow 50 ms.

Receive while hidden: every slot RR73 did not transmit in was decoded and none was skipped (41 or 42 per silent run, 22 per run with Tx every 30 s). In round 3 the decoder took 60 to 76 ms per slot at the median and 235 ms at worst.

## Alternatives rejected

- Turning Tx off on hide, with a notice, everywhere: the timers can keep time, and the operator's QSO would end each time they switched windows.
- Waking the page from the capture worklet's chunks (every 42.7 ms): it ties transmit timing to capture and to the main thread taking every chunk.
- A longer pre-roll while hidden: the once-per-second checks need more than 1 s of lead, PTT would go on that much earlier with rig control, and once-a-minute throttling would still miss.

## Open risks

- Not tested on a device: Chrome and Edge on Windows. The measurements ran in headless Chromium on Linux.
- Chromium's documentation puts the once-a-minute throttling after 5 minutes hidden; Chromium's source sets 1 minute for a loaded page. Neither showed with capture running. The wake timers do not depend on it.
- Chrome documents that Energy Saver does not freeze a page using the microphone. Edge's sleeping tabs are Unverified.
- The screen wake lock is released while the page is hidden (W3C Screen Wake Lock, "Handling document loss of visibility"), so Windows' sleep timeout applies: Radio and audio's checklist asks for Sleep set to Never.
- Rig control's own timers (request timeouts, PTT on's confirmation, PTT off after the audio's tail and its retries, the drain, the keying's limit, the polls) and the waits around a keying run on the wake timers too (`docs/design/cat.md`, The link). They were measured against a fake wake clock only (`web/src/lib/cat/radio-wake.test.ts`). Not measured in a hidden page.
- Halt is out of sight while the window is hidden. The watchdog runs on a wake timer, as visible.
