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
| `crates/rr73-wspr` | WSPR protocol: message types 1 to 3, 50-bit packing, the 15-bit callsign hash, the K = 32 rate 1/2 convolutional code, bit-reversal interleaving, the sync vector, 4-FSK synthesis. No decoding logic. |
| `crates/rr73-dsp` | Shared DSP: FFT plans, windows, spectrogram with configurable bin and time resolution, resampling. |
| `crates/rr73-decode` | Decoder pipeline. Every stage is a trait with named implementations, selected by `DecoderConfig`. |
| `crates/rr73-chansim` | Channel simulator: AWGN at a given SNR in 2500 Hz, Watterson fading, drift, DT offsets, crowded-band scenes. |
| `crates/rr73-corpus` | Corpus format: slot WAV plus sidecar JSON, reading, writing, and decode matching and scoring. |
| `crates/rr73-bench` | Command-line bench: synthesise, run, compare. |
| `crates/rr73-wasm` | `wasm-bindgen` bindings used by the app. |
| `web/` | The app. |
| `tools/ft8lib` | ft8_lib built from a pinned commit, used as a test oracle for the codec. |
| `tools/wsjtx` | WSJT-X command-line tools (`jt9`, `ft8sim`, `wsprd`, `wsprsim`, `wsprcode`) in a container, used as the decoder and codec reference. Never linked or copied. |
| `tools/kiwi` | `rr73-kiwi`, the KiwiSDR corpus recorder. |
| `tools/lint-copy` | Copy lint for the style guide in `AGENTS.md`. |
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

### rr73-wspr

- `Message { Standard, Compound, Hashed }`: types 1, 2 and 3. `Message::parse(&str)` reads operator text (`K1ABC FN42 37`, `PJ4/K1ABC 33`, `K1ABC/P 33`, `<K1ABC> FN42AB 37`) and refuses what cannot be sent; `Display` writes the text WSJT-X shows.
- `pack(&Message) -> Result<Packed, PackError>` and `unpack(&Packed, &CallsignHashes) -> Result<Message, UnpackError>`. `Packed` holds the 28-bit callsign field and the 22-bit locator and power field.
- `code::convolve`, `code::interleave`, `code::deinterleave`, `code::SYNC`, `code::symbols(&Packed) -> [u8; 162]`, and the polynomials and branch function that decoders use.
- `synth::fsk(&symbols, centre_hz, drift_hz_per_s, sample_rate, amplitude)`: phase-continuous 4-FSK, 1.4648 Hz tone spacing, 8192 samples per symbol at 12 kHz, 110.6 s. The frequency is the signal's centre, midway between tones 1 and 2.

Every message in `fixtures/wspr/wsjtx.json` packs to the bytes and symbols WSJT-X's `wsprsim` prints (`tools/wsjtx`).

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
| `lib/app` | Routing, updates (the service worker, stale builds) and the version history. |
| `lib/state` | Settings, optional features and persistent stores in IndexedDB. |
| `ui/`, `views/` | Components and screens, styled only through `styles/tokens.css`. |

The display spectrum and the decoder's spectrogram are separate on purpose: the display favours smooth scrolling at 60 fps, the decoder favours resolution chosen per experiment.

## Timing

- Audio is captured at the context rate (48 kHz on iPhone), resampled to exactly 12 kHz in the worklet, and every chunk carries the audio-clock time of its first sample.
- The audio clock is mapped to UTC with `AudioContext.getOutputTimestamp()` and `Date.now()`, or with `currentTime` paired with `performance.now()` where output timestamps are missing or wrong. The capture worklet stamps each block from `currentFrame` and fills or restarts across render quanta it never saw. Input latency is unknown on iOS, so the receive calibration (`lib/clock/calibration.ts`) measures the residual offset from the median DT of strong decodes and moves capture stamps only; transmit scheduling never uses it.
- Transmit audio is scheduled on the audio clock for the slot edge plus 0.5 s, as in WSJT-X.

## Updates

The service worker (vite-plugin-pwa, Workbox) precaches every file of a build. A new version installs and waits; the running build keeps its own files, including the decoder worker and the WebAssembly it may still load. At the next change of screen with audio off, or on Reload app, the app sends SKIP_WAITING and reloads. Workers up to 0.5.0 do not answer the handover check in `public/sw-handover.js`, so a new worker takes over from them at once, as those builds expect. When a file of the running build fails to load and the server's index.html names another build, the app says a new version is ready and reloads at the next safe moment.

## Platform constraints

- Safari on iOS 26 is the target. No Web Serial, WebUSB, Web Bluetooth, UDP or background execution.
- GitHub Pages cannot send cross-origin isolation headers, so workers receive copies of slot audio. Shared memory waits for a measured gain.
- Every network call has an offline path. The log is the source of truth; destinations get copies.

## Licensing

- The repository is MIT OR Apache-2.0.
- ft8_lib (MIT) may be ported with attribution. ft8mon (MIT) is a source of ideas.
- GPL code (WSJT-X and its forks, JTDX, MSHV, Decodium, PyFT8, ft8ts, mfsk-core, webft8) is never read or copied. Running WSJT-X binaries as a reference is allowed.
