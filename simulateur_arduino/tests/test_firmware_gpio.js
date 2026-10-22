// Vérifie les signaux produits par le micrologiciel : servomoteur (impulsions) et capteur à ultrasons Grove
const assert = require('assert');
const avr = require('avr8js');
const Compiler = require('../src/js/compiler.js');
const { runFirmware } = require('./avr_harness.js');

const n = v => ({ k: 'num', v });
const sys = (fn, ...args) => ({ k: 'sys', fn, args });

// --- servomoteur sur D9 (PB1) : 90° -> impulsion ≈ 1472 µs toutes les 20 ms
{
  const prog = { board: 'uno', setup: [sys('servoWrite', n(9), n(90))], procs: [], loop: [sys('delay', n(1000))] };
  const pulses = [];
  let rise = null, last = 0;
  runFirmware(Compiler.compile(prog).bytes, {
    seconds: 0.12,
    onPin: (port, v, cyc) => {
      if (port !== 'B') return;
      const hi = (v >> 1) & 1;
      if (hi && !last) rise = cyc;
      if (!hi && last && rise !== null) pulses.push({ at: rise, us: (cyc - rise) / 16 });
      last = hi;
    }
  });
  assert.ok(pulses.length >= 4, 'impulsions servo : ' + pulses.length);
  const w = pulses.slice(1).map(p => p.us);
  const period = (pulses[pulses.length - 1].at - pulses[1].at) / (pulses.length - 2) / 16;
  assert.ok(w.every(x => Math.abs(x - 1472) < 15), 'largeur ' + w.join(', '));
  assert.ok(Math.abs(period - 20000) < 300, 'période ' + period);
  console.log(`OK servomoteur : impulsions de ${Math.round(w[0])} µs toutes les ${Math.round(period / 100) / 10} ms`);
}

// --- ultrason Grove sur D7 (PD7) : écho de 58 µs/cm -> 40 cm
{
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    { k: 'print', target: 0, parts: [sys('ultrasonicCm', n(7))], nl: true }, sys('delay', n(100000))
  ] };
  let portD, state = 'idle', t0 = 0, cpuRef;
  const hw = runFirmware(Compiler.compile(prog).bytes, {
    seconds: 0.2,
    setup: ctx => { portD = ctx.portD; cpuRef = ctx.cpu; },
    onPin: (port, v, cyc) => {
      if (port !== 'D') return;
      const hi = (v >> 7) & 1;
      if (state === 'idle' && hi) state = 'trig';
      else if (state === 'trig' && !hi) { state = 'wait'; t0 = cyc + 16 * 200; }
    },
    step: cpu => {
      if (state === 'wait' && cpu.cycles >= t0) { portD.setPin(7, true); state = 'echo'; t0 = cpu.cycles + 16 * 58 * 40; }
      else if (state === 'echo' && cpu.cycles >= t0) { portD.setPin(7, false); state = 'done'; }
    }
  });
  void cpuRef;
  assert.ok(/^(39|40)\r\n/.test(hw.serial), 'distance : ' + JSON.stringify(hw.serial));  // pulseIn mesure à ±1 cm près, comme sur la vraie carte
  console.log('OK ultrason Grove : ' + hw.serial.trim() + ' cm');
}

// --- encodeur rotatif sur D2/D3 : 3 crans dans le sens horaire (4 fronts par cran)
{
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    { k: 'print', target: 0, parts: [sys('encoderRead', n(2))], nl: true }, sys('delay', n(50))
  ] };
  let portD;
  const seq = [[0, 1], [0, 0], [1, 0], [1, 1]];  // A, B (rebouclage sur [1,1])
  const t0 = 16e6 * 0.06;
  let step = 0;
  const hw = runFirmware(Compiler.compile(prog).bytes, {
    seconds: 0.3,
    setup: ctx => { portD = ctx.portD; portD.setPin(2, true); portD.setPin(3, true); },
    step: cpu => {
      const k = Math.floor((cpu.cycles - t0) / 16000);   // un front par ms
      if (cpu.cycles > t0 && k >= step && step < 12) {
        const [a, b] = seq[step % 4];
        portD.setPin(2, !!a); portD.setPin(3, !!b);
        step++;
      }
    }
  });
  const vals = hw.serial.trim().split(/\r\n/).map(Number);
  assert.strictEqual(vals[0], 0);
  assert.strictEqual(Math.abs(vals[vals.length - 1]), 3, 'position : ' + vals.join(','));
  console.log('OK encodeur rotatif : positions ' + [...new Set(vals)].join(' → '));
}

// --- récepteur infrarouge NEC sur D2 : touche « 1 » (commande 0x0C)
{
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    { k: 'set', name: 'c', e: sys('irRead', n(2)) },
    { k: 'if', branches: [{ cond: { k: 'bin', op: '!=', a: { k: 'var', name: 'c' }, b: n(0) }, body: [
      { k: 'print', target: 0, parts: [{ k: 'var', name: 'c' }], nl: true }] }], else: null },
    sys('delay', n(5))
  ] };
  // trame NEC : adresse 0x00, ~0x00, commande 0x0C, ~0x0C (bits de poids faible en premier)
  const bytes = [0x00, 0xFF, 0x0C, 0xF3];
  const levels = [[0, 9000], [1, 4500]];
  for (const by of bytes) for (let i = 0; i < 8; i++) levels.push([0, 562], [1, (by >> i) & 1 ? 1687 : 562]);
  levels.push([0, 562], [1, 50000]);
  let portD, idx = -1, until = 16e6 * 0.05;
  const hw = runFirmware(Compiler.compile(prog).bytes, {
    seconds: 0.25,
    setup: ctx => { portD = ctx.portD; portD.setPin(2, true); },
    step: cpu => {
      if (cpu.cycles >= until && idx < levels.length - 1) {
        idx++;
        portD.setPin(2, !!levels[idx][0]);
        until = cpu.cycles + levels[idx][1] * 16;
      }
    }
  });
  assert.ok(/^12\r\n$/.test(hw.serial), 'code IR : ' + JSON.stringify(hw.serial));
  console.log('OK récepteur infrarouge NEC : code ' + hw.serial.trim());
}
