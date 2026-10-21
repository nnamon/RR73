//! RR73's desktop app: the web app (`web/`) in a Tauri window, with the commands its desktop
//! paths call (docs/design/desktop.md).
//!
//! - `serial_*`: the serial ports for rig control, on the `serialport` crate through
//!   [`rr73_desktop::serial::Ports`]. The web app reaches them through `web/src/lib/cat/native.ts`,
//!   which gives them Web Serial's shape.
//! - `clock_offset`: the system clock's offset from an NTP server ([`rr73_desktop::sntp`]),
//!   which `web/src/lib/clock/utc.ts` adds to the system time.
//! - Closing the window first asks the web app to Halt, so a radio keyed over CAT gets PTT off
//!   before the ports close.

mod system;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rr73_desktop::serial::{Event, OpenError, Opened, PortError, PortInfo, PortSettings, Ports};
use rr73_desktop::sntp::{self, Sample};
use tauri::ipc::Channel;
use tauri::{Emitter, Manager, State, WindowEvent};

use system::SystemPorts;

/// The NTP server asked when the web app names none.
const NTP_SERVER: &str = "pool.ntp.org";
/// Exchanges per measurement; the one with the shortest delay counts.
const NTP_TRIES: usize = 4;
/// Wait for each reply.
const NTP_TIMEOUT: Duration = Duration::from_millis(1500);
/// Pause between exchanges.
const NTP_GAP: Duration = Duration::from_millis(200);
/// Longest the window waits for the web app's Halt before it closes anyway.
const CLOSE_WAIT: Duration = Duration::from_millis(2000);

struct AppState {
    ports: Ports<SystemPorts>,
    closing: AtomicBool,
}

#[tauri::command]
fn serial_list(state: State<'_, AppState>) -> Result<Vec<PortInfo>, PortError> {
    state.ports.list()
}

#[tauri::command]
async fn serial_open(
    state: State<'_, AppState>,
    name: String,
    settings: PortSettings,
    events: Channel<Event>,
) -> Result<Opened, OpenError> {
    state
        .ports
        .open(&name, &settings, Box::new(move |e| drop(events.send(e))))
}

#[tauri::command]
async fn serial_write(state: State<'_, AppState>, id: u32, bytes: Vec<u8>) -> Result<(), PortError> {
    state.ports.write(id, &bytes)
}

#[tauri::command]
fn serial_lines(
    state: State<'_, AppState>,
    id: u32,
    dtr: Option<bool>,
    rts: Option<bool>,
) -> Result<(), PortError> {
    state.ports.set_lines(id, dtr, rts)
}

#[tauri::command]
async fn serial_close(state: State<'_, AppState>, id: u32) -> Result<(), PortError> {
    state.ports.close(id);
    Ok(())
}

#[tauri::command]
async fn clock_offset(server: Option<String>) -> Result<Sample, String> {
    let server = server
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| NTP_SERVER.to_owned());
    tauri::async_runtime::spawn_blocking(move || sntp::measure(&server, NTP_TRIES, NTP_TIMEOUT, NTP_GAP))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The web app has halted after `rr73://close`: the ports close and the app exits.
#[tauri::command]
fn app_quit(app: tauri::AppHandle, state: State<'_, AppState>) {
    state.ports.close_all();
    app.exit(0);
}

/// Lets the WebKitGTK view capture audio: media streams are off by default there, and a
/// permission request nobody answers is refused.
#[cfg(target_os = "linux")]
fn allow_media(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::ObjectExt;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    let _ = window.with_webview(|wv| {
        let view = wv.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_webaudio(true);
        }
        view.connect_permission_request(|_, request| {
            if request.is::<UserMediaPermissionRequest>() {
                request.allow();
                true
            } else {
                false
            }
        });
    });
}

/// Runs the app.
pub fn run() {
    let result = tauri::Builder::default()
        .manage(AppState {
            ports: Ports::new(SystemPorts),
            closing: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            serial_list,
            serial_open,
            serial_write,
            serial_lines,
            serial_close,
            clock_offset,
            app_quit
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(w) = app.get_webview_window("main") {
                allow_media(&w);
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let app = window.app_handle().clone();
            let state = app.state::<AppState>();
            if state.closing.swap(true, Ordering::AcqRel) {
                // A second close while waiting: close at once.
                state.ports.close_all();
                return;
            }
            api.prevent_close();
            // The web app halts (PTT off over CAT) and calls app_quit; without an answer the app
            // closes after CLOSE_WAIT.
            let _ = app.emit("rr73://close", ());
            std::thread::spawn(move || {
                std::thread::sleep(CLOSE_WAIT);
                app.state::<AppState>().ports.close_all();
                app.exit(0);
            });
        })
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("RR73 did not start: {e}");
        std::process::exit(1);
    }
}
