//! QSP's API end to end against a stand-in KiwiSDR on the loopback interface: no test reaches a
//! real receiver.
#![allow(clippy::unwrap_used, missing_docs)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use futures_util::{SinkExt, StreamExt};
use rr73_qsp::{AppState, Config, frame, router};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;

const KEY: &str = "test-key-0123456789abcdef";

/// A stand-in KiwiSDR: answers /status, then streams a 1000 Hz tone at 12 kHz in 512-sample
/// frames every 42 ms, and records the commands it receives.
async fn stand_in(users: u32) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let heard = Arc::new(Mutex::new(Vec::new()));
    let log = heard.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let mut peek = [0u8; 12];
            let n = sock.peek(&mut peek).await.unwrap_or(0);
            if peek[..n].starts_with(b"GET /status") {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let body = format!("status=active\nusers={users}\nusers_max=4\n");
                let _ = sock
                    .write_all(format!("HTTP/1.0 200 OK\r\n\r\n{body}").as_bytes())
                    .await;
                continue;
            }
            let log = log.clone();
            tokio::spawn(async move {
                let Ok(mut ws) = tokio_tungstenite::accept_async(sock).await else {
                    return;
                };
                let _ = ws
                    .send(Message::Binary(
                        b"MSG audio_rate=12000 sample_rate=12000.000000".to_vec().into(),
                    ))
                    .await;
                let mut seq = 0u32;
                let mut tick = tokio::time::interval(Duration::from_millis(42));
                loop {
                    tokio::select! {
                        m = ws.next() => match m {
                            Some(Ok(Message::Text(t))) => log.lock().unwrap().push(t.to_string()),
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => { log.lock().unwrap().push("closed".into()); return; }
                            _ => {}
                        },
                        _ = tick.tick() => {
                            let mut b = b"SND".to_vec();
                            b.push(0);
                            b.extend_from_slice(&seq.to_le_bytes());
                            b.extend_from_slice(&500u16.to_be_bytes());
                            for i in 0..512u32 {
                                let n = f64::from(seq * 512 + i);
                                let v = (8000.0 * (2.0 * std::f64::consts::PI * 1000.0 * n / 12_000.0).sin()) as i16;
                                b.extend_from_slice(&v.to_be_bytes());
                            }
                            seq += 1;
                            if ws.send(Message::Binary(b.into())).await.is_err() { return; }
                        }
                    }
                }
            });
        }
    });
    (port, heard)
}

fn config(port: u16) -> Config {
    let text = format!(
        r#"
        access_keys = ["{KEY}"]
        [[sdr.receivers]]
        id = "stand-in"
        kind = "kiwisdr"
        name = "Stand-in"
        host = "127.0.0.1"
        port = {port}
        free_channels = 1
        "#
    );
    let c: Config = toml::from_str(&text).unwrap();
    c.check().unwrap();
    c
}

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    key: bool,
) -> (StatusCode, serde_json::Value) {
    let mut r = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if key {
        r = r.header("authorization", format!("Bearer {KEY}"));
    }
    let req = r
        .body(body.map_or(Body::empty(), |b| Body::from(b.to_string())))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn about_docs_and_the_key() {
    let (port, _) = stand_in(0).await;
    let app = router(AppState::new(config(port)));
    let (s, about) = call(&app, "GET", "/about", None, false).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(about["name"], "QSP");
    assert_eq!(about["auth"], true);
    let (s, err) = call(&app, "GET", "/v1/sdr/receivers", None, false).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(err["error"]["code"], "unauthorised");
    let (s, list) = call(&app, "GET", "/v1/sdr/receivers", None, true).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(list["receivers"][0]["id"], "stand-in");
    let (s, doc) = call(&app, "GET", "/openapi.json", None, false).await;
    assert_eq!(s, StatusCode::OK);
    assert!(doc["paths"]["/v1/sdr/sessions/{id}/stream"].is_object());
    let res = app
        .clone()
        .oneshot(Request::get("/docs").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let html = String::from_utf8(
        axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("<code>/v1/sdr/sessions</code>") && html.contains("NewSession"));
}

#[tokio::test]
async fn sessions_refuse_what_the_instance_does_not_offer() {
    let (port, _) = stand_in(0).await;
    let app = router(AppState::new(config(port)));
    let (s, e) = call(
        &app,
        "POST",
        "/v1/sdr/sessions",
        Some(serde_json::json!({"receiver": "nope", "dialHz": 14074000})),
        true,
    )
    .await;
    assert_eq!(
        (s, e["error"]["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("not-found"))
    );
    let custom = serde_json::json!({"custom": {"kind": "kiwisdr", "host": "example.org", "port": 8073}, "dialHz": 14074000});
    let (s, _) = call(&app, "POST", "/v1/sdr/sessions", Some(custom), true).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = call(
        &app,
        "POST",
        "/v1/sdr/sessions",
        Some(serde_json::json!({"receiver": "stand-in", "dialHz": 0})),
        true,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // One session at a time on this receiver.
    let ok = serde_json::json!({"receiver": "stand-in", "dialHz": 14074000});
    assert_eq!(
        call(&app, "POST", "/v1/sdr/sessions", Some(ok.clone()), true)
            .await
            .0,
        StatusCode::CREATED
    );
    let (s, e) = call(&app, "POST", "/v1/sdr/sessions", Some(ok), true).await;
    assert_eq!(
        (s, e["error"]["code"].as_str()),
        (StatusCode::CONFLICT, Some("receiver-busy"))
    );
}

#[tokio::test]
async fn streams_timed_audio_retunes_and_stops() {
    let (port, heard) = stand_in(0).await;
    let state = AppState::new(config(port));
    let app = router(state);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let qsp = listener.local_addr().unwrap();
    let served = app.clone();
    tokio::spawn(async move { axum::serve(listener, served).await.unwrap() });

    let body = serde_json::json!({"receiver": "stand-in", "dialHz": 14074000, "listener": "9V1NE"});
    let (s, session) = call(&app, "POST", "/v1/sdr/sessions", Some(body), true).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(session["encoding"], "ima-adpcm");
    let path = session["stream"].as_str().unwrap().to_string();
    let id = session["id"].as_str().unwrap().to_string();

    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{qsp}{path}"))
        .await
        .unwrap();
    let mut states = Vec::new();
    let mut frames = Vec::new();
    while frames.len() < 30 {
        match tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .unwrap()
        {
            Some(Ok(Message::Text(t))) => {
                states.push(serde_json::from_str::<serde_json::Value>(&t).unwrap()["state"].clone())
            }
            Some(Ok(Message::Binary(b))) => frames.push(frame::decode(&b).unwrap()),
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(states, vec!["connecting", "streaming"]);
    // Frame times follow the sample count, with no gap.
    for w in frames.windows(2) {
        // 512 samples at 12 kHz: 42 666.7 µs, rounded each frame from the running count.
        assert!((w[1].head.utc_us - w[0].head.utc_us - 42_667).abs() <= 1);
        assert_eq!(w[1].head.flags & frame::FLAG_GAP, 0);
    }
    // The ADPCM audio is the stand-in's tone: most of its power at 1000 Hz.
    let x: Vec<f64> = frames[5..]
        .iter()
        .flat_map(|f| f.samples.iter().map(|&s| f64::from(s)))
        .collect();
    let goertzel = |hz: f64| {
        let w = 2.0 * std::f64::consts::PI * hz / 12_000.0;
        let (s, c) = x.iter().enumerate().fold((0.0, 0.0), |(s, c), (n, v)| {
            (s + v * (w * n as f64).sin(), c + v * (w * n as f64).cos())
        });
        s * s + c * c
    };
    assert!(goertzel(1000.0) > 100.0 * goertzel(1700.0));

    // The ticket worked once.
    assert!(
        tokio_tungstenite::connect_async(format!("ws://{qsp}{path}"))
            .await
            .is_err()
    );

    // Retune, then stop.
    let (s, v) = call(
        &app,
        "PATCH",
        &format!("/v1/sdr/sessions/{id}"),
        Some(serde_json::json!({"dialHz": 7074000})),
        true,
    )
    .await;
    assert_eq!((s, v["state"].as_str()), (StatusCode::OK, Some("streaming")));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        call(&app, "DELETE", &format!("/v1/sdr/sessions/{id}"), None, true)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    let heard = heard.lock().unwrap().clone();
    assert_eq!(heard[0], "SET auth t=kiwi p=");
    assert!(heard.contains(&"SET ident_user=9V1NE%20via%20RR73".to_string()));
    assert!(heard.contains(&"SET mod=usb low_cut=100 high_cut=3000 freq=14074.000".to_string()));
    assert!(heard.contains(&"SET mod=usb low_cut=100 high_cut=3000 freq=7074.000".to_string()));
    assert_eq!(heard.last().map(String::as_str), Some("closed"));
}

#[tokio::test]
async fn leaves_a_full_receiver_alone() {
    // 3 of 4 channels in use, 1 to stay free: QSP does not connect.
    let (port, heard) = stand_in(3).await;
    let app = router(AppState::new(config(port)));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let qsp = listener.local_addr().unwrap();
    let served = app.clone();
    tokio::spawn(async move { axum::serve(listener, served).await.unwrap() });
    let (_, session) = call(
        &app,
        "POST",
        "/v1/sdr/sessions",
        Some(serde_json::json!({"receiver": "stand-in", "dialHz": 14074000})),
        true,
    )
    .await;
    let (mut ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{qsp}{}", session["stream"].as_str().unwrap()))
            .await
            .unwrap();
    let mut last = serde_json::Value::Null;
    while let Ok(Some(Ok(Message::Text(t)))) = tokio::time::timeout(Duration::from_secs(10), ws.next()).await
    {
        last = serde_json::from_str(&t).unwrap();
    }
    assert_eq!(last["state"], "ended");
    assert_eq!(last["reason"], "busy");
    assert!(heard.lock().unwrap().is_empty());
}
