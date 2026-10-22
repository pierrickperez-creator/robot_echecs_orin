/*
 * Machine virtuelle du simulateur : exécute le même bytecode que le micrologiciel de la carte.
 * Le temps est virtuel (en microsecondes) : chaque instruction coûte INSTR_US, delay() avance l'horloge.
 *
 * host doit fournir :
 *   sys(name, args, vm)  -> nombre | undefined  (peut appeler vm.sleep(µs) pour les attentes)
 *   print(target, text)  ;  newline(target)
 *   error(message)
 */
(function (root) {
  const S = (typeof module !== 'undefined' && module.exports) ? require('./vm_spec.js') : root.VMSPEC;
  const OP = S.OP;
  const f32 = Math.fround;
  const INSTR_US = 6;

  function roundAway(x) { return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5); }

  function formatNumber(v, dec) {
    if (Number.isNaN(v)) return 'nan';
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
    if (dec === 0) return String(roundAway(v));
    // Print::printFloat d'Arduino : arrondi à dec décimales
    return (roundAway(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
  }

  class VM {
    constructor(bytes, host, opts) {
      this.p = bytes;
      this.host = host;
      opts = opts || {};
      this.maxVars = opts.maxVars || 250;
      this.stackSize = opts.stackSize || 64;
      this.callDepth = opts.callDepth || 32;
      if (bytes[0] !== 86 || bytes[1] !== 77 || bytes[2] !== S.VERSION) throw new Error('Programme invalide');
      this.nvars = bytes[3];
      if (this.nvars > this.maxVars) throw new Error('Trop de variables pour cette carte');
      this.setupAddr = this.u16(4);
      this.loopAddr = this.u16(6);
      this.len = this.u16(8);
      this.vars = new Float32Array(Math.max(1, this.maxVars));
      this.stack = [];
      this.calls = [];
      this.timeUs = 0;
      this.wakeAt = 0;
      this.phase = 'setup';
      this.pc = this.setupAddr;
      this.halted = false;
      this.instrCount = 0;
      this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    u16(a) { return this.p[a] | (this.p[a + 1] << 8); }
    push(v) {
      if (this.stack.length >= this.stackSize) this.fail(1, 'pile pleine (expression trop complexe ou appels imbriqués)');
      this.stack.push(f32(v));
    }
    pop() {
      if (!this.stack.length) this.fail(2, 'pile vide');
      return this.stack.pop();
    }
    fail(code, msg) {
      this.halted = true;
      const m = `Erreur VM ${code} à l'adresse ${this.pc} : ${msg}`;
      this.host.error(m);
      throw new VMHalt(m);
    }
    sleep(us) { if (us > 0) this.wakeAt = Math.max(this.wakeAt, this.timeUs) + us; }
    millis() { return Math.floor(this.timeUs / 1000); }

    math(fn) {
      const pop = () => this.pop();
      let a, b, c, d, e;
      switch (S.MATHFN[fn] && S.MATHFN[fn][0]) {
        case 'abs': return Math.abs(pop());
        case 'sqrt': return Math.sqrt(pop());
        case 'sin': return Math.sin(pop());
        case 'cos': return Math.cos(pop());
        case 'tan': return Math.tan(pop());
        case 'asin': return Math.asin(pop());
        case 'acos': return Math.acos(pop());
        case 'atan': return Math.atan(pop());
        case 'ln': return Math.log(pop());
        case 'log10': return Math.log10(pop());
        case 'exp': return Math.exp(pop());
        case 'round': return roundAway(pop());
        case 'floor': return Math.floor(pop());
        case 'ceil': return Math.ceil(pop());
        case 'min': b = pop(); a = pop(); return Math.min(a, b);
        case 'max': b = pop(); a = pop(); return Math.max(a, b);
        case 'pow': b = pop(); a = pop(); return Math.pow(a, b);
        case 'atan2': b = pop(); a = pop(); return Math.atan2(a, b);
        case 'constrain': c = pop(); b = pop(); a = pop(); return a < b ? b : (a > c ? c : a);
        case 'map': {
          e = Math.trunc(pop()); d = Math.trunc(pop()); c = Math.trunc(pop()); b = Math.trunc(pop()); a = Math.trunc(pop());
          if (c === b) return d;
          return Math.trunc((a - b) * (e - d) / (c - b)) + d;
        }
        case 'random': {
          b = Math.trunc(pop()); a = Math.trunc(pop());
          if (b <= a) return a;
          return a + Math.floor(Math.random() * (b - a));
        }
      }
      this.fail(3, 'fonction mathématique inconnue');
    }

    /* Exécute jusqu'à l'instant untilUs (temps virtuel) ou maxInstr instructions. */
    run(untilUs, maxInstr) {
      if (this.halted) return;
      maxInstr = maxInstr || 200000;
      let n = 0;
      try {
        while (!this.halted && n < maxInstr) {
          if (this.wakeAt > this.timeUs) {
            if (this.wakeAt > untilUs) { this.timeUs = Math.max(this.timeUs, untilUs); return; }
            this.timeUs = this.wakeAt;
          }
          if (this.timeUs >= untilUs) return;
          this.step();
          n++;
        }
      } catch (e) {
        if (!(e instanceof VMHalt)) {
          this.halted = true;
          this.host.error('Erreur interne du simulateur : ' + e.message);
          if (typeof console !== 'undefined') console.error(e);
        }
      }
    }

    step() {
      const p = this.p;
      if (this.pc >= this.len) this.fail(4, 'adresse hors programme');
      const op = p[this.pc++];
      this.timeUs += INSTR_US;
      this.instrCount++;
      let a, b;
      switch (op) {
        case OP.HALT: this.halted = true; return;
        case OP.PUSHF: this.push(this.dv.getFloat32(this.pc, true)); this.pc += 4; return;
        case OP.PUSHB: this.push((p[this.pc] << 24) >> 24); this.pc++; return;
        case OP.PUSHW: this.push((this.u16(this.pc) << 16) >> 16); this.pc += 2; return;
        case OP.LOAD: this.push(this.vars[p[this.pc++]]); return;
        case OP.STORE: this.vars[p[this.pc++]] = this.pop(); return;
        case OP.POP: this.pop(); return;
        case OP.DUP: a = this.pop(); this.push(a); this.push(a); return;
        case OP.ADD: b = this.pop(); a = this.pop(); this.push(a + b); return;
        case OP.SUB: b = this.pop(); a = this.pop(); this.push(a - b); return;
        case OP.MUL: b = this.pop(); a = this.pop(); this.push(a * b); return;
        case OP.DIV: b = this.pop(); a = this.pop(); this.push(a / b); return;
        case OP.MOD: b = this.pop(); a = this.pop(); this.push(a % b); return;
        case OP.NEG: this.push(-this.pop()); return;
        case OP.TRUNC: this.push(Math.trunc(this.pop())); return;
        case OP.EQ: b = this.pop(); a = this.pop(); this.push(a === b ? 1 : 0); return;
        case OP.NE: b = this.pop(); a = this.pop(); this.push(a !== b ? 1 : 0); return;
        case OP.LT: b = this.pop(); a = this.pop(); this.push(a < b ? 1 : 0); return;
        case OP.LE: b = this.pop(); a = this.pop(); this.push(a <= b ? 1 : 0); return;
        case OP.GT: b = this.pop(); a = this.pop(); this.push(a > b ? 1 : 0); return;
        case OP.GE: b = this.pop(); a = this.pop(); this.push(a >= b ? 1 : 0); return;
        case OP.AND: b = this.pop(); a = this.pop(); this.push(a !== 0 && b !== 0 ? 1 : 0); return;
        case OP.OR: b = this.pop(); a = this.pop(); this.push(a !== 0 || b !== 0 ? 1 : 0); return;
        case OP.NOT: this.push(this.pop() === 0 ? 1 : 0); return;
        case OP.JMP: this.pc = this.u16(this.pc); return;
        case OP.JZ: if (this.pop() === 0) this.pc = this.u16(this.pc); else this.pc += 2; return;
        case OP.JNZ: if (this.pop() !== 0) this.pc = this.u16(this.pc); else this.pc += 2; return;
        case OP.CALL:
          if (this.calls.length >= this.callDepth) this.fail(6, 'trop d\'appels de fonctions imbriqués');
          this.calls.push(this.pc + 2);
          this.pc = this.u16(this.pc);
          return;
        case OP.RET:
          if (!this.calls.length) { this.endOfBlock(); return; }
          this.pc = this.calls.pop();
          return;
        case OP.RETV:
          if (!this.calls.length) { this.pop(); this.endOfBlock(); return; }
          this.pc = this.calls.pop();
          return;
        case OP.MATH: this.push(this.math(p[this.pc++])); return;
        case OP.SYS: {
          const id = p[this.pc++];
          const def = S.SYS[id];
          if (!def) this.fail(7, 'appel système inconnu');
          const args = new Array(def[1]);
          for (let i = def[1] - 1; i >= 0; i--) args[i] = this.pop();
          const r = this.host.sys(def[0], args, this);
          if (def[2]) this.push(r === undefined || r === null ? 0 : (typeof r === 'boolean' ? (r ? 1 : 0) : r));
          return;
        }
        case OP.PRINTN: {
          const t = p[this.pc], dec = p[this.pc + 1];
          this.pc += 2;
          this.host.print(t, formatNumber(this.pop(), dec));
          return;
        }
        case OP.PRINTS: {
          const t = p[this.pc], len = p[this.pc + 1];
          this.pc += 2;
          let s = '';
          for (let i = 0; i < len; i++) s += String.fromCharCode(p[this.pc + i]);
          this.pc += len;
          this.host.print(t, s);
          return;
        }
        case OP.PRINTNL: this.host.newline(p[this.pc++]); return;
      }
      this.pc--;
      this.fail(8, 'instruction inconnue 0x' + op.toString(16));
    }

    endOfBlock() {
      // fin de « au démarrage » ou d'un tour de « répéter indéfiniment »
      this.phase = 'loop';
      this.stack.length = 0;
      this.pc = this.loopAddr;
      if (this.host.loopTick) this.host.loopTick(this);
    }
  }

  class VMHalt extends Error {}

  const API = { VM, VMHalt, formatNumber, INSTR_US };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.VMLib = API;
})(this);
