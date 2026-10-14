//! QSP's settings, read from one TOML file (`qsp.example.toml` lists every field).

use serde::Deserialize;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::Path;

/// The whole settings file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Address to listen on, plain HTTP behind an HTTPS front: `127.0.0.1:7373`.
    #[serde(default = "default_listen")]
    pub listen: SocketAddr,
    /// Keys the app sends as `Authorization: Bearer <key>`. None: anyone may use the instance.
    #[serde(default)]
    pub access_keys: Vec<String>,
    /// Origins a browser may call QSP from, such as `https://nnamon.github.io`. None: any.
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    /// Requests one key, or one address on an open instance, may make per minute.
    #[serde(default = "default_requests_per_minute")]
    pub requests_per_minute: u32,
    /// Web SDR receive.
    #[serde(default)]
    pub sdr: SdrConfig,
}

/// Web SDR receive.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SdrConfig {
    /// Whether users may name receivers of their own, by kind and address.
    #[serde(default)]
    pub user_receivers: bool,
    /// The receivers the instance offers.
    #[serde(default)]
    pub receivers: Vec<ReceiverConfig>,
}

/// The protocols QSP speaks to receivers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReceiverKind {
    /// A KiwiSDR or a Web-888, over its WebSocket protocol.
    Kiwisdr,
}

/// One receiver the instance offers.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiverConfig {
    /// Short identifier the app sends back: `sarts-web888`.
    pub id: String,
    /// The receiver's protocol.
    pub kind: ReceiverKind,
    /// Name the app shows.
    pub name: String,
    /// Where it is, for the app: `Singapore`.
    #[serde(default)]
    pub location: String,
    /// Its Maidenhead grid, for distances: `OJ11`.
    #[serde(default)]
    pub grid: String,
    /// Host name or address.
    pub host: String,
    /// Port, 8073 by default.
    #[serde(default = "default_kiwi_port")]
    pub port: u16,
    /// How late the receiver's audio arrives, s: subtracted from every timestamp.
    #[serde(default)]
    pub latency_s: f64,
    /// Channels left free for other listeners: QSP does not connect when fewer would remain.
    #[serde(default = "default_free_channels")]
    pub free_channels: u32,
    /// Sessions this instance may hold on the receiver at once.
    #[serde(default = "default_max_sessions")]
    pub max_sessions: u32,
}

fn default_listen() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 7373))
}

fn default_requests_per_minute() -> u32 {
    120
}

fn default_kiwi_port() -> u16 {
    8073
}

fn default_free_channels() -> u32 {
    1
}

fn default_max_sessions() -> u32 {
    1
}

/// Why a settings file was refused.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The file could not be read.
    #[error("cannot read {path}: {source}")]
    Read {
        /// The file.
        path: String,
        /// The cause.
        source: std::io::Error,
    },
    /// The file is not valid TOML for these settings.
    #[error("{path}: {source}")]
    Parse {
        /// The file.
        path: String,
        /// The cause.
        source: toml::de::Error,
    },
    /// A value is out of range or repeated.
    #[error("{0}")]
    Invalid(String),
}

impl Config {
    /// Reads and checks a settings file.
    pub fn load(path: &Path) -> Result<Self, ConfigError> {
        let shown = path.display().to_string();
        let text = std::fs::read_to_string(path).map_err(|source| ConfigError::Read {
            path: shown.clone(),
            source,
        })?;
        let config: Config =
            toml::from_str(&text).map_err(|source| ConfigError::Parse { path: shown, source })?;
        config.check()?;
        Ok(config)
    }

    /// Checks values a TOML type cannot: unique ids, ranges, key lengths.
    pub fn check(&self) -> Result<(), ConfigError> {
        let mut ids = HashSet::new();
        for r in &self.sdr.receivers {
            if r.id.is_empty()
                || !r
                    .id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(ConfigError::Invalid(format!(
                    "receiver id {:?}: letters, digits, - and _ only",
                    r.id
                )));
            }
            if !ids.insert(r.id.as_str()) {
                return Err(ConfigError::Invalid(format!(
                    "receiver id {:?} is listed twice",
                    r.id
                )));
            }
            if r.host.is_empty() {
                return Err(ConfigError::Invalid(format!("receiver {:?} has no host", r.id)));
            }
            if !(0.0..=5.0).contains(&r.latency_s) {
                return Err(ConfigError::Invalid(format!(
                    "receiver {:?}: latency_s must be 0 to 5",
                    r.id
                )));
            }
            if r.max_sessions == 0 {
                return Err(ConfigError::Invalid(format!(
                    "receiver {:?}: max_sessions must be at least 1",
                    r.id
                )));
            }
        }
        if let Some(k) = self.access_keys.iter().find(|k| k.len() < 16) {
            return Err(ConfigError::Invalid(format!(
                "access key {}…: use at least 16 characters",
                k.chars().take(4).collect::<String>()
            )));
        }
        if self.requests_per_minute == 0 {
            return Err(ConfigError::Invalid(
                "requests_per_minute must be at least 1".into(),
            ));
        }
        Ok(())
    }

    /// The receiver the instance offers under `id`.
    pub fn receiver(&self, id: &str) -> Option<&ReceiverConfig> {
        self.sdr.receivers.iter().find(|r| r.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<Config, ConfigError> {
        let c: Config = toml::from_str(text).map_err(|source| ConfigError::Parse {
            path: "test".into(),
            source,
        })?;
        c.check()?;
        Ok(c)
    }

    #[test]
    fn reads_the_example() {
        let text = include_str!("../qsp.example.toml");
        let c = parse(text).expect("the example parses");
        assert!(c.receiver("sarts-web888").is_some());
        assert_eq!(c.sdr.receivers.len(), 2);
    }

    #[test]
    fn refuses_repeated_ids_short_keys_and_unknown_fields() {
        let twice = r#"
            [[sdr.receivers]]
            id = "a"
            kind = "kiwisdr"
            name = "A"
            host = "h"
            [[sdr.receivers]]
            id = "a"
            kind = "kiwisdr"
            name = "B"
            host = "h"
        "#;
        assert!(matches!(parse(twice), Err(ConfigError::Invalid(_))));
        assert!(matches!(
            parse(r#"access_keys = ["short"]"#),
            Err(ConfigError::Invalid(_))
        ));
        assert!(matches!(
            parse(r#"listne = "1.2.3.4:5""#),
            Err(ConfigError::Parse { .. })
        ));
    }
}
