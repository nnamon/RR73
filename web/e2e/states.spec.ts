// Operate in the states an operator meets, on iPhone viewports in WebKit, light and dark: each
// state is captured for the visual review, the decode rows on screen are counted against the
// targets (13 receiving at 393 x 852, 10 at 375 x 667), and the bottom bar keeps one height. The
// status bar and home indicator insets of the device are applied, as the app runs from the Home
// Screen. WebKit's mock microphone runs the audio; decodes come through the screen-review hooks
// (src/lib/testing/e2e-hooks.ts). Transmissions are real: the scheduler plays them, so each run
// waits for real slots, 1 to 3 min. Messages to you lead their slot with a red edge; during a QSO
// the rows unrelated to it dim. It runs in the review projects only (RR73_REVIEW=1,
// docs/testing.md); operate.spec.ts checks the bar height, the row targets, messages to you, the
// dimming and runs of empty slots in CI.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { smallTargets } from './layout-checks';
import { SLOT, SLOT_A, SLOT_B, TARGET, d, expectNoneDim, expectOursClear, expectToYou, firstInSlot, inject, openOperate, phase, rowOf, rowsOnScreen, type D } from './operate-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/states', import.meta.url));

/** Stations answering a CQ in Run. */
const CALLERS: D[] = [d('9V1NE K1ABC FN42', -12, 2341, 0.2), d('9V1NE ZL1TQK RF73', -4, 2430), d('9V1NE DU1XYZ PK04', -18, 842, 0.3), ...SLOT_A.slice(0, 6)];

for (const theme of ['light', 'dark'] as const) {
  test(`Operate states in ${theme}`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const width = page.viewportSize()!.width;
    const counts: Record<string, number> = {};
    const bars: Record<string, number> = {};
    mkdirSync(SHOTS, { recursive: true });
    // The names the screens had in the webkit projects: webkit-375x667-light-1-receiving.png.
    const prefix = `${SHOTS}/${info.project.name.replace(/^review-/, 'webkit-')}-${theme}`;
    const shot = async (name: string) => {
      // As after a tap on the new decodes pill: the newest slot at the top.
      await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
      await page.waitForTimeout(400);
      counts[name] = await rowsOnScreen(page);
      bars[name] = Math.round((await page.getByRole('region', { name: 'Transmit' }).boundingBox())!.height * 2) / 2;
      expect(await smallTargets(page, 'main .pane:not([hidden])')).toEqual([]);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(wide).toBeLessThanOrEqual(0);
      // The document never scrolls in any state: only the list does.
      expect(await page.evaluate(() => ({ y: window.scrollY, fits: document.scrollingElement!.scrollHeight <= window.innerHeight }))).toEqual({ y: 0, fits: true });
      await page.screenshot({ path: `${prefix}-${name}.png` });
    };
    // Receiving: audio on, nothing decoded yet.
    await openOperate(page, theme);
    const bar = page.getByRole('region', { name: 'Transmit' });
    await shot('1-receiving');

    // Two slots of decodes.
    let now = await phase(page, 2, 11);
    await inject(page, now - 2 * SLOT, SLOT_B);
    await inject(page, now - SLOT, SLOT_A);
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toBeVisible();
    // Fifth from the decoder, first on screen, with the red edge; nothing dims while receiving.
    expect(await firstInSlot(page, now - 2 * SLOT)).toBe('9V1NE JA1KXM PM95');
    await expectToYou(rowOf(page, '9V1NE JA1KXM PM95'));
    await expectNoneDim(page);
    await shot('2-decodes');
    expect(counts['2-decodes']).toBeGreaterThanOrEqual(TARGET[width].receiving);

    // CQ: planned at once, with a countdown at the top of the list, then on air with a progress line.
    // Clicked early in an odd slot, so the even slot it goes out in is 9 to 14 s away.
    await phase(page, 1, 6, 'odd');
    await bar.getByRole('button', { name: 'CQ', exact: true }).click();
    // Tx on is a light tint, set apart from the solid CQ button.
    await expect(bar.locator('[data-id=tx]')).toHaveClass(/soft/);
    await expect(bar.locator('[data-id=cq]')).toHaveClass(/selected/);
    const next = page.getByTestId('next-row');
    await expect(next).toBeVisible();
    await expect(next.locator('.c-tag')).toHaveText(/^Next · :[0-5]\d$/);
    await expect(next.locator('.c-when')).toHaveText(/^in \d+ s$/);
    await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/CQ.*Report.*R-report.*RR73.*Logged/);
    // Calling CQ with nobody answering yet: nothing dims.
    await expectNoneDim(page);
    await shot('3-cq-next');
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 35_000 });
    await expect(bar.locator('[data-id=tx]')).toHaveClass(/air/);
    const cqSlot = await page.evaluate(() => Date.now() - (Date.now() % 15_000));
    const sending = page.getByTestId('decode-list').locator('button.dr.sending');
    await expect(sending.locator('.c-tag')).toHaveText('Sending');
    await expect(next).toHaveCount(0);
    await page.waitForTimeout(2000);
    await shot('4-cq-sending');
    expect(await sending.locator('.prog').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0);
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
    await expect(page.getByTestId('decode-list').locator('button.dr.sent .c-tag').first()).toHaveText('Sent');

    // Calling: fresh decodes in the slot after the CQ; a double-tap on a CQ calls with Tx on, and
    // the next slot of the other parity goes out.
    // The slot heard in has ended and was decoded, so the decoder's own result does not replace it.
    let after = await phase(page, 2, 5);
    while (after - SLOT <= cqSlot) {
      await page.waitForTimeout(SLOT - 4000);
      after = await phase(page, 2, 5);
    }
    await inject(page, after - SLOT, SLOT_B);
    // Both taps in one task, so a loaded machine cannot stretch them past the double-tap time.
    await rowOf(page, 'CQ VJ6X OF78').evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });
    await expect(bar.getByRole('button', { name: 'Tx on' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'On air' })).toBeVisible({ timeout: 40_000 });
    // The slot RR73 transmits in, read as soon as it is on air: the screenshot below can run past
    // the slot boundary on a loaded machine.
    const ours = await page.evaluate(() => Date.now() - (Date.now() % 15_000));
    // Calling VJ6X: the rest of the band dims; his CQ, the message to you and our rows stay clear.
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveClass(/\bdim\b/);
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');
    await expect(rowOf(page, 'CQ VJ6X OF78')).toHaveCSS('opacity', '1');
    await expectToYou(rowOf(page, '9V1NE JA1KXM PM95'));
    await expectOursClear(page);
    await shot('5-calling');
    expect(counts['5-calling']).toBeGreaterThanOrEqual(TARGET[width].qso);

    // The radio hands RR73's own signal back in the slot it transmits in, at +45 dB: that slot is
    // not decoded or shown, and the amber row says what was sent.
    await inject(page, ours, [d('VJ6X 9V1NE OJ11', 45, 1500, -0.7)]);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('decode-list').locator('button.dr', { has: page.locator('.c-msg', { hasText: /^VJ6X 9V1NE OJ11$/ }) })).toHaveCount(1);
    await expect(rowOf(page, 'VJ6X 9V1NE OJ11')).toHaveClass(/k-sent/);

    // In a QSO: VJ6X answers with a report in the slot after ours, decoded as it starts so the
    // next transmission is planned and not yet on air.
    await page.waitForTimeout(Math.max(0, ours + SLOT + 500 - Date.now()));
    await inject(page, ours + SLOT, [...SLOT_A.slice(0, 3), d('9V1NE VJ6X -12', -9, 506), ...SLOT_A.slice(3, 7)]);
    await expect(bar.getByRole('list', { name: 'QSO progress' })).toBeVisible();
    await expect(bar.getByText(/^Tx3 · VJ6X 9V1NE R-09/)).toBeVisible();
    // His report leads its slot; the rest of the band dims; our Sent and Next rows stay clear.
    expect(await firstInSlot(page, ours + SLOT)).toBe('9V1NE VJ6X -12');
    await expectToYou(rowOf(page, '9V1NE VJ6X -12'));
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');
    await expect(rowOf(page, 'VJ6X 9V1NE OJ11')).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('next-row')).toHaveCSS('opacity', '1');
    await expectOursClear(page);
    await shot('6-in-qso');
    // Increase Contrast dims less.
    await page.emulateMedia({ contrast: 'more' });
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.6');
    await page.emulateMedia({ contrast: 'no-preference' });
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');
    expect(counts['6-in-qso']).toBeGreaterThanOrEqual(TARGET[width].qso);

    // Run: End QSO from the menu, Run, then three callers; the ••• menu open.
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'End QSO' }).click();
    // The QSO is over: nothing dims, and his report keeps its red edge.
    await expectNoneDim(page);
    await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '1');
    await expectToYou(rowOf(page, '9V1NE VJ6X -12'));
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitemcheckbox', { name: /^Repeat CQ/ }).click();
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'CQ', exact: true }).click();
    // The callers answer in an odd slot that starts after the QSO ended, so RR73 sent nothing in it.
    const ended = Date.now();
    now = await phase(page, 2, 11, 'even');
    while (now - SLOT < ended) {
      await page.waitForTimeout(SLOT - 11_000);
      now = await phase(page, 2, 11, 'even');
    }
    await inject(page, now - SLOT, CALLERS);
    await expect(page.getByTestId('decode-list').getByText('Working')).toBeVisible();
    await bar.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
    await shot('7-run');
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Halt' }).click();
    await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
    // Tx off: nothing dims.
    await expectNoneDim(page);

    // One bottom bar height in every state: idle, CQ, calling, in a QSO and Run.
    expect(new Set(Object.values(bars)).size, JSON.stringify(bars)).toBe(1);
    writeFileSync(`${prefix}-rows.json`, JSON.stringify({ counts, bars }));
    console.log(`${info.project.name} ${theme} rows ${JSON.stringify(counts)} bar ${JSON.stringify(bars)}`);
  });
}
