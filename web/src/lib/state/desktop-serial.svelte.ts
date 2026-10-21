/**
 * Rig control's serial ports in the desktop app (lib/cat/native.ts), and the port chooser that
 * Connect radio shows there in place of the browser's (ui/PortChooser.svelte).
 */

import { desktopBridge } from '../app/desktop';
import { NativeSerialApi, type NativePortInfo } from '../cat/native';

/** The chooser's state: open with the ports listed, until the operator picks one or cancels. */
export const portChooser = $state<{ open: boolean; ports: NativePortInfo[] }>({ open: false, ports: [] });

let settle: ((p: NativePortInfo | null) => void) | null = null;

/** Shows the chooser with `ports`; resolves with the port chosen, or null. */
export function choosePortInApp(ports: NativePortInfo[]): Promise<NativePortInfo | null> {
  settle?.(null);
  portChooser.ports = ports;
  portChooser.open = true;
  return new Promise((resolve) => {
    settle = resolve;
  });
}

/** The operator picked `port`, or closed the chooser (null). */
export function settleChooser(port: NativePortInfo | null) {
  portChooser.open = false;
  const s = settle;
  settle = null;
  s?.(port);
}

let api: NativeSerialApi | null = null;

/** The desktop app's serial ports. Call only in the desktop app. */
export function desktopSerialApi(): NativeSerialApi {
  api ??= new NativeSerialApi(desktopBridge, choosePortInApp);
  return api;
}
