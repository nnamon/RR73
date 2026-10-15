<script lang="ts">
  /**
   * The top bar with the station's state, and the band sheet it opens. Operate shows it in compact
   * and compact height; in regular width the app shows it above every screen, with the tabs, and
   * with Halt on the other screens while Tx is on.
   */
  import BandSheet from './BandSheet.svelte';
  import TopBar from './TopBar.svelte';
  import { layout } from '../lib/app/layout.svelte';
  import type { Tab } from '../lib/app/router.svelte';
  import { sheets } from '../lib/app/sheets.svelte';
  import { utcTime } from '../lib/clock/format';
  import { hasSlots, isKeyboard as keyboardMode, slotProgress } from '../lib/clock/slots';
  import { dialHz } from '../lib/radio/bands';
  import { dial4 } from '../lib/rtty/dial';
  import { currentDialHz, session } from '../lib/state/keyboard.svelte';
  import { operatingDialHz } from '../lib/radio/hound-dial';
  import { dialNow } from '../lib/state/radio.svelte';
  import { spotsShown } from '../lib/state/features.svelte';
  import { clock } from '../lib/state/now.svelte';
  import { practice } from '../lib/state/practice.svelte';
  import { webSdrInput } from '../lib/state/relay.svelte';
  import { houndOn, qso } from '../lib/state/qso.svelte';
  import { settings } from '../lib/state/settings.svelte';
  import { audio, clockCheck, halt, tx } from '../lib/state/station.svelte';
  import { clockText } from '../lib/clock/calibration';
  import { wspr } from '../lib/state/wspr.svelte';

  let { regular = false, tab = 'operate' }: { regular?: boolean; tab?: Tab } = $props();

  const isWspr = $derived(settings.mode === 'WSPR');
  const isKeyboard = $derived(keyboardMode(settings.mode));
  const live = $derived(audio.status === 'running');
  const onAir = $derived(isWspr ? !!wspr.onAir : isKeyboard ? session.tx !== 'off' : !!qso.onAir);
  const transmitting = $derived(onAir || tx.tuning);
  const stateText = $derived(
    onAir
      ? 'Transmitting'
      : tx.tuning
        ? 'Tuning'
        : live
          ? 'Receiving'
          : audio.status === 'starting'
            ? 'Starting audio'
            : audio.status === 'stopped'
              ? 'Audio stopped'
              : 'Audio off',
  );

  // What Halt would stop, for the other screens: on air now, or Tx on and waiting for its slot.
  const air = $derived.by((): { text: string; live: boolean } | null => {
    if (tx.tuning) return { text: 'Tuning', live: true };
    if (isWspr) {
      if (wspr.onAir) return { text: 'On air', live: true };
      return wspr.beacon.on ? { text: 'Beacon on', live: false } : null;
    }
    if (isKeyboard) return session.tx !== 'off' ? { text: 'On air', live: true } : null;
    if (qso.onAir) return { text: `On air · Tx${qso.onAir.tx}`, live: true };
    return qso.st.txEnabled ? { text: 'Tx on', live: false } : null;
  });
</script>

<TopBar
  band={settings.band}
  mode={houndOn() ? `${settings.mode} Hound` : settings.mode}
  dialHz={isWspr ? dialNow(dialHz(settings.band, 'WSPR')) : isKeyboard ? currentDialHz() : dialNow(operatingDialHz(settings.band, settings.mode, houndOn(), settings.houndDialHz, settings.ftDialHz))}
  dialText={isKeyboard ? dial4(currentDialHz()) : undefined}
  utc={utcTime(clock.ms)}
  progress={hasSlots(settings.mode) ? slotProgress(clock.ms, settings.mode) : null}
  tone={transmitting ? 'tx' : live ? 'rx' : 'idle'}
  state={stateText}
  onair={transmitting}
  rmsDb={audio.rmsDb}
  {live}
  spots={spotsShown()}
  practice={practice.on}
  sdr={!practice.on && webSdrInput() !== null}
  clockOff={clockCheck.offS === null ? null : clockText(clockCheck.offS)}
  onband={() => (sheets.band = true)}
  {regular}
  {tab}
  {air}
  kbd={layout.pointer === 'mouse'}
  onhalt={() => halt()}
/>

<BandSheet bind:open={sheets.band} />
