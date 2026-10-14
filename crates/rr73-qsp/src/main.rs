//! `rr73-qsp --config qsp.toml`: runs a QSP instance.

use clap::Parser;
use rr73_qsp::{AppState, Config, router};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

/// QSP, the relay RR73 uses to receive from web SDRs.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// The settings file (see qsp.example.toml).
    #[arg(long, default_value = "qsp.toml")]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();
    let args = Args::parse();
    let config = match Config::load(&args.config) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let listen = config.listen;
    let state = AppState::new(config);
    let sweeper = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(15));
        loop {
            tick.tick().await;
            sweeper.sweep();
        }
    });
    let listener = match tokio::net::TcpListener::bind(listen).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("cannot listen on {listen}: {e}");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("QSP {} listening on {listen}", env!("CARGO_PKG_VERSION"));
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    if let Err(e) = axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown)
        .await
    {
        tracing::error!("{e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
