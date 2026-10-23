# Logging

The log is on the device and works with no network. Open it with Log on Operate.

## The log

The Log lists QSOs by UTC day, newest first.

- Search: finds QSOs by callsign, grid, park or summit.
- All: every QSO.
- To do: QSOs not sent to Wavelog, refused or changed, and activation files not submitted.
- Activations: each activation with its QSOs and files, while Activations is on.
- Add QSO, the plus button: adds a QSO by hand.
- Export ADIF, the share button: exports the QSOs in view as an ADIF file.

The Log shows the [Practice log](practice-band.md#the-practice-log) while the practice band is on.

## Editing a QSO

Tap a QSO to change its callsign, UTC date and time, band, mode, frequency, their grid, the reports, their park or summit, or the comment. RTTY QSOs also have Name and QTH, and contest QSOs have Exchange sent and Exchange received.

- Save QSO keeps the changes.
- Delete QSO removes it, with Undo.
- Send to Wavelog sends a QSO that has not gone yet.

Edit, in the notice that follows a logged QSO, opens it. Undo removes it.

## Wavelog

1. In Settings › Logging › Wavelog, type the Address of your Wavelog, such as https://log.example.com.
2. Create a read-write API key on Wavelog's API page and paste it as API key.
3. Tap Test connection. Logging shows Tested, with the time.
4. Under Station location, choose where QSOs go. Its callsign must match the callsign on air.
5. Turn on Use Wavelog.

Settings › Logging › Sending:

- Send automatically: sends each QSO as it is logged. Off, the Log shows Send to Wavelog with the number waiting.
- Send edits to QSOs already sent: sends changes where the destination accepts them. Wavelog takes no edits, so repeat each edit there.

A refused QSO shows the reason in the Log, with Fix or Send again. Fix opens the QSO, the station location or the Wavelog settings, whichever needs changing. QSOs wait while the device is offline.

Send radio status, in Wavelog's settings, shows RR73 in Wavelog as a radio with its dial and mode.

## Read Wavelog's log

Read Wavelog's log, under Worked before in Wavelog's settings, reads the QSOs Wavelog holds from every station that logs to it. Refresh from Wavelog reads them again. Reading pauses while the practice band is on.

These QSOs count for the decode colours, the New chip and Hide worked. Dupes, Hunt and Repeat CQ use this device's log only. The station's sheet on Operate lists the bands and modes where only Wavelog has the station.

## Files

Settings › Logging also holds the activation files while Activations is on. [Where the QSOs go](activations.md#where-the-qsos-go) lists them.

## Backup and import

In Settings › Logging › Backup:

- Back up the log: saves every QSO, activation and Wavelog state to one file. Settings, the API key included, stay out.
- Import a log: reads a backup or an ADIF file from any logger.

A backup restores the QSOs and activations the log lacks, and QSOs Wavelog already had stay sent. An ADIF import skips QSOs the log already holds: the same QSO from RR73, or the same call, band and mode within 2 min. RR73 does not send imported QSOs to Wavelog.

Turn off the practice band to back up or import.
