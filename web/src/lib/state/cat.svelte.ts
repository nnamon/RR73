/**
 * Rig control in the app (docs/design/cat.md): one radio over one serial port in desktop Chromium,
 * the IC-705 over its USB cable or the KX2 through a Digirig, as chosen in Settings › Rig control.
 * Connect radio opens the browser's port chooser from a tap; a port the operator allowed opens
 * again by itself when the app opens, and Disconnect radio forgets it. The radio's state goes to
 * lib/state/radio.svelte.ts for the rest of the app.
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
 * audio stops. A shifted transmission's receive dial goes back after PTT off, and on the next
 * connection when the port went first; a radio that does not take it back turns Tx off.
 */

import { CatRadio, type CatTimers, type DialShift, type RadioState } from '../cat/radio';
import { CIV_PORT, SerialLink, choosePort, grantedPorts, kx2Port, serialApi, type Kx2Baud, type SerialApiLike, type SerialPortLike } from '../cat/serial';
import { kx2Codec, loadCatWasm, wasmCodec, type CatWasm } from '../cat/protocol';
import { RADIOS, type CatRadioId } from '../cat/radios';
import { utcTime } from '../clock/format';
import type { Mode } from '../clock/slots';
import { bandOfHz } from '../log/bandplan';
import { STATUS } from '../qso/status';
import { dialHz, isBand, type BandId } from '../radio/bands';
import { PTT_TIMEOUT_MS, pause } from '../tx/keyer';
import { settings, updateSettings } from './settings.svelte';
import { halt, onHalt } from './station.svelte';
import { plannedDialHz, provideKeyer, radioName, radioNotice, resetRig, rig, rigConnected, rigInDataMode, rigModeText, usbSendOn } from './radio.svelte';

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
/** This page lost the port while a shifted transmission had the radio on its Tx dial. */
let recoverShift: DialShift | null = null;
let testGen = 0;
/** The RR73 band of the last dial read on this link; undefined before the first. */
let lastBand: BandId | null | undefined;
let started = false;
let offHalt: (() => void) | null = null;
/** Bumped by every dial RR73 sets, so an older one waiting for receive gives way. */
let tuneGen = 0;
/** The link's mayBeKeyed as last mirrored: its changes are what the stored leftKeyed follows. */
let lastMayBeKeyed = false;
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
    recoverShift = null;
  } else if (s.status === 'silent') rig.error = 'no-reply';
  rig.noiseOnly = s.noiseOnly;
  rig.hz = s.hz;
  rig.mode = s.mode;
  rig.filter = s.filter;
  rig.data = s.data;
  rig.sub = s.sub;
  if (menuSeen !== s.settings) {
    menuSeen = s.settings;
    rig.menu = { ...s.settings };
  }
  rig.keyed = s.keyed;
  rig.transmitting = s.transmitting;
  rig.mayBeKeyed = s.mayBeKeyed;
  // Kept across reloads, set at PTT on and cleared when a read confirms receive: the next
  // connection sends PTT off if the radio still transmits.
  if (s.mayBeKeyed !== lastMayBeKeyed) {
    lastMayBeKeyed = s.mayBeKeyed;
    setLeftKeyed(s.mayBeKeyed);
  } else if (!s.mayBeKeyed && s.transmitting === false) setLeftKeyed(false);
  // The KX2's MIC BTN as last read decides whether RR73 may open its port by itself.
  const micBtn = s.settings.mic_btn;
  if (settings.cat.radio === 'kx2' && micBtn !== undefined && micBtn >= 0 && settings.cat.kx2MicBtn !== micBtn) void updateSettings({ cat: { ...settings.cat, kx2MicBtn: micBtn } });
  // PTT off unconfirmed: every mode's status line says so and Tx goes off, as the operator has to
  // unkey the radio; Rig control gives the detail.
  if (s.unkeyFailed && !rig.unkeyFailed) radioNotice(STATUS.pttUnconfirmed, true, true);
  rig.unkeyFailed = s.unkeyFailed;
  follow(s.hz);
}

function setLeftKeyed(v: boolean) {
  if (settings.cat.leftKeyed !== v) void updateSettings({ cat: { ...settings.cat, leftKeyed: v } });
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
  const kx2 = settings.cat.radio === 'kx2';
  const link = new SerialLink(port, kx2 ? kx2Port(settings.cat.kx2Baud) : CIV_PORT);
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
  const radio = new CatRadio({ codec: kx2 ? kx2Codec(wasm) : wasmCodec(wasm), traits: RADIOS[settings.cat.radio], transport: link, timers: deps.timers });
  const me: Link = { port, link, radio };
  current = me;
  lastBand = undefined;
  menuSeen = null;
  lastMayBeKeyed = false;
  radio.onChange((s) => {
    if (current === me) mirror(s);
  });
  radio.onEnd((end) => {
    if (current === me && end === 'lost') lost(me);
  });
  // A CAT error while keyed: PTT off has gone; the transmission stops and Tx goes off.
  radio.onFault((f) => {
    if (current !== me) return;
    if (rig.test?.state === 'running') {
      testGen++;
      rig.test = { state: 'done', ok: false, text: f === 'silent' ? `No reply from the ${radioName()} during the test. PTT off was sent.` : stayedInReceive(), atMs: Date.now() };
    }
    radioNotice(f === 'silent' ? STATUS.radioSilent : STATUS.radioReceive, true);
    halt();
  });
  // The receive dial did not go back after a shifted transmission: RR73 now shows the dial the radio
  // reads, and Tx goes off so nothing goes out on an RF the operator did not choose.
  radio.onRestore((restored) => {
    if (current === me && !restored) radioNotice(STATUS.rxDialFailed, true, true);
  });
  // Keyed by TX outside DATA A, the KX2 transmits in the mode it is in: the status line says so.
  provideKeyer(
    kx2
      ? {
          key: (maxMs, shiftHz) => {
            if (rigInDataMode() === false) radioNotice(STATUS.radioMode(rigModeText()));
            return radio.key(maxMs, shiftHz);
          },
        }
      : radio,
  );
  // PTT off at once if the radio transmits and RR73 may have left it keyed (this page lost the port,
  // or an earlier page went while keyed), or keys it by CAT.
  radio.start({ recover: recover || settings.cat.leftKeyed || settings.cat.keyPtt, shifted: recoverShift });
  return true;
}

/**
 * True when RR73 may open the port by itself: always for the IC-705; for the KX2 only after it read
 * MIC BTN OFF, as every open asserts RTS, which the Digirig's KX cable takes to the MIC jack's PTT.
 */
function mayOpenByItself(): boolean {
  return settings.cat.radio !== 'kx2' || settings.cat.kx2MicBtn === 0;
}

/** Reads the KX2's MIC BTN again, as when Rig control opens: the operator may have changed it at the radio. */
export function rereadMicBtn() {
  if (settings.cat.radio === 'kx2' && rigConnected()) current?.radio.rereadSetting('mic_btn');
}

/** The port went away: Tx goes off as when audio stops, and the status line says so. */
function lost(me: Link) {
  recover = me.radio.endedKeyed;
  recoverShift = me.radio.endedShift;
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

/**
 * Closes the link without forgetting the port. When RR73 may hold PTT, Halt goes first (the
 * transmission stops, Tx goes off and PTT off goes out), and the port closes once a read confirms
 * receive or the confirmation fails, and after a shifted transmission once the receive dial is
 * back or setting it failed. Resolves false when PTT off went unconfirmed.
 */
async function closeCurrent(): Promise<boolean> {
  const c = current;
  current = null;
  provideKeyer(null);
  if (!c) return true;
  let confirmed = true;
  if (c.radio.holdsPtt) {
    // Halt's own PTT off finds no link now: this one is sent and confirmed here.
    halt();
    c.radio.unkeyAll();
    confirmed = await c.radio.unkeyed();
  }
  if (c.radio.shifted) {
    halt();
    await c.radio.dialRestored();
  }
  // The link no longer mirrors: its confirmation, or the lack of one, is kept here.
  setLeftKeyed(!confirmed);
  c.radio.close();
  await c.link.close();
  return confirmed;
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
  const confirmed = await closeCurrent();
  try {
    await port?.forget?.();
  } catch {
    // The browser keeps the permission; Connect radio still asks again.
  }
  resetRig();
  // The radio may still transmit: Rig control keeps saying so, and the next connection reads it and
  // sends PTT off if it does.
  recover = !confirmed;
  if (!confirmed) rig.unkeyFailed = true;
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

/** Test keying's answer when PTT on failed and PTT off was confirmed. */
function testFailed(why: 'ng' | 'timeout' | 'closed' | 'dial'): string {
  const name = radioName();
  switch (why) {
    case 'ng':
      // The KX2's TX has no answer: TQ stayed at receive, or the radio answered ?;. TX does nothing
      // in FSK D and PSK D (Programmer's Reference p. 28).
      return settings.cat.radio === 'kx2'
        ? 'The KX2 did not key on TX. PTT off was sent and confirmed. It ignores TX in FSK D and PSK D: choose a band to set DATA A.'
        : `The ${name} refused PTT. PTT off was sent and confirmed.`;
    case 'timeout':
      return `No reply to PTT from the ${name} within 0.3 s. PTT off was sent and confirmed.`;
    case 'closed':
      return 'The port closed during the test.';
    case 'dial':
      // The radio was still on a shifted transmission's Tx dial, and setting the receive dial back failed.
      return `Not tested: the ${name} did not set the receive dial back. Check its dial.`;
  }
}

/**
 * The radio keyed and then read receive. On the IC-705, PTT Lock "inhibits all transmissions"
 * (Basic Manual p. 8-4). The KX2 drops out of transmit on its own at a high temperature or a load
 * it cannot drive (Owner's Manual p. 56).
 */
function stayedInReceive(): string {
  return settings.cat.radio === 'kx2'
    ? 'The KX2 keyed, then returned to receive. Check its screen for a warning, such as high SWR or temperature.'
    : 'The IC-705 answered OK but stayed in receive. Check that SET › Function › PTT Lock is off.';
}

/** PTT off went unconfirmed: the operator has to check the radio. Rig control shows it under Connection. */
export function unkeyFailedText(): string {
  return `The ${radioName()} did not confirm PTT off. If it still transmits, unkey it at the radio or turn it off.`;
}
/** Test keying's result then; the instruction is unkeyFailedText's, shown with it. */
const UNKEY_TEST = 'Keyed. PTT off was not confirmed.';

/**
 * Test keying: stops any transmission, keys the radio for TEST_KEY_MS with no audio, sends PTT off,
 * and says what happened once a read confirms receive, or that it did not. It reads transmit or
 * receive while keyed. Halt, a lost port, a fault and the page going stop it with PTT off. Works
 * with Key the radio with CAT on or off; refused while USB SEND keys on a line or an earlier PTT off
 * is unconfirmed.
 */
export async function testKeying(): Promise<void> {
  const c = current;
  if (!c || !rigConnected() || rig.test?.state === 'running') return;
  if (usbSendOn()) {
    rig.test = { state: 'done', ok: false, text: 'Not tested: USB SEND keys the radio on a line of the port. Set it to OFF first.', atMs: Date.now() };
    return;
  }
  if (rig.unkeyFailed) {
    rig.test = { state: 'done', ok: false, text: `Not tested: the last PTT off is not confirmed. Check that the ${radioName()} receives.`, atMs: Date.now() };
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
    // PTT off went out with the failure; the result waits for its confirmation.
    k.release();
    const confirmed = await c.radio.unkeyed();
    if (gen !== testGen) return;
    done(false, confirmed ? testFailed(answer) : answer === 'timeout' ? `No reply from the ${radioName()} to PTT on or off.` : UNKEY_TEST);
    return;
  }
  const keyedAt = Date.now();
  await pause(TEST_KEY_MS / 2);
  if (gen !== testGen) return;
  const during = await c.radio.request({ type: 'read_transmit' });
  if (gen !== testGen) return;
  await pause(Math.max(0, keyedAt + TEST_KEY_MS - Date.now()));
  if (gen !== testGen) return;
  k.release();
  // PTT off, retried until the radio answers OK, and a read that must say receive.
  const confirmed = await c.radio.unkeyed();
  if (gen !== testGen) return;
  const keyed = during.ok && during.event.type === 'transmit' ? during.event.on : null;
  if (!confirmed) done(false, UNKEY_TEST);
  else if (keyed === false) done(false, stayedInReceive());
  // TX keys the KX2 in any mode: in CW TQ1 may mean armed only (Programmer's Reference p. 27).
  else if (settings.cat.radio === 'kx2' && rigInDataMode() === false)
    done(false, `Keyed and released at ${utcTime(Date.now())} UTC, in ${rigModeText()}. The KX2 was not in DATA A: choose a band to set it.`);
  else done(true, `Keyed and released at ${utcTime(Date.now())} UTC.`);
}

/**
 * Settings › Rig control › Radio. Choosing another radio disconnects the one connected and forgets
 * its port first: the port of one radio never opens with the other's protocol.
 */
export async function chooseRadio(id: CatRadioId): Promise<void> {
  if (settings.cat.radio === id) return;
  if (current || settings.cat.connect || rig.status !== 'off') await disconnectRadio();
  void updateSettings({ cat: { ...settings.cat, radio: id } });
}

/**
 * The KX2's baud rate. With the KX2 connected, its port closes (PTT off confirmed first, as for
 * Disconnect radio) and opens again at the new rate, its lines lowered at once as on every open.
 */
export async function setKx2Baud(baud: Kx2Baud): Promise<void> {
  if (settings.cat.kx2Baud === baud) return;
  void updateSettings({ cat: { ...settings.cat, kx2Baud: baud } });
  const c = current;
  if (!c || settings.cat.radio !== 'kx2') return;
  recover = !(await closeCurrent());
  if (mayOpenByItself()) await open(c.port);
  else {
    // Closed at the old rate; Connect radio opens it at the new one.
    rig.status = 'off';
    rig.error = null;
  }
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
    if (settings.cat.connect && mayOpenByItself() && !current && rig.status !== 'choosing' && rig.status !== 'connecting') void reconnect(api);
  });
  void deps.wasm();
  if (settings.cat.connect && mayOpenByItself()) await reconnect(api);
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
  recoverShift = null;
  testGen++;
  lastBand = undefined;
  started = false;
  menuSeen = null;
  lastMayBeKeyed = false;
  tuneGen++;
  resetRig();
}
