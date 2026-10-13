// Hash router: "#/settings/radio" gives { path: ['settings', 'radio'] }. Hash routes work under
// any base path, so the same build runs at / and at /RR73/.

export const TABS = ['operate', 'log', 'spots', 'settings'] as const;
export type Tab = (typeof TABS)[number];

function current(): string[] {
  if (typeof location === 'undefined') return ['operate'];
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ['operate'];
}

export const route = $state<{ path: string[] }>({ path: current() });

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.path = current();
  });
}

export function href(...parts: string[]): string {
  return `#/${parts.map(encodeURIComponent).join('/')}`;
}

export function go(...parts: string[]) {
  location.hash = href(...parts);
}

/** Opens another path in place of the current one, without a history entry. */
export function replace(...parts: string[]) {
  history.replaceState(history.state, '', href(...parts));
  route.path = parts;
}

/** Paths from earlier versions that now open another tab: activations live under Spots. */
const MOVED: Record<string, Tab> = { activate: 'spots' };

/** The tab a path belongs to. */
export function tabOf(path: string[]): Tab {
  const t = path[0] as Tab;
  if (TABS.includes(t)) return t;
  return MOVED[path[0]] ?? 'operate';
}

/** The tabs in the tab bar: Spots only while activations or a spot source is on. */
export function visibleTabs(spots: boolean): Tab[] {
  return TABS.filter((t) => spots || t !== 'spots');
}

/**
 * Where a path leads with Spots hidden: Spots and the Activate path of earlier versions open
 * Settings › Optional features, which says how to bring Spots back. Null when the path stays.
 */
export function redirectOf(path: string[], spots: boolean): string[] | null {
  return !spots && tabOf(path) === 'spots' ? ['settings', 'features'] : null;
}
