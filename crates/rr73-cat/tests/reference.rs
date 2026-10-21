//! Frames worked by hand from the IC-705 CI-V Reference Guide (A7560-8EX-6, January 2023),
//! with the default addresses: the radio at A4, the controller at E0 (p. 2). Page numbers are
//! the guide's printed numbers. The guide prints the frame layout (p. 2) and the data formats
//! (pp. 17 to 29) but no complete example frames, so each frame below follows those layouts.

use rr73_cat::ic705::{Addresses, Event, Fault, Filter, MenuItem, Mode, Parser, Request, Split, Vfo};

const A: Addresses = Addresses {
    radio: 0xA4,
    controller: 0xE0,
};

fn bytes(r: &Request) -> Vec<u8> {
    r.encode(A).expect("encodes")
}

fn events(b: &[u8]) -> Vec<Event> {
    Parser::new(A).push(b)
}

#[test]
fn page_2_frame_layout_and_answers() {
    // Controller to IC-705: FE FE A4 E0 Cn Sc data FD.
    assert_eq!(
        bytes(&Request::ReadFrequency),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x03, 0xFD]
    );
    // OK message to controller: FE FE E0 A4 FB FD. NG message: FE FE E0 A4 FA FD.
    assert_eq!(events(&[0xFE, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD]), [Event::Ok]);
    assert_eq!(events(&[0xFE, 0xFE, 0xE0, 0xA4, 0xFA, 0xFD]), [Event::Ng]);
}

#[test]
fn page_17_operating_frequency() {
    // Command 05 sets, 03 reads, 00 is transceive (command table p. 3). 14.074000 MHz in the
    // 5-byte layout: 00 (10 Hz, 1 Hz), 40 (1 kHz, 100 Hz), 07 (100 kHz, 10 kHz),
    // 14 (10 MHz, 1 MHz), 00 (1 GHz, 100 MHz).
    assert_eq!(
        bytes(&Request::SetFrequency { hz: 14_074_000 }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD]
    );
    // 7.074000 MHz and 50.313000 MHz.
    assert_eq!(
        bytes(&Request::SetFrequency { hz: 7_074_000 }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x40, 0x07, 0x07, 0x00, 0xFD]
    );
    assert_eq!(
        bytes(&Request::SetFrequency { hz: 50_313_000 }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x30, 0x31, 0x50, 0x00, 0xFD]
    );
    // 144.174000 MHz uses the 100 MHz digit.
    assert_eq!(
        bytes(&Request::SetFrequency { hz: 144_174_000 }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x05, 0x00, 0x40, 0x17, 0x44, 0x01, 0xFD]
    );
    let reply = [0xFE, 0xFE, 0xE0, 0xA4, 0x03, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD];
    assert_eq!(
        events(&reply),
        [Event::Frequency {
            hz: 14_074_000,
            transceive: false
        }]
    );
    let transceive = [0xFE, 0xFE, 0xE0, 0xA4, 0x00, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD];
    assert_eq!(
        events(&transceive),
        [Event::Frequency {
            hz: 14_074_000,
            transceive: true
        }]
    );
}

#[test]
fn page_17_operating_mode() {
    // Command 06 sets, 04 reads, 01 is transceive. Mode codes 00 LSB to 08 RTTY-R and 17 DV;
    // filter 01 FIL1 to 03 FIL3.
    assert_eq!(
        bytes(&Request::SetMode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil1)
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x06, 0x01, 0x01, 0xFD]
    );
    // The filter can be left out of 06; the radio selects the mode's default filter.
    assert_eq!(
        bytes(&Request::SetMode {
            mode: Mode::Dv,
            filter: None
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x06, 0x17, 0xFD]
    );
    assert_eq!(bytes(&Request::ReadMode), [0xFE, 0xFE, 0xA4, 0xE0, 0x04, 0xFD]);
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x04, 0x01, 0x02, 0xFD]),
        [Event::Mode {
            mode: Mode::Usb,
            filter: Some(Filter::Fil2),
            transceive: false
        }]
    );
    // A transceive 01 without the filter byte.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x01, 0x03, 0xFD]),
        [Event::Mode {
            mode: Mode::Cw,
            filter: None,
            transceive: true
        }]
    );
}

#[test]
fn page_22_data_mode_with_filter() {
    // 1A 06: data mode 00 off or 01 on, then the filter 01 to 03. With 00, the filter is 00 too.
    assert_eq!(
        bytes(&Request::SetDataMode {
            on: true,
            filter: Some(Filter::Fil1)
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x06, 0x01, 0x01, 0xFD]
    );
    assert_eq!(
        bytes(&Request::SetDataMode {
            on: false,
            filter: None
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x06, 0x00, 0x00, 0xFD]
    );
    assert_eq!(
        bytes(&Request::ReadDataMode),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x06, 0xFD]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x06, 0x01, 0x03, 0xFD]),
        [Event::DataMode {
            on: true,
            filter: Some(Filter::Fil3)
        }]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x06, 0x00, 0x00, 0xFD]),
        [Event::DataMode {
            on: false,
            filter: None
        }]
    );
    // An answer with the data mode alone is read too, with no filter.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x06, 0x01, 0xFD]),
        [Event::DataMode {
            on: true,
            filter: None
        }]
    );
    assert!(matches!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x06, 0x02, 0xFD])[..],
        [Event::Malformed { .. }]
    ));
}

#[test]
fn page_14_transmit_and_receive() {
    // 1C 00: the transceiver's status, 00 receive and 01 transmit, sent or read.
    assert_eq!(
        bytes(&Request::SetTransmit { on: true }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1C, 0x00, 0x01, 0xFD]
    );
    assert_eq!(
        bytes(&Request::SetTransmit { on: false }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1C, 0x00, 0x00, 0xFD]
    );
    assert_eq!(
        bytes(&Request::ReadTransmit),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1C, 0x00, 0xFD]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1C, 0x00, 0x01, 0xFD]),
        [Event::Transmit { on: true }]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1C, 0x00, 0x00, 0xFD]),
        [Event::Transmit { on: false }]
    );
}

#[test]
fn page_27_selected_and_unselected_vfo() {
    // 25: 00 selected or 01 unselected VFO, then the frequency of p. 17.
    assert_eq!(
        bytes(&Request::SetVfoFrequency {
            vfo: Vfo::Unselected,
            hz: 7_074_000
        }),
        [
            0xFE, 0xFE, 0xA4, 0xE0, 0x25, 0x01, 0x00, 0x40, 0x07, 0x07, 0x00, 0xFD
        ]
    );
    assert_eq!(
        events(&[
            0xFE, 0xFE, 0xE0, 0xA4, 0x25, 0x00, 0x00, 0x40, 0x07, 0x14, 0x00, 0xFD
        ]),
        [Event::VfoFrequency {
            vfo: Vfo::Selected,
            hz: 14_074_000
        }]
    );
    // 26: the VFO, the mode, the data mode (00 off, 01 on) and the filter.
    assert_eq!(
        bytes(&Request::SetVfoMode {
            vfo: Vfo::Selected,
            mode: Mode::Usb,
            data: true,
            filter: Filter::Fil1
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x26, 0x00, 0x01, 0x01, 0x01, 0xFD]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x26, 0x00, 0x01, 0x01, 0x01, 0xFD]),
        [Event::VfoMode {
            vfo: Vfo::Selected,
            mode: Mode::Usb,
            data: Some(true),
            filter: Some(Filter::Fil1)
        }]
    );
}

#[test]
fn pages_6_to_8_menu_settings() {
    // 1A 05 0119, SET > Connectors > MOD Input > DATA MOD (p. 8): 01 is USB.
    assert_eq!(
        bytes(&Request::ReadSetting {
            item: MenuItem::DataMod
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x05, 0x01, 0x19, 0xFD]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x05, 0x01, 0x19, 0x01, 0xFD]),
        [Event::Setting {
            item: MenuItem::DataMod,
            value: 1
        }]
    );
    // 1A 05 0043, Time-Out Timer (p. 6): 02 is 5 min.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x1A, 0x05, 0x00, 0x43, 0x02, 0xFD]),
        [Event::Setting {
            item: MenuItem::TimeOutTimer,
            value: 2
        }]
    );
    // 1A 05 0132, CI-V USB Echo Back (p. 8).
    assert_eq!(
        bytes(&Request::ReadSetting {
            item: MenuItem::CivUsbEchoBack
        }),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x1A, 0x05, 0x01, 0x32, 0xFD]
    );
}

#[test]
fn another_radio_address() {
    // CI-V Address is a setting (Basic Manual p. 8-16); the frames follow it.
    let a = Addresses {
        radio: 0x94,
        controller: 0xE0,
    };
    assert_eq!(
        Request::ReadTransmit.encode(a),
        Ok(vec![0xFE, 0xFE, 0x94, 0xE0, 0x1C, 0x00, 0xFD])
    );
    assert_eq!(
        Parser::new(a).push(&[0xFE, 0xFE, 0xE0, 0x94, 0xFB, 0xFD]),
        [Event::Ok]
    );
    // From A4 with the radio at 94: another device.
    assert_eq!(
        Parser::new(a).push(&[0xFE, 0xFE, 0xE0, 0xA4, 0xFB, 0xFD]),
        [Event::OtherAddress {
            to: 0xE0,
            from: 0xA4,
            command: 0xFB
        }]
    );
}

#[test]
fn page_3_split_and_duplex() {
    // 0F with no data reads; the answer carries 00 split off, 01 split on, 11 DUP- or 12 DUP+.
    assert_eq!(bytes(&Request::ReadSplit), [0xFE, 0xFE, 0xA4, 0xE0, 0x0F, 0xFD]);
    for (code, split) in [
        (0x00, Split::Off),
        (0x01, Split::On),
        (0x11, Split::DupMinus),
        (0x12, Split::DupPlus),
    ] {
        assert_eq!(
            events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x0F, code, 0xFD]),
            [Event::Split { split }]
        );
    }
    // 10 sets simplex. The guide gives it as no answer to a read, but a radio that answers it
    // reads as split off; a code p. 3 does not list is malformed.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x0F, 0x10, 0xFD]),
        [Event::Split { split: Split::Off }]
    );
    for code in [0x02, 0x13] {
        assert_eq!(
            events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x0F, code, 0xFD]),
            [Event::Malformed {
                command: 0x0F,
                fault: Fault::Code
            }]
        );
    }
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x0F, 0xFD]),
        [Event::Malformed {
            command: 0x0F,
            fault: Fault::Length
        }]
    );
}

#[test]
fn pages_15_and_27_rit_and_delta_tx() {
    // 21 00 the RIT frequency, 21 01 RIT, 21 02 ΔTX (p. 15).
    assert_eq!(
        bytes(&Request::ReadRitOffset),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x21, 0x00, 0xFD]
    );
    assert_eq!(
        bytes(&Request::ReadRit),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x21, 0x01, 0xFD]
    );
    assert_eq!(
        bytes(&Request::ReadXit),
        [0xFE, 0xFE, 0xA4, 0xE0, 0x21, 0x02, 0xFD]
    );
    // p. 27: 10 Hz and 1 Hz, then 1 kHz and 100 Hz, then 00 plus or 01 minus. +1230 Hz and -50 Hz.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x30, 0x12, 0x00, 0xFD]),
        [Event::RitOffset { hz: 1230 }]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x50, 0x00, 0x01, 0xFD]),
        [Event::RitOffset { hz: -50 }]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x99, 0x99, 0x01, 0xFD]),
        [Event::RitOffset { hz: -9999 }]
    );
    assert_eq!(rr73_cat::ic705::encode_rit_offset(1230), Some([0x30, 0x12, 0x00]));
    assert_eq!(rr73_cat::ic705::encode_rit_offset(-50), Some([0x50, 0x00, 0x01]));
    assert_eq!(rr73_cat::ic705::encode_rit_offset(10_000), None);
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x01, 0x01, 0xFD]),
        [Event::Rit { on: true }]
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x02, 0x00, 0xFD]),
        [Event::Xit { on: false }]
    );
    let malformed = |fault| [Event::Malformed { command: 0x21, fault }];
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x3A, 0x12, 0x00, 0xFD]),
        malformed(Fault::NotBcd)
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x30, 0x12, 0x02, 0xFD]),
        malformed(Fault::Code)
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x00, 0x30, 0x12, 0xFD]),
        malformed(Fault::Length)
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x01, 0x02, 0xFD]),
        malformed(Fault::Code)
    );
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x02, 0xFD]),
        malformed(Fault::Length)
    );
    // Sub-command 03 is not in the table.
    assert_eq!(
        events(&[0xFE, 0xFE, 0xE0, 0xA4, 0x21, 0x03, 0x01, 0xFD]),
        [Event::Unknown {
            command: 0x21,
            data: vec![0x03, 0x01]
        }]
    );
    assert!(Request::ReadRit.answered_by(&Event::Rit { on: false }));
    assert!(!Request::ReadRit.answered_by(&Event::Xit { on: false }));
    assert!(Request::ReadXit.answered_by(&Event::Xit { on: true }));
    assert!(Request::ReadRitOffset.answered_by(&Event::RitOffset { hz: 0 }));
    assert!(Request::ReadSplit.answered_by(&Event::Split { split: Split::On }));
    assert!(Request::ReadSplit.answered_by(&Event::Ng));
    assert!(!Request::ReadSplit.answered_by(&Event::Ok));
}

#[test]
fn which_events_answer_which_requests() {
    let freq = Event::Frequency {
        hz: 1,
        transceive: false,
    };
    let transceive = Event::Frequency {
        hz: 1,
        transceive: true,
    };
    let set = Request::SetFrequency { hz: 14_074_000 };
    assert!(set.answered_by(&Event::Ok));
    assert!(set.answered_by(&Event::Ng));
    assert!(!set.answered_by(&freq));
    assert!(Request::ReadFrequency.answered_by(&freq));
    assert!(Request::ReadFrequency.answered_by(&Event::Ng));
    assert!(!Request::ReadFrequency.answered_by(&Event::Ok));
    assert!(!Request::ReadFrequency.answered_by(&transceive));
    assert!(!Request::ReadFrequency.answered_by(&Event::Echo { command: 0x03 }));
    assert!(Request::ReadFrequency.answered_by(&Event::Malformed {
        command: 0x03,
        fault: rr73_cat::Fault::NotBcd
    }));
    assert!(!Request::ReadMode.answered_by(&Event::Malformed {
        command: 0x03,
        fault: rr73_cat::Fault::NotBcd
    }));
    let unselected = Request::ReadVfoFrequency { vfo: Vfo::Unselected };
    assert!(!unselected.answered_by(&Event::VfoFrequency {
        vfo: Vfo::Selected,
        hz: 1
    }));
    assert!(unselected.answered_by(&Event::VfoFrequency {
        vfo: Vfo::Unselected,
        hz: 1
    }));
    let tot = Request::ReadSetting {
        item: MenuItem::TimeOutTimer,
    };
    assert!(tot.answered_by(&Event::Setting {
        item: MenuItem::TimeOutTimer,
        value: 2
    }));
    assert!(!tot.answered_by(&Event::Setting {
        item: MenuItem::DataMod,
        value: 1
    }));
    assert!(Request::ReadTransmit.answered_by(&Event::Transmit { on: false }));
    assert!(Request::SetTransmit { on: false }.answered_by(&Event::Ok));
}
