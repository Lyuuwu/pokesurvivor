/* ============ menu.js — menú principal, colección y mejoras ============ */
G.MenuUI = (() => {
  const $ = G.UI.$;
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  let dexFilter = 'all', dexGen = 1, dexSel = null;     // dexGen 0 = todas las regiones
  let dexShiny = false;
  const dexRarity = new Set();                           // vacío = todas las rarezas

  function init() {
    const ICON = { play: 'ball', dex: 'book', upgrades: 'up', gacha: 'ball4', goals: 'medal3', friends: 'friends', rank: 'trophy', settings: 'gear' };
    document.querySelectorAll('#scr-menu [data-go]').forEach(b => {
      b.insertAdjacentHTML('afterbegin', `<span class="mi-ico">${G.Icons.html(ICON[b.dataset.go], 26)}</span>`);
      b.dataset.sfx = b.dataset.go === 'play' ? 'confirm' : 'click';
      b.onclick = () => {
        const go = b.dataset.go;
        if (go === 'play') { if (G.Social.room) G.LobbyUI.open(); else G.Flow.play(); }
        else if (go === 'dex') openDex();
        else if (go === 'upgrades') openUpgrades();
        else if (go === 'gacha') G.GachaUI.open();
        else if (go === 'goals') G.GoalsUI.open();
        else if (go === 'friends') G.FriendsUI.open();
        else if (go === 'rank') G.RankingUI.open();
        else if (go === 'settings') G.SettingsUI.open();
      };
    });
    document.querySelectorAll('[data-back]').forEach(b => { b.onclick = open; });
    G.Social.on(() => { if (G.UI.isOpen('scr-menu')) socialLine(); });
    $('btn-logout').onclick = () => {
      if (G.DB.guest && !confirm('Eres invitado: se perderá todo el progreso. ¿Salir?')) return;
      G.Audio.music(null);
      G.DB.logout().then(() => G.Flow.toLogin());
    };
  }

  // ---------------- menú principal ----------------

  function open() {
    const s = G.DB.save;
    const mon = G.DEX_BY[s.partner];
    const shiny = !!s.partnerShiny && G.DB.ownsShiny(mon.dex);
    G.UI.chrome(true);
    G.UI.show('scr-menu');
    G.UI.sprite($('menu-partner'), mon.dex, { lively: true, scale: 4, hero: true, shiny });
    $('menu-partner').style.setProperty('--stage-c', shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]]);
    $('menu-partner').classList.toggle('shiny', shiny);
    $('menu-partner-name').innerHTML = mon.name + (shiny ? ' ' + G.Icons.html('shiny', 24) : '');
    $('menu-partner-info').innerHTML = G.UI.typeChips(mon.types) + ' ' + G.UI.stars(mon.rarity);
    // Normal / shiny a mano, aquí mismo (en el móvil no se encontraba en la ficha).
    const seg = $('menu-shiny');
    seg.classList.toggle('hidden', !G.DB.ownsShiny(mon.dex));
    seg.lastChild.innerHTML = G.Icons.html('shiny', 12) + ' Shiny';
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', (b.dataset.v === '1') === shiny);
      b.onclick = () => {
        if ((b.dataset.v === '1') === shiny) return;
        s.partnerShiny = b.dataset.v === '1';
        G.DB.commit();
        G.Audio.sfx('confirm');
        open();
      };
    });

    const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
    const shinies = Object.keys(s.shiny || {}).length;
    $('menu-dex-count').textContent = `${owned} / ${G.DEX.length}` + (shinies ? ` · ${shinies} shiny` : '');

    const st = s.stats;
    $('menu-stats').innerHTML =
      `Runs <b style="color:#fff">${st.runs}</b> · Mejor tiempo <b style="color:#fff">${G.U.mmss(st.bestTime)}</b><br>` +
      `Mejor nivel <b style="color:#fff">${st.bestLevel}</b> · Derrotados <b style="color:#fff">${st.totalKills.toLocaleString('es')}</b>` +
      (G.DB.guest ? '<br><span style="color:#ffb0b8">Modo invitado: no se guarda</span>' : '');

    socialLine();
    // Premios de misiones por recoger.
    G.Progress.checkAch();
    const pend = G.Progress.pending();
    $('menu-goals-sub').textContent = pend ? pend + (pend === 1 ? ' premio por recoger' : ' premios por recoger') : 'Misiones, logros y perfil';
    $('menu-goals-sub').classList.toggle('gold', pend > 0);
    // Con cuenta en la nube: amigos en línea, invitaciones y (una vez) el apodo.
    if ((G.DB.online || G.DB.selfHosted) && !G.Social.started) {
      G.Social.start().then(r => {
        if (r === 'need-nick' && !G.NickUI.skipped && G.UI.isOpen('scr-menu')) G.NickUI.open();
        socialLine();
      });
    }
    G.InvitePop.refresh();
  }

  /** Texto bajo "Amigos" y "Jugar": quién está en línea, solicitudes, sala. */
  function socialLine() {
    const room = G.Social.room;
    const play = document.querySelector('#scr-menu [data-go=play] small');
    if (play) play.textContent = room ? 'Volver a tu sala (' + room.members.length + '/' + G.Social.MAX_PLAYERS + ')' : 'Entra en la mazmorra';
    const fr = G.Social.friends;
    const on = fr.filter(f => f.status === 'ok' && f.online).length;
    const req = fr.filter(f => f.status === 'in').length;
    const parts = [];
    if (on) parts.push(on + ' en línea');
    if (req) parts.push(req + (req === 1 ? ' solicitud' : ' solicitudes'));
    $('menu-friends-sub').textContent = parts.length ? parts.join(' · ') : 'Juega en grupo, hasta 4';
    $('menu-friends-sub').classList.toggle('gold', req > 0);
  }

  // ---------------- colección ----------------

  function openDex() {
    G.UI.show('scr-dex', true);
    const s = G.DB.save;
    if (dexSel == null) { dexSel = s.partner; dexGen = G.DEX_BY[s.partner].gen; }
    const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
    $('dex-total').textContent = `${owned} / ${G.DEX.length}`;

    // Pestañas de generación (0 = todas), con cuántos tienes de cada una y el nivel de colección.
    const regs = G.Upgrades.regions(s);
    const tabs = $('dex-gens');
    tabs.innerHTML = '';
    ['Todas'].concat(GEN_NAMES).forEach((name, g) => {
      const total = G.DEX.filter(p => !g || p.gen === g).length;
      const have = G.DEX.filter(p => (!g || p.gen === g) && s.owned[p.dex]).length;
      const r = regs[g - 1];
      const b = document.createElement('button');
      b.className = 'gen-tab' + (g === dexGen ? ' on' : '');
      b.innerHTML = `<b>${name}</b><small>${have}/${total}</small>` + (r ? pips(r.tier, '') +
        (r.sTier ? `<small class="rg-sh">${G.Icons.html('shiny', 10)} ${r.sTier}/10</small>` : '') : '');
      b.onclick = () => { dexGen = g; openDex(); };
      tabs.appendChild(b);
    });
    $('dex-region').innerHTML = regionPanel(regs, dexGen);

    // Filtros que se combinan: si lo tienes (uno) + shiny y rarezas (varios a la vez).
    const fb = $('dex-filters');
    fb.innerHTML = '';
    const chip = (html, on, click) => {
      const c = document.createElement('button');
      c.className = 'chip' + (on ? ' on' : '');
      c.innerHTML = html;
      c.onclick = () => { click(); openDex(); };
      fb.appendChild(c);
    };
    for (const [k, label] of [['all', 'Todos'], ['own', 'Tengo'], ['miss', 'Me faltan']]) chip(label, dexFilter === k, () => { dexFilter = k; });
    fb.insertAdjacentHTML('beforeend', '<span class="chip-sep"></span>');
    chip(G.Icons.html('shiny', 12) + ' Shiny', dexShiny, () => { dexShiny = !dexShiny; });
    for (const r of [5, 4, 3, 2, 1]) {
      chip(G.Icons.rarity(r, 12) + ' ' + G.Gacha.RARITY_NAME[r], dexRarity.has(r), () => { if (!dexRarity.delete(r)) dexRarity.add(r); });
    }
    renderGrid();
    showDetail(dexSel);
  }

  // ---------------- colección por regiones (data/upgrades.js: regions) ----------------
  const pips = (n, cls) => `<span class="pips rg-pips ${cls}">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const pct = v => '+' + Math.round(v * 1000) / 10 + '%';
  function bonusList(b) {
    const L = [['spd', 'velocidad'], ['atk', 'daño'], ['crit', 'de críticos'], ['def', 'defensa'], ['hp', 'vida']];
    return L.filter(([k]) => b[k] > 0).map(([k, w]) => `<b class="gold">${pct(b[k])} ${w}</b>`).join(' · ');
  }
  /** Panel encima de la lista: la colección de la región elegida (o, en Todas, lo que va para todos). */
  function regionPanel(regs, g) {
    const U = G.Upgrades;
    if (!g) {
      const all = U.regionBonus(regs, 0);
      return `<div class="panel region-panel"><b>Colección por regiones</b>
        <p class="sub"><span>Cada 10% de la colección de una región es un nivel para sus Pokémon (los shiny cuentan el triple). Al 100%, la región da su premio a todos los Pokémon.</span></p>
        <div>${U.regionLevels(regs, 0) ? '<span>Para todos los Pokémon:</span> ' + bonusList(all) : '<span>Ninguna región al 100% todavía.</span>'}</div></div>`;
    }
    const r = regs[g - 1];
    const row = (label, have, total, tier, cls) => `<div class="rg-row"><span>${label}</span>${pips(tier, cls)}<span>${have}/${total}</span>` +
      `<span class="rg-next">${tier >= 10 ? '¡Completa!' : `Faltan ${U.regionNeed(have, total, tier)} para el nivel ${tier + 1}`}</span></div>`;
    return `<div class="panel region-panel"><b>Colección de ${GEN_NAMES[g - 1]}</b>
      ${row('Normal', r.have, r.total, r.tier, '')}
      ${row(G.Icons.html('shiny', 12) + ' Shiny', r.sHave, r.sTotal, r.sTier, 'sh')}
      <p class="sub"><span>Por nivel:</span> ${bonusList(U.REGION_STEP)} <span>(shiny, el triple). Sólo para los Pokémon de esta región; al 100%, para todos.</span></p>
      <div>${U.regionLevels(regs, g) ? `<span>Pokémon de ${GEN_NAMES[g - 1]}, ahora:</span> ` + bonusList(U.regionBonus(regs, g)) : '<span>Todavía sin premio.</span>'}</div></div>`;
  }

  function renderGrid() {
    const s = G.DB.save;
    const grid = $('dex-grid');
    grid.innerHTML = '';
    for (const p of G.DEX) {
      if (dexGen && p.gen !== dexGen) continue;
      const own = !!s.owned[p.dex], sh = !!(s.shiny && s.shiny[p.dex]);
      if (dexFilter === 'own' && !own) continue;
      if (dexFilter === 'miss' && own) continue;
      if (dexShiny && !sh) continue;
      if (dexRarity.size && !dexRarity.has(p.rarity)) continue;

      const cell = document.createElement('div');
      cell.className = 'cell' + (own ? '' : ' locked') + (p.dex === dexSel ? ' on' : '');
      cell.insertAdjacentHTML('beforeend', `<span class="no">${String(p.dex).padStart(3, '0')}</span>`);
      if (p.dex === s.partner) cell.insertAdjacentHTML('beforeend', `<span class="badge-r" title="Compañero">${G.Icons.html('crown', 14)}</span>`);
      else if (sh) cell.insertAdjacentHTML('beforeend', `<span class="badge-r" title="Tienes su shiny">${G.Icons.html('shiny', 12)}</span>`);
      const useShiny = sh && p.dex === s.partner && s.partnerShiny;
      cell.appendChild(G.UI.spriteCanvas(p.dex, 92, 80, { scale: 2, silhouette: !own, shadow: own, shiny: useShiny }));
      cell.insertAdjacentHTML('beforeend', `<b>${own ? p.name : '???'}</b>${G.UI.stars(p.rarity, 9)}`);
      cell.onclick = () => {
        dexSel = p.dex;
        grid.querySelectorAll('.cell').forEach(c => c.classList.remove('on'));
        cell.classList.add('on');
        showDetail(p.dex);
      };
      grid.appendChild(cell);
    }
    if (!grid.children.length) grid.innerHTML = '<p class="sub" style="grid-column:1/-1">Ninguno con este filtro.</p>';
  }

  // Variante que se está viendo en la ficha (normal o shiny).
  let viewShiny = false;

  function showDetail(dex) {
    const s = G.DB.save;
    const p = G.DEX_BY[dex];
    const own = !!s.owned[dex];
    const hasSh = G.DB.ownsShiny(dex);
    const isPartner = dex === s.partner;
    if (!hasSh) viewShiny = false;
    else if (isPartner && dex !== showDetail.last) viewShiny = !!s.partnerShiny;
    showDetail.last = dex;

    const usingThis = isPartner && (!hasSh || !!s.partnerShiny === viewShiny);

    const box = $('dex-detail');
    box.innerHTML = `
      <canvas id="dex-big" class="stage" width="220" height="190"></canvas>
      ${hasSh ? `<div class="seg">
          <button class="${viewShiny ? '' : 'on'}" data-v="0">Normal</button>
          <button class="${viewShiny ? 'on' : ''}" data-v="1">${G.Icons.html('shiny', 12)} Shiny</button></div>` : ''}
      <div class="center">
        <div style="color:var(--muted);font-size:13px">Nº ${String(p.dex).padStart(3, '0')} · ${GEN_NAMES[p.gen - 1]}</div>
        <h3>${own ? p.name : '???'}</h3>
        <div style="color:${G.Gacha.RARITY_COLOR[p.rarity]}">${G.UI.stars(p.rarity, 24)} ${G.Gacha.RARITY_NAME[p.rarity]}</div>
        <div style="margin:6px 0">${own ? G.UI.typeChips(p.types) : ''}</div>
      </div>
      ${own ? `
        ${statsBlock(dex, viewShiny)}
        <p style="font-size:14px;margin:10px 0 4px">Empieza con <b class="gold">${G.Moves.BY_ID[G.startMoveOf(dex)].name}</b></p>
        <p class="move-icons" title="Movimientos que puede aprender">
          ${G.Moves.poolFor(p).map(id => `<span title="${G.Moves.BY_ID[id].name}">${G.Icons.html('move:' + id, 16)}</span>`).join('')}</p>
        ${usingThis
          ? '<button class="btn grow" disabled style="width:100%">Es tu compañero</button>'
          : `<button id="dex-pick" class="btn gold" data-sfx="confirm" style="width:100%">Elegir de compañero${viewShiny ? ' (shiny)' : ''}</button>`}
      ` : `<p class="center" style="color:var(--muted)">Aún no lo tienes.<br>Consíguelo en el banner de <b class="gold">${GEN_NAMES[p.gen - 1]}</b>
            o derrotándolo cuando salga shiny.</p>`}
    `;
    $('dex-big').style.setProperty('--stage-c', !own ? '#5b83d6' : viewShiny ? '#9ae6ff' : G.U.TYPE_COLOR[p.types[0]]);
    $('dex-big').classList.toggle('shiny', own && viewShiny);
    G.UI.sprite($('dex-big'), dex, { lively: own, spin: own, silhouette: !own, scale: 3, hero: true, shiny: own && viewShiny });
    box.querySelectorAll('.seg button').forEach(b => {
      b.onclick = () => { viewShiny = b.dataset.v === '1'; showDetail(dex); };
    });
    const pick = $('dex-pick');
    if (pick) pick.onclick = () => {
      s.partner = dex;
      s.partnerShiny = hasSh && viewShiny;
      G.DB.commit();
      G.UI.toast(p.name + (s.partnerShiny ? ' shiny' : '') + ' es ahora tu compañero');
      renderGrid(); showDetail(dex);
    };
  }

  // ---------------- mejoras ----------------

  let upgDex = null;

  function openUpgrades() {
    G.UI.show('scr-upgrades', true);
    const s = G.DB.save;
    // Siempre empieza en el compañero que llevas (antes se quedaba en el último que miraste).
    upgDex = s.partner;
    // Selector con tus Pokémon: el compañero primero, luego los que ya tienen mejoras.
    const sel = $('upg-mon');
    const lv = d => Object.values(s.pupg[d] || {}).reduce((a, b) => a + b, 0);
    const mons = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d])
      .sort((a, b) => (b === s.partner) - (a === s.partner) || lv(b) - lv(a) || a - b);
    sel.innerHTML = mons.map(d => `<option value="${d}">${G.DEX_BY[d].name}${d === s.partner ? ' (compañero)' : ''}${lv(d) ? ' · ' + lv(d) + ' niveles' : ''}</option>`).join('');
    sel.value = upgDex;
    sel.onchange = () => { upgDex = +sel.value; G.Audio.sfx('select'); renderUpgrades(); };
    renderUpgrades();
  }

  function renderUpgrades() {
    const s = G.DB.save;
    const levels = G.DB.upgradesOf(upgDex);
    const mon = G.DEX_BY[upgDex];
    const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
    G.UI.sprite($('upg-stage'), upgDex, { lively: true, scale: 2, hero: true, shiny });
    $('upg-stage').style.setProperty('--stage-c', shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]]);
    $('upg-stats').innerHTML = statsBlock(upgDex, shiny);
    const box = $('upg-list');
    box.innerHTML = '';
    for (const u of G.Upgrades.LIST) {
      const lvl = levels[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : G.Upgrades.cost(u.id, lvl);
      const el = document.createElement('div');
      el.className = 'panel upg-item';
      el.innerHTML = `
        <div class="ic">${G.Icons.html(u.icon, 32)}</div>
        <div>
          <b>${u.name}</b> <span style="color:var(--muted);font-size:13px">${u.unit}</span>
          <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <div class="upg-btns">
          ${u.id === 'ban' && lvl > 0 ? `<button class="btn small" data-ban>Elegir (${banList().length}/${lvl})</button>` : ''}
          <button class="btn small ${maxed ? '' : 'gold'}" data-buy data-sfx="none" ${maxed || s.coins < cost ? 'disabled' : ''}>
          ${maxed ? 'Máx.' : `<span class="coin"></span> ${cost}`}</button></div>`;
      if (u.id === 'ban' && lvl > 0) el.querySelector('[data-ban]').onclick = () => { banOpen = !banOpen; renderUpgrades(); };
      el.querySelector('[data-buy]').onclick = () => {
        // Se vuelve a leer todo al pulsar (la partida puede haber cambiado desde que se dibujó).
        const sv = G.DB.save, lv = G.DB.upgradesOf(upgDex), now = lv[u.id] || 0;
        if (now >= u.max) { renderUpgrades(); return; }
        const price = G.Upgrades.cost(u.id, now);
        if (sv.coins < price) { renderUpgrades(); return; }
        sv.coins -= price;
        lv[u.id] = now + 1;
        G.DB.commit(true);
        G.Audio.sfx('buy');
        G.UI.refreshCoins();
        G.UI.toast(`${mon.name} · ${u.name}: nivel ${now + 1}`);
        renderUpgrades();
      };
      box.appendChild(el);
      if (u.id === 'ban' && lvl > 0 && banOpen) box.appendChild(banPicker(lvl));
    }
    box.appendChild(copiesPanel());
    box.appendChild(bindPanel());
  }

  // ---------------- copias: premios por repetidos del gacha ----------------
  function copiesPanel() {
    const n = G.DB.copiesOf(upgDex), max = G.Upgrades.COPY_MAX, K = G.Upgrades.COPY_KIND;
    const rarity = G.DEX_BY[upgDex].rarity;
    const label = (k, v) => k === 'reroll' ? `+${v} cambios de cartas` : `+${Math.round(v * 100)}% ` + { atk: 'daño', crit: 'de críticos', spd: 'velocidad' }[k];
    const t = G.Upgrades.copyTotals(n, rarity);
    const got = ['atk', 'reroll', 'crit', 'spd'].filter(k => t[k]).map(k => label(k, t[k]));
    const el = document.createElement('div');
    el.className = 'panel copies-panel';
    el.innerHTML = `<b>Copias ${n}/${max}</b>
      <p class="sub" style="margin:2px 0 8px"><span>Cada vez que el gacha te da este Pokémon repetido, gana una copia y su premio (se suma a las mejoras).</span>
      ${rarity === 5 ? '<span>Legendario: cada copia da más.</span>' : ''}
      ${got.length ? '<span>Ahora:</span> ' + got.map(g => `<b class="gold">${g}</b>`).join(' · ') : '<span>Todavía no tiene copias.</span>'}</p>
      <div class="copy-steps">${G.Upgrades.COPIES.map((k, i) =>
        `<span class="copy-step${i < n ? ' on' : ''}" title="${i + 1}: ${label(k, G.Upgrades.copyValue(k, rarity))}">${G.Icons.html(K[k].icon, 16)}<small>${i + 1}</small></span>`).join('')}</div>`;
    return el;
  }

  // ---------------- cómo empieza la partida (en Pokémon y en Mejoras) ----------------
  // La barra normal es lo del propio Pokémon; la parte dorada, lo que le suman
  // las mejoras, las copias, jugar con la shiny y la colección de las regiones.
  const STAT_ROWS = [
    ['hp',   'Vitalidad',     300,  v => String(Math.round(v))],
    ['atk',  'Fuerza',        2.6,  v => '×' + v.toFixed(2)],
    ['spd',  'Zancada',       220,  v => String(Math.round(v))],
    ['cd',   'Reflejos',      0.3,  v => (v > 0.004 ? '-' : '') + Math.round(v * 100) + '%'],
    ['def',  'Coraza',        0.5,  v => Math.round(v * 100) + '%'],
    ['crit', 'Golpe Crítico', 1,    v => Math.round(v * 100) + '%']
  ];
  function statsBlock(dex, shiny) {
    const s = G.DB.save, mon = G.DEX_BY[dex];
    const lv = (s.pupg && s.pupg[dex]) || {};          // sólo leer: upgradesOf() crearía una entrada vacía
    const x = { copies: G.DB.copiesOf(dex), rarity: mon.rarity, shiny: !!shiny && G.Sprites.hasShiny(dex),
                region: G.Upgrades.regionBonus(G.Upgrades.regions(s), mon.gen) };
    const base = G.Upgrades.runStats(mon, lv, x, true), now = G.Upgrades.runStats(mon, lv, x);
    return `<div class="run-stats"><small>Al empezar la partida${x.shiny ? ' (shiny)' : ''}</small>` + STAT_ROWS.map(([k, label, max, fmt]) => {
      const b = Math.min(100, base[k] / max * 100), n = Math.min(100, now[k] / max * 100);
      const up = now[k] - base[k] > 1e-6;
      return `<div class="stat" title="${fmt(base[k])}"><span>${label}</span><div class="bar"><i style="width:${b}%"></i>` +
        `<i class="up" style="width:${Math.max(0, n - b)}%"></i></div><span class="${up ? 'gold' : ''}">${fmt(now[k])}</span></div>`;
    }).join('') + '</div>';
  }

  // ---------------- atajos: hueco fijo para cada movimiento ----------------
  // save.pbind[dex] = [movimiento del hueco 1, del 2, del 3, del 4] (o null).
  function bindPanel() {
    const s = G.DB.save;
    s.pbind = s.pbind || {};
    const list = s.pbind[upgDex] || [null, null, null, null];
    const mon = G.DEX_BY[upgDex];
    const ids = G.Moves.poolFor(mon).concat([G.startMoveOf(upgDex)]).filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => G.Moves.BY_ID[a].name.localeCompare(G.Moves.BY_ID[b].name, 'es'));
    const el = document.createElement('div');
    el.className = 'panel bind-panel';
    el.innerHTML = `<b>Atajos de movimientos</b>
      <p class="sub" style="margin:2px 0 8px">Elige qué movimiento va siempre en cada hueco (teclas 1-4 o los iconos de abajo), para la memoria muscular. Si aún no tienes tantos movimientos, va al hueco más cercano.</p>
      <div class="bind-slots">${[0, 1, 2, 3].map(i => `<label class="bind-slot"><span>${i + 1}</span>
        <select class="field" data-slot="${i}"><option value="">Libre</option>${ids.map(id =>
          `<option value="${id}" ${list[i] === id ? 'selected' : ''}>${G.Moves.BY_ID[id].name}</option>`).join('')}</select></label>`).join('')}</div>`;
    el.querySelectorAll('select[data-slot]').forEach(sel => {
      sel.onchange = () => {
        const l = (s.pbind[upgDex] || [null, null, null, null]).slice(0, 4);
        while (l.length < 4) l.push(null);
        const i = +sel.dataset.slot, id = sel.value || null;
        // Un movimiento sólo puede estar en un hueco.
        for (let j = 0; j < 4; j++) if (id && l[j] === id) l[j] = null;
        l[i] = id;
        s.pbind[upgDex] = l;
        G.DB.commit();
        G.Audio.sfx('select');
        renderUpgrades();
      };
    });
    return el;
  }

  // ---------------- veto: movimientos bloqueados ----------------
  // Lista por Pokémon en save.pban[dex]; con N niveles de Veto, N movimientos.
  let banOpen = false;
  function banList() {
    const s = G.DB.save;
    s.pban = s.pban || {};
    return s.pban[upgDex] || (s.pban[upgDex] = []);
  }
  function banPicker(max) {
    const mon = G.DEX_BY[upgDex];
    const start = G.startMoveOf(upgDex);
    const ids = G.Moves.poolFor(mon).filter(id => id !== start)
      .sort((a, b) => G.Moves.BY_ID[a].name.localeCompare(G.Moves.BY_ID[b].name, 'es'));
    const list = banList();
    const el = document.createElement('div');
    el.className = 'panel ban-picker';
    el.innerHTML = `<p class="sub" style="margin:0 0 8px">Toca los movimientos que no quieres que te salgan en las cartas (${list.length}/${max}). El movimiento de inicio no se puede vetar.</p>
      <div class="ban-moves">${ids.map(id => { const d = G.Moves.BY_ID[id]; const on = list.includes(id);
        return `<button class="chip ${on ? 'on ban' : ''}" data-id="${id}">${G.Icons.html('move:' + id, 16)} ${d.name}${on ? ' ' + G.Icons.html('ban', 14) : ''}</button>`; }).join('')}</div>`;
    el.querySelectorAll('[data-id]').forEach(b => {
      b.onclick = () => {
        const l = banList(), id = b.dataset.id, i = l.indexOf(id);
        if (i >= 0) l.splice(i, 1);
        else if (l.length >= max) { G.UI.toast('Ya tienes ' + max + ' vetados: quita uno primero'); return; }
        else l.push(id);
        G.DB.commit();
        G.Audio.sfx('select');
        renderUpgrades();
      };
    });
    return el;
  }

  return { init, open, GEN_NAMES };
})();
