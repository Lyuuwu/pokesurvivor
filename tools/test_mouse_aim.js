/* Run with: node --test tools/test_mouse_aim.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const events = {}, shots = [], effects = [];
  const canvas = { clientWidth: 768, clientHeight: 420,
    getBoundingClientRect: () => ({ left: 40, top: 30, right: 808, bottom: 450, width: 768, height: 420 }) };
  const G = {
    LIFT: 12,
    U: {
      norm: (x, y) => { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; },
      dist: (x, y, a, b) => Math.hypot(x - a, y - b),
      dist2: (x, y, a, b) => (x - a) ** 2 + (y - b) ** 2,
      damp: (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt)),
      rand: (a, b) => (a + b) / 2, TYPE_COLOR: { normal: '#fff' }
    },
    Touch: { active: false, vector: () => null },
    Settings: { get: () => false },
    Coop: { active: false },
    Audio: { sfx() {} },
    Weather: { speedFor: () => 1 },
    World: { collide() {}, isLiquid: () => false, isWall: () => false, nearestBreakable: () => null,
      propsInCircle: () => [], isFree: () => false },
    EnemyMgr: { all: () => [], queryCircle: () => [] },
    Projectiles: {
      nearest: (all, x, y, radius) => all.find(e => Math.hypot(e.x - x, e.y - y) <= radius) || null,
      spawn: p => shots.push(p)
    },
    VFX: { forMove: () => ({}) },
    FX: new Proxy({}, { get: (_, kind) => (...args) => effects.push({ kind, args }) }),
    Sprites: { bodyRadius: () => 8, bodyHeight: () => 24, dirFromAngle: a => a,
      Animator: class { update() {} loop() {} }, hasShiny: () => false }
  };
  const context = vm.createContext({ G, Math, Set, Map, console, performance: { now: () => 0 },
    document: { getElementById: () => canvas },
    addEventListener: (name, fn) => (events[name] ||= []).push(fn) });
  for (const file of ['core/camera', 'core/input', 'entities/player', 'systems/combat']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context);
  }
  G.Camera.resize(768, 420);
  const pl = new G.Player({ dex: 1, hp: 100, spd: 100, atk: 10, types: ['normal'] });
  const move = kind => ({ id: kind, kind, type: 'normal', t: 0, cd: 1, dmg: 10,
    radius: 80, arc: Math.PI / 2, width: 20, count: 1, speed: 100, size: 2, life: 1, lvl: 1 });
  pl.moves = [move('projectile')]; pl.slots = [pl.moves];
  pl.cast = () => { pl.casts = (pl.casts || 0) + 1; };
  const emit = (name, event) => (events[name] || []).forEach(fn => fn(event));
  const mouse = (x, y) => emit('pointermove', { pointerType: 'mouse', clientX: x, clientY: y });
  return { G, pl, move, emit, mouse, shots, effects, canvas };
}

function close(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }

test('screen-to-world exactly inverts camera zoom, shake and pixel rounding', () => {
  const { G } = setup();
  for (const [width, height, dpr] of [[768, 420, 1], [1440, 900, 1.5], [600, 400, 2]]) {
    const cam = G.Camera;
    cam.resize(width, height, dpr);
    cam.x = 123.45; cam.y = -92.34; cam._sx = 2.31; cam._sy = -1.76;
    let tx, ty;
    cam.apply({ translate(x, y) { tx = x; ty = y; } });
    const point = cam.screenToWorld((70 + tx) * cam.scale, (-20 + ty) * cam.scale);
    close(point.x, 70); close(point.y, -20);
  }
});

test('mouse coordinates account for canvas offset and CSS resizing', () => {
  const { G, canvas, mouse } = setup();
  assert.equal(G.Input.mouseWorld(), null);
  canvas.getBoundingClientRect = () => ({ left: 40, top: 30, right: 1576, bottom: 870, width: 1536, height: 840 });
  mouse(808, 450);
  close(G.Input.mouseWorld().x, 0); close(G.Input.mouseWorld().y, 0);
  mouse(10, 10); assert.equal(G.Input.mouseWorld(), null);
});

test('keyboard movement left remains independent from mouse aiming right', () => {
  const { G, pl, emit, mouse, shots } = setup();
  G.EnemyMgr.all = () => [{ x: -30, y: 0, boss: true, dead: false }];
  mouse(724, 240);
  emit('keydown', { code: 'KeyA' });
  pl.update(0.1);
  G.Camera.follow(pl.x, pl.y, 0.1);
  pl.updateAim();
  assert.ok(pl.x < 0); close(pl.moveAngle, Math.PI);
  close(pl.aim, 0); close(pl.anim.dir, 0);
  G.Combat.tick(0.1, pl, 0);
  assert.equal(shots.length, 1);
  assert.ok(shots[0].vx > 0); close(shots[0].vy, 0);
});

test('directional attacks fire without nearby targets and keep cooldowns', () => {
  for (const kind of ['projectile', 'melee', 'beam', 'boomerang', 'dash', 'cone']) {
    const { G, pl, move, mouse } = setup();
    pl.moves = [move(kind)]; pl.slots = [pl.moves];
    mouse(724, 240); pl.updateAim();
    G.Combat.tick(0.1, pl, 0);
    assert.equal(pl.casts, 1, kind);
    G.Combat.tick(0.1, pl, 0.1);
    assert.equal(pl.casts, 1, `${kind} cooldown`);
  }
});

test('aim stays finite over the player or outside the canvas; enemies cannot override it', () => {
  const { G, pl, mouse } = setup();
  mouse(724, 240); pl.updateAim(); close(pl.aim, 0);
  G.EnemyMgr.all = () => [{ x: -20, y: -30, boss: true }];
  mouse(424, 240); pl.updateAim(); close(pl.aim, 0);
  mouse(0, 0); pl.updateAim(); close(pl.aim, 0);
});

test('touch switches back to automatic targeting and its existing fire gate', () => {
  const { G, pl, mouse, emit, shots } = setup();
  G.Touch.active = true;
  mouse(724, 240); pl.updateAim(); assert.equal(pl.mouseAim, true);
  emit('pointerdown', { pointerType: 'touch', clientX: 500, clientY: 300 });
  pl.updateAim(); assert.equal(pl.mouseAim, false);
  G.Combat.tick(0.1, pl, 0); assert.equal(shots.length, 0);
  G.EnemyMgr.all = () => [{ x: -100, y: 0, dead: false }];
  pl.updateAim(); close(pl.aim, Math.PI);
  G.Combat.tick(0.1, pl, 0.1);
  assert.equal(shots.length, 1); assert.ok(shots[0].vx < 0);
});

test('chain and meteor still wait for an automatic target', () => {
  for (const kind of ['chain', 'meteor']) {
    const { G, pl, move, mouse } = setup();
    pl.moves = [move(kind)]; pl.slots = [pl.moves];
    mouse(724, 240); pl.updateAim();
    G.Combat.tick(0.1, pl, 0); assert.equal(pl.casts, undefined, kind);
  }
});

test('remote players face their transmitted mouse aim while moving', () => {
  const { pl } = setup();
  pl.net = { x: 0, y: 0, hp: 100, maxHp: 100, walk: 1, ang: Math.PI,
    aim: 0, mouseAim: true };
  pl.netUpdate(0.1); close(pl.anim.dir, 0);
  pl.net.mouseAim = false;
  pl.netUpdate(0.1); close(pl.anim.dir, Math.PI);
});
