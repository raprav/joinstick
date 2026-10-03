// Joinstick host SDK: create a room, show one QR per player slot, poll input.
// Plain ESM, no dependencies. Types: host.d.ts. Protocol: PROTOCOL.md.
import { link } from './link.js';

const STORE_KEY = 'joinstick:host';

function storage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function host({ slots = 2, layout, server } = {}) {
  const base = (server ?? new URL('..', import.meta.url).href).replace(/\/+$/, '');
  const store = storage();
  let saved = null;
  try {
    saved = JSON.parse(store?.getItem(STORE_KEY) ?? 'null');
  } catch {}
  if (saved?.server !== base) saved = null;

  let code = saved?.room ?? null;
  let hostToken = saved?.hostToken ?? null;
  let joinBase = base;
  let buttonIds = [];
  let status = 'connecting';
  let ready = false;
  const listeners = {};
  const padState = {};
  const state = Array.from({ length: slots }, () => ({ connected: false, name: '', x: 0, y: 0, buttons: {}, pressed: {} }));

  function emit(ev, arg) {
    for (const fn of listeners[ev] ?? []) {
      try {
        fn(arg);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function setStatus(s) {
    if (s !== status) emit('status', (status = s));
  }

  function at(n) {
    if (!Number.isInteger(n) || n < 1 || n > slots) throw new RangeError(`slot must be an integer 1-${slots} (slots are 1-based)`);
    return state[n - 1];
  }

  function neutral(s) {
    s.x = 0;
    s.y = 0;
    s.buttons = Object.fromEntries(buttonIds.map((id) => [id, false]));
    s.pressed = {};
  }

  function leave(n, reason) {
    const s = state[n - 1];
    neutral(s);
    if (!s.connected) return;
    s.connected = false;
    emit('leave', { slot: n, reason });
  }

  function join(n, name, rejoin) {
    const s = state[n - 1];
    neutral(s);
    s.connected = true;
    s.name = name;
    emit('join', { slot: n, name, rejoin });
  }

  return new Promise((resolve, reject) => {
    const conn = link(base.replace(/^http/, 'ws') + '/joinstick/ws', {
      open: () => conn.send({ t: 'create', v: 1, slots, layout, room: code, hostToken }),
      down() {
        for (let n = 1; n <= slots; n++) leave(n, 'disconnected');
        if (!ready) return fail(new Error(`Cannot reach the Joinstick server at ${base}`));
        setStatus('reconnecting');
        conn.retry();
      },
      message(m) {
        if (m.t === 'created') {
          code = m.room;
          hostToken = m.hostToken;
          joinBase = m.joinBase;
          buttonIds = m.layout.buttons.map((b) => b.id);
          try {
            store?.setItem(STORE_KEY, JSON.stringify({ server: base, room: code, hostToken }));
          } catch {}
          conn.up();
          for (const s of state) neutral(s);
          for (const s of m.slots) if (s.connected) join(s.slot, s.name, true);
          // The server forgets pad state if it restarted; send ours again.
          for (const [n, patch] of Object.entries(padState)) conn.send({ t: 'pad', slot: Number(n), patch });
          setStatus('connected');
          if (!ready) resolve(room);
          ready = true;
        } else if (m.t === 'join') {
          join(m.slot, m.name, m.rejoin);
        } else if (m.t === 'leave') {
          leave(m.slot, m.reason);
        } else if (m.t === 'input') {
          const s = state[m.slot - 1];
          if (!s) return;
          const buttons = {};
          for (const id of buttonIds) buttons[id] = !!m.b[id];
          for (const id in buttons) if (buttons[id] && !s.buttons[id]) s.pressed[id] = true;
          s.x = m.x;
          s.y = m.y;
          s.buttons = buttons;
        } else if (m.t === 'message') {
          emit('message', { slot: m.slot, data: m.data });
        } else if (m.t === 'error') {
          if (!ready) return fail(Object.assign(new Error(`Joinstick: ${m.code}${m.message ? ` (${m.message})` : ''}`), { code: m.code }));
          if (m.code === 'replaced') return close();
          console.warn('joinstick:', m.code, m.message ?? '');
        }
      },
    });

    function fail(err) {
      close();
      reject(err);
    }

    function close() {
      conn.stop(1000);
      for (let n = 1; n <= slots; n++) leave(n, 'disconnected');
      setStatus('closed');
    }

    const room = {
      get code() {
        return code;
      },
      get slots() {
        return slots;
      },
      get status() {
        return status;
      },
      input(n) {
        const s = at(n);
        const out = { x: s.x, y: s.y, buttons: { ...s.buttons }, pressed: s.pressed };
        s.pressed = {};
        return out;
      },
      connected: (n) => at(n).connected,
      qr: (n) => at(n) && `${base}/joinstick/qr.svg?room=${code}&slot=${n}`,
      joinUrl: (n) => at(n) && `${joinBase}/j/${code}/${n}`,
      pad(n, patch) {
        at(n);
        const { vibrate, ...keep } = patch;
        padState[n] = { ...padState[n], ...keep };
        conn.send({ t: 'pad', slot: n, patch });
      },
      kick: (n) => at(n) && conn.send({ t: 'kick', slot: n }),
      send: (n, data) => at(n) && conn.send({ t: 'send', slot: n, data }),
      broadcast: (data) => conn.send({ t: 'send', slot: null, data }),
      on(ev, fn) {
        (listeners[ev] ??= new Set()).add(fn);
        return () => listeners[ev].delete(fn);
      },
      close() {
        try {
          store?.removeItem(STORE_KEY);
        } catch {}
        close();
      },
    };

    conn.connect();
  });
}
