//! The serial ports the desktop app has open, behind the same behaviour as the web app's Web
//! Serial link (`web/src/lib/cat/serial.ts`, `docs/design/cat.md`).
//!
//! [`Ports::open`] opens a port and lowers DTR and RTS at once, before the call returns and before
//! any write: an IC-705 with USB SEND on a line of the port, and a Digirig whose PTT follows RTS,
//! would key while either is raised. The operating system may raise them while it opens the port;
//! lowering them here leaves that window at the time of two system calls. A port whose lines could
//! not be lowered stays open and reports `lines_low` false; the app decides whether to keep it.
//!
//! Each open port has a reader thread. It reads with a short timeout, so closing the port stops it
//! within one timeout, and sends every chunk to the port's sink. A read that fails for any other
//! reason than the timeout, or that returns end of file, means the port went away: the sink hears
//! [`Event::Lost`] once and the thread ends. The app then closes the port.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// One serial port the system offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    /// The system's name for the port: `COM4`, `/dev/ttyACM0`, `/dev/cu.usbmodem14101`.
    pub name: String,
    /// USB vendor ID, for a USB port.
    pub usb_vendor_id: Option<u16>,
    /// USB product ID, for a USB port.
    pub usb_product_id: Option<u16>,
    /// The device's product or manufacturer text, where the system gives one.
    pub label: Option<String>,
}

/// Parity of a port's characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Parity {
    /// No parity bit.
    None,
    /// Even parity.
    Even,
    /// Odd parity.
    Odd,
}

/// How a port opens. The names follow Web Serial's `SerialOptions`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortSettings {
    /// Bits per second.
    pub baud_rate: u32,
    /// 7 or 8.
    pub data_bits: u8,
    /// 1 or 2.
    pub stop_bits: u8,
    /// Parity.
    pub parity: Parity,
    /// RTS/CTS flow control. Off for every radio RR73 knows.
    pub hardware_flow: bool,
}

/// Why a port did not open.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "kind", content = "detail")]
pub enum OpenError {
    /// Another program, or this one, has the port open.
    #[error("the port is in use")]
    Busy,
    /// Anything else: no such port, refused settings, a driver error.
    #[error("the port did not open: {0}")]
    Failed(String),
}

/// A failure on a port that is open, or one that is not.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "kind", content = "detail")]
pub enum PortError {
    /// No open port has this ID: it was closed, or never opened.
    #[error("the port is not open")]
    NotOpen,
    /// The system refused the operation.
    #[error("the port failed: {0}")]
    Io(String),
}

/// What a port's reader hands its sink.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "type")]
pub enum Event {
    /// Bytes the port delivered, in order.
    Data {
        /// The bytes.
        bytes: Vec<u8>,
    },
    /// The port went away. Sent once, and nothing follows it.
    Lost,
}

/// An open port as [`Ports::open`] reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The ID the other calls take.
    pub id: u32,
    /// DTR and RTS were lowered.
    pub lines_low: bool,
}

/// One open port of the system. Reads return within the read timeout the backend set: a read
/// with nothing to deliver fails with [`io::ErrorKind::TimedOut`] or [`io::ErrorKind::WouldBlock`].
pub trait Device: Send {
    /// Reads what has arrived, up to `buf.len()` bytes. `Ok(0)` means the port is gone.
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize>;
    /// Writes all of `bytes`.
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()>;
    /// Waits until what was written has gone out.
    fn flush(&mut self) -> io::Result<()>;
    /// Raises (true) or lowers (false) DTR.
    fn set_dtr(&mut self, on: bool) -> io::Result<()>;
    /// Raises (true) or lowers (false) RTS.
    fn set_rts(&mut self, on: bool) -> io::Result<()>;
    /// A second handle on the same port, for the reader thread.
    fn try_clone(&self) -> io::Result<Box<dyn Device>>;
}

/// The system's serial ports.
pub trait Backend: Send + Sync {
    /// The ports there are now.
    fn list(&self) -> io::Result<Vec<PortInfo>>;
    /// Opens the port called `name`.
    fn open(&self, name: &str, settings: &PortSettings) -> Result<Box<dyn Device>, OpenError>;
}

/// Receives a port's events on its reader thread.
pub type Sink = Box<dyn Fn(Event) + Send + 'static>;

/// Largest chunk one read delivers, bytes.
const READ_CHUNK: usize = 4096;

struct OpenPort {
    name: String,
    writer: Mutex<Box<dyn Device>>,
    stop: Arc<AtomicBool>,
    reader: Mutex<Option<JoinHandle<()>>>,
}

/// The ports the app has open, by ID.
pub struct Ports<B: Backend> {
    backend: B,
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<OpenPort>>>,
}

fn lock<T: ?Sized>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A thread that panicked while holding a lock leaves plain data behind: keep using it.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn quiet(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

impl<B: Backend> Ports<B> {
    /// A manager with no port open.
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            next: AtomicU32::new(1),
            open: Mutex::new(HashMap::new()),
        }
    }

    /// The ports there are now.
    pub fn list(&self) -> Result<Vec<PortInfo>, PortError> {
        self.backend.list().map_err(|e| PortError::Io(e.to_string()))
    }

    /// Opens the port called `name`, lowers DTR and RTS, and starts reading into `sink`. A port
    /// this manager has open already is [`OpenError::Busy`].
    pub fn open(&self, name: &str, settings: &PortSettings, sink: Sink) -> Result<Opened, OpenError> {
        if lock(&self.open).values().any(|p| p.name == name) {
            return Err(OpenError::Busy);
        }
        let mut device = self.backend.open(name, settings)?;
        // Before anything else: the system may have raised both lines while opening.
        let dtr = device.set_dtr(false).is_ok();
        let rts = device.set_rts(false).is_ok();
        let mut reader = device.try_clone().map_err(|e| OpenError::Failed(e.to_string()))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let handle = std::thread::Builder::new()
            .name(format!("serial {name}"))
            .spawn(move || {
                let mut buf = vec![0u8; READ_CHUNK];
                while !stopped.load(Ordering::Acquire) {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => sink(Event::Data {
                            bytes: buf[..n].to_vec(),
                        }),
                        Err(e) if quiet(&e) => {}
                        Err(_) => break,
                    }
                }
                // Closed by the app: it knows. Otherwise the port went away.
                if !stopped.swap(true, Ordering::AcqRel) {
                    sink(Event::Lost);
                }
            })
            .map_err(|e| OpenError::Failed(e.to_string()))?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let port = OpenPort {
            name: name.to_owned(),
            writer: Mutex::new(device),
            stop,
            reader: Mutex::new(Some(handle)),
        };
        lock(&self.open).insert(id, Arc::new(port));
        Ok(Opened {
            id,
            lines_low: dtr && rts,
        })
    }

    fn port(&self, id: u32) -> Result<Arc<OpenPort>, PortError> {
        lock(&self.open).get(&id).cloned().ok_or(PortError::NotOpen)
    }

    /// Writes `bytes` after everything written before.
    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), PortError> {
        let port = self.port(id)?;
        if port.stop.load(Ordering::Acquire) {
            return Err(PortError::NotOpen);
        }
        lock(&port.writer)
            .write_all(bytes)
            .map_err(|e| PortError::Io(e.to_string()))
    }

    /// Sets DTR and RTS; `None` leaves a line as it is.
    pub fn set_lines(&self, id: u32, dtr: Option<bool>, rts: Option<bool>) -> Result<(), PortError> {
        let port = self.port(id)?;
        let mut d = lock(&port.writer);
        if let Some(on) = dtr {
            d.set_dtr(on).map_err(|e| PortError::Io(e.to_string()))?;
        }
        if let Some(on) = rts {
            d.set_rts(on).map_err(|e| PortError::Io(e.to_string()))?;
        }
        Ok(())
    }

    /// Lets what was written go out, stops the reader and closes the port. Closing a port that is
    /// not open does nothing.
    pub fn close(&self, id: u32) {
        let Some(port) = lock(&self.open).remove(&id) else {
            return;
        };
        let lost = port.stop.swap(true, Ordering::AcqRel);
        if !lost {
            // A port that went away has nothing to flush.
            let _ = lock(&port.writer).flush();
        }
        let handle = lock(&port.reader).take();
        if let Some(h) = handle {
            // The reader ends within one read timeout; a panic in it leaves nothing to clean up.
            let _ = h.join();
        }
    }

    /// The number of ports open, for tests and the app's shutdown.
    pub fn open_count(&self) -> usize {
        lock(&self.open).len()
    }

    /// Closes every port.
    pub fn close_all(&self) {
        let ids: Vec<u32> = lock(&self.open).keys().copied().collect();
        for id in ids {
            self.close(id);
        }
    }
}

impl<B: Backend> Drop for Ports<B> {
    fn drop(&mut self) {
        self.close_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::mpsc;
    use std::time::Duration;

    /// What a fake port does on its next read.
    enum Step {
        Bytes(Vec<u8>),
        Fail(io::ErrorKind),
        Eof,
    }

    #[derive(Default)]
    struct Wire {
        reads: VecDeque<Step>,
        written: Vec<u8>,
        dtr: Option<bool>,
        rts: Option<bool>,
        refuse_lines: bool,
        flushed: usize,
    }

    #[derive(Clone)]
    struct FakeDevice(Arc<Mutex<Wire>>);

    impl Device for FakeDevice {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let step = lock(&self.0).reads.pop_front();
            match step {
                Some(Step::Bytes(b)) => {
                    buf[..b.len()].copy_from_slice(&b);
                    Ok(b.len())
                }
                Some(Step::Fail(kind)) => Err(io::Error::from(kind)),
                Some(Step::Eof) => Ok(0),
                None => {
                    std::thread::sleep(Duration::from_millis(2));
                    Err(io::Error::from(io::ErrorKind::TimedOut))
                }
            }
        }
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            lock(&self.0).written.extend_from_slice(bytes);
            Ok(())
        }
        fn flush(&mut self) -> io::Result<()> {
            lock(&self.0).flushed += 1;
            Ok(())
        }
        fn set_dtr(&mut self, on: bool) -> io::Result<()> {
            let mut w = lock(&self.0);
            if w.refuse_lines {
                return Err(io::Error::other("refused"));
            }
            w.dtr = Some(on);
            Ok(())
        }
        fn set_rts(&mut self, on: bool) -> io::Result<()> {
            let mut w = lock(&self.0);
            if w.refuse_lines {
                return Err(io::Error::other("refused"));
            }
            w.rts = Some(on);
            Ok(())
        }
        fn try_clone(&self) -> io::Result<Box<dyn Device>> {
            Ok(Box::new(self.clone()))
        }
    }

    struct FakeBackend {
        wire: Arc<Mutex<Wire>>,
        busy: bool,
    }

    impl Backend for FakeBackend {
        fn list(&self) -> io::Result<Vec<PortInfo>> {
            Ok(vec![PortInfo {
                name: "COM4".into(),
                usb_vendor_id: Some(0x0c26),
                usb_product_id: Some(0x0036),
                label: Some("IC-705".into()),
            }])
        }
        fn open(&self, _name: &str, _settings: &PortSettings) -> Result<Box<dyn Device>, OpenError> {
            if self.busy {
                return Err(OpenError::Busy);
            }
            Ok(Box::new(FakeDevice(self.wire.clone())))
        }
    }

    const SETTINGS: PortSettings = PortSettings {
        baud_rate: 115_200,
        data_bits: 8,
        stop_bits: 1,
        parity: Parity::None,
        hardware_flow: false,
    };

    fn setup(wire: Wire) -> (Ports<FakeBackend>, Arc<Mutex<Wire>>) {
        let wire = Arc::new(Mutex::new(wire));
        (
            Ports::new(FakeBackend {
                wire: wire.clone(),
                busy: false,
            }),
            wire,
        )
    }

    fn channel() -> (Sink, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Box::new(move |e| drop(lock(&tx).send(e))), rx)
    }

    fn next(rx: &mpsc::Receiver<Event>) -> Event {
        rx.recv_timeout(Duration::from_secs(2))
            .expect("an event within 2 s")
    }

    #[test]
    fn open_lowers_both_lines_before_returning() {
        let (ports, wire) = setup(Wire {
            dtr: Some(true),
            rts: Some(true),
            ..Wire::default()
        });
        let (sink, _rx) = channel();
        let opened = ports.open("COM4", &SETTINGS, sink).expect("opens");
        assert!(opened.lines_low);
        let w = lock(&wire);
        assert_eq!((w.dtr, w.rts), (Some(false), Some(false)));
        assert!(w.written.is_empty());
    }

    #[test]
    fn lines_that_cannot_be_lowered_are_reported() {
        let (ports, _wire) = setup(Wire {
            refuse_lines: true,
            ..Wire::default()
        });
        let (sink, _rx) = channel();
        let opened = ports.open("COM4", &SETTINGS, sink).expect("opens");
        assert!(!opened.lines_low);
        assert_eq!(ports.open_count(), 1);
    }

    #[test]
    fn chunks_arrive_in_order_and_writes_go_out_in_order() {
        let mut reads = VecDeque::new();
        reads.push_back(Step::Bytes(vec![0xfe, 0xfe]));
        reads.push_back(Step::Fail(io::ErrorKind::TimedOut));
        reads.push_back(Step::Bytes(vec![0xe0, 0xfd]));
        let (ports, wire) = setup(Wire {
            reads,
            ..Wire::default()
        });
        let (sink, rx) = channel();
        let id = ports.open("COM4", &SETTINGS, sink).expect("opens").id;
        assert_eq!(
            next(&rx),
            Event::Data {
                bytes: vec![0xfe, 0xfe]
            }
        );
        assert_eq!(
            next(&rx),
            Event::Data {
                bytes: vec![0xe0, 0xfd]
            }
        );
        ports.write(id, b"FA;").expect("writes");
        ports.write(id, b"TQ;").expect("writes");
        assert_eq!(lock(&wire).written, b"FA;TQ;");
    }

    #[test]
    fn a_failed_read_reports_lost_once() {
        let mut reads = VecDeque::new();
        reads.push_back(Step::Fail(io::ErrorKind::BrokenPipe));
        let (ports, _wire) = setup(Wire {
            reads,
            ..Wire::default()
        });
        let (sink, rx) = channel();
        let id = ports.open("COM4", &SETTINGS, sink).expect("opens").id;
        assert_eq!(next(&rx), Event::Lost);
        assert_eq!(ports.write(id, b"x"), Err(PortError::NotOpen));
        ports.close(id);
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
        assert_eq!(ports.open_count(), 0);
    }

    #[test]
    fn end_of_file_reports_lost() {
        let mut reads = VecDeque::new();
        reads.push_back(Step::Eof);
        let (ports, _wire) = setup(Wire {
            reads,
            ..Wire::default()
        });
        let (sink, rx) = channel();
        ports.open("COM4", &SETTINGS, sink).expect("opens");
        assert_eq!(next(&rx), Event::Lost);
    }

    #[test]
    fn close_flushes_stops_the_reader_and_sends_no_lost() {
        let (ports, wire) = setup(Wire::default());
        let (sink, rx) = channel();
        let id = ports.open("COM4", &SETTINGS, sink).expect("opens").id;
        ports.close(id);
        assert_eq!(lock(&wire).flushed, 1);
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err());
        assert_eq!(ports.write(id, b"x"), Err(PortError::NotOpen));
        // Closing again does nothing.
        ports.close(id);
    }

    #[test]
    fn a_port_open_already_is_busy() {
        let (ports, _wire) = setup(Wire::default());
        let (a, _ra) = channel();
        let (b, _rb) = channel();
        ports.open("COM4", &SETTINGS, a).expect("opens");
        assert_eq!(ports.open("COM4", &SETTINGS, b).err(), Some(OpenError::Busy));
    }

    #[test]
    fn a_busy_port_is_reported_as_busy() {
        let wire = Arc::new(Mutex::new(Wire::default()));
        let ports = Ports::new(FakeBackend { wire, busy: true });
        let (sink, _rx) = channel();
        assert_eq!(ports.open("COM4", &SETTINGS, sink).err(), Some(OpenError::Busy));
        assert_eq!(ports.open_count(), 0);
    }

    #[test]
    fn set_lines_reaches_the_device() {
        let (ports, wire) = setup(Wire::default());
        let (sink, _rx) = channel();
        let id = ports.open("COM4", &SETTINGS, sink).expect("opens").id;
        ports.set_lines(id, Some(true), None).expect("sets");
        let lines = {
            let w = lock(&wire);
            (w.dtr, w.rts)
        };
        assert_eq!(lines, (Some(true), Some(false)));
        assert_eq!(
            ports.set_lines(99, Some(false), Some(false)),
            Err(PortError::NotOpen)
        );
    }

    #[test]
    fn events_and_errors_serialise_for_the_web_app() {
        let data = serde_json::to_string(&Event::Data { bytes: vec![1, 2] }).expect("serialises");
        assert_eq!(data, r#"{"type":"data","bytes":[1,2]}"#);
        assert_eq!(
            serde_json::to_string(&Event::Lost).expect("serialises"),
            r#"{"type":"lost"}"#
        );
        assert_eq!(
            serde_json::to_string(&OpenError::Busy).expect("serialises"),
            r#"{"kind":"busy"}"#
        );
        let s: PortSettings = serde_json::from_str(
            r#"{"baudRate":4800,"dataBits":8,"stopBits":1,"parity":"none","hardwareFlow":false}"#,
        )
        .expect("parses");
        assert_eq!(s.baud_rate, 4800);
    }
}
