import { describe, expect, it } from 'vitest';
import type { ChannelLike, DesktopBridge } from '../app/desktop';
import { NativeSerialApi, localGrants, type GrantStore, type NativeEvent, type NativePortInfo } from './native';
import { CIV_PORT, SerialLink, choosePort, grantedPorts, kx2Port } from './serial';

const IC705: NativePortInfo = { name: 'COM4', usbVendorId: 0x0c26, usbProductId: 0x0036, label: 'IC-705' };
const DIGIRIG: NativePortInfo = { name: 'COM7', usbVendorId: 0x10c4, usbProductId: 0xea60, label: 'CP2102' };

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

/** The desktop app's Rust side, in memory: one channel per open port. */
function fakeDesktop(opts: { ports?: NativePortInfo[]; openError?: unknown; linesFail?: boolean } = {}) {
  const calls: Call[] = [];
  const channels = new Map<number, ChannelLike<NativeEvent>>();
  const written: number[][] = [];
  let ports = opts.ports ?? [IC705];
  let next = 1;
  const bridge: DesktopBridge = {
    async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'serial_list':
          return ports as T;
        case 'serial_open': {
          if (opts.openError) throw opts.openError;
          const id = next++;
          channels.set(id, args?.events as ChannelLike<NativeEvent>);
          return { id, linesLow: true } as T;
        }
        case 'serial_write':
          written.push(args?.bytes as number[]);
          return undefined as T;
        case 'serial_lines':
          if (opts.linesFail) throw { kind: 'io', detail: 'refused' };
          return undefined as T;
        case 'serial_close':
          channels.delete(args?.id as number);
          return undefined as T;
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    },
    channel: <T,>(fn: (m: T) => void) => ({ onmessage: fn }),
    listen: async () => () => {},
  };
  return {
    bridge,
    calls,
    written,
    send: (id: number, e: NativeEvent) => channels.get(id)?.onmessage(e),
    setPorts: (p: NativePortInfo[]) => (ports = p),
    openIds: () => [...channels.keys()],
  };
}

function memoryGrants(names: string[] = []): GrantStore {
  let list = [...names];
  return { load: () => [...list], save: (n) => (list = [...n]) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function api(d: ReturnType<typeof fakeDesktop>, pick: NativePortInfo | null, grants = memoryGrants(), every: (fn: () => void, ms: number) => void = () => {}) {
  return new NativeSerialApi(async () => d.bridge, async () => pick, grants, every);
}

describe('NativeSerialApi', () => {
  it('chooses a port through the in-app chooser and remembers it', async () => {
    const d = fakeDesktop({ ports: [IC705, DIGIRIG] });
    const grants = memoryGrants();
    const a = api(d, DIGIRIG, grants);
    const chosen = await choosePort(a);
    expect('port' in chosen).toBe(true);
    if (!('port' in chosen)) return;
    expect(chosen.port.getInfo()).toEqual({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
    expect(grants.load()).toEqual(['COM7']);
    // The same object in every list, as in Web Serial.
    expect(await grantedPorts(a)).toEqual([chosen.port]);
  });

  it('reads a cancelled chooser as Web Serial does', async () => {
    const d = fakeDesktop();
    expect(await choosePort(api(d, null))).toEqual({ error: 'cancelled' });
  });

  it('gives only the remembered ports that are plugged in', async () => {
    const d = fakeDesktop({ ports: [IC705] });
    const a = api(d, null, memoryGrants(['COM4', 'COM7']));
    expect((await grantedPorts(a)).map((p) => p.getInfo().usbVendorId)).toEqual([0x0c26]);
  });

  it('forgets a port', async () => {
    const d = fakeDesktop();
    const grants = memoryGrants(['COM4']);
    const a = api(d, null, grants);
    const [p] = await grantedPorts(a);
    await p.forget?.();
    expect(grants.load()).toEqual([]);
    expect(await grantedPorts(a)).toEqual([]);
  });

  it('fires connect when a remembered port appears', async () => {
    const d = fakeDesktop({ ports: [] });
    let poll: (() => void) | null = null;
    const a = api(d, null, memoryGrants(['COM4']), (fn) => (poll = fn));
    let connects = 0;
    a.addEventListener('connect', () => connects++);
    await tick();
    expect(connects).toBe(0);
    d.setPorts([IC705]);
    poll!();
    await tick();
    expect(connects).toBe(1);
    // Still there: no second event.
    poll!();
    await tick();
    expect(connects).toBe(1);
  });
});

describe('SerialLink over a native port', () => {
  async function openLink(d: ReturnType<typeof fakeDesktop>, keepOpenWithoutLines = false) {
    const a = api(d, null, memoryGrants(['COM4']));
    const [port] = await grantedPorts(a);
    const link = new SerialLink(port, CIV_PORT, { keepOpenWithoutLines });
    return { port, link, result: await link.open() };
  }

  it('opens with the port settings and lowers DTR and RTS', async () => {
    const d = fakeDesktop();
    const { link, result } = await openLink(d);
    expect(result).toBeNull();
    expect(link.state).toBe('open');
    expect(link.linesLow).toBe(true);
    const open = d.calls.find((c) => c.cmd === 'serial_open');
    expect(open?.args?.name).toBe('COM4');
    expect(open?.args?.settings).toEqual({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', hardwareFlow: false });
    const lines = d.calls.find((c) => c.cmd === 'serial_lines');
    expect(lines?.args).toEqual({ id: 1, dtr: false, rts: false });
    expect(d.written).toEqual([]);
  });

  it('opens the KX2 port at its rate', async () => {
    const d = fakeDesktop();
    const a = api(d, null, memoryGrants(['COM4']));
    const [port] = await grantedPorts(a);
    await new SerialLink(port, kx2Port(4800)).open();
    expect(d.calls.find((c) => c.cmd === 'serial_open')?.args?.settings).toMatchObject({ baudRate: 4800 });
  });

  it('delivers bytes in order and writes in order', async () => {
    const d = fakeDesktop();
    const { link } = await openLink(d);
    const got: number[][] = [];
    link.onData((b) => got.push([...b]));
    d.send(1, { type: 'data', bytes: [0xfe, 0xfe] });
    d.send(1, { type: 'data', bytes: [0xe0, 0xfd] });
    await tick();
    expect(got).toEqual([
      [0xfe, 0xfe],
      [0xe0, 0xfd],
    ]);
    await link.write(new Uint8Array([0x46, 0x41, 0x3b]));
    await link.write(new Uint8Array([0x54, 0x51]));
    expect(d.written).toEqual([[0x46, 0x41, 0x3b], [0x54, 0x51]]);
  });

  it('ends the link with lost when the port goes, before anything else', async () => {
    const d = fakeDesktop();
    const { link } = await openLink(d);
    const ends: string[] = [];
    link.onEnd((e) => ends.push(e));
    d.send(1, { type: 'lost' });
    await tick();
    expect(ends).toEqual(['lost']);
    await tick();
    expect(d.calls.some((c) => c.cmd === 'serial_close')).toBe(true);
    expect(d.openIds()).toEqual([]);
  });

  it('closes with closed and lets the port go', async () => {
    const d = fakeDesktop();
    const { link } = await openLink(d);
    const ends: string[] = [];
    link.onEnd((e) => ends.push(e));
    await link.close();
    expect(ends).toEqual(['closed']);
    expect(link.state).toBe('closed');
    expect(d.openIds()).toEqual([]);
  });

  it('reports a port another program has as busy', async () => {
    const d = fakeDesktop({ openError: { kind: 'busy' } });
    const { result } = await openLink(d);
    expect(result).toBe('busy');
  });

  it('reports any other refusal as failed', async () => {
    const d = fakeDesktop({ openError: { kind: 'failed', detail: 'No such file or directory' } });
    const { result, link } = await openLink(d);
    expect(result).toBe('failed');
    expect(link.state).toBe('closed');
  });

  it('closes a port whose lines cannot be lowered, or keeps it open when told to', async () => {
    const closed = await openLink(fakeDesktop({ linesFail: true }));
    expect(closed.result).toBe('signals');
    const kept = await openLink(fakeDesktop({ linesFail: true }), true);
    expect(kept.result).toBeNull();
    expect(kept.link.linesLow).toBe(false);
  });
});

describe('localGrants', () => {
  it('keeps the choice in storage and survives storage that throws', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) } as unknown as Storage;
    const g = localGrants(() => storage);
    g.save(['COM4']);
    expect(localGrants(() => storage).load()).toEqual(['COM4']);
    const broken = localGrants(() => {
      throw new Error('blocked');
    });
    broken.save(['COM9']);
    expect(broken.load()).toEqual(['COM9']);
  });
});
