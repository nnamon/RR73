// Reads rendered pixels: a screenshot of an element, decoded in the page into RGBA rows.
import type { Locator, Page } from '@playwright/test';

export interface Pixels {
  width: number;
  height: number;
  data: number[];
}

export async function elementPixels(page: Page, el: Locator): Promise<Pixels> {
  const png = await el.screenshot({ animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { width: d.width, height: d.height, data: Array.from(d.data) };
  }, png.toString('base64'));
}

/** Mean brightness (R + G + B) of a column band x0..x1 over rows y0..y1. */
export function brightness(p: Pixels, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * p.width + x) * 4;
      sum += p.data[o] + p.data[o + 1] + p.data[o + 2];
      n++;
    }
  }
  return sum / n;
}
