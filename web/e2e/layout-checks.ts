// Layout checks shared by the layout and screen-state tests, and the tags and screenshots that
// split them between CI and the visual review.
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { TestTheme } from './theme';

/**
 * Tags a WebKit layout test for the CI projects (playwright.config.ts). CI runs the light theme
 * only, as dark and Sun change colours and nothing else (tokens.css): at 375 x 667, where checks that do
 * not depend on the screen size are strictest, and at 393 x 852 as well where the size matters.
 * No widths leaves the test to the review projects.
 */
export function ci(theme: TestTheme, ...widths: (375 | 393)[]) {
  return { tag: theme === 'light' ? widths.map((w) => `@ci-${w}`) : [] };
}

/** True in the review projects, which save the screenshots (RR73_REVIEW=1, docs/testing.md). */
export const reviewing = (info: TestInfo) => info.project.name.startsWith('review-');

/**
 * Saves a screenshot for the visual review, after `settleMs` for animations, as
 * `<dir>/webkit-375x667-light-<name>.png`. Does nothing outside the review projects.
 */
export async function shot(page: Page, info: TestInfo, dir: string, name: string, settleMs = 0) {
  if (!reviewing(info)) return;
  if (settleMs) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${dir}/${info.project.name.replace(/^review-/, 'webkit-')}-${name}.png` });
}

/**
 * Nothing wider than the screen, in the page or in any element, and every control at least 44 by
 * 44 px. A row made to scroll sideways, marked data-scroll-x (the macro row), may hold more than fits.
 */
export async function checkLayout(page: Page) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push('document');
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5) && getComputedStyle(el).position !== 'fixed' && !el.closest('.visually-hidden') && !el.closest('[hidden]') && !el.parentElement?.closest('[data-scroll-x]')) {
        out.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return out;
  });
  expect(wide).toEqual([]);
  expect(await smallTargets(page, 'main')).toEqual([]);
}

/** Buttons, links and fields under `scope` smaller than 44 by 44 px (checkboxes and radios count their label), decode rows aside. */
export async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    const sel = ['button', 'a[href]', 'select', 'input:not([type=checkbox]):not([type=radio])', 'label:has(input)'];
    const targets = scope
      .split(',')
      .flatMap((s) => sel.map((t) => `${s.trim()} ${t}`))
      .join(', ');
    for (const el of document.querySelectorAll<HTMLElement>(targets)) {
      if (el.closest('[hidden]') || el.closest('dialog:not([open])') || el.classList.contains('visually-hidden')) continue;
      // Decode and spot rows are 32 pt: dense rows, full width.
      if (el.matches('button.dr, button.sr')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}
