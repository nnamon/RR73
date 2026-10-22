# Your radio

RR73 sends and receives audio through the device's audio input and output. The radio keys by VOX, or by CAT where rig control runs.

## iPhone and VOX

1. Connect a cable between the phone's headset audio and the radio's audio in and out. Use the headset jack, or a USB-C or Lightning headset adapter.
2. Set the radio to USB with VOX on.
3. Choose the band in Change band, and set the radio to the dial frequency it shows.

There is no rig control on an iPhone. Change band on the radio and in RR73 together.

Before you transmit, in Settings › Radio and audio, lists what to set on the phone: Focus mode on, so iOS sounds do not key the radio, Keyboard clicks off, and Phone volume at maximum. Tick each one as you set it. On a computer the list has System sounds off, Radio not the default output, and Sleep set to Never.

The Keying check under it shows whether the start chime or Tune keyed the radio. It passes when receive audio drops while the tone plays. A failed check says to check the radio's VOX and the cable.

## Receive audio

Settings › Radio and audio sets the audio in and out.

- Input chooses the audio input. System default uses the device's own choice.
- Level shows the input in dBFS against the target range, −30 to −14 dBFS. Set the radio's audio output so band noise sits inside it, with the radio's AGC on.
- Waterfall contrast sets the waterfall to Low, Normal or High.

## Transmit audio

- Output chooses the device transmit audio goes to. It shows in Chrome and Edge. Safari plays to the system output.
- Monitor plays transmit audio on a second output as well, at Monitor level. It shows where the browser supports it.
- Output level sets the transmit audio level.
- Start chime plays a short tone when audio starts, which keys the radio by VOX.

## Setting levels with Tune

1. Tap Tune for 10 s in Settings › Radio and audio, or in ••• on Operate.
2. A tone plays at your Tx frequency for 10 s. The Tuning sheet counts down and shows the frequency and dial.
3. Watch the radio's ALC meter and set Output level. On a KX2, aim for 4 to 5 ALC bars, no more. On an IC-705, keep the ALC meter within the ALC zone.
4. Tap Halt, or close the sheet, to stop the tone early.

Leaving Radio and audio during Tune stops the tone.

## Rig control in Chrome or Edge

Settings › Rig control shows in Chrome and Edge on a computer, and in the desktop app. It works with an Icom IC-705 over its USB cable, and an Elecraft KX2 through a Digirig or a KX2 cable.

1. Turn on Rig control and choose the radio.
2. For a KX2, choose the Connection, Digirig or KX2 cable, and set Baud rate to match the KX2's MENU › RS232, 4800 by default. The IC-705 answers at any rate.
3. Plug the radio in by USB and tap Connect radio.
4. Choose the port: IC-705 Serial Port A (CI-V), the Digirig's CP210x serial port, or the KX2 cable's serial port.

Status then reads Connected and Dial shows the radio's dial. Choosing a band or a mode in Change band sets the radio's dial and its data mode. The radio's badge on Operate shows the connection.

With Rig control on and Key the radio with CAT off, the radio keys by VOX, and RR73 reads and sets its dial and mode only.

## Keying by CAT

1. Under Transmit, choose the radio's own audio device as Output in Settings › Radio and audio. With System default chosen, nothing transmits and the status line says `No Tx output chosen`.
2. Turn on Key the radio with CAT.
3. Tap Test keying. It transmits for 1 s with no audio. Use low power into a dummy load.

Radio settings, under the connection, lists the radio's menu settings RR73 reads, with what to change. On an IC-705, USB SEND must be OFF. Until it is, Tx stays off and the status line says `Set USB SEND to OFF`.

Keep Tx audio centred, on the IC-705 only, needs Key the radio with CAT. On, a Tx frequency outside 1500 to 2000 Hz moves the radio's dial for the transmission in steps of 500 Hz, and the audio moves the other way. The signal goes out on your Tx frequency with its audio in the middle of the radio's transmit passband. The dial goes back for receive. Off, the dial stays put.

The KX2 has no transmit time-out. Keyed by CAT, it transmits until RR73 or you unkey it.

If the radio stops answering while keyed, Tx goes off and the status line says `No reply from radio · Tx off`. If PTT off is not confirmed, the status line says `PTT off not confirmed · unkey radio`. Unkey the radio by hand.

## The desktop app

The desktop app runs the same app in its own window on Windows, macOS and Linux. It adds 2 things a browser cannot:

- Rig control on every system, through the computer's serial ports. Connect radio opens Choose the radio's port, which lists the ports with their USB IDs.
- The computer's clock, measured against an NTP time server. [Timing and the clock](timing.md) has the details.

Each release on GitHub carries the installers: `.exe` or `.msi` for Windows, `.dmg` for macOS, `.AppImage` or `.deb` for Linux.

The installers are not signed, so Windows and macOS warn before the first start.

- Windows: SmartScreen says Windows protected your PC. Select More info, then Run anyway.
- macOS: open the `.dmg`, drag RR73 to Applications and open it once. Then, in System Settings › Privacy & Security, select Open Anyway beside the message about RR73 and confirm with Open.
- Linux: make the AppImage executable and run it, or install the `.deb`. For rig control, add your user to the `dialout` group (`uucp` on Arch Linux) and log in again.
