/*
 * Moteur de simulation :
 *   - construction des liaisons électriques (nets) à partir des pièces, fils et câbles Grove ;
 *   - résolution électrique par analyse nodale (loi d'Ohm, LED, sources), avec diagnostic
 *     (LED grillée, court-circuit, broche surchargée, entrée flottante) ;
 *   - exécution du programme (VM) et comportement des modules.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const CATALOG = isNode ? require('./catalog.js') : root.CATALOG;
  const BOARDS = isNode ? require('./boards.js') : root.BOARDS;
  const PARTS = isNode ? require('./parts.js') : root.PARTS;
  const VMLib = isNode ? require('./vm.js') : root.VMLib;
  const S = isNode ? require('./vm_spec.js') : root.VMSPEC;

  /* ================================================================ liaisons (nets) */
  class UnionFind {
    constructor() { this.p = new Map(); }
    find(x) {
      if (!this.p.has(x)) this.p.set(x, x);
      let r = x;
      while (this.p.get(r) !== r) r = this.p.get(r);
      while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
      return r;
    }
    union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
  }

  // liaisons internes permanentes de certaines pièces
  const INTERNAL = { pushbutton: [['1a', '1b'], ['2a', '2b']] };

  function buildNetlist(circuit) {
    const uf = new UnionFind();
    const at = new Map();
    const board = BOARDS[circuit.board];
    for (const comp of circuit.comps) {
      const g = PARTS.geometry(comp, circuit);
      const def = CATALOG.byType[comp.type];
      for (const p of g.pins) {
        const key = comp.id + '.' + p.id;
        uf.find(key);
        const a = PARTS.absPin(comp, p);
        const k = a.x + ',' + a.y;
        if (!at.has(k)) at.set(k, []);
        at.get(k).push(key);
        if (comp.type === 'board') uf.union(key, 'net:' + p.net);
        if (p.strip) uf.union(key, comp.id + '.strip:' + p.strip);
      }
      const internal = def && INTERNAL[def.draw];
      if (internal) internal.forEach(([a, b]) => uf.union(comp.id + '.' + a, comp.id + '.' + b));
    }
    for (const keys of at.values()) for (let i = 1; i < keys.length; i++) uf.union(keys[0], keys[i]);
    for (const w of circuit.wires) uf.union(w.a.c + '.' + w.a.p, w.b.c + '.' + w.b.p);
    for (const cab of circuit.cables || []) {
      const sig = board.portSignals(cab.port);
      if (!sig) continue;
      ['SIG1', 'SIG2', 'VCC', 'GND'].forEach((pin, i) => uf.union(cab.comp + '.' + pin, 'net:' + sig[i]));
    }
    ['GND', '5V', '3V3'].forEach(n => uf.find('net:' + n));
    for (let i = 0; i < board.digitalCount; i++) uf.find('net:D' + i);
    for (let i = 0; i < board.analogCount; i++) uf.find('net:A' + i);

    const index = new Map();
    let count = 0;
    for (const key of uf.p.keys()) {
      const r = uf.find(key);
      if (!index.has(r)) index.set(r, count++);
    }
    const net = key => index.get(uf.find(key));
    return {
      count,
      net,
      pin: (compId, pinId) => net(compId + '.' + pinId),
      boardNet: name => net('net:' + name),
      ground: net('net:GND'),
      sameNet: (a, b) => uf.find(a) === uf.find(b)
    };
  }

  /* ================================================================ résolution électrique */
  // éléments : { t: 'g', a, b, g } conductance ; { t: 'v', a, b, v, g } source v (+ en a) avec conductance série g ;
  //            { t: 'd', a, b, vf, rs } diode (anode a)
  function solveElements(nNets, ground, elements) {
    const used = new Map();
    const idx = n => {
      if (n === ground || n === undefined) return -1;
      if (!used.has(n)) used.set(n, used.size);
      return used.get(n);
    };
    for (const e of elements) { e._a = idx(e.a); e._b = idx(e.b); }
    const n = used.size;
    const diodes = elements.filter(e => e.t === 'd');
    diodes.forEach(d => { if (d.on === undefined) d.on = false; });
    let V = new Float64Array(n);
    for (let iter = 0; iter < 25; iter++) {
      const G = new Float64Array(n * n);
      const I = new Float64Array(n);
      const stampG = (a, b, g) => {
        if (a >= 0) G[a * n + a] += g;
        if (b >= 0) G[b * n + b] += g;
        if (a >= 0 && b >= 0) { G[a * n + b] -= g; G[b * n + a] -= g; }
      };
      const stampV = (a, b, v, g) => {
        stampG(a, b, g);
        if (a >= 0) I[a] += v * g;
        if (b >= 0) I[b] -= v * g;
      };
      for (let i = 0; i < n; i++) G[i * n + i] += 1e-9;  // gmin
      for (const e of elements) {
        if (e.t === 'g') stampG(e._a, e._b, e.g);
        else if (e.t === 'v') stampV(e._a, e._b, e.v, e.g);
        else if (e.t === 'd') {
          if (e.on) stampV(e._a, e._b, e.vf, 1 / e.rs);
          else stampG(e._a, e._b, 1e-9);
        }
      }
      V = gauss(G, I, n);
      let changed = false;
      for (const d of diodes) {
        const vd = (d._a >= 0 ? V[d._a] : 0) - (d._b >= 0 ? V[d._b] : 0);
        if (!d.on && vd > d.vf + 1e-6) { d.on = true; changed = true; }
        else if (d.on && vd < d.vf - 1e-6) { d.on = false; changed = true; }
      }
      if (!changed) break;
    }
    const volt = new Float64Array(nNets);
    for (const [net, i] of used) volt[net] = V[i];
    const vOf = x => (x === undefined ? 0 : volt[x]);
    // courants des éléments
    for (const e of elements) {
      const vd = vOf(e.a) - vOf(e.b);
      if (e.t === 'g') e.i = vd * e.g;
      else if (e.t === 'v') e.i = (e.v - vd) * e.g;  // courant sortant par la borne +
      else if (e.t === 'd') e.i = e.on ? (vd - e.vf) / e.rs : 0;
    }
    return volt;
  }

  function gauss(A, b, n) {
    const x = new Float64Array(n);
    for (let c = 0; c < n; c++) {
      let piv = c, best = Math.abs(A[c * n + c]);
      for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > best) { best = v; piv = r; } }
      if (best < 1e-30) continue;
      if (piv !== c) {
        for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[piv * n + k]; A[piv * n + k] = t; }
        const t = b[c]; b[c] = b[piv]; b[piv] = t;
      }
      const d = A[c * n + c];
      for (let r = c + 1; r < n; r++) {
        const f = A[r * n + c] / d;
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
        b[r] -= f * b[c];
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
      const d = A[r * n + r];
      x[r] = Math.abs(d) < 1e-30 ? 0 : s / d;
    }
    return x;
  }

  /* ================================================================ simulateur */
  const LED_VF = { red: 1.8, green: 2.1, yellow: 2.0, blue: 3.0, white: 3.0, orange: 2.0 };
  const PIN_R = 25;          // résistance interne d'une broche de sortie
  const PULLUP_R = 35000;
  const PIN_MAX_MA = 40;
  const LED_MAX_MA = 30;

  function thermistorRaw(t) {
    const R = Math.exp(4275 * (1 / (t + 273.15) - 1 / 298.15));  // R/R0
    return 1023 / (R + 1);
  }

  class Simulator {
    constructor(circuit, opts) {
      this.c = circuit;
      this.o = opts || {};
      this.board = BOARDS[circuit.board];
      this.running = false;
      this.warnings = new Map();
      this.reset();
    }

    warn(key, msg, level) {
      if (!this.warnings.has(key)) {
        this.warnings.set(key, { msg, level: level || 'warn' });
        if (this.o.onWarn) this.o.onWarn(msg, level || 'warn', key);
      }
    }

    reset() {
      this.net = buildNetlist(this.c);
      this.pins = [];
      for (let i = 0; i < this.board.analogBase + this.board.analogCount; i++) {
        this.pins.push({ mode: 0, out: 0, pwm: null, servo: null, tone: null, toneEnd: null });
      }
      this.version = 0;
      this.cache = new Map();
      this.volt = null;
      this.elements = [];
      this.serialIn = [];
      this.timeUs = 0;
      this.vm = null;
      this.warnings.clear();
      this.trigPulse = {};
      for (const comp of this.c.comps) {
        comp.rt = { burned: false };
        const def = CATALOG.byType[comp.type];
        if (!def) continue;
        comp.def = def;
        comp.sim = Object.assign({}, def.sim || {}, comp.sim || {});
        const rt = comp.rt;
        if (def.kind === 'lcd') rt.lcd = { lines: [new Array(16).fill(' '), new Array(16).fill(' ')], col: 0, row: 0, rgb: [255, 255, 255] };
        if (def.kind === 'oled') rt.oled = { lines: Array.from({ length: 8 }, () => new Array(16).fill(' ')), col: 0, row: 0, px: null };
        if (def.kind === 'tm1637') rt.tm = { segs: [0, 0, 0, 0], colon: false, bright: 2, on: false };
        if (def.kind === 'ledbar') rt.level = 0;
        if (def.kind === 'chain') rt.leds = Array.from({ length: (comp.props && comp.props.count) || def.props.count || 1 }, () => [0, 0, 0]);
        if (def.kind === 'pixels') rt.pixels = Array.from({ length: (comp.props && comp.props.count) || def.props.count }, () => [0, 0, 0]);
        if (def.kind === 'motor') rt.speed = [0, 0];
        if (def.kind === 'mp3') rt.mp3 = { track: 0, volume: 20, playing: false };
        if (def.kind === 'rtc') rt.offset = 0;
      }
      this.solve();
    }

    /* -------------------------------------------------------- programme */
    load(bytes) {
      const mcu = this.board.mcu;
      const opts = mcu === 'atmega2560' ? { maxVars: 250, stackSize: 64, callDepth: 32 } : { maxVars: 110, stackSize: 40, callDepth: 16 };
      this.vm = new VMLib.VM(bytes, this.host(), opts);
    }

    host() {
      const sim = this;
      return {
        sys: (name, args, vm) => sim.sys(name, args, vm),
        print: (t, s) => sim.print(t, s),
        newline: t => sim.newline(t),
        error: m => { sim.warn('vm', m, 'error'); if (sim.o.onError) sim.o.onError(m); },
        loopTick: () => {}
      };
    }

    // avance la simulation de dtMs millisecondes (temps réel × vitesse)
    advance(dtMs) {
      if (!this.vm || this.vm.halted) return { late: false };
      const target = this.vm.timeUs + dtMs * 1000;
      this.vm.run(target, 400000);
      const late = this.vm.timeUs < target - 1000;
      if (late) this.vm.timeUs = target;   // évite d'accumuler du retard
      this.timeUs = this.vm.timeUs;
      this.updateTimers();
      this.solve();
      this.updateOutputs();
      return { late };
    }

    updateTimers() {
      for (const p of this.pins) if (p.toneEnd !== null && this.timeUs >= p.toneEnd) { p.tone = null; p.toneEnd = null; }
    }

    /* -------------------------------------------------------- broches */
    pinNet(n) { return this.net.boardNet(this.board.pinName(n)); }
    pin(n) {
      const p = this.pins[n];
      if (!p) { this.warn('pin' + n, `La broche ${n} n'existe pas sur la ${this.board.name}.`, 'error'); return { mode: 0, out: 0 }; }
      return p;
    }
    changed() { this.dirty = true; }

    readVoltage(n) {
      this.solve();
      return this.volt[this.pinNet(n)];
    }
    isFloating(n) {
      this.solve();
      return !this.drivenNets.has(this.pinNet(n));
    }

    sys(name, a, vm) {
      const sim = this;
      switch (name) {
        case 'pinMode': {
          const p = this.pin(a[0]);
          p.mode = a[1] === 1 ? 1 : a[1] === 2 ? 2 : 0;
          if (p.mode !== 1) { p.pwm = null; }
          this.changed();
          return;
        }
        case 'digitalWrite': {
          const p = this.pin(a[0]);
          const v = a[1] !== 0 ? 1 : 0;
          if (p.mode === 1) { p.out = v; p.pwm = null; }
          else p.mode = v ? 2 : 0;  // sur une entrée, HIGH active la résistance de rappel
          if (this.hcTrig(a[0], v)) vm.sleep(0);
          this.changed();
          return;
        }
        case 'digitalRead': {
          const n = a[0];
          if (this.board.analogOnly.includes(n)) {
            this.warn('aonly' + n, `${this.board.pinName(n)} est une entrée uniquement analogique sur la Nano : utilisez analogRead.`);
            return 0;
          }
          if (this.pin(n).mode !== 1 && this.isFloating(n)) {
            this.warn('float' + n, `L'entrée ${this.board.pinName(n)} n'est reliée à rien (entrée « flottante ») : sa valeur est imprévisible. Ajoutez une résistance de rappel ou utilisez INPUT_PULLUP.`);
            return Math.random() < 0.5 ? 0 : 1;
          }
          return this.readVoltage(n) >= 2.5 ? 1 : 0;
        }
        case 'analogRead': {
          const n = a[0];
          if (!this.board.isAnalog(n)) {
            this.warn('anal' + n, `analogRead : la broche ${this.board.pinName(n)} n'est pas une entrée analogique (A0…).`);
            return 0;
          }
          vm.sleep(100);
          if (this.isFloating(n)) return Math.floor(300 + Math.random() * 200);
          let v = Math.round(this.readVoltage(n) / 5 * 1023);
          const noise = this.noiseOn(n);
          if (noise) v += Math.round((Math.random() - 0.5) * noise * 1023);
          return Math.max(0, Math.min(1023, v));
        }
        case 'analogWrite': {
          const n = a[0];
          const p = this.pin(n);
          p.mode = 1;
          const v = Math.max(0, Math.min(255, Math.round(a[1])));
          if (!this.board.isPwm(n)) {
            this.warn('pwm' + n, `La broche ${this.board.pinName(n)} n'est pas une sortie PWM (~) : analogWrite donne seulement 0 ou 5 V. Broches PWM : ${this.board.pwm.join(', ')}.`);
            p.out = v >= 128 ? 1 : 0; p.pwm = null;
          } else if (v === 0) { p.out = 0; p.pwm = null; }
          else if (v === 255) { p.out = 1; p.pwm = null; }
          else { p.pwm = v / 255; }
          this.changed();
          return;
        }
        case 'delay': vm.sleep(Math.max(0, a[0]) * 1000); return;
        case 'delayMicroseconds': vm.sleep(Math.max(0, a[0])); return;
        case 'millis': return Math.floor(vm.timeUs / 1000);
        case 'micros': return Math.floor(vm.timeUs);
        case 'tone': case 'toneDur': {
          const p = this.pin(a[0]);
          p.mode = 1; p.tone = a[1] >= 31 ? a[1] : null;
          p.toneEnd = name === 'toneDur' && a[2] > 0 ? vm.timeUs + a[2] * 1000 : null;
          this.changed();
          return;
        }
        case 'noTone': { const p = this.pin(a[0]); p.tone = null; p.toneEnd = null; p.out = 0; this.changed(); return; }
        case 'pulseIn': return this.pulseIn(a[0], a[1], a[2], vm);
        case 'serialBegin': this.baud = a[0]; return;
        case 'serialAvailable': return this.serialIn.length;
        case 'serialRead': return this.serialIn.length ? this.serialIn.shift() : -1;
        case 'randomSeed': return;
        case 'servoWrite': {
          const p = this.pin(a[0]);
          p.mode = 1; p.out = 0; p.pwm = null;
          p.servo = Math.max(0, Math.min(180, a[1]));
          this.changed();
          return;
        }
        case 'ultrasonicCm': {
          const m = this.moduleOnPin('ultrasonic', a[0]);
          const d = m ? Math.round(m.sim.value) : 0;
          vm.sleep(m ? d * 58 + 200 : 30000);
          return d;
        }
        case 'dhtRead': {
          const m = this.moduleOnPin('dht', a[0]);
          vm.sleep(5000);
          if (!m) return 0;
          const v = a[2] === 0 ? m.sim.temp : m.sim.hum;
          return m.sim.dhtType === 11 ? Math.round(v) : Math.round(v * 10) / 10;
        }
        case 'lcdClear': this.lcds(l => { l.lines.forEach(r => r.fill(' ')); l.col = 0; l.row = 0; }); vm.sleep(2000); return;
        case 'lcdSetCursor': this.lcds(l => { l.col = Math.max(0, Math.floor(a[0])); l.row = Math.floor(a[1]) & 1; }); return;
        case 'lcdRGB': this.lcds((l, m) => { if (m.def.props.rgb) l.rgb = a.slice(0, 3).map(x => Math.max(0, Math.min(255, Math.round(x)))); }); return;
        case 'lcdBacklight': this.lcds((l, m) => { l.rgb = a[0] ? [255, 255, 255] : [0, 0, 0]; }); return;
        case 'oledClear': this.oleds(o => { o.lines.forEach(r => r.fill(' ')); o.col = 0; o.row = 0; o.px = null; }); vm.sleep(20000); return;
        case 'oledSetCursor': this.oleds(o => { o.col = Math.floor(a[0]) & 15; o.row = Math.floor(a[1]) & 7; }); return;
        case 'oledPixel': this.oleds(o => {
          if (!o.px) o.px = new Uint8Array(128 * 64);
          const x = Math.floor(a[0]), y = Math.floor(a[1]);
          if (x >= 0 && x < 128 && y >= 0 && y < 64) o.px[y * 128 + x] = a[2] ? 1 : 0;
        }); return;
        case 'tm1637Number': this.tms(a[0], t => { t.segs = tmNumber(Math.trunc(a[1])); t.on = true; }); vm.sleep(1500); return;
        case 'tm1637Clear': this.tms(a[0], t => { t.segs = [0, 0, 0, 0]; }); return;
        case 'tm1637Brightness': this.tms(a[0], t => { t.bright = Math.floor(a[1]) & 7; t.on = true; }); return;
        case 'tm1637Digits': this.tms(a[0], t => {
          t.segs = a.slice(1, 5).map(d => (d >= 0 && d <= 9 ? SEG[Math.floor(d)] : 0)); t.on = true;
        }); return;
        case 'tm1637Colon': this.tms(a[0], t => { t.colon = a[1] !== 0; t.on = true; }); return;
        case 'ledBarLevel': this.each('ledbar', a[0], m => { m.rt.level = Math.max(0, Math.min(10, a[1])); }); vm.sleep(500); return;
        case 'chainRGB': this.each('chain', a[0], m => {
          const i = Math.floor(a[1]);
          if (i >= 0 && i < m.rt.leds.length) m.rt.leds[i] = a.slice(2, 5).map(x => Math.max(0, Math.min(255, Math.round(x))));
        }); vm.sleep(3000); return;
        case 'pixelSet': this.each('pixels', a[0], m => {
          const i = Math.floor(a[1]);
          if (i >= 0 && i < m.rt.pixels.length) m.rt.pixels[i] = a.slice(2, 5).map(x => Math.max(0, Math.min(255, Math.round(x))));
        }); vm.sleep(1000); return;
        case 'pixelShow': return;
        case 'pixelFill': this.each('pixels', a[0], m => {
          const n = Math.min(m.rt.pixels.length, Math.floor(a[1]));
          for (let i = 0; i < n; i++) m.rt.pixels[i] = a.slice(2, 5).map(x => Math.max(0, Math.min(255, Math.round(x))));
        }); vm.sleep(1000); return;
        case 'accelRead': { const m = this.i2c('accel'); return m ? [m.sim.x, m.sim.y, m.sim.z][Math.floor(a[0])] || 0 : 0; }
        case 'gyroRead': { const m = this.i2c('accel'); return m ? [m.sim.gx || 0, m.sim.gy || 0, m.sim.gz || 0][Math.floor(a[0])] || 0 : 0; }
        case 'baroRead': {
          const m = this.i2c('baro');
          if (!m) return 0;
          const pa = m.sim.pressure * 100;
          switch (Math.floor(a[0])) {
            case 0: return m.sim.temp;
            case 1: return pa;
            case 2: return 44330 * (1 - Math.pow(pa / 101325, 0.1903));
            default: return m.sim.hum === null || m.sim.hum === undefined ? 0 : m.sim.hum;
          }
        }
        case 'thI2CRead': {
          const m = this.i2c('thi2c', x => x.sim.model === Math.floor(a[0])) || this.i2c('thi2c');
          vm.sleep(Math.floor(a[0]) === 0 ? 80000 : 16000);
          return m ? (a[1] === 0 ? m.sim.temp : m.sim.hum) : 0;
        }
        case 'rtcRead': {
          const m = this.i2c('rtc');
          if (!m) return 0;
          const d = new Date(Date.now() + m.rt.offset);
          return [d.getSeconds(), d.getMinutes(), d.getHours(), d.getDay() || 7, d.getDate(), d.getMonth() + 1, d.getFullYear()][Math.floor(a[0])] || 0;
        }
        case 'rtcSet': {
          const m = this.i2c('rtc');
          if (m) {
            const target = new Date(a[5], a[4] - 1, a[3], a[0], a[1], a[2]);
            m.rt.offset = target.getTime() - Date.now();
          }
          return;
        }
        case 'i2cWriteReg': return;
        case 'i2cReadReg': return 0;
        case 'lightI2CRead': case 'fingerHeartRead': case 'tofRead': {
          const m = this.i2c('i2cval', x => x.sim.sys === name);
          return m ? m.sim.value : 0;
        }
        case 'colorRead': {
          const m = this.i2c('color');
          if (!m) return 0;
          const k = Math.floor(a[0]);
          return k === 3 ? (m.sim.r + m.sim.g + m.sim.b) * 4 : [m.sim.r, m.sim.g, m.sim.b][k];
        }
        case 'irTempRead': { const m = this.i2c('irtemp'); return m ? (a[0] === 0 ? m.sim.obj : m.sim.amb) : 0; }
        case 'co2Read': { const m = this.i2c('co2'); return m ? [m.sim.co2, m.sim.temp, m.sim.hum][Math.floor(a[0])] || 0 : 0; }
        case 'gestureRead': {
          const m = this.i2c('gesture');
          if (!m) return 0;
          const g = m.rt.gesture || 0; m.rt.gesture = 0; return g;
        }
        case 'motorI2C': {
          const m = this.i2c('motor');
          if (m) m.rt.speed[Math.floor(a[0]) & 1] = Math.max(-255, Math.min(255, a[1]));
          return;
        }
        case 'stepperI2C': return;
        case 'encoderRead': { const m = this.moduleOnPin('encoder', a[0]); return m ? (m.rt.pos || 0) : 0; }
        case 'irRead': {
          const m = this.moduleOnPin('ir', a[0]);
          if (!m) return 0;
          const c = m.rt.code || 0; m.rt.code = 0; return c;
        }
        case 'mp3Play': this.uartModule('mp3', m => { m.rt.mp3.track = a[0]; m.rt.mp3.playing = true; }); return;
        case 'mp3Volume': this.uartModule('mp3', m => { m.rt.mp3.volume = a[0]; }); return;
        case 'mp3Stop': this.uartModule('mp3', m => { m.rt.mp3.playing = false; }); return;
        case 'rfidRead': {
          let id = 0;
          this.uartModule('rfid', m => { id = m.rt.card || 0; m.rt.card = 0; });
          return id;
        }
        case 'keypadRead': {
          let k = -1;
          this.uartModule('keypad', m => { if (m.rt.key !== undefined && m.rt.key !== null) { k = m.rt.key; m.rt.key = null; } });
          return k;
        }
      }
      return 0;
    }

    print(t, s) {
      if (t === S.TARGET.SERIAL) { if (this.o.onSerial) this.o.onSerial(s); this.txBlink = this.timeUs; return; }
      if (t === S.TARGET.LCD) {
        this.lcds(l => {
          for (const ch of s) {
            if (l.col < 16) l.lines[l.row][l.col] = ch;
            l.col++;
          }
        });
      } else if (t === S.TARGET.OLED) {
        this.oleds(o => {
          for (const ch of s) {
            if (o.col > 15) { o.col = 0; o.row = (o.row + 1) & 7; }
            o.lines[o.row][o.col] = ch;
            o.col++;
          }
        });
      }
    }
    newline(t) {
      if (t === S.TARGET.SERIAL) { if (this.o.onSerial) this.o.onSerial('\r\n'); return; }
      if (t === S.TARGET.LCD) this.lcds(l => { l.col = 0; l.row = (l.row + 1) & 1; });
      else if (t === S.TARGET.OLED) this.oleds(o => { o.col = 0; o.row = (o.row + 1) & 7; });
    }

    /* -------------------------------------------------------- recherche des modules branchés */
    powered(comp) {
      const v = this.volt;
      if (!v) return 0;
      const vcc = this.net.pin(comp.id, 'VCC'), gnd = this.net.pin(comp.id, 'GND');
      if (vcc === undefined || gnd === undefined) return 0;
      const u = v[vcc] - v[gnd];
      return u > 2.7 ? u : 0;
    }
    modules(kind) { return this.c.comps.filter(c => c.def && c.def.kind === kind); }
    moduleOnPin(kind, pinNum, sig) {
      const net = this.pinNet(pinNum);
      for (const m of this.modules(kind)) {
        if (this.net.pin(m.id, sig || 'SIG1') === net) {
          if (this.powered(m)) return m;
          this.warn('pow' + m.id, `Le module « ${m.def.name} » n'est pas alimenté (VCC / GND).`);
        }
      }
      return null;
    }
    each(kind, pinNum, fn) {
      const net = this.pinNet(pinNum);
      for (const m of this.modules(kind)) {
        if (this.net.pin(m.id, 'SIG1') === net && this.powered(m)) fn(m);
      }
    }
    i2cConnected(m) {
      const sda = this.net.boardNet(this.board.i2c.sda), scl = this.net.boardNet(this.board.i2c.scl);
      return this.net.pin(m.id, 'SIG1') === scl && this.net.pin(m.id, 'SIG2') === sda;
    }
    i2c(kind, filter) {
      for (const m of this.modules(kind)) {
        if (filter && !filter(m)) continue;
        if (!this.i2cConnected(m)) {
          this.warn('i2c' + m.id, `Le module « ${m.def.name} » utilise le bus I2C : branchez-le sur un port I2C.`);
          continue;
        }
        if (!this.powered(m)) { this.warn('pow' + m.id, `Le module « ${m.def.name} » n'est pas alimenté.`); continue; }
        return m;
      }
      return null;
    }
    lcds(fn) { for (const m of this.modules('lcd')) if (this.i2cConnected(m) && this.powered(m)) fn(m.rt.lcd, m); }
    oleds(fn) { for (const m of this.modules('oled')) if (this.i2cConnected(m) && this.powered(m)) fn(m.rt.oled, m); }
    tms(pin, fn) { this.each('tm1637', pin, m => fn(m.rt.tm)); }
    uartModule(kind, fn) {
      for (const m of this.modules(kind)) if (this.powered(m)) fn(m);
    }
    noiseOn(pinNum) {
      const net = this.pinNet(pinNum);
      for (const m of this.modules('ain')) if (m.sim.noise && this.net.pin(m.id, 'SIG1') === net) return m.sim.noise;
      return 0;
    }

    // HC-SR04 : on mémorise l'impulsion sur Trig pour répondre au pulseIn suivant sur Echo
    hcTrig(pinNum, v) {
      const net = this.pinNet(pinNum);
      for (const m of this.modules('hcsr04')) {
        if (this.net.pin(m.id, 'TRIG') === net) {
          if (v) this.trigPulse[m.id] = this.vm ? this.vm.timeUs : 0;
          else if (this.trigPulse[m.id] !== undefined) this.trigPulse[m.id] = -1;  // impulsion terminée
        }
      }
      return false;
    }
    pulseIn(pinNum, level, timeout, vm) {
      timeout = timeout > 0 ? timeout : 1000000;
      const net = this.pinNet(pinNum);
      for (const m of this.modules('hcsr04')) {
        if (this.net.pin(m.id, 'ECHO') === net && this.powered(m) && level !== 0 && this.trigPulse[m.id] === -1) {
          delete this.trigPulse[m.id];
          const us = Math.round(m.sim.value * 58);
          if (us > timeout) { vm.sleep(timeout); return 0; }
          vm.sleep(us + 450);
          return us;
        }
      }
      for (const m of this.modules('ultrasonic')) {
        if (this.net.pin(m.id, 'SIG1') === net && this.powered(m) && level !== 0) {
          const us = Math.round(m.sim.value * 58);
          vm.sleep(us + 450);
          return us;
        }
      }
      vm.sleep(timeout);
      return 0;
    }

    /* -------------------------------------------------------- circuit électrique */
    stateKey() {
      let k = this.version + '|';
      for (let i = 0; i < this.pins.length; i++) {
        const p = this.pins[i];
        if (p.mode || p.out || p.pwm) k += i + ':' + p.mode + p.out + (p.pwm === null ? '' : p.pwm.toFixed(3)) + ',';
      }
      return k;
    }

    buildElements() {
      const E = [];
      const N = this.net;
      const gnd = N.ground;
      const driven = new Set();
      const board = this.board;
      const add = (e, drives) => { E.push(e); if (drives !== false) { driven.add(e.a); driven.add(e.b); } };
      add({ t: 'v', a: N.boardNet('5V'), b: gnd, v: 5, g: 1 / 0.05, src: '5V' });
      add({ t: 'v', a: N.boardNet('3V3'), b: gnd, v: 3.3, g: 1 / 0.5, src: '3V3' });
      // broches de la carte
      for (let i = 0; i < this.pins.length; i++) {
        const p = this.pins[i];
        const net = this.pinNet(i);
        if (net === undefined) continue;
        if (p.mode === 1) {
          let v = p.out ? 5 : 0;
          if (p.pwm !== null) v = 5 * p.pwm;
          if (p.tone) v = 2.5;
          add({ t: 'v', a: net, b: gnd, v, g: 1 / PIN_R, pin: i });
        } else if (p.mode === 2) {
          add({ t: 'v', a: net, b: gnd, v: 5, g: 1 / PULLUP_R, pin: i, pullup: true });
        } else {
          E.push({ t: 'g', a: net, b: gnd, g: 1e-8 });
        }
      }
      // LED « L » de la carte (broche 13) : charge négligeable
      for (const comp of this.c.comps) {
        const def = comp.def;
        if (!def) continue;
        const P = id => N.pin(comp.id, id);
        const sim = comp.sim || {};
        const props = Object.assign({}, def.props || {}, comp.props || {});
        switch (def.kind) {
          case 'resistor': add({ t: 'g', a: P('1'), b: P('2'), g: 1 / Math.max(0.1, +props.ohms || 220), comp }); break;
          case 'led':
            if (!comp.rt.burned) add({ t: 'd', a: P('A'), b: P('K'), vf: LED_VF[props.color] || 2, rs: 12, comp, led: 0 });
            break;
          case 'rgbled':
            if (!comp.rt.burned) {
              add({ t: 'd', a: P('R'), b: P('K'), vf: 1.9, rs: 12, comp, led: 0 });
              add({ t: 'd', a: P('G'), b: P('K'), vf: 2.8, rs: 12, comp, led: 1 });
              add({ t: 'd', a: P('B'), b: P('K'), vf: 2.9, rs: 12, comp, led: 2 });
            }
            break;
          case 'button':
            if (comp.rt.pressed) add({ t: 'g', a: P('1a'), b: P('2a'), g: 1 / 0.05, comp });
            break;
          case 'switch':
            add({ t: 'g', a: P('C'), b: P(sim.right ? '2' : '1'), g: 1 / 0.05, comp });
            break;
          case 'pot': {
            const R = +props.ohms || 10000, f = Math.max(0, Math.min(100, sim.value)) / 100;
            add({ t: 'g', a: P('1'), b: P('W'), g: 1 / Math.max(1, R * f), comp });
            add({ t: 'g', a: P('W'), b: P('2'), g: 1 / Math.max(1, R * (1 - f)), comp });
            break;
          }
          case 'ldr': {
            const f = Math.max(0, Math.min(100, sim.value)) / 100;
            add({ t: 'g', a: P('1'), b: P('2'), g: 1 / (1e6 * Math.pow(10, -3 * f)), comp });
            break;
          }
          case 'ntc': {
            const R = 10000 * Math.exp(3950 * (1 / (sim.value + 273.15) - 1 / 298.15));
            add({ t: 'g', a: P('1'), b: P('2'), g: 1 / R, comp });
            break;
          }
          case 'piezo': add({ t: 'g', a: P('+'), b: P('-'), g: 1 / 1e5, comp }); break;
          case 'dcmotor': add({ t: 'g', a: P('1'), b: P('2'), g: 1 / 50, comp, motor: true }); break;
          case 'servo': add({ t: 'g', a: P('VCC'), b: P('GND'), g: 1 / 1000, comp }); E.push({ t: 'g', a: P('SIG'), b: P('GND'), g: 1e-6 }); break;
          case 'hcsr04':
            add({ t: 'g', a: P('VCC'), b: P('GND'), g: 1 / 2000, comp });
            E.push({ t: 'g', a: P('TRIG'), b: P('GND'), g: 1e-6 });
            if (this.powered(comp)) add({ t: 'v', a: P('ECHO'), b: P('GND'), v: 0, g: 1 / 100, comp });
            break;
          case 'breadboard': break;
          default: this.groveElements(comp, def, P, add, E);
        }
      }
      return { E, driven };
    }

    groveElements(comp, def, P, add, E) {
      if (P('VCC') === undefined) return;
      add({ t: 'g', a: P('VCC'), b: P('GND'), g: 1 / 20000, comp }, false);
      const vcc = this.powered(comp);
      const sim = comp.sim || {};
      switch (def.kind) {
        case 'din': {
          if (!vcc) return;
          let active = !!comp.rt.active;
          if (sim.mode === 'pulse') {
            const period = 60e6 / (sim.bpm || 72);
            active = comp.rt.active !== false && (this.timeUs % period) < 100000;
          }
          const level = active ? sim.active : 1 - sim.active;
          add({ t: 'v', a: P('SIG1'), b: P('GND'), v: level * vcc, g: 1 / 100, comp });
          if (def.blocks.includes('dout2')) E.push({ t: 'g', a: P('SIG2'), b: P('GND'), g: 1e-5 });
          return;
        }
        case 'ain': {
          if (!vcc) return;
          add({ t: 'v', a: P('SIG1'), b: P('GND'), v: this.ainRaw(comp) / 1023 * vcc, g: 1 / 1000, comp });
          return;
        }
        case 'joystick': {
          if (!vcc) return;
          const x = comp.rt.pressed ? 1023 : sim.x;
          add({ t: 'v', a: P('SIG1'), b: P('GND'), v: x / 1023 * vcc, g: 1 / 1000, comp });
          add({ t: 'v', a: P('SIG2'), b: P('GND'), v: sim.y / 1023 * vcc, g: 1 / 1000, comp });
          return;
        }
        default:
          E.push({ t: 'g', a: P('SIG1'), b: P('GND'), g: 1e-5 });
          E.push({ t: 'g', a: P('SIG2'), b: P('GND'), g: 1e-6 });
      }
    }

    ainRaw(comp) {
      const s = comp.sim;
      const f = (s.value - s.min) / ((s.max - s.min) || 1);
      if (s.conv === 'thermistor') return thermistorRaw(s.value);
      if (s.conv === 'sharp') return Math.min(1023, 1023 * (27 / Math.max(10, s.value)) / 3.1 * 1.0);
      let raw = Math.max(0, Math.min(1, s.invert ? 1 - f : f)) * (s.maxRaw || 1023);
      return Math.max(0, Math.min(1023, raw));
    }

    solve(force) {
      const key = this.stateKey();
      if (!force && !this.dirty && this.volt && this.lastKey === key) return;
      this.dirty = false;
      this.lastKey = key;
      const cached = this.cache.get(key);
      if (cached && !force) {
        this.volt = cached.volt; this.elements = cached.E; this.drivenNets = cached.driven;
        return;
      }
      // deux passes : l'alimentation des modules dépend de la solution précédente
      for (let pass = 0; pass < 3; pass++) {
        const { E, driven } = this.buildElements();
        const volt = solveElements(this.net.count, this.net.ground, E);
        const prev = this.volt;
        this.volt = volt; this.elements = E; this.drivenNets = driven;
        if (prev && prev.length === volt.length) {
          let same = true;
          for (let i = 0; i < volt.length; i++) if (Math.abs(prev[i] - volt[i]) > 0.05) { same = false; break; }
          if (same) break;
        }
      }
      this.diagnose();
      if (this.cache.size > 200) this.cache.clear();
      this.cache.set(key, { volt: this.volt, E: this.elements, driven: this.drivenNets });
    }

    diagnose() {
      for (const e of this.elements) {
        if (e.src === '5V' && e.i > 0.5) {
          this.warn('short5V', 'Court-circuit ! Le 5 V est relié directement à GND (courant ' + e.i.toFixed(1) + ' A). Vérifiez vos fils.', 'error');
          this.shorted = true;
        }
        if (e.pin !== undefined && !e.pullup && Math.abs(e.i) * 1000 > PIN_MAX_MA) {
          this.warn('over' + e.pin, `Courant trop fort sur la broche ${this.board.pinName(e.pin)} (${Math.round(Math.abs(e.i) * 1000)} mA, maximum ${PIN_MAX_MA} mA) : la broche risque d'être détruite. Ajoutez une résistance ou un transistor.`, 'error');
        }
        if (e.t === 'd' && e.comp && e.i * 1000 > LED_MAX_MA && !e.comp.rt.burned) {
          e.comp.rt.burned = true;
          this.warn('burn' + e.comp.id, `La LED a grillé (${Math.round(e.i * 1000)} mA) ! Il faut une résistance en série (220 Ω par exemple).`, 'error');
          this.version++;
          this.cache.clear();
        }
      }
    }

    /* -------------------------------------------------------- état visuel des sorties */
    updateOutputs() {
      const v = this.volt;
      if (!v) return;
      const N = this.net;
      const ledCur = new Map();
      for (const e of this.elements) {
        if (e.t === 'd' && e.comp) {
          const arr = ledCur.get(e.comp) || [0, 0, 0];
          arr[e.led] = Math.max(0, e.i);
          ledCur.set(e.comp, arr);
        }
        if (e.motor) e.comp.rt.motor = e.i;
      }
      this.sounds = [];
      for (const comp of this.c.comps) {
        const def = comp.def;
        if (!def) continue;
        const rt = comp.rt;
        const P = id => N.pin(comp.id, id);
        switch (def.kind) {
          case 'led': case 'rgbled': {
            const c = ledCur.get(comp) || [0, 0, 0];
            rt.bright = c.map(i => Math.min(1, i / 0.015));
            break;
          }
          case 'dout': case 'pwm': case 'buzzer': {
            const pw = this.powered(comp);
            const u = pw ? (v[P('SIG1')] - v[P('GND')]) : 0;
            rt.on = u > 2.5;
            rt.bright = pw ? Math.max(0, Math.min(1, u / pw)) : 0;
            if (def.kind === 'buzzer' && pw) {
              const drv = this.drivingPin(P('SIG1'));
              const f = drv !== null && this.pins[drv].tone ? this.pins[drv].tone : (rt.on && def.type === 'grove_buzzer' ? 2000 : 0);
              rt.freq = f;
              if (f) this.sounds.push({ id: comp.id, freq: f });
            }
            break;
          }
          case 'din': if (def.blocks.includes('dout2')) rt.led = this.powered(comp) && v[P('SIG2')] - v[P('GND')] > 2.5; break;
          case 'piezo': {
            const a = this.drivingPin(P('+')), b = this.drivingPin(P('-'));
            const pinNum = a !== null ? a : b;
            rt.freq = pinNum !== null && this.pins[pinNum].tone ? this.pins[pinNum].tone : 0;
            if (rt.freq) this.sounds.push({ id: comp.id, freq: rt.freq });
            break;
          }
          case 'servo': {
            const sig = def.draw === 'servo' ? 'SIG' : 'SIG1';
            const drv = this.drivingPin(P(sig));
            const pw = this.powered(comp);
            if (drv !== null && this.pins[drv].servo !== null && pw) rt.angle = this.pins[drv].servo;
            break;
          }
        }
      }
      // LED de la carte
      const d13 = v[N.boardNet('D13')];
      this.boardLed = d13 > 2.5 ? Math.min(1, d13 / 5) : 0;
      this.txLed = this.txBlink !== undefined && this.timeUs - this.txBlink < 50000;
    }

    drivingPin(net) {
      if (net === undefined) return null;
      for (let i = 0; i < this.pins.length; i++) {
        if (this.pins[i].mode === 1 && this.pinNet(i) === net) return i;
      }
      return null;
    }

    // interaction de l'utilisateur pendant la simulation
    interact() { this.version++; this.changed(); }
    sendSerial(text) { for (const ch of text) this.serialIn.push(ch.charCodeAt(0) & 0xFF); }
  }

  const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
  function tmNumber(n) {
    n = Math.max(-999, Math.min(9999, n));
    const neg = n < 0;
    if (neg) n = -n;
    const s = [0, 0, 0, 0];
    for (let i = 3; i >= 0; i--) {
      if (n === 0 && i < 3) s[i] = 0;
      else { s[i] = SEG[n % 10]; n = Math.floor(n / 10); }
    }
    if (neg) for (let i = 3; i >= 0; i--) if (s[i] === 0) { s[i] = 0x40; break; }
    return s;
  }

  const API = { Simulator, buildNetlist, solveElements, tmNumber, SEG, thermistorRaw };
  if (isNode) module.exports = API;
  else root.SimLib = API;
})(this);
