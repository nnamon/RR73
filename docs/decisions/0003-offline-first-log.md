# 0003. Offline-first log with destinations

Status: accepted, 2026-10-13

## Context

SOTA and POTA activations often have no phone signal. Wavelog is optional, and other logging services may follow.

## Decision

The log in IndexedDB is the record. Each destination (Wavelog, ADIF, POTA, SOTA, WWFF files, later relay-backed services) is an adapter with a transport: direct, relay or file. A delivery ledger holds one state per QSO and destination: waiting, delivered, refused, changed, file ready, submitted, not needed.

## Consequences

- Adding a destination means writing one adapter.
- The Log and Activation screens can always say what was delivered where.
