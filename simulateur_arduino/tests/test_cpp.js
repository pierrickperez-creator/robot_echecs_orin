// Vérifie que le code .ino généré compile avec avr-g++ (cœur Arduino, sans bibliothèque externe)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const CppGen = require('../src/js/cppgen.js');

const n = v => ({ k: 'num', v });
const v = name => ({ k: 'var', name });
const bin = (op, a, b) => ({ k: 'bin', op, a, b });
const str = s => ({ k: 'str', v: s });
const sys = (fn, ...args) => ({ k: 'sys', fn, args });
const pin = name => ({ k: 'pin', name });

const prog = {
  board: 'uno',
  procs: [
    { name: 'moyenne', params: ['a', 'b'], body: [], ret: bin('/', bin('+', v('a'), v('b')), n(2)) },
    { name: 'clignoter', params: ['fois'], ret: null, body: [
      { k: 'repeat', n: v('fois'), body: [
        sys('digitalWrite', pin('D13'), n(1)), sys('delay', n(100)),
        sys('digitalWrite', pin('D13'), n(0)), sys('delay', n(100))
      ] }
    ] }
  ],
  setup: [
    { k: 'sys', fn: 'serialBegin', args: [n(9600)], auto: true },
    { k: 'sys', fn: 'pinMode', args: [pin('D13'), n(1)], auto: true },
    { k: 'set', name: 'compteur', e: n(0) },
    { k: 'set', name: 'temperature', e: n(21.5) }
  ],
  loop: [
    { k: 'change', name: 'compteur', e: n(1) },
    { k: 'if', branches: [{ cond: bin('==', sys('digitalRead', pin('D2')), n(1)), body: [{ k: 'call', name: 'clignoter', args: [n(3)] }] }], else: [
      { k: 'print', target: 0, parts: [str('Valeur : '), sys('analogRead', pin('A0')), str(' moy='), { k: 'call', name: 'moyenne', args: [v('compteur'), n(3)] }], nl: true }
    ] },
    { k: 'for', name: 'i', from: n(0), to: n(255), by: n(5), body: [sys('analogWrite', pin('D3'), v('i')), sys('delay', n(5))] },
    sys('servoWrite', pin('D9'), n(90)),
    { k: 'while', cond: bin('<', v('temperature'), n(25)), body: [{ k: 'change', name: 'temperature', e: n(0.5) }] },
    { k: 'print', target: 0, parts: [str('% = '), bin('%', v('compteur'), n(7)), str(' t='), v('temperature')], nl: true },
    sys('delay', n(500))
  ]
};

const code = CppGen.generate(prog);
console.log(code);
assert.ok(code.includes('long compteur = 0;'));
assert.ok(code.includes('float temperature = 0;'));
assert.ok(code.includes('float moyenne(long a, long b)'));
assert.ok(code.includes('digitalRead(2) == HIGH'));
assert.ok(code.includes('#include <Servo.h>'));

// compilation avec le cœur Arduino
const CORE = '/usr/share/arduino/hardware/arduino/avr';
if (fs.existsSync(CORE)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ino-'));
  // l'IDE ajoute #include <Arduino.h> et les prototypes ; on fait de même
  const protos = [...code.matchAll(/^(void|long|float|bool|int) (\w+)\(([^)]*)\) \{/gm)]
    .filter(m => !['setup', 'loop'].includes(m[2])).map(m => `${m[1]} ${m[2]}(${m[3]});`).join('\n');
  const servoStub = 'class Servo { public: void attach(int){} void write(int){} };\n';
  const src = '#include <Arduino.h>\n' + servoStub + protos + '\n' + code.replace('#include <Servo.h>', '');
  fs.writeFileSync(path.join(dir, 'prog.cpp'), src);
  execSync(`avr-g++ -mmcu=atmega328p -DF_CPU=16000000L -DARDUINO=10806 -Os -std=gnu++11 -fsyntax-only ` +
    `-I${CORE}/cores/arduino -I${CORE}/variants/standard ${path.join(dir, 'prog.cpp')}`, { stdio: 'inherit' });
  console.log('OK : le code généré compile avec avr-g++');
} else {
  console.log('(cœur Arduino absent : compilation non testée)');
}
