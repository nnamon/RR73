import { describe, expect, it } from 'vitest';
import { RTTY_DEFAULTS, charSeconds, clampMark, decoderConfig, presetLabel, secondsText, spaceHz, txConfig } from './settings';
import { dial4, parseRttyDial, rttyDialHz } from './dial';

describe('RTTY settings', () => {
  it('centres the default pair on 1500 Hz: mark 1585, space 1415, 165 ms a character', () => {
    expect(RTTY_DEFAULTS.markHz).toBe(1585);
    expect(spaceHz(RTTY_DEFAULTS, 1585)).toBe(1415);
    expect(spaceHz({ ...RTTY_DEFAULTS, reverse: true }, 1415)).toBe(1585);
    expect(charSeconds(RTTY_DEFAULTS)).toBeCloseTo(0.165, 3);
    expect(presetLabel(45.45, 170)).toBe('45.45 · 170');
  });

  it("maps onto rr73-rtty's DecoderConfig and TxConfig", () => {
    expect(decoderConfig({ ...RTTY_DEFAULTS, reverse: true, figures: 'ita2', squelchDb: null }, 1612)).toEqual({
      params: { baud: 45.45, shift_hz: 170, stop_bits: 1.5, polarity: 'reverse', figures: 'ita2', unshift_on_space: true },
      mark_hz: 1612,
      afc: { track: true },
      squelch_db: null,
    });
    const tx = txConfig({ ...RTTY_DEFAULTS, preambleS: 1, idle: 'mark', tailChars: 2 }, 48000, 0.5, 1612);
    expect(tx).toMatchObject({ mark_hz: 1612, sample_rate: 48000, preamble_chars: 6, postamble_chars: 2, idle: 'mark', amplitude: 0.5 });
    expect(txConfig(RTTY_DEFAULTS, 44100, 2).preamble_chars).toBe(3);
    expect(txConfig(RTTY_DEFAULTS, 44100, 2).amplitude).toBe(1);
  });

  it('keeps both tones inside 200 to 2900 Hz', () => {
    expect(clampMark(RTTY_DEFAULTS, 3000)).toBe(2900);
    expect(clampMark(RTTY_DEFAULTS, 100)).toBe(370);
    expect(clampMark({ ...RTTY_DEFAULTS, reverse: true }, 100)).toBe(200);
    expect(clampMark({ ...RTTY_DEFAULTS, shiftHz: 850 }, 1585)).toBe(1585);
  });

  it('says durations as the menus do', () => {
    expect(secondsText(60)).toBe('1 min');
    expect(secondsText(30)).toBe('30 s');
    expect(secondsText(0)).toBe('Off');
  });
});

describe("RTTY's dial", () => {
  it('starts at the table and keeps an edited dial per band', () => {
    expect(rttyDialHz('20m', {})).toBe(14_083_000);
    expect(rttyDialHz('20m', { '20m': 14_085_000 })).toBe(14_085_000);
    expect(rttyDialHz('40m', { '20m': 14_085_000 })).toBe(7_040_000);
    expect(rttyDialHz('60m', {})).toBeNull();
    expect(dial4(14_083_000)).toBe('14.0830');
  });

  it('reads MHz or kHz and refuses a dial outside the band', () => {
    expect(parseRttyDial('14.085', '20m')).toEqual({ hz: 14_085_000 });
    expect(parseRttyDial('14085', '20m')).toEqual({ hz: 14_085_000 });
    expect(parseRttyDial('14 085', '20m')).toEqual({ error: 'Enter 14.0000 to 14.3500 MHz.' });
    expect(parseRttyDial('7.040', '20m')).toEqual({ error: '7.0400 MHz is outside 20m. Enter 14.0000 to 14.3500 MHz.' });
  });
});
