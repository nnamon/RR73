// A fake Elecraft KX2 behind a Digirig and navigator.serial, installed in the page by an init
// script, for the KX2's rig control tests (rig-kx2.spec.ts, rig-kx2-tx.spec.ts). It answers the
// text commands RR73 sends in the formats of Elecraft's K3S/K3/KX3/KX2 Programmer's Reference,
// Rev. G5 (p. 3 format, p. 11 FA and DT, p. 16 MD, pp. 17 to 20 MN and MP, p. 21 OM, p. 27 TQ,
// p. 28 TX and VX), 5 ms after each command, and logs every write with the UTC time and the app's
// audio clock time. Like Chromium on Windows, opening the port raises DTR and RTS; the Digirig's
// PTT follows RTS, and with its KX cable and MIC BTN at its default the radio transmits while RTS
// is asserted.
import { expect, type Page } from '@playwright/test';

export interface Kx2Write {
  /** Date.now() when written. */
  at: number;
  /** The app's audio clock when written, s, or null before audio starts. */
  ctxS: number | null;
  /** The text written: "TX;TQ;". */
  text: string;
}

export interface FakeKx2 {
  log: Kx2Write[];
  hz: number;
  /** MD's digit: 2 USB, 6 DATA. */
  mode: number;
  /** DT's digit: 0 DATA A. */
  sub: number;
  /** Transmitting on TX. */
  tx: boolean;
  dtr: boolean;
  rts: boolean;
  /** MIC BTN as MP gives it: bit 0 PTT, bit 2 UP and DN. Default PTT UP.DN. */
  micBtn: number;
  voxData: boolean;
  /** The menu entry shown, 255 with none. */
  menu: number;
  /** True while the radio transmits: on TX, or on the Digirig's PTT through the MIC jack. */
  readonly transmit: boolean;
  /** RTS asserted while MIC BTN reads PTT: the Digirig keys the radio. */
  readonly lineKeyed: boolean;
  /** Each time the radio started transmitting on the MIC jack's PTT, Date.now(). */
  lineKeyedAt: number[];
  /** The port's baud rate when opened. */
  baud: number | null;
  opened: boolean;
  forgotten: boolean;
  granted: boolean;
  ctx: AudioContext | null;
  /** The radio ignores RX and keeps transmitting. */
  ignoreRx: boolean;
  /** The operator turns VFO A. Auto-info is off, so the radio sends nothing. */
  turnDial(hz: number): void;
  unplug(): void;
}

declare global {
  interface Window {
    __kx2: FakeKx2;
  }
}

/** Installs the fake radio before the app loads. `granted`: the port was allowed before. */
export async function installFakeKx2(page: Page, opts: { hz?: number; granted?: boolean } = {}) {
  await page.addInitScript(
    ({ hz, granted }) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let input = '';
      const port = new EventTarget() as EventTarget & Record<string, unknown>;
      const rig: FakeKx2 = {
        log: [],
        hz,
        mode: 2,
        sub: 0,
        tx: false,
        dtr: false,
        rts: false,
        micBtn: 5,
        voxData: false,
        menu: 255,
        get lineKeyed() {
          return rig.rts && (rig.micBtn & 1) === 1;
        },
        get transmit() {
          return rig.tx || rig.lineKeyed;
        },
        lineKeyedAt: [],
        baud: null,
        opened: false,
        forgotten: false,
        granted: granted || sessionStorage.getItem('rr73-test-kx2-granted') === '1',
        ctx: null,
        ignoreRx: false,
        turnDial(f) {
          rig.hz = f;
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
      window.__kx2 = rig;
      const Ctx = window.AudioContext;
      window.AudioContext = class extends Ctx {
        constructor(o?: AudioContextOptions) {
          super(o);
          rig.ctx = this;
        }
      };
      const enc = new TextEncoder();
      const send = (s: string) => s && setTimeout(() => controller?.enqueue(enc.encode(s)), 5);
      const pad = (n: number, w: number) => String(n).padStart(w, '0');
      const tuning = /^(FA|MD|DT)\d/;

      function answer(cmd: string): string {
        const name = cmd.slice(0, 2);
        const data = cmd.slice(2);
        if (tuning.test(cmd) && rig.transmit) return '?;';
        switch (name) {
          case 'FA':
            if (!data) return `FA${pad(rig.hz, 11)};`;
            rig.hz = Number(data) - (Number(data) % 10);
            return '';
          case 'MD':
            if (!data) return `MD${rig.mode};`;
            rig.mode = Number(data);
            return '';
          case 'DT':
            if (!data) return `DT${rig.sub};`;
            rig.sub = Number(data);
            return '';
          case 'TQ':
            return `TQ${rig.transmit ? 1 : 0};`;
          case 'TX':
            // FSK D and PSK D ignore TX (p. 28).
            if (!(rig.mode === 6 && rig.sub >= 2)) rig.tx = true;
            return '';
          case 'RX':
            if (!rig.ignoreRx) rig.tx = false;
            return '';
          case 'OM':
            return 'OM ----------01;';
          case 'VX':
            return `VX${rig.mode === 6 && rig.voxData ? 1 : 0};`;
          case 'MN':
            if (!data) return `MN${pad(rig.menu, 3)};`;
            rig.menu = Number(data);
            return '';
          case 'MP':
            return rig.menu === 82 && !data ? `MP${pad(rig.micBtn & 5, 3)};` : '?;';
          default:
            return '?;';
        }
      }

      function receive(chunk: Uint8Array) {
        const text = new TextDecoder().decode(chunk);
        rig.log.push({ at: Date.now(), ctxS: rig.ctx ? rig.ctx.currentTime : null, text });
        input += text;
        let out = '';
        for (;;) {
          const end = input.indexOf(';');
          if (end < 0) break;
          out += answer(input.slice(0, end).toUpperCase());
          input = input.slice(end + 1);
        }
        send(out);
      }

      const setLines = (dtr: boolean, rts: boolean) => {
        const was = rig.lineKeyed;
        rig.dtr = dtr;
        rig.rts = rts;
        if (!was && rig.lineKeyed) rig.lineKeyedAt.push(Date.now());
      };

      let readable: ReadableStream<Uint8Array> | null = null;
      let writable: WritableStream<Uint8Array> | null = null;
      Object.defineProperties(port, {
        readable: { get: () => readable },
        writable: { get: () => writable },
      });
      Object.assign(port, {
        async open(o: { baudRate: number }) {
          rig.opened = true;
          rig.baud = o.baudRate;
          setLines(true, true);
          input = '';
          readable = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
          writable = new WritableStream<Uint8Array>({ write: (chunk) => receive(chunk) });
        },
        async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }) {
          setLines(s.dataTerminalReady ?? rig.dtr, s.requestToSend ?? rig.rts);
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
          sessionStorage.removeItem('rr73-test-kx2-granted');
        },
        // A Digirig's CP2102 (Getting Started with Digirig Mobile names the Silicon Labs bridge).
        getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      });
      const serial = {
        async requestPort() {
          rig.granted = true;
          sessionStorage.setItem('rr73-test-kx2-granted', '1');
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

/** Every write the fake radio has received. */
export const kx2Log = (page: Page) => page.evaluate(() => window.__kx2.log) as Promise<Kx2Write[]>;

/** The TX and RX writes the fake radio has received. */
export const kx2Ptt = async (page: Page) => (await kx2Log(page)).filter((w) => w.text === 'TX;TQ;' || w.text === 'RX;TQ;');

/** Settings › Rig control: chooses the KX2, then Connect radio; the fake browser's chooser returns the fake radio. */
export async function connectKx2(page: Page) {
  await page.evaluate(() => (location.hash = '#/settings/rig'));
  await page.getByRole('radio', { name: /Elecraft KX2/ }).click();
  await page.getByRole('button', { name: 'Connect radio' }).click();
  await expect(page.getByTestId('rig-status')).toHaveText('Connected');
}
