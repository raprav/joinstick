import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP, arrange, direction, edgeDistance, rectToPad, rotation, toPad } from '../public/pad-layout.js';

test('d-pad: up needs a clearly upward angle', () => {
  assert.deepEqual(direction(0), { x: 1, y: 0 });
  assert.deepEqual(direction(25), { x: 1, y: 0 }); // resting thumb slightly up: still right
  assert.deepEqual(direction(50), { x: 1, y: -1 });
  assert.deepEqual(direction(90), { x: 0, y: -1 });
  assert.deepEqual(direction(180), { x: -1, y: 0 });
  assert.deepEqual(direction(-90), { x: 0, y: 1 });
});

test('orientation: rotate only when the viewport does not match', () => {
  assert.equal(rotation('landscape', 390, 844), 90);
  assert.equal(rotation('landscape', 844, 390), 0);
  assert.equal(rotation('portrait', 844, 390), -90);
  assert.equal(rotation('portrait', 390, 844), 0);
  assert.equal(rotation('any', 390, 844), 0);
});

test('rotated pad: touches map back to pad coordinates', () => {
  const [w, h] = [390, 844];
  // Pad top-left corner is drawn at the viewport's top-right corner.
  assert.deepEqual(toPad(w, 0, 90, w, h), { x: 0, y: 0 });
  // Pad bottom-left (where the left thumb is) is at the viewport's top-left.
  assert.deepEqual(toPad(0, 0, 90, w, h), { x: 0, y: w });
  // Moving the finger down the screen moves right on the pad.
  assert.ok(toPad(100, 500, 90, w, h).x > toPad(100, 400, 90, w, h).x);
  assert.deepEqual(toPad(0, 0, -90, h, w), { x: w, y: 0 });
  assert.deepEqual(rectToPad({ left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 }, 90, w, h), { left: 20, top: 280, width: 50, height: 100 });
  // A rect's center maps like a point.
  for (const rot of [0, 90, -90]) {
    const r = { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 };
    const p = rectToPad(r, rot, w, h);
    assert.deepEqual(toPad(60, 45, rot, w, h), { x: p.left + p.width / 2, y: p.top + p.height / 2 });
  }
});

test('edge distance for circles and pills', () => {
  const circle = { x: 0, y: 0, w: 2, h: 2 };
  assert.equal(edgeDistance(3, 0, circle), 2);
  assert.equal(edgeDistance(0, 0, circle), -1);
  const pill = { x: 0, y: 0, w: 6, h: 2 };
  assert.equal(edgeDistance(2, 0, pill), -1); // inside the straight part
  assert.equal(edgeDistance(5, 0, pill), 2); // 2 past the round end
});

test('arrangements never overlap and stay inside their box', () => {
  const sizes = [undefined, 'large', undefined, 'wide', undefined, 'large', undefined, undefined];
  for (const arrangement of ['grid', 'diamond', 'arc']) {
    for (const tall of [false, true]) {
      for (let n = 1; n <= 8; n++) {
        const list = sizes.slice(0, n).map((size, i) => ({ id: `b${i}`, size }));
        const { items, width, height } = arrange(list, arrangement, tall);
        const what = `${arrangement} tall=${tall} n=${n}`;
        assert.equal(items.length, n, what);
        for (const b of items) {
          assert.ok(b.x - b.w / 2 >= -1e-9 && b.x + b.w / 2 <= width + 1e-9, `${what}: ${b.id} inside x`);
          assert.ok(b.y - b.h / 2 >= -1e-9 && b.y + b.h / 2 <= height + 1e-9, `${what}: ${b.id} inside y`);
        }
        for (const a of items) {
          for (const b of items) {
            if (a === b) continue;
            // Closest approach between two capsules, sampled along a's axis.
            let d = Infinity;
            for (let t = -1; t <= 1; t += 0.05) d = Math.min(d, edgeDistance(a.x + (t * (a.w - a.h)) / 2, a.y, b) - a.h / 2);
            assert.ok(d >= GAP * 0.9, `${what}: ${a.id} and ${b.id} overlap (${d.toFixed(3)})`);
          }
        }
      }
    }
  }
});

test('arc: the first button is the biggest, at the bottom-right', () => {
  const { items, width, height } = arrange([{ id: 'punch' }, { id: 'kick' }, { id: 'throw' }, { id: 'ult', size: 'large' }], 'arc');
  const anchor = items[0];
  assert.ok(items.every((b) => b.w <= anchor.w));
  assert.ok(width - (anchor.x + anchor.w / 2) < 0.1); // a large button above it may stick out a bit
  assert.ok(anchor.y + anchor.h / 2 > height - 0.3);
});
