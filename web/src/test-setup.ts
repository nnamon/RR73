// IndexedDB for store tests running under Node.
import 'fake-indexeddb/auto';

// Unit tests run as on an iPhone, the app's first platform, so its words are checked as they
// stand. Tests of other platforms' words use adviceFor and deviceOf (lib/app/advice.ts,
// lib/app/platform.ts).
// lint-copy: off
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
// lint-copy: on
Object.defineProperty(globalThis.navigator, 'userAgent', { value: IPHONE, configurable: true });
