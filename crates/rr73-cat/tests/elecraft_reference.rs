//! Commands and answers worked from Elecraft's K3S/K3/KX3/KX2 Programmer's Reference, Rev. G5
//! (20 February 2019) and the KX2 Owner's Manual, Rev. B2 (22 March 2023). Page numbers are the
//! printed numbers. Where the documents print an example, the test uses it as printed; the rest
//! follow the formats they give.

use rr73_cat::elecraft::{DataSubMode, Event, MenuItem, Mode, Parser, Request};

fn text(r: Request) -> String {
    r.text().expect("text")
}

fn events(s: &str) -> Vec<Event> {
    Parser::new().push(s.as_bytes())
}

#[test]
fn page_3_command_format() {
    // "KS020;" and "MD1;" are SETs: letters, data, semicolon. A GET is the letters alone.
    assert_eq!(text(Request::SetMode { mode: Mode::Lsb }), "MD1;MD;");
    assert_eq!(text(Request::ReadMode), "MD;");
    // The response's format is the SET's.
    assert_eq!(
        events("MD1;"),
        [Event::Mode {
            mode: Mode::Lsb,
            transceive: false
        }]
    );
    // "?;" when the radio cannot handle a command in its present state.
    assert_eq!(events("?;"), [Event::Busy]);
}

#[test]
fn page_11_vfo_a() {
    // "FA00014060000; sets VFO A to 14060 kHz."
    assert_eq!(
        text(Request::SetFrequency { hz: 14_060_000 }),
        "FA00014060000;FA;"
    );
    assert_eq!(
        events("FA00014060000;"),
        [Event::Frequency {
            hz: 14_060_000,
            transceive: false
        }]
    );
    // Owner's Manual p. 35: "FA00007040000;" sets the VFO to 7.040 MHz.
    assert_eq!(text(Request::SetFrequency { hz: 7_040_000 }), "FA00007040000;FA;");
    assert_eq!(text(Request::ReadFrequency), "FA;");
}

#[test]
fn page_11_data_sub_mode() {
    // DTn: 0 DATA A, 1 AFSK A, 2 FSK D, 3 PSK D.
    for (sub, d) in [
        (DataSubMode::DataA, '0'),
        (DataSubMode::AfskA, '1'),
        (DataSubMode::FskD, '2'),
        (DataSubMode::PskD, '3'),
    ] {
        assert_eq!(text(Request::SetDataSubMode { sub }), format!("DT{d};DT;"));
        assert_eq!(events(&format!("DT{d};")), [Event::DataSubMode { sub }]);
    }
    assert_eq!(text(Request::ReadDataSubMode), "DT;");
}

#[test]
fn page_14_general_information() {
    // IF[f]*****+yyyyrx*00tmvspbd1*; with * a space: 14.074 MHz, no RIT/XIT offset, receive, DATA.
    let answer = "IF00014074000     +000000 0006000001 ;";
    assert_eq!(answer.len(), 2 + 35 + 1);
    assert_eq!(
        events(answer),
        [Event::Info {
            hz: 14_074_000,
            mode: Some(Mode::Data),
            transmit: false,
            rit: false,
            xit: false,
            offset_hz: 0,
            split: false,
        }]
    );
    // Transmitting in USB, RIT on at -0120 Hz.
    assert_eq!(
        events("IF00007074000     -012010 0012000001 ;"),
        [Event::Info {
            hz: 7_074_000,
            mode: Some(Mode::Usb),
            transmit: true,
            rit: true,
            xit: false,
            offset_hz: -120,
            split: false,
        }]
    );
    // XIT on at +0150 Hz, split on: x after r, p the fifth character after the mode digit's run.
    assert_eq!(
        events("IF00014074000     +015001 0006001001 ;"),
        [Event::Info {
            hz: 14_074_000,
            mode: Some(Mode::Data),
            transmit: false,
            rit: false,
            xit: true,
            offset_hz: 150,
            split: true,
        }]
    );
    assert_eq!(text(Request::ReadInfo), "IF;");
}

#[test]
fn page_8_filter_bandwidth_and_page_14_k2_mode() {
    // BWxxxx: the bandwidth in 10 Hz units.
    assert_eq!(text(Request::ReadBandwidth), "BW;");
    assert_eq!(events("BW0280;"), [Event::Bandwidth { hz: 2800 }]);
    // K2n: 0 to 3. In 1 and 3, MD and IF report DATA as LSB or USB (p. 4; p. 16, note 2).
    assert_eq!(text(Request::ReadK2Mode), "K2;");
    assert_eq!(events("K23;"), [Event::K2Mode { mode: 3 }]);
    assert!(matches!(events("K24;")[0], Event::Malformed { .. }));
}

#[test]
fn page_17_leaving_the_menu() {
    // "To exit the menu, send MN255."
    let leave = Request::LeaveMenu;
    assert_eq!(text(leave.clone()), "MN255;MN;");
    assert!(leave.accepted_by(&Event::MenuEntry { entry: 255 }));
    assert!(leave.answered_by(&Event::MenuEntry { entry: 82 }));
    assert!(!leave.accepted_by(&Event::MenuEntry { entry: 82 }));
}

#[test]
fn page_16_operating_mode() {
    // MDn: 1 LSB, 2 USB, 3 CW, 4 FM, 5 AM, 6 DATA, 7 CW-REV, 9 DATA-REV.
    for (mode, d) in [
        (Mode::Lsb, 1),
        (Mode::Usb, 2),
        (Mode::Cw, 3),
        (Mode::Fm, 4),
        (Mode::Am, 5),
        (Mode::Data, 6),
        (Mode::CwRev, 7),
        (Mode::DataRev, 9),
    ] {
        assert_eq!(text(Request::SetMode { mode }), format!("MD{d};MD;"));
        assert_eq!(
            events(&format!("MD{d};")),
            [Event::Mode {
                mode,
                transceive: false
            }]
        );
    }
}

#[test]
fn pages_17_to_20_menu_entries() {
    // MN alone reads the entry shown; MN255 is returned when the menu is not in use, and MN255
    // leaves the menu (p. 17). MIC BTN is entry 082 on the KX2 (Table 6A, p. 19). MP reads the
    // entry's value; for MIC BTN bit 0 is PTT and bit 2 the UP/DN buttons (p. 20).
    assert_eq!(text(Request::ReadMenuEntry), "MN;");
    assert_eq!(events("MN255;"), [Event::MenuEntry { entry: 255 }]);
    assert_eq!(
        text(Request::ReadSetting {
            item: MenuItem::MicBtn
        }),
        "MN082;MP;MN255;"
    );
    assert_eq!(events("MP005;"), [Event::MenuValue { value: 5 }]);
    // "MP000; (mode A) or MP128; (mode B)" (p. 20).
    assert_eq!(events("MP128;"), [Event::MenuValue { value: 128 }]);
}

#[test]
fn page_21_option_modules() {
    // KX3 with a KXAT3 and a KXFL3: "OM A-F-------02;". The last two characters are the product:
    // 01 the KX2, 02 the KX3.
    assert_eq!(
        events("OM A-F-------02;"),
        [Event::Options {
            product: Some(2),
            modules: "A-F-------".into()
        }]
    );
    assert_eq!(
        events("OM ----------01;"),
        [Event::Options {
            product: Some(1),
            modules: "----------".into()
        }]
    );
    // The K3's answer carries no product number: "OM -P-S--------;".
    assert_eq!(
        events("OM -P-S--------;"),
        [Event::Options {
            product: None,
            modules: "-P-S--------".into()
        }]
    );
    assert_eq!(text(Request::ReadOptions), "OM;");
}

#[test]
fn pages_23_27_28_transmit_and_receive() {
    // TX enters transmit (p. 28), RX ends it (p. 23); neither answers, so TQ follows: TQ0 receive,
    // TQ1 transmit (p. 27).
    assert_eq!(text(Request::SetTransmit { on: true }), "TX;TQ;");
    assert_eq!(text(Request::SetTransmit { on: false }), "RX;TQ;");
    assert_eq!(text(Request::ReadTransmit), "TQ;");
    assert_eq!(events("TQ0;"), [Event::Transmit { on: false }]);
    assert_eq!(events("TQ1;"), [Event::Transmit { on: true }]);
}

#[test]
fn page_28_vox() {
    // VXn: 0 VOX off, 1 on, in the present mode. GET only on the KX2.
    assert_eq!(text(Request::ReadVox), "VX;");
    assert_eq!(events("VX1;"), [Event::Vox { on: true }]);
    assert_eq!(events("VX0;"), [Event::Vox { on: false }]);
}

#[test]
fn page_11_band_change_reports_are_read_in_any_order() {
    // On a band change the radio reports IF, FA, FB, FR, FT, PA, RA, AN, GT, FW and NB (note 7).
    let reports = "IF00007074000     +000000 0006000001 ;FA00007074000;FB00007074000;FR0;FT0;PA1;RA00;AN1;GT004;FW0300;NB0;";
    let got = events(reports);
    assert_eq!(got.len(), 11);
    assert_eq!(
        got[1],
        Event::Frequency {
            hz: 7_074_000,
            transceive: false
        }
    );
    assert!(got[2..].iter().all(|e| matches!(e, Event::Unknown { .. })));
}
