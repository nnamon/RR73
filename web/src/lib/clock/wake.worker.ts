// The wake timer's worker (lib/clock/wake.ts): runs each timeout on its own clock and posts its
// id back when it falls due. Chromium does not throttle a dedicated worker's timers while the page
// is hidden, and the page takes the message at once.

import type { FromWake, ToWake } from './wake';

interface Scope {
  postMessage(m: FromWake): void;
  onmessage: ((e: MessageEvent<ToWake>) => void) | null;
}

const scope = self as unknown as Scope;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'set') {
    timers.set(
      m.id,
      setTimeout(() => {
        timers.delete(m.id);
        scope.postMessage({ type: 'due', id: m.id });
      }, m.ms),
    );
  } else {
    clearTimeout(timers.get(m.id));
    timers.delete(m.id);
  }
};
