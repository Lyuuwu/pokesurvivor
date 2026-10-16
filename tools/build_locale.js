/* Compile the editable English -> Traditional Chinese JSON for file:// use.
 *   node tools/build_locale.js             compile the current translation
 *   node tools/build_locale.js --sync      add newly available keys, preserve translations
 *   node tools/build_locale.js --check     verify JSON and generated JS without writing
 */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'locales/zh-TW.json');
const OUTPUT = path.join(ROOT, 'js/data/lang-zh-TW.js');

function collectKeys() {
  const keys = new Set();
  const context = vm.createContext({ G: { I18n: { add(dict) {
    for (const value of Object.values(dict)) if (typeof value === 'string' && value) keys.add(value);
  } } } });
  for (const file of ['js/data/lang-en.js', 'js/data/pokedex.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  for (const mon of context.G.DEX) keys.add(mon.name);
  return [...keys].sort((a, b) => a.localeCompare(b, 'en'));
}

function validate(dict) {
  if (!dict || Array.isArray(dict) || typeof dict !== 'object') throw new Error('zh-TW.json must be an object');
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== 'string') throw new Error(`Translation must be a string: ${key}`);
    if (value && (key.match(/\{x\}/g) || []).length !== (value.match(/\{x\}/g) || []).length) {
      throw new Error(`Keep the same number of {x} placeholders: ${key}`);
    }
  }
}

function generate(dict) {
  validate(dict);
  const filled = Object.fromEntries(Object.entries(dict).filter(([, value]) => value.trim()));
  return '/* Generated from locales/zh-TW.json by tools/build_locale.js. Edit the JSON. */\n'
    + 'G.I18n.add(' + JSON.stringify(filled, null, 2) + ', "zh-TW");\n';
}

function main(args) {
  let dict = fs.existsSync(SOURCE) ? JSON.parse(fs.readFileSync(SOURCE, 'utf8')) : {};
  validate(dict);
  if (args.includes('--sync')) {
    const combined = Object.assign(Object.fromEntries(collectKeys().map(key => [key, ''])), dict);
    dict = Object.fromEntries(Object.keys(combined).sort((a, b) => a.localeCompare(b, 'en')).map(key => [key, combined[key]]));
    fs.mkdirSync(path.dirname(SOURCE), { recursive: true });
    fs.writeFileSync(SOURCE, JSON.stringify(dict, null, 2) + '\n');
  } else if (!fs.existsSync(SOURCE)) throw new Error('Missing locales/zh-TW.json; run with --sync first');
  const js = generate(dict);
  if (args.includes('--check')) {
    if (!fs.existsSync(OUTPUT) || fs.readFileSync(OUTPUT, 'utf8') !== js) throw new Error('Run node tools/build_locale.js to update the generated dictionary');
  } else fs.writeFileSync(OUTPUT, js);
  console.log(`zh-TW: ${Object.values(dict).filter(v => v.trim()).length}/${Object.keys(dict).length} translated`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { collectKeys, validate, generate };
