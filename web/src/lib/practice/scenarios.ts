// The practice band's scenarios, as the ••• menu in Operate lists them. Each one sets how the
// stations that answer your CQ, or that you call, behave. The rest of the band carries on the same.

export type ScenarioId = 'random' | 'cq-one' | 'cq-pileup' | 'cq-quiet' | 'cq-repeat' | 'answer' | 'answer-busy' | 'answer-deaf' | 'directed' | 'hunt-busy';

export interface Scenario {
  id: ScenarioId;
  /** Menu name, after "Practice: ". */
  name: string;
  /** What to do and what happens, shown when the scenario is chosen. */
  hint: string;
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'random', name: 'Random band', hint: 'Call CQ or call a station. Each one behaves as on a real band.' },
  { id: 'cq-one', name: 'One caller', hint: 'Call CQ. One station answers and completes the QSO.' },
  { id: 'cq-pileup', name: 'Pile-up', hint: 'Call CQ. 3 to 5 stations answer at once and keep calling.' },
  { id: 'cq-quiet', name: 'Caller goes quiet', hint: 'Call CQ. The station that answers stops after your report.' },
  { id: 'cq-repeat', name: 'Caller misses RR73', hint: 'Call CQ. The caller misses your first RR73 and sends his R-report again.' },
  { id: 'answer', name: 'Station answers', hint: 'Call a station calling CQ. He answers you.' },
  { id: 'answer-busy', name: 'Station works another', hint: 'Call a station calling CQ. He works another station, ends with RR73 or 73, then answers your next call.' },
  { id: 'answer-deaf', name: 'Station never answers', hint: 'Call a station calling CQ. He never answers you.' },
  { id: 'directed', name: 'CQ DX and CQ NA', hint: 'Stations call CQ DX and CQ NA. They answer only the stations they asked for.' },
  { id: 'hunt-busy', name: 'Hunt: busy band', hint: 'Start Hunt. Many stations call CQ. Those weaker than −10 dB do not hear you.' },
];

export function isScenario(v: unknown): v is ScenarioId {
  return SCENARIOS.some((s) => s.id === v);
}

export function scenarioOf(id: ScenarioId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
