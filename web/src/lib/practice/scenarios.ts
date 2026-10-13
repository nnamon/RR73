// The practice band's scenarios, as the ••• menu in Operate lists them. Each one sets how the
// stations that answer your CQ, or that you call, behave. The rest of the band carries on the same.

export type ScenarioId = 'random' | 'cq-one' | 'cq-pileup' | 'cq-quiet' | 'cq-repeat' | 'answer' | 'answer-busy' | 'answer-deaf' | 'directed' | 'hunt-busy' | 'fox';

export interface Scenario {
  id: ScenarioId;
  /** Menu name, after "Practice: ". */
  name: string;
}

export const SCENARIOS: readonly Scenario[] = [
  // Each station behaves as on a real band.
  { id: 'random', name: 'Random band' },
  // One station answers a CQ and completes the QSO.
  { id: 'cq-one', name: 'One caller' },
  // 3 to 5 stations answer a CQ at once and keep calling.
  { id: 'cq-pileup', name: 'Pile-up' },
  // The station that answers a CQ stops after the report.
  { id: 'cq-quiet', name: 'Caller goes quiet' },
  // The caller misses the first RR73 and sends the R-report again.
  { id: 'cq-repeat', name: 'Caller misses RR73' },
  // A station calling CQ answers the operator.
  { id: 'answer', name: 'Station answers' },
  // A station calling CQ works another station, ends with RR73 or 73, then answers the next call.
  { id: 'answer-busy', name: 'Station works another' },
  // A station calling CQ never answers the operator.
  { id: 'answer-deaf', name: 'Station never answers' },
  // Stations call CQ DX and CQ NA and answer only the stations they asked for.
  { id: 'directed', name: 'CQ DX and CQ NA' },
  // Many stations call CQ. Those weaker than −10 dB do not hear the operator.
  { id: 'hunt-busy', name: 'Hunt: busy band' },
  // A Fox works 3 Hounds a slot and answers the operator after a few calls at 1000 Hz or above.
  { id: 'fox', name: 'Fox (DXpedition)' },
];

export function isScenario(v: unknown): v is ScenarioId {
  return SCENARIOS.some((s) => s.id === v);
}

export function scenarioOf(id: ScenarioId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
