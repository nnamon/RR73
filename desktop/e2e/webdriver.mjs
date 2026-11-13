// A small W3C WebDriver client for tauri-driver: the commands the smoke tests use, over fetch,
// so the suite needs no npm packages.

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  /** Starts the app at `application` through the driver at `base` (http://127.0.0.1:4444). */
  static async start(base, application) {
    const res = await call('POST', `${base}/session`, { capabilities: { alwaysMatch: { 'tauri:options': { application } } } });
    return new Session(base, res.sessionId);
  }

  cmd(method, path, body) {
    return call(method, `${this.base}/session/${this.id}${path}`, body);
  }

  quit() {
    return this.cmd('DELETE', '');
  }

  title() {
    return this.cmd('GET', '/title');
  }

  /** Runs `script` in the page; `arguments` holds `args`. */
  exec(script, ...args) {
    return this.cmd('POST', '/execute/sync', { script, args });
  }

  /** Opens a path of the app's hash router, such as `settings/radio`. */
  go(path) {
    return this.exec('location.hash = arguments[0]', `#/${path}`);
  }

  /** The first element matching `css`, or null. */
  async find(css) {
    const all = await this.cmd('POST', '/elements', { using: 'css selector', value: css });
    return all.length ? all[0][ELEMENT] : null;
  }

  /** The first element matching `css` whose text contains `text`, or null. */
  async findText(css, text) {
    const all = await this.cmd('POST', '/elements', { using: 'css selector', value: css });
    for (const e of all) if ((await this.text(e[ELEMENT])).includes(text)) return e[ELEMENT];
    return null;
  }

  text(el) {
    return this.cmd('GET', `/element/${el}/text`);
  }

  click(el) {
    return this.cmd('POST', `/element/${el}/click`, {});
  }

  /** Types `text` into the element; `` is Enter. */
  type(el, text) {
    return this.cmd('POST', `/element/${el}/value`, { text });
  }

  clear(el) {
    return this.cmd('POST', `/element/${el}/clear`, {});
  }

  /** The window as PNG bytes. */
  async screenshot() {
    return Buffer.from(await this.cmd('GET', '/screenshot'), 'base64');
  }

  /** Waits until `fn` returns a value other than null, false or undefined, and returns it. */
  async until(what, fn, timeoutMs = 15_000) {
    const end = Date.now() + timeoutMs;
    let last;
    for (;;) {
      try {
        const v = await fn();
        if (v !== null && v !== false && v !== undefined) return v;
        last = v;
      } catch (e) {
        last = e;
      }
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Waits for an element matching `css`, optionally with `text` in it. */
  waitFor(css, text, timeoutMs) {
    return this.until(text ? `${css} with "${text}"` : css, () => (text ? this.findText(css, text) : this.find(css)), timeoutMs);
  }
}

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${json.value?.error ?? ''} ${json.value?.message ?? ''}`.trim());
  return json.value;
}
