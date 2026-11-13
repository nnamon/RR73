# Practice band

The practice band lets you try RR73 with no radio, on a simulated band of FT8, FT4, LQ8 and RTTY stations. Turn on Practice band in Settings › Practice band, and Operate shows a Practice badge while it runs. Call CQ, call stations and Hunt as you would on the air.

## Scenarios

![The Practice scenario sheet](img/practice-scenario.webp)

Practice scenario, in ••• on Operate, sets how the stations you work behave while the rest of the band carries on as before.

| Scenario | Stations |
| --- | --- |
| Random band, the default | Each behaves as on a real band |
| One caller | 1 answers a CQ and completes the QSO |
| Pile-up | 3 to 5 answer a CQ at once and keep calling |
| Caller goes quiet | The caller stops after the report |
| Caller misses RR73 | The caller sends the R-report again |
| Activation callers | 1 answers each CQ, and another tail-ends most QSOs |
| Weak and crowded | 1 to 3 callers near −22 dB in raised noise |
| Station answers | A station calling CQ answers you |
| Station works another | A station works another, then answers the next call |
| Station answers someone else | The station you call answers another caller each time |
| Station never answers | A station calling CQ never answers you |
| CQ DX and CQ NA | They answer only the stations they asked for |
| Hunt: busy band | Many CQs, and the stations weaker than −10 dB don't hear you |
| Hunt: a station calls you | The station you call stays silent and another calls you |
| Contest exchanges | CQ FD, CQ RU and CQ TEST, with callers in each format |
| Worked stations | The practice log gets earlier QSOs with stations on the band |
| New ones | CQs from DXCC entities, zones and grids not in the practice log |
| Clock off | Every station is 1.5 s early or late |
| Fox (DXpedition) | A Fox works 3 Hounds a slot. Turn on Hound to work it |

In LQ8 the stations run LQ8's 4-message QSO. Contest exchanges and Fox are FT8 and FT4 only. Caller misses RR73 becomes Caller misses R-report, where the caller calls again after your first R-report.

## Tx audio and the radio

Play Tx audio, on by default, plays practice transmissions and keys a connected radio. Turn it off to keep the radio silent and unkeyed.

## The practice log

Practice QSOs go to the practice log, which Log shows while the practice band is on. Clear practice log, in Settings › Practice band, empties it and offers Undo. While the practice band is on, Wavelog reads, PSK Reporter reports and Web SDR pause, and backup and import wait until you turn it off.
