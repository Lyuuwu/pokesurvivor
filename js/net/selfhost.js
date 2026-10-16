/* ============ selfhost.js — servidor propio (python -m server) ============
 * Si el juego se abre desde el servidor propio (carpeta server/, ver
 * docs/local_server_plan.md), las cuentas y las partidas se guardan en ese
 * ordenador en vez de en Firebase. db.js lo detecta al arrancar (detect()).
 *
 * API:  detect() -> true si hay servidor propio · register(name, pass, invite)
 *       login(name, pass) · logout() · getSave() -> { rev, save }
 *       putSave(baseRev, save, { keepalive }) -> { rev } · deleteAccount(pass)
 *       me -> { id, name } | null (sesión guardada en este navegador)
 * Los errores se lanzan como { code, status }: code 'net' = sin conexión,
 * 'conflict' (409, trae rev y save), 'auth' (sesión caducada), etc.
 */
G.SelfHost = (() => {
  const K_TOKEN = 'ps.srv.token', K_ME = 'ps.srv.me';
  // En la web oficial nunca se busca servidor propio.
  const OFFICIAL = ['pokesurvivor.com', 'www.pokesurvivor.com', 'jpter78.github.io'];
  const KEEPALIVE_MAX = 60000;     // los navegadores no dejan más de 64 KB con keepalive
  let token = null, me = null, found = false;
  try {
    token = localStorage.getItem(K_TOKEN);
    me = JSON.parse(localStorage.getItem(K_ME) || 'null');
  } catch (e) { /* sin almacenamiento */ }

  function remember(r) {
    token = r.token; me = { id: r.id, name: r.name };
    try { localStorage.setItem(K_TOKEN, token); localStorage.setItem(K_ME, JSON.stringify(me)); } catch (e) { /* nada */ }
    return me;
  }
  function forget() {
    token = me = null;
    try { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_ME); } catch (e) { /* nada */ }
  }

  async function call(method, path, body, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 12000);
    const text = body ? JSON.stringify(body) : undefined;
    let res, data = null;
    try {
      const headers = {};
      if (text) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = 'Bearer ' + token;
      res = await fetch('/api/' + path, {
        method, headers, body: text, cache: 'no-store', signal: ctl.signal,
        keepalive: !!opts.keepalive && (text || '').length < KEEPALIVE_MAX
      });
      try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    } catch (e) {
      throw { code: 'net', status: 0 };
    } finally { clearTimeout(timer); }
    if (!res.ok) throw Object.assign({}, data || {}, { code: (data && data.error) || 'http', status: res.status });
    return data || {};
  }

  async function detect() {
    if (!/^https?:$/.test(location.protocol) || OFFICIAL.includes(location.hostname)) return false;
    try { found = (await call('GET', 'hello', null, { timeout: 2500 })).server === 'pokesurvivor-self'; }
    catch (e) { found = false; }
    return found;
  }

  return {
    detect,
    async register(name, pass, invite) { return remember(await call('POST', 'register', { name, pass, invite })); },
    async login(name, pass) { return remember(await call('POST', 'login', { name, pass })); },
    async logout() { try { await call('POST', 'logout', {}, { timeout: 4000 }); } catch (e) { /* da igual */ } forget(); },
    getSave() { return call('GET', 'save'); },
    putSave(baseRev, save, opts = {}) { return call('PUT', 'save', { baseRev, save }, opts); },
    async deleteAccount(pass) { await call('POST', 'delete', { pass }); forget(); },
    forget,
    get me() { return token ? me : null; },
    get found() { return found; }
  };
})();
