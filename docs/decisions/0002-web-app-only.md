# 0002. A home-screen web app, no native wrapper

Status: accepted, 2026-10-13

## Context

The owner can't publish iOS apps. A native wrapper would add CoreBluetooth and UDP (rig control, Icom Wi-Fi) but needs App Store or TestFlight distribution.

## Decision

Ship only as a web app, served from GitHub Pages and installed from Safari to the home screen, with iOS 26 as the minimum.

## Consequences

- The radio connects by audio through the headset jack, keyed by VOX. Without CAT, band changes go through a confirmation sheet and the log uses the confirmed band.
- No background execution: the screen stays on while operating, and the outbox runs only while the app is open.
- Services without CORS headers wait for a relay.
