import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { renderSVG } from 'uqr';
import { isLoopback, lanAddresses } from './lan.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const SDK_FILES = new Set(['host.js', 'host.d.ts', 'client.js', 'client.d.ts', 'link.js', 'pad.js', 'pad-layout.js', 'pad.css']);

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
const ID = /^[A-Za-z0-9_-]{1,16}$/;
const COLOR = /^#[0-9a-f]{3,8}$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const HOST_TOKEN = /^[0-9a-f]{32}$/;

const MAX_SLOTS = 8;
const MAX_BUTTONS = 8;
const MAX_ROOMS = 1000;
const MAX_ROOMS_PER_IP = 20;
const MAX_FAILED_JOINS = 5; // per socket
const MAX_FAILED_JOINS_PER_IP = 20; // per minute, across sockets: slows down code guessing
const FAILED_WINDOW = 60_000;
const PING_EVERY = 2000;
const SILENCE = 5000;
const DEFAULT_LAYOUT = { stick: 'dpad', buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

class BadMessage extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function check(ok, message) {
  if (!ok) throw new BadMessage(message);
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function parseLayout(l) {
  if (l === undefined || l === null) return DEFAULT_LAYOUT;
  check(isObj(l), 'layout must be an object');
  const stick = l.stick ?? 'dpad';
  check(stick === 'dpad' || stick === 'none', "layout.stick must be 'dpad' or 'none'");
  const extra = {};
  if (l.orientation !== undefined) {
    check(['landscape', 'portrait', 'any'].includes(l.orientation), "layout.orientation must be 'landscape', 'portrait' or 'any'");
    extra.orientation = l.orientation;
  }
  if (l.arrangement !== undefined) {
    check(['grid', 'diamond', 'arc'].includes(l.arrangement), "layout.arrangement must be 'grid', 'diamond' or 'arc'");
    extra.arrangement = l.arrangement;
  }
  if (l.haptics !== undefined) {
    check(typeof l.haptics === 'boolean', 'layout.haptics must be a boolean');
    extra.haptics = l.haptics;
  }
  const list = l.buttons ?? [];
  check(Array.isArray(list) && list.length <= MAX_BUTTONS, `layout.buttons must be an array of at most ${MAX_BUTTONS}`);
  const seen = new Set();
  const buttons = list.map((b) => {
    check(isObj(b) && typeof b.id === 'string' && ID.test(b.id), 'button id must match [A-Za-z0-9_-]{1,16}');
    check(!(b.id in Object.prototype), `button id '${b.id}' is reserved`);
    check(!seen.has(b.id), `duplicate button id '${b.id}'`);
    seen.add(b.id);
    const label = b.label ?? b.id;
    check(typeof label === 'string' && label.length <= 8, `button '${b.id}' label must be a string of at most 8 chars`);
    check(b.color === undefined || (typeof b.color === 'string' && COLOR.test(b.color)), `button '${b.id}' color must be a hex color`);
    check(b.size === undefined || b.size === 'large' || b.size === 'wide', `button '${b.id}' size must be 'large', 'wide' or omitted`);
    check(b.haptic === undefined || (Number.isInteger(b.haptic) && b.haptic >= 0 && b.haptic <= 100), `button '${b.id}' haptic must be 0-100 ms`);
    check(b.system === undefined || typeof b.system === 'boolean', `button '${b.id}' system must be a boolean`);
    const out = { id: b.id, label };
    if (b.color) out.color = b.color;
    if (b.size) out.size = b.size;
    if (b.haptic !== undefined) out.haptic = b.haptic;
    if (b.system) out.system = true;
    return out;
  });
  return { stick, ...extra, buttons };
}

function parseIds(v, name) {
  check(Array.isArray(v) && v.length <= MAX_BUTTONS && v.every((id) => typeof id === 'string' && ID.test(id)), `${name} must be an array of button ids`);
  return [...v];
}

function parsePatch(p) {
  check(isObj(p), 'patch must be an object');
  const out = {};
  if (p.title !== undefined) {
    check(typeof p.title === 'string', 'title must be a string');
    out.title = cleanText(p.title, 20);
  }
  if (p.color !== undefined) {
    check(typeof p.color === 'string' && COLOR.test(p.color), 'color must be a hex color');
    out.color = p.color;
  }
  if (p.highlight !== undefined) out.highlight = parseIds(p.highlight, 'highlight');
  if (p.disabled !== undefined) out.disabled = parseIds(p.disabled, 'disabled');
  if (p.vibrate !== undefined) {
    check(Number.isInteger(p.vibrate) && p.vibrate >= 0 && p.vibrate <= 2000, 'vibrate must be 0-2000 ms');
    out.vibrate = p.vibrate;
  }
  return out;
}

function parseButtons(b) {
  check(isObj(b), 'b must be an object');
  const keys = Object.keys(b);
  check(keys.length <= 16 && keys.every((k) => ID.test(k) && !(k in Object.prototype) && typeof b[k] === 'boolean'), 'b must map button ids to booleans');
  return b;
}

function axis(v) {
  check(typeof v === 'number' && Number.isFinite(v), 'x and y must be numbers');
  return Math.max(-1, Math.min(1, v));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function fatal(ws, code) {
  send(ws, { t: 'error', code });
  ws.close(4000, code);
}

/**
 * Add Joinstick to a Node http(s) server: the WebSocket endpoint, the browser
 * SDKs, the pad page, QR codes and (optionally) a static directory.
 * Existing 'request' listeners keep working for every other path.
 *
 * @param {import('node:http').Server} server
 * @param {{ static?: string, publicUrl?: string, hostGraceMs?: number }} [opts]
 * @returns {{ close(): void }}
 */
export function attach(server, opts = {}) {
  const publicUrl = opts.publicUrl?.replace(/\/+$/, '');
  const staticDir = opts.static && path.resolve(opts.static);
  const hostGrace = opts.hostGraceMs ?? 60_000;
  const rooms = new Map();
  const failedJoins = new Map(); // ip -> { count, since }
  // Right after a (re)start, phones of recreated rooms retry their joins
  // until the game page is back; those misses are not guessing.
  const countFailuresFrom = Date.now() + hostGrace;
  let closed = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  function joinBase(req) {
    if (publicUrl) return publicUrl;
    const proto = req.socket.encrypted ? 'https' : 'http';
    const host = req.headers.host ?? '';
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (host && !isLoopback(hostname)) return `${proto}://${host}`;
    const lan = lanAddresses()[0];
    const port = server.address()?.port;
    return lan ? `${proto}://${lan.address}:${port}` : `${proto}://${host || `localhost:${port}`}`;
  }

  function newCode() {
    let code;
    do code = Array.from({ length: 4 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join('');
    while (rooms.has(code));
    return code;
  }

  function slotList(room) {
    return room.slots.map((s, i) => ({ slot: i + 1, connected: !!s.ws, name: s.name }));
  }

  function freeSlots(room) {
    return room.slots.flatMap((s, i) => (s.ws ? [] : [i + 1]));
  }

  function slotOf(room, n) {
    check(Number.isInteger(n) && n >= 1 && n <= room.slots.length, `slot must be 1-${room.slots.length}`);
    return room.slots[n - 1];
  }

  function closeRoom(room) {
    rooms.delete(room.code);
    for (const s of room.slots) if (s.ws) fatal(s.ws, 'room-closed');
  }

  function onCreate(ws, m, req) {
    if (m.v !== 1) return fatal(ws, 'version');
    const n = m.slots ?? 2;
    check(Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS, `slots must be 1-${MAX_SLOTS}`);
    const layout = parseLayout(m.layout);
    const wanted = typeof m.room === 'string' ? m.room.toUpperCase() : '';
    let room = rooms.get(wanted);

    const ip = req.socket.remoteAddress;
    let resumed = false;
    if (room && room.hostToken === m.hostToken && room.slots.length === n) {
      // Resume: same room, same pads. Pads get a fresh 'joined' when the
      // layout changed or the host asks to reset pad state (game reloaded).
      resumed = true;
      clearTimeout(room.timer);
      const old = room.host;
      room.host = ws;
      if (old) fatal(old, 'replaced');
      const relayout = JSON.stringify(layout) !== JSON.stringify(room.layout);
      room.layout = layout;
      if (m.resetPads === true) for (const s of room.slots) s.pad = {};
      if (relayout || m.resetPads === true) {
        room.slots.forEach((s, i) => send(s.ws, { t: 'joined', room: room.code, slot: i + 1, layout, pad: s.pad }));
      }
    } else {
      if (rooms.size >= MAX_ROOMS) return fatal(ws, 'server-full');
      // ponytail: per-IP cap only; behind a tunnel every host shares one IP.
      if ([...rooms.values()].filter((r) => r.ip === ip).length >= MAX_ROOMS_PER_IP) return fatal(ws, 'server-full');
      // Recreate (e.g. after a server restart) keeps the code so pads can rejoin.
      const recreate = !room && CODE.test(wanted) && HOST_TOKEN.test(m.hostToken ?? '');
      room = {
        code: recreate ? wanted : newCode(),
        hostToken: recreate ? m.hostToken : crypto.randomBytes(16).toString('hex'),
        layout,
        slots: Array.from({ length: n }, () => ({ ws: null, token: null, name: '', pad: {}, input: null })),
        host: ws,
        timer: null,
        ip,
      };
      rooms.set(room.code, room);
    }
    ws.role = 'host';
    ws.room = room;
    room.joinBase = joinBase(req);
    send(ws, { t: 'created', room: room.code, hostToken: room.hostToken, joinBase: room.joinBase, layout: room.layout, slots: slotList(room) });
    // A refreshed game must still see a direction or button held through the refresh.
    if (resumed) room.slots.forEach((s, i) => s.ws && s.input && send(ws, { t: 'input', slot: i + 1, ...s.input }));
  }

  function onJoin(ws, m) {
    if (m.v !== 1) return fatal(ws, 'version');
    const now = Date.now();
    let recent = failedJoins.get(ws.ip);
    if (!recent || now - recent.since >= FAILED_WINDOW) recent = { count: 0, since: now };
    // ponytail: keyed by socket address, so behind a proxy or tunnel one guesser
    // locks every remote phone out for a minute; key on a trusted header if that matters.
    if (recent.count >= MAX_FAILED_JOINS_PER_IP) return fatal(ws, 'rate-limited');
    const fail = (code, extra) => {
      send(ws, { t: 'error', code, ...extra });
      if (now >= countFailuresFrom) failedJoins.set(ws.ip, { ...recent, count: recent.count + 1 });
      if (++ws.failedJoins >= MAX_FAILED_JOINS) ws.close(4000, 'too many failed joins');
    };
    if (typeof m.token !== 'string' || !TOKEN.test(m.token)) return fail('bad-message', { message: 'token must match [A-Za-z0-9_-]{16,64}' });
    const room = rooms.get(typeof m.room === 'string' ? m.room.toUpperCase() : '');
    if (!room) return fail('room-not-found');

    let i;
    if (m.slot === undefined || m.slot === null) {
      i = room.slots.findIndex((s) => s.token === m.token);
      if (i < 0) i = room.slots.findIndex((s) => !s.ws);
      if (i < 0) return fail('slot-taken', { free: [] });
    } else {
      if (!Number.isInteger(m.slot) || m.slot < 1 || m.slot > room.slots.length) return fail('bad-slot');
      i = m.slot - 1;
    }
    const s = room.slots[i];
    if (s.ws && s.token !== m.token) return fail('slot-taken', { free: freeSlots(room) });

    const old = s.ws;
    const rejoin = s.token === m.token;
    Object.assign(s, { ws, token: m.token, name: cleanText(m.name, 20), input: null });
    Object.assign(ws, { role: 'pad', room, slot: i + 1 });
    if (old) fatal(old, 'replaced');
    send(ws, { t: 'joined', room: room.code, slot: i + 1, layout: room.layout, pad: s.pad });
    send(room.host, { t: 'join', slot: i + 1, name: s.name, rejoin });
  }

  function onHost(ws, m) {
    const room = ws.room;
    if (m.t === 'send') {
      const msg = { t: 'message', data: m.data };
      if (m.slot === null || m.slot === undefined) for (const s of room.slots) send(s.ws, msg);
      else send(slotOf(room, m.slot).ws, msg);
    } else if (m.t === 'pad') {
      const s = slotOf(room, m.slot);
      const patch = parsePatch(m.patch);
      const { vibrate, ...keep } = patch;
      Object.assign(s.pad, keep);
      send(s.ws, { t: 'pad', patch });
    } else if (m.t === 'kick') {
      const s = slotOf(room, m.slot);
      if (s.ws) {
        s.ws.leaveReason = 'kicked';
        s.token = null;
        fatal(s.ws, 'kicked');
      }
    } else {
      throw new BadMessage(`unknown host message '${m.t}'`);
    }
  }

  function onPad(ws, m) {
    if (m.t === 'input') {
      // Kept while the host is away so a resumed host gets it right away.
      const input = { x: axis(m.x), y: axis(m.y), b: parseButtons(m.b ?? {}) };
      ws.room.slots[ws.slot - 1].input = input;
      send(ws.room.host, { t: 'input', slot: ws.slot, ...input });
    } else if (m.t === 'msg') {
      send(ws.room.host, { t: 'message', slot: ws.slot, data: m.data });
    } else {
      throw new BadMessage(`unknown pad message '${m.t}'`);
    }
  }

  function onClose(ws, code) {
    const room = ws.room;
    if (!room || closed) return;
    if (ws.role === 'host') {
      if (room.host !== ws) return;
      room.host = null;
      room.timer = setTimeout(() => closeRoom(room), hostGrace);
    } else {
      const s = room.slots[ws.slot - 1];
      if (s.ws !== ws) return;
      s.ws = null;
      send(room.host, { t: 'leave', slot: ws.slot, reason: ws.leaveReason ?? (code === 1000 ? 'left' : 'disconnected') });
    }
  }

  wss.on('connection', (ws, req) => {
    ws.seen = Date.now();
    ws.failedJoins = 0;
    ws.ip = req.socket.remoteAddress;
    ws.on('message', (raw, isBinary) => {
      ws.seen = Date.now();
      let m;
      try {
        m = isBinary ? null : JSON.parse(raw);
      } catch {}
      if (!isObj(m) || typeof m.t !== 'string') return send(ws, { t: 'error', code: 'bad-message', message: 'expected a JSON object with a string "t"' });
      if (m.t === 'pong') return;
      try {
        if (!ws.role && m.t === 'create') onCreate(ws, m, req);
        else if (!ws.role && m.t === 'join') onJoin(ws, m);
        else if (!ws.role) throw new BadMessage("first message must be 'create' or 'join'");
        else if (ws.role === 'host') onHost(ws, m);
        else onPad(ws, m);
      } catch (err) {
        if (!(err instanceof BadMessage)) console.error('joinstick:', err);
        send(ws, { t: 'error', code: 'bad-message', message: err instanceof BadMessage ? err.message : 'internal error' });
      }
    });
    ws.on('close', (code) => onClose(ws, code));
    ws.on('error', () => {});
  });

  const pinger = setInterval(() => {
    const now = Date.now();
    for (const [ip, recent] of failedJoins) if (now - recent.since >= FAILED_WINDOW) failedJoins.delete(ip);
    for (const ws of wss.clients) {
      if (now - ws.seen > SILENCE) {
        ws.leaveReason ??= 'timeout';
        ws.terminate();
      } else {
        send(ws, { t: 'ping' });
      }
    }
  }, PING_EVERY);
  pinger.unref();

  server.on('upgrade', (req, socket, head) => {
    // Compare the raw path: a malformed URL must not be able to throw here.
    if ((req.url ?? '').split('?')[0] === '/joinstick/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (server.listenerCount('upgrade') === 1) {
      socket.destroy();
    }
  });

  async function serveFile(req, res, file, headers = {}) {
    let body;
    try {
      if (!(await stat(file)).isFile()) return false;
      body = await readFile(file);
    } catch {
      return false;
    }
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (rel.split('/').some((part) => part.startsWith('.'))) return false; // .env, .git, ..
    let file = path.resolve(staticDir, '.' + rel);
    if (file !== staticDir && !file.startsWith(staticDir + path.sep)) return false;
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    return serveFile(req, res, file);
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      res.writeHead(400).end();
      return true;
    }
    const p = url.pathname;
    const cors = { 'access-control-allow-origin': '*' };

    if (p.startsWith('/joinstick/') && SDK_FILES.has(p.slice(11))) return serveFile(req, res, path.join(PUBLIC, p.slice(11)), cors);
    if (/^\/j(\/[A-Za-z]{4}(\/\d)?)?\/?$/.test(p)) return serveFile(req, res, path.join(PUBLIC, 'pad.html'));
    if (p === '/llms.txt') return serveFile(req, res, path.join(ROOT, 'llms.txt'), cors);
    if (p === '/joinstick/qr.svg') {
      const room = rooms.get((url.searchParams.get('room') ?? '').toUpperCase());
      const slot = url.searchParams.get('slot'); // no slot: the link gives the first free one
      const n = Number(slot);
      if (!room || (slot !== null && (!Number.isInteger(n) || n < 1 || n > room.slots.length))) return false;
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', ...cors });
      res.end(renderSVG(`${room.joinBase}/j/${room.code}${slot === null ? '' : `/${n}`}`, { border: 2 }));
      return true;
    }
    if (staticDir) return serveStatic(req, res, p);
    return false;
  }

  // Run our routes first and fall back to whatever handler the server already had.
  const previous = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    try {
      if (await handle(req, res)) return;
    } catch {
      if (!res.headersSent) res.writeHead(500);
      return res.end();
    }
    if (previous.length) for (const fn of previous) fn.call(server, req, res);
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  });

  return {
    close() {
      closed = true;
      clearInterval(pinger);
      for (const room of rooms.values()) clearTimeout(room.timer);
      rooms.clear();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
