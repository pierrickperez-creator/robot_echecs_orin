/*
 * Géométrie des pièces : taille et position des broches (coordonnées locales, 10 = 2,54 mm).
 * Utilisé à la fois par le simulateur (liaisons électriques) et par l'affichage.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const CATALOG = isNode ? require('./catalog.js') : root.CATALOG;
  const BOARDS = isNode ? require('./boards.js') : root.BOARDS;

  // breadboard : 30 colonnes, lignes a-e / f-j, 2 lignes d'alimentation en haut et en bas
  const BB = { cols: 30, x0: 20, rowsTop: [50, 60, 70, 80, 90], rowsBot: [120, 130, 140, 150, 160],
    rails: { TP: 10, TN: 20, BP: 180, BN: 190 }, w: 330, h: 200 };
  const ROW_NAMES = 'abcdefghij';
  const railCols = [];
  for (let c = 1; c <= BB.cols; c++) if (c % 6 !== 0) railCols.push(c);

  function breadboardPins() {
    const pins = [];
    for (let c = 1; c <= BB.cols; c++) {
      const x = BB.x0 + (c - 1) * 10;
      BB.rowsTop.forEach((y, i) => pins.push({ id: ROW_NAMES[i] + c, x, y, strip: 'T' + c }));
      BB.rowsBot.forEach((y, i) => pins.push({ id: ROW_NAMES[i + 5] + c, x, y, strip: 'B' + c }));
    }
    for (const [rail, y] of Object.entries(BB.rails)) {
      for (const c of railCols) pins.push({ id: rail + c, x: BB.x0 + (c - 1) * 10, y, strip: rail });
    }
    return pins;
  }
  const BB_PINS = breadboardPins();

  // module Grove : connecteur en bas, 4 broches GND, VCC, SIG2 (blanc), SIG1 (jaune)
  function groveGeom(def) {
    const sizes = { lcd: [320, 140], oled: [160, 150], tm1637: [170, 90], ledbar: [170, 80] };
    let [w, h] = sizes[def.draw] || [80 * (def.w || 1), 80];
    if (def.draw === 'pixels') {
      const n = (def.props && def.props.count) || 10;
      const shape = def.props && def.props.shape;
      if (shape === 'ring') { w = h = n > 16 ? 200 : 160; }
      else { w = Math.max(160, n * 20 + 20); h = 60; }
    }
    const cx = Math.round(w / 2 / 10) * 10;
    const y = h;
    return {
      w, h,
      pins: [
        { id: 'GND', x: cx - 15, y, label: 'GND', grove: 3 },
        { id: 'VCC', x: cx - 5, y, label: 'VCC', grove: 2 },
        { id: 'SIG2', x: cx + 5, y, label: 'SIG2', grove: 1 },
        { id: 'SIG1', x: cx + 15, y, label: 'SIG1', grove: 0 }
      ],
      groveAnchor: { x: cx, y: h - 8 }
    };
  }

  const BASIC = {
    resistor: { w: 40, h: 12, ox: 0, oy: -6, pins: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 40, y: 0 }] },
    led: { w: 20, h: 40, ox: -5, oy: -35, pins: [{ id: 'A', x: 0, y: 0, label: 'anode (+)' }, { id: 'K', x: 10, y: 0, label: 'cathode (−)' }] },
    rgbled: { w: 40, h: 44, ox: -5, oy: -38, pins: [{ id: 'R', x: 0, y: 0, label: 'rouge' }, { id: 'K', x: 10, y: 0, label: 'cathode (−)' },
      { id: 'G', x: 20, y: 0, label: 'vert' }, { id: 'B', x: 30, y: 0, label: 'bleu' }] },
    pushbutton: { w: 34, h: 44, ox: -7, oy: -7, pins: [{ id: '1a', x: 0, y: 0 }, { id: '2a', x: 20, y: 0 }, { id: '1b', x: 0, y: 30 }, { id: '2b', x: 20, y: 30 }] },
    slideswitch: { w: 34, h: 26, ox: -7, oy: -20, pins: [{ id: '1', x: 0, y: 0 }, { id: 'C', x: 10, y: 0, label: 'commun' }, { id: '2', x: 20, y: 0 }] },
    potentiometer: { w: 40, h: 46, ox: -10, oy: -40, pins: [{ id: '1', x: 0, y: 0 }, { id: 'W', x: 10, y: 0, label: 'curseur' }, { id: '2', x: 20, y: 0 }] },
    ldr: { w: 20, h: 30, ox: -5, oy: -26, pins: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 10, y: 0 }] },
    ntc: { w: 20, h: 30, ox: -5, oy: -26, pins: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 10, y: 0 }] },
    piezo: { w: 40, h: 40, ox: -10, oy: -36, pins: [{ id: '+', x: 0, y: 0, label: '+' }, { id: '-', x: 20, y: 0, label: '−' }] },
    servo: { w: 90, h: 70, ox: -35, oy: -66, pins: [{ id: 'GND', x: 0, y: 0, label: 'GND (marron)' }, { id: 'VCC', x: 10, y: 0, label: '5 V (rouge)' },
      { id: 'SIG', x: 20, y: 0, label: 'signal (orange)' }] },
    dcmotor: { w: 60, h: 60, ox: -20, oy: -56, pins: [{ id: '1', x: 0, y: 0 }, { id: '2', x: 20, y: 0 }] },
    hcsr04: { w: 120, h: 60, ox: -45, oy: -56, pins: [{ id: 'VCC', x: 0, y: 0, label: 'VCC' }, { id: 'TRIG', x: 10, y: 0, label: 'Trig' },
      { id: 'ECHO', x: 20, y: 0, label: 'Echo' }, { id: 'GND', x: 30, y: 0, label: 'GND' }] }
  };

  function boardGeom(boardId, shield) {
    const b = BOARDS[boardId];
    const g = { w: b.w, h: b.h, ox: 0, oy: 0, pins: b.pins.map(p => ({ id: p.id, x: p.x, y: p.y, label: p.label, net: p.net })) };
    if (shield) {
      g.ports = b.shieldPorts.map(([id, x, y]) => ({ id, x, y }));
      if (boardId === 'nano') { g.ox = -40; g.oy = -70; g.w = 260; g.h = 210; }
    }
    return g;
  }

  // géométrie d'une instance (comp.type = 'board' pour la carte)
  function geometry(comp, circuit) {
    if (comp.type === 'board') return boardGeom(circuit.board, circuit.shield);
    const def = CATALOG.byType[comp.type];
    if (!def) return { w: 40, h: 40, ox: 0, oy: 0, pins: [] };
    if (def.kind === 'breadboard') return { w: BB.w, h: BB.h, ox: 0, oy: 0, pins: BB_PINS };
    const basic = BASIC[def.draw];
    if (basic) return basic;
    const g = groveGeom(Object.assign({}, def, { props: Object.assign({}, def.props, comp.props) }));
    g.ox = 0; g.oy = 0;
    return g;
  }

  // position absolue d'une broche (rotation par pas de 90° autour de l'origine de la pièce)
  function rotate(x, y, rot) {
    switch (((rot || 0) % 360 + 360) % 360) {
      case 90: return [-y, x];
      case 180: return [-x, -y];
      case 270: return [y, -x];
      default: return [x, y];
    }
  }
  function absPin(comp, pin) {
    const [x, y] = rotate(pin.x, pin.y, comp.rot);
    return { x: comp.x + x, y: comp.y + y };
  }

  const API = { geometry, absPin, rotate, BB, BB_PINS, ROW_NAMES };
  if (isNode) module.exports = API;
  else root.PARTS = API;
})(this);
