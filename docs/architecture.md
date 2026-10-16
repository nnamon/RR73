# Architecture

RR73 has two halves that share one signal-processing core:

- **The app** (`web/`): a Svelte single-page app installed to the iPhone home screen. It captures radio audio from the headset microphone contact, shows the band, decodes, sequences QSOs, transmits through the headphone contact and keeps the log.
- **The research bench** (`crates/rr73-bench`, `tools/`): measures decoder builds against a corpus of recorded and synthetic slots, with WSJT-X's `jt9` as the reference.
- **The relay** (`crates/rr73-qsp`): QSP, an optional server for the services a web page cannot reach directly. It carries web SDR receive and reports to PSK Reporter. See `docs/design/qsp.md`.

The decoder and the protocol code are Rust crates. The app runs them as WebAssembly in Web Workers. The bench runs the same crates natively.

```
            radio audio (headset mic contact)
                         |
   AudioWorklet: capture, resample to 12 kHz, timestamp
                         |
        +----------------+-----------------+
        |                                  |
  waterfall worker                  slot assembler
  (display FFT, OffscreenCanvas)    (UTC-aligned 15 s / 7.5 s / 120 s slots)
                                           |
                                  decoder workers (rr73-wasm)
                                           |
                       operate screen, sequencer, log, destinations
                                           |
                        encoder (rr73-wasm) -> scheduled audio out
                                           |
                        headphone contact -> radio mic input (VOX)
                        or USB audio, PTT over CI-V or Elecraft CAT (desktop Chromium)
```

## Repository layout

| Path | Contents |
| --- | --- |
| `crates/rr73-ft8` | FT8 and FT4 protocol: message model, 77-bit packing, callsign hashes, CRC-14, LDPC (174,91) code, tone mapping, GFSK synthesis. No decoding logic. |
| `crates/rr73-wspr` | WSPR protocol: message types 1 to 3, 50-bit packing, the 15-bit callsign hash, the K = 32 rate 1/2 convolutional code, bit-reversal interleaving, the sync vector, 4-FSK synthesis. No decoding logic. |
| `crates/rr73-dsp` | Shared DSP: FFT plans, windows, spectrogram with configurable bin and time resolution, resampling. |
| `crates/rr73-decode` | Decoder pipeline. Every stage is a trait with named implementations, selected by `DecoderConfig`. |
| `crates/rr73-rtty` | RTTY: the ITA2 code with US and ITA2 figures, the continuous-phase AFSK encoder and the streaming decoder. See `docs/experiments/0005-rtty.md`. |
| `crates/rr73-chansim` | Channel simulator: AWGN at a given SNR in 2500 Hz, Watterson fading, drift, DT offsets, crowded-band scenes; continuous signals with the SNR in 3000 Hz. |
| `crates/rr73-corpus` | Corpus format: slot WAV plus sidecar JSON, reading, writing, and decode matching and scoring. |
| `crates/rr73-bench` | Command-line bench: synthesise, run, compare. |
| `crates/rr73-wasm` | `wasm-bindgen` bindings used by the app; `rtty` holds the streaming RTTY receiver and the transmitter, `cat` the CI-V requests and the parser of the radio's bytes, `cat_kx2` the same for the KX2's text commands. |
| `crates/rr73-cat` | Rig control: CI-V frames and the IC-705 commands RR73 uses, and Elecraft's text commands for the KX2, as typed requests and events; a simulated IC-705 and a simulated KX2 behind a Digirig for tests. See `docs/design/cat.md`. |
| `crates/rr73-qsp` | QSP, the relay: the KiwiSDR client, the clock that stamps each frame with UTC, the HTTP API with `/docs`, and the audio stream over WebSocket. Runs on a server, never in the app. |
| `web/` | The app. |
| `tools/ft8lib` | ft8_lib built from a pinned commit, used as a test oracle for the codec. |
| `tools/wsjtx` | WSJT-X command-line tools (`jt9`, `ft8sim`, `wsprd`, `wsprsim`, `wsprcode`) in a container, used as the decoder and codec reference. Never linked or copied. |
| `tools/kiwi` | `rr73-kiwi`, the KiwiSDR corpus recorder. |
| `tools/minimodem` | minimodem in a container, the reference RTTY decoder for `rr73-bench rtty`. Never linked or copied. |
| `tools/wasm-cost` | Cost of the WebAssembly exports per second of audio in headless Chromium and WebKit. |
| `tools/lint-copy` | Copy lint for the style guide in `AGENTS.md`. |
| `tools/refdata` | Build-time conversion of the country file and download and conversion of the POTA and SOTA lists into `web/public/data/`, and the Big CTY update command. See `docs/reference-data.md`. |
| `refdata/bigcty` | The Big CTY release the app ships as its country file (MIT licence). |
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
  -> LdpcDecoder          BP, then OSD               -> codeword or failure
  -> Validator            CRC, message type, plausibility
  -> Subtractor           rebuild and subtract, next pass
  -> Vec<Decode>
```

WSPR has its own pipeline in `rr73_decode::wspr`, with stage traits of the same pattern:

```text
120 s of 12 kHz audio
  -> Downconverter       one FFT, 375 Hz complex baseband around 1500 Hz
  -> SymbolSpectrogram   one-symbol window, quarter-symbol hop
  -> WsprSearch          sync correlation over frequency, start and drift -> candidates
  -> WsprRefine          start, frequency and drift from block phase coherence
  -> WsprDemod           multi-symbol noncoherent detection             -> [f32; 162]
  -> SequentialDecoder   Fano algorithm over the K = 32 code            -> 81 bits
  -> WsprValidator       unpack, callsign layout, re-encoding, SNR
  -> WsprReport
```

`decode_wspr(&samples, &WsprConfig, &mut WsprContext) -> WsprReport`. `WsprContext` carries the type 3 callsign hash table. `WsprDecode` carries the text, the signal centre (Hz), DT from 1 s into the slot (s), drift (Hz/s), SNR (dB, 2500 Hz), sync score, Fano steps and hard errors.

- `DecoderConfig` names each stage's implementation and parameters. Presets are named (`baseline`, `subtract-3-osd2` and so on), so a bench run is reproducible from its name and overrides.
- `decode(&SlotAudio, &DecoderConfig, &mut DecodeContext) -> DecodeReport`. `DecodeContext` carries callsign hashes and the QSO under way for a priori decoding (decision 0009).
- `SlotAudio::partial` marks the start of a slot still being received (early decoding): symbols after the last sample count as erasures. The app's early pass uses it (experiment 0006).
- `DecodeSession` decodes one slot in stages, each a `DecoderConfig` run on the residual of every earlier decode and returning only new decodes. `step()` does one bounded unit of work (16 spectrogram frames, 4 search frames, 4 candidates or 1 subtraction; with the block demodulator, one slot transform per pass and 4 sets of soft bits, at least one candidate), `next_stage()` runs a stage to its end. `decode` is a one-stage session.
- `demod.kind=block` (`block.rs`, experiment 0008) transforms each pass's residual once, cuts each candidate's band to a complex baseband, refines its start and frequency from the sync symbols, and gives soft bits from noncoherent detection of blocks of 1 to 4 symbols. The session runs it as a `baseband` step per pass and tries one set of soft bits per block length.
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
| `lib/audio` | AudioContext lifecycle, iOS audio session, input sources (the microphone or the practice band), microphone constraints and the applied-settings report, capture worklet (resample to 12 kHz, timestamps), playback scheduling, and the output device in Chromium (`sink.ts`). |
| `lib/clock` | UTC slot arithmetic, mapping between audio-clock time and UTC, DT-based offset correction, and the wake timers that keep transmit timing in a hidden page (`wake.ts`, decision 0010). |
| `lib/slots` | Slot assembly from the 12 kHz stream, slot recording to WAV. |
| `lib/waterfall` | Display spectrum and rendering in a worker with OffscreenCanvas; the callsign labels over FT8 and FT4 signals (`calls.ts`), placed on the page from the slot lines the worker reports. |
| `lib/decode` | Decoder workers wrapping `rr73-wasm`. An FT8 or FT4 slot is decoded with the shipped preset and its decodes go to the list and the sequencer at once; the worker then runs the later stages (`DEEP` in `worker-client.ts`) as a `DecoderSession` in slices of at most 40 ms, answering encoder requests between slices, and adds what they find to the slot in the list and passes it to the sequencer as a later pass of the slot. They stop when done, 2 s after the slot's decoding started, or when the next slot arrives (`docs/decisions/0007-deeper-ft8-stages.md`). |
| `lib/qso` | The QSO sequencer: a pure state machine for answering, CQ, Run and Hunt. See `docs/design/sequencer.md`. |
| `lib/wspr` | WSPR's pure parts: the beacon schedule, its messages, spots (distance, sorting, drift) and the rows of Operate's spot list. The runtime that drives them is `lib/state/wspr.svelte.ts`. See `docs/design/wspr.md`. |
| `lib/spots` | Spots from the POTA API and HamQTH's DX cluster feed: one spot model, the sources, merging, the filters, the feed that polls while Spots is shown, and what the log says about a spot (New park, Worked today). Go and the chase live in `lib/state/spots.svelte.ts`. See `docs/design/spots.md`. |
| `lib/tx` | Message encoding through `rr73-wasm`, transmit scheduling on the audio clock, Halt. |
| `lib/cat` | Rig control: one serial port over Web Serial (`serial.ts`: open with DTR and RTS lowered, the read loop, ordered writes, close, and `lost` when the port goes), the CI-V and Elecraft JSON, their codecs and the main-thread `rr73-wasm` loader (`protocol.ts`), what differs between the IC-705 and the KX2 (`radios.ts`), one radio on the link (`radio.ts`: the request queue and its timeouts, polling, transceive, PTT with confirmed PTT off, the dial shift around a keying), and the shift's arithmetic for Keep Tx audio centred (`passband.ts`). The keyer interface the transmit paths use is `lib/tx/keyer.ts`. Connect radio, Test keying and the dial set from the band sheet live in `lib/state/cat.svelte.ts`; the radio's state, the dial in use and the keyer for transmissions in `lib/state/radio.svelte.ts`. See `docs/design/cat.md`. |
| `lib/keyboard` | The keyboard modes' engine, mode-agnostic (RTTY first, then PSK31, Olivia and the rest): the modem interface, the keyboard worker that holds the modem, the stream worklet and the pump that feeds it 0.3 s ahead, the send queue, macros and their fields, the received text, words and the other-case reading, the QSO strip's draft and its log record, and the session that ties them together (`session.svelte.ts`). The runtime that drives them is `lib/state/keyboard.svelte.ts`. See `docs/design/rtty.md`. |
| `lib/rtty` | RTTY's modem over `rr73-wasm`'s `RttyReceiver` and `RttyTransmitter`, its settings and their mapping to the crate's configs, and its dial per band. |
| `lib/practice` | The practice band: simulated stations and scenarios, slot audio fed to capture as an input source, RTTY stations whose transmissions play as they fall due, the Wavelog stand-in and the network guard. See `docs/design/practice-band.md`. |
| `lib/relay` | The QSP client: the API calls, the stream's frame decoder, and the web SDR as a capture input source. Each frame plays 1.5 s after its UTC, and the source subtracts that delay from capture's timestamps. The relays and the switch live in `lib/state/relay.svelte.ts`. See `docs/design/qsp.md`. |
| `lib/pskreporter` | PSK Reporter: the senders in a slot's decodes as spots, the queue that sends them to the relay at most once a minute, and who heard you from the MQTT feed (a subscribe-only MQTT client and the feed's spot parser). The switches live in `lib/state/pskreporter.svelte.ts` and `lib/state/heard.svelte.ts`. See `docs/design/qsp.md`. |
| `lib/wsprnet` | WSPR spots to WSPRnet, straight from the phone: the form-encoded records as WSJT-X sends them, and the queue that sends them 0 to 20 s after each slot, 200 ms apart. The switch lives in `lib/state/wsprnet.svelte.ts`. See `docs/design/qsp.md`, WSPRnet. |
| `lib/log` | QSO records, the delivery ledger, the outbox, destinations (Wavelog, files) and activations, and Read Wavelog's log, which lays the QSOs in Wavelog over the log for decode colours only. See `docs/design/log.md` and `docs/design/wavelog-worked.md`. |
| `lib/reference` | Country file (callsign to DXCC entity), POTA parks and SOTA summits, Maidenhead grids, distance and bearing. See `docs/reference-data.md`. |
| `lib/app` | Routing, updates (the service worker, stale builds), the version history, the credits (`notices.ts`, from `THIRD_PARTY_NOTICES.md`), the size classes (`layout.svelte.ts`: compact, compact height, regular) and the keyboard shortcuts (`shortcuts.ts`). See `docs/decisions/0008-large-screens.md`. |
| `lib/state` | Settings, optional features and persistent stores in IndexedDB. |
| `ui/`, `views/` | Components and screens, styled only through `styles/tokens.css`. Operate keeps one frame for every mode; each mode family brings its middle and bottom bar as a pane (`views/operate/panes.ts`), as two parts the frame places by size class: FT8 and FT4, WSPR, and the keyboard modes (`KeyboardPane`, with RTTY's tuning row). |

The display spectrum and the decoder's spectrogram are separate on purpose: the display favours smooth scrolling at 60 fps, the decoder favours resolution chosen per experiment.

## Timing

- Audio is captured at the context rate (48 kHz on iPhone), resampled to exactly 12 kHz in the worklet, and every chunk carries the audio-clock time of its first sample.
- The slot assembler hands the first 13.5 s of each FT8 slot and the first 6 s of each FT4 slot to an early decoding pass while the slot is still being received; the whole slot follows at its end, and its decodes join the early pass's (experiment 0006).
- The audio clock is mapped to UTC with `AudioContext.getOutputTimestamp()` and `Date.now()`, or with `currentTime` paired with `performance.now()` where output timestamps are missing or wrong. The capture worklet stamps each block from `currentFrame` and fills or restarts across render quanta it never saw. Input latency is unknown on iOS, so the receive calibration (`lib/clock/calibration.ts`) measures the residual offset from the median DT of strong decodes and moves capture stamps only; transmit scheduling never uses it. The same median measures the phone's clock: from 1 s off (off again below 0.8 s) a Clock badge in the top bar and a status line notice say so, and Settings › Radio and audio › Timing gives the effect on the air and the fix.
- Transmit audio is scheduled on the audio clock for the slot edge plus 0.5 s (FT8, FT4) or 1 s (WSPR), as in WSJT-X. The wait until 0.5 s before it, and the 1 s ticks that hand over transmissions, run on wake timers, which a dedicated worker keeps on time while Chromium throttles a hidden page's timers (`lib/clock/wake.ts`). With rig control keying the radio, PTT goes on 0.5 s before the audio and the audio waits for the radio's OK, so it still starts on time (`docs/design/cat.md`, Transmit).
- RTTY has no slots: a transmission starts at once and streams. The keyboard worker renders 0.1 s blocks to the stream worklet over a MessageChannel, 0.3 s ahead of the audio thread; the app hands the transmitter at most 0.4 s of text. Capture skips the slot assembler and goes to the keyboard worker, except while on air.

## Updates

The service worker (vite-plugin-pwa, Workbox) precaches every file of a build. A new version installs and waits; the running build keeps its own files, including the decoder worker and the WebAssembly it may still load. At the next change of screen with audio off, or on Reload app, the app sends SKIP_WAITING and reloads. Workers up to 0.5.0 do not answer the handover check in `public/sw-handover.js`, so a new worker takes over from them at once, as those builds expect. When a file of the running build fails to load and the server's index.html names another build, the app says a new version is ready and reloads at the next safe moment.

## Platform constraints

- Safari on iOS 26 is the target. No Web Serial, WebUSB, Web Bluetooth, UDP or background execution.
- Desktop Chrome and Edge add Web Serial, which rig control uses (`docs/design/cat.md`). The rig control settings show only where it exists.
- Desktop Chrome and Edge keep capture running in a hidden page: RR73 receives, decodes and transmits there with its window minimised, covered or in a background tab. Elsewhere hiding stops capture and Tx, as on iOS (`docs/decisions/0010-hidden-window.md`).
- GitHub Pages cannot send cross-origin isolation headers, so workers receive copies of slot audio. Shared memory waits for a measured gain.
- Every network call has an offline path. The log is the source of truth; destinations get copies.

## Licensing

- The repository is MIT OR Apache-2.0.
- ft8_lib (MIT) may be ported with attribution. ft8mon (MIT) is a source of ideas.
- GPL code (WSJT-X and its forks, JTDX, MSHV, Decodium, PyFT8, ft8ts, mfsk-core, webft8) is never read or copied. Running WSJT-X binaries as a reference is allowed.
