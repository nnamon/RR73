// Layout checks shared by the layout and screen-state tests.
import { expect, type Page } from '@playwright/test';

export async function checkLayout(page: Page) {
  const { innerWidth, innerHeight } = await page.evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
  // Nothing wider than the screen, in the page or in any element.
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push('document');
    for (const el of document.querySelectorAll<HTMLElement>('main *, nav *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5) && getComputedStyle(el).position !== 'fixed' && !el.closest('.visually-hidden') && !el.closest('[hidden]')) {
        out.push(`${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return out;
  });
  expect(wide).toEqual([]);

  const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(bar.y + bar.height).toBeCloseTo(innerHeight, 0);
  expect(bar.width).toBeCloseTo(innerWidth, 0);

  expect(await smallTargets(page, 'main, nav')).toEqual([]);
}

/** Buttons, links and fields under `scope` smaller than 44 by 44 px (checkboxes and radios count their label). */
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
      // Decode rows are 40 px by design (AGENTS.md), as in WSJT-X's band activity.
      if (el.classList.contains('dr')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

/**
 * The transmit dock: Halt is the largest button (area and height), at most 3 buttons share a
 * row, and no button label wraps or overflows its button.
 */
export async function checkDock(page: Page) {
  const r = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('section[aria-label="Transmit"]');
    if (!dock) return { missing: true, halt: null, larger: [], rows: [], wrapped: [] };
    const buttons = [...dock.querySelectorAll<HTMLElement>('button, a[href]')].filter((b) => b.getBoundingClientRect().width > 0);
    const name = (b: HTMLElement) => b.getAttribute('aria-label') ?? b.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    const box = (b: HTMLElement) => b.getBoundingClientRect();
    const halt = buttons.find((b) => name(b) === 'Halt') ?? null;
    const h = halt ? box(halt) : null;
    const larger = h ? buttons.filter((b) => b !== halt && (box(b).width * box(b).height > h.width * h.height || box(b).height > h.height)).map(name) : [];
    // Buttons whose vertical centres lie within 12 px share a row.
    const rows: string[][] = [];
    const centres: number[] = [];
    for (const b of buttons) {
      const c = box(b).top + box(b).height / 2;
      const i = centres.findIndex((y) => Math.abs(y - c) < 12);
      if (i < 0) {
        centres.push(c);
        rows.push([name(b)]);
      } else rows[i].push(name(b));
    }
    // A text node laid out on more than one line has wrapped; content wider than its button overflows.
    const wrapped: string[] = [];
    for (const b of buttons) {
      if (b.scrollWidth > b.clientWidth + 1) wrapped.push(`${name(b)} overflows`);
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (tops.size > 1) wrapped.push(`${name(b)} wraps`);
      }
    }
    return { missing: false, halt: name(halt ?? dock), larger, rows: rows.filter((x) => x.length > 3), wrapped };
  });
  expect(r.missing, 'the transmit dock is on screen').toBe(false);
  expect(r.halt, 'the dock has Halt').toBe('Halt');
  expect(r.larger, 'buttons larger than Halt').toEqual([]);
  expect(r.rows, 'rows of more than 3 buttons').toEqual([]);
  expect(r.wrapped, 'button labels that wrap or overflow').toEqual([]);
}
