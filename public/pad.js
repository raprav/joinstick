// Default gamepad page served at /j and /j/ROOM/SLOT. Built on client.js.
import { join } from './client.js';
import { arrange, direction, edgeDistance, rectToPad, rotation, tapLength, toPad } from './pad-layout.js';

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

// iOS Safari has no navigator.vibrate, but toggling a native switch control
// plays the system haptic (iOS 18). Elsewhere this click does nothing visible.
function buzz(ms) {
  if (!ms) return;
  if (navigator.vibrate) navigator.vibrate(ms);
  else $('haptic').click();
}

function play(pad) {
  const main = $('pad');
  const controls = $('controls');
  const stickEl = $('stick');
  const box = $('buttons');
  const buttons = new Map(); // id -> element
  const pointers = new Map(); // pointerId -> 'stick' | button id | null
  let layout = pad.layout;
  let stick = { x: 0, y: 0 };
  let held = {};
  let disabled = new Set();
  let placed = []; // arranged gameplay buttons, in units
  let unit = 0; // px per unit
  let rot = 0;
  let geo = null;
  let layoutKey = '';

  main.hidden = false;
  $('screen').hidden = true;
  $('code').textContent = pad.room;
  $('slot').textContent = `P${pad.slot}`;
  $('hero').textContent = `P${pad.slot}`;

  const haptic = (id) => tapLength(layout, id);

  function render() {
    const key = JSON.stringify(pad.layout);
    if (key === layoutKey) return;
    layoutKey = key;
    layout = pad.layout;
    stickEl.hidden = layout.stick === 'none';
    box.replaceChildren();
    $('system').replaceChildren();
    buttons.clear();
    layout.buttons.forEach((b, i) => {
      const el = document.createElement('div');
      const text = document.createElement('span');
      text.textContent = b.label; // layout comes from the host: text only, never HTML
      el.append(text);
      if (b.system) {
        el.className = 'sys';
        bindSystem(el, b.id);
        $('system').append(el);
      } else {
        el.className = 'btn';
        el.style.setProperty('--c', COLOR.test(b.color ?? '') ? b.color : PALETTE[i % PALETTE.length]);
        box.append(el);
      }
      buttons.set(b.id, el);
    });
    release();
    place();
    applyState(pad.state, {});
  }

  // Rotate the pad if the viewport has the wrong orientation, then size and
  // place the buttons in the space the stick leaves.
  function place() {
    const w = innerWidth;
    const h = innerHeight;
    rot = rotation(layout.orientation ?? 'landscape', w, h);
    main.style.setProperty('--vw', `${w}px`);
    main.style.setProperty('--vh', `${h}px`);
    main.classList.toggle('rot90', rot === 90);
    main.classList.toggle('rot-90', rot === -90);
    const tall = (rot ? w : h) > (rot ? h : w);
    main.classList.toggle('tall', tall);

    const { items, width, height } = arrange(layout.buttons.filter((b) => !b.system), layout.arrangement, tall);
    box.style.width = box.style.height = '0';
    const cs = getComputedStyle(controls);
    const px = (v) => parseFloat(v) || 0;
    const availW = controls.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) - (stickEl.hidden ? 0 : stickEl.offsetWidth + px(cs.columnGap));
    const availH = tall ? main.clientHeight * 0.42 : controls.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
    unit = Math.max(0, Math.min(Math.min(w, h) * 0.24, 100, availW / (width || 1), availH / (height || 1)));
    box.style.width = `${width * unit}px`;
    box.style.height = `${height * unit}px`;
    for (const it of items) {
      const el = buttons.get(it.id);
      Object.assign(el.style, {
        left: `${(it.x - it.w / 2) * unit}px`,
        top: `${(it.y - it.h / 2) * unit}px`,
        width: `${it.w * unit}px`,
        height: `${it.h * unit}px`,
      });
      // Shrink the label until it fits inside the button (labels are ≤ 8 chars).
      let size = Math.round(0.28 * unit * Math.max(1, Math.min(it.w, it.h)));
      el.style.fontSize = `${size}px`;
      while (el.firstChild.offsetWidth > el.clientWidth * 0.78 && size > 9) el.style.fontSize = `${--size}px`;
    }
    placed = items;
    geo = null;
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
    if (patch.vibrate) buzz(patch.vibrate);
    else if (patch.highlight?.length) buzz(40);
    update();
  }

  // Everything in pad coordinates, so a rotated pad needs no special cases.
  function measure() {
    const [w, h] = [innerWidth, innerHeight];
    const s = rectToPad(stickEl.getBoundingClientRect(), rot, w, h);
    const b = rectToPad(box.getBoundingClientRect(), rot, w, h);
    return {
      stick: { x: s.left + s.width / 2, y: s.top + s.height / 2, r: s.width / 2 },
      split: stickEl.hidden ? -Infinity : (s.left + s.width + b.left) / 2,
      buttons: placed.map((it) => ({ id: it.id, x: b.left + it.x * unit, y: b.top + it.y * unit, w: it.w * unit, h: it.h * unit })),
      // Larger than half of any gap between buttons: no dead spots between them.
      slack: Math.max(16, unit / 2),
    };
  }

  const point = (e) => toPad(e.clientX, e.clientY, rot, innerWidth, innerHeight);

  // Nearest enabled button under (or near) the finger.
  function hit(p) {
    let best = null;
    let bestD = geo.slack;
    for (const b of geo.buttons) {
      const d = edgeDistance(p.x, p.y, b);
      if (d < bestD && !disabled.has(b.id)) [best, bestD] = [b.id, d];
    }
    return best;
  }

  function moveStick(p) {
    const { x, y, r } = geo.stick;
    const dx = p.x - x;
    const dy = p.y - y;
    const next = Math.hypot(dx, dy) < r * 0.15 ? { x: 0, y: 0 } : direction((Math.atan2(-dy, dx) * 180) / Math.PI);
    if ((next.x || next.y) && (next.x !== stick.x || next.y !== stick.y)) buzz(haptic('stick'));
    stick = next;
  }

  function update() {
    const next = {};
    for (const id of buttons.keys()) next[id] = false;
    for (const v of pointers.values()) if (v && v !== 'stick' && !disabled.has(v)) next[v] = true;
    for (const [id, el] of buttons) {
      if (next[id] && !held[id]) buzz(haptic(id));
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

  // System buttons (START, MENU...) sit in the top bar, away from the thumbs.
  function bindSystem(el, id) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers.set(e.pointerId, id);
      update();
    });
    // Touch pointers stay captured by the pill; a mouse releases it on leaving.
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(ev, (e) => pointers.delete(e.pointerId) && update());
    }
  }

  controls.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    geo ??= measure();
    const p = point(e);
    const id = hit(p);
    const stickFree = ![...pointers.values()].includes('stick');
    if (id) pointers.set(e.pointerId, id);
    else if (stickFree && p.x < geo.split) {
      pointers.set(e.pointerId, 'stick');
      moveStick(p);
    } else pointers.set(e.pointerId, null);
    update();
  });
  controls.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    if (pointers.get(e.pointerId) === 'stick') moveStick(point(e));
    else pointers.set(e.pointerId, hit(point(e))); // sliding between buttons
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
    release();
    place();
  });
  addEventListener('blur', release);
  addEventListener('pagehide', release);
  document.addEventListener('touchcancel', release);
  document.addEventListener('visibilitychange', () => document.hidden && release());

  // Where the browser allows it (Android Chrome), the first tap on a rotated
  // pad goes fullscreen and locks the orientation; CSS rotation covers the rest.
  let lockTried = false;
  main.addEventListener(
    'pointerdown',
    () => {
      if (lockTried || !rot || !matchMedia('(pointer: coarse)').matches) return;
      lockTried = true;
      const root = document.documentElement;
      if (!root.requestFullscreen || !screen.orientation?.lock) return;
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation.lock(rot === 90 ? 'landscape' : 'portrait'))
        .catch(() => {});
    },
    { capture: true },
  );

  // Leaving is quick but not accidental: hold the button for 600 ms.
  const leave = $('leave');
  let leaveTimer;
  leave.addEventListener('pointerdown', () => {
    leave.classList.add('holding');
    leaveTimer = setTimeout(() => {
      release();
      pad.leave();
      buzz(60);
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
