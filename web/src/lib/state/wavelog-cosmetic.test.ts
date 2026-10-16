// The owner's rule for Read Wavelog's log: what Wavelog's log holds is cosmetic. It colours
// decodes, and counts for New and Hide worked, and changes nothing the sequencer decides: Hunt's
// pick in any order, Repeat CQ's answer and order, and dupes, which come from this phone's log.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultHighlights, highlightDecode } from '../decode/highlight';
import { addQso, loadLog, log } from '../log/log.svelte';
import { addRows, keySets } from '../log/wavelog-worked';
import { wavelogIndex, wavelogWorked } from '../log/wavelog-worked.svelte';
import { buildKeysIndex, buildLogIndex, mergeLogIndex, type LogIndex } from '../log/worked';
import { huntCandidates, type HuntOrder, type QueueOrder } from '../qso/sequencer';
import { Sim, T0, decode } from '../testing/qso-sim';
import { sequencerWorked } from './qso.svelte';

/** Wavelog's log: JA1KXM and K1ABC on 20m FT8, worked from another station, indexed as the app holds it. */
function wavelogKeys(): LogIndex {
  const k = keySets();
  addRows(
    [
      { CALL: 'JA1KXM', BAND: '20m', MODE: 'FT8', SUBMODE: '', GRIDSQUARE: 'PM95' },
      { CALL: 'K1ABC', BAND: '20m', MODE: 'FT8', SUBMODE: '', GRIDSQUARE: 'FN42' },
    ],
    k,
  );
  return buildKeysIndex(k);
}

/** CQs heard in slot 1: K1ABC strongest, then JA1KXM, then VK3QRP, which no log holds. */
const CQS = [decode('CQ K1ABC FN42', -1, 600), decode('CQ JA1KXM PM95', -5, 900), decode('CQ VK3QRP QF22', -12, 1200)];

beforeAll(async () => {
  await loadLog();
  // The phone's log: K1ABC on 20m FT8 today (a dupe), outside any activation.
  await addQso({ call: 'K1ABC', mode: 'FT8', band: '20m', dialHz: 14_074_000, audioHz: 1500, startUtcMs: T0 - 600_000, endUtcMs: T0 - 540_000, reportSent: -10, reportRcvd: -12, activationId: null });
});

afterEach(() => {
  wavelogWorked.index = null;
});

/** Hunt in `order` with Work dupes off, from the worked-before list the app gives the sequencer. */
function hunt(order: HuntOrder) {
  const s = new Sim({ huntOrder: order });
  s.send({ type: 'setWorked', worked: sequencerWorked(), nowMs: s.at(0) });
  s.send({ type: 'hunt', on: true, nowMs: s.at(0, 5) });
  s.hear(1, CQS);
  return { partner: s.st.partner?.call ?? null, candidates: huntCandidates(s.st, s.at(1), s.at(2, 0.1)).map((q) => q.call), next: s.st.next?.text ?? null, effects: s.effects };
}

/** Repeat CQ in `order`, with JA1KXM, VK3QRP and K1ABC calling in slot 1, in that order. */
function repeatCq(order: QueueOrder) {
  const s = new Sim({ run: true, order });
  s.send({ type: 'setWorked', worked: sequencerWorked(), nowMs: s.at(0) });
  s.send({ type: 'callCq', nowMs: s.at(0, 0.1) });
  s.run(0, 2, { 1: [decode('9V1NE JA1KXM PM95', -12, 900), decode('9V1NE VK3QRP QF22', -3, 1200), decode('9V1NE K1ABC FN42', -1, 600)] });
  return { queue: s.st.queue.map((c) => ({ call: c.call, dupe: c.dupe, isNew: c.isNew })), sent: s.sent.map((t) => `${t.slot}:${t.text}`), effects: s.effects };
}

describe('Read Wavelog’s log', () => {
  it('colours a station worked only in Wavelog, so the test below has data that counts', () => {
    const own = buildLogIndex(log.live);
    wavelogWorked.index = wavelogKeys();
    const both = mergeLogIndex(own, wavelogIndex());
    const at = { band: '20m', mode: 'FT8' };
    expect(highlightDecode({ text: 'CQ JA1KXM PM95' }, '9V1NE', own, at, defaultHighlights())).toMatchObject({ worked: false, isNew: true });
    expect(highlightDecode({ text: 'CQ JA1KXM PM95' }, '9V1NE', both, at, defaultHighlights())).toMatchObject({ worked: true, isNew: false, ink: 'worked' });
  });

  it('never reaches the sequencer’s worked-before list', () => {
    const without = sequencerWorked();
    wavelogWorked.index = wavelogKeys();
    expect(sequencerWorked()).toEqual(without);
    expect(sequencerWorked().map((w) => w.call)).toEqual(['K1ABC']);
  });

  it('changes neither Hunt’s pick nor its dupes, in any order', () => {
    for (const order of ['unworked', 'new', 'strongest', 'newest', 'farthest'] as const) {
      wavelogWorked.index = null;
      const own = hunt(order);
      wavelogWorked.index = wavelogKeys();
      const both = hunt(order);
      expect(both, order).toEqual(own);
    }
    // Not worked first: JA1KXM, worked only in Wavelog, counts as not worked and is the strongest
    // after K1ABC, which the phone's log holds today and Hunt skips as a dupe.
    wavelogWorked.index = wavelogKeys();
    expect(hunt('unworked')).toMatchObject({ partner: 'JA1KXM', candidates: ['JA1KXM', 'VK3QRP'], next: 'JA1KXM 9V1NE OJ11' });
    expect(hunt('new')).toMatchObject({ partner: 'JA1KXM' });
  });

  it('changes neither Repeat CQ’s answer, its order nor its dupes', () => {
    for (const order of ['first', 'strongest', 'weakest', 'farthest', 'new'] as const) {
      wavelogWorked.index = null;
      const own = repeatCq(order);
      wavelogWorked.index = wavelogKeys();
      const both = repeatCq(order);
      expect(both, order).toEqual(own);
    }
    wavelogWorked.index = wavelogKeys();
    // New first: JA1KXM, worked only in Wavelog, is new to the sequencer and first heard, so it is
    // answered before VK3QRP. K1ABC, in the phone's log today, waits last as the dupe.
    const r = repeatCq('new');
    expect(r.sent.at(-1)).toBe('2:JA1KXM 9V1NE -12');
    expect(r.queue).toEqual([
      { call: 'VK3QRP', dupe: false, isNew: true },
      { call: 'K1ABC', dupe: true, isNew: false },
    ]);
  });
});
