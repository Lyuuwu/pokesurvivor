"""Group play: rooms by 4-letter code and a WebSocket relay (/ws).

Replaces Firebase rooms + WebRTC. The game keeps its star topology: the room
host's browser runs the enemies; guests only talk to the host. The server just
keeps who is in which room and forwards messages:

  client -> server   { t:'auth', token }            first message
                     { t:'create', dex, shiny }     new room (leaves any other)
                     { t:'join', code, dex, shiny }
                     { t:'leave' } · { t:'member', dex, shiny } · { t:'open', v } (host)
                     { t:'send', to, d }            guests may only send to the host
  server -> client   { t:'hello', id, name }
                     { t:'room', code, host, open, members:[{uid,name,dex,shiny,at}] }
                     { t:'msg', f, d }              f is filled in by the server
                     { t:'closed' } · { t:'error', code, req } · { t:'replaced' }
"""
import asyncio
import json
import logging
import secrets
import time

from aiohttp import WSCloseCode, WSMsgType, web

ROOM_MAX = 4
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'    # no I, O
TRAFFIC_EVERY = 60                            # seconds between traffic lines in the log

log = logging.getLogger('pokesurvivor')


def setup(app, db):
    clients = {}    # uid -> ws (one connection per account)
    rooms = {}      # code -> room dict
    where = {}      # uid -> code

    def dumps(obj):
        return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))

    async def send(ws, obj):
        if ws is None or ws.closed:
            return
        try:
            await ws.send_str(obj if isinstance(obj, str) else dumps(obj))
        except (ConnectionError, RuntimeError):
            pass

    def new_code():
        while True:
            code = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(4))
            if code not in rooms:
                return code

    def state(r):
        ms = sorted(r['members'].values(), key=lambda m: (m['uid'] != r['host'], m['at']))
        return {'t': 'room', 'code': r['code'], 'host': r['host'], 'open': r['open'], 'members': ms}

    async def announce(r):
        msg = dumps(state(r))
        for uid in list(r['members']):
            await send(clients.get(uid), msg)

    def member(user, data):
        dex = data.get('dex')
        return {'uid': user['id'], 'name': user['name'], 'dex': dex if isinstance(dex, int) else None,
                'shiny': bool(data.get('shiny')), 'at': int(time.time() * 1000)}

    def traffic(r, final=False):
        secs = max(1.0, time.time() - r['window'])
        log.info('房間 %s：%d 人，%s %d 秒平均 %.1f KB/s', r['code'], len(r['members']),
                 '最後' if final else '近', secs, r['bytes'] / 1024 / secs)
        r['bytes'], r['window'] = 0, time.time()

    async def leave(uid):
        r = rooms.get(where.pop(uid, None))
        if not r:
            return
        r['members'].pop(uid, None)
        if uid == r['host'] or not r['members']:
            rooms.pop(r['code'], None)
            if r['bytes']:
                traffic(r, final=True)
            log.info('房間 %s 已關閉', r['code'])
            for other in list(r['members']):
                where.pop(other, None)
                await send(clients.get(other), {'t': 'closed'})
        else:
            await announce(r)

    async def handle(user, ws, data):
        uid, t = user['id'], data.get('t')
        r = rooms.get(where.get(uid))
        if t == 'send':
            to = data.get('to')
            if not r or to == uid or to not in r['members'] or (uid != r['host'] and to != r['host']):
                return
            out = dumps({'t': 'msg', 'f': uid, 'd': data.get('d')})
            r['bytes'] += len(out)
            await send(clients.get(to), out)
            if time.time() - r['window'] >= TRAFFIC_EVERY:
                traffic(r)
        elif t == 'create':
            await leave(uid)
            code = new_code()
            now = time.time()
            r = rooms[code] = {'code': code, 'host': uid, 'open': True, 'members': {uid: member(user, data)},
                               'bytes': 0, 'window': now}
            where[uid] = code
            log.info('%s 開了房間 %s', user['name'], code)
            await announce(r)
        elif t == 'join':
            code = str(data.get('code') or '').strip().upper()
            target = rooms.get(code)
            if not target:
                await send(ws, {'t': 'error', 'code': 'not-found', 'req': 'join'})
            elif uid in target['members']:
                await send(ws, state(target))
            elif not target['open']:
                await send(ws, {'t': 'error', 'code': 'started', 'req': 'join'})
            elif len(target['members']) >= ROOM_MAX:
                await send(ws, {'t': 'error', 'code': 'full', 'req': 'join'})
            else:
                await leave(uid)
                target['members'][uid] = member(user, data)
                where[uid] = code
                log.info('%s 加入房間 %s（%d/%d）', user['name'], code, len(target['members']), ROOM_MAX)
                await announce(target)
        elif t == 'leave':
            await leave(uid)
        elif t == 'member' and r:
            m = member(user, data)
            r['members'][uid].update(dex=m['dex'], shiny=m['shiny'])
            await announce(r)
        elif t == 'open' and r and r['host'] == uid:
            r['open'] = bool(data.get('v'))
            await announce(r)

    async def ws_handler(req):
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=512 * 1024)
        await ws.prepare(req)
        user = None
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                if not isinstance(data, dict):
                    continue
                if user is None:
                    db.fresh()
                    user = db.session_user(str(data.get('token') or '')) if data.get('t') == 'auth' else None
                    if not user:
                        await send(ws, {'t': 'error', 'code': 'auth', 'req': 'auth'})
                        break
                    old = clients.get(user['id'])
                    clients[user['id']] = ws
                    if old is not None and old is not ws:
                        # Same account in another tab or device: the old connection goes.
                        await leave(user['id'])
                        await send(old, {'t': 'replaced'})
                        asyncio.ensure_future(old.close())
                    await send(ws, {'t': 'hello', 'id': user['id'], 'name': user['name']})
                    continue
                await handle(user, ws, data)
        finally:
            if user and clients.get(user['id']) is ws:
                clients.pop(user['id'], None)
                await leave(user['id'])
        return ws

    async def on_shutdown(app):
        for ws in list(clients.values()):
            await ws.close(code=WSCloseCode.GOING_AWAY, message=b'server shutdown')

    app.router.add_get('/ws', ws_handler)
    app.on_shutdown.append(on_shutdown)
