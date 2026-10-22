<script lang="ts">
  /** Settings › FT8 and FT4: the sequencer's settings (ADR 0006). */
  import BackLink from '../ui/BackLink.svelte';
  import { href } from '../lib/app/router.svelte';
  import { normaliseExchange, normaliseMinutes, settings, updateSettings } from '../lib/state/settings.svelte';
  import { features } from '../lib/state/features.svelte';
  import { readExchange, sentExchange } from '../lib/qso/exchange';

  let watchdogMin = $state(String(settings.watchdogMin));
  $effect(() => {
    watchdogMin = String(settings.watchdogMin);
  });

  let huntCalls = $state(String(settings.huntCalls));
  $effect(() => {
    huntCalls = String(settings.huntCalls);
  });

  let exchange = $state(settings.exchange);
  $effect(() => {
    exchange = settings.exchange;
  });

  let serial = $state(String(settings.exchangeSerial));
  $effect(() => {
    serial = String(settings.exchangeSerial);
  });

  // What the exchange sends in each format, as on air, for a station heard at −10 dB.
  const FORMATS = [
    ['fd', 'Class and section'],
    ['ru', 'Report and state or serial'],
    ['vhf', 'Report, serial and grid'],
  ] as const;
  const preview = $derived.by(() => {
    const parts = readExchange(exchange);
    return FORMATS.map(([f, label]) => {
      const r = sentExchange(f, parts, { serial: settings.exchangeSerial, snrDb: -10, grid: settings.grid });
      return { f, label, text: 'ok' in r ? r.ok.text : r.missing, ok: 'ok' in r };
    });
  });

  function saveExchange() {
    const v = normaliseExchange(exchange);
    exchange = v;
    if (v !== settings.exchange) void updateSettings({ exchange: v });
  }

  /** A whole number from 0 to 9999; anything else puts back the stored value. */
  function saveSerial() {
    const n = Number(serial);
    if (serial.trim() && Number.isInteger(n) && n >= 0 && n <= 9999) void updateSettings({ exchangeSerial: n });
    else serial = String(settings.exchangeSerial);
  }

  /** A whole number of calls from 1 to 99; anything else puts back the stored value. */
  function saveHuntCalls() {
    const n = Number(huntCalls);
    if (Number.isInteger(n) && n >= 1 && n <= 99) void updateSettings({ huntCalls: n });
    else huntCalls = String(settings.huntCalls);
  }

  /** Any positive number of minutes; anything else puts back the stored value. */
  function saveWatchdog() {
    const m = normaliseMinutes(Number(watchdogMin.replace(',', '.')));
    if (m === null) watchdogMin = String(settings.watchdogMin);
    else void updateSettings({ watchdogMin: m });
  }
</script>

<section class="screen sub" aria-labelledby="ft8-title">
  <BackLink to={href('settings')} label="Settings" title="FT8 and FT4" id="ft8-title" />

  <div class="section">
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title" id="ack">Confirm with</span></span>
        <span class="seg ack" role="radiogroup" aria-labelledby="ack">
          {#each ['RR73', 'RRR'] as const as a (a)}
            <label class="seg-i" class:on={settings.ack === a}>
              <input class="visually-hidden" type="radio" name="ack" value={a} checked={settings.ack === a} onchange={() => void updateSettings({ ack: a })} />
              {a}
            </label>
          {/each}
        </span>
      </div>
      <label class="row">
        <!-- Dupes count within one activation (docs/design/sequencer.md). With Activations off, QSOs are logged outside any. -->
        <span class="row-main"><span class="row-title">Work dupes</span><span class="row-sub">{features.activations ? 'Same day, band, mode and activation' : 'Same day, band and mode'}</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.workDupes} onchange={(e) => void updateSettings({ workDupes: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Tail-end</span><span class="row-sub">Call once more after their QSO</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.tailEnd} onchange={(e) => void updateSettings({ tailEnd: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Hunt calls</span><span class="row-sub">Then moves to the next CQ</span></span>
        <input
          class="field num count"
          type="text"
          inputmode="numeric"
          bind:value={huntCalls}
          onblur={saveHuntCalls}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          autocomplete="off"
          aria-label="Hunt calls, times"
        />
        <span class="unit">{settings.huntCalls === 1 ? 'time' : 'times'}</span>
      </label>
      <label class="row">
        <span class="row-main"><span class="row-title">Watchdog</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.watchdog} onchange={(e) => void updateSettings({ watchdog: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
      {#if settings.watchdog}
        <label class="row">
          <span class="row-title">Stop Tx after</span>
          <input
            class="field num"
            type="text"
            inputmode="decimal"
            bind:value={watchdogMin}
            onblur={saveWatchdog}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            autocomplete="off"
            aria-label="Stop Tx after, min"
          />
          <span class="unit">min</span>
        </label>
        <label class="row">
          <span class="row-main"><span class="row-title">Responses refresh watchdog</span><span class="row-sub">Each new message restarts it</span></span>
          <input class="switch" type="checkbox" role="switch" checked={settings.watchdogRefresh} onchange={(e) => void updateSettings({ watchdogRefresh: (e.currentTarget as HTMLInputElement).checked })} />
        </label>
      {/if}
      <label class="row">
        <span class="row-main"><span class="row-title">Hold Tx frequency</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.holdTx} onchange={(e) => void updateSettings({ holdTx: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
    </div>
  </div>


  <div class="section">
    <div class="group">
      <label class="row">
        <span class="row-title">Custom exchange</span>
        <input
          class="field mono exch"
          type="text"
          bind:value={exchange}
          onblur={saveExchange}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength="20"
          placeholder="Class section, state or #"
          aria-label="Custom exchange"
        />
      </label>
      {#if exchange.trim()}
        {#each preview as p (p.f)}
          <div class="row" data-testid="exchange-{p.f}">
            <span class="row-main"><span class="row-title">{p.label}</span></span>
            <span class="row-value mono" class:missing={!p.ok}>{p.text}</span>
          </div>
        {/each}
      {/if}
      {#if settings.exchange}
        <label class="row">
          <span class="row-title">Next serial number</span>
          <input
            class="field num"
            type="text"
            inputmode="numeric"
            bind:value={serial}
            onblur={saveSerial}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            autocomplete="off"
            aria-label="Next serial number"
          />
        </label>
      {/if}
    </div>
    <p class="section-foot">Used when a station sends an exchange or calls CQ FD or CQ RU.</p>
  </div>

  <div class="section">
    <h2 class="section-head">Decoding</h2>
    <div class="group">
      <div class="row">
        <span class="row-main"><span class="row-title" id="depth">Depth</span></span>
        <span class="seg ack" role="radiogroup" aria-labelledby="depth">
          {#each [['deep', 'Deep'], ['fast', 'Fast']] as const as [id, label] (id)}
            <label class="seg-i" class:on={settings.decodeDepth === id}>
              <input class="visually-hidden" type="radio" name="depth" value={id} checked={settings.decodeDepth === id} onchange={() => void updateSettings({ decodeDepth: id })} />
              {label}
            </label>
          {/each}
        </span>
      </div>
      <label class="row">
        <span class="row-main"><span class="row-title">A priori decoding</span></span>
        <input class="switch" type="checkbox" role="switch" checked={settings.aPriori} onchange={(e) => void updateSettings({ aPriori: (e.currentTarget as HTMLInputElement).checked })} />
      </label>
    </div>
    <p class="section-foot">Fast decodes about 3% fewer stations.</p>
  </div>
</section>

<style>
  /* A format the exchange cannot fill yet: what it lacks, in the warning colour. */
  .row-value.missing {
    color: var(--rr-warn);
  }

  .sub {
    padding-top: var(--rr-safe-top);
  }

  .ack {
    width: 160px;
  }

  .field {
    flex: 1;
    min-width: 0;
    height: var(--rr-tap);
    border: 0;
    background: transparent;
    font-size: var(--rr-text-body);
    text-align: right;
  }

  .field.num {
    font-variant-numeric: tabular-nums;
  }

  /* Up to 2 digits: the row's text keeps the width. */
  .field.count {
    flex: none;
    width: 3em;
  }

  .exch {
    text-transform: uppercase;
  }

  .unit {
    flex: none;
    color: var(--rr-label2);
  }

  .field:focus {
    outline: none;
  }

  .row:has(.field:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--rr-accent);
  }
</style>
