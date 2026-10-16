"""Accounts, sessions and saves, kept as plain JSON files under server/data/.

Everything a host needs to move the server to another computer is inside
DATA: copy the folder and every account and save comes along.

    data/config.json        invite code, port, optional DuckDNS
    data/users.json         { lower name: { id, name, salt, hash, created, last } }
    data/sessions.json      { sha256(token): { id, exp } }
    data/saves/<id>.json    { rev, at, save }   (save = the game's own save JSON)
    data/saves/<id>.prev.json   the previous version, for manual recovery
    data/backups/YYYY-MM-DD/    copy of saves/ on the first write of each day
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import time
from datetime import date, timedelta
from pathlib import Path

DATA = Path(os.environ.get('POKESURVIVOR_DATA') or Path(__file__).resolve().parent / 'data')   # override for tests
SAVES = DATA / 'saves'
BACKUPS = DATA / 'backups'

# Same rule as VALID in js/core/db.js.
NAME_RE = re.compile(r'^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$')
PASS_MIN, PASS_MAX = 6, 64
SESSION_DAYS = 30
BACKUP_DAYS = 14
MAX_SAVE_BYTES = 2 * 1024 * 1024
INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # no I, O, 0, 1

DEFAULT_CONFIG = {'invite': '', 'port': 28080, 'duckdns': {'domain': '', 'token': ''}}


# ---------------- files ----------------

def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, value):
    """Write to a temp file and swap it in: a crash never leaves half a file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, separators=(',', ':'))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ---------------- config ----------------

def new_invite():
    return ''.join(secrets.choice(INVITE_ALPHABET) for _ in range(8))


def load_config():
    cfg = read_json(DATA / 'config.json', None)
    if cfg is None:
        return None
    merged = dict(DEFAULT_CONFIG)
    merged.update(cfg)
    return merged


def init_data():
    """Create data/ with a random invite code. Returns (config, created)."""
    for d in (DATA, SAVES, BACKUPS):
        d.mkdir(parents=True, exist_ok=True)
    cfg = load_config()
    if cfg is not None and cfg.get('invite'):
        return cfg, False
    cfg = dict(DEFAULT_CONFIG, invite=new_invite())
    write_json(DATA / 'config.json', cfg)
    return cfg, True


def save_config(cfg):
    write_json(DATA / 'config.json', cfg)


# ---------------- passwords ----------------

def hash_pass(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32).hex()


def check_pass(user, password):
    return hmac.compare_digest(user['hash'], hash_pass(password, user['salt']))


# ---------------- users ----------------

def _mtime(path):
    try:
        return path.stat().st_mtime_ns
    except FileNotFoundError:
        return 0


class Store:
    def __init__(self):
        self.users, self.sessions, self.by_id = {}, {}, {}
        self._seen = (None, None)
        self.fresh()
        self._drop_expired()

    def fresh(self):
        """Reload the files if something else changed them (the CLI while the server runs)."""
        seen = (_mtime(DATA / 'users.json'), _mtime(DATA / 'sessions.json'))
        if seen == self._seen:
            return
        self.users = read_json(DATA / 'users.json', {})
        self.sessions = read_json(DATA / 'sessions.json', {})
        self.by_id = {u['id']: k for k, u in self.users.items()}
        self._seen = seen

    def _remember(self):
        self._seen = (_mtime(DATA / 'users.json'), _mtime(DATA / 'sessions.json'))

    def _save_users(self):
        write_json(DATA / 'users.json', self.users)
        self._remember()

    def _save_sessions(self):
        write_json(DATA / 'sessions.json', self.sessions)
        self._remember()

    def user_by_name(self, name):
        return self.users.get((name or '').lower())

    def user_by_id(self, uid):
        k = self.by_id.get(uid)
        return self.users.get(k) if k else None

    def create_user(self, name, password):
        """-> (user, error code)"""
        if not NAME_RE.match(name or ''):
            return None, 'bad-name'
        if not (PASS_MIN <= len(password or '') <= PASS_MAX):
            return None, 'weak-pass'
        k = name.lower()
        if k in self.users:
            return None, 'name-taken'
        uid = 'u' + secrets.token_hex(6)
        while uid in self.by_id:
            uid = 'u' + secrets.token_hex(6)
        salt = secrets.token_hex(16)
        user = {'id': uid, 'name': name, 'salt': salt, 'hash': hash_pass(password, salt),
                'created': int(time.time() * 1000), 'last': 0}
        self.users[k] = user
        self.by_id[uid] = k
        self._save_users()
        return user, None

    def set_password(self, user, password):
        user['salt'] = secrets.token_hex(16)
        user['hash'] = hash_pass(password, user['salt'])
        self._save_users()
        # A new password logs out every device.
        self.drop_sessions(user['id'])

    def delete_user(self, user):
        """Remove the account; its save moves to backups/ (recoverable by hand)."""
        uid = user['id']
        src = SAVES / (uid + '.json')
        if src.exists():
            BACKUPS.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(BACKUPS / f'deleted-{user["name"]}-{uid}-{int(time.time())}.json'))
        prev = SAVES / (uid + '.prev.json')
        if prev.exists():
            prev.unlink()
        self.users.pop(user['name'].lower(), None)
        self.by_id.pop(uid, None)
        self._save_users()
        self.drop_sessions(uid)

    def touch(self, user):
        """Remember the last time each account was seen (at most once an hour)."""
        now = int(time.time() * 1000)
        if now - (user.get('last') or 0) > 3600 * 1000:
            user['last'] = now
            self._save_users()

    # ---------------- sessions ----------------

    @staticmethod
    def _tkey(token):
        return hashlib.sha256(token.encode('utf-8')).hexdigest()

    def new_session(self, user):
        token = secrets.token_urlsafe(32)
        self.sessions[self._tkey(token)] = {'id': user['id'], 'exp': time.time() + SESSION_DAYS * 86400}
        self._save_sessions()
        return token

    def session_user(self, token):
        if not token:
            return None
        s = self.sessions.get(self._tkey(token))
        if not s:
            return None
        now = time.time()
        if s['exp'] < now:
            self.sessions.pop(self._tkey(token), None)
            self._save_sessions()
            return None
        # Sliding expiry; written at most once a day per session.
        if s['exp'] - now < (SESSION_DAYS - 1) * 86400:
            s['exp'] = now + SESSION_DAYS * 86400
            self._save_sessions()
        return self.user_by_id(s['id'])

    def end_session(self, token):
        if self.sessions.pop(self._tkey(token or ''), None):
            self._save_sessions()

    def drop_sessions(self, uid):
        before = len(self.sessions)
        self.sessions = {k: s for k, s in self.sessions.items() if s['id'] != uid}
        if len(self.sessions) != before:
            self._save_sessions()

    def _drop_expired(self):
        now = time.time()
        live = {k: s for k, s in self.sessions.items() if s['exp'] >= now and s['id'] in self.by_id}
        if len(live) != len(self.sessions):
            self.sessions = live
            self._save_sessions()

    # ---------------- saves ----------------

    @staticmethod
    def read_save(uid):
        return read_json(SAVES / (uid + '.json'), {'rev': 0, 'at': 0, 'save': None})

    @staticmethod
    def write_save(uid, save, rev):
        daily_backup()
        path = SAVES / (uid + '.json')
        if path.exists():
            shutil.copyfile(path, SAVES / (uid + '.prev.json'))
        doc = {'rev': rev, 'at': int(time.time() * 1000), 'save': save}
        write_json(path, doc)
        return doc


def valid_save(save):
    """The server does not understand the save; it only checks its shape."""
    return (isinstance(save, dict) and isinstance(save.get('v'), int)
            and isinstance(save.get('owned', {}), dict) and isinstance(save.get('coins', 0), (int, float)))


def daily_backup():
    """On the first write of each day, copy saves/ to backups/YYYY-MM-DD/; keep BACKUP_DAYS days."""
    today = BACKUPS / date.today().isoformat()
    if today.exists() or not SAVES.exists():
        return
    shutil.copytree(SAVES, today, ignore=shutil.ignore_patterns('*.tmp', '*.prev.json'))
    limit = (date.today() - timedelta(days=BACKUP_DAYS)).isoformat()
    for d in BACKUPS.iterdir():
        if d.is_dir() and re.match(r'^\d{4}-\d{2}-\d{2}$', d.name) and d.name < limit:
            shutil.rmtree(d, ignore_errors=True)
