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
 *
 * Salas (rooms): un WebSocket con el servidor (server/rooms.py) para crear o
 * entrar en una sala con su código y pasar los mensajes de la partida.
 *   rooms.create(info) / rooms.join(code, info) -> estado de la sala
 *   rooms.leave() · rooms.member(info) · rooms.ready(v) · rooms.open(v) · rooms.send(to, msg)
 *   rooms.on('room', fn(estado | null, por qué)) · rooms.on('msg', fn(from, msg))
 *   (por qué, al cerrarse: 'host' la cerró el anfitrión, 'net' se cortó la conexión,
 *   'replaced' tu cuenta entró en otra pestaña o aparato)
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
    closeWs();
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

  // ---------------- salas (WebSocket) ----------------

  let ws = null, wsReady = null, waiting = null;
  const on = { room: new Set(), msg: new Set() };
  const emit = (what, ...args) => on[what].forEach(fn => { try { fn(...args); } catch (e) { console.error('[SelfHost]', e); } });

  /** Abre (o reutiliza) la conexión y se identifica con el token de la sesión. */
  function connect() {
    if (wsReady) return wsReady;
    wsReady = new Promise((resolve, reject) => {
      if (!token) { reject({ code: 'auth' }); return; }
      const s = ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      const late = setTimeout(() => { reject({ code: 'net' }); s.close(); }, 8000);
      s.onopen = () => s.send(JSON.stringify({ t: 'auth', token }));
      s.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'msg') emit('msg', m.f, m.d);
        else if (m.t === 'room') { settle(null, m); emit('room', m); }
        else if (m.t === 'closed') emit('room', null, 'host');
        else if (m.t === 'replaced') s.replaced = true;
        else if (m.t === 'hello') { clearTimeout(late); resolve(); }
        else if (m.t === 'error') { if (m.req === 'auth') reject({ code: 'auth' }); else settle(m); }
        // 'replaced': la misma cuenta se ha conectado en otra pestaña o aparato; el servidor cierra esta.
      };
      s.onclose = e => {
        clearTimeout(late);
        const lost = ws === s;          // si no, la cerramos nosotros (salir, cerrar sesión)
        if (lost) { ws = null; wsReady = null; console.warn('[SelfHost] conexión cortada, code', e.code, e.reason || ''); }
        reject({ code: 'net' });
        settle({ code: 'net' });
        emit('room', null, s.replaced ? 'replaced' : lost ? 'net' : 'host');
      };
    });
    wsReady.catch(() => { wsReady = null; });
    return wsReady;
  }

  function closeWs() {
    const s = ws;
    ws = null; wsReady = null;
    if (s) s.close();
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  /** Crear o entrar: espera el estado de la sala (o el error). */
  async function request(obj) {
    await connect();
    return new Promise((resolve, reject) => {
      if (waiting) waiting.reject({ code: 'busy' });
      const w = waiting = { resolve, reject };
      wsSend(obj);
      setTimeout(() => { if (waiting === w) settle({ code: 'net' }); }, 8000);
    });
  }
  function settle(err, room) {
    const w = waiting;
    if (!w) return;
    waiting = null;
    if (err) w.reject(err); else w.resolve(room);
  }

  const rooms = {
    create(info) { return request(Object.assign({ t: 'create' }, info)); },
    join(code, info) { return request(Object.assign({ t: 'join', code }, info)); },
    leave() { wsSend({ t: 'leave' }); },
    member(info) { wsSend(Object.assign({ t: 'member' }, info)); },
    ready(v) { wsSend({ t: 'ready', v: !!v }); },
    open(v) { wsSend({ t: 'open', v: !!v }); },
    send(to, d) { return wsSend({ t: 'send', to, d }); },
    on(what, fn) { on[what].add(fn); },
    close: closeWs
  };

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
    forget, rooms,
    get me() { return token ? me : null; },
    get found() { return found; }
  };
})();
