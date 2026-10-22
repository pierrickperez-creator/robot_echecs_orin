/*
 * Compilateur : représentation intermédiaire (IR) -> bytecode de la VM.
 *
 * IR d'un programme :
 *   { board: 'uno'|'nano'|'mega', setup: [instr], loop: [instr],
 *     procs: [{ name, params: [noms], body: [instr], ret: expr|null }] }
 *
 * Expressions : num, bool, var, pin, bin, neg, not, math, sys, call, str (uniquement dans print)
 * Instructions : set, change, if, while, repeat, for, break, continue, sys, call, return, print, waitUntil
 *
 * Le module expose aussi l'inférence de types (bool / int / float) utilisée par la génération C++.
 */
(function (root) {
  const S = (typeof module !== 'undefined' && module.exports) ? require('./vm_spec.js') : root.VMSPEC;
  const B = (typeof module !== 'undefined' && module.exports) ? require('./boards.js') : root.BOARDS;
  const OP = S.OP;

  class CompileError extends Error {
    constructor(msg, blockId) { super(msg); this.blockId = blockId; }
  }

  /* ---------------------------------------------------------------- utilitaires IR */
  function walkStmts(list, fn) {
    for (const s of list || []) {
      fn(s);
      if (s.k === 'if') { s.branches.forEach(b => walkStmts(b.body, fn)); walkStmts(s.else, fn); }
      if (s.body) walkStmts(s.body, fn);
    }
  }
  function walkExpr(e, fn) {
    if (!e || typeof e !== 'object') return;
    fn(e);
    if (e.a) walkExpr(e.a, fn);
    if (e.b) walkExpr(e.b, fn);
    if (e.args) e.args.forEach(x => walkExpr(x, fn));
  }
  function stmtExprs(s) {
    const r = [];
    if (s.e) r.push(s.e);
    if (s.cond) r.push(s.cond);
    if (s.n) r.push(s.n);
    if (s.from) r.push(s.from);
    if (s.to) r.push(s.to);
    if (s.by) r.push(s.by);
    if (s.args) r.push(...s.args);
    if (s.parts) r.push(...s.parts);
    if (s.k === 'if') s.branches.forEach(b => r.push(b.cond));
    return r;
  }
  function allStmtLists(prog) {
    const lists = [prog.setup, prog.loop];
    for (const p of prog.procs || []) lists.push(p.body);
    return lists;
  }

  /* ---------------------------------------------------------------- inférence de types */
  const SYS_TYPES = {
    digitalRead: 'int', analogRead: 'int', millis: 'int', micros: 'int', pulseIn: 'int',
    serialAvailable: 'int', serialRead: 'int', ultrasonicCm: 'int', dhtRead: 'float',
    accelRead: 'float', baroRead: 'float', thI2CRead: 'float', rtcRead: 'int', i2cReadReg: 'int',
    lightI2CRead: 'float', colorRead: 'int', tofRead: 'int', gyroRead: 'float', encoderRead: 'int',
    irRead: 'int', gestureRead: 'int', fingerHeartRead: 'int', co2Read: 'float', irTempRead: 'float',
    rfidRead: 'int', keypadRead: 'int'
  };
  const MATH_TYPES = {
    sqrt: 'float', sin: 'float', cos: 'float', tan: 'float', asin: 'float', acos: 'float', atan: 'float',
    ln: 'float', log10: 'float', exp: 'float', pow: 'float', atan2: 'float',
    round: 'int', floor: 'int', ceil: 'int', map: 'int', random: 'int'
  };
  const rank = { bool: 0, int: 1, float: 2 };
  const join = (a, b) => (rank[a] >= rank[b] ? a : b);

  function inferTypes(prog) {
    const vars = {};     // nom -> type
    const params = {};   // 'proc:param' -> type
    const rets = {};     // proc -> type
    const procs = {};
    for (const p of prog.procs || []) procs[p.name] = p;

    let ctxProc = null;
    const varKey = name => (ctxProc && ctxProc.params.includes(name) ? ctxProc.name + ':' + name : name);
    const getVar = name => {
      const k = varKey(name);
      return (k.includes(':') ? params[k] : vars[k]) || 'int';
    };
    let changed = true;
    const setVar = (name, t) => {
      const k = varKey(name);
      const tab = k.includes(':') ? params : vars;
      const old = tab[k];
      const nt = old ? join(old, t) : t;
      if (nt !== old) { tab[k] = nt; changed = true; }
    };
    function typeOf(e) {
      switch (e.k) {
        case 'num': return Number.isInteger(e.v) ? 'int' : 'float';
        case 'bool': return 'bool';
        case 'var': return getVar(e.name);
        case 'pin': return 'int';
        case 'str': return 'str';
        case 'neg': return typeOf(e.a) === 'float' ? 'float' : 'int';
        case 'not': return 'bool';
        case 'bin':
          if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op)) { typeOf(e.a); typeOf(e.b); return 'bool'; }
          if (e.op === '/') { typeOf(e.a); typeOf(e.b); return 'float'; }
          {
            const t = join(typeOf(e.a), typeOf(e.b));
            return t === 'bool' ? 'int' : t;
          }
        case 'math': {
          const ts = e.args.map(typeOf);
          if (MATH_TYPES[e.fn]) return MATH_TYPES[e.fn];
          const t = ts.reduce(join, 'int');
          return t === 'bool' ? 'int' : t;
        }
        case 'sys': e.args.forEach(typeOf); return SYS_TYPES[e.fn] || 'int';
        case 'call': {
          const p = procs[e.name];
          e.args.forEach((a, i) => {
            const t = typeOf(a);
            if (p && p.params[i] !== undefined) {
              const save = ctxProc; ctxProc = p; setVar(p.params[i], t === 'str' ? 'int' : t); ctxProc = save;
            }
          });
          return rets[e.name] || 'int';
        }
      }
      return 'int';
    }
    function visit(list) {
      walkStmts(list, s => {
        if (s.k === 'set') setVar(s.name, typeOf(s.e) === 'str' ? 'int' : typeOf(s.e));
        else if (s.k === 'change') setVar(s.name, join(getVar(s.name), typeOf(s.e)));
        else if (s.k === 'for') {
          setVar(s.name, [s.from, s.to, s.by].map(typeOf).reduce(join, 'int'));
        } else if (s.k === 'return' && s.e && ctxProc) {
          const t = typeOf(s.e);
          const old = rets[ctxProc.name];
          const nt = old ? join(old, t) : t;
          if (nt !== old) { rets[ctxProc.name] = nt; changed = true; }
        }
        if (s.k === 'call' && procs[s.name]) typeOf({ k: 'call', name: s.name, args: s.args });
        else stmtExprs(s).forEach(typeOf);
      });
    }
    let guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      ctxProc = null;
      visit(prog.setup); visit(prog.loop);
      for (const p of prog.procs || []) {
        ctxProc = p;
        visit(p.body);
        if (p.ret) {
          const t = typeOf(p.ret);
          const old = rets[p.name];
          const nt = old ? join(old, t) : t;
          if (nt !== old) { rets[p.name] = nt; changed = true; }
        }
      }
      ctxProc = null;
    }
    return {
      vars, params, rets,
      typeOf(e, proc) { const save = ctxProc; ctxProc = proc || null; const t = typeOf(e); ctxProc = save; return t; }
    };
  }

  /* ---------------------------------------------------------------- texte */
  const TRANSLIT = { 'à': 'a', 'â': 'a', 'ä': 'a', 'á': 'a', 'ç': 'c', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'î': 'i', 'ï': 'i', 'í': 'i', 'ô': 'o', 'ö': 'o', 'ó': 'o', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ú': 'u', 'ÿ': 'y',
    'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ç': 'C', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Î': 'I', 'Ï': 'I',
    'Ô': 'O', 'Ö': 'O', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', '’': "'", '«': '"', '»': '"',
    '€': 'E', '–': '-', '—': '-', '…': '...' };
  function encodeText(str, target) {
    const out = [];
    for (const ch of String(str)) {
      if (target !== S.TARGET.SERIAL && ch !== '°' && TRANSLIT[ch] !== undefined) {
        for (const c of TRANSLIT[ch]) out.push(c.charCodeAt(0));
        continue;
      }
      let c = ch.charCodeAt(0);
      if (c > 255) {
        const t = TRANSLIT[ch] || '?';
        for (const x of t) out.push(x.charCodeAt(0));
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /* ---------------------------------------------------------------- génération du bytecode */
  function compile(prog) {
    const board = B[prog.board];
    if (!board) throw new CompileError('Carte inconnue : ' + prog.board);
    const types = inferTypes(prog);
    const code = [];
    const varIndex = {};
    let nvars = 0;
    const allocVar = key => {
      if (varIndex[key] === undefined) {
        if (nvars >= 250) throw new CompileError('Trop de variables (250 au maximum).');
        varIndex[key] = nvars++;
      }
      return varIndex[key];
    };
    const procs = {};
    for (const p of prog.procs || []) {
      if (procs[p.name]) throw new CompileError('Deux fonctions portent le nom « ' + p.name + ' ».');
      procs[p.name] = p;
      p.params.forEach(n => allocVar(p.name + ':' + n));
    }
    const callFixups = [];  // { at, name }
    let ctxProc = null;
    let loops = [];         // { breaks: [], continues: [], contTarget }
    let hidden = 0;

    const emit = (...b) => { for (const x of b) code.push(x & 0xFF); };
    const emitU16 = v => emit(v & 0xFF, (v >> 8) & 0xFF);
    const here = () => code.length;
    const patchU16 = (at, v) => { code[at] = v & 0xFF; code[at + 1] = (v >> 8) & 0xFF; };
    const jump = (op) => { emit(op); const at = here(); emitU16(0); return at; };

    const varSlot = name => {
      if (ctxProc && ctxProc.params.includes(name)) return allocVar(ctxProc.name + ':' + name);
      return allocVar(name);
    };
    const typeOf = e => types.typeOf(e, ctxProc);

    function pushNum(v) {
      if (Number.isInteger(v) && v >= -128 && v <= 127) emit(OP.PUSHB, v);
      else if (Number.isInteger(v) && v >= -32768 && v <= 32767) { emit(OP.PUSHW); emitU16(v); }
      else {
        const buf = new DataView(new ArrayBuffer(4));
        buf.setFloat32(0, v, true);
        emit(OP.PUSHF, buf.getUint8(0), buf.getUint8(1), buf.getUint8(2), buf.getUint8(3));
      }
    }

    const BINOP = { '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD,
      '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '<=': OP.LE, '>': OP.GT, '>=': OP.GE, '&&': OP.AND, '||': OP.OR };

    function expr(e) {
      switch (e.k) {
        case 'num': pushNum(Number(e.v)); return;
        case 'bool': pushNum(e.v ? 1 : 0); return;
        case 'pin': {
          const n = board.pinNumber(e.name);
          if (n === undefined) throw new CompileError(`La broche ${e.name} n'existe pas sur la carte ${board.name}.`, e.blockId);
          pushNum(n);
          return;
        }
        case 'var': emit(OP.LOAD, varSlot(e.name)); return;
        case 'neg': expr(e.a); emit(OP.NEG); return;
        case 'not': expr(e.a); emit(OP.NOT); return;
        case 'bin': {
          expr(e.a); expr(e.b);
          const op = BINOP[e.op];
          if (op === undefined) throw new CompileError('Opérateur inconnu ' + e.op, e.blockId);
          emit(op);
          // les entiers C restent entiers : on reproduit la troncature pour % entre entiers
          return;
        }
        case 'math': {
          const id = S.MATHID[e.fn];
          if (id === undefined) throw new CompileError('Fonction mathématique inconnue ' + e.fn, e.blockId);
          if (S.MATHFN[id][1] !== e.args.length) throw new CompileError('Mauvais nombre d\'arguments pour ' + e.fn, e.blockId);
          e.args.forEach(expr);
          emit(OP.MATH, id);
          return;
        }
        case 'sys': {
          const id = S.SYSID[e.fn];
          if (id === undefined) throw new CompileError('Appel système inconnu ' + e.fn, e.blockId);
          if (S.SYS[id][1] !== e.args.length) throw new CompileError('Mauvais nombre d\'arguments pour ' + e.fn, e.blockId);
          if (!S.SYS[id][2]) throw new CompileError(e.fn + ' ne renvoie pas de valeur', e.blockId);
          e.args.forEach(expr);
          emit(OP.SYS, id);
          return;
        }
        case 'call': {
          const p = procs[e.name];
          if (!p) throw new CompileError('Fonction inconnue : ' + e.name, e.blockId);
          callProc(p, e.args, e.blockId);
          return;
        }
        case 'str': throw new CompileError('Un texte ne peut être utilisé que dans un bloc « afficher ».', e.blockId);
      }
      throw new CompileError('Expression inconnue ' + e.k, e.blockId);
    }

    function callProc(p, args, blockId) {
      if (args.length !== p.params.length) throw new CompileError('Mauvais nombre de paramètres pour ' + p.name, blockId);
      args.forEach(expr);
      for (let i = p.params.length - 1; i >= 0; i--) emit(OP.STORE, allocVar(p.name + ':' + p.params[i]));
      emit(OP.CALL);
      callFixups.push({ at: here(), name: p.name });
      emitU16(0);
    }

    function storeVar(name, srcType) {
      const slot = varSlot(name);
      const key = ctxProc && ctxProc.params.includes(name) ? ctxProc.name + ':' + name : name;
      const vt = key.includes(':') ? types.params[key] : types.vars[key];
      if ((vt === 'int' || vt === 'bool') && srcType === 'float') emit(OP.TRUNC);
      emit(OP.STORE, slot);
    }

    function print(s) {
      const target = s.target || 0;
      for (const part of s.parts) {
        if (part.k === 'str') {
          let bytes = encodeText(part.v, target);
          while (bytes.length) {
            const chunk = bytes.slice(0, 255);
            bytes = bytes.slice(255);
            emit(OP.PRINTS, target, chunk.length, ...chunk);
          }
        } else {
          const t = typeOf(part);
          expr(part);
          const dec = part.decimals !== undefined ? part.decimals : (t === 'float' ? 2 : 0);
          emit(OP.PRINTN, target, dec);
        }
      }
      if (s.nl) emit(OP.PRINTNL, target);
    }

    function stmts(list) { for (const s of list || []) stmt(s); }

    function loopBody(body, contTarget) {
      const ctx = { breaks: [], continues: [] };
      loops.push(ctx);
      stmts(body);
      loops.pop();
      return ctx;
    }

    function stmt(s) {
      switch (s.k) {
        case 'set': expr(s.e); storeVar(s.name, typeOf(s.e)); return;
        case 'change':
          emit(OP.LOAD, varSlot(s.name)); expr(s.e); emit(OP.ADD);
          storeVar(s.name, typeOf(s.e));
          return;
        case 'if': {
          const ends = [];
          for (const br of s.branches) {
            expr(br.cond);
            const jz = jump(OP.JZ);
            stmts(br.body);
            ends.push(jump(OP.JMP));
            patchU16(jz, here());
          }
          stmts(s.else);
          ends.forEach(a => patchU16(a, here()));
          return;
        }
        case 'while': {
          const top = here();
          expr(s.cond);
          const jx = jump(s.until ? OP.JNZ : OP.JZ);
          const ctx = loopBody(s.body);
          emit(OP.JMP); emitU16(top);
          patchU16(jx, here());
          ctx.breaks.forEach(a => patchU16(a, here()));
          ctx.continues.forEach(a => patchU16(a, top));
          return;
        }
        case 'waitUntil': {
          const top = here();
          expr(s.cond);
          emit(OP.JZ); emitU16(top);
          return;
        }
        case 'repeat': {
          const cnt = allocVar('_rep' + (hidden++));
          expr(s.n); emit(OP.STORE, cnt);
          const top = here();
          emit(OP.LOAD, cnt); pushNum(0); emit(OP.GT);
          const jz = jump(OP.JZ);
          const ctx = loopBody(s.body);
          const cont = here();
          emit(OP.LOAD, cnt); pushNum(1); emit(OP.SUB); emit(OP.STORE, cnt);
          emit(OP.JMP); emitU16(top);
          patchU16(jz, here());
          ctx.breaks.forEach(a => patchU16(a, here()));
          ctx.continues.forEach(a => patchU16(a, cont));
          return;
        }
        case 'for': {
          // sémantique Blockly : sens automatique, pas en valeur absolue
          const v = varSlot(s.name);
          const end = allocVar('_end' + hidden);
          const step = allocVar('_step' + (hidden++));
          expr(s.from); storeVar(s.name, typeOf(s.from));
          expr(s.to); emit(OP.STORE, end);
          expr(s.by); emit(OP.MATH, S.MATHID.abs); emit(OP.STORE, step);
          // si début > fin, on descend
          emit(OP.LOAD, v); emit(OP.LOAD, end); emit(OP.GT);
          const jUp = jump(OP.JZ);
          emit(OP.LOAD, step); emit(OP.NEG); emit(OP.STORE, step);
          patchU16(jUp, here());
          const top = here();
          // condition : (step >= 0 && v <= end) || (step < 0 && v >= end)
          emit(OP.LOAD, step); pushNum(0); emit(OP.GE);
          emit(OP.LOAD, v); emit(OP.LOAD, end); emit(OP.LE); emit(OP.AND);
          emit(OP.LOAD, step); pushNum(0); emit(OP.LT);
          emit(OP.LOAD, v); emit(OP.LOAD, end); emit(OP.GE); emit(OP.AND);
          emit(OP.OR);
          const jz = jump(OP.JZ);
          const ctx = loopBody(s.body);
          const cont = here();
          emit(OP.LOAD, v); emit(OP.LOAD, step); emit(OP.ADD); emit(OP.STORE, v);
          emit(OP.JMP); emitU16(top);
          patchU16(jz, here());
          ctx.breaks.forEach(a => patchU16(a, here()));
          ctx.continues.forEach(a => patchU16(a, cont));
          return;
        }
        case 'break':
        case 'continue': {
          const ctx = loops[loops.length - 1];
          if (!ctx) throw new CompileError('« sortir de la boucle » doit être placé dans une boucle.', s.blockId);
          const at = jump(OP.JMP);
          (s.k === 'break' ? ctx.breaks : ctx.continues).push(at);
          return;
        }
        case 'sys': {
          const id = S.SYSID[s.fn];
          if (id === undefined) throw new CompileError('Appel système inconnu ' + s.fn, s.blockId);
          if (S.SYS[id][1] !== s.args.length) throw new CompileError('Mauvais nombre d\'arguments pour ' + s.fn, s.blockId);
          s.args.forEach(expr);
          emit(OP.SYS, id);
          if (S.SYS[id][2]) emit(OP.POP);
          return;
        }
        case 'call': {
          const p = procs[s.name];
          if (!p) throw new CompileError('Fonction inconnue : ' + s.name, s.blockId);
          callProc(p, s.args, s.blockId);
          if (p.ret) emit(OP.POP);
          return;
        }
        case 'return': {
          if (!ctxProc) throw new CompileError('« renvoyer » ne peut être utilisé que dans une fonction.', s.blockId);
          if (s.e) { expr(s.e); emit(OP.RETV); } else emit(OP.RET);
          return;
        }
        case 'print': print(s); return;
        case 'expr': expr(s.e); emit(OP.POP); return;
      }
      throw new CompileError('Instruction inconnue ' + s.k, s.blockId);
    }

    // en-tête
    for (let i = 0; i < S.HEADER_SIZE; i++) code.push(0);
    const setupAddr = here();
    stmts(prog.setup);
    emit(OP.RET);
    const loopAddr = here();
    stmts(prog.loop);
    emit(OP.RET);
    const procAddr = {};
    for (const p of prog.procs || []) {
      ctxProc = p;
      procAddr[p.name] = here();
      stmts(p.body);
      if (p.ret) { expr(p.ret); emit(OP.RETV); } else emit(OP.RET);
      ctxProc = null;
    }
    for (const f of callFixups) patchU16(f.at, procAddr[f.name]);

    if (code.length > 65535) throw new CompileError('Programme trop long.');
    code[0] = 'V'.charCodeAt(0); code[1] = 'M'.charCodeAt(0); code[2] = S.VERSION; code[3] = nvars;
    patchU16(4, setupAddr); patchU16(6, loopAddr); patchU16(8, code.length);
    code[10] = S.BOARDS[prog.board] || 0;
    return { bytes: Uint8Array.from(code), nvars, varIndex, types };
  }

  /* ---------------------------------------------------------------- liste des appels système utilisés */
  function usedSys(prog) {
    const used = new Set();
    const lists = allStmtLists(prog);
    for (const p of prog.procs || []) if (p.ret) walkExpr(p.ret, e => { if (e.k === 'sys') used.add(e.fn); });
    for (const l of lists) walkStmts(l, s => {
      if (s.k === 'sys') used.add(s.fn);
      stmtExprs(s).forEach(e => walkExpr(e, x => { if (x.k === 'sys') used.add(x.fn); }));
    });
    return used;
  }

  const API = { compile, inferTypes, encodeText, usedSys, walkStmts, walkExpr, stmtExprs, CompileError };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Compiler = API;
})(this);
