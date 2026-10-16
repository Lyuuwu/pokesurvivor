"""HTTP server: the game's static files plus the account and save API.

Only the files the game needs are served (WHITELIST); server/, tools/, docs/,
.git and the rest of the project are never reachable from the network.
"""
import json
import logging
import time
from collections import defaultdict, deque
from pathlib import Path

from aiohttp import web

from . import rooms
from . import store as st

ROOT = Path(__file__).resolve().parent.parent

FILES = {'index.html', '404.html', 'favicon.ico', 'manifest.webmanifest', 'sw.js', 'version.json', 'robots.txt'}
DIRS = {'css', 'js', 'assets', 'en', 'guia', 'pokedex', 'legendarios', 'logros', 'movimientos',
        'novedades', 'objetos', 'shinies', 'tipos', 'apoyar', 'contacto'}
# Windows can map .js to text/plain in its registry: set the common types here.
TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
         '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gif': 'image/gif',
         '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
         '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
         '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain', '.xml': 'application/xml'}
TEXT = {'.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt', '.xml'}

# Failed logins / registrations per IP: FAIL_MAX in FAIL_WINDOW seconds locks it for FAIL_WINDOW.
FAIL_MAX, FAIL_WINDOW = 10, 600

log = logging.getLogger('pokesurvivor')


def make_app(dev=False):
    db = st.Store()
    fails = defaultdict(deque)
    allowed_files = FILES | ({'dev.html'} if dev else set())
    allowed_dirs = DIRS | ({'locales'} if dev else set())

    # ---------------- helpers ----------------

    def ip_of(req):
        return req.remote or '?'

    def locked(req):
        q = fails[ip_of(req)]
        now = time.time()
        while q and q[0] < now - FAIL_WINDOW:
            q.popleft()
        return len(q) >= FAIL_MAX

    def failed(req):
        fails[ip_of(req)].append(time.time())

    def err(code, status=400, **extra):
        return web.json_response(dict(error=code, **extra), status=status)

    async def body(req):
        try:
            data = await req.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def token_of(req):
        h = req.headers.get('Authorization', '')
        return h[7:].strip() if h.startswith('Bearer ') else ''

    def auth(req):
        db.fresh()
        user = db.session_user(token_of(req))
        if user:
            db.touch(user)
        return user

    def me(user, token=None):
        out = {'id': user['id'], 'name': user['name']}
        if token:
            out['token'] = token
        return out

    # ---------------- API ----------------

    async def hello(req):
        return web.json_response({'server': 'pokesurvivor-self', 'v': 1})

    async def register(req):
        if locked(req):
            return err('too-many', 429)
        data = await body(req)
        if data is None:
            return err('bad-request')
        cfg = st.load_config() or {}
        invite = str(data.get('invite') or '').strip().upper()
        if not cfg.get('invite') or invite != cfg['invite'].upper():
            failed(req)
            return err('bad-invite', 403)
        db.fresh()
        user, code = db.create_user(str(data.get('name') or '').strip(), str(data.get('pass') or ''))
        if code:
            return err(code, 409 if code == 'name-taken' else 400)
        log.info('新帳號：%s（%s）', user['name'], ip_of(req))
        return web.json_response(me(user, db.new_session(user)))

    async def login(req):
        if locked(req):
            return err('too-many', 429)
        data = await body(req)
        if data is None:
            return err('bad-request')
        db.fresh()
        user = db.user_by_name(str(data.get('name') or '').strip())
        if not user or not st.check_pass(user, str(data.get('pass') or '')):
            failed(req)
            return err('bad-login', 401)
        db.touch(user)
        return web.json_response(me(user, db.new_session(user)))

    async def logout(req):
        db.fresh()
        db.end_session(token_of(req))
        return web.json_response({})

    async def whoami(req):
        user = auth(req)
        return web.json_response(me(user)) if user else err('auth', 401)

    async def get_save(req):
        user = auth(req)
        if not user:
            return err('auth', 401)
        doc = db.read_save(user['id'])
        return web.json_response({'rev': doc['rev'], 'save': doc['save']})

    async def put_save(req):
        user = auth(req)
        if not user:
            return err('auth', 401)
        data = await body(req)
        if data is None or not st.valid_save(data.get('save')):
            return err('bad-save')
        doc = db.read_save(user['id'])
        if data.get('baseRev') != doc['rev']:
            # Someone else (another tab or device) saved first: the client merges and retries.
            return web.json_response({'error': 'conflict', 'rev': doc['rev'], 'save': doc['save']}, status=409)
        save = data['save']
        save['name'] = user['name']
        doc = db.write_save(user['id'], save, doc['rev'] + 1)
        return web.json_response({'rev': doc['rev']})

    async def delete_account(req):
        user = auth(req)
        if not user:
            return err('auth', 401)
        if locked(req):
            return err('too-many', 429)
        data = await body(req) or {}
        if not st.check_pass(user, str(data.get('pass') or '')):
            failed(req)
            return err('bad-login', 401)
        db.delete_user(user)
        log.info('帳號已刪除：%s', user['name'])
        return web.json_response({})

    # ---------------- static files ----------------

    async def static(req):
        rel = req.match_info.get('path', '')
        parts = [p for p in rel.split('/') if p]
        if any(p.startswith('.') or '\\' in p or ':' in p for p in parts):
            raise web.HTTPNotFound()
        if not parts:
            parts = ['index.html']
        elif rel.endswith('/') or (len(parts) == 1 and parts[0] in allowed_dirs):
            if not rel.endswith('/'):
                raise web.HTTPFound('/' + rel + '/')
            parts.append('index.html')
        top = parts[0]
        if not ((len(parts) == 1 and top in allowed_files) or (len(parts) > 1 and top in allowed_dirs)):
            raise web.HTTPNotFound()
        path = ROOT.joinpath(*parts).resolve()
        if ROOT not in path.parents or not path.is_file():
            raise web.HTTPNotFound()
        ext = path.suffix.lower()
        ctype = TYPES.get(ext, 'application/octet-stream')
        if ext in TEXT:
            ctype += '; charset=utf-8'
        headers = {'Content-Type': ctype, 'X-Content-Type-Options': 'nosniff'}
        if path.name in ('version.json', 'sw.js') or ext == '.html':
            headers['Cache-Control'] = 'no-store' if path.name == 'version.json' else 'no-cache'
        return web.FileResponse(path, headers=headers)

    # ---------------- log ----------------

    @web.middleware
    async def access_log(req, handler):
        try:
            res = await handler(req)
        except web.HTTPException as e:
            if e.status >= 400 and req.path.startswith('/api/'):
                log.info('%s %s %s → %s', ip_of(req), req.method, req.path, e.status)
            raise
        if req.path.startswith('/api/') and req.path != '/api/hello' and (res.status >= 400 or req.method != 'GET'):
            log.info('%s %s %s → %s', ip_of(req), req.method, req.path, res.status)
        return res

    app = web.Application(client_max_size=st.MAX_SAVE_BYTES + 64 * 1024, middlewares=[access_log])
    app.router.add_get('/api/hello', hello)
    app.router.add_post('/api/register', register)
    app.router.add_post('/api/login', login)
    app.router.add_post('/api/logout', logout)
    app.router.add_get('/api/me', whoami)
    app.router.add_get('/api/save', get_save)
    app.router.add_put('/api/save', put_save)
    app.router.add_post('/api/delete', delete_account)
    async def api_missing(req):
        return err('not-found', 404)

    app.router.add_route('*', '/api/{rest:.*}', api_missing)
    rooms.setup(app, db)
    app.router.add_get('/{path:.*}', static)
    return app
