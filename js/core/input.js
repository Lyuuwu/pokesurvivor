/* ============ input.js — teclado y ratón (el táctil está en touch.js) ============ */
G.Input = (() => {
  const down = new Set();
  const pressed = new Set();   // se limpia cada frame
  let mx = 0, my = 0, mdown = false, mouseActive = false;

  const MOVE_KEYS = {
    up: ['keyw', 'arrowup'], down: ['keys', 'arrowdown'],
    left: ['keya', 'arrowleft'], right: ['keyd', 'arrowright']
  };

  function code(e) { return (e.code || e.key).toLowerCase(); }

  addEventListener('keydown', e => {
    const c = code(e);
    if (!down.has(c)) pressed.add(c);
    down.add(c);
    // Evita que el navegador haga scroll con flechas/espacio durante el juego.
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', 'tab'].includes(c)) e.preventDefault();
  });
  addEventListener('keyup', e => down.delete(code(e)));
  addEventListener('blur', () => { down.clear(); mdown = false; });
  function pointer(e) {
    mouseActive = e.pointerType === 'mouse';
    if (mouseActive) { mx = e.clientX; my = e.clientY; }
    else mdown = false;
  }
  addEventListener('pointermove', pointer);
  addEventListener('pointerdown', e => { pointer(e); mdown = mouseActive; });
  addEventListener('pointerup', () => mdown = false);
  addEventListener('pointercancel', () => mdown = false);

  return {
    /** Vector de movimiento del jugador (teclado o joystick táctil). */
    axis() {
      const t = G.Touch && G.Touch.vector();
      if (t && (t[0] || t[1])) return t;
      let x = 0, y = 0;
      if (MOVE_KEYS.left.some(k => down.has(k))) x -= 1;
      if (MOVE_KEYS.right.some(k => down.has(k))) x += 1;
      if (MOVE_KEYS.up.some(k => down.has(k))) y -= 1;
      if (MOVE_KEYS.down.some(k => down.has(k))) y += 1;
      return G.U.norm(x, y);
    },
    held(c) { return down.has(c); },
    /** true sólo en el frame en que se pulsó. */
    tap(c) { return pressed.has(c); },
    mouse() { return { x: mx, y: my, down: mdown, active: mouseActive }; },
    /** Posición del ratón en el mundo; null hasta usarlo o fuera del canvas. */
    mouseWorld() {
      if (!mouseActive) return null;
      const cv = document.getElementById('game');
      if (!cv) return null;
      const rect = cv.getBoundingClientRect();
      if (!rect.width || !rect.height || mx < rect.left || mx > rect.right || my < rect.top || my > rect.bottom) return null;
      return G.Camera.screenToWorld((mx - rect.left) * cv.clientWidth / rect.width,
                                    (my - rect.top) * cv.clientHeight / rect.height);
    },
    endFrame() { pressed.clear(); }
  };
})();
