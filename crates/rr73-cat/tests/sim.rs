//! The requests RR73 makes, answered by the simulated IC-705 (`rr73_cat::sim`), through the
//! parser, as the app will run them: one request at a time, waiting for its answer.

use rr73_cat::ic705::{Addresses, Event, Filter, MenuItem, Mode, Parser, Request, Vfo};
use rr73_cat::sim::SimIc705;

/// A controller with one request in flight at a time, as the app's link will be.
struct Link {
    radio: SimIc705,
    parser: Parser,
    /// Events that answered nothing: transceive frames, echoes.
    unsolicited: Vec<Event>,
}

impl Link {
    fn new(radio: SimIc705) -> Self {
        Self {
            radio,
            parser: Parser::new(Addresses::default()),
            unsolicited: Vec::new(),
        }
    }

    /// Sends one request and returns its answer, delivering the radio's bytes one at a time.
    fn ask(&mut self, r: Request) -> Event {
        let out = self
            .radio
            .receive(&r.encode(Addresses::default()).expect("encodes"));
        let mut answer = None;
        for b in out {
            for e in self.parser.push(&[b]) {
                if answer.is_none() && r.answered_by(&e) {
                    answer = Some(e);
                } else {
                    self.unsolicited.push(e);
                }
            }
        }
        answer.expect("the radio answers")
    }
}

#[test]
fn sets_up_usb_d_for_ft8_on_20m() {
    let mut link = Link::new(SimIc705::new());
    link.radio.press_mode(Mode::Cw, Filter::Fil2);
    link.radio.turn_dial(7_030_000);
    // The order the design gives: frequency, mode with FIL1, data mode on with FIL1.
    assert_eq!(link.ask(Request::SetFrequency { hz: 14_074_000 }), Event::Ok);
    assert_eq!(
        link.ask(Request::SetMode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil1)
        }),
        Event::Ok
    );
    assert_eq!(
        link.ask(Request::SetDataMode {
            on: true,
            filter: Some(Filter::Fil1)
        }),
        Event::Ok
    );
    assert_eq!(
        link.ask(Request::ReadFrequency),
        Event::Frequency {
            hz: 14_074_000,
            transceive: false
        }
    );
    assert_eq!(
        link.ask(Request::ReadMode),
        Event::Mode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil1),
            transceive: false
        }
    );
    assert_eq!(
        link.ask(Request::ReadDataMode),
        Event::DataMode {
            on: true,
            filter: Some(Filter::Fil1)
        }
    );
    assert_eq!(
        link.ask(Request::ReadVfoMode { vfo: Vfo::Selected }),
        Event::VfoMode {
            vfo: Vfo::Selected,
            mode: Mode::Usb,
            data: Some(true),
            filter: Some(Filter::Fil1)
        }
    );
    // The same in one command with 26.
    link.radio.press_mode(Mode::Cw, Filter::Fil2);
    assert_eq!(
        link.ask(Request::SetVfoMode {
            vfo: Vfo::Selected,
            mode: Mode::Usb,
            data: true,
            filter: Filter::Fil1
        }),
        Event::Ok
    );
    assert!(link.radio.selected.data);
    assert_eq!(link.radio.selected.mode, Mode::Usb);
}

#[test]
fn keys_and_unkeys_the_transmitter() {
    let mut link = Link::new(SimIc705::new());
    assert_eq!(link.ask(Request::ReadTransmit), Event::Transmit { on: false });
    assert_eq!(link.ask(Request::SetTransmit { on: true }), Event::Ok);
    assert!(link.radio.transmit);
    assert_eq!(link.ask(Request::ReadTransmit), Event::Transmit { on: true });
    assert_eq!(link.ask(Request::SetTransmit { on: false }), Event::Ok);
    assert!(!link.radio.transmit);
    assert_eq!(link.radio.received.len(), 4);
}

#[test]
fn refusals_come_back_as_ng() {
    let mut link = Link::new(SimIc705::new());
    // Between the receiver's ranges (Basic Manual p. 11-1).
    assert_eq!(link.ask(Request::SetFrequency { hz: 300_000_000 }), Event::Ng);
    assert_eq!(link.radio.selected.hz, 14_074_000);
    link.radio.press_mode(Mode::Cw, Filter::Fil1);
    assert_eq!(
        link.ask(Request::SetDataMode {
            on: true,
            filter: Some(Filter::Fil1)
        }),
        Event::Ng
    );
    // A command the simulator does not model.
    let mut parser = Parser::new(Addresses::default());
    let out = link.radio.receive(&[0xFE, 0xFE, 0xA4, 0xE0, 0x19, 0x00, 0xFD]);
    assert_eq!(parser.push(&out), [Event::Ng]);
}

#[test]
fn echo_back_comes_ahead_of_the_answer() {
    let mut radio = SimIc705::new();
    radio.set_setting(MenuItem::CivUsbEchoBack, 1);
    let mut link = Link::new(radio);
    assert_eq!(
        link.ask(Request::ReadFrequency),
        Event::Frequency {
            hz: 14_074_000,
            transceive: false
        }
    );
    assert_eq!(link.unsolicited, [Event::Echo { command: 0x03 }]);
    assert_eq!(link.ask(Request::SetTransmit { on: true }), Event::Ok);
    assert_eq!(link.unsolicited.last(), Some(&Event::Echo { command: 0x1C }));
}

#[test]
fn transceive_reports_the_front_panel() {
    let mut radio = SimIc705::new();
    let mut parser = Parser::new(Addresses::default());
    assert_eq!(
        parser.push(&radio.turn_dial(7_074_000)),
        [Event::Frequency {
            hz: 7_074_000,
            transceive: true
        }]
    );
    assert_eq!(
        parser.push(&radio.press_mode(Mode::Lsb, Filter::Fil2)),
        [Event::Mode {
            mode: Mode::Lsb,
            filter: Some(Filter::Fil2),
            transceive: true
        }]
    );
    radio.set_setting(MenuItem::CivTransceive, 0);
    assert!(radio.turn_dial(7_047_500).is_empty());
    assert_eq!(radio.selected.hz, 7_047_500);
}

#[test]
fn transceive_frames_go_to_every_controller_and_parse_at_either_address() {
    let mut radio = SimIc705::new();
    let frame = radio.turn_dial(7_074_000);
    // FE FE 00 A4 00 ...: to address 00.
    assert_eq!(frame[2..5], [0x00, 0xA4, 0x00]);
    let mut parser = Parser::new(Addresses::default());
    let to_e0: Vec<u8> = frame
        .iter()
        .enumerate()
        .map(|(i, &b)| if i == 2 { 0xE0 } else { b })
        .collect();
    for bytes in [frame, to_e0] {
        assert_eq!(
            parser.push(&bytes),
            [Event::Frequency {
                hz: 7_074_000,
                transceive: true
            }]
        );
    }
}

#[test]
fn usb_send_keys_on_a_port_a_line_and_ptt_off_does_not_end_it() {
    let mut link = Link::new(SimIc705::new());
    let read = |link: &mut Link| link.ask(Request::ReadTransmit);
    // USB SEND off, its default: no line keys the radio.
    link.radio.set_lines(true, true);
    assert_eq!(read(&mut link), Event::Transmit { on: false });
    for (send, dtr, rts) in [(1, true, false), (2, false, true)] {
        link.radio.set_setting(MenuItem::UsbSend, send);
        link.radio.set_lines(dtr, rts);
        assert!(link.radio.line_keyed());
        assert_eq!(read(&mut link), Event::Transmit { on: true });
        assert_eq!(link.ask(Request::SetTransmit { on: false }), Event::Ok);
        assert_eq!(read(&mut link), Event::Transmit { on: true });
        link.radio.set_lines(false, false);
        assert_eq!(read(&mut link), Event::Transmit { on: false });
    }
    // Port B's lines are not modelled: USB (B) DTR keys nothing here.
    link.radio.set_setting(MenuItem::UsbSend, 3);
    link.radio.set_lines(true, true);
    assert_eq!(read(&mut link), Event::Transmit { on: false });
}

#[test]
fn reads_the_menu_defaults() {
    let mut link = Link::new(SimIc705::new());
    let read = |link: &mut Link, item| match link.ask(Request::ReadSetting { item }) {
        Event::Setting { item: i, value } if i == item => value,
        other => panic!("{other:?}"),
    };
    assert_eq!(read(&mut link, MenuItem::TimeOutTimer), 2);
    assert_eq!(read(&mut link, MenuItem::DataOffMod), 2);
    assert_eq!(read(&mut link, MenuItem::DataMod), 1);
    assert_eq!(read(&mut link, MenuItem::UsbSend), 0);
    assert_eq!(read(&mut link, MenuItem::CivTransceive), 1);
    assert_eq!(read(&mut link, MenuItem::CivUsbEchoBack), 0);
    link.radio.set_setting(MenuItem::DataMod, 0);
    assert_eq!(read(&mut link, MenuItem::DataMod), 0);
    // Values above the item's codes do not change it.
    link.radio.set_setting(MenuItem::DataMod, 9);
    assert_eq!(read(&mut link, MenuItem::DataMod), 0);
}

#[test]
fn both_vfos_answer() {
    let mut link = Link::new(SimIc705::new());
    assert_eq!(
        link.ask(Request::SetVfoFrequency {
            vfo: Vfo::Unselected,
            hz: 21_074_000
        }),
        Event::Ok
    );
    assert_eq!(
        link.ask(Request::ReadVfoFrequency { vfo: Vfo::Unselected }),
        Event::VfoFrequency {
            vfo: Vfo::Unselected,
            hz: 21_074_000
        }
    );
    assert_eq!(
        link.ask(Request::ReadVfoFrequency { vfo: Vfo::Selected }),
        Event::VfoFrequency {
            vfo: Vfo::Selected,
            hz: 14_074_000
        }
    );
}

#[test]
fn keeps_the_tuning_sets_that_arrive_while_transmitting() {
    let mut link = Link::new(SimIc705::new());
    // In receive: none counted.
    assert_eq!(link.ask(Request::SetFrequency { hz: 14_075_000 }), Event::Ok);
    assert!(link.radio.sets_while_transmitting.is_empty());
    assert_eq!(link.ask(Request::SetTransmit { on: true }), Event::Ok);
    // Reads, PTT and menu reads are not tuning.
    link.ask(Request::ReadFrequency);
    link.ask(Request::ReadDataMode);
    link.ask(Request::ReadVfoFrequency { vfo: Vfo::Selected });
    link.ask(Request::ReadVfoMode { vfo: Vfo::Selected });
    link.ask(Request::ReadSetting {
        item: MenuItem::UsbSend,
    });
    assert!(link.radio.sets_while_transmitting.is_empty());
    let sets = [
        Request::SetFrequency { hz: 14_074_000 },
        Request::SetMode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil1),
        },
        Request::SetDataMode {
            on: true,
            filter: Some(Filter::Fil1),
        },
        Request::SetVfoFrequency {
            vfo: Vfo::Unselected,
            hz: 7_074_000,
        },
        Request::SetVfoMode {
            vfo: Vfo::Selected,
            mode: Mode::Usb,
            data: true,
            filter: Filter::Fil1,
        },
    ];
    for r in sets {
        assert_eq!(link.ask(r), Event::Ok);
    }
    let commands: Vec<u8> = link
        .radio
        .sets_while_transmitting
        .iter()
        .map(|f| f.command)
        .collect();
    assert_eq!(commands, [0x05, 0x06, 0x1a, 0x25, 0x26]);
    assert_eq!(link.ask(Request::SetTransmit { on: false }), Event::Ok);
    assert_eq!(link.ask(Request::SetFrequency { hz: 14_074_000 }), Event::Ok);
    assert_eq!(link.radio.sets_while_transmitting.len(), 5);
}
