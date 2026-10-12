# 0002. A home-screen web app, no native wrapper

Status: accepted, 2026-10-13

## Context

The owner can't publish iOS apps. A native wrapper would add CoreBluetooth and UDP (rig control, Icom Wi-Fi) but needs App Store or TestFlight distribution.

## Decision

Ship only as a web app installed from Safari to the home screen, served from GitHub Pages. Minimum iOS 26.

## Consequences

- Radio connection is audio through the headset jack with VOX. No CAT, so band changes go through a confirmation sheet and the log uses the confirmed band.
- No background execution: the screen stays on while operating, and the outbox runs only while the app is open.
- Services without CORS headers wait for a relay.
