#!/usr/bin/env node
// Version and changelog bookkeeping for releases. Runs in the node container.
//
//   node tools/release/version.mjs check             versions in sync, changelog well formed
//   node tools/release/version.mjs bump <level|x.y.z> [date]
//                                                   bumps Cargo.toml and web/package.json, turns
//                                                   "## Unreleased" into "## x.y.z · date", prints x.y.z
//   node tools/release/version.mjs notes <x.y.z>     prints that version's changelog entries

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CARGO = 'Cargo.toml';
const PKG = 'web/package.json';
const LOCK = 'web/package-lock.json';
const CHANGELOG = 'CHANGELOG.md';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const HEADING = /^## (Unreleased|(\d+\.\d+\.\d+) · (\d{4}-\d{2}-\d{2}))\s*$/;

export function cargoVersion(text) {
  const section = text.split(/^\[/m).find((s) => s.startsWith('workspace.package]'));
  const m = section && section.match(/^version = "([^"]+)"/m);
  if (!m) throw new Error('Cargo.toml has no [workspace.package] version');
  return m[1];
}

export function setCargoVersion(text, version) {
  return text.replace(/(\[workspace\.package\][^[]*?^version = ")[^"]+(")/ms, `$1${version}$2`);
}

export function nextVersion(current, level) {
  if (SEMVER.test(level)) return level;
  const [, a, b, c] = current.match(SEMVER).map(Number);
  if (level === 'major') return `${a + 1}.0.0`;
  if (level === 'minor') return `${a}.${b + 1}.0`;
  if (level === 'patch') return `${a}.${b}.${c + 1}`;
  throw new Error(`unknown bump level "${level}"; use major, minor, patch or x.y.z`);
}

/** Parses CHANGELOG.md into sections of { version, date, entries }. Unreleased has version null. */
export function parseChangelog(text) {
  const sections = [];
  for (const line of text.split('\n')) {
    const h = line.match(HEADING);
    if (h) {
      sections.push({ version: h[2] ?? null, date: h[3] ?? null, entries: [] });
    } else if (line.startsWith('- ') && sections.length) {
      sections.at(-1).entries.push(line.slice(2).trim());
    }
  }
  return sections;
}

export function release(text, version, date) {
  const sections = parseChangelog(text);
  const unreleased = sections.find((s) => s.version === null);
  if (!unreleased || unreleased.entries.length === 0) {
    throw new Error('CHANGELOG.md has no entries under "## Unreleased"; add them before releasing');
  }
  if (sections.some((s) => s.version === version)) throw new Error(`CHANGELOG.md already has ${version}`);
  return text.replace(/^## Unreleased\s*$/m, `## ${version} · ${date}`);
}

function check() {
  const cargo = cargoVersion(readFileSync(CARGO, 'utf8'));
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')).version;
  const problems = [];
  if (cargo !== pkg) problems.push(`Cargo.toml is ${cargo} but web/package.json is ${pkg}`);
  const sections = parseChangelog(readFileSync(CHANGELOG, 'utf8'));
  const released = sections.filter((s) => s.version);
  if (released.length && released[0].version !== pkg) {
    problems.push(`latest CHANGELOG.md version is ${released[0].version} but the app is ${pkg}`);
  }
  for (const s of sections) if (s.entries.length === 0 && s.version) problems.push(`${s.version} has no entries`);
  for (const p of problems) console.error(p);
  if (!problems.length) console.log(`versions in sync at ${pkg}`);
  return problems.length ? 1 : 0;
}

function bump(level, date = new Date().toISOString().slice(0, 10)) {
  const cargoText = readFileSync(CARGO, 'utf8');
  const current = cargoVersion(cargoText);
  const version = nextVersion(current, level);
  writeFileSync(CHANGELOG, release(readFileSync(CHANGELOG, 'utf8'), version, date));
  writeFileSync(CARGO, setCargoVersion(cargoText, version));
  for (const file of [PKG, LOCK]) {
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, 'utf8'));
    json.version = version;
    if (json.packages?.['']) json.packages[''].version = version;
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  console.log(version);
  return 0;
}

function notes(version) {
  const section = parseChangelog(readFileSync(CHANGELOG, 'utf8')).find((s) => s.version === version);
  if (!section) {
    console.error(`CHANGELOG.md has no ${version}`);
    return 1;
  }
  console.log(section.entries.map((e) => `- ${e}`).join('\n'));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  const run = { check, bump, notes }[cmd];
  if (!run) {
    console.error('usage: version.mjs check | bump <major|minor|patch|x.y.z> [date] | notes <x.y.z>');
    process.exit(2);
  }
  try {
    process.exit(run(...args));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
