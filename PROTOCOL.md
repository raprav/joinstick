# Joinstick protocol, version 1

Plain JSON text frames over one WebSocket at `/joinstick/ws`. Every message is
an object with a string field `t`. You only need this to write a client in
another language; browser code should use `host.js` / `client.js`.

```
 host (game)                    server                     pad (phone)
   | create ------------------->  |                            |
   | <------------------ created  |                            |
   |                              | <---------------------- join
   | <--------------------- join  | joined ------------------> |
   | <-------------------- input  | <--------------------- input
   | pad / send / kick ---------> | pad / message / error ---> |
   | <------------------- leave   |          (socket closed)   |
```

A connection is a host or a pad, decided by its first message (`create` or
`join`). Anything else first gets `bad-message`.

## Common rules

- Max frame size 8 KB; bigger frames close the socket with code 1009.
- Unknown or malformed messages get `{t:'error', code:'bad-message', message}`
  and are otherwise ignored.
- Slots are 1-based integers. Room codes are 4 letters from
  `BCDFGHJKLMNPQRSTVWXZ`, case-insensitive (the server upper-cases them).
- Fatal errors are sent as `{t:'error', code}` and then the server closes the
  socket with code 4000 and the error code as reason.

## Liveness

The server sends `{t:'ping'}` every 2 s to every socket. Clients answer
`{t:'pong'}`. Any message counts as activity. The server drops a socket after
5 s of silence; clients should drop and reconnect after 5 s without any
message from the server.

## Host → server

### `create`

```json
{"t":"create","v":1,"slots":2,"layout":{"stick":"dpad","buttons":[{"id":"a","label":"A"}]},"room":"KQZX","hostToken":"…","resetPads":true}
```

| Field | |
|---|---|
| `v` | Must be `1`, else fatal `version`. |
| `slots` | 1-8, default 2. |
| `layout` | Optional. `stick`: `'dpad'` (default) or `'none'`. `orientation`: `'landscape'`, `'portrait'` or `'any'`. `arrangement`: `'grid'`, `'diamond'` or `'arc'`. `haptics`: boolean. `buttons`: ≤ 8 of `{id, label?, color?, size?, haptic?, system?}`; `id` `/^[A-Za-z0-9_-]{1,16}$/`, unique, not an `Object.prototype` name; `label` ≤ 8 chars (default id), `color` `/^#[0-9a-f]{3,8}$/i`, `size` `'large'` or `'wide'`, `haptic` integer ms 0-100, `system` boolean. Optional fields are echoed only when given; the pad applies the defaults (landscape, grid, haptics on, 10 ms). Default: d-pad + buttons `a`, `b`. |
| `room`, `hostToken` | Optional, to resume. |
| `resetPads` | Optional. `true` on resume clears every slot's pad state (the game was reloaded). The host SDK sends it on the first `create` of each `host()` call. |

Resume-or-recreate:

- `room` exists, `hostToken` matches and `slots` is the same → **resume** the
  same room and pads. A previous host connection gets fatal `replaced`. If the
  layout changed or `resetPads` is true, connected pads receive a fresh
  `joined`. Right after `created`, the server sends the last `input` of every
  connected pad, so held state survives the reload.
- `room` does not exist, `room` is a valid code and `hostToken` is 32 hex
  chars → **recreate** the room with that code and token (server restart case).
- Otherwise → a new room with a new code and token.

More than 1000 rooms, or 20 rooms created from the same client address →
fatal `server-full`.

### `pad`

```json
{"t":"pad","slot":1,"patch":{"title":"Ryu","color":"#e5484d","highlight":["a"],"disabled":["b"],"vibrate":200}}
```

All patch fields optional: `title` (string, trimmed to 20 chars), `color` (hex),
`highlight` / `disabled` (arrays of ≤ 8 button ids), `vibrate` (integer
0-2000 ms). The server merges the patch into that slot's pad state (everything
but `vibrate`), keeps it while the room lives, and forwards the patch to the
pad.

### `send`

```json
{"t":"send","slot":1,"data":{"any":"json"}}
{"t":"send","slot":null,"data":"to every pad"}
```

### `kick`

```json
{"t":"kick","slot":1}
```

The pad gets fatal `kicked`; the host gets `leave` with reason `kicked`.

## Server → host

### `created`

```json
{"t":"created","room":"KQZX","hostToken":"9f…32 hex","joinBase":"http://192.168.1.20:3000","layout":{…validated…},"slots":[{"slot":1,"connected":false,"name":""}]}
```

Pads join at `${joinBase}/j/${room}/${slot}`. The QR for a slot is
`/joinstick/qr.svg?room=KQZX&slot=1` on the Joinstick server.

### `join`

```json
{"t":"join","slot":1,"name":"Ana","rejoin":false}
```

`rejoin` is true when the token is the same as the slot's previous occupant
(same phone coming back, or taking over from another tab).

### `leave`

```json
{"t":"leave","slot":1,"reason":"left"}
```

`reason`: `left` (pad closed with code 1000), `disconnected` (any other
close, including a locked phone), `timeout` (no pong for 5 s), `kicked`.

### `input`

```json
{"t":"input","slot":1,"x":-1,"y":0,"b":{"a":true,"b":false}}
```

Full state, forwarded as sent by the pad (x, y clamped to [-1, 1]). The first
`input` after a `join` (or after `created` on resume) is the slot's baseline:
buttons already down in it are held, not new presses. The client SDK always
sends one right after `joined`.

### `message`

```json
{"t":"message","slot":1,"data":{"any":"json"}}
```

## Pad → server

### `join`

```json
{"t":"join","v":1,"room":"KQZX","slot":1,"token":"32 hex chars","name":"Ana"}
```

| Field | |
|---|---|
| `v` | Must be `1`, else fatal `version`. |
| `room` | Case-insensitive. Unknown → `room-not-found`. |
| `slot` | Optional. Omitted/null → the slot this token held before, else the first free one. Not 1..slots → `bad-slot`. |
| `token` | `/^[A-Za-z0-9_-]{16,64}$/`, generated and stored by the client. Identifies the phone. |
| `name` | Optional, control chars stripped, trimmed to 20 chars. |

The first join and a rejoin are the same message. Outcomes:

- Slot empty → taken.
- Slot occupied by the **same token** → the new connection wins; the old one
  gets fatal `replaced`.
- Slot occupied by **another token** → `{t:'error', code:'slot-taken', free:[2,3]}`.

After 5 failed joins on one socket the server closes it. After 20 failed
joins from one client address within a minute, every further `join` from
that address gets fatal `rate-limited` until the minute is over. Failures in
the first minute after the server starts are not counted: phones are still
waiting for their game to recreate its room.

### `input`

```json
{"t":"input","x":0,"y":-1,"b":{"a":true}}
```

Full state on every change. `x`, `y` are finite numbers (clamped to [-1, 1];
`y` = -1 is up). `b` maps ≤ 16 button ids to booleans (`Object.prototype`
names are refused). While the host is away it is not forwarded, but the
server keeps the latest one per slot for the host's resume. Send your current
state right after every `joined`.

### `msg`

```json
{"t":"msg","data":{"any":"json"}}
```

Delivered to the host as `message` with the pad's slot.

## Server → pad

### `joined`

```json
{"t":"joined","room":"KQZX","slot":1,"layout":{…},"pad":{"title":"Ryu","color":"#e5484d"}}
```

`pad` is the slot's current pad state. Sent again (same shape) when the host
resumes with a different layout or with `resetPads`.

### `pad`

```json
{"t":"pad","patch":{"highlight":["a"],"vibrate":200}}
```

### `message`

```json
{"t":"message","data":{"any":"json"}}
```

## Errors

| Code | Fatal | When |
|---|---|---|
| `room-not-found` | no | `join` with an unknown room. |
| `slot-taken` | no | Slot held by another token. Includes `free`. |
| `bad-slot` | no | Slot is not an integer in 1..slots. |
| `bad-message` | no | Invalid JSON, shape or values. Includes `message`. |
| `replaced` | yes | Same host token or pad token connected again. |
| `kicked` | yes | Host kicked this pad. |
| `room-closed` | yes | Host gone for 60 s; room deleted. |
| `version` | yes | `v` is not 1. |
| `server-full` | yes | Room limit reached (1000 total, 20 per client address). |
| `rate-limited` | yes | 20 failed joins from this client address in the last minute. |

"Fatal" means the server closes the socket right after the error. Failed
joins (the non-fatal join errors) count toward the 5-failure limit.

## Host disconnects

When the host socket closes, the room stays for 60 s. Pads stay connected
(their input is dropped). A host that sends `create` with the same `room` and
`hostToken` within that time resumes it; otherwise every pad gets
`room-closed` and the room is deleted.
