// Exécute le micrologiciel réel (ATmega328P) dans l'émulateur avr8js pour vérifier
// que la carte produit les mêmes sorties que le simulateur JavaScript.
const avr = require('avr8js');
const HexUtil = require('../src/js/hexutil.js');
const FIRMWARE = require('../src/js/firmware_data.js');

function runFirmware(progBytes, opts) {
  opts = opts || {};
  const fw = FIRMWARE.images.atmega328p;
  const image = HexUtil.buildImage(fw, progBytes);
  const flash = new Uint8Array(0x8000);
  flash.set(image);
  const program = new Uint16Array(flash.buffer);
  const cpu = new avr.CPU(program);
  new avr.AVRTimer(cpu, avr.timer0Config);
  new avr.AVRTimer(cpu, avr.timer1Config);
  new avr.AVRTimer(cpu, avr.timer2Config);
  const usart = new avr.AVRUSART(cpu, avr.usart0Config, 16e6);
  const portB = new avr.AVRIOPort(cpu, avr.portBConfig);
  const portC = new avr.AVRIOPort(cpu, avr.portCConfig);
  const portD = new avr.AVRIOPort(cpu, avr.portDConfig);
  const adc = new avr.AVRADC(cpu, avr.adcConfig);
  // bus I2C : opts.i2c = { adresse: { write(octet), read() -> octet, start(), stop() } }
  const twi = new avr.AVRTWI(cpu, avr.twiConfig, 16e6);
  const i2cLog = [];
  if (opts.i2c) {
    let dev = null, cur = null;
    twi.eventHandler = {
      start() { twi.completeStart(); },
      stop() { if (cur) i2cLog.push(cur); cur = null; if (dev && dev.stop) dev.stop(); dev = null; twi.completeStop(); },
      connectToSlave(addr, write) {
        if (cur) i2cLog.push(cur);
        dev = opts.i2c[addr] || null;
        cur = { addr, write, bytes: [] };
        if (dev && dev.start) dev.start(write);
        twi.completeConnect(!!dev);
      },
      writeByte(v) { cur.bytes.push(v); if (dev) dev.write(v); twi.completeWrite(!!dev); },
      readByte() { const v = dev ? dev.read() : 0xFF; cur.bytes.push(v); twi.completeRead(v); }
    };
  }
  // suivi des changements de broches : opts.onPin(port, valeur, cycles)
  if (opts.onPin) {
    portB.addListener(v => opts.onPin('B', v, cpu.cycles));
    portD.addListener(v => opts.onPin('D', v, cpu.cycles));
  }
  if (opts.setup) opts.setup({ cpu, portB, portC, portD, adc, twi });
  if (opts.adc) opts.adc.forEach((v, i) => { adc.channelValues[i] = v; });
  let serial = '';
  usart.onByteTransmit = b => { serial += String.fromCharCode(b); };
  const events = [];
  const pinState = () => ({ b: portB.pinState.bind(portB), d: portD.pinState.bind(portD) });
  let last13 = null;
  const seconds = opts.seconds || 1;
  const end = 16e6 * seconds;
  while (cpu.cycles < end) {
    avr.avrInstruction(cpu);
    cpu.tick();
    if (opts.step) opts.step(cpu);
    if ((cpu.cycles & 0x3FF) === 0) {
      const v = portB.pinState(5) === avr.PinState.High ? 1 : 0;
      if (v !== last13) { events.push({ ms: Math.round(cpu.cycles / 16000), pin13: v }); last13 = v; }
    }
  }
  return { serial, events, cpu, ports: { portB, portC, portD }, i2cLog };
}

module.exports = { runFirmware };
