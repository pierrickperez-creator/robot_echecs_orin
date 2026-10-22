// Tests du moteur électrique et des modules (sans interface graphique)
const assert = require('assert');
const { Simulator } = require('../src/js/sim.js');
const Compiler = require('../src/js/compiler.js');
const PARTS = require('../src/js/parts.js');

const n = v => ({ k: 'num', v });
const pin = name => ({ k: 'pin', name });
const sys = (fn, ...args) => ({ k: 'sys', fn, args });

function circuitWith(comps, wires, cables, extra) {
  return Object.assign({
    board: 'uno', shield: true,
    comps: [{ id: 'board', type: 'board', x: 0, y: 0 }, ...comps],
    wires: wires || [], cables: cables || []
  }, extra || {});
}
const holeAt = (bb, id) => {
  const h = PARTS.BB_PINS.find(p => p.id === id);
  return { x: bb.x + h.x, y: bb.y + h.y };
};

// 1) LED sans résistance entre D13 et GND : elle grille, la broche est surchargée
{
  const c = circuitWith(
    [{ id: 'bb', type: 'breadboard', x: 0, y: 300 }, { id: 'led', type: 'led_red', x: 0, y: 0 }],
    [{ a: { c: 'board', p: 'D13' }, b: { c: 'bb', p: 'a5' } }, { a: { c: 'board', p: 'GND_T' }, b: { c: 'bb', p: 'a6' } }]
  );
  const p = holeAt(c.comps[1], 'c5');
  c.comps[2].x = p.x; c.comps[2].y = p.y;  // pattes en c5 (anode) et c6 (cathode)
  const warns = [];
  const sim = new Simulator(c, { onWarn: m => warns.push(m) });
  sim.load(Compiler.compile({ board: 'uno', setup: [sys('pinMode', pin('D13'), n(1)), sys('digitalWrite', pin('D13'), n(1))], loop: [] }).bytes);
  sim.advance(10);
  assert.ok(c.comps[2].rt.burned, 'la LED doit griller sans résistance');
  assert.ok(warns.some(w => w.includes('grillé')), warns.join('\n'));
  console.log('OK LED sans résistance → grillée');
}

// 2) Avec résistance de 220 Ω : allumée, ~13 mA
{
  const c = circuitWith(
    [{ id: 'bb', type: 'breadboard', x: 0, y: 300 }, { id: 'led', type: 'led_red', x: 0, y: 0 }, { id: 'r', type: 'resistor', x: 0, y: 0, props: { ohms: 220 } }],
    [{ a: { c: 'board', p: 'D13' }, b: { c: 'bb', p: 'a1' } }, { a: { c: 'board', p: 'GND_T' }, b: { c: 'bb', p: 'a10' } }]
  );
  const bb = c.comps[1];
  let p = holeAt(bb, 'b1'); Object.assign(c.comps[3], p);          // résistance b1 → b5
  p = holeAt(bb, 'c5'); Object.assign(c.comps[2], p);              // LED c5 (anode) → c6 (cathode)
  c.wires.push({ a: { c: 'bb', p: 'd6' }, b: { c: 'bb', p: 'd10' } });
  const sim = new Simulator(c, {});
  sim.load(Compiler.compile({ board: 'uno', setup: [sys('pinMode', pin('D13'), n(1)), sys('digitalWrite', pin('D13'), n(1))], loop: [] }).bytes);
  sim.advance(10);
  assert.ok(!c.comps[2].rt.burned, 'pas grillée');
  assert.ok(c.comps[2].rt.bright[0] > 0.5, 'allumée : ' + c.comps[2].rt.bright);
  const e = sim.elements.find(x => x.t === 'd');
  assert.ok(e.i > 0.010 && e.i < 0.016, 'courant ≈ 13 mA : ' + e.i);
  console.log('OK LED + 220 Ω : ' + (e.i * 1000).toFixed(1) + ' mA');
}

// 3) Bouton Grove sur D2 + LED Grove sur D4 via le shield, programme « si bouton alors LED »
{
  const c = circuitWith(
    [{ id: 'btn', type: 'grove_button', x: 400, y: 0 }, { id: 'led', type: 'grove_led_red', x: 500, y: 0 }],
    [], [{ comp: 'btn', port: 'D2' }, { comp: 'led', port: 'D4' }]
  );
  const prog = {
    board: 'uno',
    setup: [sys('pinMode', pin('D2'), n(0)), sys('pinMode', pin('D4'), n(1))],
    loop: [sys('digitalWrite', pin('D4'), sys('digitalRead', pin('D2')))]
  };
  const sim = new Simulator(c, {});
  sim.load(Compiler.compile(prog).bytes);
  sim.advance(20);
  assert.strictEqual(c.comps[2].rt.on, false, 'LED éteinte au repos');
  c.comps[1].rt.active = true; sim.interact();
  sim.advance(20);
  assert.strictEqual(c.comps[2].rt.on, true, 'LED allumée quand on appuie');
  console.log('OK bouton Grove → LED Grove');
}

// 4) Potentiomètre Grove sur A0 + LCD I2C
{
  const c = circuitWith(
    [{ id: 'pot', type: 'grove_rotary', x: 400, y: 0, sim: { value: 150 } }, { id: 'lcd', type: 'grove_lcd_rgb', x: 500, y: 0 }],
    [], [{ comp: 'pot', port: 'A0' }, { comp: 'lcd', port: 'I2C_1' }]
  );
  const prog = {
    board: 'uno',
    setup: [],
    loop: [
      sys('lcdSetCursor', n(0), n(0)),
      { k: 'print', target: 1, parts: [{ k: 'str', v: 'Val:' }, sys('analogRead', pin('A0'))], nl: false },
      sys('delay', n(100))
    ]
  };
  const sim = new Simulator(c, {});
  sim.load(Compiler.compile(prog).bytes);
  sim.advance(50);
  const line = c.comps[2].rt.lcd.lines[0].join('');
  assert.ok(/^Val:51[0-2]/.test(line), 'LCD : ' + line);
  console.log('OK potentiomètre → LCD : « ' + line + ' »');
}

// 5) Bouton-poussoir de base avec INPUT_PULLUP
{
  const c = circuitWith([{ id: 'bb', type: 'breadboard', x: 0, y: 300 }, { id: 'b', type: 'pushbutton', x: 0, y: 0 }], [], []);
  const bb = c.comps[1];
  Object.assign(c.comps[2], holeAt(bb, 'e10'));  // pattes e10, e12, f10, f12
  c.wires.push({ a: { c: 'board', p: 'D7' }, b: { c: 'bb', p: 'a10' } });
  c.wires.push({ a: { c: 'board', p: 'GND_T' }, b: { c: 'bb', p: 'a12' } });
  const prog = { board: 'uno', setup: [sys('pinMode', pin('D7'), n(2)), sys('serialBegin', n(9600))],
    loop: [{ k: 'print', target: 0, parts: [sys('digitalRead', pin('D7'))], nl: false }, sys('delay', n(10))] };
  let out = '';
  const sim = new Simulator(c, { onSerial: s => { out += s; } });
  sim.load(Compiler.compile(prog).bytes);
  sim.advance(25);
  c.comps[2].rt.pressed = true; sim.interact();
  sim.advance(25);
  assert.ok(/^1+0+$/.test(out), 'pull-up puis appui : ' + out);
  console.log('OK bouton + INPUT_PULLUP : ' + out);
}
console.log('Tous les tests du simulateur sont passés.');
