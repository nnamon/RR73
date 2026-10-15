//! One connection to a receiver per receiver and dial, shared by every session listening there
//! (docs/design/qsp.md, Web SDRs): two phones on the same receiver and band take one channel. A hub
//! task passes the connection's events to each session's stream. A session that retunes keeps its
//! connection when it listens there alone and no connection is on the new dial; otherwise it moves.
//! The last session to leave a connection stops it.

use crate::kiwi::{self, Control, Event, Target};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

/// Events held for each session before it counts as lagging: about 2.7 s of audio.
const BUFFER: usize = 64;

/// A receiver and the dial it is tuned to, Hz.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    /// The receiver's id in the settings.
    pub receiver: String,
    /// Dial frequency, Hz.
    pub dial_hz: u64,
}

struct Upstream {
    id: u64,
    events: broadcast::Sender<Event>,
    control: mpsc::Sender<Control>,
    users: usize,
    streaming: bool,
}

/// The open connections, by receiver and dial.
#[derive(Clone, Default)]
pub struct Upstreams {
    open: Arc<Mutex<HashMap<Key, Upstream>>>,
    next_id: Arc<AtomicU64>,
}

/// A session's place on a connection.
pub struct Joined {
    /// The connection's receiver and dial.
    pub key: Key,
    /// The connection itself, so a session leaves only the one it joined.
    pub id: u64,
    /// Its events from now on.
    pub events: broadcast::Receiver<Event>,
    /// Whether it was already streaming: a session that joins then hears no Streaming event.
    pub streaming: bool,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Upstreams {
    /// Joins the connection for the receiver at the target's dial, opening it when there is none.
    pub fn join(&self, receiver: &str, target: &Target) -> Joined {
        let key = Key {
            receiver: receiver.to_string(),
            dial_hz: target.dial_hz,
        };
        let mut open = lock(&self.open);
        if let Some(u) = open.get_mut(&key) {
            u.users += 1;
            return Joined {
                key,
                id: u.id,
                events: u.events.subscribe(),
                streaming: u.streaming,
            };
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (events, rx) = broadcast::channel(BUFFER);
        let (control, rx_control) = mpsc::channel(8);
        let (tx_events, rx_events) = mpsc::channel(BUFFER);
        open.insert(
            key.clone(),
            Upstream {
                id,
                events: events.clone(),
                control,
                users: 1,
                streaming: false,
            },
        );
        drop(open);
        tokio::spawn(kiwi::run(target.clone(), tx_events, rx_control));
        tokio::spawn(hub(self.clone(), id, rx_events, events));
        Joined {
            key,
            id,
            events: rx,
            streaming: false,
        }
    }

    /// Leaves a connection; the last session to leave stops it.
    pub fn leave(&self, joined: &Joined) {
        let mut open = lock(&self.open);
        let Some(u) = open.get_mut(&joined.key) else {
            return;
        };
        if u.id != joined.id {
            return;
        }
        u.users = u.users.saturating_sub(1);
        if u.users == 0 {
            let _ = u.control.try_send(Control::Stop);
            open.remove(&joined.key);
        }
    }

    /// Moves a session to the target's dial. Alone on its connection, with none on the new dial,
    /// it retunes that connection and keeps it. Otherwise it leaves and joins (or opens) the
    /// connection on the new dial. Returns whether it moved to another connection.
    pub fn retune(&self, joined: &mut Joined, target: &Target) -> bool {
        let to = Key {
            receiver: joined.key.receiver.clone(),
            dial_hz: target.dial_hz,
        };
        if to == joined.key {
            return false;
        }
        {
            let mut open = lock(&self.open);
            let alone = open
                .get(&joined.key)
                .is_some_and(|u| u.id == joined.id && u.users == 1);
            if alone && !open.contains_key(&to) {
                if let Some(u) = open.remove(&joined.key) {
                    let _ = u.control.try_send(Control::Tune(target.dial_hz));
                    open.insert(to.clone(), u);
                }
                joined.key = to;
                return false;
            }
        }
        self.leave(joined);
        *joined = self.join(&to.receiver, target);
        true
    }

    /// Connections open now, for tests and the status of the instance.
    pub fn count(&self) -> usize {
        lock(&self.open).len()
    }

    fn update(&self, id: u64, f: impl FnOnce(&mut HashMap<Key, Upstream>, Key)) {
        let mut open = lock(&self.open);
        if let Some(key) = open.iter().find(|(_, u)| u.id == id).map(|(k, _)| k.clone()) {
            f(&mut open, key);
        }
    }
}

/// Passes a connection's events to its sessions, keeping whether it streams. An ended connection
/// leaves the registry before its sessions hear, so a session joining after that opens a new one.
async fn hub(ups: Upstreams, id: u64, mut rx: mpsc::Receiver<Event>, tx: broadcast::Sender<Event>) {
    while let Some(e) = rx.recv().await {
        match &e {
            Event::Streaming => ups.update(id, |open, key| {
                if let Some(u) = open.get_mut(&key) {
                    u.streaming = true;
                }
            }),
            Event::Reconnecting { .. } => ups.update(id, |open, key| {
                if let Some(u) = open.get_mut(&key) {
                    u.streaming = false;
                }
            }),
            Event::Ended(_) => ups.update(id, |open, key| {
                open.remove(&key);
            }),
            _ => {}
        }
        // No session listening is fine: the last one left, and the connection is stopping.
        let _ = tx.send(e);
    }
}
