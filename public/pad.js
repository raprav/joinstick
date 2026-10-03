// Default gamepad page served at /j and /j/ROOM/SLOT. Built on client.js.
import { join } from './client.js';

const COLOR = /^#[0-9a-f]{3,8}$/i;
const PALETTE = ['#e5484d', '#3e9bff', '#30a46c', '#f5a524', '#8e4ec6', '#e54d9e', '#12a594', '#f76b15'];
const $ = (id) => document.getElementById(id);
const reload = () => location.reload();
const go = (url) => () => location.assign(url);

// Keep the browser from zooming, selecting text or opening menus mid-game.
for (const ev of ['gesturestart', 'dblclick', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault());
for (const ev of ['touchstart', 'touchmove']) $('pad').addEventListener(ev, (e) => e.preventDefault(), { passive: false });

function screen(title, text = '', actions = []) {
  $('screen').hidden = false;
  $('screen-title').textContent = title;
  $('screen-text').textContent = text;
  $('screen-actions').replaceChildren(
    ...actions.map(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      return b;
    }),
  );
}

function showError(err, room, slot) {
  $('pad').hidden = true;
  const free = err.free ?? [];
  const messages = {
    'slot-taken': [`Player ${slot} is taken`, free.length ? 'Pick a free spot:' : 'The game is full.', free.map((n) => [`Player ${n}`, go(`/j/${room}/${n}`)])],
    'room-not-found': ['Room not found', `There is no game with code ${room}. Check the code on the game screen.`, [['Enter another code', go('/j')]]],
    'bad-slot': ['No such player', `Room ${room} has no player ${slot}.`, [['Take a free spot', go(`/j/${room}`)]]],
    kicked: ['You were removed', 'The game disconnected this controller.', [['Join again', reload]]],
    'room-closed': ['Game closed', 'The game has ended.', [['Join another game', go('/j')]]],
    replaced: ['Opened somewhere else', `Player ${slot} is now controlled from another tab or phone.`, [['Take it back', reload]]],
    unreachable: ["Can't reach the game", 'Make sure this phone is on the same Wi-Fi as the game.', [['Retry', reload]]],
  };
  screen(...(messages[err.code] ?? ['Something went wrong', String(err.code ?? err.message ?? err), [['Retry', reload]]]));
}

const [, roomParam, slotParam] = location.pathname.match(/^\/j(?:\/([A-Za-z]{4}))?(?:\/(\d))?/) ?? [];
if (roomParam) start(roomParam.toUpperCase(), slotParam ? Number(slotParam) : undefined);
else showForm();

function showForm() {
  $('screen').hidden = true;
  const form = $('form');
  form.hidden = false;
  form.onsubmit = (e) => {
    e.preventDefault();
    location.assign(`/j/${form.room.value.trim().toUpperCase()}/${form.slot.value}`);
  };
}

async function start(room, slot) {
  screen('Connecting…', `Room ${room}`);
  let pad;
  try {
    pad = await join({ room, slot, name: new URLSearchParams(location.search).get('name') ?? undefined });
  } catch (err) {
    return showError(err, room, slot);
  }
  history.replaceState(null, '', `/j/${pad.room}/${pad.slot}${location.search}`);
  play(pad);
}

// Up needs a clearly upward angle (30°-150°) so a resting thumb does not
// jump by accident; the other sectors are the usual 45°. 0° = right, 90° = up.
function direction(deg) {
  if (deg >= 30 && deg < 70) return { x: 1, y: -1 };
  if (deg >= 70 && deg < 110) return { x: 0, y: -1 };
  if (deg >= 110 && deg < 150) return { x: -1, y: -1 };
  if (deg >= 150 || deg < -157.5) return { x: -1, y: 0 };
  if (deg < -112.5) return { x: -1, y: 1 };
  if (deg < -67.5) return { x: 0, y: 1 };
  if (deg < -22.5) return { x: 1, y: 1 };
  return { x: 1, y: 0 };
}

function play(pad) {
  const main = $('pad');
  const controls = $('controls');
  const stickEl = $('stick');
  const buttons = new Map(); // id -> element
  const pointers = new Map(); // pointerId -> 'stick' | button id | null
  let stick = { x: 0, y: 0 };
  let held = {};
  let disabled = new Set();
  let geo = null;
  let layoutKey = '';

  main.hidden = false;
  $('screen').hidden = true;
  $('code').textContent = pad.room;
  $('slot').textContent = `P${pad.slot}`;
  $('hero').textContent = `P${pad.slot}`;

  function render() {
    const key = JSON.stringify(pad.layout);
    if (key === layoutKey) return;
    layoutKey = key;
    geo = null;
    const { stick: kind, buttons: list } = pad.layout;
    stickEl.hidden = kind === 'none';
    const box = $('buttons');
    box.replaceChildren();
    buttons.clear();
    list.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = b.size === 'large' ? 'btn large' : 'btn';
      el.textContent = b.label; // layout comes from the host: text only, never HTML
      el.style.setProperty('--c', COLOR.test(b.color ?? '') ? b.color : PALETTE[i % PALETTE.length]);
      box.append(el);
      buttons.set(b.id, el);
    });
    box.style.setProperty('--cols', list.length === 1 ? 1 : 2);
    box.style.setProperty('--wide', Math.ceil(list.length / 2)); // landscape: two rows
    box.classList.toggle('many', list.length > 4);
    release();
    applyState(pad.state, {});
  }

  function applyState(state, patch) {
    $('title').textContent = state.title ?? '';
    main.style.setProperty('--accent', COLOR.test(state.color ?? '') ? state.color : '');
    const glow = new Set(state.highlight ?? []);
    disabled = new Set(state.disabled ?? []);
    for (const [id, el] of buttons) {
      el.classList.toggle('glow', glow.has(id) && !disabled.has(id)); // disabled wins
      el.classList.toggle('off', disabled.has(id));
    }
    if (patch.vibrate) navigator.vibrate?.(patch.vibrate);
    else if (patch.highlight?.length) navigator.vibrate?.(40);
    update();
  }

  function measure() {
    const s = stickEl.getBoundingClientRect();
    const b = $('buttons').getBoundingClientRect();
    return {
      stick: { x: s.left + s.width / 2, y: s.top + s.height / 2, r: s.width / 2 },
      split: stickEl.hidden ? -Infinity : (s.right + b.left) / 2,
      buttons: [...buttons].map(([id, el]) => {
        const r = el.getBoundingClientRect();
        return { id, x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
      }),
    };
  }

  // Nearest enabled button under the finger, with some slack around each one.
  function hit(e) {
    let best = null;
    let bestD = Infinity;
    for (const b of geo.buttons) {
      const d = Math.hypot(e.clientX - b.x, e.clientY - b.y);
      if (d < b.r + 14 && d < bestD && !disabled.has(b.id)) [best, bestD] = [b.id, d];
    }
    return best;
  }

  function moveStick(e) {
    const { x, y, r } = geo.stick;
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    stick = Math.hypot(dx, dy) < r * 0.15 ? { x: 0, y: 0 } : direction((Math.atan2(-dy, dx) * 180) / Math.PI);
  }

  function update() {
    const next = {};
    for (const id of buttons.keys()) next[id] = false;
    for (const v of pointers.values()) if (v && v !== 'stick' && !disabled.has(v)) next[v] = true;
    for (const [id, el] of buttons) {
      if (next[id] && !held[id]) navigator.vibrate?.(8);
      el.classList.toggle('down', next[id]);
    }
    held = next;
    for (const [dir, on] of [['up', stick.y < 0], ['down', stick.y > 0], ['left', stick.x < 0], ['right', stick.x > 0]]) {
      stickEl.querySelector(`.${dir}`).classList.toggle('on', on);
    }
    pad.setInput({ x: stick.x, y: stick.y, buttons: held });
  }

  function release() {
    pointers.clear();
    stick = { x: 0, y: 0 };
    update();
  }

  controls.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    geo ??= measure();
    const id = hit(e);
    const stickFree = ![...pointers.values()].includes('stick');
    if (id) pointers.set(e.pointerId, id);
    else if (stickFree && e.clientX < geo.split) {
      pointers.set(e.pointerId, 'stick');
      moveStick(e);
    } else pointers.set(e.pointerId, null);
    update();
  });
  controls.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    if (pointers.get(e.pointerId) === 'stick') moveStick(e);
    else pointers.set(e.pointerId, hit(e)); // sliding between buttons
    update();
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    controls.addEventListener(ev, (e) => {
      if (pointers.get(e.pointerId) === 'stick') stick = { x: 0, y: 0 };
      pointers.delete(e.pointerId);
      update();
    });
  }
  addEventListener('resize', () => {
    geo = null;
    release();
  });
  addEventListener('blur', release);
  addEventListener('pagehide', release);
  document.addEventListener('touchcancel', release);
  document.addEventListener('visibilitychange', () => document.hidden && release());

  // Leaving is quick but not accidental: hold the button for 600 ms.
  const leave = $('leave');
  let leaveTimer;
  leave.addEventListener('pointerdown', () => {
    leave.classList.add('holding');
    leaveTimer = setTimeout(() => {
      release();
      pad.leave();
      navigator.vibrate?.(60);
      main.hidden = true;
      screen('You left', `Player ${pad.slot} is free now.`, [['Join again', reload]]);
    }, 600);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    leave.addEventListener(ev, () => {
      clearTimeout(leaveTimer);
      leave.classList.remove('holding');
    });
  }

  // A resumed host may send a new layout (as a fresh 'joined') with the pad state.
  pad.on('pad', (state, patch) => {
    render();
    applyState(state, patch);
  });
  pad.on('error', (err) => showError(err, pad.room, pad.slot));
  pad.on('status', (s) => {
    if (s === 'reconnecting') screen('Reconnecting…', 'Getting back into the game.');
    if (s === 'connected') {
      render();
      $('screen').hidden = true;
    }
  });
  render();
}
