/*
 * Éditeur de circuit (SVG) : placement des pièces, fils, câbles Grove, zoom, sélection.
 */
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const WIRE_COLORS = [['#2e7d32', 'vert'], ['#d32f2f', 'rouge'], ['#212121', 'noir'], ['#1565c0', 'bleu'], ['#f9a825', 'jaune'],
    ['#ef6c00', 'orange'], ['#f5f5f5', 'blanc'], ['#7b1fa2', 'violet'], ['#6d4c41', 'marron'], ['#757575', 'gris']];
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  };
  let uid = 1;
  const newId = prefix => prefix + Date.now().toString(36) + (uid++);

  class Editor {
    constructor(svg, opts) {
      this.svg = svg;
      this.o = opts || {};
      this.view = { x: -40, y: -40, s: 2 };
      this.sel = null;
      this.mode = null;
      this.locked = false;
      this.running = false;
      this.dynCache = new Map();
      this.undoStack = [];
      this.redoStack = [];
      this.vp = el('g', { id: 'vp' });
      this.gComps = el('g', { class: 'layer-comps' });
      this.gWires = el('g', { class: 'layer-wires' });
      this.gCables = el('g', { class: 'layer-cables' });
      this.gOver = el('g', { class: 'layer-over' });
      this.vp.append(this.gComps, this.gWires, this.gCables, this.gOver);
      svg.appendChild(this.defs());
      svg.appendChild(this.vp);
      this.tip = document.createElement('div');
      this.tip.className = 'pin-tip';
      svg.parentElement.appendChild(this.tip);
      this.bind();
    }
    defs() {
      const d = el('defs');
      d.innerHTML = '<pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.6" fill="#c5ccd6"/></pattern>';
      return d;
    }

    /* ------------------------------------------------------------ données */
    setCircuit(c) {
      this.c = c;
      for (const comp of c.comps) this.prepare(comp);
      this.sel = null;
      this.render();
    }
    prepare(comp) {
      comp.def = CATALOG.byType[comp.type];
      if (comp.def) {
        comp.props = Object.assign({}, comp.def.props || {}, comp.props || {});
        comp.sim = Object.assign({}, comp.def.sim || {}, comp.sim || {});
      }
      comp.rot = comp.rot || 0;
      comp.rt = comp.rt || {};
    }
    comp(id) { return this.c.comps.find(c => c.id === id); }
    boardComp() { return this.c.comps.find(c => c.type === 'board'); }

    snapshot() {
      return JSON.stringify({
        board: this.c.board, shield: this.c.shield,
        comps: this.c.comps.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot, props: c.props, sim: c.sim, name: c.name })),
        wires: this.c.wires, cables: this.c.cables
      });
    }
    pushUndo() {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
    }
    restore(json) {
      const d = JSON.parse(json);
      Object.assign(this.c, { board: d.board, shield: d.shield, comps: d.comps, wires: d.wires, cables: d.cables });
      this.c.comps.forEach(c => this.prepare(c));
      this.sel = null;
      this.render();
      this.changed(true);
    }
    undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); }
    redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); }
    changed(noUndo) { if (this.o.onChange) this.o.onChange(noUndo); }

    /* ------------------------------------------------------------ rendu */
    applyView() {
      this.vp.setAttribute('transform', `translate(${-this.view.x * this.view.s} ${-this.view.y * this.view.s}) scale(${this.view.s})`);
      this.svg.style.backgroundSize = `${10 * this.view.s}px ${10 * this.view.s}px`;
      this.svg.style.backgroundPosition = `${-this.view.x * this.view.s}px ${-this.view.y * this.view.s}px`;
    }
    render() {
      this.gComps.innerHTML = '';
      this.dynCache.clear();
      // carte et plaques d'essai sous les autres pièces
      const order = this.c.comps.slice().sort((a, b) => rankOf(a) - rankOf(b));
      for (const comp of order) this.gComps.appendChild(this.renderComp(comp));
      this.renderWires();
      this.renderSel();
      this.applyView();
      this.updateDynamic(null);
    }
    renderComp(comp) {
      const g = el('g', { class: 'comp', 'data-id': comp.id });
      g.setAttribute('transform', `translate(${comp.x} ${comp.y}) rotate(${comp.rot || 0})`);
      const art = el('g', { class: 'art' });
      art.innerHTML = DRAW.art(comp, this.c);
      const dyn = el('g', { class: 'dyn' });
      g.append(art, dyn);
      const geo = PARTS.geometry(comp, this.c);
      // zone de saisie invisible pour faciliter le clic
      const hit = el('rect', { x: geo.ox || 0, y: geo.oy || 0, width: geo.w, height: geo.h, fill: 'transparent', class: 'hit' });
      if (comp.type !== 'board' && comp.def && comp.def.kind !== 'breadboard') g.insertBefore(hit, art);
      comp._g = g;
      return g;
    }
    refreshComp(comp) {
      const old = comp._g;
      const g = this.renderComp(comp);
      if (old && old.parentNode) old.parentNode.replaceChild(g, old); else this.gComps.appendChild(g);
      this.dynCache.delete(comp.id);
      this.updateDynamic(this.lastSim || null);
    }
    pinAbs(ref) {
      const comp = this.comp(ref.c);
      if (!comp) return null;
      const geo = PARTS.geometry(comp, this.c);
      const p = geo.pins.find(q => q.id === ref.p);
      if (!p) return null;
      return PARTS.absPin(comp, p);
    }
    portAbs(portId) {
      const b = this.boardComp();
      const port = BOARDS[this.c.board].shieldPorts.find(p => p[0] === portId);
      if (!b || !port || !this.c.shield) return null;
      return { x: b.x + port[1], y: b.y + port[2] };
    }
    anchorAbs(comp) {
      const geo = PARTS.geometry(comp, this.c);
      if (!geo.groveAnchor) return null;
      const [x, y] = PARTS.rotate(geo.groveAnchor.x, geo.groveAnchor.y + 7, comp.rot);
      return { x: comp.x + x, y: comp.y + y };
    }
    renderWires() {
      this.gWires.innerHTML = '';
      for (const w of this.c.wires) {
        const a = this.pinAbs(w.a), b = this.pinAbs(w.b);
        if (!a || !b) continue;
        const pts = [a, ...(w.pts || []), b];
        const d = 'M' + pts.map(p => p.x + ' ' + p.y).join(' L');
        const g = el('g', { class: 'wire' + (this.sel && this.sel.wire === w.id ? ' selected' : ''), 'data-wire': w.id });
        g.appendChild(el('path', { d, class: 'wire-hit' }));
        g.appendChild(el('path', { d, class: 'wire-shadow' }));
        g.appendChild(el('path', { d, class: 'wire-line', stroke: w.color || '#2e7d32' }));
        for (const p of [a, b]) g.appendChild(el('circle', { cx: p.x, cy: p.y, r: 1.8, class: 'wire-end', fill: w.color || '#2e7d32' }));
        this.gWires.appendChild(g);
      }
      this.gCables.innerHTML = '';
      for (const cab of this.c.cables || []) {
        const comp = this.comp(cab.comp);
        if (!comp) continue;
        const a = this.anchorAbs(comp), b = this.portAbs(cab.port);
        if (!a || !b) continue;
        this.gCables.appendChild(this.cablePath(a, b, cab, this.sel && this.sel.cable === cab.comp));
      }
    }
    cablePath(a, b, cab, selected) {
      const g = el('g', { class: 'cable' + (selected ? ' selected' : ''), 'data-cable': cab ? cab.comp : '' });
      const dy = Math.max(30, Math.abs(b.y - a.y) * 0.5);
      const c1 = { x: a.x, y: a.y + dy }, c2 = { x: b.x, y: b.y + (b.y > a.y ? -dy : dy) * 0.6 + 20 };
      const base = `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
      g.appendChild(el('path', { d: base, class: 'cable-hit' }));
      g.appendChild(el('path', { d: base, class: 'cable-body' }));
      ['#212121', '#e53935', '#fafafa', '#fdd835'].forEach((col, i) => {
        const o = (i - 1.5) * 1.6;
        g.appendChild(el('path', { d: `M${a.x + o} ${a.y} C${c1.x + o} ${c1.y} ${c2.x + o} ${c2.y} ${b.x + o} ${b.y}`, stroke: col, class: 'cable-wire' }));
      });
      g.appendChild(el('rect', { x: b.x - 9, y: b.y - 5, width: 18, height: 10, rx: 1.5, class: 'cable-plug' }));
      return g;
    }
    renderSel() {
      this.gOver.querySelectorAll('.sel-box').forEach(e => e.remove());
      if (!this.sel || !this.sel.comp) return;
      const comp = this.comp(this.sel.comp);
      if (!comp) return;
      const geo = PARTS.geometry(comp, this.c);
      const r = el('rect', { x: (geo.ox || 0) - 4, y: (geo.oy || 0) - 4, width: geo.w + 8, height: geo.h + 8, rx: 4, class: 'sel-box' });
      r.setAttribute('transform', `translate(${comp.x} ${comp.y}) rotate(${comp.rot || 0})`);
      this.gOver.appendChild(r);
    }

    updateDynamic(sim) {
      this.lastSim = sim;
      for (const comp of this.c.comps) {
        if (!comp._g) continue;
        const s = DRAW.dyn(comp, this.c, sim);
        if (this.dynCache.get(comp.id) === s) continue;
        this.dynCache.set(comp.id, s);
        comp._g.querySelector('.dyn').innerHTML = s;
      }
    }

    /* ------------------------------------------------------------ coordonnées */
    toWorld(ev) {
      const r = this.svg.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / this.view.s + this.view.x, y: (ev.clientY - r.top) / this.view.s + this.view.y };
    }
    fit() {
      const r = this.svg.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const comp of this.c.comps) {
        const geo = PARTS.geometry(comp, this.c);
        const corners = [[geo.ox || 0, geo.oy || 0], [(geo.ox || 0) + geo.w, (geo.oy || 0) + geo.h]];
        for (const [x, y] of corners) {
          const [rx, ry] = PARTS.rotate(x, y, comp.rot);
          minX = Math.min(minX, comp.x + rx); minY = Math.min(minY, comp.y + ry);
          maxX = Math.max(maxX, comp.x + rx); maxY = Math.max(maxY, comp.y + ry);
        }
      }
      if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 300; maxY = 200; }
      const pad = 30;
      const s = Math.min((r.width || 800) / (maxX - minX + 2 * pad), (r.height || 500) / (maxY - minY + 2 * pad), 4);
      this.view.s = Math.max(0.3, s);
      this.view.x = minX - pad - ((r.width || 800) / this.view.s - (maxX - minX + 2 * pad)) / 2;
      this.view.y = minY - pad - ((r.height || 500) / this.view.s - (maxY - minY + 2 * pad)) / 2;
      this.applyView();
    }
    zoom(f, cx, cy) {
      const r = this.svg.getBoundingClientRect();
      if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
      const wx = cx / this.view.s + this.view.x, wy = cy / this.view.s + this.view.y;
      this.view.s = Math.max(0.25, Math.min(8, this.view.s * f));
      this.view.x = wx - cx / this.view.s;
      this.view.y = wy - cy / this.view.s;
      this.applyView();
    }

    // tous les points de connexion (broches)
    points() {
      const pts = [];
      for (const comp of this.c.comps) {
        const geo = PARTS.geometry(comp, this.c);
        for (const p of geo.pins) {
          const a = PARTS.absPin(comp, p);
          pts.push({ c: comp.id, p: p.id, x: a.x, y: a.y, label: p.label || p.id, comp });
        }
      }
      return pts;
    }
    nearestPin(w, radius) {
      let best = null, bd = radius * radius;
      for (const p of this.points()) {
        const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    pinLabel(p) {
      const comp = p.comp;
      if (comp.type === 'board') {
        const bp = BOARDS[this.c.board].pins.find(q => q.id === p.p);
        return `${BOARDS[this.c.board].name} : ${bp ? bp.label : p.p}${bp && bp.net !== bp.label ? ' (' + bp.net + ')' : ''}`;
      }
      if (comp.def && comp.def.kind === 'breadboard') return 'Plaque : ' + p.p;
      return (comp.def ? comp.def.name : comp.type) + ' : ' + p.label;
    }

    /* ------------------------------------------------------------ ajout / suppression */
    addComponent(type, x, y) {
      const def = CATALOG.byType[type];
      if (!def) return null;
      this.pushUndo();
      const comp = { id: newId('c'), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, rot: 0, props: {}, sim: {} };
      this.prepare(comp);
      this.c.comps.push(comp);
      // branchement automatique sur un port libre du shield
      let autoPort = null;
      if (this.c.shield && def.conn && type.startsWith('grove_')) autoPort = this.freePort(def.conn);
      if (autoPort) this.c.cables.push({ comp: comp.id, port: autoPort });
      this.render();
      this.select({ comp: comp.id });
      this.changed();
      if (autoPort && this.o.onToast) this.o.onToast(`« ${def.name} » branché sur le port ${autoPort.replace('_', ' n°')} (modifiable dans le panneau de droite).`);
      return comp;
    }
    freePort(conn) {
      const ports = BOARDS[this.c.board].shieldPorts.map(p => p[0]);
      const used = new Set((this.c.cables || []).map(c => c.port));
      const kind = id => BOARDS[this.c.board].portKind(id);
      if (conn === 'i2c') return ports.find(p => kind(p) === 'i2c' && !used.has(p)) || ports.find(p => kind(p) === 'i2c');
      const wanted = conn === 'analog' ? 'analog' : conn === 'uart' ? 'uart' : 'digital';
      return ports.find(p => kind(p) === wanted && !used.has(p)) || null;
    }
    setCable(compId, port) {
      this.pushUndo();
      this.c.cables = (this.c.cables || []).filter(c => c.comp !== compId);
      if (port) this.c.cables.push({ comp: compId, port });
      this.renderWires();
      this.changed();
    }
    deleteSelection() {
      if (!this.sel || this.locked) return;
      this.pushUndo();
      if (this.sel.comp) {
        const id = this.sel.comp;
        const comp = this.comp(id);
        if (comp && comp.type === 'board') return;
        this.c.comps = this.c.comps.filter(c => c.id !== id);
        this.c.wires = this.c.wires.filter(w => w.a.c !== id && w.b.c !== id);
        this.c.cables = (this.c.cables || []).filter(c => c.comp !== id);
      } else if (this.sel.wire) {
        this.c.wires = this.c.wires.filter(w => w.id !== this.sel.wire);
      } else if (this.sel.cable) {
        this.c.cables = this.c.cables.filter(c => c.comp !== this.sel.cable);
      }
      this.sel = null;
      this.render();
      this.select(null);
      this.changed();
    }
    rotateSelection() {
      if (!this.sel || !this.sel.comp || this.locked) return;
      const comp = this.comp(this.sel.comp);
      if (!comp || comp.type === 'board') return;
      this.pushUndo();
      comp.rot = ((comp.rot || 0) + 90) % 360;
      this.refreshComp(comp);
      this.renderWires();
      this.renderSel();
      this.changed();
    }
    select(sel) {
      this.sel = sel;
      this.renderSel();
      this.renderWires();
      if (this.o.onSelect) this.o.onSelect(sel);
    }
    setWireColor(color) {
      if (!this.sel || !this.sel.wire) return;
      const w = this.c.wires.find(x => x.id === this.sel.wire);
      if (!w) return;
      this.pushUndo();
      w.color = color;
      this.renderWires();
      this.changed();
    }

    autoWireColor(a, b) {
      const net = ref => {
        const comp = this.comp(ref.c);
        if (comp && comp.type === 'board') return BOARDS[this.c.board].netOf(ref.p);
        if (ref.p === 'GND' || /^(TN|BN)/.test(ref.p) || ref.p === 'K' || ref.p === '-') return 'GND';
        if (ref.p === 'VCC' || /^(TP|BP)/.test(ref.p)) return '5V';
        return null;
      };
      const n = [net(a), net(b)];
      if (n.includes('GND')) return '#212121';
      if (n.includes('5V') || n.includes('3V3') || n.includes('VIN')) return '#d32f2f';
      return '#2e7d32';
    }

    /* ------------------------------------------------------------ événements */
    bind() {
      const svg = this.svg;
      svg.addEventListener('mousedown', e => this.onDown(e));
      window.addEventListener('mousemove', e => this.onMove(e));
      window.addEventListener('mouseup', e => this.onUp(e));
      svg.addEventListener('wheel', e => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      svg.addEventListener('contextmenu', e => { e.preventDefault(); if (this.mode && this.mode.type === 'wire') this.cancelMode(); });
      svg.addEventListener('dblclick', e => {
        const w = e.target.closest('.wire');
        if (w && !this.locked && !this.running) this.addBend(w.dataset.wire, this.toWorld(e));
      });
      svg.addEventListener('dragover', e => { e.preventDefault(); });
      svg.addEventListener('drop', e => {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/x-comp');
        if (type && this.o.onDropComponent) this.o.onDropComponent(type, this.toWorld(e));
      });
      // écrans tactiles : on traduit en événements souris simples
      svg.addEventListener('touchstart', e => { if (e.touches.length === 1) { e.preventDefault(); this.onDown(touchEv(e)); } }, { passive: false });
      svg.addEventListener('touchmove', e => { if (e.touches.length === 1) { e.preventDefault(); this.onMove(touchEv(e)); } }, { passive: false });
      svg.addEventListener('touchend', e => { this.onUp(touchEv(e, true)); });
    }

    startPlacing(type) {
      if (this.locked) return;
      this.cancelMode();
      const def = CATALOG.byType[type];
      const ghost = el('g', { class: 'ghost' });
      const fake = { id: 'ghost', type, def, x: 0, y: 0, rot: 0, props: Object.assign({}, def.props), sim: Object.assign({}, def.sim), rt: {} };
      ghost.innerHTML = DRAW.art(fake, this.c);
      this.gOver.appendChild(ghost);
      this.mode = { type: 'place', comp: type, ghost };
      this.svg.classList.add('placing');
    }
    cancelMode() {
      if (this.mode && this.mode.ghost) this.mode.ghost.remove();
      if (this.mode && this.mode.rubber) this.mode.rubber.remove();
      this.mode = null;
      this.svg.classList.remove('placing', 'wiring');
    }

    onDown(e) {
      if (e.button === 2) return;
      const w = this.toWorld(e);
      const target = e.target;
      this.downAt = { x: e.clientX, y: e.clientY };
      // placement d'une nouvelle pièce
      if (this.mode && this.mode.type === 'place') {
        const type = this.mode.comp;
        this.cancelMode();
        if (this.o.onDropComponent) this.o.onDropComponent(type, w);
        return;
      }
      // fil en cours : clic sur une broche = fin, ailleurs = coude
      if (this.mode && this.mode.type === 'wire') {
        const pin = this.nearestPin(w, 7 / Math.min(this.view.s, 2) + 1.5);
        if (pin && !(pin.c === this.mode.from.c && pin.p === this.mode.from.p)) this.finishWire(pin);
        else this.mode.pts.push({ x: Math.round(w.x / 5) * 5, y: Math.round(w.y / 5) * 5 });
        return;
      }
      const compEl = target.closest('.comp');
      const comp = compEl ? this.comp(compEl.dataset.id) : null;
      // interaction pendant la simulation
      if (this.running) {
        if (comp && this.o.onInteractDown && this.o.onInteractDown(comp, e)) { this.mode = { type: 'interact', comp }; return; }
        if (comp) { this.select({ comp: comp.id }); return; }
        const wireEl = target.closest('.wire');
        if (wireEl) { this.select({ wire: wireEl.dataset.wire }); return; }
        this.mode = { type: 'pan', start: { x: e.clientX, y: e.clientY }, view: Object.assign({}, this.view) };
        return;
      }
      // câble Grove depuis le connecteur d'un module
      if (!this.locked && target.closest('.grove-conn') && comp) {
        this.mode = { type: 'cable', comp, rubber: null };
        this.svg.classList.add('wiring');
        return;
      }
      // port du shield : câble vers un module
      // broche : début d'un fil
      if (!this.locked) {
        const pin = this.nearestPin(w, 5 / Math.min(this.view.s, 2) + 1.2);
        if (pin && (!comp || comp.type === 'board' || (comp.def && comp.def.kind === 'breadboard') || this.isNearPinOnly(comp, pin, w))) {
          this.mode = { type: 'wire', from: { c: pin.c, p: pin.p }, start: pin, pts: [], dragStart: { x: e.clientX, y: e.clientY } };
          this.svg.classList.add('wiring');
          return;
        }
      }
      const wireEl = target.closest('.wire');
      if (wireEl) { this.select({ wire: wireEl.dataset.wire }); return; }
      const cableEl = target.closest('.cable');
      if (cableEl) { this.select({ cable: cableEl.dataset.cable }); return; }
      if (comp) {
        this.select({ comp: comp.id });
        if (!this.locked && comp.type !== 'board' || (!this.locked && comp.type === 'board')) {
          this.mode = { type: 'drag', comp, off: { x: w.x - comp.x, y: w.y - comp.y }, moved: false, undo: this.snapshot() };
        }
        return;
      }
      this.select(null);
      this.mode = { type: 'pan', start: { x: e.clientX, y: e.clientY }, view: Object.assign({}, this.view) };
    }
    isNearPinOnly(comp, pin, w) {
      return Math.hypot(pin.x - w.x, pin.y - w.y) < 3.2;
    }

    onMove(e) {
      if (!this.c) return;
      const w = this.toWorld(e);
      const m = this.mode;
      if (m && m.type === 'pan') {
        this.view.x = m.view.x - (e.clientX - m.start.x) / this.view.s;
        this.view.y = m.view.y - (e.clientY - m.start.y) / this.view.s;
        this.applyView();
        return;
      }
      if (m && m.type === 'drag') {
        let nx = Math.round((w.x - m.off.x) / 10) * 10, ny = Math.round((w.y - m.off.y) / 10) * 10;
        if (nx !== m.comp.x || ny !== m.comp.y) {
          m.comp.x = nx; m.comp.y = ny; m.moved = true;
          m.comp._g.setAttribute('transform', `translate(${nx} ${ny}) rotate(${m.comp.rot || 0})`);
          this.renderWires();
          this.renderSel();
        }
        return;
      }
      if (m && m.type === 'place') {
        m.ghost.setAttribute('transform', `translate(${Math.round(w.x / 10) * 10} ${Math.round(w.y / 10) * 10})`);
        return;
      }
      if (m && (m.type === 'wire' || m.type === 'cable')) {
        if (m.rubber) m.rubber.remove();
        if (m.type === 'wire') {
          const pts = [m.start, ...m.pts, w];
          m.rubber = el('path', { d: 'M' + pts.map(p => p.x + ' ' + p.y).join(' L'), class: 'rubber' });
        } else {
          const a = this.anchorAbs(m.comp);
          m.rubber = this.cablePath(a, w, null, false);
          m.rubber.classList.add('rubber-cable');
        }
        this.gOver.appendChild(m.rubber);
      }
      // survol des broches
      if (!this.running && !this.locked && (!m || m.type === 'wire')) {
        const pin = this.nearestPin(w, 5 / Math.min(this.view.s, 2) + 1.2);
        this.showPinHover(pin, e);
      } else this.showPinHover(null);
    }
    showPinHover(pin, e) {
      let h = this.gOver.querySelector('.pin-hover');
      if (!pin) { if (h) h.remove(); this.tip.style.display = 'none'; return; }
      if (!h) { h = el('circle', { class: 'pin-hover', r: 3 }); this.gOver.appendChild(h); }
      h.setAttribute('cx', pin.x); h.setAttribute('cy', pin.y);
      this.tip.textContent = this.pinLabel(pin);
      this.tip.style.display = 'block';
      const r = this.svg.getBoundingClientRect();
      this.tip.style.left = (e.clientX - r.left + 14) + 'px';
      this.tip.style.top = (e.clientY - r.top + 12) + 'px';
    }

    onUp(e) {
      const m = this.mode;
      if (!m) return;
      const w = this.toWorld(e);
      if (m.type === 'pan') { this.mode = null; return; }
      if (m.type === 'interact') { if (this.o.onInteractUp) this.o.onInteractUp(m.comp, e); this.mode = null; return; }
      if (m.type === 'drag') {
        this.mode = null;
        if (m.moved) {
          this.undoStack.push(m.undo); this.redoStack = [];
          this.dynCache.delete(m.comp.id);
          this.changed();
        }
        return;
      }
      if (m.type === 'wire') {
        // glisser d'une broche à une autre
        const dragDist = Math.hypot(e.clientX - m.dragStart.x, e.clientY - m.dragStart.y);
        if (dragDist > 6 && m.pts.length === 0) {
          const pin = this.nearestPin(w, 7 / Math.min(this.view.s, 2) + 1.5);
          if (pin && !(pin.c === m.from.c && pin.p === m.from.p)) this.finishWire(pin);
          else this.cancelMode();
        }
        return;
      }
      if (m.type === 'cable') {
        const portEl = e.target && e.target.closest ? e.target.closest('.port') : null;
        let port = portEl ? portEl.dataset.port : null;
        if (!port) port = this.nearestPort(w);
        this.cancelMode();
        if (port) {
          this.setCable(m.comp.id, port);
          this.select({ comp: m.comp.id });
        }
      }
    }
    nearestPort(w) {
      if (!this.c.shield) return null;
      let best = null, bd = 18 * 18;
      for (const [id] of BOARDS[this.c.board].shieldPorts) {
        const p = this.portAbs(id);
        const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }
    finishWire(pin) {
      const m = this.mode;
      this.cancelMode();
      this.pushUndo();
      const wire = { id: newId('w'), a: m.from, b: { c: pin.c, p: pin.p }, pts: m.pts, color: this.autoWireColor(m.from, pin) };
      this.c.wires.push(wire);
      this.renderWires();
      this.select({ wire: wire.id });
      this.changed();
    }
    addBend(wireId, w) {
      const wire = this.c.wires.find(x => x.id === wireId);
      if (!wire) return;
      this.pushUndo();
      const a = this.pinAbs(wire.a), b = this.pinAbs(wire.b);
      const pts = [a, ...(wire.pts || []), b];
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = segDist(w, pts[i], pts[i + 1]);
        if (d < bd) { bd = d; best = i; }
      }
      wire.pts = (wire.pts || []).slice();
      wire.pts.splice(best, 0, { x: Math.round(w.x / 5) * 5, y: Math.round(w.y / 5) * 5 });
      this.renderWires();
      this.changed();
    }
    straighten() {
      if (!this.sel || !this.sel.wire) return;
      const wire = this.c.wires.find(x => x.id === this.sel.wire);
      if (!wire) return;
      this.pushUndo();
      wire.pts = [];
      this.renderWires();
      this.changed();
    }
  }

  function rankOf(c) {
    if (c.type === 'board') return 0;
    if (c.def && c.def.kind === 'breadboard') return 1;
    return 2;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / ((dx * dx + dy * dy) || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function touchEv(e, end) {
    const t = end ? e.changedTouches[0] : e.touches[0];
    return { clientX: t.clientX, clientY: t.clientY, button: 0, target: document.elementFromPoint(t.clientX, t.clientY) || e.target, preventDefault() {} };
  }

  root.Editor = Editor;
  root.WIRE_COLORS = WIRE_COLORS;
})(this);
