/* Run with: node --test tools/test_localization_and_profile.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { collectKeys, generate, validate } = require('./build_locale');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (ctx, file) => vm.runInContext(read(file), ctx, { filename: file });

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key), key: i => [...data.keys()][i], get length() { return data.size; } };
}

function language(lang = 'en', source = read('js/core/i18n.js')) {
  const ls = storage(); ls.setItem('ps.lang', lang);
  const Canvas = function () {};
  for (const name of ['fillText', 'strokeText', 'measureText']) Canvas.prototype[name] = text => text;
  const ctx = vm.createContext({ G: {}, localStorage: ls, document: { documentElement: {} },
    location: { pathname: '/', reload() {} }, navigator: { language: 'en' },
    CanvasRenderingContext2D: Canvas, confirm: text => text, alert: text => text });
  ctx.window = ctx;
  vm.runInContext(source, ctx);
  load(ctx, 'js/data/lang-en.js');
  return ctx;
}

test('English keeps exact, uppercase, whitespace and nested placeholder behavior', () => {
  const { G } = language('en');
  for (const [source, expected] of [
    ['Volver', 'Back'], ['VOLVER', 'BACK'], ['  Fuego  ', '  Fire  '],
    ['¡Nivel 5!', 'Level 5!'], ['¡Has conseguido a Bulbasaur shiny!', 'You got a shiny Bulbasaur!'],
    ['Jugar como invitado', 'Play as guest'], ['Bulbasaur', 'Bulbasaur']
  ]) assert.equal(G.T(source), expected);
});

test('Traditional Chinese supports exact phrases, placeholders, names and English fallback', () => {
  const ctx = language('zh-TW'), { I18n } = ctx.G;
  assert.equal(ctx.document.documentElement.lang, 'zh-TW');
  I18n.add({ Back: '', 'Level {x}': '' }, 'zh-TW');
  assert.equal(I18n.t('Volver'), 'Back');
  I18n.add({ Back: '返回', Bulbasaur: '妙蛙種子', 'Level {x}': '等級 {x}' }, 'zh-TW');
  assert.equal(I18n.t('Volver'), '返回');
  assert.equal(I18n.t('Nivel 5'), '等級 5');
  assert.equal(I18n.t('BULBASAUR'), '妙蛙種子');
  assert.equal(I18n.t('  Bulbasaur  '), '  妙蛙種子  ');
  assert.equal(I18n.t('Wartortle'), 'Wartortle');
  const canvas = new ctx.CanvasRenderingContext2D();
  assert.equal(canvas.fillText('Volver', 0, 0), '返回');
  assert.equal(ctx.confirm('Volver'), '返回');
  assert.equal(I18n.t(I18n.t('Nivel 5')), '等級 5');
});

test('Spanish ignores the optional translation layer', () => {
  const ctx = language('es');
  ctx.G.I18n.add({ Back: '返回' }, 'zh-TW');
  assert.equal(ctx.G.T('Volver'), 'Volver');
});

test('JSON has English keys and every Pokemon; compilation rejects missing placeholders', () => {
  const dict = JSON.parse(read('locales/zh-TW.json'));
  assert.ok(Object.keys(dict).length > 2000);
  for (const key of collectKeys()) assert.ok(Object.hasOwn(dict, key), key);
  assert.ok(Object.hasOwn(dict, 'Bulbasaur')); assert.ok(Object.hasOwn(dict, 'Terapagos'));
  validate(dict);
  assert.throws(() => validate({ 'Level {x}': '等級' }), /placeholders/);
  assert.throws(() => validate({ Back: null }), /string/);
  const generated = generate({ Back: '返回', Cancel: '' });
  const captured = [];
  vm.runInNewContext(generated, { G: { I18n: { add: (...args) => captured.push(args) } } });
  assert.equal(captured[0][0].Back, '返回');
  assert.equal(Object.hasOwn(captured[0][0], 'Cancel'), false);
  assert.equal(captured[0][1], 'zh-TW');
});

async function profile(ls = storage(), account = 'adam') {
  const ctx = vm.createContext({ G: {}, localStorage: ls, console,
    location: { protocol: 'file:' }, addEventListener() {} });
  ctx.window = ctx;
  for (const file of ['js/data/pokedex.js', 'js/data/sprites-meta.js', 'js/data/upgrades.js',
    'js/data/local-test-profile.js', 'js/core/db.js', 'js/systems/local-test-profile.js']) load(ctx, file);
  ctx.G.Sprites = { hasShiny: dex => !!ctx.G.SPRITE_META[dex]?.sh };
  const restored = await ctx.G.DB.ready();
  if (!restored) assert.equal((await ctx.G.DB.register(account, 'fixture-only')).ok, true);
  return { ctx, G: ctx.G, ls };
}

test('adam gets all Pokemon, available shinies and capped upgrades, with an exact backup', async () => {
  const { G, ls } = await profile();
  const before = JSON.stringify(G.DB.save);
  const result = G.LocalTestProfile.apply();
  assert.equal(result.status, 'applied');
  assert.equal(ls.getItem(result.backupKey), before);
  assert.equal(Object.keys(G.DB.save.owned).length, G.DEX.length);
  assert.equal(Object.keys(G.DB.save.shiny).length, G.DEX.filter(p => G.Sprites.hasShiny(p.dex)).length);
  for (const mon of G.DEX) for (const up of G.Upgrades.LIST) assert.equal(G.DB.save.pupg[mon.dex][up.id], up.max);
  assert.equal(G.DB.save.coins, 999999999);
  assert.equal(G.DB.save.tickets.t1, 99999999); assert.equal(G.DB.save.tickets.t10, 99999999);
  assert.equal(G.DB.save.stats.runs, 0); assert.equal(G.DB.save.stats.bestTime, 0);
  assert.equal(JSON.parse(ls.getItem('ps.save.adam')).coins, 999999999);
  const reload = await profile(ls);
  assert.equal(Object.keys(reload.G.DB.save.owned).length, G.DEX.length);
  reload.G.DB.save.coins -= 100;
  reload.G.DB.commit();
  assert.equal(reload.G.LocalTestProfile.apply().status, 'already');
  assert.equal(reload.G.DB.save.coins, 999999899);
  assert.equal(ls.getItem(result.backupKey), before);
});

test('preset skips other accounts, HTTP, cloud mode and guests', async () => {
  const other = await profile(storage(), 'other');
  const before = JSON.stringify(other.G.DB.save);
  assert.equal(other.G.LocalTestProfile.apply().status, 'skipped');
  assert.equal(JSON.stringify(other.G.DB.save), before);
  const { ctx, G } = await profile();
  ctx.location.protocol = 'http:';
  assert.equal(G.LocalTestProfile.apply().status, 'skipped');
  ctx.location.protocol = 'file:';
  const realDB = G.DB;
  G.DB = Object.assign({}, realDB, { mode: 'cloud' });
  assert.equal(G.LocalTestProfile.apply().status, 'skipped');
  G.DB = realDB;
  G.DB.playAsGuest();
  assert.equal(G.LocalTestProfile.apply().status, 'skipped');
});

test('backup or save failures leave the active save unchanged', async () => {
  for (const failAt of ['ps.backup.', 'ps.save.adam']) {
    const { G, ls } = await profile();
    const before = JSON.stringify(G.DB.save), set = ls.setItem;
    ls.setItem = (key, value) => { if (key.startsWith(failAt)) throw new Error('fixture storage full'); set(key, value); };
    assert.equal(G.LocalTestProfile.apply().status, 'error');
    assert.equal(JSON.stringify(G.DB.save), before);
    assert.equal(ls.getItem('ps.save.adam'), before);
  }
});
