# Joinstick for coding agents

Joinstick turns phones into gamepads for browser games. The game page (the
**host**) shows one QR code per player slot; a player scans it and the phone
becomes a controller. Read this file before integrating; it is the whole
contract. Wire format: [PROTOCOL.md](PROTOCOL.md). Types:
[`public/host.d.ts`](public/host.d.ts), [`public/client.d.ts`](public/client.d.ts).

## 1. Run the server

Joinstick is **not on npm yet**. Run it from a checkout (Node 22+):

```sh
git clone https://github.com/raprav/joinstick && (cd joinstick && npm install)
node joinstick/src/cli.js --static ./my-game   # serves the game AND Joinstick on :3000
# or add it to your project: npm i <git url or path to the checkout>, then npx joinstick --static ./my-game
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

The simplest correct recipe is to check every frame:

```js
const everyone = () => [1, 2].every((n) => room.connected(n));
// in your frame loop:
const paused = !everyone();
```

With events, also check once at start, because pads that were already
connected when `host()` resolved do not get a `join` event (see below):

```js
room.on('leave', ({ slot, reason }) => pause(`Waiting for player ${slot}`));
room.on('join', () => { if (everyone()) resume(); });
if (!everyone()) pause('Waiting for players');
```

`leave` fires immediately when a phone is locked, backgrounded, loses Wi-Fi,
holds "Leave", or is kicked. The same phone rejoins the same slot by itself
when it comes back; a new person can also scan that slot's QR.

Exact ordering in each reconnect case:

| Case | What the game sees |
|---|---|
| Game page reloaded (same tab) | `host()` resumes the room. Pads already connected show as `connected(n) === true` **when `host()` resolves**; no `join` event for them. Pads that arrive later get `join`. Held input is restored. |
| Host loses the server briefly (Wi-Fi blip) | `leave` (reason `'disconnected'`) for every connected slot, then `join` with `rejoin: true` for each once back. |
| Server restarted | `leave` (`'disconnected'`) for every slot; the host recreates the same code; each phone rejoins with a `join` whose `rejoin` is **false** (the server forgot the tokens). |
| Phone locked / Wi-Fi lost, then back | `leave` (`'disconnected'`), later `join` with `rejoin: true`. |

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
  empty and right after `leave`. After a `join` or a game reload, a direction
  or button the player is already holding shows in `x`/`y`/`buttons` but never
  in `pressed`.
- Read `input(n)` exactly once per frame per slot; a second read in the same
  frame has an empty `pressed`.
- The d-pad is 8-way. Up and the up-diagonals need the thumb clearly above
  horizontal (30° or more), so a resting thumb does not jump by accident.
- There is no input event; polling is the only way to read input.
- **Keep calling `input(n)` every frame while paused** and ignore the result.
  Otherwise presses made during the pause are still latched and fire the
  moment you resume.

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

- `id`: `/^[A-Za-z0-9_-]{1,16}$/`, unique, and not an `Object.prototype`
  name (`constructor`, `toString`, `__proto__`...). It is the key in `buttons`/`pressed`.
- `label`: ≤ 8 chars (defaults to the id). `color`: `/^#[0-9a-f]{3,8}$/i`.
- `size`: `'large'` or omitted.
- Works in portrait and landscape (the pad page adapts; iOS cannot lock orientation).

## 6. Change a pad while playing

```js
room.pad(1, { title: 'Ryu', color: '#e5484d' });  // header text (≤ 20 chars) and accent color
room.pad(1, { highlight: ['a'] });                 // glow and make the phone vibrate briefly (Android only)
room.pad(1, { disabled: ['super'] });              // greyed out, cannot be pressed
room.pad(1, { vibrate: 200 });                     // one-shot, ms (0-2000), Android only
room.pad(1, { highlight: [], disabled: [] });      // clear
```

Patches merge; the server remembers the last state per slot and re-sends it
when a phone (re)joins. A button that is both highlighted and disabled is
shown disabled, without glow (disabled wins).

A **game page reload** (any new `host()` call that resumes the room) resets
every pad to the default state, because the game starts from scratch. In-session
reconnects (Wi-Fi blips, server restarts) keep the pad state. Pads still
connected after a reload get no `join` event, so set their state at start too:

```js
const greet = (slot) => room.pad(slot, { title: `Player ${slot}` });
room.on('join', ({ slot }) => greet(slot));
for (let n = 1; n <= room.slots; n++) if (room.connected(n)) greet(n);
```

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
`status` (string), `error {code, message}` (server errors after `host()`
resolved).

`host()` rejects with an `Error` whose `code` is `'bad-message'` (invalid
options), `'server-full'` or `'version'`, or with "Cannot reach the Joinstick
server" when nothing answers. It never hangs on an error.

A page refresh or a server restart is transparent: the room code and hostToken
are kept in `sessionStorage`, the host reconnects with backoff and recreates
the same code, and phones rejoin. QR codes stay valid. A stored room is only
resumed with the same server URL and the same `slots`; otherwise `host()`
creates a new room.

**Duplicated tabs:** Chrome's "Duplicate tab" copies `sessionStorage`, so the
new tab resumes the same room and the original tab gets an `error` event with
`code: 'replaced'`, then `status: 'closed'` (it stops reconnecting). Show a
"this game is open in another tab" message on that event.

## 8. CLI and embedding

```
joinstick [--port 3000] [--static ./dir] [--public-url URL]
```

| Flag | Env | Purpose |
|---|---|---|
| `--port` | `PORT` | Port (default 3000). |
| `--static <dir>` | | Serve your game from the same server (recommended). |
| `--public-url <url>` | `PUBLIC_URL` | Base URL phones should open (tunnels, Docker, reverse proxies). Must be an origin like `https://abc.example.com`, without a path: Joinstick's routes live at the root. |

The join URL base is chosen as: `--public-url`, else the `Host` header the
game used if it is not loopback, else the detected LAN IPv4 (192.168.x
preferred; Docker/VPN/virtual interfaces skipped). All candidates are printed
at startup.

`--static` refuses dotfiles (`.env`, `.git/...`) and reads each file whole,
without HTTP Range support: fine for game assets, but Safari needs Range
requests to play `<video>`/`<audio>`, so serve media elsewhere if you need it.

Embed in an existing Node server instead of using the CLI:

```js
import http from 'node:http';
import { attach } from 'joinstick';
const server = http.createServer(app); // your handler keeps every other path
attach(server, { static: './dist', publicUrl: process.env.PUBLIC_URL });
server.listen(3000);
```

Call `attach()` after every other `'request'` listener is registered: it wraps
the listeners that exist at that moment, and later ones would also answer
Joinstick's routes.

Append `?name=Ana` to a join URL to give the player a name (shown to the host
in the `join` event).

Routes: WebSocket `/joinstick/ws`; SDKs `/joinstick/host.js`,
`/joinstick/client.js` (CORS `*`); pad page `/j` and `/j/ROOM/SLOT`; QR
`/joinstick/qr.svg?room=&slot=` (existing rooms only); `/llms.txt`.

### Game served elsewhere (Vite, another port)

```js
import { host } from 'joinstick/host'; // npm i <git url or checkout path> (types included)
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
node joinstick/src/cli.js --static ./my-game --public-url https://xyz.trycloudflare.com
```

QR codes and `joinUrl()` then point at the tunnel; phones use `wss://` automatically.

Room codes are 4 letters (160,000 combinations), so on a public URL anyone
patient can guess one and take a free slot. That is fine for playing with
friends; there is no authentication beyond the code. The server caps rooms at
1000 in total and 20 per client address (behind a tunnel all hosts share one
address).

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
| `server-full` | 1000 rooms already exist, or this address already created 20. |
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
- A pad in a **background tab** leaves its slot (that is the lock-screen
  behavior). When testing with pads in the browser, keep them in the visible
  game tab or a separate window, or use a Node script (next section).

## 12. Testing without phones

Drive pads from code with the client SDK; it is how you verify an
integration end to end. In the game tab's DevTools console (the room code is
`room.code`; use the full `http://localhost:3000/joinstick/client.js` URL if
the game is served from another origin):

```js
const { join } = await import('/joinstick/client.js');
const pad = await join({ room: 'KQZX', slot: 1 });
pad.setInput({ x: 1 });                                  // hold right
pad.setInput({ x: 1, buttons: { a: true } });            // press A...
pad.setInput({ x: 1, buttons: { a: false } });           // ...and release: pressed.a once
pad.leave();                                             // the game should pause
```

Or from a Node 22+ script next to the checkout (`node pads.mjs KQZX`):

```js
import { join } from './joinstick/public/client.js';
const pad = await join({ server: 'http://localhost:3000', room: process.argv[2], slot: 2 });
setInterval(() => pad.setInput({ x: Math.sign(Math.random() - 0.5) }), 500);
```

## 13. Don't

- Don't use `innerHTML` with player names, messages or anything from the
  network. Use `textContent`.
- Don't trigger one-shot actions from held state; use `pressed`.
- Don't call `input(n)` more than once per frame per slot (it consumes `pressed`).
- Don't assume a slot is connected; check `room.connected(n)` or listen to `leave`.
