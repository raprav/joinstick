import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { attach } from '../src/server.js';
import { host } from '../public/host.js';
import { join } from '../public/client.js';

const T1 = 'token-one-aaaaaaaaaaaa';
const T2 = 'token-two-bbbbbbbbbbbb';

async function start({ port = 0, handler, ...opts } = {}) {
  const server = http.createServer(handler);
  const js = attach(server, opts);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      js.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Raw protocol client. Pings are swallowed and never answered.
function sock(url) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/joinstick/ws');
  const queue = [];
  let wake = () => {};
  const opened = new Promise((resolve) => ws.addEventListener('open', resolve));
  const closed = new Promise((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'ping') return;
    queue.push(m);
    wake();
  });
  return {
    closed,
    async send(m) {
      await opened;
      ws.send(typeof m === 'string' ? m : JSON.stringify(m));
    },
    async next(ms = 2000) {
      const deadline = Date.now() + ms;
      while (!queue.length) {
        if (Date.now() > deadline) throw new Error('timed out waiting for a message');
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, 20);
        });
      }
      return queue.shift();
    },
    async close(code) {
      await opened;
      ws.close(code);
    },
  };
}

async function until(fn, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createRoom(url, extra = {}) {
  const h = sock(url);
  h.send({ t: 'create', v: 1, slots: 2, ...extra });
  return { h, created: await h.next() };
}

async function joinPad(url, room, slot, token, name) {
  const p = sock(url);
  p.send({ t: 'join', v: 1, room, slot, token, name });
  return { p, joined: await p.next() };
}

test('create, join, input and leave', async () => {
  const srv = await start();
  const { h, created } = await createRoom(srv.url);
  assert.equal(created.t, 'created');
  assert.match(created.room, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.match(created.hostToken, /^[0-9a-f]{32}$/);
  assert.match(created.joinBase, /^http:\/\//);
  assert.deepEqual(created.layout, { stick: 'dpad', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual(created.slots, [
    { slot: 1, connected: false, name: '' },
    { slot: 2, connected: false, name: '' },
  ]);

  const { p, joined } = await joinPad(srv.url, created.room.toLowerCase(), 1, T1, '  Ana\n');
  assert.deepEqual(joined, { t: 'joined', room: created.room, slot: 1, layout: created.layout, pad: {} });
  assert.deepEqual(await h.next(), { t: 'join', slot: 1, name: 'Ana', rejoin: false });

  p.send({ t: 'input', x: 5, y: -1, b: { a: true } });
  assert.deepEqual(await h.next(), { t: 'input', slot: 1, x: 1, y: -1, b: { a: true } });

  p.close(1000);
  assert.deepEqual(await h.next(), { t: 'leave', slot: 1, reason: 'left' });

  const again = await joinPad(srv.url, created.room, 1, T1);
  assert.equal(again.joined.t, 'joined');
  assert.deepEqual(await h.next(), { t: 'join', slot: 1, name: '', rejoin: true });
  await srv.stop();
});

test('slot race: one wins, the other gets slot-taken with free slots', async () => {
  const srv = await start();
  const { created } = await createRoom(srv.url);
  const [a, b] = await Promise.all([joinPad(srv.url, created.room, 1, T1), joinPad(srv.url, created.room, 1, T2)]);
  const results = [a.joined, b.joined].sort((x, y) => x.t.localeCompare(y.t));
  assert.equal(results[0].t, 'error');
  assert.equal(results[0].code, 'slot-taken');
  assert.deepEqual(results[0].free, [2]);
  assert.equal(results[1].t, 'joined');
  await srv.stop();
});

test('omitted slot takes the first free one; a full room says slot-taken', async () => {
  const srv = await start();
  const { created } = await createRoom(srv.url);
  assert.equal((await joinPad(srv.url, created.room, undefined, T1)).joined.slot, 1);
  assert.equal((await joinPad(srv.url, created.room, null, T2)).joined.slot, 2);
  const full = await joinPad(srv.url, created.room, undefined, 'token-three-cccccccccc');
  assert.deepEqual(full.joined, { t: 'error', code: 'slot-taken', free: [] });
  await srv.stop();
});

test('same token takes over its slot and the old connection is replaced', async () => {
  const srv = await start();
  const { h, created } = await createRoom(srv.url);
  const first = await joinPad(srv.url, created.room, 1, T1);
  await h.next();
  const second = await joinPad(srv.url, created.room, 1, T1);
  assert.equal(second.joined.t, 'joined');
  assert.deepEqual(await first.p.next(), { t: 'error', code: 'replaced' });
  await first.p.closed;
  assert.deepEqual(await h.next(), { t: 'join', slot: 1, name: '', rejoin: true });
  await srv.stop();
});

test('kick, pad patches and messaging', async () => {
  const srv = await start();
  const { h, created } = await createRoom(srv.url);
  const { p } = await joinPad(srv.url, created.room, 1, T1);
  await h.next();

  h.send({ t: 'pad', slot: 1, patch: { title: 'Ryu', color: '#f00', highlight: ['a'], vibrate: 100 } });
  assert.deepEqual(await p.next(), { t: 'pad', patch: { title: 'Ryu', color: '#f00', highlight: ['a'], vibrate: 100 } });

  h.send({ t: 'send', slot: 1, data: { hello: 1 } });
  assert.deepEqual(await p.next(), { t: 'message', data: { hello: 1 } });
  h.send({ t: 'send', slot: null, data: 'all' });
  assert.deepEqual(await p.next(), { t: 'message', data: 'all' });
  p.send({ t: 'msg', data: [1, 2] });
  assert.deepEqual(await h.next(), { t: 'message', slot: 1, data: [1, 2] });

  h.send({ t: 'kick', slot: 1 });
  assert.deepEqual(await p.next(), { t: 'error', code: 'kicked' });
  assert.deepEqual(await h.next(), { t: 'leave', slot: 1, reason: 'kicked' });

  // Pad state (minus vibrate) is restored on the next join of that slot.
  const again = await joinPad(srv.url, created.room, 1, T2);
  assert.deepEqual(again.joined.pad, { title: 'Ryu', color: '#f00', highlight: ['a'] });
  await srv.stop();
});

test('bad messages, bad slots and limits', async () => {
  const srv = await start();
  const s = sock(srv.url);
  s.send('not json');
  assert.equal((await s.next()).code, 'bad-message');
  s.send({ t: 'input', x: 0, y: 0 });
  assert.equal((await s.next()).code, 'bad-message');

  const bad = sock(srv.url);
  bad.send({ t: 'create', v: 1, layout: { buttons: [{ id: 'a', label: 'TOO LONG LABEL' }] } });
  assert.match((await bad.next()).message, /label/);
  bad.send({ t: 'create', v: 1, layout: { buttons: [{ id: 'a', color: 'red;}' }] } });
  assert.match((await bad.next()).message, /color/);
  bad.send({ t: 'create', v: 1, slots: 9 });
  assert.equal((await bad.next()).code, 'bad-message');

  const old = sock(srv.url);
  old.send({ t: 'create', v: 2 });
  assert.deepEqual(await old.next(), { t: 'error', code: 'version' });
  await old.closed;

  const { h, created } = await createRoom(srv.url);
  h.send({ t: 'pad', slot: 3, patch: {} });
  assert.equal((await h.next()).code, 'bad-message');

  const p = sock(srv.url);
  for (const slot of [0, 3, 1.5]) {
    p.send({ t: 'join', v: 1, room: created.room, slot, token: T1 });
    assert.equal((await p.next()).code, 'bad-slot');
  }
  p.send({ t: 'join', v: 1, room: 'ZZZZ', token: T1 });
  assert.equal((await p.next()).code, 'room-not-found');
  p.send({ t: 'join', v: 1, room: 'ZZZZ', token: T1 });
  assert.equal((await p.next()).code, 'room-not-found');
  assert.equal(await p.closed, 4000, 'closed after 5 failed joins');

  const big = sock(srv.url);
  big.send({ t: 'create', v: 1, pad: 'x'.repeat(9000) });
  assert.equal(await big.closed, 1009);
  await srv.stop();
});

test('host drop: resume within the grace period, room-closed after it', async () => {
  const srv = await start({ hostGraceMs: 300 });
  const { h, created } = await createRoom(srv.url);
  const { p } = await joinPad(srv.url, created.room, 1, T1);
  await h.next();
  await h.close(1000);

  const back = await createRoom(srv.url, { room: created.room, hostToken: created.hostToken });
  assert.equal(back.created.room, created.room);
  assert.equal(back.created.slots[0].connected, true);

  // Someone else asking for the same code without its token gets a new room.
  const other = await createRoom(srv.url, { room: created.room, hostToken: '0'.repeat(32) });
  assert.notEqual(other.created.room, created.room);

  await back.h.close(1000);
  assert.deepEqual(await p.next(1000), { t: 'error', code: 'room-closed' });
  await srv.stop();
});

test('silent sockets are dropped and the host is told why', async () => {
  const srv = await start();
  const room = await host({ server: srv.url });
  const leaves = [];
  room.on('leave', (e) => leaves.push(e));
  const p = sock(srv.url);
  p.send({ t: 'join', v: 1, room: room.code, slot: 1, token: T1 });
  await p.next();
  await until(() => room.connected(1));
  await until(() => leaves.length > 0, 9000);
  assert.deepEqual(leaves, [{ slot: 1, reason: 'timeout' }]);
  room.close();
  await srv.stop();
});

test('host SDK: pressed latch, neutral input on leave, slot checks', async () => {
  const srv = await start();
  const layout = { buttons: [{ id: 'punch', label: 'P' }, { id: 'kick', label: 'K' }] };
  const room = await host({ server: srv.url, layout });
  const events = [];
  room.on('join', (e) => events.push(['join', e]));
  room.on('leave', (e) => events.push(['leave', e]));

  assert.deepEqual(room.input(1), { x: 0, y: 0, buttons: { punch: false, kick: false }, pressed: {} });
  assert.throws(() => room.input(0), RangeError);
  assert.throws(() => room.input(3), RangeError);
  assert.equal(room.qr(1), `${srv.url}/joinstick/qr.svg?room=${room.code}&slot=1`);
  assert.match(room.joinUrl(2), new RegExp(`/j/${room.code}/2$`));

  const pad = await join({ server: srv.url, room: room.code.toLowerCase(), slot: 1, name: 'Ken' });
  assert.equal(pad.slot, 1);
  assert.deepEqual(pad.layout, { stick: 'dpad', buttons: layout.buttons });
  await until(() => room.connected(1));
  assert.deepEqual(events, [['join', { slot: 1, name: 'Ken', rejoin: false }]]);

  const msgs = [];
  room.on('message', (e) => msgs.push(e));
  pad.on('message', (d) => msgs.push(d));

  // A tap shorter than one poll is still seen exactly once. The trailing
  // message (same socket, so ordered) tells us all inputs have arrived.
  pad.setInput({ x: -1, buttons: { kick: true } });
  pad.setInput({ x: -1, buttons: { kick: true, punch: true } });
  pad.setInput({ x: -1, buttons: { kick: true } });
  pad.send({ ready: true });
  await until(() => msgs.length === 1);
  assert.deepEqual(msgs, [{ slot: 1, data: { ready: true } }]);
  assert.deepEqual(room.input(1), { x: -1, y: 0, buttons: { punch: false, kick: true }, pressed: { kick: true, punch: true } });
  assert.deepEqual(room.input(1).pressed, {});

  room.send(1, 'hi');
  await until(() => msgs.length === 2);
  assert.equal(msgs[1], 'hi');

  pad.leave();
  await until(() => !room.connected(1));
  assert.deepEqual(events.at(-1), ['leave', { slot: 1, reason: 'left' }]);
  assert.deepEqual(room.input(1), { x: 0, y: 0, buttons: { punch: false, kick: false }, pressed: {} });
  room.close();
  await srv.stop();
});

test('server restart: host recreates the same room and pads rejoin', async () => {
  let srv = await start();
  const room = await host({ server: srv.url, slots: 2 });
  const code = room.code;
  const pad = await join({ server: srv.url, room: code, slot: 2 });
  await until(() => room.connected(2));
  room.pad(2, { title: 'Blue' });

  const statuses = [];
  room.on('status', (s) => statuses.push(s));
  await srv.stop();
  await until(() => !room.connected(2));
  srv = await start({ port: srv.port });

  await until(() => room.connected(2) && pad.status === 'connected', 8000);
  assert.equal(room.code, code);
  assert.deepEqual(statuses, ['reconnecting', 'connected']);
  await until(() => pad.state.title === 'Blue');
  pad.setInput({ y: 1 });
  await until(() => room.input(2).y === 1);
  pad.leave();
  room.close();
  await srv.stop();
});

test('host SDK rejects when the layout is invalid or the server is down', async () => {
  const srv = await start();
  await assert.rejects(host({ server: srv.url, layout: { stick: 'joystick' } }), { code: 'bad-message' });
  await srv.stop();
  await assert.rejects(host({ server: srv.url }), /Cannot reach/);
  await assert.rejects(join({ server: srv.url, room: 'BCDF' }), { code: 'unreachable' });
});

test('client SDK rejects unknown rooms and taken slots', async () => {
  const srv = await start();
  const room = await host({ server: srv.url, slots: 2 });
  await assert.rejects(join({ server: srv.url, room: 'ZZZZ', slot: 1 }), { code: 'room-not-found' });
  const pad = await join({ server: srv.url, room: room.code, slot: 1 });
  const other = await joinPad(srv.url, room.code, 1, T2);
  assert.deepEqual(other.joined, { t: 'error', code: 'slot-taken', free: [2] });
  pad.leave();
  room.close();
  await srv.stop();
});

test('http routes: SDKs, pad page, QR, llms.txt, static files, fallback handler', async () => {
  const srv = await start({ static: 'test', handler: (req, res) => res.end('app') });
  const get = (p) => fetch(srv.url + p);

  const sdk = await get('/joinstick/host.js');
  assert.equal(sdk.status, 200);
  assert.equal(sdk.headers.get('access-control-allow-origin'), '*');
  assert.match(sdk.headers.get('content-type'), /javascript/);
  for (const p of ['/joinstick/client.js', '/joinstick/link.js', '/joinstick/pad.js', '/joinstick/pad.css', '/llms.txt']) {
    assert.equal((await get(p)).status, 200, p);
  }
  for (const p of ['/j', '/j/', '/j/kqzx', '/j/KQZX/2']) {
    assert.match(await (await get(p)).text(), /<html/, p);
  }

  const { created } = await createRoom(srv.url);
  const qr = await get(`/joinstick/qr.svg?room=${created.room}&slot=2`);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /^<svg/);

  assert.equal(await (await get('/protocol.test.js')).status, 200);
  // Unknown QR rooms and paths outside the static dir fall through to the app handler.
  assert.equal(await (await get('/joinstick/qr.svg?room=ZZZZ&slot=1')).text(), 'app');
  assert.equal(await (await get('/..%2fpackage.json')).text(), 'app');
  assert.equal(await (await get('/%2e%2e/package.json')).text(), 'app');
  await srv.stop();
});
