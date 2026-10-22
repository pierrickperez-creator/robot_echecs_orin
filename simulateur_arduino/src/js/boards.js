/*
 * Description des cartes : broches, numéros Arduino, capacités, positions des connecteurs
 * (unités : 10 = 2,54 mm, pas des connecteurs) et ports du shield Grove.
 */
(function (root) {
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  function makeBoard(def) {
    const b = Object.assign({}, def);
    b.pinNumber = function (name) {
      if (name === undefined || name === null) return undefined;
      name = String(name).toUpperCase();
      if (name === 'LED' || name === 'LED_BUILTIN') return 13;
      let m = /^D?(\d+)$/.exec(name);
      if (m) { const n = +m[1]; return n < b.digitalCount ? n : undefined; }
      m = /^A(\d+)$/.exec(name);
      if (m) { const n = +m[1]; return n < b.analogCount ? b.analogBase + n : undefined; }
      return undefined;
    };
    b.pinName = function (num) {
      if (num >= b.analogBase && num < b.analogBase + b.analogCount) return 'A' + (num - b.analogBase);
      return 'D' + num;
    };
    b.isPwm = n => b.pwm.includes(n);
    b.isAnalog = n => n >= b.analogBase && n < b.analogBase + b.analogCount;
    b.digitalPins = () => range(0, b.digitalCount - 1).map(n => 'D' + n);
    b.analogPins = () => range(0, b.analogCount - 1).map(n => 'A' + n);
    // noms électriques (nets) des signaux, ex. « D13 », « A0 », « 5V », « GND »
    b.netOf = function (pinId) {
      const p = b.pins.find(q => q.id === pinId);
      return p ? p.net : undefined;
    };
    return b;
  }

  /* ------------------------------------------------------------ Arduino Uno R3 */
  function unoPins(extraTop) {
    const pins = [];
    // connecteur 10 broches (haut, gauche)
    ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'].forEach((id, i) => {
      pins.push({ id: id === 'GND' ? 'GND_T' : id, x: 80 + i * 10, y: 10, label: id.replace(/^D/, ''),
        net: id === 'SCL' ? 'SCL' : id === 'SDA' ? 'SDA' : id === 'GND' ? 'GND' : id });
    });
    ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'].forEach((id, i) => {
      pins.push({ id, x: 180 + i * 10, y: 10, label: id === 'D1' ? 'TX→1' : id === 'D0' ? 'RX←0' : id.slice(1), net: id });
    });
    if (extraTop) extraTop(pins);
    // alimentation (bas)
    [['IOREF', 'IOREF', '5V'], ['RESET', 'RESET', 'RESET'], ['3V3', '3.3V', '3V3'], ['5V', '5V', '5V'],
      ['GND_B1', 'GND', 'GND'], ['GND_B2', 'GND', 'GND'], ['VIN', 'Vin', 'VIN']].forEach(([id, label, net], i) => {
      pins.push({ id, x: 110 + i * 10, y: 200, label, net });
    });
    return pins;
  }

  const uno = makeBoard({
    id: 'uno', name: 'Arduino Uno', mcu: 'atmega328p', w: 270, h: 210,
    digitalCount: 20, analogBase: 14, analogCount: 6, analogOnly: [],
    pwm: [3, 5, 6, 9, 10, 11], i2c: { sda: 'A4', scl: 'A5' }, uart: ['D0', 'D1'],
    upload: { protocol: 'stk500v1', bauds: [115200] },
    pins: (() => {
      const p = unoPins();
      ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach((id, i) => p.push({ id, x: 190 + i * 10, y: 200, label: id, net: id }));
      return p;
    })(),
    // sur l'Uno, SDA/SCL du connecteur du haut sont reliées à A4/A5
    aliases: { SDA: 'A4', SCL: 'A5' }
  });

  /* ------------------------------------------------------------ Arduino Nano */
  const nanoTop = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RESET', 'D0', 'D1'];
  const nanoBot = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RESET', 'GND', 'VIN'];
  const nanoPin = (id, x, y, side) => ({
    id: id + '_' + side, x, y,
    label: id === 'D0' ? 'RX0' : id === 'D1' ? 'TX1' : id.replace(/^D(\d)/, 'D$1'),
    net: id
  });
  const nano = makeBoard({
    id: 'nano', name: 'Arduino Nano', mcu: 'atmega328p', w: 180, h: 70,
    digitalCount: 20, analogBase: 14, analogCount: 8, analogOnly: [20, 21],
    pwm: [3, 5, 6, 9, 10, 11], i2c: { sda: 'A4', scl: 'A5' }, uart: ['D0', 'D1'],
    upload: { protocol: 'stk500v1', bauds: [115200, 57600] },
    pins: [
      ...nanoTop.map((id, i) => nanoPin(id, 20 + i * 10, 5, 't')),
      ...nanoBot.map((id, i) => nanoPin(id, 20 + i * 10, 65, 'b'))
    ],
    aliases: {}
  });

  /* ------------------------------------------------------------ Arduino Mega 2560 */
  const mega = makeBoard({
    id: 'mega', name: 'Arduino Mega 2560', mcu: 'atmega2560', w: 400, h: 210,
    digitalCount: 54, analogBase: 54, analogCount: 16, analogOnly: [],
    pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46], i2c: { sda: 'D20', scl: 'D21' }, uart: ['D0', 'D1'],
    upload: { protocol: 'stk500v2', bauds: [115200] },
    pins: (() => {
      const p = unoPins(pins => {
        ['D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20', 'D21'].forEach((id, i) => {
          const lab = { D14: 'TX3', D15: 'RX3', D16: 'TX2', D17: 'RX2', D18: 'TX1', D19: 'RX1', D20: 'SDA', D21: 'SCL' }[id];
          pins.push({ id, x: 270 + i * 10, y: 10, label: id.slice(1) + ' ' + lab, net: id });
        });
      });
      for (let i = 0; i < 16; i++) {
        p.push({ id: 'A' + i, x: (i < 8 ? 190 : 200) + i * 10, y: 200, label: 'A' + i, net: 'A' + i });
      }
      // double connecteur de droite
      p.push({ id: '5V_R1', x: 370, y: 30, label: '5V', net: '5V' });
      p.push({ id: '5V_R2', x: 380, y: 30, label: '5V', net: '5V' });
      for (let k = 0; k < 16; k++) {
        p.push({ id: 'D' + (22 + 2 * k), x: 370, y: 40 + k * 10, label: String(22 + 2 * k), net: 'D' + (22 + 2 * k) });
        p.push({ id: 'D' + (23 + 2 * k), x: 380, y: 40 + k * 10, label: String(23 + 2 * k), net: 'D' + (23 + 2 * k) });
      }
      p.push({ id: 'GND_R1', x: 370, y: 200, label: 'GND', net: 'GND' });
      p.push({ id: 'GND_R2', x: 380, y: 200, label: 'GND', net: 'GND' });
      return p;
    })(),
    aliases: { SDA: 'D20', SCL: 'D21' }
  });
  // sur la Mega, les broches SDA/SCL du connecteur 10 broches sont reliées à D20/D21
  mega.pins.forEach(p => { if (p.id === 'SDA') p.net = 'D20'; if (p.id === 'SCL') p.net = 'D21'; });
  uno.pins.forEach(p => { if (p.id === 'SDA') p.net = 'A4'; if (p.id === 'SCL') p.net = 'A5'; });

  /* ------------------------------------------------------------ Ports Grove des shields */
  // signaux d'un port : [jaune (SIG1), blanc (SIG2), rouge (VCC), noir (GND)]
  function portSignals(board, port) {
    const m = /^([DA])(\d+)$/.exec(port);
    if (m) {
      const n = +m[2];
      const a = m[1] + n, b2 = m[1] + (n + 1);
      return [a, b2, '5V', 'GND'];
    }
    const i2c = board.i2c;
    if (port.startsWith('I2C')) return [i2c.scl, i2c.sda, '5V', 'GND'];
    if (port.startsWith('UART')) return ['D0', 'D1', '5V', 'GND'];
    return null;
  }
  const portKind = port => (port[0] === 'D' ? 'digital' : port[0] === 'A' ? 'analog' : port.startsWith('I2C') ? 'i2c' : 'uart');

  // disposition des ports sur le shield (coordonnées relatives à la carte)
  const SHIELD_UNO = [
    ['D2', 50, 45], ['D3', 95, 45], ['D4', 140, 45], ['D5', 185, 45],
    ['D6', 50, 80], ['D7', 95, 80], ['D8', 140, 80], ['UART', 185, 80],
    ['I2C_1', 50, 115], ['I2C_2', 95, 115], ['I2C_3', 140, 115], ['I2C_4', 185, 115],
    ['A0', 50, 150], ['A1', 95, 150], ['A2', 140, 150], ['A3', 185, 150]
  ];
  const SHIELD_MEGA = SHIELD_UNO.concat([
    ['D22', 245, 45], ['D24', 245, 80], ['D26', 290, 45], ['D28', 290, 80],
    ['A8', 245, 150], ['A10', 290, 150], ['I2C_5', 245, 115], ['I2C_6', 290, 115]
  ]);
  // shield Grove pour Nano : la Nano est posée au centre d'une carte plus grande
  const SHIELD_NANO = [
    ['D2', 0, -48], ['D3', 45, -48], ['D4', 90, -48], ['D5', 135, -48], ['D6', 180, -48],
    ['D7', 0, -24], ['D8', 45, -24], ['UART', 90, -24], ['I2C_1', 135, -24], ['I2C_2', 180, -24],
    ['A0', 0, 100], ['A1', 45, 100], ['A2', 90, 100], ['A3', 135, 100], ['A6', 180, 100]
  ];
  uno.shieldPorts = SHIELD_UNO;
  mega.shieldPorts = SHIELD_MEGA;
  nano.shieldPorts = SHIELD_NANO;
  [uno, nano, mega].forEach(b => {
    b.portSignals = port => portSignals(b, port);
    b.portKind = portKind;
    b.groveDigitalPorts = () => b.shieldPorts.filter(p => p[0][0] === 'D').map(p => p[0]);
    b.groveAnalogPorts = () => b.shieldPorts.filter(p => p[0][0] === 'A').map(p => p[0]);
  });

  const BOARDS = { uno, nano, mega };
  if (typeof module !== 'undefined' && module.exports) module.exports = BOARDS;
  else root.BOARDS = BOARDS;
})(this);
