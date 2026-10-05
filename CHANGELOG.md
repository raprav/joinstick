# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version
is 0.x, a minor release may change the API; the changelog says how.

## [Unreleased]

### Added

- One QR for everyone: `room.qr()` and `room.joinUrl()` without a slot give a
  link that puts each phone in the first free slot (`/j/ROOM`);
  `/joinstick/qr.svg` accepts a missing `slot`.
- `examples/paint-party`: a party game for 1-8 phones.
- `--client-ip-header <name>` (`CLIENT_IP_HEADER`, `attach()` option
  `clientIpHeader`): behind a reverse proxy, the per-address room cap and
  failed-join limit use the header the proxy sets instead of the proxy's
  address. Off by default, since clients can send the header themselves.

### Changed

- The player number on the pad's join form is optional; blank takes the first
  free slot.
- The pad's top bar is tinted and underlined in the pad color, so players can
  match their phone to the screen at a glance.

### Fixed

- `--static` redirects a directory requested without its trailing slash
  (`/demo/game` -> `/demo/game/`, query kept) instead of answering 404.

## [0.1.0] - 2026-10-04

First public release.

### Added

- `joinstick` CLI: one Node server for rooms, the phone pad page at `/j`, the
  browser SDKs at `/joinstick/*`, QR codes and `/llms.txt`; `--static` serves
  your game on the same port, `--public-url` sets the address in QR codes.
- `attach(server, opts)` to embed Joinstick in an existing Node HTTP server.
- Game SDK (`host.js`): rooms with up to 8 slots, per-frame `input(n)` with
  held `buttons` and one-shot `pressed`, join/leave events, QR and join
  URLs, live pad changes (title, color, highlight, disabled, vibrate),
  messages both ways.
- Phone SDK (`client.js`) for custom controllers and scripted test pads.
- Pad page: d-pad and up to 8 buttons; `grid`, `diamond` and `arc`
  arrangements; `large` and `wide` buttons; `system` buttons (START/MENU) in
  the top bar; landscape by default with CSS rotation when the phone is held
  upright; tap haptics (Android, best effort on iOS 18+); multi-touch.
- Reconnection: phones that lock or drop Wi-Fi rejoin their slot; game page
  reloads and server restarts keep the room code (AGENTS.md has the details).
- Room safety: 20 failed joins per minute per client address, then
  `rate-limited`; per-address room cap; 4-letter room codes.
- `--version` flag.
- JSON/WebSocket protocol v1 (PROTOCOL.md), AGENTS.md for coding agents,
  TypeScript declarations, Dockerfile.

[Unreleased]: https://github.com/raprav/joinstick/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/raprav/joinstick/releases/tag/v0.1.0
