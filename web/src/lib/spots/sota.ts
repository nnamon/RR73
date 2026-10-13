/**
 * SOTA spots are not implemented. This stub holds SOTA's place in the source list: it is not
 * registered with the feed, makes no requests and returns no spots. SOTA references in DX
 * cluster comments reach the list through the HamQTH source.
 */

import type { SpotSource } from './types';

export const sotaSource: SpotSource = {
  id: 'sota',
  name: 'SOTA',
  classes: ['SOTA'],
  credit: null,
  fetch: () => Promise.resolve([]),
};
