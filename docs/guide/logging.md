# Logging

RR73 keeps the log on the device, and the log works with no network. Open it with Log on Operate.

## The log

The Log lists every QSO by UTC day, newest first. Each row shows the callsign, the band and mode, the time, the reports and the station's country.

- Search, at the top, finds QSOs by callsign, grid, park or summit.
- All shows every QSO. To do shows QSOs not sent to Wavelog, refused or changed, and activation files not yet submitted, with their count. Activations shows each activation with its QSOs and files, while Activations is on.
- Add QSO, the plus button, adds a QSO by hand.
- Export ADIF, the share button, exports the QSOs the current view shows as an ADIF file.

While the practice band is on, the Log shows the [Practice log](practice-band.md#the-practice-log).

## Editing a QSO

Tap a QSO to open it. You can change the callsign, the date and time in UTC, the band, the mode, the frequency, their grid, the reports, their park or summit, and the comment. RTTY QSOs also have Name and QTH. QSOs with a contest exchange have Exchange sent and Exchange received.

- Save QSO keeps the changes.
- Delete QSO removes it. A notice offers Undo.
- Send to Wavelog sends a QSO that has not gone yet.

In the notice that follows a logged QSO, Edit opens the QSO and Undo removes it.

## Wavelog

Settings › Logging › Wavelog sends QSOs to a Wavelog server.

1. Type the Address of your Wavelog, such as https://log.example.com.
2. Create a read-write API key on the API page in Wavelog and paste it as API key.
3. Tap Test connection. Logging then shows Tested, with the time, and can read and write.
4. Under Station location, choose the location QSOs go to. Its callsign must match the callsign on air.
5. Turn on Use Wavelog.

Settings › Logging › Sending decides when QSOs go:

- Send automatically sends each QSO as it is logged. Off, the Log shows Send to Wavelog with the number of QSOs waiting.
- Send edits to QSOs already sent sends changes where the destination accepts them. Wavelog takes no edits, so repeat each edit in Wavelog.

A QSO Wavelog refuses shows the reason in the Log, with Fix or Send again. Fix opens what needs changing: the QSO, the station location or the Wavelog settings. With no connection, QSOs wait and go once the device is online.

Send radio status, in Wavelog's settings, shows RR73 in Wavelog as a radio with its dial and mode, sent on each change.

## Read Wavelog's log

Read Wavelog's log, under Worked before in Wavelog's settings, reads the QSOs Wavelog holds from every station that logs to it. Refresh from Wavelog reads them again.

What it reads counts for the decode colours, the New chip and Hide worked. Dupes, Hunt and Repeat CQ count this device's log only. The station's sheet on Operate lists the bands and modes only Wavelog's log has the station on.

Reading pauses while the practice band is on.

## Files

With Activations on, Settings › Logging also holds the activation files. [Where the QSOs go](activations.md#where-the-qsos-go) lists them.

## Backup and import

Settings › Logging › Backup:

- Back up the log saves one file with every QSO, every activation and what Wavelog holds. Settings stay out of it, the Wavelog API key included.
- Import a log reads a backup or an ADIF file from any logger.

From a backup, the QSOs and activations the log lacks come back, and QSOs Wavelog already had stay sent. From ADIF, Import a log skips a QSO the log already holds: the same QSO from RR73, or the same call, band and mode within 2 min. RR73 does not send imported QSOs to Wavelog.

Turn off the practice band to back up or import the log.
