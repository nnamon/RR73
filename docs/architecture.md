# Architecture

RR73 has two halves that share one signal-processing core:

- **The app** (`web/`): a Svelte single-page app installed to the iPhone home screen. It captures radio audio from the headset microphone contact, shows the band, decodes, sequences QSOs, transmits through the headphone contact and keeps the log.
- **The research bench** (`crates/rr73-bench`, `tools/`): measures decoder builds against a corpus of recorded and synthetic slots, with WSJT-X's `jt9` as the reference.

The decoder and the protocol code are Rust crates. The app runs them as WebAssembly in Web Workers. The bench runs the same crates natively.

```
            radio audio (headset mic contact)
                         |
   AudioWorklet: capture, resample to 12 kHz, timestamp
                         |
        +----------------+-----------------+
        |                                  |
  waterfall worker                  slot assembler
  (display FFT, OffscreenCanvas)    (UTC-aligned 15 s / 7.5 s slots)
                                           |
                                  decoder workers (rr73-wasm)
                                           |
                       operate screen, sequencer, log, destinations
                                           |
                        encoder (rr73-wasm) -> scheduled audio out
                                           |
                        headphone contact -> radio mic input (VOX)
```

## Repository layout

| Path | Contents |
| --- | --- |
| `crates/rr73-ft8` | FT8 and FT4 protocol: message model, 77-bit packing, callsign hashes, CRC-14, LDPC (174,91) code, tone mapping, GFSK synthesis. No decoding logic. |
| `crates/rr73-dsp` | Shared DSP: FFT plans, windows, spectrogram with configurable bin and time resolution, resampling. |
| `crates/rr73-decode` | Decoder pipeline. Every stage is a trait with named implementations, selected by `DecoderConfig`. |
| `crates/rr73-chansim` | Channel simulator: AWGN at a given SNR in 2500 Hz, Watterson fading, drift, DT offsets, crowded-band scenes. |
| `crates/rr73-corpus` | Corpus format: slot WAV plus sidecar JSON, reading, writing, and decode matching and scoring. |
| `crates/rr73-bench` | Command-line bench: synthesise, run, compare. |
| `crates/rr73-wasm` | `wasm-bindgen` bindings used by the app. |
| `web/` | The app. |
| `tools/ft8lib` | ft8_lib built from a pinned commit, used as a test oracle for the codec. |
| `tools/wsjtx` | WSJT-X command-line tools (`jt9`, `ft8sim`) in a container, used as the decoder reference. Never linked or copied. |
| `tools/kiwi` | `rr73-kiwi`, the KiwiSDR corpus recorder. |
| `tools/lint-copy` | Copy lint for the style guide in `AGENTS.md`. |
| `tools/refdata` | Build-time download and conversion of the country file, LoTW, POTA and SOTA lists into `web/public/data/`. See `docs/reference-data.md`. |
| `fixtures/` | Small committed test data: codec vectors, a handful of slots for unit tests. |
| `corpus/` | The research corpus. Git-ignored. Format in `docs/corpus.md`. |
| `docs/decisions/` | Architecture decision records. |

## Crate contracts

### rr73-ft8

- `Mode { Ft8, Ft4 }` with `ModeParams` (symbol count, samples per symbol at 12 kHz, tone spacing, Costas layout, slot length).
- `Payload`: 77 bits, stored as `[u8; 10]`, most significant bit first.
- `message::Message`: one variant per i3.n3 type. `Message::parse(&str)` reads operator text; `Display` writes canonical text.
- `message::pack(&Message, &mut CallsignHashes) -> Result<Payload, PackError>` and `message::unpack(&Payload, &CallsignHashes) -> Result<Message, UnpackError>`.
- `crc::crc14`, `crc::append`, `crc::check` over the 91-bit message plus CRC.
- `ldpc::encode(&[u8; 91 bits]) -> codeword (174 bits)`, `ldpc::check(codeword) -> usize` (unsatisfied parity checks), and the sparse parity structure that decoders iterate over.
- `tones::from_payload(mode, &Payload) -> Vec<u8>` (79 tones for FT8, 105 for FT4) and the Gray maps.
- `synth::gfsk(mode, &tones, f0_hz, sample_rate, amplitude) -> Vec<f32>`: phase-continuous GFSK with the protocol's BT and ramps.

Every function is checked bit for bit against ft8_lib (`tools/ft8lib`) using vectors in `fixtures/ft8/`.

### rr73-decode

```text
SlotAudio (12 kHz f32, start time, mode)
  -> Spectrogram          (rr73-dsp)
  -> CandidateSearch      Costas sync scoring        -> Vec<Candidate>
  -> SyncRefine           time and frequency refine  -> Candidate
  -> Demodulator          symbol energies to LLRs    -> [f32; 174]
  -> LdpcDecoder          BP; OSD later              -> codeword or failure
  -> Validator            CRC, message type, plausibility
  -> Subtractor           later: rebuild and subtract, next pass
  -> Vec<Decode>
```

- `DecoderConfig` names each stage's implementation and parameters. Presets are named (`baseline`, later `osd-depth-3` and so on), so a bench run is reproducible from its name and overrides.
- `decode(&SlotAudio, &DecoderConfig, &mut DecodeContext) -> DecodeReport`. `DecodeContext` carries callsign hashes and, later, a priori information.
- `Decode` carries the message, text, frequency (base tone, Hz), DT (s), SNR (dB, 2500 Hz reference), pass number, LDPC statistics and candidate score.
- `DecodeReport` carries decodes and per-stage timings.
- No allocation in inner loops after setup. No `unsafe`. No threads inside the crate: callers parallelise across slots or candidate ranges.

### rr73-chansim

- `Scene { mode, signals: Vec<SimSignal>, noise: Noise }` with `SimSignal { message, freq_hz, dt_s, snr_db, fading: Option<Watterson>, drift_hz_per_s }`.
- `render(&Scene, seed) -> Result<(Vec<f32>, Vec<Truth>), RenderError>`. SNR follows the WSJT-X convention: signal power against noise power in 2500 Hz.

### rr73-corpus

- Reads and writes slots as described in `docs/corpus.md`.
- `match_entries(decodes, expected) -> SlotScore`, where `SlotMeta::expected` picks the truth for synthetic slots or a named reference for recorded ones. Matching is by message text, then frequency within 10 Hz and DT within 0.5 s.

### rr73-bench

- `rr73-bench synth`: writes synthetic slots with truth into the corpus.
- `rr73-bench run --preset baseline [--set key=value] <corpus paths>`: decodes every slot in parallel, writes `results/<git-sha>-<preset>.json`.
- `rr73-bench compare <a.json> <b.json>`: decodes gained and lost with file names, false decodes, SNR50 on synthetic sets, time per slot.
- `rr73-bench gate <results.json> --baseline <file>`: exits non-zero if recall drops or false decodes rise beyond the thresholds in `bench/gate.toml`. CI runs it.

## App modules (`web/src`)

| Module | Responsibility |
| --- | --- |
| `lib/audio` | AudioContext lifecycle, iOS audio session, microphone constraints and the applied-settings report, capture worklet (resample to 12 kHz, timestamps), playback scheduling. |
| `lib/clock` | UTC slot arithmetic, mapping between audio-clock time and UTC, DT-based offset correction. |
| `lib/slots` | Slot assembly from the 12 kHz stream, slot recording to WAV. |
| `lib/waterfall` | Display spectrum and rendering in a worker with OffscreenCanvas. |
| `lib/decode` | Decoder workers wrapping `rr73-wasm`. |
| `lib/qso` | The QSO sequencer: a pure state machine for answering, CQ and Run mode. See `docs/design/sequencer.md`. |
| `lib/tx` | Message encoding through `rr73-wasm`, transmit scheduling on the audio clock, Halt. |
| `lib/log` | QSO records, the delivery ledger, the outbox, destinations (Wavelog, files) and activations. See `docs/design/log.md`. |
| `lib/reference` | Country file (callsign to DXCC entity), LoTW users, POTA parks and SOTA summits, Maidenhead grids, distance and bearing. See `docs/reference-data.md`. |
| `lib/state` | Settings and persistent stores in IndexedDB. |
| `ui/`, `views/` | Components and screens, styled only through `styles/tokens.css`. |

The display spectrum and the decoder's spectrogram are separate on purpose: the display favours smooth scrolling at 60 fps, the decoder favours resolution chosen per experiment.

## Timing

- Audio is captured at the context rate (48 kHz on iPhone), resampled to exactly 12 kHz in the worklet, and every chunk carries the audio-clock time of its first sample.
- The audio clock is mapped to UTC with `AudioContext.getOutputTimestamp()` and `Date.now()`. Input latency is unknown on iOS, so the residual offset is measured from the median DT of decodes and corrected.
- Transmit audio is scheduled on the audio clock for the slot edge plus 0.5 s, as in WSJT-X.

## Platform constraints

- Safari on iOS 26 is the target. No Web Serial, WebUSB, Web Bluetooth, UDP or background execution.
- GitHub Pages cannot send cross-origin isolation headers, so workers receive copies of slot audio. Shared memory waits for a measured gain.
- Every network call has an offline path. The log is the source of truth; destinations get copies.

## Licensing

- The repository is MIT OR Apache-2.0.
- ft8_lib (MIT) may be ported with attribution. ft8mon (MIT) is a source of ideas.
- GPL code (WSJT-X and its forks, JTDX, MSHV, Decodium, PyFT8, ft8ts, mfsk-core, webft8) is never read or copied. Running WSJT-X binaries as a reference is allowed.
