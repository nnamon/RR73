/**
 * Destination adapters, as docs/design/log.md defines them: each destination is one adapter with
 * a transport. Direct (and later relay) adapters send; file adapters make files. The outbox, the
 * ledger and the screens stay the same when one is added.
 */

import { buildPartFile } from './files';
import type { Receipt } from './ledger';
import type { Activation, DestinationId, DestinationKind, FileDestinationId, Qso, Transport, WavelogConfig } from './types';
import { testConnection, wavelogDestination, type FetchLike } from './wavelog';

/** Reachable, the key valid, and allowed to write; `message` in plain words. */
export interface Health {
  ok: boolean;
  message: string;
}

/** One file: its ledger key (pota|VK-0921|20261013 and so on) and the activation it belongs to. */
export interface FileScope {
  key: string;
  activation: Activation;
}

export interface LogDestination {
  id: DestinationId;
  kind: DestinationKind;
  transport: Transport;
  test(): Promise<Health>;
  send?(qsos: Qso[]): Promise<Receipt[]>;
  makeFile?(qsos: Qso[], scope: FileScope): Promise<File>;
}

export function wavelogAdapter(cfg: WavelogConfig, stationFor: (q: Qso) => string | null, fetchFn: FetchLike, now: () => number, retrying: () => boolean = () => true): LogDestination {
  const direct = wavelogDestination(cfg, stationFor, fetchFn, retrying);
  return {
    id: 'wavelog',
    kind: 'wavelog',
    transport: 'direct',
    async test() {
      const r = await testConnection(cfg, fetchFn, now());
      return { ok: r.ok, message: r.message };
    },
    send: (qsos) => direct.send(qsos),
  };
}

/** POTA, SOTA, WWFF and ADIF files. A file needs no connection, so its test always passes. */
export function fileAdapter(id: FileDestinationId, programVersion: string, now: () => number): LogDestination {
  return {
    id,
    kind: id,
    transport: 'file',
    test: async () => ({ ok: true, message: 'Made on this phone' }),
    async makeFile(qsos, scope) {
      const f = buildPartFile(scope.key, qsos, scope.activation, { programVersion, now: now() });
      if (!f) throw new Error(`No QSOs in ${scope.key}`);
      return new File([f.text], f.name, { type: 'text/plain' });
    },
  };
}
