// A small Chrome DevTools Protocol client over the browser's WebSocket, with flat sessions, and
// Chromium launched without Playwright: Playwright keeps every page visible and turns timer
// throttling off, which a hidden-window measurement needs on.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      } else if (m.method) for (const h of this.handlers) h(m);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.handlers.push(fn);
  }
}

export async function launch({ chrome, port, args = [], env = process.env }) {
  const proc = spawn(chrome, [`--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--no-sandbox', ...args, 'about:blank'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      return { proc, wsUrl: j.webSocketDebuggerUrl };
    } catch {
      await sleep(200);
    }
  }
  throw new Error('chrome did not start');
}

/** Evaluates `expr` in the session, awaiting promises, as a user gesture. */
export async function evaluate(cdp, sessionId, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
