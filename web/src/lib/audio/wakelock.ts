/**
 * Keeps the screen on while RR73 operates (Screen Wake Lock, iOS 18.4 and later in home-screen
 * apps). The system drops the lock when the page is hidden; it is asked for again when the page
 * is visible and still wanted.
 */

export type WakeState = 'off' | 'held' | 'refused' | 'unsupported';

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

export class WakeLockKeeper {
  private wanted = false;
  private sentinel: Sentinel | null = null;
  private pending = false;
  private readonly api: WakeLockApi | null;
  private readonly doc: Document;
  state: WakeState = 'off';
  onChange: ((s: WakeState) => void) | null = null;

  constructor(nav: Navigator = navigator, doc: Document = document) {
    this.api = (nav as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null;
    this.doc = doc;
    if (!this.api) this.state = 'unsupported';
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible' && this.wanted && !this.sentinel) void this.acquire();
    });
  }

  /** Asks for the lock (true) or lets it go (false). */
  set(want: boolean) {
    this.wanted = want;
    if (want) void this.acquire();
    else {
      const s = this.sentinel;
      this.sentinel = null;
      void s?.release().catch(() => undefined);
      if (this.api) this.update('off');
    }
  }

  private async acquire() {
    if (!this.api || this.sentinel || this.pending || this.doc.visibilityState !== 'visible') return;
    this.pending = true;
    try {
      const s = await this.api.request('screen');
      if (!this.wanted) {
        void s.release().catch(() => undefined);
        return;
      }
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) {
          this.sentinel = null;
          this.update(this.wanted ? 'refused' : 'off');
        }
      });
      this.update('held');
    } catch {
      this.update('refused');
    } finally {
      this.pending = false;
    }
  }

  private update(s: WakeState) {
    this.state = s;
    this.onChange?.(s);
  }
}
