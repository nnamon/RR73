#!/usr/bin/env node
// Chooses the sources the CI "Reference data" job may ask, for build.mjs --ask. Run in the job
// after the cache restore; writes ask=<ids> and sota=true|false to $GITHUB_OUTPUT.
//
// - The country file is committed in refdata/bigcty and never asked.
// - The main branch may ask POTA and SOTA. Within one cache, build.mjs asks each at most
//   once per UTC day.
// - Other branches, tags and pull requests build from the cache they restored, main's included,
//   and ask nothing. A run that restored no cache at all asks, so a build before main has a cache
//   still gets the parks list.
// - SOTA: one request per UTC day across the whole repository. A run records its request as the
//   cache entry sota-asked-<day> before it asks, and a run asks only when no branch holds that
//   entry. Caches are per branch, so the job lists them through the GitHub API (actions: read).
//   A failed listing counts as asked.
//
// Environment: DAY (YYYY-MM-DD, UTC), RESTORED (the restored cache key, empty for none),
// GITHUB_REF, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_TOKEN, GITHUB_OUTPUT.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAIN = 'refs/heads/main';
/** The cache key that records a SOTA request on `day`. */
export const sotaKey = (day) => `sota-asked-${day}`;

/** True when any branch holds the cache entry for a SOTA request on `day`, or the listing fails. */
export async function sotaAskedToday({ day, repository, apiUrl = 'https://api.github.com', token, fetch = globalThis.fetch }) {
  try {
    const url = `${apiUrl}/repos/${repository}/actions/caches?key=${encodeURIComponent(sotaKey(day))}&per_page=1`;
    const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' } });
    if (!res.ok) return { asked: true, why: `the cache list answered ${res.status}` };
    const body = await res.json();
    const n = Number(body?.total_count);
    if (!Number.isFinite(n)) return { asked: true, why: 'the cache list did not give a count' };
    return n > 0 ? { asked: true, why: `${sotaKey(day)} exists` } : { asked: false, why: `no ${sotaKey(day)} on any branch` };
  } catch (e) {
    return { asked: true, why: `the cache list failed (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** The sources this run may ask, and why. */
export async function plan({ ref, restored, ...api }) {
  const allowed = ref === MAIN || !restored;
  if (!allowed) return { ask: [], sota: false, why: [`${ref} builds from the restored cache ${restored}`] };
  const why = [ref === MAIN ? 'main asks each source once a day' : `${ref} restored no cache`];
  const sota = await sotaAskedToday(api);
  why.push(`SOTA: ${sota.why}`);
  return { ask: ['pota', ...(sota.asked ? [] : ['sota'])], sota: !sota.asked, why };
}

async function main() {
  const env = process.env;
  const p = await plan({ ref: env.GITHUB_REF ?? '', restored: env.RESTORED ?? '', day: env.DAY ?? new Date().toISOString().slice(0, 10), repository: env.GITHUB_REPOSITORY ?? '', apiUrl: env.GITHUB_API_URL, token: env.GITHUB_TOKEN ?? '' });
  for (const line of p.why) console.log(`ci-plan: ${line}`);
  console.log(`ci-plan: asking ${p.ask.join(', ') || 'nothing'}`);
  if (p.sota) {
    // The path the sota-asked cache entry saves.
    mkdirSync('.refdata-sota', { recursive: true });
    writeFileSync('.refdata-sota/asked', `${new Date().toISOString()} ${env.GITHUB_REF ?? ''}\n`);
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `ask=${p.ask.join(',')}\nsota=${p.sota}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`ci-plan: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
