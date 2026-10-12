// Hash router: "#/settings/radio" gives { path: ['settings', 'radio'] }. Hash routes work under
// any base path, so the same build runs at / and at /RR73/.

export const TABS = ['operate', 'log', 'activate', 'spots', 'settings'] as const;
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

/** The tab a path belongs to. */
export function tabOf(path: string[]): Tab {
  const t = path[0] as Tab;
  return TABS.includes(t) ? t : 'operate';
}
