// Joinstick client SDK: join a room as a player from a phone (or any browser).
// The default pad page is built on this. Types: client.d.ts. Protocol: PROTOCOL.md.
import { link } from './link.js';

const REJOIN_WINDOW = 60_000;
const FATAL = new Set(['room-not-found', 'slot-taken', 'bad-slot', 'replaced', 'kicked', 'room-closed', 'version']);
const memory = new Map();

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getItem(key) {
  try {
    return storage()?.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function setItem(key, value) {
  memory.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {}
}

// crypto.randomUUID() is missing on plain-HTTP LAN origins; getRandomValues is not.
function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const NEUTRAL = { t: 'input', x: 0, y: 0, b: {} };

export function join({ room: roomCode, slot, name, server } = {}) {
  const base = (server ?? new URL('..', import.meta.url).href).replace(/\/+$/, '');
  const room = String(roomCode ?? '').trim().toUpperCase();
  let token = (slot && getItem(`joinstick:${room}:${slot}`)) || newToken();
  let layout = null;
  let padState = {};
  let status = 'connecting';
  let ready = false;
  let closed = false;
  let hidden = false;
  let lostAt = 0;
  let input = NEUTRAL;
  let lastSent = '';
  const listeners = {};

  function emit(ev, ...args) {
    for (const fn of listeners[ev] ?? []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function setStatus(s) {
    if (s !== status) emit('status', (status = s));
  }

  function sendInput(force) {
    const s = JSON.stringify(input);
    if (s === lastSent && !force) return;
    lastSent = s;
    conn.send(input);
  }

  let resolveJoin, rejectJoin;
  const joined = new Promise((res, rej) => ((resolveJoin = res), (rejectJoin = rej)));

  const conn = link(base.replace(/^http/, 'ws') + '/joinstick/ws', {
    open: () => conn.send({ t: 'join', v: 1, room, slot, token, name }),
    down() {
      if (!ready) return end({ code: 'unreachable', message: `Cannot reach the Joinstick server at ${base}` });
      lostAt ||= Date.now();
      setStatus('reconnecting');
      if (!hidden) conn.retry();
    },
    message(m) {
      if (m.t === 'joined') {
        slot = m.slot;
        layout = m.layout;
        padState = { ...m.pad };
        setItem(`joinstick:${room}:${slot}`, token);
        conn.up();
        lostAt = 0;
        lastSent = '';
        if (input !== NEUTRAL) sendInput(true);
        if (!ready) resolveJoin(pad);
        ready = true;
        emit('pad', padState, {});
        setStatus('connected');
      } else if (m.t === 'pad') {
        const { vibrate, ...keep } = m.patch;
        padState = { ...padState, ...keep };
        emit('pad', padState, m.patch);
      } else if (m.t === 'message') {
        emit('message', m.data);
      } else if (m.t === 'error') {
        // After a server restart the host needs a moment to recreate the room.
        if (m.code === 'room-not-found' && ready && Date.now() - lostAt < REJOIN_WINDOW) return conn.drop();
        if (FATAL.has(m.code)) return end(m);
        console.warn('joinstick:', m.code, m.message ?? '');
      }
    },
  });

  function end(err) {
    if (closed) return;
    closed = true;
    conn.stop(1000);
    setStatus('closed');
    if (!ready) return rejectJoin(Object.assign(new Error(`Joinstick: ${err.code}`), err));
    emit('error', err);
  }

  // A locked or backgrounded phone leaves at once (the game can pause) and
  // rejoins the same slot when it comes back.
  function suspend() {
    if (!ready || closed || hidden) return;
    hidden = true;
    input = NEUTRAL;
    conn.drop(4001);
  }

  function resume() {
    if (!hidden || closed) return;
    hidden = false;
    conn.connect();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => (document.hidden ? suspend() : resume()));
    addEventListener('pagehide', suspend);
    addEventListener('pageshow', resume);
  }

  const pad = {
    get room() {
      return room;
    },
    get slot() {
      return slot;
    },
    get layout() {
      return layout;
    },
    get state() {
      return padState;
    },
    get status() {
      return status;
    },
    setInput({ x = 0, y = 0, buttons = {} } = {}) {
      input = { t: 'input', x, y, b: buttons };
      sendInput();
    },
    send: (data) => conn.send({ t: 'msg', data }),
    on(ev, fn) {
      (listeners[ev] ??= new Set()).add(fn);
      return () => listeners[ev].delete(fn);
    },
    leave() {
      if (closed) return;
      closed = true;
      conn.stop(1000);
      setStatus('closed');
    },
  };

  conn.connect();
  return joined;
}
