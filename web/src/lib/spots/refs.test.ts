import { describe, expect, it } from 'vitest';
import { parseRefs } from './refs';

/** "POTA NZ-0008, IOTA OC-134" for a comment. */
const refs = (comment: string) =>
  parseRefs(comment)
    .map((r) => `${r.programme} ${r.ref}`)
    .join(', ');

describe('parseRefs', () => {
  it.each([
    // Recorded from the cluster on 13 October 2026.
    ['POTA NZ-0008 IOTA OC-134', 'POTA NZ-0008, IOTA OC-134'],
    ['Pota nl-0110', 'POTA NL-0110'],
    ['IOTA OC-016', 'IOTA OC-016'],
    ['Pat calling pota', ''],
    ['cq dx', ''],
    ['IN88IJ<TR>IN93GK 41 mci Pat', ''],
    ['SAT QO100 South Sudan op.Alex', ''],
    // POTA: needs the word; 4 or 5 digits.
    ['POTA US-1234', 'POTA US-1234'],
    ['#pota US-11782 FT8', 'POTA US-11782'],
    ['POTA 2-fer US-1234 US-5678', 'POTA US-1234, POTA US-5678'],
    ['POTA VK-0921 VK-0921', 'POTA VK-0921'],
    ['US-1234 FT8', ''],
    ['POTA K-TEST', ''],
    ['POTA 2026-10-13', ''],
    // SOTA: association/region-number.
    ['SOTA W7W/LC-001', 'SOTA W7W/LC-001'],
    ['vk3/vc-012 cw', 'SOTA VK3/VC-012'],
    ['JA/KN-006', 'SOTA JA/KN-006'],
    ['on G/LD-001 and GW/NW-001', 'SOTA G/LD-001, SOTA GW/NW-001'],
    ['VK3/9V1NE/VC-012', ''],
    // WWFF: prefix FF-number.
    ['WWFF VKFF-0921', 'WWFF VKFF-0921'],
    ['9MFF-0003', 'WWFF 9MFF-0003'],
    ['KFF-1234', 'WWFF KFF-1234'],
    // A WWFF reference in a POTA comment is not a park.
    ['POTA VK-0921 VKFF-0921', 'POTA VK-0921, WWFF VKFF-0921'],
    // IOTA: continent and 3 digits.
    ['NA-072', 'IOTA NA-072'],
    ['eu-005 qsl via buro', 'IOTA EU-005'],
    ['EU-1234', ''],
    ['XX-123', ''],
    // Several programmes at once.
    ['POTA US-0001 SOTA W7W/LC-001 WWFF KFF-0001 IOTA NA-001', 'POTA US-0001, SOTA W7W/LC-001, WWFF KFF-0001, IOTA NA-001'],
    ['', ''],
  ])('%j gives %j', (comment, expected) => {
    expect(refs(comment)).toBe(expected);
  });

  it('leaves names empty for a later lookup', () => {
    expect(parseRefs('POTA NZ-0008')).toEqual([{ programme: 'POTA', ref: 'NZ-0008', name: '' }]);
  });
});
