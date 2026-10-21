# Desktop app

RR73 also ships as a desktop app for Windows, macOS and Linux. It is the same web build in a Tauri 2 window, with two native parts the browser cannot give: serial ports for rig control on every desktop system, and the computer's clock measured against an NTP server. The PWA and its GitHub Pages deploy are unchanged.

Phase 1 (this document) covers the shell, the serial ports, the clock and unsigned installers built by CI.

## Decision

- Tauri 2 (`tauri` 2.12, MIT or Apache-2.0) around the web build in `web/dist`, built with base `/`. The app code detects the desktop app at run time (`isDesktop()` in `web/src/lib/app/desktop.ts`: Tauri injects `__TAURI_INTERNALS__`) and keeps every browser path as it is.
- The desktop app lives in `desktop/`, a Cargo workspace of its own, so the main workspace and its CI need no WebView libraries. The parts that need no window are in `crates/rr73-desktop` in the main workspace, where `cargo test --workspace` runs them on any machine: the serial port manager (`serial.rs`) and the SNTP client (`sntp.rs`).
- Serial ports through the `serialport` crate 4.10.1 (MPL-2.0, used unmodified; THIRD_PARTY_NOTICES.md). `web/src/lib/cat/native.ts` gives them Web Serial's interfaces (`SerialApiLike`, `SerialPortLike`), so `SerialLink` and rig control run on them unchanged.
- The clock by SNTP (RFC 4330) in RR73's own code, about 100 lines with no dependency. `web/src/lib/clock/utc.ts` adds the measured offset to the system time, and slot timing, the audio clock's mapping to UTC and transmit scheduling take `utcNow()` in place of `Date.now()`.
- Installers unsigned, built by CI on every run and attached to the GitHub release on a release tag: NSIS and MSI for Windows, one universal DMG for macOS (Apple silicon and Intel), AppImage and deb for Linux.

## Reason

- Rig control in a browser needs Web Serial, which only desktop Chromium has. The desktop app gives it on macOS and Linux in WebKit, and on Windows without depending on the browser's handling of the port.
- One web build keeps one decoder, one sequencer, one log and one user interface across the phone, the browser and the desktop.
- Tauri uses the system's WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), so an installer is a few MB, and its Rust side reuses the repository's Rust toolchain.
- A desktop computer's clock is often off by a second or more, and FT8 decodes within about ±2 s. Browsers cannot send UDP, so only the desktop app can ask an NTP server.

## Serial ports

`Ports::open` (`crates/rr73-desktop/src/serial.rs`) opens the port and lowers DTR and RTS before it returns and before any write, for the same reason as the web app (`docs/design/cat.md`, Port settings): an IC-705 with USB SEND on a line of the port, and a Digirig whose PTT follows RTS, key while either is raised. The `serialport` crate opens with DTR off on Windows (its DCB sets DTR and, with no flow control, RTS disabled) and sets DTR off right after the open on Linux and macOS; `Ports::open` then lowers both lines again. The web side still calls `setSignals` with both lines low, as on Web Serial, and closes a port whose lines it cannot lower unless the link keeps it open.

Each open port has a reader thread that reads with a 50 ms timeout and sends each chunk to the web app over a Tauri channel. A read that fails or returns end of file ends the port with one `lost` event: the web side errors the readable stream and fires `disconnect`, and `SerialLink` ends the link with `lost` as on Web Serial. Writes go out in order. Close lets written bytes go out, stops the reader and closes the port.

A port another program has open is `busy` (EBUSY or a failed lock on Linux and macOS, Access is denied on Windows), shown as on Web Serial.

Web Serial's permission model is kept. Connect radio shows RR73's port chooser (`web/src/ui/PortChooser.svelte`) with the ports the system lists and their USB IDs. The chosen port is remembered on this computer (localStorage), `getPorts` gives the remembered ports that are plugged in, Disconnect radio forgets the port, and a remembered port that appears fires `connect` (the list is read every 2 s), which opens it again by itself as in the browser.

## Clock

At start and every 10 minutes (60 s after a failure) the app asks the public NTP pool 4 times, 200 ms apart, and keeps the exchange with the shortest round trip. A reply is refused when it is short, is not a server reply, has stratum 0 or above 15, reports an unsynchronised clock, or carries another originate time than the request's. A measurement with a round trip over 500 ms is not used. A usable one sets the correction that `utcNow()` adds; with none, the system time stands.

Settings › Radio and audio › Timing shows the result in the desktop app as Time server: how far the computer's clock is off, which way, and the error (half the round trip). The decode-based clock check, the Clock badge and Correct Tx timing work as before, on the corrected time.

A new measurement moves the audio clock's mapping by the change in offset. The mapping keeps the median of its last 31 observations, so it follows within about 16 audio chunks (under 1 s).

## Window and system

- Closing the window halts first (Tx off, and PTT off to a radio keyed over CAT), then the app quits after 600 ms. Without an answer from the web app it quits after 2 s.
- No service worker: the app's files come from the installed bundle, and a new version comes as a new installer.
- macOS: the bundle carries a microphone usage string, so the system asks for the microphone once.
- Linux: the app turns on WebKitGTK's media streams and Web Audio, and grants the page's microphone requests, which WebKitGTK otherwise refuses.

## Build

- Linux, locally: the `desktop` Docker service carries the Rust toolchain, Node and the GTK and WebKitGTK headers. Build the web app with base `/` (`npm --prefix web run build` in the `node` service), then run `npx tauri build --bundles deb,appimage` in `desktop/` in the `desktop` service (AGENTS.md, Tooling). The bundles land in the `cargo-target` volume under `desktop/release/bundle`.
- Windows and macOS: CI only. The `desktop-web` job builds the web app once; the `desktop` jobs build the installers on each system and keep them as `installers-Linux`, `installers-Windows` and `installers-macOS` workflow artifacts. On a `v*` tag, `desktop-publish` attaches them to the GitHub release once the tests have passed.
- The version comes from `web/package.json` (`tauri.conf.json` points at it), so a release needs no extra step.

## Alternatives rejected

- Electron: bundles Chromium, so Web Serial would work unchanged, but an installer is over 100 MB and every release ships a browser to patch.
- A browser extension or a native helper beside the PWA: two things to install and keep in step, and no answer for the clock in the browser.
- The `tauri-plugin-serialplugin` plugin: more surface than RR73 uses, and its behaviour on open (the lines) would be another project's choice. RR73's own manager is about 200 lines over `serialport`.
- An NTP crate: the SNTP exchange is small, and RR73's implementation is tested against its own packets.
- Changing the system clock: needs administrator rights. The app corrects its own time only.

## Open risks

- Unsigned installers. Windows SmartScreen warns about an unrecognised app, and macOS Gatekeeper refuses to open an app from an unidentified developer until the operator allows it (README, Desktop app). A signing certificate would remove both.
- Microphone capture in each WebView is Unverified: WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux. Not tested on a device.
- AudioWorklet timing, output timestamps and the audio clock mapping in each WebView are Unverified. The browser-specific checks in `lib/clock/mapping.ts` were measured in Chromium and Safari only.
- Rig control over native ports is Unverified with a radio: the IC-705 and the KX2 have not been connected to the desktop app. Whether the operating system raises DTR or RTS for a moment while it opens the port, before `serialport` lowers them, is Unverified on each system.
- Port loss when a cable is pulled is Unverified on each system: the reader expects a failed read or end of file. On Linux a test opens a pseudo-terminal as the radio through the same code (`desktop/src/system.rs`): bytes go both ways, and closing the other end gives `lost`.
- Fetches from the app's origin (`tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows) meet the same CORS rules as the PWA's origin, with a different origin. Services that allow only the PWA's origin refuse them. Unverified for Wavelog, PSK Reporter and the relay.
- The Linux build links the system's GTK and WebKitGTK (LGPL) and, through `serialport`, libudev (LGPL), all dynamically. The AppImage bundles GTK and WebKitGTK. No LGPL code is read or copied into the repository.
- The NTP server sees the computer's address every 10 minutes. There is no setting to turn the clock measurement off or to choose the server yet.
- macOS and Windows builds come from CI only; they have not been opened on a device. The Linux arm64 build was started under Xvfb in Docker: Operate and Settings render, Time server showed a measured offset, and Connect radio listed the container's serial ports in the port chooser.

## Phase 2

- A setting for the NTP server, and one to turn the measurement off.
- Updates: the Tauri updater with a signing key, or a notice of a newer release.
- Signing and notarisation once certificates exist.
- Playwright runs against the desktop build, and a device check on each system with an IC-705 and a KX2.
