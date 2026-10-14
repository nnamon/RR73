// Which sources a CI run may ask: main asks, other refs build from their cache unless they have
// none, and SOTA is asked once a day across the repository. The GitHub API is faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN, plan, sotaKey } from './ci-plan.mjs';

const DAY = '2026-10-14';

/** A cache list answering total_count n, or an error status, or a thrown error. Records URLs. */
function caches(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (answer instanceof Error) throw answer;
    if (typeof answer === 'number') return new Response(JSON.stringify({ total_count: answer, actions_caches: [] }), { status: 200 });
    return new Response('{}', { status: answer.status });
  };
  fetch.calls = calls;
  return fetch;
}

const api = (fetch) => ({ day: DAY, repository: 'nnamon/RR73', apiUrl: 'https://api.test', token: 't0k', fetch });

test('main asks every source when no run asked SOTA today', async () => {
  const fetch = caches(0);
  const p = await plan({ ref: MAIN, restored: 'refdata-2026-10-13', ...api(fetch) });
  assert.deepEqual([p.ask, p.sota], [['cty', 'lotw', 'pota', 'sota'], true]);
  assert.deepEqual(fetch.calls, [{ url: `https://api.test/repos/nnamon/RR73/actions/caches?key=${sotaKey(DAY)}&per_page=1`, auth: 'Bearer t0k' }]);
});

test('main leaves SOTA out when any branch asked it today, or the list fails', async () => {
  for (const answer of [1, { status: 403 }, new TypeError('fetch failed')]) {
    const p = await plan({ ref: MAIN, restored: '', ...api(caches(answer)) });
    assert.deepEqual([p.ask, p.sota], [['cty', 'lotw', 'pota'], false], String(answer));
  }
});

test('other refs with a cache ask nothing and do not list caches', async () => {
  for (const ref of ['refs/heads/feat/x', 'refs/tags/v0.11.0', 'refs/pull/7/merge']) {
    const fetch = caches(0);
    const p = await plan({ ref, restored: 'refdata-2026-10-13', ...api(fetch) });
    assert.deepEqual([p.ask, p.sota], [[], false], ref);
    assert.equal(fetch.calls.length, 0);
  }
});

test('a ref that restored no cache asks, SOTA only if nobody asked it today', async () => {
  assert.deepEqual((await plan({ ref: 'refs/heads/feat/x', restored: '', ...api(caches(0)) })).ask, ['cty', 'lotw', 'pota', 'sota']);
  assert.deepEqual((await plan({ ref: 'refs/heads/feat/x', restored: '', ...api(caches(2)) })).ask, ['cty', 'lotw', 'pota']);
});
