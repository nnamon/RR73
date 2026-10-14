import { describe, expect, it } from 'vitest';
import { classify, dragHz, grabbed, isTap, labelLeft } from './drag';

// 393 px across 0 to 3000 Hz: 7.63 Hz per px.
const W = 393;
const x = (hz: number) => (hz / 3000) * W;

describe('grabbed', () => {
  it('takes Rx when the press lands on the Rx marker', () => {
    expect(grabbed(x(1500), W, 1500, 2396)).toBe('rx');
    expect(grabbed(x(1500) + 15, W, 1500, 2396)).toBe('rx');
  });

  it('takes Tx anywhere else', () => {
    expect(grabbed(x(1500) + 20, W, 1500, 2396)).toBe('tx');
    expect(grabbed(x(600), W, 1500, 2396)).toBe('tx');
    expect(grabbed(x(2396), W, 1500, 2396)).toBe('tx');
  });

  it('takes Tx when the markers overlap', () => {
    expect(grabbed(x(1500), W, 1500, 1500)).toBe('tx');
    expect(grabbed(x(1500) - 4, W, 1500, 1540)).toBe('rx');
  });
});

describe('classify', () => {
  it('waits until the press has moved', () => {
    expect(classify(3, 2, 'pending')).toBe('pending');
  });

  it('starts a drag on sideways travel', () => {
    expect(classify(6, 2, 'pending')).toBe('drag');
    expect(classify(-8, 5, 'pending')).toBe('drag');
  });

  it('gives a vertical movement to the page scroll', () => {
    expect(classify(2, 10, 'pending')).toBe('scroll');
    expect(classify(5, -12, 'pending')).toBe('scroll');
  });

  it('keeps a decided gesture', () => {
    expect(classify(0, 40, 'drag')).toBe('drag');
    expect(classify(40, 0, 'scroll')).toBe('scroll');
  });
});

describe('isTap', () => {
  it('accepts a short press that stays put', () => {
    expect(isTap(3, 4, 200)).toBe(true);
  });

  it('rejects a long press or one that moved', () => {
    expect(isTap(0, 0, 1200)).toBe(false);
    expect(isTap(9, 6, 100)).toBe(false);
  });
});

describe('dragHz', () => {
  it('gives the frequency under the finger in 5 Hz steps', () => {
    expect(dragHz(x(1850), W, 'FT8')).toBe(1850);
    expect(dragHz(x(1852), W, 'FT8')).toBe(1850);
    expect(dragHz(x(1853), W, 'FT8')).toBe(1855);
  });

  it('keeps inside the mode limits', () => {
    expect(dragHz(0, W, 'FT8')).toBe(200);
    expect(dragHz(W + 30, W, 'FT8')).toBe(2800);
    expect(dragHz(W, W, 'FT4')).toBe(2765);
  });
});

describe('labelLeft', () => {
  it('centres the label on the marker', () => {
    expect(labelLeft(200, 100, W)).toBe(150);
  });

  it('keeps the label inside the waterfall', () => {
    expect(labelLeft(10, 100, W)).toBe(4);
    expect(labelLeft(390, 100, W)).toBe(289);
  });
});

describe('dragging in WSPR', () => {
  it('reads 1400 to 1600 Hz across the width in 1 Hz steps, inside 1410 to 1590 Hz', () => {
    expect(dragHz(W / 2, W, 'WSPR')).toBe(1500);
    expect(dragHz(W / 2 + 2, W, 'WSPR')).toBe(1501);
    expect(dragHz(0, W, 'WSPR')).toBe(1410);
    expect(dragHz(W, W, 'WSPR')).toBe(1590);
  });

  it('always moves Tx: WSPR has no Rx marker', () => {
    expect(grabbed(W / 2, W, null, 1500, 'WSPR')).toBe('tx');
  });
});

