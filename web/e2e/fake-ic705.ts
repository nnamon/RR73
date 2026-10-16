// A fake IC-705 behind navigator.serial, installed in the page by an init script, for the rig
// control tests (rig.spec.ts). It answers the CI-V frames RR73 sends in the formats of Icom's
// IC-705 CI-V Reference Guide, A7560-8EX-6 (p. 2 layout and OK/NG, p. 3 split, p. 14 transmit,
// p. 15 RIT and ΔTX, p. 17 frequency and mode, p. 22 data mode, p. 27 the RIT frequency, pp. 6
// and 8 menu settings), 5 ms after each frame, and logs
// every frame with the UTC time and the app's audio clock time it was written. Like Chromium on Windows, opening the port raises
// DTR and RTS; setSignals sets them.
import { expect, type Page } from '@playwright/test';

export interface RigFrame {
  /** Date.now() when written. */
  at: number;
  /** The app's audio clock when written, s: AudioContext.currentTime, or null before audio starts. */
  ctxS: number | null;
  /** "FE FE A4 E0 1C 00 01 FD". */
  hex: string;
}

export interface FakeRig {
  log: RigFrame[];
  hz: number;
  mode: number;
  filter: number;
  data: number;
  transmit: boolean;
  dtr: boolean;
  rts: boolean;
  opened: boolean;
  forgotten: boolean;
  granted: boolean;
  /** Times the page opened the browser's port chooser (requestPort). */
  chooser: number;
  menu: Record<string, number>;
  /** Split and duplex as `0F` reads them: 0x00 off, 0x01 on, 0x11 DUP-, 0x12 DUP+. */
  split: number;
  rit: boolean;
  /** ΔTX, Icom's XIT. */
  xit: boolean;
  /** The RIT and ΔTX offset, Hz, -9999 to 9999. */
  ritHz: number;
  /** The app's AudioContext, once it makes one: frames are timed on its clock too. */
  ctx: AudioContext | null;
  /** The radio ignores PTT off: no answer, and it keeps transmitting. */
  ignorePttOff: boolean;
  /** The radio answers nothing, as with another CI-V address. */
  silent: boolean;
  /** The driver refuses setSignals: DTR and RTS stay as open() left them. */
  refuseSignals: boolean;
  /** After the OK to a frequency set, the radio also sends a transceive frame of the new dial. Unverified: the CI-V guide does not say whether it does. */
  transceiveSets: boolean;
  /** The operator turns the dial: a transceive frame to address 00. */
  turnDial(hz: number): void;
  /** The cable comes out. */
  unplug(): void;
}

declare global {
  interface Window {
    __rig: FakeRig;
  }
}

/**
 * Installs the fake radio before the app loads. `granted`: the port was allowed before, so getPorts
 * lists it. A port allowed with requestPort stays allowed across reloads of the page.
 */
export async function installFakeIc705(page: Page, opts: { hz?: number; granted?: boolean } = {}) {
  await page.addInitScript(
    ({ hz, granted }) => {
      const bcd = (n: number) => ((Math.floor(n / 10) % 10) << 4) | n % 10;
      const freqBytes = (f: number) => [0, 1, 2, 3, 4].map((i) => bcd(Math.floor(f / 10 ** (2 * i)) % 100));
      const fromBytes = (b: number[]) => b.reduce((sum, x, i) => sum + ((x >> 4) * 10 + (x & 15)) * 10 ** (2 * i), 0);
      const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let buffer: number[] = [];
      const port = new EventTarget() as EventTarget & Record<string, unknown>;
      const rig: FakeRig = {
        log: [],
        hz,
        mode: 0x01,
        filter: 1,
        data: 0,
        transmit: false,
        dtr: false,
        rts: false,
        opened: false,
        forgotten: false,
        chooser: 0,
        // The browser remembers an allowed port across reloads.
        granted: granted || sessionStorage.getItem('rr73-test-rig-granted') === '1',
        // USB SEND OFF, DATA MOD USB, Time-Out Timer 5 min: the Basic Manual's defaults.
        menu: { '0125': 0, '0119': 1, '0043': 2 },
        split: 0,
        rit: false,
        xit: false,
        ritHz: 0,
        ignorePttOff: false,
        silent: false,
        refuseSignals: false,
        transceiveSets: false,
        ctx: null,
        turnDial(f) {
          rig.hz = f;
          send([0xfe, 0xfe, 0x00, 0xa4, 0x00, ...freqBytes(f), 0xfd]);
        },
        unplug() {
          rig.opened = false;
          const c = controller;
          controller = null;
          readable = null;
          c?.error(new DOMException('The device has been lost.', 'NetworkError'));
          port.dispatchEvent(new Event('disconnect'));
        },
      };
      window.__rig = rig;
      // The app's audio clock, to time PTT against the audio on the clock that plays it: under
      // load the mapping from the audio clock to UTC can be off by more than the margins.
      const Ctx = window.AudioContext;
      window.AudioContext = class extends Ctx {
        constructor(o?: AudioContextOptions) {
          super(o);
          rig.ctx = this;
        }
      };
      const send = (bytes: number[]) => setTimeout(() => controller?.enqueue(Uint8Array.from(bytes)), 5);
      const reply = (data: number[]) => send([0xfe, 0xfe, 0xe0, 0xa4, ...data, 0xfd]);
      const ok = (yes = true) => reply([yes ? 0xfb : 0xfa]);

      function answer(f: number[]) {
        const [cmd, ...d] = f;
        if (cmd === 0x03 && !d.length) return reply([0x03, ...freqBytes(rig.hz)]);
        if (cmd === 0x04 && !d.length) return reply([0x04, rig.mode, rig.filter]);
        if (cmd === 0x05 && d.length === 5) {
          rig.hz = fromBytes(d);
          ok();
          if (rig.transceiveSets) send([0xfe, 0xfe, 0x00, 0xa4, 0x00, ...freqBytes(rig.hz), 0xfd]);
          return;
        }
        if (cmd === 0x06 && d.length >= 1) {
          rig.mode = d[0];
          rig.filter = d[1] ?? 1;
          return ok();
        }
        if (cmd === 0x1a && d[0] === 0x06 && d.length === 1) return reply([0x1a, 0x06, rig.data, rig.data ? rig.filter : 0]);
        if (cmd === 0x1a && d[0] === 0x06 && d.length === 3) {
          rig.data = d[1];
          if (d[1]) rig.filter = d[2];
          return ok();
        }
        if (cmd === 0x1a && d[0] === 0x05 && d.length === 3) {
          const item = hex([d[1], d[2]]).replace(' ', '');
          return item in rig.menu ? reply([0x1a, 0x05, d[1], d[2], bcd(rig.menu[item])]) : ok(false);
        }
        if (cmd === 0x0f && !d.length) return reply([0x0f, rig.split]);
        if (cmd === 0x21 && d.length === 1 && d[0] === 0x00) {
          const n = Math.abs(rig.ritHz);
          return reply([0x21, 0x00, bcd(n % 100), bcd(Math.floor(n / 100)), rig.ritHz < 0 ? 1 : 0]);
        }
        if (cmd === 0x21 && d.length === 1 && d[0] === 0x01) return reply([0x21, 0x01, rig.rit ? 1 : 0]);
        if (cmd === 0x21 && d.length === 1 && d[0] === 0x02) return reply([0x21, 0x02, rig.xit ? 1 : 0]);
        if (cmd === 0x1c && d[0] === 0x00 && d.length === 1) return reply([0x1c, 0x00, rig.transmit ? 1 : 0]);
        if (cmd === 0x1c && d[0] === 0x00 && d.length === 2) {
          if (d[1] === 0 && rig.ignorePttOff) return;
          rig.transmit = d[1] === 1;
          return ok();
        }
        return ok(false);
      }

      function receive(chunk: Uint8Array) {
        buffer.push(...chunk);
        for (;;) {
          const start = buffer.indexOf(0xfe);
          const end = buffer.indexOf(0xfd, start);
          if (start < 0 || end < 0) return;
          const frame = buffer.slice(start, end + 1);
          buffer = buffer.slice(end + 1);
          rig.log.push({ at: Date.now(), ctxS: rig.ctx ? rig.ctx.currentTime : null, hex: hex(frame) });
          if (!rig.silent && frame[1] === 0xfe && frame[2] === 0xa4 && frame[3] === 0xe0) answer(frame.slice(4, -1));
        }
      }

      let readable: ReadableStream<Uint8Array> | null = null;
      let writable: WritableStream<Uint8Array> | null = null;
      Object.defineProperties(port, {
        readable: { get: () => readable },
        writable: { get: () => writable },
      });
      Object.assign(port, {
        async open() {
          rig.opened = true;
          rig.dtr = true;
          rig.rts = true;
          buffer = [];
          readable = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
          writable = new WritableStream<Uint8Array>({ write: (chunk) => receive(chunk) });
        },
        async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }) {
          if (rig.refuseSignals) throw new DOMException('Failed to set control signals.', 'NetworkError');
          if (s.dataTerminalReady !== undefined) rig.dtr = s.dataTerminalReady;
          if (s.requestToSend !== undefined) rig.rts = s.requestToSend;
        },
        async close() {
          rig.opened = false;
          readable = null;
          writable = null;
          controller = null;
        },
        async forget() {
          rig.forgotten = true;
          rig.granted = false;
          sessionStorage.removeItem('rr73-test-rig-granted');
        },
        getInfo: () => ({ usbVendorId: 0x0c26, usbProductId: 0x0036 }),
      });
      const serial = {
        async requestPort() {
          rig.chooser++;
          rig.granted = true;
          sessionStorage.setItem('rr73-test-rig-granted', '1');
          return port;
        },
        async getPorts() {
          return rig.granted ? [port] : [];
        },
        addEventListener() {},
      };
      Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
    },
    { hz: opts.hz ?? 14_074_000, granted: opts.granted ?? false },
  );
}

/** Frames written since index `from`, by their bytes after the addresses: "1C 00 01". */
export function rigFrames(log: RigFrame[], from = 0): { at: number; ctxS: number | null; body: string }[] {
  return log.slice(from).map((f) => ({ at: f.at, ctxS: f.ctxS, body: f.hex.slice(12, -3) }));
}

/** Every frame the fake radio has received. */
export const rigLog = (page: Page) => page.evaluate(() => window.__rig.log) as Promise<RigFrame[]>;

/** The PTT on and off frames the fake radio has received. */
export const ptt = async (page: Page) => rigFrames(await rigLog(page)).filter((f) => f.body === '1C 00 01' || f.body === '1C 00 00');

/** Settings › Rig control › Connect radio; the fake browser's chooser returns the fake radio. */
export async function connect(page: Page) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
}

/**
 * Settings › Radio and audio › Output to one of Chromium's fake outputs (the projects with fake
 * media devices list 2). Keying by CAT, a transmission goes only to a chosen output.
 */
export async function chooseOutput(page: Page, label = 'Fake Audio Output 1') {
  await page.evaluate(() => (location.hash = '#/settings/radio'));
  const select = page.getByRole('combobox', { name: /^Output/ });
  await expect(select.locator('option', { hasText: label })).toHaveCount(1);
  await select.selectOption({ label });
  await expect(select.locator('option:checked')).toHaveText(label);
}

/** Turns Key the radio with CAT on or off in Settings › Rig control. */
export async function setKeying(page: Page, on: boolean) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  const sw = page.getByRole('switch', { name: /^Key the radio with CAT/ });
  if ((await sw.isChecked()) !== on) await sw.click();
  await expect(sw).toBeChecked({ checked: on });
}
