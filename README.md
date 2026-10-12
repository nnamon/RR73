# RR73

RR73 is an iPhone home-screen app for FT8 and FT4 that connects to a transceiver through the headset jack, decodes with its own Rust decoders and keeps a log that works without a connection.

Status: Phase 0. The research bench and the app shell are under construction; nothing is ready for operating yet.

## Repository

| Path | Contents |
| --- | --- |
| `crates/` | Rust: FT8 and FT4 protocol, DSP, decoder, channel simulator, corpus format, bench, WebAssembly bindings. |
| `web/` | The app: Svelte 5, TypeScript, Vite, installed from Safari to the home screen. |
| `tools/` | ft8_lib oracle, WSJT-X reference tools, KiwiSDR corpus recorder, copy lint. |
| `docs/` | Architecture, corpus format, decision records. |

## Development

Everything runs in Docker; see `AGENTS.md` for the commands and the rules for changes.

```sh
docker compose build
docker compose run --rm rust cargo test --workspace
docker compose run --rm node npm --prefix web ci
docker compose run --rm --service-ports node npm --prefix web run dev
```

## Licence

Dual licensed under the MIT licence or the Apache License 2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.

Portions of `rr73-ft8` are ported from [ft8_lib](https://github.com/kgoba/ft8_lib) by Kārlis Goba (MIT). The FT8 and FT4 protocols are described in Franke, Somerville and Taylor, "The FT4 and FT8 Communication Protocols", QEX, July/August 2020.
