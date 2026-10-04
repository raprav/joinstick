# Joinstick

**Use phones as gamepads for browser games.** The game shows a QR code, each
player scans it, and their phone becomes a controller. No accounts, no app
install: one small self-hosted Node server and a few lines in your game. Made
for local multiplayer and party games on a laptop or TV: an open-source,
self-hosted take on AirConsole-style phone controllers, for your own game.

[![npm](https://img.shields.io/npm/v/joinstick)](https://www.npmjs.com/package/joinstick)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node >= 22](https://img.shields.io/badge/node-%3E%3D22-339933)](package.json)
[![CI](https://github.com/raprav/joinstick/actions/workflows/ci.yml/badge.svg)](https://github.com/raprav/joinstick/actions/workflows/ci.yml)

<p align="center"><img src="https://raw.githubusercontent.com/raprav/joinstick/main/docs/hero.png" alt="Left: the example game on a laptop, showing a room code, two moving squares and a QR code per player. Right: a phone held sideways showing the Joinstick pad with a d-pad and two buttons." width="800"></p>

## Quick start in 30 seconds

```sh
npx joinstick --static ./my-game
```

That serves your game on `http://localhost:3000` and the phone controllers
on the same port. In your game page:

```html
<img id="qr">
<script type="module">
  import { host } from '/joinstick/host.js';
  const room = await host({ slots: 2 });       // default pad: d-pad + A, B
  document.getElementById('qr').src = room.qr(1); // player 1 scans this
  (function frame() {
    const p1 = room.input(1);                    // { x, y, buttons, pressed }, never undefined
    if (p1.pressed.a) console.log('jump!');      // x, y in [-1, 1]; pressed = went down since last read
    requestAnimationFrame(frame);
  })();
</script>
```

Scan the QR with a phone on the same Wi-Fi and play. To see a complete game
first, clone this repo, `npm install` and run `node src/cli.js --static examples/basic`.

## How it works

```
  laptop / TV                     Joinstick server                 phones
 ┌─────────────┐   WebSocket    ┌──────────────────┐  WebSocket   ┌──────────┐
 │ your game   │ ◄────────────► │ rooms, relay,    │ ◄──────────► │ pad page │
 │ + host.js   │  input, joins  │ QR codes, pad    │  pad state   │ /j/KQZX/1│
 └─────────────┘                │ page, SDKs       │              └──────────┘
                                └──────────────────┘
```

The game creates a room (`KQZX`) with up to 8 player slots. Each slot has a QR
code that opens `/j/KQZX/<slot>` on a phone. The phone sends its controller
state on every change; your game reads `room.input(n)` once per frame. All
traffic goes through your server; nothing leaves your network unless you put
it on the internet.

## Features

- **Zero install for players**: a QR code (or `http://<laptop-ip>:3000/j` and
  a 4-letter code) opens the controller in the phone's browser.
- **Small and self-hosted**: one Node process, two runtime dependencies
  (`ws`, `uqr`), plain ES modules in the browser, no build step.
- **Survives real life**: phones that lock or drop Wi-Fi leave and rejoin
  their own slot; game page reloads and server restarts keep the room code.
  Your game gets `join`/`leave` events to pause and resume.
- **Configurable pad**: d-pad plus up to 8 buttons with labels, colors and
  sizes; the game can retitle, recolor, highlight or disable buttons live.
- **Landscape by default**: held upright, the pad shows rotated, so it works
  with the phone's rotation lock on (on Android Chrome the first tap also
  tries fullscreen and an orientation lock).
- **Haptics**: a short tick on every press (Android; best effort on iOS 18+,
  see the FAQ), plus game-driven vibration on Android.
- **Bring your own controller**: the pad is just one client of a documented
  JSON/WebSocket protocol; `client.js` lets you build your own or drive pads
  from tests.

## Pad layouts

```js
await host({
  slots: 2,
  layout: {
    arrangement: 'arc',               // 'grid' (default) | 'diamond' | 'arc'
    buttons: [
      { id: 'punch', label: 'PUNCH' }, // in 'arc' the first button is the big one
      { id: 'kick', label: 'KICK' },
      { id: 'ult', label: 'ULT', size: 'large' },
      { id: 'block', label: 'BLOCK', size: 'wide' },   // a bar to rest a thumb on
      { id: 'start', label: 'START', system: true },   // a pill in the top bar
    ],
  },
});
```

<p align="center"><img src="https://raw.githubusercontent.com/raprav/joinstick/main/docs/layouts.png" alt="Four pad screenshots: grid, diamond, arc, and arc with a wide BLOCK bar. Each has a d-pad on the left and a START pill in the top bar." width="800"></p>

Also: `stick: 'none'` (buttons only), `orientation: 'landscape' | 'portrait' |
'any'`, `haptics: false`, per-button `color` and `haptic` (ms). Taps between
buttons go to the nearest one, and several fingers work at once (move, hold
a button, tap another). Full schema in [AGENTS.md](AGENTS.md#5-layout).

## API in one screen

| Game side (`/joinstick/host.js`) | |
|---|---|
| `host({ slots, layout })` | Create (or after a reload, resume) a room. |
| `room.input(n)` | `{ x, y, buttons, pressed }` for player `n`. Read it every frame. |
| `room.qr(n)`, `room.joinUrl(n)` | QR image URL and plain join link for player `n`. |
| `room.connected(n)`, `room.on('join' \| 'leave', fn)` | Who is here; pause when someone drops. |
| `room.pad(n, { title, color, highlight, disabled, vibrate })` | Change what a phone shows. |
| `room.send(n, data)`, `room.on('message', fn)` | Custom messages both ways. |

| Server side (`import { attach } from 'joinstick'`) | |
|---|---|
| `attach(httpServer, { static, publicUrl })` | Add Joinstick to your own Node HTTP server. |

Types: [`host.d.ts`](public/host.d.ts), [`client.d.ts`](public/client.d.ts),
[`server.d.ts`](src/server.d.ts). Wire protocol: [PROTOCOL.md](PROTOCOL.md).
Everything else (input contract, pausing, error codes, testing without
phones): [AGENTS.md](AGENTS.md).

## CLI

```
joinstick [--port 3000] [--static ./dir] [--public-url URL]
```

| Flag | Env | |
|---|---|---|
| `--port` | `PORT` | Port to listen on. Default 3000. |
| `--static <dir>` | | Also serve your game from this directory. |
| `--public-url <url>` | `PUBLIC_URL` | Origin phones should open (no path). Default: the detected LAN address. |

## Self-hosting

- **LAN (the usual case)**: run it on the laptop that shows the game. Phones
  on the same Wi-Fi open the printed "Phones join at" URL. Plain HTTP is fine.
- **Behind a reverse proxy with TLS**: proxy everything (or at least `/j`,
  `/joinstick/`) to Joinstick, let the proxy pass WebSocket upgrades on
  `/joinstick/ws`, and start Joinstick with `--public-url https://your.domain`
  so QR codes point at the public address. Behind a proxy every game shares
  the proxy's IP address, so the 20-rooms-per-IP cap applies to all of them
  together. With Caddy (which passes WebSockets through by default):

  ```
  your.domain {
    reverse_proxy localhost:3000
  }
  ```

- **Docker**: the repo has a small [Dockerfile](Dockerfile) (non-root,
  Node 22 Alpine). Inside a container the LAN address cannot be detected, so
  pass `--public-url`:

  ```sh
  docker build -t joinstick .
  docker run --rm -p 3000:3000 -v "$PWD/my-game:/site:ro" joinstick \
    --static /site --public-url http://<your-lan-ip>:3000
  ```

## Remote play

What works today: put the server on a public URL (a tunnel such as
`cloudflared tunnel --url http://localhost:3000`, or a reverse proxy) and pass
that URL as `--public-url`. Remote phones then join like local ones.

What it does not do: Joinstick only carries controller input. Remote players
still need to see the game (screen sharing, a video call). Input is relayed
through your server, so expect their latency to the server, not peer to
peer. Room codes are 4 letters and there is no other authentication: fine
among friends, not for anything secret.

## For AI coding agents

Point your agent at [AGENTS.md](AGENTS.md): integration checklist, full API,
input contract, pitfalls, and how to test with scripted pads instead of
phones. A running server also serves a condensed version at `/llms.txt`.

## FAQ

**The phone can't connect.** It must reach the laptop: same Wi-Fi, and allow
Node through the firewall prompt on first run (macOS/Windows). Guest, hotel
and office networks often isolate devices; use a phone hotspot or a tunnel.
If the printed "Phones join at" URL doesn't open on the phone, nothing else will.

**Do players need the same Wi-Fi?** For local play, yes (or any network where
the phone can reach the server). For remote play, see above.

**Does vibration work on iPhone?** Partly. Android gets tap feedback and
game-driven vibration. iOS Safari has no vibration API; on iOS 18+ the pad
plays the system's single haptic tick on presses as a best effort (length is
ignored, game-driven vibration does nothing). Older iOS and desktops: none.

**Which browsers?** The pad needs Pointer Events, ES modules and WebSocket,
which current mobile Safari, Chrome and Firefox have. The game page needs
the same minus Pointer Events.

**Limits?** 8 players per room, 8 buttons per pad, 1000 rooms per server
(20 per IP address), 8 KB per message. A room closes 60 s after the game page
goes away.

**HTTPS game page?** A page served over HTTPS cannot open a plain `ws://`
connection. Serve the game with `--static`, or put both behind HTTPS.

## License

[MIT](LICENSE) © 2026 Rafa Prats. Third-party notices:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
QR Code is a registered trademark of DENSO WAVE INCORPORATED.
