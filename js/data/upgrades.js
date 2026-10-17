/* ============ upgrades.js — mejoras permanentes entre runs ============
 * Se compran con Pokémonedas en el menú. `per` es lo que da cada nivel.
 */
G.Upgrades = (() => {
  const LIST = [
    { id: 'hp',     icon: 'heart', name: 'Vitalidad',      unit: '+8 vida',            max: 10, base: 60,  grow: 1.35 },
    { id: 'atk',    icon: 'fist', name: 'Fuerza',         unit: '+4% daño',           max: 10, base: 80,  grow: 1.38 },
    { id: 'spd',    icon: 'boot', name: 'Zancada',        unit: '+3% velocidad',      max: 8,  base: 70,  grow: 1.4 },
    { id: 'cd',     icon: 'clock', name: 'Reflejos',       unit: '-3% recarga',        max: 8,  base: 90,  grow: 1.42 },
    { id: 'def',    icon: 'shield', name: 'Coraza',         unit: '+2% defensa',        max: 8,  base: 80,  grow: 1.4 },
    { id: 'regen',  icon: 'sprout', name: 'Síntesis',       unit: '+0.2 vida/s',        max: 5,  base: 120, grow: 1.5 },
    { id: 'magnet', icon: 'magnet', name: 'Imán',           unit: '+12% recogida',      max: 6,  base: 50,  grow: 1.4 },
    { id: 'xp',     icon: 'book', name: 'Sabiduría',      unit: '+5% experiencia',    max: 8,  base: 100, grow: 1.42 },
    { id: 'coins',  icon: 'coin', name: 'Fortuna',        unit: '+8% Pokémonedas',    max: 8,  base: 120, grow: 1.45 },
    { id: 'moves',  icon: 'cards', name: 'Repertorio',     unit: 'Empiezas con 2 movimientos', max: 1, base: 1500, grow: 1 },
    { id: 'crit',   icon: 'star', name: 'Golpe Crítico',  unit: '+3% de críticos (x1,5 de daño)', max: 10, base: 90, grow: 1.4 },
    { id: 'reroll', icon: 'up', name: 'Cambio de cartas', unit: '+1 cambio de cartas de nivel por run', max: 5, base: 150, grow: 1.6 },
    { id: 'ban',    icon: 'ban', name: 'Veto',           unit: 'Bloquea 1 movimiento: no te sale en las cartas', max: 3, base: 300, grow: 1.9 }
  ];
  const BY = {};
  for (const u of LIST) BY[u.id] = u;

  function cost(id, lvl) {
    const u = BY[id];
    return Math.round(u.base * Math.pow(u.grow, lvl) / 10) * 10;
  }

  /*
   * COPIAS (repetidos del gacha). Cada vez que te sale un Pokémon que ya tenías
   * sube un nivel de copias de ESE Pokémon, hasta COPY_MAX. Cada nivel da un
   * premio fijo, el mismo para todos los Pokémon, que se suma a lo comprado en
   * Mejoras (y no cuenta para sus máximos). Lo que más se echaba en falta eran
   * cambios de cartas y críticos: por eso salen más a menudo.
   * Los legendarios (★5) salen mucho menos, así que cada copia suya da más (leg).
   * Total con 20: +16% daño, +6 cambios de cartas, +18% críticos, +12% velocidad;
   *   legendario: +24% daño, +12 cambios de cartas, +30% críticos, +20% velocidad.
   */
  const COPY_MAX = 20;
  const COPY_KIND = {
    atk:    { icon: 'fist', v: 0.04, leg: 0.06 },
    reroll: { icon: 'up',   v: 1,    leg: 2 },
    crit:   { icon: 'star', v: 0.03, leg: 0.05 },
    spd:    { icon: 'boot', v: 0.03, leg: 0.05 }
  };
  const COPIES = ['atk', 'reroll', 'crit', 'spd', 'reroll',
                  'crit', 'atk', 'reroll', 'crit', 'spd',
                  'atk', 'reroll', 'crit', 'spd', 'reroll',
                  'crit', 'atk', 'reroll', 'crit', 'spd'];

  /** Lo que da UNA copia de tipo `k` a un Pokémon de esa rareza. */
  const copyValue = (k, rarity) => (rarity === 5 ? COPY_KIND[k].leg : COPY_KIND[k].v);

  /** Lo que dan `n` copias: { atk, reroll, crit, spd } sumados. */
  function copyTotals(n, rarity = 1) {
    const t = { atk: 0, reroll: 0, crit: 0, spd: 0 };
    const k = Math.max(0, Math.min(COPY_MAX, Math.floor(+n || 0)));
    for (let i = 0; i < k; i++) t[COPIES[i]] += copyValue(COPIES[i], rarity);
    return t;
  }

  /*
   * SHINY. Jugar con la versión shiny da una mejora en todo. La de vida, daño y
   * velocidad depende de la rareza: con ella la shiny de un Pokémon normal
   * queda como un legendario normal (de media: vida 91 -> 112, daño x1,00 ->
   * x1,35, velocidad 98 -> 118), y así se puede jugar con cualquiera. Además,
   * para todas, defensa y críticos. Lo de la rareza multiplica la base del
   * Pokémon (como si fuera más fuerte de por sí); el resto se suma.
   */
  const SHINY = {
    1: { hp: 0.25, atk: 0.35, spd: 0.20 },
    2: { hp: 0.20, atk: 0.25, spd: 0.16 },
    3: { hp: 0.15, atk: 0.15, spd: 0.12 },
    4: { hp: 0.12, atk: 0.10, spd: 0.10 },
    5: { hp: 0.10, atk: 0.10, spd: 0.08 }
  };
  const SHINY_ALL = { def: 0.10, crit: 0.10 };
  const shinyOf = (rarity, shiny) => (shiny ? Object.assign({}, SHINY[rarity] || SHINY[1], SHINY_ALL) : { hp: 0, atk: 0, spd: 0, def: 0, crit: 0 });

  /**
   * Niveles comprados -> modificadores para G.Player.
   * @param x  { copies, rarity, shiny }: copias del gacha, rareza (1-5) y si juegas con la shiny
   */
  function perks(levels = {}, x = {}) {
    // Nunca por encima del máximo (una partida editada a mano no da más poder).
    const L = id => Math.max(0, Math.min(BY[id].max, Math.floor(+levels[id] || 0)));
    const C = copyTotals(x.copies, x.rarity), S = shinyOf(x.rarity, x.shiny);
    return {
      hp: L('hp') * 8,
      hpMul: 1 + S.hp,                                       // sobre la vida base del Pokémon
      atkMul: (1 + L('atk') * 0.04 + C.atk) * (1 + S.atk),
      spdMul: (1 + L('spd') * 0.03 + C.spd) * (1 + S.spd),
      cdMul: 1 - L('cd') * 0.03,
      dmgReduce: L('def') * 0.02 + S.def,
      regen: L('regen') * 0.2,
      magnetMul: 1 + L('magnet') * 0.12,
      xpMul: 1 + L('xp') * 0.05,
      coinMul: 1 + L('coins') * 0.08,
      startMoves: 1 + L('moves'),
      crit: L('crit') * 0.03 + C.crit + S.crit,
      rerolls: L('reroll') + C.reroll,
      bans: L('ban')
    };
  }

  /**
   * Cómo empieza la partida un Pokémon (lo que se ve en Pokémon y en Mejoras):
   * vida, daño (multiplicador), velocidad, recarga (menos es mejor), defensa
   * y críticos. Con `bare`, sólo lo suyo (sin mejoras, copias ni shiny).
   */
  function runStats(mon, levels, x = {}, bare = false) {
    const k = bare ? perks({}, {}) : perks(levels, x);
    return {
      hp: Math.round(mon.hp * k.hpMul) + k.hp,
      atk: mon.atk * k.atkMul,
      spd: Math.round(mon.spd * k.spdMul),
      cd: 1 - k.cdMul,
      def: Math.min(0.8, k.dmgReduce),
      crit: k.crit
    };
  }

  return { LIST, BY, cost, perks, runStats, COPY_MAX, COPY_KIND, COPIES, copyValue, copyTotals, SHINY, SHINY_ALL };
})();
