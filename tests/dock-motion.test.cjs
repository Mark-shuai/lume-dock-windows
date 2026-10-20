const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('Dock motion settles, refreshes changed geometry and pauses while hidden', () => {
  const frames = new Map(), events = {};
  let nextFrame = 0, time = 0, styleReads = 0, resize;
  const style = () => ({ setProperty(key, value) { this[key] = value; } });
  const classes = () => ({ contains: () => false, toggle() {} });
  const cells = [0, 1, 2].map(i => ({ offsetLeft: i * 64, offsetWidth: 64, offsetHeight: 64,
    style: style(), classList: classes() }));
  const dock = { style: style(), clientWidth: 800 };
  const row = { closest: () => dock, clientWidth: 300, scrollLeft: 0, scrollWidth: 300,
    querySelectorAll: () => cells, classList: classes(), getBoundingClientRect: () => ({ left: 0 }),
    addEventListener(name, fn) { events[name] = fn; } };
  const document = { hidden: false, body: { classList: classes() }, getElementById: () => null,
    addEventListener(name, fn) { events[name] = fn; } };
  const context = { window: {}, document, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => { styleReads++; return { columnGap: '0', getPropertyValue: () => '64' }; },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/dock-motion.js'), 'utf8'), context);
  const motion = context.window.createDockMotion(row);
  function flush() {
    for (let count = 0; frames.size; count++) {
      assert.ok(count < 100, 'motion stops requesting frames after settling');
      const pending = [...frames.values()]; frames.clear(); time += 1000 / 60;
      pending.forEach(fn => fn(time));
    }
  }
  const move = x => events.pointermove({ clientX: x, pointerType: 'mouse' });
  motion.refresh(); flush();
  const before = styleReads;
  move(32); flush();
  assert.ok(Number(cells[0].style['--dock-scale']) > 1.6, 'hover magnifies the nearest icon');
  assert.equal(styleReads, before, 'settling animation reuses measured geometry');
  move(32);
  assert.equal(frames.size, 0, 'an unchanged pointer does not restart animation');
  move(96);
  motion.setVisible(false);
  assert.equal(frames.size, 0, 'hiding cancels pending animation');
  assert.ok(cells.every(cell => cell.style['--dock-scale'] === '1'));
  cells[0].offsetLeft = 400;
  move(32); resize();
  assert.equal(frames.size, 0, 'hidden pointer and resize events do not animate');
  motion.setVisible(true); flush();
  assert.ok(Number(cells[0].style['--dock-scale']) < 1.01, 'reveal uses the changed layout');
  move(432); flush();
  assert.ok(Number(cells[0].style['--dock-scale']) > 1.6);
  document.hidden = true; events.visibilitychange();
  move(32); assert.equal(frames.size, 0);
  document.hidden = false; events.visibilitychange(); flush();
  assert.ok(Number(cells[0].style['--dock-scale']) < 1.01, 'document visibility also refreshes layout');
});
