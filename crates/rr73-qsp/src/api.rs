//! QSP's HTTP API (docs/design/qsp.md, The API). The OpenAPI document behind `/docs` is built
//! from the same handlers and types, so the page cannot drift from them.

use crate::config::{Config, ReceiverConfig, ReceiverKind};
use crate::frame::{self, AdpcmState, Encoding, FrameHead};
use crate::kiwi::{Control, Event, Target};
use crate::pskreporter::{Reporter, Rules, Spot, Station};
use crate::upstream::Upstreams;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, Query, Request, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use utoipa::{OpenApi, ToSchema};

/// How long a session waits for its stream before it is dropped.
const TICKET_LIFE: Duration = Duration::from_secs(60);
/// How long an ended session stays readable.
const ENDED_LIFE: Duration = Duration::from_secs(300);
/// Highest dial frequency a KiwiSDR covers, Hz.
const MAX_DIAL_HZ: u64 = 30_000_000;

/// The shared state of a running instance.
#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    limiter: Arc<Mutex<HashMap<String, (u64, u32)>>>,
    reporter: Arc<Mutex<Reporter>>,
    upstreams: Upstreams,
    started: Instant,
}

impl AppState {
    /// State for an instance with these settings.
    pub fn new(config: Config) -> Self {
        AppState {
            sessions: Arc::default(),
            limiter: Arc::default(),
            reporter: Arc::new(Mutex::new(Reporter::new(Rules {
                interval_s: config.pskreporter.interval_s,
                test: config.pskreporter.test,
            }))),
            config: Arc::new(config),
            upstreams: Upstreams::default(),
            started: Instant::now(),
        }
    }

    /// The PSK Reporter streams, for the task that sends their datagrams.
    pub fn reporter(&self) -> Arc<Mutex<Reporter>> {
        self.reporter.clone()
    }

    /// Drops sessions that never opened their stream, and ended ones after a while.
    pub fn sweep(&self) {
        let mut s = lock(&self.sessions);
        s.retain(|_, v| match &v.state {
            SessionState::Waiting => v.created.elapsed() < TICKET_LIFE,
            SessionState::Streaming => true,
            SessionState::Ended { at, .. } => at.elapsed() < ENDED_LIFE,
        });
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Debug, Clone)]
enum SessionState {
    Waiting,
    Streaming,
    Ended {
        code: &'static str,
        message: String,
        at: Instant,
    },
}

#[derive(Debug)]
struct Session {
    receiver: String,
    target: Target,
    encoding: Encoding,
    ticket: Option<String>,
    created: Instant,
    state: SessionState,
    control: Option<mpsc::Sender<Control>>,
}

/// An error as the API returns it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// The error.
    pub error: ErrorDetail,
}

/// What went wrong.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    /// A stable code: unauthorised, not-found, not-offered, forbidden, invalid, receiver-busy,
    /// rate-limited.
    pub code: String,
    /// What happened, in words.
    pub message: String,
}

struct ApiError(StatusCode, &'static str, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(ErrorBody {
                error: ErrorDetail {
                    code: self.1.into(),
                    message: self.2,
                },
            }),
        )
            .into_response()
    }
}

/// The relay's name, version and services.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct About {
    /// Always "QSP".
    pub name: String,
    /// The program's version.
    pub version: String,
    /// API versions served: ["v1"].
    pub api: Vec<String>,
    /// Whether requests need an access key.
    pub auth: bool,
    /// Services offered: "sdr", "pskreporter".
    pub services: Vec<String>,
    /// Seconds since the instance started.
    pub uptime_s: u64,
}

/// A receiver the instance offers.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Receiver {
    /// Identifier to start a session with.
    pub id: String,
    /// Its protocol.
    pub kind: ReceiverKind,
    /// Its name.
    pub name: String,
    /// Where it is.
    pub location: String,
    /// Its Maidenhead grid.
    pub grid: String,
}

/// The receivers the instance offers.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiverList {
    /// The receivers.
    pub receivers: Vec<Receiver>,
}

/// A request to start listening.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    /// The id of a receiver the instance offers.
    pub receiver: String,
    /// Dial frequency, Hz: the USB carrier, 14074000 for 20m FT8.
    pub dial_hz: u64,
    /// How the stream carries samples; ima-adpcm unless set.
    #[serde(default)]
    pub encoding: Encoding,
    /// The name the receiver's other listeners see, such as the user's callsign.
    pub listener: Option<String>,
}

/// A listening session.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    /// The session's id.
    pub id: String,
    /// The receiver's id.
    pub receiver: String,
    /// Dial frequency, Hz.
    pub dial_hz: u64,
    /// How the stream carries samples.
    pub encoding: Encoding,
    /// waiting, streaming or ended.
    pub state: String,
    /// Why it ended: busy, refused, closed, error, stopped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
    /// The end in words.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_message: Option<String>,
    /// The stream's path with its one-time ticket, under the API base; only when created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
}

/// A new dial frequency.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    /// Dial frequency, Hz.
    pub dial_hz: u64,
}

/// The stream's one-time ticket.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct Ticket {
    /// The ticket from the session's creation.
    pub ticket: String,
}

fn view(id: &str, s: &Session, with_stream: bool) -> SessionView {
    let (state, end_reason, end_message) = match &s.state {
        SessionState::Waiting => ("waiting", None, None),
        SessionState::Streaming => ("streaming", None, None),
        SessionState::Ended { code, message, .. } => {
            ("ended", Some((*code).to_string()), Some(message.clone()))
        }
    };
    SessionView {
        id: id.to_string(),
        receiver: s.receiver.clone(),
        dial_hz: s.target.dial_hz,
        encoding: s.encoding,
        state: state.into(),
        end_reason,
        end_message,
        stream: match (&s.ticket, with_stream) {
            (Some(t), true) => Some(format!("/v1/sdr/sessions/{id}/stream?ticket={t}")),
            _ => None,
        },
    }
}

fn token() -> String {
    let mut rng = rand::rng();
    (0..24).map(|_| format!("{:02x}", rng.random::<u8>())).collect()
}

/// The listener name a receiver shows: letters, digits, / and spaces, 30 characters at most.
fn listener_name(given: Option<&str>) -> String {
    let clean: String = given
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '/' || *c == ' ')
        .take(20)
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        "RR73 via QSP".into()
    } else {
        format!("{clean} via RR73")
    }
}

/// Health check for monitoring.
#[utoipa::path(get, path = "/health", tag = "instance", responses((status = 200, description = "ok", body = String)))]
async fn health() -> &'static str {
    "ok"
}

/// The instance: version, services and what it asks of the app.
#[utoipa::path(get, path = "/about", tag = "instance", responses((status = 200, body = About)))]
async fn about(State(s): State<AppState>) -> Json<About> {
    Json(About {
        name: "QSP".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        api: vec!["v1".into()],
        auth: !s.config.access_keys.is_empty(),
        services: if s.config.pskreporter.enabled {
            vec!["sdr".into(), "pskreporter".into()]
        } else {
            vec!["sdr".into()]
        },
        uptime_s: s.started.elapsed().as_secs(),
    })
}

/// The receivers this instance offers.
#[utoipa::path(get, path = "/v1/sdr/receivers", tag = "sdr", security(("key" = [])), responses((status = 200, body = ReceiverList), (status = 401, body = ErrorBody)))]
async fn receivers(State(s): State<AppState>) -> Json<ReceiverList> {
    Json(ReceiverList {
        receivers: s
            .config
            .sdr
            .receivers
            .iter()
            .map(|r| Receiver {
                id: r.id.clone(),
                kind: r.kind,
                name: r.name.clone(),
                location: r.location.clone(),
                grid: r.grid.clone(),
            })
            .collect(),
    })
}

/// Starts listening. The receiver is connected when the stream opens, with the one-time ticket
/// in the answer, within 60 s.
#[utoipa::path(post, path = "/v1/sdr/sessions", tag = "sdr", security(("key" = [])), request_body = NewSession,
    responses((status = 201, body = SessionView), (status = 400, body = ErrorBody), (status = 403, body = ErrorBody), (status = 404, body = ErrorBody), (status = 409, body = ErrorBody)))]
async fn create_session(
    State(s): State<AppState>,
    Json(req): Json<NewSession>,
) -> Result<(StatusCode, Json<SessionView>), ApiError> {
    if req.dial_hz == 0 || req.dial_hz > MAX_DIAL_HZ {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "invalid",
            format!("dialHz must be 1 to {MAX_DIAL_HZ} Hz"),
        ));
    }
    let listener = listener_name(req.listener.as_deref());
    let r: &ReceiverConfig = s.config.receiver(&req.receiver).ok_or_else(|| {
        ApiError(
            StatusCode::NOT_FOUND,
            "not-found",
            format!("This relay has no receiver {}.", req.receiver),
        )
    })?;
    let (receiver, max) = (r.id.clone(), r.max_sessions);
    let target = Target {
        host: r.host.clone(),
        port: r.port,
        dial_hz: req.dial_hz,
        listener,
        latency_s: r.latency_s,
        free_channels: r.free_channels,
    };
    // Sessions on one receiver and dial share a connection, so the limit counts dials.
    let mut sessions = lock(&s.sessions);
    let dials: std::collections::HashSet<u64> = sessions
        .values()
        .filter(|v| v.receiver == receiver && !matches!(v.state, SessionState::Ended { .. }))
        .map(|v| v.target.dial_hz)
        .collect();
    if !dials.contains(&req.dial_hz) && dials.len() >= max as usize {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "receiver-busy",
            format!("All of this relay’s sessions on {receiver} are in use. Try again later."),
        ));
    }
    let id = token();
    let session = Session {
        receiver,
        target,
        encoding: req.encoding,
        ticket: Some(token()),
        created: Instant::now(),
        state: SessionState::Waiting,
        control: None,
    };
    let body = view(&id, &session, true);
    sessions.insert(id, session);
    Ok((StatusCode::CREATED, Json(body)))
}

/// A session's state.
#[utoipa::path(get, path = "/v1/sdr/sessions/{id}", tag = "sdr", security(("key" = [])), params(("id" = String, Path, description = "The session's id")),
    responses((status = 200, body = SessionView), (status = 404, body = ErrorBody)))]
async fn get_session(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SessionView>, ApiError> {
    let sessions = lock(&s.sessions);
    let v = sessions.get(&id).ok_or_else(|| not_found(&id))?;
    Ok(Json(view(&id, v, false)))
}

fn not_found(id: &str) -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "not-found", format!("No session {id}."))
}

/// Retunes a session after a change of band.
#[utoipa::path(patch, path = "/v1/sdr/sessions/{id}", tag = "sdr", security(("key" = [])), params(("id" = String, Path, description = "The session's id")), request_body = Tune,
    responses((status = 200, body = SessionView), (status = 400, body = ErrorBody), (status = 404, body = ErrorBody)))]
async fn tune_session(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(t): Json<Tune>,
) -> Result<Json<SessionView>, ApiError> {
    if t.dial_hz == 0 || t.dial_hz > MAX_DIAL_HZ {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "invalid",
            format!("dialHz must be 1 to {MAX_DIAL_HZ} Hz"),
        ));
    }
    let mut sessions = lock(&s.sessions);
    let v = sessions.get_mut(&id).ok_or_else(|| not_found(&id))?;
    v.target.dial_hz = t.dial_hz;
    if let Some(c) = &v.control {
        let _ = c.try_send(Control::Tune(t.dial_hz));
    }
    Ok(Json(view(&id, v, false)))
}

/// Stops listening and frees the receiver's channel.
#[utoipa::path(delete, path = "/v1/sdr/sessions/{id}", tag = "sdr", security(("key" = [])), params(("id" = String, Path, description = "The session's id")),
    responses((status = 204, description = "Stopped"), (status = 404, body = ErrorBody)))]
async fn delete_session(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let removed = lock(&s.sessions).remove(&id).ok_or_else(|| not_found(&id))?;
    if let Some(c) = removed.control {
        let _ = c.try_send(Control::Stop);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// The session's audio, as a WebSocket. Binary messages are frames (docs/design/qsp.md, The
/// audio stream); text messages are JSON: `{"type":"status","state":"connecting"|"streaming"|"ended",...}`
/// and `{"type":"notice","text":...}`. The ticket from the session's creation works once.
#[utoipa::path(get, path = "/v1/sdr/sessions/{id}/stream", tag = "sdr", params(("id" = String, Path, description = "The session's id"), Ticket),
    responses((status = 101, description = "WebSocket"), (status = 403, body = ErrorBody), (status = 404, body = ErrorBody)))]
async fn stream(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<Ticket>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let (receiver, target, encoding, rx_control) = {
        let mut sessions = lock(&s.sessions);
        let v = sessions.get_mut(&id).ok_or_else(|| not_found(&id))?;
        let ok = matches!(v.state, SessionState::Waiting)
            && v.ticket.as_deref().is_some_and(|t| same(t, &q.ticket));
        if !ok {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "forbidden",
                "The stream ticket is invalid or already used.".into(),
            ));
        }
        v.ticket = None;
        v.state = SessionState::Streaming;
        let (tx, rx) = mpsc::channel(8);
        v.control = Some(tx);
        (v.receiver.clone(), v.target.clone(), v.encoding, rx)
    };
    let state = s.clone();
    Ok(ws.on_upgrade(move |socket| pump(socket, state, id, receiver, target, encoding, rx_control)))
}

/// Sends one session's stream: joins the connection for its receiver and dial, moves it when the
/// app retunes, and leaves it when either side stops.
async fn pump(
    mut socket: WebSocket,
    state: AppState,
    id: String,
    receiver: String,
    mut target: Target,
    encoding: Encoding,
    mut control: mpsc::Receiver<Control>,
) {
    let status = |state: &str| {
        Message::Text(
            serde_json::json!({ "type": "status", "state": state })
                .to_string()
                .into(),
        )
    };
    let mut joined = state.upstreams.join(&receiver, &target);
    let _ = socket.send(status("connecting")).await;
    if joined.streaming {
        let _ = socket.send(status("streaming")).await;
    }
    let mut seq = 0u32;
    let mut adpcm = AdpcmState::default();
    // Audio is missing before the next frame: after a reconnect, a move or a lag.
    let mut gap = false;
    let (code, message) = loop {
        tokio::select! {
            e = joined.events.recv() => match e {
                Ok(Event::Streaming) => { let _ = socket.send(status("streaming")).await; }
                Ok(Event::Reconnecting { .. }) => {
                    gap = true;
                    let _ = socket.send(status("connecting")).await;
                }
                Ok(Event::Audio { utc_us, samples, gap: g }) => {
                    let lost = std::mem::take(&mut gap);
                    let flags = if g || lost { frame::FLAG_GAP } else { 0 };
                    let head = FrameHead { seq, utc_us, flags };
                    seq = seq.wrapping_add(1);
                    if socket.send(Message::Binary(frame::encode(head, encoding, &samples, &mut adpcm).into())).await.is_err() {
                        break ("stopped", "The app closed the stream.".to_string());
                    }
                }
                Ok(Event::Notice(text)) => {
                    let _ = socket.send(Message::Text(serde_json::json!({ "type": "notice", "text": text }).to_string().into())).await;
                }
                Ok(Event::Ended(end)) => {
                    let m = serde_json::json!({ "type": "status", "state": "ended", "reason": end.code(), "message": end.message() });
                    let _ = socket.send(Message::Text(m.to_string().into())).await;
                    let _ = socket.send(Message::Close(None)).await;
                    break (end.code(), end.message());
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => gap = true,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break ("error", "The connection to the receiver dropped.".to_string()),
            },
            c = control.recv() => match c {
                Some(Control::Tune(hz)) => {
                    target.dial_hz = hz;
                    if state.upstreams.retune(&mut joined, &target) {
                        gap = true;
                        let _ = socket.send(status(if joined.streaming { "streaming" } else { "connecting" })).await;
                    }
                }
                Some(Control::Stop) | None => {
                    let _ = socket.send(Message::Close(None)).await;
                    break ("stopped", "Stopped.".to_string());
                }
            },
            m = socket.recv() => match m {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break ("stopped", "The app closed the stream.".to_string()),
                Some(Ok(_)) => {}
            },
        }
    };
    state.upstreams.leave(&joined);
    if let Some(v) = lock(&state.sessions).get_mut(&id) {
        v.state = SessionState::Ended {
            code,
            message,
            at: Instant::now(),
        };
        v.control = None;
    }
}

/// Compares in time independent of where the strings differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Checks the access key, then the request limit per key (or per address on an open instance).
async fn guard(
    State(s): State<AppState>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let key = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    let who = if s.config.access_keys.is_empty() {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .unwrap_or("anonymous")
            .trim()
            .to_string()
    } else if s.config.access_keys.iter().any(|k| same(k, key)) {
        key.to_string()
    } else {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "unauthorised",
            "This relay requires an access key in the header Authorization: Bearer <key>.".into(),
        ));
    };
    let minute = s.started.elapsed().as_secs() / 60;
    {
        let mut l = lock(&s.limiter);
        l.retain(|_, (m, _)| *m == minute);
        let entry = l.entry(who).or_insert((minute, 0));
        entry.1 += 1;
        if entry.1 > s.config.requests_per_minute {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "rate-limited",
                format!(
                    "Rate limit of {} requests per minute reached. Try again in a minute.",
                    s.config.requests_per_minute
                ),
            ));
        }
    }
    Ok(next.run(req).await)
}

/// Most spots in one request.
const MAX_SPOTS: usize = 500;
/// Oldest spot taken, s before now.
const SPOT_MAX_AGE_S: u64 = 3600;

/// The station that heard the spots.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReceivingStation {
    /// Callsign.
    pub callsign: String,
    /// Maidenhead locator, 4 or 6 characters.
    pub locator: String,
    /// Decoding software and version, such as "RR73 0.16.2"; 60 characters at most.
    pub software: String,
    /// The antenna, free text, 100 characters at most.
    #[serde(default)]
    pub antenna: String,
}

/// One station heard.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Heard {
    /// The sender's callsign.
    pub callsign: String,
    /// The sender's locator, when its messages carried one.
    #[serde(default)]
    pub locator: String,
    /// RF frequency: dial plus audio, Hz.
    pub frequency_hz: u32,
    /// SNR in 2500 Hz, dB.
    pub snr_db: i32,
    /// FT8, FT4 or LQ8.
    pub mode: String,
    /// When it was heard, s since 1970.
    pub time: u64,
}

/// A batch of stations heard by one receiving station.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Receptions {
    /// The receiving station.
    pub station: ReceivingStation,
    /// The stations heard, 500 at most.
    pub spots: Vec<Heard>,
}

/// What a batch came to.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionsTaken {
    /// Spots queued for the station's next datagram.
    pub taken: usize,
    /// Spots dropped as reported too recently.
    pub repeats: usize,
    /// Spots refused: an unreadable callsign or locator, another mode, or a time out of range.
    pub rejected: usize,
    /// Earliest time the station's next datagram goes, s since 1970.
    pub next_report: u64,
}

/// A receiving station's reports.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportStatus {
    /// Spots waiting for the next datagram.
    pub waiting: usize,
    /// Spots sent.
    pub sent: u32,
    /// Datagrams sent.
    pub datagrams: u32,
    /// When the last datagram went, s since 1970.
    pub last_sent: Option<u64>,
    /// Earliest time the next datagram goes, s since 1970; none while nothing waits.
    pub next_report: Option<u64>,
}

/// The receiving station to look up.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct StationQuery {
    /// The receiving station's callsign.
    pub callsign: String,
}

fn now_s() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// A callsign in upper case: 3 to 15 letters, digits and /, with a digit.
fn clean_call(s: &str) -> Option<String> {
    let c = s.trim().to_ascii_uppercase();
    let ok = (3..=15).contains(&c.len())
        && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '/')
        && c.chars().any(|ch| ch.is_ascii_digit());
    ok.then_some(c)
}

/// A Maidenhead locator of 4 or 6 characters, written as FN42hn.
fn clean_locator(s: &str) -> Option<String> {
    let b = s.trim().as_bytes();
    if b.len() != 4 && b.len() != 6 {
        return None;
    }
    let field = |c: u8| matches!(c.to_ascii_uppercase(), b'A'..=b'R');
    let square = |c: u8| c.is_ascii_digit();
    let sub = |c: u8| matches!(c.to_ascii_lowercase(), b'a'..=b'x');
    if !(field(b[0]) && field(b[1]) && square(b[2]) && square(b[3])) {
        return None;
    }
    let mut out = String::new();
    out.push(char::from(b[0].to_ascii_uppercase()));
    out.push(char::from(b[1].to_ascii_uppercase()));
    out.push(char::from(b[2]));
    out.push(char::from(b[3]));
    if b.len() == 6 {
        if !(sub(b[4]) && sub(b[5])) {
            return None;
        }
        out.push(char::from(b[4].to_ascii_lowercase()));
        out.push(char::from(b[5].to_ascii_lowercase()));
    }
    Some(out)
}

/// Printable ASCII text of `max` characters at most.
fn clean_text(s: &str, max: usize) -> Option<String> {
    let t = s.trim();
    (t.len() <= max && t.chars().all(|c| c.is_ascii_graphic() || c == ' ')).then(|| t.to_string())
}

fn clean_spot(h: Heard, now: u64) -> Option<Spot> {
    let callsign = clean_call(&h.callsign)?;
    let locator = if h.locator.trim().is_empty() {
        String::new()
    } else {
        clean_locator(&h.locator)?
    };
    let mode = h.mode.trim().to_ascii_uppercase();
    if !matches!(mode.as_str(), "FT8" | "FT4" | "LQ8") {
        return None;
    }
    if !(100_000..=1_000_000_000).contains(&h.frequency_hz) {
        return None;
    }
    if h.time + SPOT_MAX_AGE_S < now || h.time > now + 60 {
        return None;
    }
    Some(Spot {
        callsign,
        locator,
        frequency_hz: h.frequency_hz,
        snr_db: h.snr_db.clamp(-128, 127) as i8,
        mode,
        time_s: u32::try_from(h.time).ok()?,
    })
}

fn not_offered() -> ApiError {
    ApiError(
        StatusCode::NOT_FOUND,
        "not-offered",
        "This relay does not report to PSK Reporter.".into(),
    )
}

/// Queues the stations one receiving station heard. QSP sends them to PSK Reporter by its rules:
/// at most one datagram every 5 min per receiving station, each callsign at most once per 5 min
/// and once an hour on the same band and mode.
#[utoipa::path(post, path = "/v1/pskreporter/receptions", tag = "pskreporter", security(("key" = [])), request_body = Receptions,
    responses((status = 200, body = ReceptionsTaken), (status = 400, body = ErrorBody), (status = 404, body = ErrorBody)))]
async fn report_receptions(
    State(s): State<AppState>,
    Json(body): Json<Receptions>,
) -> Result<Json<ReceptionsTaken>, ApiError> {
    if !s.config.pskreporter.enabled {
        return Err(not_offered());
    }
    let invalid = |m: &str| ApiError(StatusCode::BAD_REQUEST, "invalid", m.into());
    let st = &body.station;
    let (Some(callsign), Some(locator)) = (clean_call(&st.callsign), clean_locator(&st.locator)) else {
        return Err(invalid(
            "Send the station's callsign and a 4 or 6 character locator.",
        ));
    };
    let Some(software) = clean_text(&st.software, 60).filter(|t| !t.is_empty()) else {
        return Err(invalid(
            "Send the decoding software's name and version, 60 characters at most.",
        ));
    };
    let Some(antenna) = clean_text(&st.antenna, 100) else {
        return Err(invalid("Send the antenna as plain text, 100 characters at most."));
    };
    if body.spots.len() > MAX_SPOTS {
        return Err(invalid("Send 500 spots at most per request."));
    }
    let now = now_s();
    let total = body.spots.len();
    let spots: Vec<Spot> = body
        .spots
        .into_iter()
        .filter_map(|h| clean_spot(h, now))
        .collect();
    let rejected = total - spots.len();
    let station = Station {
        callsign,
        locator,
        software,
        antenna,
    };
    let t = lock(&s.reporter).take(now, station, spots);
    Ok(Json(ReceptionsTaken {
        taken: t.taken,
        repeats: t.repeats,
        rejected,
        next_report: t.next_report_s,
    }))
}

/// A receiving station's reports: waiting, sent and when the next datagram goes.
#[utoipa::path(get, path = "/v1/pskreporter/status", tag = "pskreporter", security(("key" = [])), params(StationQuery),
    responses((status = 200, body = ReportStatus), (status = 404, body = ErrorBody)))]
async fn report_status(
    State(s): State<AppState>,
    Query(q): Query<StationQuery>,
) -> Result<Json<ReportStatus>, ApiError> {
    if !s.config.pskreporter.enabled {
        return Err(not_offered());
    }
    let call = clean_call(&q.callsign).unwrap_or_default();
    let st = lock(&s.reporter).status(&call);
    Ok(Json(match st {
        Some(st) => ReportStatus {
            waiting: st.waiting,
            sent: st.sent,
            datagrams: st.datagrams,
            last_sent: st.last_sent_s,
            next_report: (st.waiting > 0).then_some(st.next_report_s),
        },
        None => ReportStatus {
            waiting: 0,
            sent: 0,
            datagrams: 0,
            last_sent: None,
            next_report: None,
        },
    }))
}

/// The OpenAPI document of every endpoint.
#[derive(OpenApi)]
#[openapi(
    info(title = "QSP", description = "The relay RR73 uses for the services a web page cannot reach directly. Every path joins onto the relay's API base, such as https://relay.example.org/qsp."),
    paths(health, about, receivers, create_session, get_session, tune_session, delete_session, stream, report_receptions, report_status),
    components(schemas(About, Receiver, ReceiverList, NewSession, SessionView, Tune, ErrorBody, ErrorDetail, Encoding, ReceiverKind, ReceivingStation, Heard, Receptions, ReceptionsTaken, ReportStatus)),
    modifiers(&KeyScheme),
    tags((name = "instance", description = "The relay itself. No access key needed."), (name = "sdr", description = "Web SDR receive."), (name = "pskreporter", description = "Reports to PSK Reporter."))
)]
pub struct ApiDoc;

struct KeyScheme;

impl utoipa::Modify for KeyScheme {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
        if let Some(c) = openapi.components.as_mut() {
            c.add_security_scheme(
                "key",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .description(Some("Required when the relay has access keys."))
                        .build(),
                ),
            );
        }
    }
}

async fn openapi_json() -> impl IntoResponse {
    Json(ApiDoc::openapi())
}

async fn docs() -> Html<String> {
    Html(crate::docs::render(&ApiDoc::openapi()))
}

/// The whole API, with CORS for the allowed origins.
pub fn router(state: AppState) -> Router {
    let v1 = Router::new()
        .route("/v1/sdr/receivers", get(receivers))
        .route("/v1/sdr/sessions", axum::routing::post(create_session))
        .route(
            "/v1/sdr/sessions/{id}",
            get(get_session).patch(tune_session).delete(delete_session),
        )
        .route(
            "/v1/pskreporter/receptions",
            axum::routing::post(report_receptions),
        )
        .route("/v1/pskreporter/status", get(report_status))
        .route_layer(middleware::from_fn_with_state(state.clone(), guard));
    let open = Router::new()
        .route("/health", get(health))
        .route("/about", get(about))
        .route("/docs", get(docs))
        .route("/openapi.json", get(openapi_json))
        .route("/v1/sdr/sessions/{id}/stream", get(stream));
    let origins = if state.config.allowed_origins.is_empty() {
        AllowOrigin::any()
    } else {
        AllowOrigin::list(
            state
                .config
                .allowed_origins
                .iter()
                .filter_map(|o| HeaderValue::from_str(o).ok()),
        )
    };
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    v1.merge(open).layer(cors).with_state(state)
}
