/* A local test preset, applied once after login. Never writes to Firebase. */
G.LocalTestProfile = (() => {
  function apply() {
    const cfg = G.LOCAL_TEST_PROFILE, db = G.DB;
    if (!cfg || !cfg.enabled || location.protocol !== 'file:' || db.mode !== 'local' || db.guest || !db.save
        || (db.user || '').toLowerCase() !== cfg.account) return { status: 'skipped' };
    const save = db.save;
    if (save.localTestPreset && save.localTestPreset.id === cfg.id) return { status: 'already' };
    const backupKey = 'ps.backup.' + cfg.account + '.' + cfg.id;
    const before = JSON.stringify(save);
    try {
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, before);
      const now = Date.now();
      save.owned = save.owned || {};
      save.shiny = save.shiny || {};
      save.pupg = save.pupg || {};
      for (const mon of G.DEX) {
        db.grant(mon.dex, 'test');
        if (G.Sprites.hasShiny(mon.dex)) db.grantShiny(mon.dex, 'test');
        const upgrades = save.pupg[mon.dex] = save.pupg[mon.dex] || {};
        for (const u of G.Upgrades.LIST) upgrades[u.id] = u.max;
      }
      save.coins = Math.max(save.coins || 0, cfg.coins);
      save.tickets = save.tickets || { t1: 0, t10: 0 };
      for (const key of ['t1', 't10']) save.tickets[key] = Math.max(save.tickets[key] || 0, cfg.tickets[key]);
      if (!save.partner || !G.DEX_BY[save.partner]) save.partner = G.DEX[0].dex;
      save.localTestPreset = { id: cfg.id, at: now, backupKey };
      if (!db.commit()) throw new Error('Could not save to localStorage');
      return { status: 'applied', backupKey, owned: Object.keys(save.owned).length };
    } catch (error) {
      for (const key of Object.keys(save)) delete save[key];
      Object.assign(save, JSON.parse(before));
      return { status: 'error', error: error.message };
    }
  }
  return { apply };
})();
