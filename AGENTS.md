# Joinstick for coding agents

Joinstick turns phones into gamepads for browser games. The game page (the
**host**) shows one QR code per player slot; a player scans it and the phone
becomes a controller. Read this file before integrating; it is the whole
contract. Wire format: [PROTOCOL.md](PROTOCOL.md). Types:
[`public/host.d.ts`](public/host.d.ts), [`public/client.d.ts`](public/client.d.ts).

## 1. Run the server

```sh
npx joinstick --static ./my-game        # serves the game AND Joinstick on :3000
```

Open `http://localhost:3000/` on the computer. Phones must be on the same
Wi-Fi. Without `--static`, Joinstick runs alone and your game is served by
something else (see "Game served elsewhere" below).

## 2. Integrate (copy-paste)

```js
import { host } from '/joinstick/host.js';

const room = await host({ slots: 2, layout: { stick: 'dpad', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } });
for (let n = 1; n <= room.slots; n++) showQr(n, room.qr(n), room.joinUrl(n)); // <img src=qr> + the URL as text

function tick() {
  for (let n = 1; n <= room.slots; n++) {
    const { x, y, buttons, pressed } = room.input(n); // poll once per frame per slot
    // move with x/y (and held buttons); trigger one-shot actions with pressed.a
  }
  requestAnimationFrame(tick);
}
tick();
```

Slots are **1-based** everywhere. `room.input(0)` throws `RangeError`.

## 3. Pause when a player is missing

```js
room.on('leave', ({ slot, reason }) => pause(`Waiting for player ${slot}`));
room.on('join', ({ slot, name, rejoin }) => { if ([1, 2].every((n) => room.connected(n))) resume(); });
// or simply, every frame: const paused = ![1, 2].every((n) => room.connected(n));
```

`leave` fires immediately when a phone is locked, backgrounded, loses Wi-Fi,
holds "Leave", or is kicked. The same phone rejoins the same slot by itself
when it comes back; a new person can also scan that slot's QR. If the host
page itself loses the server, every slot gets `leave` (reason
`'disconnected'`) and then `join` with `rejoin: true` once it is back.

## 4. Input contract

`room.input(n)` returns `{ x, y, buttons, pressed }` and is **never undefined**.

| Field | Meaning |
|---|---|
| `x` | -1 left .. 1 right. The d-pad gives -1, 0 or 1. |
| `y` | -1 **up** .. 1 down (screen convention, like the Gamepad API). |
| `buttons` | Held state of every layout button: `{ a: false, b: true }`. |
| `pressed` | Buttons that went down since your previous `input(n)` call: `{ b: true }`. Latched and **cleared on read**, so a tap shorter than one frame is never lost and never counted twice. |

- Use `pressed` for one-shot actions (attack, jump, confirm, pause). **Never
  use held state (`buttons`) to trigger attacks**: you would fire every frame
  or miss fast taps.
- Use `buttons` for things that last while held (block, run, charge).
- Neutral (`x = y = 0`, all buttons false, `pressed` empty) when the slot is
  empty, right after `leave`, and right after `join`.
- Read `input(n)` exactly once per frame per slot; a second read in the same
  frame has an empty `pressed`.
- The d-pad is 8-way. Up and the up-diagonals need the thumb clearly above
  horizontal (30° or more), so a resting thumb does not jump by accident.
- There is no input event; polling is the only way to read input.

## 5. Layout

Passed to `host({ layout })`. Validated by the server; an invalid layout
makes `host()` reject with `code: 'bad-message'` and a message saying why.

```js
{
  stick: 'dpad',                    // 'dpad' (default) or 'none'
  buttons: [                        // 0-8 buttons; default: [{id:'a'},{id:'b'}]
    { id: 'punch', label: 'P', color: '#e5484d' },
    { id: 'kick',  label: 'K' },
    { id: 'super', label: 'SUPER', size: 'large' },
  ],
}
```

- `id`: `/^[A-Za-z0-9_-]{1,16}$/`, unique. It is the key in `buttons`/`pressed`.
- `label`: ≤ 8 chars (defaults to the id). `color`: `/^#[0-9a-f]{3,8}$/i`.
- `size`: `'large'` or omitted.
- Works in portrait and landscape (the pad page adapts; iOS cannot lock orientation).

## 6. Change a pad while playing

```js
room.pad(1, { title: 'Ryu', color: '#e5484d' });  // header text (≤ 20 chars) and accent color
room.pad(1, { highlight: ['a'] });                 // glow "press A to start" (+ short vibration)
room.pad(1, { disabled: ['super'] });              // greyed out, cannot be pressed
room.pad(1, { vibrate: 200 });                     // one-shot, ms (0-2000), Android only
room.pad(1, { highlight: [], disabled: [] });      // clear
```

Patches merge; the server remembers the last state per slot and re-sends it
when a phone (re)joins.

## 7. Full host API

```ts
const room = await host({ slots?: 1-8 = 2, layout?, server?: string });
room.code                 // 'KQZX' (4 consonants)
room.slots; room.status   // 'connecting' | 'connected' | 'reconnecting' | 'closed'
room.input(n)             // see section 4
room.connected(n)         // boolean
room.qr(n)                // URL of an SVG QR code for <img src>
room.joinUrl(n)           // the URL inside the QR: show it as text too
room.pad(n, patch)        // section 6
room.kick(n)              // disconnect that phone; it gets a "removed" screen
room.send(n, data)        // any JSON to one phone (custom controllers)
room.broadcast(data)      // any JSON to every phone
room.on(event, fn)        // returns an unsubscribe function
room.close()              // leave and forget the room (refresh keeps it otherwise)
```

Events: `join {slot, name, rejoin}`, `leave {slot, reason}` where reason is
`'left' | 'disconnected' | 'timeout' | 'kicked'`, `message {slot, data}`,
`status` (string).

`host()` rejects with an `Error` whose `code` is `'bad-message'` (invalid
options), `'server-full'` or `'version'`, or with "Cannot reach the Joinstick
server" when nothing answers.

A page refresh or a server restart is transparent: the room code and hostToken
are kept in `sessionStorage`, the host reconnects with backoff and recreates
the same code, and phones rejoin. QR codes stay valid.

## 8. CLI and embedding

```
joinstick [--port 3000] [--static ./dir] [--public-url URL]
```

| Flag | Env | Purpose |
|---|---|---|
| `--port` | `PORT` | Port (default 3000). |
| `--static <dir>` | | Serve your game from the same server (recommended). |
| `--public-url <url>` | `PUBLIC_URL` | Base URL phones should open (tunnels, Docker, reverse proxies). |

The join URL base is chosen as: `--public-url`, else the `Host` header the
game used if it is not loopback, else the detected LAN IPv4 (192.168.x
preferred; Docker/VPN/virtual interfaces skipped). All candidates are printed
at startup.

Embed in an existing Node server instead of using the CLI:

```js
import http from 'node:http';
import { attach } from 'joinstick';
const server = http.createServer(app); // your handler keeps every other path
attach(server, { static: './dist', publicUrl: process.env.PUBLIC_URL });
server.listen(3000);
```

Routes: WebSocket `/joinstick/ws`; SDKs `/joinstick/host.js`,
`/joinstick/client.js` (CORS `*`); pad page `/j` and `/j/ROOM/SLOT`; QR
`/joinstick/qr.svg?room=&slot=` (existing rooms only); `/llms.txt`.

### Game served elsewhere (Vite, another port)

```js
import { host } from 'joinstick/host'; // npm i joinstick (types included)
const room = await host({ slots: 2, server: `http://${location.hostname}:3000` });
```

Pass `server` whenever host.js is bundled; by default it connects to the
origin it was loaded from. Or import it at runtime from
`http://localhost:3000/joinstick/host.js` (CORS is open).

## 9. Custom controllers and remote play

`/joinstick/client.js` is what the default pad page is built on. Use it for a
custom phone UI or a remote client:

```js
import { join } from '/joinstick/client.js';
const pad = await join({ room: 'KQZX', slot: 1, name: 'Ana' }); // slot omitted = first free
pad.setInput({ x: 0, y: -1, buttons: { a: true } }); // full state on every change
pad.send({ chat: 'gg' });                            // host gets room.on('message')
pad.on('message', (data) => {});                     // from room.send / broadcast
pad.on('pad', (state, patch) => {});                 // title/color/highlight/disabled/vibrate
pad.on('error', (err) => {});                        // kicked, room-closed, replaced...
pad.on('status', (s) => {});
pad.leave();
```

`join()` rejects with `err.code` in `room-not-found`, `slot-taken` (with
`err.free`, the free slots), `bad-slot`, `version`, `unreachable`. Tokens are
kept in `localStorage` (`joinstick:ROOM:SLOT`) so the same browser rejoins the
same slot.

Remote players over the internet:

```sh
cloudflared tunnel --url http://localhost:3000     # prints https://xyz.trycloudflare.com
npx joinstick --static ./my-game --public-url https://xyz.trycloudflare.com
```

QR codes and `joinUrl()` then point at the tunnel; phones use `wss://` automatically.

## 10. Error codes

| Code | Meaning |
|---|---|
| `room-not-found` | No room with that code (typo, or the host is gone). |
| `slot-taken` | Another phone holds that slot. Comes with `free: [..]`. |
| `bad-slot` | Slot is not an integer in 1..slots. |
| `bad-message` | Malformed or invalid message; `message` says why. Not fatal. |
| `replaced` | The same player (or host) connected again elsewhere; this connection is closed. |
| `kicked` | The host called `room.kick(n)`. |
| `room-closed` | The host was gone for 60 s; the room was deleted. |
| `version` | Protocol version mismatch. |
| `server-full` | 1000 rooms already exist. |
| `unreachable` | Client SDK only: the server could not be reached. |

## 11. Pitfalls

- **First run on macOS/Windows** shows a firewall prompt for Node. Allow it, or
  phones cannot connect.
- **Guest / hotel / office Wi-Fi** often isolates clients (AP isolation):
  phones cannot reach the laptop. Use a phone hotspot or `--public-url` with a tunnel.
- **Plain HTTP on a LAN** works, but phones get no wake lock, no fullscreen on
  iOS, and `vibrate` only works on Android.
- **Mixed content:** a game page served over HTTPS cannot open `ws://` to a LAN
  server. Serve the game with `--static`, or put both behind HTTPS (tunnel +
  `--public-url`).
- **Docker** breaks LAN IP detection (you get the container IP). Pass
  `--public-url http://<host-lan-ip>:3000`.
- Check the printed "Phones join at" URL: if it is not reachable from a phone,
  nothing else will be.

## 12. Don't

- Don't use `innerHTML` with player names, messages or anything from the
  network. Use `textContent`.
- Don't trigger one-shot actions from held state; use `pressed`.
- Don't call `input(n)` more than once per frame per slot (it consumes `pressed`).
- Don't assume a slot is connected; check `room.connected(n)` or listen to `leave`.
