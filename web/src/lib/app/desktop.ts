/**
 * The desktop app (docs/design/desktop.md): the same web build in a Tauri window, whose Rust side
 * adds native serial ports and an SNTP clock. `isDesktop()` tells the paths apart at run time;
 * every browser path stays as it is.
 *
 * The bridge is the part of Tauri's API the app uses: commands, channels for a command's stream
 * of events, and app events. `@tauri-apps/api` loads only in the desktop app, and tests pass a
 * fake bridge.
 */

/** A channel a command sends events on, as Tauri's `Channel`. */
export interface ChannelLike<T> {
  onmessage: (message: T) => void;
}

/** The parts of Tauri's API RR73 uses. */
export interface DesktopBridge {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  channel<T>(onMessage: (message: T) => void): ChannelLike<T>;
  listen(event: string, handler: () => void): Promise<() => void>;
}

/** True in the desktop app: Tauri injects its internals before the page's scripts run. */
export function isDesktop(g: unknown = globalThis): boolean {
  return typeof g === 'object' && g !== null && '__TAURI_INTERNALS__' in g;
}

let bridge: Promise<DesktopBridge> | null = null;

/** Tauri's API, loaded on first use. Call only when `isDesktop()`. */
export function desktopBridge(): Promise<DesktopBridge> {
  bridge ??= Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]).then(([core, event]) => ({
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => core.invoke<T>(cmd, args),
    channel: <T>(onMessage: (message: T) => void) => {
      const ch = new core.Channel<T>();
      ch.onmessage = onMessage;
      return ch;
    },
    listen: (name: string, handler: () => void) => event.listen(name, () => handler()),
  }));
  return bridge;
}
