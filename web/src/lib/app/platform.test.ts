import { describe, expect, it } from 'vitest';
import { capturesHidden, deviceOf, platformOf, type NavigatorLike } from './platform';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
// iPadOS Safari asks for desktop sites: it reports a Mac, and has a touch screen.
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/153.0.0.0`;
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

const nav = (userAgent: string, more: Partial<NavigatorLike> = {}): NavigatorLike => ({ userAgent, maxTouchPoints: 0, ...more });

describe('platformOf', () => {
  it('tells iPhone, iPad, Windows, Android and the rest apart', () => {
    expect(platformOf(nav(IPHONE, { maxTouchPoints: 5 }))).toBe('ios');
    expect(platformOf(nav(IPAD, { maxTouchPoints: 5 }))).toBe('ios');
    expect(platformOf(nav(IPAD))).toBe('other');
    expect(platformOf(nav(CHROME_WIN, { userAgentData: { mobile: false, platform: 'Windows' } }))).toBe('windows');
    expect(platformOf(nav(EDGE_WIN))).toBe('windows');
    expect(platformOf(nav(FIREFOX_WIN))).toBe('windows');
    // A Windows tablet with touch is still Windows.
    expect(platformOf(nav(CHROME_WIN, { maxTouchPoints: 10 }))).toBe('windows');
    expect(platformOf(nav(CHROME_MAC, { userAgentData: { mobile: false, platform: 'macOS' } }))).toBe('other');
    expect(platformOf(nav(CHROME_ANDROID, { userAgentData: { mobile: true, platform: 'Android' } }))).toBe('android');
    expect(platformOf(undefined)).toBe('other');
  });

  it('calls the device a phone on iOS and Android and a computer elsewhere', () => {
    expect([deviceOf('ios'), deviceOf('android'), deviceOf('windows'), deviceOf('other')]).toEqual(['phone', 'phone', 'computer', 'computer']);
  });
});

describe('capturesHidden', () => {
  it('holds for Chromium on a desktop system only', () => {
    expect(capturesHidden(nav(CHROME_WIN, { userAgentData: { mobile: false, platform: 'Windows' } }))).toBe(true);
    expect(capturesHidden(nav(EDGE_WIN, { userAgentData: { mobile: false, platform: 'Windows' } }))).toBe(true);
    expect(capturesHidden(nav(CHROME_MAC, { userAgentData: { mobile: false, platform: 'macOS' } }))).toBe(true);
    // Firefox has no userAgentData: not measured, so it keeps the iOS rule.
    expect(capturesHidden(nav(FIREFOX_WIN))).toBe(false);
    expect(capturesHidden(nav(CHROME_ANDROID, { userAgentData: { mobile: true, platform: 'Android' } }))).toBe(false);
    expect(capturesHidden(nav(IPHONE, { maxTouchPoints: 5 }))).toBe(false);
    expect(capturesHidden(nav(IPAD, { maxTouchPoints: 5 }))).toBe(false);
    expect(capturesHidden(undefined)).toBe(false);
  });
});
