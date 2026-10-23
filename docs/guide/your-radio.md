# Your radio

RR73 sends and receives audio through the device's audio input and output, and keys the radio by VOX or, with rig control, by CAT.

## iPhone and VOX

1. Connect the phone's headset audio to the radio's audio in and out, through the headset jack or a USB-C or Lightning headset adapter.
2. Set the radio to USB with VOX on.
3. Choose the band in Change band and set the radio to the dial it shows.

An iPhone has no rig control, so change band on the radio and in RR73 together.

Work through the Before you transmit checklist in Settings › Radio and audio. Focus mode keeps iOS sounds from keying the radio.

The Keying check under it passes when receive audio drops while the start chime or Tune plays. If it fails, check the radio's VOX and the cable.

## Receive audio

In Settings › Radio and audio:

- Input: System default uses the device's choice.
- Level: the input against the target range of −30 to −14 dBFS. Keep the radio's AGC on and set its audio output so band noise sits inside the range.
- Waterfall contrast: Low, Normal or High.

## Transmit audio

- Output: the device transmit audio goes to, in Chrome and Edge. Safari plays to the system output.
- Monitor: plays transmit audio on a second output too, at Monitor level, where the browser supports it.
- Start chime: a short tone when audio starts. It keys the radio by VOX.

## Setting levels with Tune

1. Tap Tune for 10 s in Settings › Radio and audio or in ••• on Operate. A tone plays at your Tx frequency for 10 s.
2. Set Output level while watching the radio's ALC meter: 4 to 5 bars at most on a KX2, within the ALC zone on an IC-705.
3. Tap Halt or close the Tuning sheet to stop early. Leaving Radio and audio also stops the tone.

## Rig control in Chrome or Edge

Rig control works with an Icom IC-705 over its USB cable and an Elecraft KX2 through a Digirig or a KX2 cable. Settings › Rig control shows in Chrome and Edge on a computer and in the desktop app.

1. Turn on Rig control and choose the radio.
2. For a KX2, choose the Connection and set Baud rate to the KX2's MENU › RS232 (4800 by default). The IC-705 answers at any rate.
3. Plug the radio in by USB and tap Connect radio.
4. Choose the port: IC-705 Serial Port A (CI-V), the Digirig's CP210x serial port, or the KX2 cable's serial port.

Status reads Connected. Change band then sets the radio's dial and data mode. RR73 keys by VOX until Key the radio with CAT is on.

## Keying by CAT

1. In Settings › Radio and audio, under Transmit, choose the radio's own audio device as Output. With System default, nothing transmits and the status line says `No Tx output chosen`.
2. Turn on Key the radio with CAT.
3. Tap Test keying to transmit for 1 s with no audio. Use low power into a dummy load.

Radio settings, under the connection, lists the radio menu settings RR73 reads and what to change. On an IC-705, Tx stays off with `Set USB SEND to OFF` until USB SEND is OFF.

Keep Tx audio centred works on the IC-705 with Key the radio with CAT on. A Tx frequency outside 1500 to 2000 Hz then moves the dial for the transmission in 500 Hz steps and the audio the other way, so the signal goes out on your Tx frequency in the middle of the transmit passband. The dial goes back for receive.

The KX2 has no transmit time-out. Keyed by CAT, it transmits until RR73 or you unkey it.

Tx goes off with `No reply from radio · Tx off` if the radio stops answering while keyed. `PTT off not confirmed · unkey radio` means the radio may still be keyed: unkey it by hand.

## The desktop app

The desktop app has rig control on Windows, macOS and Linux through the computer's serial ports. Connect radio opens Choose the radio's port, with each port's USB ID. It also corrects the clock against an NTP time server ([Timing and the clock](timing.md#the-desktop-app-s-time-server)).

The installers are on each GitHub release: `.exe` or `.msi` for Windows, `.dmg` for macOS, `.AppImage` or `.deb` for Linux. They are not signed, so Windows and macOS warn before the first start.

- Windows: at Windows protected your PC, select More info, then Run anyway.
- macOS: drag RR73 from the `.dmg` to Applications and open it once. Then select Open Anyway beside the message about RR73 in System Settings › Privacy & Security, and confirm with Open.
- Linux: make the AppImage executable and run it, or install the `.deb`. For rig control, add your user to the `dialout` group (`uucp` on Arch Linux) and log in again.
