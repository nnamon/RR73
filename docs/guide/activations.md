# Activations

An activation ties the QSOs you log to one or more POTA, SOTA, WWFF or IOTA references. Turn on Activations in Settings › Optional features. Activations live in Spots.

## Starting an activation

1. Open Spots and tap Start activation.
2. Under References, choose the programme and type the reference, such as `VK-0921` for POTA, `VK3/VC-012` for SOTA, `VKFF-0921` for WWFF or `OC-001` for IOTA. Tap Add.
3. Add more references if the activation covers several parks. One activation holds at most 1 summit, 1 WWFF reference and 1 island.
4. Under Station, check Callsign on air and the Grid. Tap Use GPS to fill in the grid.
5. Tap Start activation.

POTA and SOTA references show suggestions as you type, with the name of each reference added. Find nearby parks and summits lists those near the phone's position from GPS, and sets the grid unless you typed one.

While the activation runs, FT8 and FT4 messages carry its Callsign on air and grid in place of those in Settings › Station.

## Progress

Operate shows the activation in a strip above the waterfall, such as `POTA VK-0921 · 7 of 10`, with the time left in the UTC day. Tap it to open the activation in Spots. With more than 1 reference, the strip shows the first one that has a target and the number of others, such as +1.

Each programme counts as its rules do:

- POTA: 10 QSOs in one UTC day. A repeat of the same call, band and mode counts once.
- SOTA: 4 different stations in one UTC day.
- WWFF: 44 QSOs, added up over every activation at the reference. A repeat of the same call, band, mode and UTC day counts once.
- IOTA: no minimum. The count is the QSOs in this activation.

A reference that reaches its target reads Qualified.

The activation in Spots shows the callsign and grid on air, the progress of each reference, the time left in the UTC day, the time since the start and your last 3 QSOs with a count by band. Tap a QSO to edit it.

## Dupes in an activation

A station worked in this activation, on the same band, mode and UTC day, is a dupe. A new activation starts with no dupes, also at the same park. [Making QSOs](making-qsos.md#dupes) has the rules.

## Editing and ending

Edit activation changes the references, the callsign, the grid and the Wavelog station. The QSOs and dupes stay with the activation.

End activation… asks once, and names the QSOs it keeps on the device. Tap End activation to end it, or Keep operating to go on.

## Where the QSOs go

Each QSO logged during the activation carries its references in the log.

- Wavelog: the QSOs go to the Wavelog station location chosen for the activation.
- Files: Settings › Logging turns on a POTA file to upload at pota.app, a SOTA file for the SOTA database, a WWFF file for your WWFF coordinator and an ADIF file with all fields. Files take only QSOs made in an activation.

After the activation, in Spots, says what waits, such as Wavelog 3 waiting or POTA file ready. It opens Log › Activations, where each activation has its files. Tap Share to send a file, and Mark submitted once you have uploaded it.

While Activations is on, RR73 downloads the park and summit lists for the suggestions and keeps them on the device.
