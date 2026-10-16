//! Each request against the simulated KX2 (`rr73_cat::sim_kx2`): the answers RR73 reads, the sets
//! and their read-back, transmit and receive, the Digirig's PTT on the MIC jack, the menu read,
//! band-change reports, auto-info, and sets that arrive while the radio transmits.

use rr73_cat::elecraft::{DataSubMode, Event, MENU_NONE, MIC_BTN_PTT, MenuItem, Mode, Parser, Request};
use rr73_cat::sim_kx2::SimKx2;

/// Sends a request and returns the events of the radio's answer.
fn ask(radio: &mut SimKx2, r: &Request) -> Vec<Event> {
    Parser::new().push(&radio.receive(&r.encode().expect("encode")))
}

/// The one event that answers `r`, and that there is exactly one.
fn answer(radio: &mut SimKx2, r: &Request) -> Event {
    let answers: Vec<Event> = ask(radio, r).into_iter().filter(|e| r.answered_by(e)).collect();
    assert_eq!(answers.len(), 1, "{r:?}: {answers:?}");
    answers[0].clone()
}

#[test]
fn reads_answer_with_the_radio_state() {
    let mut radio = SimKx2::new();
    radio.band_reports = false;
    assert_eq!(
        answer(&mut radio, &Request::ReadFrequency),
        Event::Frequency {
            hz: 14_074_000,
            transceive: false
        }
    );
    assert_eq!(
        answer(&mut radio, &Request::ReadMode),
        Event::Mode {
            mode: Mode::Usb,
            transceive: false
        }
    );
    assert_eq!(
        answer(&mut radio, &Request::ReadDataSubMode),
        Event::DataSubMode {
            sub: DataSubMode::DataA
        }
    );
    assert_eq!(
        answer(&mut radio, &Request::ReadTransmit),
        Event::Transmit { on: false }
    );
    assert_eq!(
        answer(&mut radio, &Request::ReadOptions),
        Event::Options {
            product: Some(1),
            modules: "----------".into()
        }
    );
    assert_eq!(answer(&mut radio, &Request::ReadVox), Event::Vox { on: false });
    assert_eq!(
        answer(&mut radio, &Request::ReadMenuEntry),
        Event::MenuEntry { entry: MENU_NONE }
    );
}

#[test]
fn sets_are_read_back_and_accepted() {
    let mut radio = SimKx2::new();
    radio.band_reports = false;
    let set = Request::SetFrequency { hz: 14_076_000 };
    assert!(set.accepted_by(&answer(&mut radio, &set)));
    assert_eq!(radio.hz, 14_076_000);
    // The Hz digit is dropped outside FINE tuning, and the read-back still accepts the set.
    let fine = Request::SetFrequency { hz: 14_074_005 };
    assert!(fine.accepted_by(&answer(&mut radio, &fine)));
    assert_eq!(radio.hz, 14_074_000);
    let data = Request::SetMode { mode: Mode::Data };
    assert!(data.accepted_by(&answer(&mut radio, &data)));
    let sub = Request::SetDataSubMode {
        sub: DataSubMode::DataA,
    };
    assert!(sub.accepted_by(&answer(&mut radio, &sub)));
    assert_eq!((radio.mode, radio.sub), (Mode::Data, DataSubMode::DataA));
    // In DATA A, VOX reads the data setting.
    radio.vox_data = true;
    assert_eq!(answer(&mut radio, &Request::ReadVox), Event::Vox { on: true });
}

#[test]
fn a_set_the_radio_does_not_take_is_refused_by_its_read_back() {
    let mut radio = SimKx2::new();
    // Outside the receive range the dial stays.
    let far = Request::SetFrequency { hz: 50_313_000 };
    let e = answer(&mut radio, &far);
    assert!(far.answered_by(&e) && !far.accepted_by(&e));
    assert_eq!(radio.hz, 14_074_000);
    // No FM on the KX2: ?; then the read-back of the old mode.
    let fm = Request::SetMode { mode: Mode::Fm };
    let got = ask(&mut radio, &fm);
    assert_eq!(
        got,
        [
            Event::Busy,
            Event::Mode {
                mode: Mode::Usb,
                transceive: false
            }
        ]
    );
    assert!(!fm.accepted_by(&got[0]));
}

#[test]
fn transmit_and_receive_read_back_by_tq() {
    let mut radio = SimKx2::new();
    let on = Request::SetTransmit { on: true };
    assert!(on.accepted_by(&answer(&mut radio, &on)));
    assert!(radio.transmitting());
    let off = Request::SetTransmit { on: false };
    assert!(off.accepted_by(&answer(&mut radio, &off)));
    assert!(!radio.transmitting());
    assert_eq!(radio.received, ["TX", "TQ", "RX", "TQ"]);
}

#[test]
fn tx_does_nothing_in_fsk_d_and_psk_d() {
    let mut radio = SimKx2::new();
    radio.mode = Mode::Data;
    for sub in [DataSubMode::FskD, DataSubMode::PskD] {
        radio.sub = sub;
        let on = Request::SetTransmit { on: true };
        let e = answer(&mut radio, &on);
        assert!(!on.accepted_by(&e), "{sub:?}");
        assert!(!radio.transmitting());
    }
    radio.sub = DataSubMode::DataA;
    assert!(
        Request::SetTransmit { on: true }
            .accepted_by(&answer(&mut radio, &Request::SetTransmit { on: true }))
    );
}

#[test]
fn the_digirig_ptt_keys_the_radio_through_the_mic_jack_while_rts_is_asserted() {
    let mut radio = SimKx2::new();
    // A port opening raises RTS: MIC BTN at its default reads the ring as PTT.
    radio.set_lines(true, true);
    assert!(radio.line_keyed() && radio.transmitting());
    assert_eq!(
        answer(&mut radio, &Request::ReadTransmit),
        Event::Transmit { on: true }
    );
    // RX does not end it; lowering RTS does.
    let off = Request::SetTransmit { on: false };
    assert!(!off.accepted_by(&answer(&mut radio, &off)));
    radio.set_lines(false, false);
    assert!(!radio.transmitting());
    // DTR alone keys nothing.
    radio.set_lines(true, false);
    assert!(!radio.transmitting());
    // MIC BTN OFF, or a cable without the PTT line: RTS keys nothing.
    radio.set_lines(false, true);
    radio.mic_btn = 0;
    assert!(!radio.transmitting());
    radio.mic_btn = MIC_BTN_PTT;
    radio.digirig_ptt = false;
    assert!(!radio.transmitting());
}

#[test]
fn the_menu_read_enters_mic_btn_reads_it_and_leaves_the_menu() {
    let mut radio = SimKx2::new();
    let read = Request::ReadSetting {
        item: MenuItem::MicBtn,
    };
    assert_eq!(answer(&mut radio, &read), Event::MenuValue { value: 5 });
    assert_eq!(radio.menu, MENU_NONE);
    radio.mic_btn = 0;
    assert_eq!(answer(&mut radio, &read), Event::MenuValue { value: 0 });
    // MP outside MIC BTN, and with no menu: ?;.
    assert_eq!(Parser::new().push(&radio.receive(b"MP;")), [Event::Busy]);
    // The operator's own menu entry shows in MN.
    radio.open_menu(57);
    assert_eq!(
        answer(&mut radio, &Request::ReadMenuEntry),
        Event::MenuEntry { entry: 57 }
    );
}

#[test]
fn a_band_change_sends_reports_before_the_read_back() {
    let mut radio = SimKx2::new();
    let set = Request::SetFrequency { hz: 7_074_000 };
    let got = ask(&mut radio, &set);
    assert!(matches!(got[0], Event::Info { hz: 7_074_000, .. }));
    // The reported FA and the read-back both answer the set; the first accepts it.
    let answers: Vec<&Event> = got.iter().filter(|e| set.answered_by(e)).collect();
    assert_eq!(answers.len(), 2);
    assert!(set.accepted_by(answers[0]));
    assert!(
        got.iter()
            .any(|e| matches!(e, Event::Unknown { command } if command == "FB"))
    );
}

#[test]
fn auto_info_reports_the_operators_changes() {
    let mut radio = SimKx2::new();
    assert!(radio.turn_dial(14_075_000).is_empty());
    radio.auto_info = 1;
    let got = Parser::new().push(&radio.turn_dial(14_076_000));
    assert_eq!(
        got,
        [Event::Info {
            hz: 14_076_000,
            mode: Some(Mode::Usb),
            transmit: false,
            rit: false,
            xit: false,
            offset_hz: 0,
            split: false,
        }]
    );
    radio.auto_info = 2;
    assert_eq!(
        Parser::new().push(&radio.turn_dial(14_077_000)),
        [Event::Frequency {
            hz: 14_077_000,
            transceive: false
        }]
    );
    assert_eq!(
        Parser::new().push(&radio.press_mode(Mode::Data)),
        [Event::Mode {
            mode: Mode::Data,
            transceive: false
        }]
    );
}

#[test]
fn sets_while_transmitting_are_refused_and_kept() {
    let mut radio = SimKx2::new();
    radio.receive(b"TX;");
    for r in [
        Request::SetFrequency { hz: 14_076_000 },
        Request::SetMode { mode: Mode::Data },
        Request::SetDataSubMode {
            sub: DataSubMode::DataA,
        },
    ] {
        let got = ask(&mut radio, &r);
        assert_eq!(got[0], Event::Busy, "{r:?}");
    }
    assert_eq!(radio.sets_while_transmitting.len(), 3);
    assert_eq!((radio.hz, radio.mode), (14_074_000, Mode::Usb));
    // Reads still answer.
    assert_eq!(
        answer(&mut radio, &Request::ReadTransmit),
        Event::Transmit { on: true }
    );
}

#[test]
fn commands_in_lower_case_and_unknown_commands() {
    let mut radio = SimKx2::new();
    assert_eq!(
        Parser::new().push(&radio.receive(b"fa;")),
        [Event::Frequency {
            hz: 14_074_000,
            transceive: false
        }]
    );
    assert_eq!(Parser::new().push(&radio.receive(b"ZZ;")), [Event::Busy]);
    // Non-ASCII bytes never panic.
    assert_eq!(
        Parser::new().push(&radio.receive("é;FAé;".as_bytes())),
        [Event::Busy, Event::Busy]
    );
}

#[test]
fn data_reverse_is_held_per_pair_of_sub_modes() {
    let mut radio = SimKx2::new();
    radio.band_reports = false;
    // DATA A's pair reversed, the radio in AFSK A.
    radio.rev_data_a = true;
    radio.sub = DataSubMode::AfskA;
    let md6 = Request::SetMode { mode: Mode::Data };
    assert!(md6.accepted_by(&answer(&mut radio, &md6)));
    // DT0 brings DATA A's pair, still reversed: MD reads 9.
    let dt0 = Request::SetDataSubMode {
        sub: DataSubMode::DataA,
    };
    assert!(dt0.accepted_by(&answer(&mut radio, &dt0)));
    assert_eq!(
        answer(&mut radio, &Request::ReadMode),
        Event::Mode {
            mode: Mode::DataRev,
            transceive: false
        }
    );
    // MD6 again sets DATA A's pair to normal.
    assert!(md6.accepted_by(&answer(&mut radio, &md6)));
    assert!(!radio.rev_data_a);
}

#[test]
fn k2_modes_1_and_3_report_data_as_lsb_and_usb() {
    let mut radio = SimKx2::new();
    radio.receive(b"K21;");
    assert_eq!(
        answer(&mut radio, &Request::ReadK2Mode),
        Event::K2Mode { mode: 1 }
    );
    let md6 = Request::SetMode { mode: Mode::Data };
    let e = answer(&mut radio, &md6);
    assert_eq!(
        e,
        Event::Mode {
            mode: Mode::Lsb,
            transceive: false
        }
    );
    assert!(!md6.accepted_by(&e));
}

#[test]
fn if_carries_split_xit_and_the_offset_and_bw_the_filter() {
    let mut radio = SimKx2::new();
    radio.split = true;
    radio.xit = true;
    radio.offset_hz = -250;
    radio.receive(b"MD6;");
    assert_eq!(
        answer(&mut radio, &Request::ReadInfo),
        Event::Info {
            hz: 14_074_000,
            mode: Some(Mode::Data),
            transmit: false,
            rit: false,
            xit: true,
            offset_hz: -250,
            split: true,
        }
    );
    radio.bandwidth_hz = 400;
    assert_eq!(
        answer(&mut radio, &Request::ReadBandwidth),
        Event::Bandwidth { hz: 400 }
    );
}

#[test]
fn leaving_the_menu_reads_255() {
    let mut radio = SimKx2::new();
    radio.open_menu(82);
    assert!(Request::LeaveMenu.accepted_by(&answer(&mut radio, &Request::LeaveMenu)));
    assert_eq!(radio.menu, 255);
}
