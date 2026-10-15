/**
 * Rig control in the app (docs/design/cat.md): one IC-705 over one serial port in desktop
 * Chromium. Connect radio opens the browser's port chooser from a tap; a port the operator allowed
 * opens again by itself when the app opens, and Disconnect radio forgets it. The radio's state goes
 * to lib/state/radio.svelte.ts for the rest of the app.
 *
 * Connecting lowers the port's DTR and RTS lines (lib/cat/serial.ts), waits OPEN_SETTLE_MS and
 * drops what arrived meanwhile, then reads the radio. It sends no PTT and changes no setting. The
 * one exception: when this page lost the port while RR73 may have held PTT on, the next connection
 * sends PTT off if the radio reports transmitting. RR73 opens only the port the operator chose:
 * Connect radio takes back the browser's permission for every other port, and on opening the app
 * RR73 opens the allowed port only when exactly one of the chosen kind is there.
 *
 * Safety: Halt (and with it the page hiding or closing, audio stopping and the output changing,
 * lib/state/station.svelte.ts) sends PTT off while Key the radio with CAT is on or RR73 holds PTT.
 * A lost port, and a radio that stops answering or says receive while keyed, turn Tx off as when
 * audio stops.
 */

import { CatRadio, type CatTimers, type RadioState } from '../cat/radio';
import { SerialLink, choosePort, grantedPorts, serialApi, type SerialApiLike, type SerialPortLike } from '../cat/serial';
import { loadCatWasm, wasmCodec, type CatWasm } from '../cat/protocol';
import { utcTime } from '../clock/format';
import type { Mode } from '../clock/slots';
import { bandOfHz } from '../log/bandplan';
import { STATUS } from '../qso/status';
import { dialHz, isBand, type BandId } from '../radio/bands';
import { PTT_TIMEOUT_MS, pause } from '../tx/keyer';
import { settings, updateSettings } from './settings.svelte';
import { halt, onHalt } from './station.svelte';
import { plannedDialHz, provideKeyer, radioNotice, resetRig, rig, rigConnected, usbSendOn } from './radio.svelte';

/** Test keying holds PTT on this long, ms. */
export const TEST_KEY_MS = 1000;
/** After the port opens, RR73 waits this long and drops what arrived before it sends anything, ms. */
export const OPEN_SETTLE_MS = 100;
/** The band sheet's dial waits this long at most for the radio to stop transmitting, ms: an FT8 transmission and its tail. */
export const TUNE_WAIT_MS = 15_000;

interface Link {
  port: SerialPortLike;
  link: SerialLink;
  radio: CatRadio;
}

interface Deps {
  api(): SerialApiLike | null;
  wasm(): Promise<CatWasm | null>;
  timers?: CatTimers;
}

let deps: Deps = { api: () => serialApi(), wasm: loadCatWasm };
let current: Link | null = null;
/** This page lost the port while RR73 may have held PTT on. */
let recover = false;
let testGen = 0;
/** The RR73 band of the last dial read on this link; undefined before the first. */
let lastBand: BandId | null | undefined;
let started = false;
let offHalt: (() => void) | null = null;
/** Bumped by every dial RR73 sets, so an older one waiting for receive gives way. */
let tuneGen = 0;
/** The menu settings last copied to `rig`: $state proxies cannot be compared with the radio's object. */
let menuSeen: RadioState['settings'] | null = null;

/** True where the browser has Web Serial: the rig control settings show only there. */
export function catSupported(): boolean {
  return deps.api() !== null;
}

/** The mode on band `b`: the same where it has a dial there, else FT8, else WSPR (2m). */
function modeOn(b: BandId, m: Mode): Mode {
  if (dialHz(b, m) !== null) return m;
  return dialHz(b, 'FT8') !== null ? 'FT8' : 'WSPR';
}

/** A dial read on another band than the last read moves RR73 to that band. */
function follow(hz: number | null) {
  if (hz === null) return;
  const b = bandOfHz(hz);
  const band = isBand(b) ? b : null;
  if (band === lastBand) return;
  lastBand = band;
  if (band === null || band === settings.band) return;
  void updateSettings({ band, mode: modeOn(band, settings.mode) });
}

function mirror(s: RadioState) {
  if (s.status !== 'lost' && s.status !== 'closed') rig.status = s.status === 'starting' ? 'connecting' : s.status;
  if (s.status === 'connected') {
    rig.error = null;
    recover = false;
  } else if (s.status === 'silent') rig.error = 'no-reply';
  rig.noiseOnly = s.noiseOnly;
  rig.hz = s.hz;
  rig.mode = s.mode;
  rig.filter = s.filter;
  rig.data = s.data;
  if (menuSeen !== s.settings) {
    menuSeen = s.settings;
    rig.menu = { ...s.settings };
  }
  rig.keyed = s.keyed;
  rig.unkeyFailed = s.unkeyFailed;
  follow(s.hz);
}

function fail(error: 'busy' | 'signals' | 'failed' | 'no-wasm' | 'gone' | 'choose') {
  rig.status = 'failed';
  rig.error = error;
}

async function open(port: SerialPortLike): Promise<boolean> {
  rig.status = 'connecting';
  rig.error = null;
  rig.noiseOnly = false;
  const wasm = await deps.wasm();
  if (!wasm) {
    fail('no-wasm');
    return false;
  }
  const link = new SerialLink(port);
  const err = await link.open();
  if (err) {
    fail(err);
    return false;
  }
  // Bytes the radio sent before RR73 listened, such as transceive frames, are dropped: nothing
  // listens to the link during the wait.
  await pause(OPEN_SETTLE_MS);
  if (link.state !== 'open') {
    rig.status = 'lost';
    rig.error = 'lost';
    return false;
  }
  const radio = new CatRadio({ codec: wasmCodec(wasm), transport: link, timers: deps.timers });
  const me: Link = { port, link, radio };
  current = me;
  lastBand = undefined;
  menuSeen = null;
  radio.onChange((s) => {
    if (current === me) mirror(s);
  });
  radio.onEnd((end) => {
    if (current === me && end === 'lost') lost(me);
  });
  // A CAT error while keyed: PTT off has gone; the transmission stops and Tx goes off.
  radio.onFault((f) => {
    if (current !== me) return;
    radioNotice(f === 'silent' ? STATUS.radioSilent : STATUS.radioReceive, true);
    halt();
  });
  provideKeyer(radio);
  radio.start({ recover });
  return true;
}

/** The port went away: Tx goes off as when audio stops, and the status line says so. */
function lost(me: Link) {
  recover = me.radio.endedKeyed;
  current = null;
  provideKeyer(null);
  rig.status = 'lost';
  rig.error = 'lost';
  rig.keyed = false;
  if (rig.test?.state === 'running') {
    testGen++;
    rig.test = { state: 'done', ok: false, text: 'The port closed during the test.', atMs: Date.now() };
  }
  radioNotice(STATUS.radioLost, true);
  halt();
}

/** Closes the link without forgetting the port. PTT off goes first if RR73 may hold PTT. */
async function closeCurrent() {
  const c = current;
  current = null;
  provideKeyer(null);
  if (!c) return;
  if (c.radio.holdsPtt) c.radio.unkeyAll();
  c.radio.close();
  // Closing the link sends what was written first, PTT off included.
  await c.link.close();
}

/**
 * Opens the port the operator chose before, when the browser allows exactly one of its kind. With
 * none, or several that cannot be told apart, nothing opens: RR73 never tries a port to see.
 */
async function reconnect(api: SerialApiLike) {
  const c = settings.cat;
  const ports = (await grantedPorts(api)).filter((p) => {
    const i = p.getInfo();
    return c.usbVendorId === null || (i.usbVendorId === c.usbVendorId && i.usbProductId === c.usbProductId);
  });
  if (ports.length === 1) await open(ports[0]);
  else fail(ports.length ? 'choose' : 'gone');
}

/**
 * Connect radio: the browser's port chooser, then the port. Call from the tap, before any await:
 * Chromium shows the chooser only during one.
 */
export async function connectRadio(): Promise<void> {
  const api = deps.api();
  if (!api) return;
  const before = { status: rig.status, error: rig.error };
  rig.status = 'choosing';
  const chosen = await choosePort(api);
  if ('error' in chosen) {
    rig.status = before.status === 'choosing' ? 'off' : before.status;
    rig.error = chosen.error === 'refused' ? 'refused' : before.error;
    return;
  }
  await closeCurrent();
  // Only this port opens again by itself: the browser forgets the others RR73 was allowed.
  for (const p of await grantedPorts(api)) {
    if (p === chosen.port) continue;
    try {
      await p.forget?.();
    } catch {
      // A port the browser cannot forget stays allowed; RR73 then opens none by itself.
    }
  }
  const info = chosen.port.getInfo();
  void updateSettings({ cat: { ...settings.cat, connect: true, usbVendorId: info.usbVendorId ?? null, usbProductId: info.usbProductId ?? null } });
  await open(chosen.port);
}

/** Disconnect radio: PTT off if RR73 may hold it, closes the port and forgets it. Transmissions key by VOX again. */
export async function disconnectRadio(): Promise<void> {
  testGen++;
  const port = current?.port ?? null;
  void updateSettings({ cat: { ...settings.cat, connect: false } });
  await closeCurrent();
  try {
    await port?.forget?.();
  } catch {
    // The browser keeps the permission; Connect radio still asks again.
  }
  recover = false;
  resetRig();
}

/**
 * Sets the radio's dial to `hz` in USB-D; the band sheet shows how it went. The dial and mode never
 * change while the radio transmits: it waits for receive, TUNE_WAIT_MS at most.
 */
export async function setRadioDial(hz: number | null): Promise<void> {
  const c = current;
  if (!c || hz === null || !rigConnected()) return;
  const gen = ++tuneGen;
  rig.tuning = { hz, state: 'setting' };
  const until = Date.now() + TUNE_WAIT_MS;
  for (;;) {
    const r = await c.radio.tune(hz);
    // A later dial, or another link, replaced this one.
    if (current !== c || gen !== tuneGen) return;
    if (!r.ok && r.why === 'busy' && Date.now() < until) {
      rig.tuning = { hz, state: 'waiting' };
      await pause(PTT_TIMEOUT_MS);
      continue;
    }
    rig.tuning = { hz, state: r.ok ? 'set' : r.why === 'busy' ? 'busy' : r.why === 'timeout' || r.why === 'closed' ? 'no-reply' : 'refused' };
    return;
  }
}

/** Sets the radio to the dial of RR73's band and mode now, when a radio is connected. */
export function tuneRadioToBand(): Promise<void> {
  return setRadioDial(plannedDialHz(settings.band, settings.mode));
}

const testFailed = { ng: 'The IC-705 refused PTT. PTT off was sent.', timeout: 'No reply to PTT from the IC-705 within 0.3 s. PTT off was sent.', closed: 'The port closed during the test.' } as const;

/**
 * Test keying: stops any transmission, keys the radio for 1 s with no audio, releases it, and says
 * what happened. It reads transmit or receive while keyed and after. Halt, a lost port and the page
 * going stop it with PTT off. Works with Key the radio with CAT on or off.
 */
export async function testKeying(): Promise<void> {
  const c = current;
  if (!c || !rigConnected() || rig.test?.state === 'running') return;
  if (usbSendOn()) {
    rig.test = { state: 'done', ok: false, text: 'Not tested: USB SEND keys the radio on a line of the port. Set it to OFF first.', atMs: Date.now() };
    return;
  }
  halt();
  const gen = ++testGen;
  rig.test = { state: 'running' };
  const done = (ok: boolean, text: string) => {
    if (gen === testGen) rig.test = { state: 'done', ok, text, atMs: Date.now() };
  };
  const k = c.radio.key(TEST_KEY_MS + 2000);
  const answer = await k.result;
  if (gen !== testGen) {
    k.release();
    return;
  }
  if (answer !== 'ok') {
    k.release();
    done(false, testFailed[answer]);
    return;
  }
  await pause(TEST_KEY_MS / 2);
  if (gen !== testGen) return;
  const during = await c.radio.request({ type: 'read_transmit' });
  await pause(TEST_KEY_MS / 2);
  if (gen !== testGen) return;
  k.release();
  const after = await c.radio.request({ type: 'read_transmit' });
  if (gen !== testGen) return;
  const keyed = during.ok && during.event.type === 'transmit' ? during.event.on : null;
  const receiving = after.ok && after.event.type === 'transmit' ? !after.event.on : null;
  if (receiving === false) {
    c.radio.unkeyAll();
    done(false, 'The IC-705 still reported transmit after PTT off. PTT off was sent again. If it still transmits, turn it off.');
  } else if (keyed === false) done(false, 'The IC-705 answered OK but stayed in receive. Check that SET › Function › PTT Lock is off.');
  else done(true, `Keyed for 1 s and released at ${utcTime(Date.now())} UTC.`);
}

/**
 * Starts rig control once the settings have loaded: sends PTT off on Halt, opens the port allowed
 * before, and opens it again when it is plugged back in.
 */
export async function initCat(): Promise<void> {
  const api = deps.api();
  if (!api || started) return;
  started = true;
  offHalt?.();
  offHalt = onHalt(() => {
    if (rig.test?.state === 'running') {
      testGen++;
      rig.test = { state: 'done', ok: false, text: 'Stopped by Halt. PTT off was sent.', atMs: Date.now() };
    }
    const c = current;
    if (c && (settings.cat.keyPtt || c.radio.holdsPtt)) c.radio.unkeyAll();
  });
  api.addEventListener?.('connect', () => {
    if (settings.cat.connect && !current && rig.status !== 'choosing' && rig.status !== 'connecting') void reconnect(api);
  });
  void deps.wasm();
  if (settings.cat.connect) await reconnect(api);
}

/** Replaces the browser's Web Serial and the WebAssembly loader; tests only. */
export function setCatDeps(d: Deps) {
  deps = d;
}

/** Forgets the link and the state without touching the port; tests only. */
export function resetCat() {
  current?.radio.close();
  current = null;
  recover = false;
  testGen++;
  lastBand = undefined;
  started = false;
  menuSeen = null;
  tuneGen++;
  resetRig();
}
