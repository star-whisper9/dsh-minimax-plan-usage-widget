import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_RECT, clampPosition, defaultPosition, hitTestCharacterFrame,
  resizeFromHandle, settlePosition, widgetHeight,
} from '../src/geometry.js';
import { DEFAULT_TEMPLATE, parseTemplate } from '../src/template.js';
import { validateUsage } from '../src/widget.js';

test('template accepts the fixed declarative vocabulary and rejects markup extensions', () => {
  assert.equal(parseTemplate(DEFAULT_TEMPLATE).children.filter(node => node.tag).length, 2);
  assert.throws(() => parseTemplate('<cell onclick="x">bad</cell>'), /Unsupported template tag/);
  assert.throws(() => parseTemplate('<script>bad</script>'), /Unsupported template tag/);
  assert.throws(() => parseTemplate('<row><cell></row></cell>'), /Unmatched closing tag/);
});

test('snap enabled always docks to nearest edge; disabled preserves free position', () => {
  const position = defaultPosition(800, 600);
  assert.deepEqual(position, { x: 484, y: 254, width: 300 });
  assert.deepEqual(settlePosition({ x: -30, y: 20, width: 300 }, 800, 600), { x: 0, y: 20, width: 300 });
  assert.equal(settlePosition({ x: 100, y: 100, width: 300 }, 800, 600).x, 0);
  assert.equal(settlePosition({ x: 400, y: 130, width: 300 }, 800, 600).x, 500);
  assert.equal(settlePosition({ x: 240, y: 80, width: 300 }, 800, 600).y, 0);
  assert.equal(settlePosition({ x: 240, y: 200, width: 300 }, 800, 600).y, 270);
  assert.deepEqual(settlePosition({ x: 100, y: 100, width: 300 }, 800, 600, false), { x: 100, y: 100, width: 300 });
  assert.deepEqual(defaultPosition(800, 600, 300, true), { x: 500, y: 270, width: 300 });
  const small = clampPosition({ x: 500, y: 500, width: 300 }, 250, 220);
  assert.ok(small.x >= 0 && small.y >= 0);
  assert.ok(small.x + small.width <= 250);
  assert.ok(small.y + widgetHeight(small.width) <= 220);
  assert.deepEqual(clampPosition({ x: -100, y: 900, width: 300 }, 800, 600), { x: 0, y: 270, width: 300 });
});

test('failed API response retains valid cached windows for stale display', () => {
  const cached = {
    ok: false, updatedAt: '2026-09-29T01:00:00.000Z', error: '查询超时',
    windows: { fiveHour: { usedPercent: 42, resetAt: null }, weekly: null },
  };
  assert.equal(validateUsage(cached), cached);
  assert.throws(() => validateUsage({ ...cached, windows: { fiveHour: { usedPercent: 150 }, weekly: null } }), /百分比无效/);
});

test('character frame border and endpoints choose the nearest resize edge', () => {
  assert.equal(hitTestCharacterFrame(CHARACTER_RECT.x, 230), 'w');
  assert.equal(hitTestCharacterFrame(CHARACTER_RECT.x + CHARACTER_RECT.width, CHARACTER_RECT.y), 'ne');
  assert.equal(hitTestCharacterFrame(200, 200), null);
  assert.equal(hitTestCharacterFrame(40, 40), null);
});

test('each resize handle fixes the opposite character edge or corner', () => {
  const start = { x: 200, y: 150, width: 300 };
  const rect = CHARACTER_RECT;
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const resized = resizeFromHandle(start, handle, 45, 30, 800, 650);
    const anchorX = handle.includes('w') ? rect.x + rect.width : handle.includes('e') ? rect.x : rect.x + rect.width / 2;
    const anchorY = handle.includes('n') ? rect.y + rect.height : handle.includes('s') ? rect.y : rect.y + rect.height / 2;
    const scale = resized.width / 300;
    assert.ok(resized.width > 0, handle);
    assert.ok(resized.x >= 0 && resized.y >= 0, handle);
    assert.ok(resized.x + resized.width <= 800, handle);
    assert.ok(resized.y + widgetHeight(resized.width) <= 650, handle);
    assert.ok(Math.abs(resized.x + scale * anchorX - (start.x + anchorX)) < 0.01, handle);
    assert.ok(Math.abs(resized.y + scale * anchorY - (start.y + anchorY)) < 0.01, handle);
    if (handle === 'e') {
      assert.ok(Math.abs(resized.x + scale * (rect.x + rect.width) - (start.x + rect.x + rect.width + 45)) < 0.01);
    }
  }
});

test('character-anchored resize stops before the whole widget crosses the viewport', () => {
  const start = defaultPosition(800, 600);
  const resized = resizeFromHandle(start, 'e', 300, 0, 800, 600);
  assert.ok(resized.x >= 0 && resized.x + resized.width <= 800);
  assert.ok(resized.y >= 0 && resized.y + widgetHeight(resized.width) <= 600);
  const anchor = CHARACTER_RECT.x;
  assert.ok(Math.abs(resized.x + resized.width / 300 * anchor - (start.x + anchor)) < 0.01);
});

test('five free-direction handles at each docked corner grow and shrink with pinned outer edges', () => {
  for (const [right, bottom, handles] of [
    [true, true, ['nw', 'n', 'ne', 'w', 'sw']],
    [false, true, ['nw', 'n', 'ne', 'e', 'se']],
    [true, false, ['nw', 'w', 'sw', 's', 'se']],
    [false, false, ['ne', 'e', 'sw', 's', 'se']],
  ]) {
    const start = { x: right ? 500 : 0, y: bottom ? 270 : 0, width: 300 };
    for (const handle of handles) {
      for (const distance of [40, -40, 5000]) {
        const next = resizeFromHandle(start, handle, right ? -distance : distance, bottom ? -distance : distance, 800, 600);
        assert.ok(Number.isFinite(next.width));
        assert.ok(distance > 0 ? next.width > start.width : next.width < start.width, handle);
        assert.ok(Math.abs((right ? next.x + next.width : next.x) - (right ? 800 : 0)) < 1e-8, handle);
        assert.ok(Math.abs((bottom ? next.y + widgetHeight(next.width) : next.y) - (bottom ? 600 : 0)) < 1e-8, handle);
        assert.ok(next.x >= -1e-8 && next.y >= -1e-8);
        assert.ok(next.x + next.width <= 800 + 1e-8 && next.y + widgetHeight(next.width) <= 600 + 1e-8);
      }
    }
  }
});

test('single-edge docking permits proportional growth without pushing that edge outside', () => {
  for (const [start, handle, dx, dy, axis, edge] of [
    [{ x: 500, y: 130, width: 300 }, 'n', 0, -30, 'x', 800],
    [{ x: 0, y: 130, width: 300 }, 's', 0, 30, 'x', 0],
    [{ x: 200, y: 0, width: 300 }, 'w', -30, 0, 'y', 0],
    [{ x: 200, y: 270, width: 300 }, 'e', 30, 0, 'y', 600],
  ]) {
    const next = resizeFromHandle(start, handle, dx, dy, 800, 600);
    assert.ok(next.width > start.width, handle);
    const extent = axis === 'x' ? next.width : widgetHeight(next.width);
    assert.ok(Math.abs(next[axis] + (edge ? extent : 0) - edge) < 1e-8, handle);
  }
});

test('docked top and left resize edges follow the pointer without scaling the outer margins twice', () => {
  const start = defaultPosition(800, 600, 300, true);
  const top = resizeFromHandle(start, 'n', 0, -40, 800, 600);
  const left = resizeFromHandle(start, 'w', -40, 0, 800, 600);
  assert.ok(Math.abs(top.y + top.width / 300 * CHARACTER_RECT.y - (start.y + CHARACTER_RECT.y - 40)) < 1e-8);
  assert.ok(Math.abs(left.x + left.width / 300 * CHARACTER_RECT.x - (start.x + CHARACTER_RECT.x - 40)) < 1e-8);
});
