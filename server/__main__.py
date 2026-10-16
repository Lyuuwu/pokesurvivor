"""PokéSurvivor self-hosted server.

    python -m server                 start (port from data/config.json, 28080 by default)
    python -m server --dev           also serve dev.html (for programming)
    python -m server init            create server/data/ and an invite code
    python -m server invite [--new]  show (or replace) the invite code
    python -m server users           list accounts
    python -m server reset-password NAME
    python -m server import-save NAME FILE [--yes]
"""
import argparse
import getpass
import json
import logging
import socket
import sys
from datetime import datetime

from . import store as st

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def need_config():
    cfg = st.load_config()
    if cfg is None:
        sys.exit('還沒有 server/data/。請先執行：python -m server init')
    return cfg


def lan_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.') and not ip.startswith('172.'):
                ips.add(ip)
    except OSError:
        pass
    return sorted(ips)


def cmd_run(args):
    from aiohttp import web
    from .app import ROOT, make_app

    cfg, created = st.init_data()
    port = args.port or int(cfg.get('port') or 28080)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s', datefmt='%H:%M:%S')
    if not (ROOT / 'index.html').exists():
        print('注意：找不到 index.html，請先執行 node tools/build.js')
    print('PokéSurvivor 伺服器')
    if created:
        print('（第一次啟動，已建立 server/data/）')
    print(f'  本機：     http://127.0.0.1:{port}/')
    for ip in lan_ips():
        print(f'  區網：     http://{ip}:{port}/')
    print(f'  朋友：     http://<公網 IP>:{port}/   （查公網 IP：curl.exe -4 https://api.ipify.org）')
    print(f'  邀請碼：   {cfg["invite"]}')
    if args.dev:
        print(f'  開發用：   http://127.0.0.1:{port}/dev.html')
    print('按 Ctrl+C 結束。')
    web.run_app(make_app(dev=args.dev), host='0.0.0.0', port=port, access_log=None, print=None)


def cmd_init(args):
    cfg, created = st.init_data()
    print(('已建立 server/data/。' if created else 'server/data/ 已經存在。') + f'邀請碼：{cfg["invite"]}')


def cmd_invite(args):
    cfg = need_config()
    if args.new or not cfg.get('invite'):
        cfg['invite'] = st.new_invite()
        st.save_config(cfg)
        print(f'新的邀請碼：{cfg["invite"]}（舊的已失效；已經註冊的帳號不受影響）')
    else:
        print(f'邀請碼：{cfg["invite"]}')


def fmt_ms(ms):
    return datetime.fromtimestamp(ms / 1000).strftime('%Y-%m-%d %H:%M') if ms else '-'


def cmd_users(args):
    need_config()
    db = st.Store()
    if not db.users:
        print('還沒有任何帳號。')
        return
    print(f'{"名稱":<16} {"ID":<14} {"建立":<16} {"最後上線":<16} 存檔版本')
    for u in sorted(db.users.values(), key=lambda u: u['name'].lower()):
        rev = db.read_save(u['id'])['rev']
        print(f'{u["name"]:<16} {u["id"]:<14} {fmt_ms(u.get("created")):<16} {fmt_ms(u.get("last")):<16} {rev}')


def cmd_reset_password(args):
    need_config()
    db = st.Store()
    user = db.user_by_name(args.name)
    if not user:
        sys.exit(f'找不到帳號：{args.name}')
    temp = st.new_invite().lower()
    db.set_password(user, temp)
    print(f'{user["name"]} 的臨時密碼：{temp}')
    print('已登出這個帳號的所有裝置。請對方用臨時密碼登入。')


def ask_password(name):
    while True:
        p1 = getpass.getpass(f'設定 {name} 的密碼（{st.PASS_MIN}-{st.PASS_MAX} 字元，輸入時不會顯示）：')
        if not (st.PASS_MIN <= len(p1) <= st.PASS_MAX):
            print('長度不符，請重新輸入。')
            continue
        if getpass.getpass('再輸入一次：') != p1:
            print('兩次不一樣，請重新輸入。')
            continue
        return p1


def load_save_file(path):
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    # copy(localStorage.getItem(...)) gives the object itself; a quoted copy gives a string.
    if isinstance(data, str):
        data = json.loads(data)
    if isinstance(data, dict) and 'save' in data and 'rev' in data:   # a server save file
        data = data['save']
    if not st.valid_save(data):
        raise ValueError('不是遊戲存檔（缺少 v / owned / coins）')
    return data


def cmd_import_save(args):
    need_config()
    try:
        save = load_save_file(args.file)
    except (OSError, ValueError) as e:
        sys.exit(f'無法讀取存檔：{e}')
    db = st.Store()
    user = db.user_by_name(args.name)
    tickets = save.get('tickets') or {}
    print(f'存檔內容：寶可夢 {len(save.get("owned") or {})} 隻、異色 {len(save.get("shiny") or {})} 隻、'
          f'金幣 {save.get("coins", 0)}、抽券 x1 {tickets.get("t1", 0)} / x10 {tickets.get("t10", 0)}、'
          f'出擊 {(save.get("stats") or {}).get("runs", 0)} 次')
    if user:
        cur = db.read_save(user['id'])
        if cur['save']:
            print(f'注意：{user["name"]} 在伺服器上已經有存檔（版本 {cur["rev"]}），會被取代（舊的留在 .prev.json 與每日備份）。')
    else:
        if args.yes:
            sys.exit(f'找不到帳號：{args.name}（不加 --yes 執行，可以順便建立帳號）')
        if input(f'沒有 {args.name} 這個帳號，要建立嗎？(y/N) ').strip().lower() != 'y':
            sys.exit('已取消。')
        if not st.NAME_RE.match(args.name):
            sys.exit('名稱需為 3-16 個英文字母、數字或 _。')
    if not args.yes and input('確定匯入？(y/N) ').strip().lower() != 'y':
        sys.exit('已取消。')
    if not user:
        user, code = db.create_user(args.name, ask_password(args.name))
        if code:
            sys.exit(f'無法建立帳號：{code}')
    rev = db.read_save(user['id'])['rev'] + 1
    save['name'] = user['name']
    db.write_save(user['id'], save, rev)
    print(f'已匯入到 {user["name"]}（存檔版本 {rev}）。請重新登入遊戲確認。')


def main():
    p = argparse.ArgumentParser(prog='python -m server', description='PokéSurvivor 自架伺服器')
    p.add_argument('--port', type=int, help='連接埠（預設看 server/data/config.json，否則 28080）')
    p.add_argument('--dev', action='store_true', help='同時提供 dev.html（開發用）')
    sub = p.add_subparsers(dest='cmd')
    sub.add_parser('run', help='啟動伺服器（預設）')
    sub.add_parser('init', help='建立 server/data/ 與邀請碼')
    i = sub.add_parser('invite', help='顯示或更換邀請碼')
    i.add_argument('--new', action='store_true', help='產生新的邀請碼')
    sub.add_parser('users', help='列出帳號')
    r = sub.add_parser('reset-password', help='產生臨時密碼')
    r.add_argument('name')
    m = sub.add_parser('import-save', help='匯入舊存檔 JSON')
    m.add_argument('name')
    m.add_argument('file')
    m.add_argument('--yes', action='store_true', help='不詢問直接匯入')
    args = p.parse_args()
    {'run': cmd_run, None: cmd_run, 'init': cmd_init, 'invite': cmd_invite, 'users': cmd_users,
     'reset-password': cmd_reset_password, 'import-save': cmd_import_save}[args.cmd](args)


if __name__ == '__main__':
    main()
