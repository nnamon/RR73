import { describe, expect, it } from 'vitest';
import { DxccIndex } from '../reference';
import { bigCtyFixture } from '../reference/testing';
import { cqCountry } from './country';
import { markDecode } from './marking';

const countries = DxccIndex.fromJson(bigCtyFixture());
const MY = '9V1NE';

/** The country a decode's row shows, as the list marks it for the operator 9V1NE. */
const shown = (text: string, sent = false) => cqCountry(markDecode({ text, snr_db: -11, dt_s: 0.1, freq_hz: 763 }, MY, sent), countries);

describe('the country on a CQ row', () => {
  it.each([
    ['CQ VK2LAW QF56', 'Australia'],
    ['CQ DX YB3MAZ OI62', 'Indonesia'],
    ['CQ POTA K1ABC FN42', 'United States'],
    ['CQ NA JA1XYZ PM95', 'Japan'],
    // Portable: a prefix before the home call is where the station is.
    ['CQ VK3/9V1AB', 'Australia'],
    ['CQ 9V1AB/VK3', 'Australia'],
    ['CQ F/G3ABC JN18', 'France'],
    // /P and other designators after the call leave it at home.
    ['CQ G3ABC/P IO91', 'England'],
    ['CQ 9V1AB/QRP', 'Singapore'],
    // A call area after the home call: K1ABC/6 operates from K6.
    ['CQ K1ABC/6', 'United States'],
    // WAE entities show their DXCC entity: Sicily is Italy, Shetland is Scotland.
    ['CQ IT9ABC JM77', 'Italy'],
    ['CQ GM3ZET IP90', 'Scotland'],
    ['CQ TA1ABC KN41', 'Turkey'],
    // Short names for the long official ones.
    ['CQ DL1ABC JO62', 'Germany'],
    ['CQ HL2ABC PM37', 'South Korea'],
    ['CQ 9Q1AB JI75', 'DR Congo'],
    // An exact callsign in the country file wins.
    ['CQ 3D2AG/P RG78', 'Rotuma Island'],
    ['CQ ZS8ABC KE83', 'Marion Island'],
    // A hashed callsign whose full form is known.
    ['CQ <VK2LAW> QF56', 'Australia'],
  ])('%s shows %s', (text, country) => {
    expect(shown(text)).toBe(country);
  });

  it('shows none for maritime and aeronautical mobile, unknown prefixes and unknown hashes', () => {
    expect(shown('CQ VK2LAW/MM')).toBeNull();
    expect(shown('CQ K1ABC/AM')).toBeNull();
    expect(shown('CQ Q1ABC JO01')).toBeNull();
    expect(shown('CQ <...> QF56')).toBeNull();
  });

  it('shows none on rows that are not a CQ', () => {
    expect(shown('VK2LAW 9V1NE QF56')).toBeNull();
    expect(shown('JA1XYZ VK2LAW -09')).toBeNull();
    expect(shown('JA1XYZ VK2LAW RR73')).toBeNull();
    // A CQ that names my callsign is marked to me; my own CQ is marked sent.
    expect(shown('CQ 9V1NE OJ11')).toBeNull();
    expect(shown('CQ 9V1NE OJ11', true)).toBeNull();
  });

  it('shows none before the country file has loaded', () => {
    expect(cqCountry(markDecode({ text: 'CQ VK2LAW QF56', snr_db: -11, dt_s: 0.1, freq_hz: 763 }, MY), null)).toBeNull();
  });
});
