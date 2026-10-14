// Operate on iPhone viewports in WebKit, with the status bar and home indicator insets of the
// device, decodes injected through the screen-review hooks and nothing waiting for a transmission:
// - the bottom bar keeps one height, and the decode list its row targets (13 receiving at
//   393 x 852, 10 at 375 x 667; 9 and 8 while calling or in a QSO), from receiving through CQ,
//   calling a station and a QSO;
// - a message to you leads its slot with the red edge and heavy text;
// - while calling or in a QSO, rows unrelated to the station dim to 0.4 (0.6 with Increase
//   Contrast), and nothing dims while calling CQ, after End QSO or with Tx off;
// - a run of empty slots shows as one 22 pt bar.
// states.spec.ts walks the same states on the air for the visual review.
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { ci, shot, smallTargets } from './layout-checks';
import { SLOT, SLOT_A, SLOT_B, TARGET, d, expectNoneDim, expectOursClear, expectToYou, firstInSlot, inject, openOperate, phase, rowOf, rowsOnScreen, utc } from './operate-checks';

const SHOTS = fileURLToPath(new URL('../test-results/screens/states', import.meta.url));

/** The newer slot: a station calls us with a report, eleventh from the decoder. */
const NEWER = [...SLOT_A, d('9V1NE K1ABC -12', -9, 2341)];

test('Operate keeps one bar height, its row targets, messages to you first and the focus of a QSO, from receiving to a QSO', ci('light', 375, 393), async ({ page }) => {
  const width = page.viewportSize()!.width;
  const bar = page.getByRole('region', { name: 'Transmit' });
  const heights: Record<string, number> = {};
  /** Records the bar height in `state`, and checks the list, the targets and that nothing scrolls. */
  const check = async (state: string, rows?: number) => {
    await page.getByTestId('decode-list').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    heights[state] = Math.round((await bar.boundingBox())!.height * 2) / 2;
    if (rows !== undefined) expect(await rowsOnScreen(page), `rows on screen, ${state}`).toBeGreaterThanOrEqual(rows);
    expect(await smallTargets(page, 'main .pane:not([hidden])'), state).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBeLessThanOrEqual(0);
    // The document never scrolls in any state: only the list does.
    expect(await page.evaluate(() => ({ y: window.scrollY, fits: document.scrollingElement!.scrollHeight <= window.innerHeight })), state).toEqual({ y: 0, fits: true });
  };
  /** A double-tap with both taps in one task, so a loaded machine cannot stretch them apart. */
  const doubleTap = (text: string) =>
    rowOf(page, text).evaluate((el: HTMLElement) => {
      el.click();
      el.click();
    });

  // Receiving: audio on, nothing decoded yet.
  await openOperate(page, 'light');
  await check('receiving');

  // Two slots of decodes, injected once the decoder has had the slot that just ended, so its own
  // result does not replace them, and early enough that every state below fits before the next
  // slot's result adds a bar to the list. A CQ of ours from an earlier slot is in the list too.
  const now = await phase(page, 2, 6);
  await page.evaluate((s) => window.__rr73!.sent(s, 'CQ 9V1NE OJ11'), now - 4 * SLOT);
  await inject(page, now - 2 * SLOT, SLOT_B);
  await inject(page, now - SLOT, NEWER);
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toBeVisible();
  // Messages to you lead their slots, fifth and eleventh from the decoder, with the red edge.
  expect(await firstInSlot(page, now - 2 * SLOT)).toBe('9V1NE JA1KXM PM95');
  expect(await firstInSlot(page, now - SLOT)).toBe('9V1NE K1ABC -12');
  await expectToYou(rowOf(page, '9V1NE JA1KXM PM95'));
  await expectNoneDim(page);
  await check('decodes', TARGET[width].receiving);

  // CQ, planned for a later slot, with its own steps in the bar: nobody answers yet, nothing dims.
  await bar.getByRole('button', { name: 'CQ', exact: true }).click();
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/CQ.*Report.*R-report.*RR73.*Logged/);
  await expectNoneDim(page);
  await check('cq');
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();

  // Calling a station: the rest of the band dims; their CQ, the message to you, our rows and the
  // slot bars stay clear. Halt turns Tx off, and the dimming ends.
  await doubleTap('CQ VJ6X OF78');
  await expect(bar.getByRole('list', { name: 'QSO progress' })).toHaveText(/OJ11.*Report.*R-report.*RR73.*73/);
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveClass(/\bdim\b/);
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');
  await expect(rowOf(page, 'CQ VJ6X OF78')).toHaveCSS('opacity', '1');
  await expectToYou(rowOf(page, '9V1NE JA1KXM PM95'));
  await expectOursClear(page);
  await check('calling', TARGET[width].qso);
  await bar.getByRole('button', { name: 'Halt' }).click();
  await expect(bar.getByRole('button', { name: 'Tx off' })).toBeVisible();
  await expectNoneDim(page);

  // In a QSO: a double-tap on a station that called us with a report answers with an R-report.
  // The rest of the band dims, less with Increase Contrast; their report and our R-report stay
  // clear. The R-report is the Next row, or Sending when the tap came within the slot's late start.
  await doubleTap('9V1NE K1ABC -12');
  await expect(bar.getByText(/^Tx3 · K1ABC 9V1NE R-09/)).toBeVisible();
  await expectToYou(rowOf(page, '9V1NE K1ABC -12'));
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');
  await expect(page.getByTestId('decode-list').locator('.dr.out', { hasText: 'K1ABC 9V1NE R-09' }).first()).toHaveCSS('opacity', '1');
  await expectOursClear(page);
  await check('in a QSO', TARGET[width].qso);
  await page.emulateMedia({ contrast: 'more' });
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.6');
  await page.emulateMedia({ contrast: 'no-preference' });
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '0.4');

  // End QSO: nothing dims, and their report keeps its red edge.
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'End QSO' }).click();
  await expectNoneDim(page);
  await expect(rowOf(page, 'CQ BH1LKO OM89')).toHaveCSS('opacity', '1');
  await expectToYou(rowOf(page, '9V1NE K1ABC -12'));

  // One bottom bar height in every state.
  expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Operate with a run of empty slots in ${theme}`, ci(theme, 375), async ({ page }, info) => {
    await openOperate(page, theme);
    // Slots from before audio started, so the decoder's own empty slots cannot join or split the
    // run: decodes, 4 slots with none, decodes. Early in the slot, so the 8 slots kept still hold
    // them all when the decoder adds this one.
    const now = await phase(page, 2, 6);
    await inject(page, now - 7 * SLOT, SLOT_B);
    for (let i = 6; i >= 3; i--) await inject(page, now - i * SLOT, []);
    await inject(page, now - 2 * SLOT, SLOT_A.slice(0, 3));
    const list = page.getByTestId('decode-list');
    const run = list.locator('li.slot-bar.quiet', { hasText: `${utc(now - 6 * SLOT)} to ${utc(now - 3 * SLOT)} UTC · no decodes` });
    await expect(run).toHaveCount(1);
    await expect(run.locator('[aria-hidden=true]')).toHaveText([utc(now - 6 * SLOT), 'to', utc(now - 3 * SLOT), 'no decodes']);
    for (let i = 6; i >= 3; i--) await expect(list.locator('li.slot-bar:not(.quiet)', { hasText: utc(now - i * SLOT) })).toHaveCount(0);
    // One 22 pt bar in the place of 4, between the two slots with decodes.
    expect(Math.round((await run.boundingBox())!.height)).toBe(22);
    expect(await firstInSlot(page, now - 7 * SLOT)).toBe('9V1NE JA1KXM PM95');
    await list.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(400);
    expect(await smallTargets(page, 'main .pane:not([hidden])')).toEqual([]);
    await shot(page, info, SHOTS, `${theme}-8-empty-slots`);
  });
}
