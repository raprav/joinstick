// Pure geometry for the pad page (no DOM): d-pad sectors, the rotation used to
// force an orientation, and button arrangements. Tested in test/pad-layout.test.js.

// Up needs a clearly upward angle (30°-150°) so a resting thumb does not
// jump by accident; the other sectors are the usual 45°. 0° = right, 90° = up.
export function direction(deg) {
  if (deg >= 30 && deg < 70) return { x: 1, y: -1 };
  if (deg >= 70 && deg < 110) return { x: 0, y: -1 };
  if (deg >= 110 && deg < 150) return { x: -1, y: -1 };
  if (deg >= 150 || deg < -157.5) return { x: -1, y: 0 };
  if (deg < -112.5) return { x: -1, y: 1 };
  if (deg < -67.5) return { x: 0, y: 1 };
  if (deg < -22.5) return { x: 1, y: 1 };
  return { x: 1, y: 0 };
}

// How far (degrees, clockwise) to rotate the pad so it shows in `mode` inside
// a w x h viewport. 90 means "turn the phone counter-clockwise to play", the
// usual landscape for games; the stick then sits under the left thumb.
export function rotation(mode, w, h) {
  if (mode === 'landscape' && h > w) return 90;
  if (mode === 'portrait' && w > h) return -90;
  return 0;
}

// Viewport point -> pad point. The pad is drawn with
//   90: translateX(w) rotate(90deg)    -90: translateY(h) rotate(-90deg)
export function toPad(x, y, rot, w, h) {
  if (rot === 90) return { x: y, y: w - x };
  if (rot === -90) return { x: h - y, y: x };
  return { x, y };
}

// Viewport rect (getBoundingClientRect) -> rect in pad coordinates.
export function rectToPad(r, rot, w, h) {
  if (rot === 90) return { left: r.top, top: w - r.right, width: r.height, height: r.width };
  if (rot === -90) return { left: h - r.bottom, top: r.left, width: r.height, height: r.width };
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// Distance from a point to a button's edge (negative inside). Buttons are
// circles (w == h) or horizontal pills.
export function edgeDistance(px, py, b) {
  const dx = Math.max(Math.abs(px - b.x) - (b.w - b.h) / 2, 0);
  return Math.hypot(dx, py - b.y) - b.h / 2;
}

// Units below: 1 = a normal button's diameter.
export const GAP = 0.2;
const WIDE_H = 0.8;
const diameter = (b) => (b.size === 'large' ? 1.25 : 1);

// Two columns (more in landscape), the first column a bit lower like an
// arcade panel.
function grid(list, tall) {
  const n = list.length;
  const cols = n <= 1 ? 1 : n <= 4 || tall ? 2 : Math.ceil(n / 2);
  const cell = Math.max(1, ...list.map(diameter));
  const stagger = cols === 2 ? cell * 0.35 : 0;
  return list.map((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { id: b.id, x: col * (cell + GAP), y: row * (cell + GAP) + (col === 0 ? stagger : 0), w: diameter(b), h: diameter(b) };
  });
}

// First four as face buttons (bottom, left, right, top), the rest in
// columns of up to three to the left, between the stick and the diamond.
function diamond(list) {
  const face = list.slice(0, 4);
  const cell = Math.max(1, ...face.map(diameter));
  const r = (cell + GAP) / Math.SQRT2;
  const spots = [[0, r], [-r, 0], [r, 0], [0, -r]];
  const out = face.map((b, i) => ({ id: b.id, x: spots[i][0], y: spots[i][1], w: diameter(b), h: diameter(b) }));
  let edge = -r - cell / 2;
  for (let i = 4; i < list.length; i += 3) {
    const col = list.slice(i, i + 3);
    const size = Math.max(...col.map(diameter));
    const x = edge - GAP - size / 2;
    const total = col.reduce((sum, b) => sum + diameter(b), 0) + GAP * (col.length - 1);
    let y = -total / 2;
    for (const b of col) {
      out.push({ id: b.id, x, y: y + diameter(b) / 2, w: diameter(b), h: diameter(b) });
      y += diameter(b) + GAP;
    }
    edge = x - size / 2;
  }
  return out;
}

// The first button is the big anchor where the right thumb rests; the rest
// fan out around it, from its left over its top, ring after ring.
function arc(list) {
  const anchor = 1.45;
  const out = list.length ? [{ id: list[0].id, x: 0, y: 0, w: anchor, h: anchor }] : [];
  let inner = anchor / 2;
  let rest = list.slice(1);
  while (rest.length) {
    const size = Math.max(...rest.map(diameter));
    const radius = inner + GAP + size / 2;
    const step = 2 * Math.asin(Math.min(1, (size + GAP) / (2 * radius)));
    const from = Math.PI; // straight left of the anchor
    const to = (80 * Math.PI) / 180;
    const fit = Math.max(1, Math.floor((from - to) / step) + 1);
    rest.slice(0, fit).forEach((b, i) => {
      const a = from - i * step;
      out.push({ id: b.id, x: radius * Math.cos(a), y: -radius * Math.sin(a), w: diameter(b), h: diameter(b) });
    });
    rest = rest.slice(fit);
    inner = radius + size / 2;
  }
  return out;
}

/**
 * Place buttons for an arrangement. Returns centers and sizes in units, inside
 * a box of `width` x `height` units. 'wide' buttons are pills in rows under
 * the others, where a thumb can rest on them.
 */
export function arrange(list, arrangement = 'grid', tall = false) {
  const round = list.filter((b) => b.size !== 'wide');
  const wide = list.filter((b) => b.size === 'wide');
  const items = arrangement === 'arc' ? arc(round) : arrangement === 'diamond' ? diamond(round) : grid(round, tall);

  const minX = Math.min(...items.map((b) => b.x - b.w / 2));
  const minY = Math.min(...items.map((b) => b.y - b.h / 2));
  let width = items.length ? Math.max(...items.map((b) => b.x + b.w / 2)) - minX : 0;
  let height = items.length ? Math.max(...items.map((b) => b.y + b.h / 2)) - minY : 0;
  const barW = Math.max(width, 2.4);
  const shift = wide.length ? (barW - width) / 2 : 0;
  for (const b of items) {
    b.x += shift - minX;
    b.y -= minY;
  }
  if (wide.length) width = barW;
  let y = items.length ? height + GAP : 0;
  for (const b of wide) {
    items.push({ id: b.id, x: width / 2, y: y + WIDE_H / 2, w: width, h: WIDE_H });
    y += WIDE_H + GAP;
  }
  if (wide.length) height = y - GAP;
  return { items, width, height };
}
