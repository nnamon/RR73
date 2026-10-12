import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoVersion, setCargoVersion, nextVersion, parseChangelog, release } from './version.mjs';

const CARGO = '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n\n[workspace.dependencies]\nfoo = { version = "1" }\n';
const LOG = '# Changelog\n\n## Unreleased\n\n- Decodes FT4.\n\n## 0.1.0 · 2026-10-13\n\n- Live waterfall.\n- Save slots.\n';

test('reads and sets the workspace version only', () => {
  assert.equal(cargoVersion(CARGO), '0.1.0');
  const out = setCargoVersion(CARGO, '0.2.0');
  assert.equal(cargoVersion(out), '0.2.0');
  assert.match(out, /foo = \{ version = "1" \}/);
});

test('computes the next version', () => {
  assert.equal(nextVersion('0.1.3', 'patch'), '0.1.4');
  assert.equal(nextVersion('0.1.3', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.3', 'major'), '1.0.0');
  assert.equal(nextVersion('0.1.3', '0.5.0'), '0.5.0');
  assert.throws(() => nextVersion('0.1.3', 'huge'));
});

test('parses sections and entries', () => {
  const s = parseChangelog(LOG);
  assert.deepEqual(s.map((x) => x.version), [null, '0.1.0']);
  assert.deepEqual(s[1].entries, ['Live waterfall.', 'Save slots.']);
  assert.equal(s[1].date, '2026-10-13');
});

test('release turns Unreleased into a dated version', () => {
  const out = release(LOG, '0.2.0', '2026-10-20');
  assert.deepEqual(parseChangelog(out).map((x) => x.version), ['0.2.0', '0.1.0']);
  assert.throws(() => release(out, '0.3.0', '2026-10-21'), /Unreleased/);
  assert.throws(() => release(LOG, '0.1.0', '2026-10-21'), /already has/);
  assert.match(out, /## 0\.2\.0 · 2026-10-20\n\n- Decodes FT4\./);
});
