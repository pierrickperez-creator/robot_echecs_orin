// Compare la VM JavaScript (simulateur) et le micrologiciel réel exécuté dans avr8js.
const assert = require('assert');
const Compiler = require('../src/js/compiler.js');
const { VM } = require('../src/js/vm.js');
const { runFirmware } = require('./avr_harness.js');

const n = v => ({ k: 'num', v });
const v = name => ({ k: 'var', name });
const bin = (op, a, b) => ({ k: 'bin', op, a, b });
const str = s => ({ k: 'str', v: s });
const println = (...parts) => ({ k: 'print', target: 0, parts, nl: true });
const sys = (fn, ...args) => ({ k: 'sys', fn, args });
const math = (fn, ...args) => ({ k: 'math', fn, args });

const prog = {
  board: 'uno',
  procs: [
    { name: 'carre', params: ['x'], body: [], ret: bin('*', v('x'), v('x')) },
    { name: 'moyenne', params: ['a', 'b'], body: [], ret: bin('/', bin('+', v('a'), v('b')), n(2)) },
    {
      name: 'compter', params: ['jusqua'], ret: null, body: [
        { k: 'for', name: 'i', from: n(1), to: v('jusqua'), by: n(1), body: [
          { k: 'print', target: 0, parts: [v('i'), str(' ')], nl: false }
        ] },
        println()
      ]
    }
  ],
  setup: [
    sys('serialBegin', n(9600)),
    println(str('Bonjour é°')),
    { k: 'set', name: 'x', e: n(7) },
    println(str('x/2='), bin('/', v('x'), n(2))),
    println(str('x%3='), bin('%', v('x'), n(3))),
    println(str('carre='), { k: 'call', name: 'carre', args: [n(12)] }),
    println(str('moy='), { k: 'call', name: 'moyenne', args: [n(3), n(4)] }),
    { k: 'call', name: 'compter', args: [n(5)] },
    { k: 'for', name: 'j', from: n(10), to: n(0), by: n(3), body: [
      { k: 'print', target: 0, parts: [v('j'), str(',')], nl: false }
    ] },
    println(),
    println(str('map='), math('map', n(512), n(0), n(1023), n(0), n(255))),
    println(str('sqrt='), math('sqrt', n(2))),
    println(str('round='), math('round', n(-2.5)), str(' '), math('round', n(2.5))),
    println(str('pi='), { k: 'num', v: 3.14159, decimals: 4 }),
    println(str('cons='), math('constrain', n(300), n(0), n(255))),
    { k: 'set', name: 'k', e: n(0) },
    { k: 'while', cond: { k: 'bool', v: true }, body: [
      { k: 'change', name: 'k', e: n(1) },
      { k: 'if', branches: [{ cond: bin('>=', v('k'), n(4)), body: [{ k: 'break' }] }], else: null }
    ] },
    println(str('k='), v('k')),
    { k: 'repeat', n: n(3), body: [{ k: 'print', target: 0, parts: [str('*')], nl: false }] },
    println(),
    { k: 'if', branches: [
      { cond: bin('&&', bin('>', v('x'), n(5)), { k: 'not', a: bin('==', v('x'), n(8)) }), body: [println(str('si-ok'))] }
    ], else: [println(str('si-non'))] },
    println(str('neg='), { k: 'neg', a: n(1.5) }),
    println(str('grand='), n(123456)),
    println(str('fin'))
  ],
  loop: [
    { k: 'sys', fn: 'digitalWrite', args: [n(13), n(1)] },
    sys('delay', n(100)),
    { k: 'sys', fn: 'digitalWrite', args: [n(13), n(0)] },
    sys('delay', n(100))
  ]
};
prog.setup.unshift({ k: 'sys', fn: 'pinMode', args: [n(13), n(1)] });

const { bytes } = Compiler.compile(prog);

// --- VM JavaScript
let jsOut = '';
const pin13 = [];
const host = {
  sys(name, args, vm) {
    switch (name) {
      case 'delay': vm.sleep(args[0] * 1000); return;
      case 'millis': return vm.millis();
      case 'digitalWrite': if (args[0] === 13) pin13.push({ ms: Math.round(vm.timeUs / 1000), v: args[1] }); return;
    }
    return 0;
  },
  print(t, s) { jsOut += s; },
  newline() { jsOut += '\r\n'; },
  error(m) { throw new Error(m); }
};
const vm = new VM(bytes, host, { maxVars: 110 });
vm.run(1e6);

// --- micrologiciel réel dans avr8js
const hw = runFirmware(bytes, { seconds: 1.0 });
// le texte Latin-1 est converti en UTF-8 sur la carte
const hwText = Buffer.from(hw.serial, 'latin1').toString('utf8');

console.log('--- sortie simulateur ---\n' + jsOut);
if (hwText !== jsOut) {
  console.log('--- sortie carte (avr8js) ---\n' + hwText);
}
assert.strictEqual(hwText, jsOut, 'la carte et le simulateur doivent afficher la même chose');
assert.ok(jsOut.includes('x/2=3.50'));
assert.ok(jsOut.includes('carre=144'));
assert.ok(jsOut.includes('1 2 3 4 5'));
assert.ok(jsOut.includes('10,7,4,1,'));
assert.ok(jsOut.includes('round=-3 3'));
// clignotement : basculements de la LED 13 toutes les ~100 ms sur les deux
const hwToggles = hw.events.length;
assert.ok(hwToggles >= 8, 'la LED 13 doit clignoter sur la carte (' + hwToggles + ')');
assert.ok(pin13.length >= 8, 'la LED 13 doit clignoter dans le simulateur');
console.log('OK : VM et micrologiciel identiques ; taille du bytecode', bytes.length, 'octets');
