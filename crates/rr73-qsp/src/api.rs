//! QSP's HTTP API (docs/design/qsp.md, The API). The OpenAPI document behind `/docs` is built
//! from the same handlers and types, so the page cannot drift from them.

use crate::config::{Config, ReceiverConfig, ReceiverKind};
use crate::frame::{self, AdpcmState, Encoding, FrameHead};
use crate::kiwi::{self, Control, Event, Target};
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
use std::time::{Duration, Instant};
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
    started: Instant,
}

impl AppState {
    /// State for an instance with these settings.
    pub fn new(config: Config) -> Self {
        AppState {
            config: Arc::new(config),
            sessions: Arc::default(),
            limiter: Arc::default(),
            started: Instant::now(),
        }
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
    /// A stable code: unauthorised, not-found, forbidden, invalid, receiver-busy, rate-limited.
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
    /// Services offered: "sdr".
    pub services: Vec<String>,
    /// Whether users may name receivers of their own.
    pub user_receivers: bool,
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

/// A receiver the user names, where the instance allows it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CustomReceiver {
    /// Its protocol.
    pub kind: ReceiverKind,
    /// Host name or address.
    pub host: String,
    /// Port.
    pub port: u16,
}

/// A request to start listening.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    /// The id of a receiver the instance offers. Give this or `custom`.
    pub receiver: Option<String>,
    /// A receiver of the user's own.
    pub custom: Option<CustomReceiver>,
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
    /// The receiver: its id, or host:port for the user's own.
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
        services: vec!["sdr".into()],
        user_receivers: s.config.sdr.user_receivers,
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
    let (receiver, target, max) = match (&req.receiver, &req.custom) {
        (Some(id), None) => {
            let r: &ReceiverConfig = s.config.receiver(id).ok_or_else(|| {
                ApiError(
                    StatusCode::NOT_FOUND,
                    "not-found",
                    format!("This relay has no receiver {id}."),
                )
            })?;
            let t = Target {
                host: r.host.clone(),
                port: r.port,
                dial_hz: req.dial_hz,
                listener,
                latency_s: r.latency_s,
                free_channels: r.free_channels,
            };
            (r.id.clone(), t, r.max_sessions)
        }
        (None, Some(c)) => {
            if !s.config.sdr.user_receivers {
                return Err(ApiError(
                    StatusCode::FORBIDDEN,
                    "forbidden",
                    "This relay accepts only the receivers it lists.".into(),
                ));
            }
            if c.host.is_empty() || c.host.contains(['/', ' ', '@']) {
                return Err(ApiError(
                    StatusCode::BAD_REQUEST,
                    "invalid",
                    "host must be a host name or an address".into(),
                ));
            }
            let t = Target {
                host: c.host.clone(),
                port: c.port,
                dial_hz: req.dial_hz,
                listener,
                latency_s: 0.0,
                free_channels: 1,
            };
            (format!("{}:{}", c.host, c.port), t, 1)
        }
        _ => {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "invalid",
                "Send exactly one of receiver and custom.".into(),
            ));
        }
    };
    let mut sessions = lock(&s.sessions);
    let open = sessions
        .values()
        .filter(|v| v.receiver == receiver && !matches!(v.state, SessionState::Ended { .. }))
        .count();
    if open >= max as usize {
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
    let (target, encoding, tx_control, rx_control) = {
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
        v.control = Some(tx.clone());
        (v.target.clone(), v.encoding, tx, rx)
    };
    let state = s.clone();
    Ok(ws.on_upgrade(move |socket| pump(socket, state, id, target, encoding, tx_control, rx_control)))
}

async fn pump(
    mut socket: WebSocket,
    state: AppState,
    id: String,
    target: Target,
    encoding: Encoding,
    control: mpsc::Sender<Control>,
    rx_control: mpsc::Receiver<Control>,
) {
    let (tx_events, mut events) = mpsc::channel(64);
    tokio::spawn(kiwi::run(target, tx_events, rx_control));
    let status = |state: &str| {
        Message::Text(
            serde_json::json!({ "type": "status", "state": state })
                .to_string()
                .into(),
        )
    };
    let _ = socket.send(status("connecting")).await;
    let mut seq = 0u32;
    let mut adpcm = AdpcmState::default();
    let (code, message) = loop {
        tokio::select! {
            e = events.recv() => match e {
                Some(Event::Streaming) => { let _ = socket.send(status("streaming")).await; }
                Some(Event::Audio { utc_us, samples, gap }) => {
                    let head = FrameHead { seq, utc_us, flags: if gap { frame::FLAG_GAP } else { 0 } };
                    seq = seq.wrapping_add(1);
                    if socket.send(Message::Binary(frame::encode(head, encoding, &samples, &mut adpcm).into())).await.is_err() {
                        let _ = control.send(Control::Stop).await;
                        break ("stopped", "The app closed the stream.".to_string());
                    }
                }
                Some(Event::Notice(text)) => {
                    let _ = socket.send(Message::Text(serde_json::json!({ "type": "notice", "text": text }).to_string().into())).await;
                }
                Some(Event::Ended(end)) => {
                    let m = serde_json::json!({ "type": "status", "state": "ended", "reason": end.code(), "message": end.message() });
                    let _ = socket.send(Message::Text(m.to_string().into())).await;
                    let _ = socket.send(Message::Close(None)).await;
                    break (end.code(), end.message());
                }
                None => break ("error", "The connection to the receiver dropped.".to_string()),
            },
            m = socket.recv() => match m {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                    let _ = control.send(Control::Stop).await;
                    break ("stopped", "The app closed the stream.".to_string());
                }
                Some(Ok(_)) => {}
            },
        }
    };
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

/// The OpenAPI document of every endpoint.
#[derive(OpenApi)]
#[openapi(
    info(title = "QSP", description = "The relay RR73 uses to receive from web SDRs. Every path joins onto the instance's API base, such as https://dmr.pwn.sg/qsp."),
    paths(health, about, receivers, create_session, get_session, tune_session, delete_session, stream),
    components(schemas(About, Receiver, ReceiverList, NewSession, CustomReceiver, SessionView, Tune, ErrorBody, ErrorDetail, Encoding, ReceiverKind)),
    modifiers(&KeyScheme),
    tags((name = "instance", description = "The relay itself. No access key needed."), (name = "sdr", description = "Web SDR receive."))
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
