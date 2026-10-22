// Vérifie les pilotes I2C du micrologiciel avec des modules émulés (écran LCD RGB, accéléromètre ADXL345, DHT20)
const assert = require('assert');
const Compiler = require('../src/js/compiler.js');
const { runFirmware } = require('./avr_harness.js');

const n = v => ({ k: 'num', v });
const sys = (fn, ...args) => ({ k: 'sys', fn, args });
const str = s => ({ k: 'str', v: s });

// registre générique : écriture [reg, valeurs...], lecture séquentielle depuis reg
function regDevice(regs) {
  let ptr = 0, first = true;
  return {
    regs,
    start(write) { if (write) first = true; },
    write(v) { if (first) { ptr = v & 0x7F; first = false; } else regs[ptr++] = v; },
    read() { return regs[ptr++] || 0; }
  };
}

// --- écran LCD RGB (0x3E) + rétroéclairage (0x62)
{
  const lcdBytes = [];
  const lcd = { write(v) { lcdBytes.push(v); }, read() { return 0; } };
  const rgb = regDevice({});
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    sys('lcdSetCursor', n(3), n(1)),
    { k: 'print', target: 1, parts: [str('Hi'), n(42)], nl: false },
    sys('lcdRGB', n(255), n(0), n(128)),
    sys('delay', n(10000))
  ] };
  const hw = runFirmware(Compiler.compile(prog).bytes, { seconds: 0.4, i2c: { 0x3E: lcd, 0x62: rgb } });
  const lcdTx = hw.i2cLog.filter(t => t.addr === 0x3E).map(t => t.bytes);
  // commande de positionnement : 0x80 (commande) puis 0xC0 | 3 (ligne 2, colonne 3)
  assert.ok(lcdTx.some(b => b[0] === 0x80 && b[1] === 0xC3), 'curseur ligne 1 colonne 3');
  const data = lcdTx.filter(b => b[0] === 0x40).map(b => String.fromCharCode(b[1])).join('');
  assert.strictEqual(data, 'Hi42', 'texte envoyé à l\'écran : ' + data);
  assert.strictEqual(rgb.regs[0x04], 255); assert.strictEqual(rgb.regs[0x03], 0); assert.strictEqual(rgb.regs[0x02], 128);
  console.log('OK écran LCD RGB : curseur, texte « Hi42 » et couleur (255, 0, 128)');
}

// --- accéléromètre ADXL345 (0x53) : x = 256 -> 1,00 g
{
  const regs = { 0x00: 0xE5, 0x32: 0x00, 0x33: 0x01, 0x34: 0x80, 0x35: 0xFF, 0x36: 0x00, 0x37: 0x00 };
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    { k: 'print', target: 0, parts: [sys('accelRead', n(0)), str(' '), sys('accelRead', n(1))], nl: true },
    sys('delay', n(10000))
  ] };
  const hw = runFirmware(Compiler.compile(prog).bytes, { seconds: 0.5, i2c: { 0x53: regDevice(regs) } });
  assert.ok(hw.serial.startsWith('1.00 -0.50'), 'lecture accéléromètre : ' + JSON.stringify(hw.serial));
  console.log('OK accéléromètre ADXL345 : ' + hw.serial.trim());
}

// --- DHT20 (0x38) : 50 % et 25 °C
{
  const h = Math.round(0.5 * 1048576), t = Math.round((25 + 50) / 200 * 1048576);
  const frame = [0x1C, (h >> 12) & 0xFF, (h >> 4) & 0xFF, ((h & 0xF) << 4) | ((t >> 16) & 0xF), (t >> 8) & 0xFF, t & 0xFF, 0];
  let idx = 0;
  const dht = { start(write) { if (!write) idx = 0; }, write() {}, read() { return frame[idx++]; } };
  const prog = { board: 'uno', setup: [], procs: [], loop: [
    { k: 'print', target: 0, parts: [sys('thI2CRead', n(0), n(0)), str(' '), sys('thI2CRead', n(0), n(1))], nl: true },
    sys('delay', n(10000))
  ] };
  const hw = runFirmware(Compiler.compile(prog).bytes, { seconds: 0.5, i2c: { 0x38: dht } });
  assert.ok(hw.serial.startsWith('25.00 50.00'), 'DHT20 : ' + JSON.stringify(hw.serial));
  console.log('OK capteur DHT20 : ' + hw.serial.trim());
}
