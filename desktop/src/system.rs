//! The system's serial ports on the `serialport` crate (MPL-2.0, used unmodified).

use std::io::{self, Read, Write};
use std::time::Duration;

use rr73_desktop::serial::{Backend, Device, OpenError, Parity, PortInfo, PortSettings};
use serialport::{DataBits, FlowControl, SerialPort, SerialPortType, StopBits};

/// How long one read waits for bytes: the longest a closing port's reader thread runs on.
const READ_TIMEOUT: Duration = Duration::from_millis(50);

/// The system's serial ports.
pub struct SystemPorts;

struct SystemDevice(Box<dyn SerialPort>);

impl Device for SystemDevice {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        Write::write_all(&mut self.0, bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        Write::flush(&mut self.0)
    }
    fn set_dtr(&mut self, on: bool) -> io::Result<()> {
        self.0.write_data_terminal_ready(on).map_err(io::Error::from)
    }
    fn set_rts(&mut self, on: bool) -> io::Result<()> {
        self.0.write_request_to_send(on).map_err(io::Error::from)
    }
    fn try_clone(&self) -> io::Result<Box<dyn Device>> {
        Ok(Box::new(SystemDevice(
            self.0.try_clone().map_err(io::Error::from)?,
        )))
    }
}

/// True for the errors a system gives when another program has the port. serialport reports them
/// as `NoDevice`, the same as a missing port, so the system's text tells them apart: EBUSY from
/// the exclusive open and a failed lock on Linux and macOS, "Access is denied" on Windows.
fn busy(e: &serialport::Error) -> bool {
    let d = e.description.to_ascii_lowercase();
    matches!(e.kind, serialport::ErrorKind::Io(io::ErrorKind::ResourceBusy))
        || d.contains("busy")
        || d.contains("access is denied")
        || d.contains("lock on serial port")
}

impl Backend for SystemPorts {
    fn list(&self) -> io::Result<Vec<PortInfo>> {
        let ports = serialport::available_ports().map_err(io::Error::from)?;
        Ok(ports
            .into_iter()
            .map(|p| match p.port_type {
                SerialPortType::UsbPort(u) => PortInfo {
                    name: p.port_name,
                    usb_vendor_id: Some(u.vid),
                    usb_product_id: Some(u.pid),
                    label: u.product.or(u.manufacturer),
                },
                _ => PortInfo {
                    name: p.port_name,
                    usb_vendor_id: None,
                    usb_product_id: None,
                    label: None,
                },
            })
            .collect())
    }

    fn open(&self, name: &str, s: &PortSettings) -> Result<Box<dyn Device>, OpenError> {
        let data_bits = if s.data_bits == 7 {
            DataBits::Seven
        } else {
            DataBits::Eight
        };
        let stop_bits = if s.stop_bits == 2 {
            StopBits::Two
        } else {
            StopBits::One
        };
        let parity = match s.parity {
            Parity::None => serialport::Parity::None,
            Parity::Even => serialport::Parity::Even,
            Parity::Odd => serialport::Parity::Odd,
        };
        let flow = if s.hardware_flow {
            FlowControl::Hardware
        } else {
            FlowControl::None
        };
        serialport::new(name, s.baud_rate)
            .data_bits(data_bits)
            .stop_bits(stop_bits)
            .parity(parity)
            .flow_control(flow)
            .dtr_on_open(false)
            .timeout(READ_TIMEOUT)
            .open()
            .map(|p| Box::new(SystemDevice(p)) as Box<dyn Device>)
            .map_err(|e| {
                if busy(&e) {
                    OpenError::Busy
                } else {
                    OpenError::Failed(e.description)
                }
            })
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use rr73_desktop::serial::{Event, Ports};
    use std::sync::Mutex;
    use std::sync::mpsc;

    const SETTINGS: PortSettings = PortSettings {
        baud_rate: 115_200,
        data_bits: 8,
        stop_bits: 1,
        parity: Parity::None,
        hardware_flow: false,
    };

    /// A pseudo-terminal pair stands in for the radio: RR73 opens the slave by name, as it opens a
    /// port the system lists, and the test plays the radio on the master.
    #[test]
    fn a_pty_carries_bytes_both_ways_and_reports_its_loss() {
        let (mut master, slave) = serialport::TTYPort::pair().expect("a pty pair");
        let name = slave.name().expect("the slave has a name");
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let ports = Ports::new(SystemPorts);
        let opened = ports
            .open(
                &name,
                &SETTINGS,
                Box::new(move |e| drop(tx.lock().map(|t| t.send(e)))),
            )
            .expect("the slave opens");
        master
            .write_all(&[0xfe, 0xfe, 0xe0, 0xfd])
            .expect("the radio writes");
        let mut got = Vec::new();
        while got.len() < 4 {
            match rx.recv_timeout(Duration::from_secs(2)).expect("data within 2 s") {
                Event::Data { bytes } => got.extend(bytes),
                Event::Lost => panic!("lost before the data"),
            }
        }
        assert_eq!(got, [0xfe, 0xfe, 0xe0, 0xfd]);
        ports.write(opened.id, b"FA;").expect("RR73 writes");
        let mut buf = [0u8; 3];
        master.read_exact(&mut buf).expect("the radio reads");
        assert_eq!(&buf, b"FA;");
        // The radio goes away: the slave's reads fail.
        drop(master);
        drop(slave);
        let mut lost = false;
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(2)) {
            if e == Event::Lost {
                lost = true;
                break;
            }
        }
        assert!(lost, "no lost event after the pty closed");
        ports.close(opened.id);
    }

    #[test]
    fn a_missing_port_fails_to_open() {
        let ports = Ports::new(SystemPorts);
        let r = ports.open("/dev/rr73-no-such-port", &SETTINGS, Box::new(|_| {}));
        assert!(matches!(r, Err(OpenError::Failed(_))), "{r:?}");
    }
}
