// The log's interface for the rest of the app.
//
// Sequencer wiring: on its logQso(record) effect, call `logQso(record)`. It stores the QSO,
// queues it for every destination (held 10 s for Undo) and shows "Logged … · Edit · Undo".
// `undoQso(id)` removes a QSO and `addQso(record)` logs one without the notice.

export { addQso, loadLog, log, logQso, showLogged, undoQso } from './log.svelte';
export type { LogQsoRecord, Qso, Reference } from './types';
