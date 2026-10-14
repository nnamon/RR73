import { describe, expect, it } from 'vitest';
import { beaconMessages, readMessage } from './message';

describe('beacon messages', () => {
  it('sends a standard callsign as one Type 1 message with the first 4 characters of the grid', () => {
    expect(beaconMessages('9V1NE', 'OJ11vi', 37)).toEqual({ ok: true, texts: ['9V1NE OJ11 37'] });
    expect(beaconMessages('k1abc', 'fn42', 23)).toEqual({ ok: true, texts: ['K1ABC FN42 23'] });
  });

  it('alternates Type 2 and Type 3 for a compound callsign with a 6-character grid', () => {
    expect(beaconMessages('9V1NE/P', 'OJ11vi', 37)).toEqual({ ok: true, texts: ['9V1NE/P 37', '<9V1NE/P> OJ11VI 37'] });
    expect(beaconMessages('PJ4/K1ABC', 'FK52ud', 33)).toEqual({ ok: true, texts: ['PJ4/K1ABC 33', '<PJ4/K1ABC> FK52UD 33'] });
  });

  it('sends only Type 2 for a compound callsign with a 4-character grid', () => {
    expect(beaconMessages('9V1NE/P', 'OJ11', 37)).toEqual({ ok: true, texts: ['9V1NE/P 37'] });
  });

  it('needs the callsign and the grid', () => {
    expect(beaconMessages('', '', 37)).toEqual({ ok: false, error: 'Callsign and grid not set' });
    expect(beaconMessages('9V1NE', '', 37)).toEqual({ ok: false, error: 'Grid not set' });
    expect(beaconMessages('', 'OJ11', 37)).toEqual({ ok: false, error: 'Callsign not set' });
  });
});

describe('decoded WSPR text', () => {
  it('reads the three message types', () => {
    expect(readMessage('K1ABC FN42 37')).toEqual({ call: 'K1ABC', grid: 'FN42', powerDbm: 37, msgType: 1 });
    expect(readMessage('PJ4/K1ABC 33')).toEqual({ call: 'PJ4/K1ABC', grid: null, powerDbm: 33, msgType: 2 });
    expect(readMessage('K1ABC/P 37')).toEqual({ call: 'K1ABC/P', grid: null, powerDbm: 37, msgType: 2 });
    expect(readMessage('<PJ4/K1ABC> FK52UD 33')).toEqual({ call: 'PJ4/K1ABC', grid: 'FK52ud', powerDbm: 33, msgType: 3 });
  });

  it('leaves an unresolved hash without a callsign', () => {
    expect(readMessage('<...> FK52UD 33')).toEqual({ call: null, grid: 'FK52ud', powerDbm: 33, msgType: 3 });
  });
});
