// Teste les protocoles de téléversement avec de faux bootloaders (Optiboot STK500v1 et Mega STK500v2)
global.HexUtil = require('../src/js/hexutil.js');
const assert = require('assert');
const Uploader = require('../src/js/uploader.js');
const FIRMWARE = require('../src/js/firmware_data.js');
const BOARDS = require('../src/js/boards.js');

// faux port Web Serial branché sur un bootloader simulé
function fakePort(device) {
  let pending = null;
  const queue = [];
  const push = bytes => { queue.push(Uint8Array.from(bytes)); if (pending) { const p = pending; pending = null; p(); } };
  device.reply = push;
  return {
    opened: null,
    async open(o) { this.opened = o.baudRate; device.baud = o.baudRate; },
    async close() {},
    async setSignals(s) { if (s.dataTerminalReady) device.reset(); },
    readable: { getReader: () => ({
      async read() {
        while (!queue.length) await new Promise(r => { pending = r; });
        return { value: queue.shift(), done: false };
      },
      async cancel() { push([]); },
      releaseLock() {}
    }) },
    writable: { getWriter: () => ({ async write(b) { device.receive(Array.from(b)); }, releaseLock() {} }) }
  };
}

function optiboot(fw, wantBaud) {
  const flash = new Uint8Array(fw.flashSize).fill(0xFF);
  let addr = 0, buf = [];
  const d = {
    flash, baud: 0,
    reset() { buf = []; },
    receive(bytes) {
      if (d.baud !== wantBaud) return;   // mauvaise vitesse : rien ne répond
      buf.push(...bytes);
      for (;;) {
        if (!buf.length) return;
        const c = buf[0];
        const need = { 0x30: 2, 0x42: 22, 0x50: 2, 0x51: 2, 0x75: 2, 0x55: 4, 0x74: 5 }[c];
        if (c === 0x64) {
          if (buf.length < 5) return;
          const n = (buf[1] << 8) | buf[2];
          if (buf.length < 5 + n) return;
          const data = buf.slice(4, 4 + n);
          flash.set(data, addr);
          buf = buf.slice(5 + n);
          d.reply([0x14, 0x10]);
          continue;
        }
        if (!need || buf.length < need) return;
        const cmd = buf.splice(0, need);
        if (c === 0x75) d.reply([0x14, ...fw.signature, 0x10]);
        else if (c === 0x55) { addr = (cmd[1] | (cmd[2] << 8)) * 2; d.reply([0x14, 0x10]); }
        else if (c === 0x74) { const n = (cmd[1] << 8) | cmd[2]; d.reply([0x14, ...flash.slice(addr, addr + n), 0x10]); }
        else d.reply([0x14, 0x10]);
      }
    }
  };
  return d;
}

function megaBoot(fw) {
  const flash = new Uint8Array(fw.flashSize).fill(0xFF);
  let addr = 0, buf = [];
  const d = {
    flash, baud: 0, reset() { buf = []; },
    receive(bytes) {
      buf.push(...bytes);
      while (buf.length >= 6) {
        if (buf[0] !== 0x1B) { buf.shift(); continue; }
        const size = (buf[2] << 8) | buf[3];
        if (buf.length < 6 + size) return;
        const msg = buf.splice(0, 6 + size);
        const seq = msg[1], body = msg.slice(5, 5 + size);
        let ck = 0; for (const b of msg.slice(0, -1)) ck ^= b;
        assert.strictEqual(ck, msg[msg.length - 1], 'somme de contrôle STK500v2');
        let resp;
        switch (body[0]) {
          case 0x01: resp = [0x01, 0x00, 8, ...Buffer.from('AVRISP_2')]; break;
          case 0x1B: resp = [0x1B, 0x00, fw.signature[body[4]], 0x00]; break;
          case 0x06: addr = ((((body[1] & 0x7f) << 24) | (body[2] << 16) | (body[3] << 8) | body[4]) >>> 0) * 2; resp = [0x06, 0x00]; break;
          case 0x13: { const n = (body[1] << 8) | body[2]; flash.set(body.slice(10, 10 + n), addr); addr += n; resp = [0x13, 0x00]; break; }
          case 0x14: { const n = (body[1] << 8) | body[2]; resp = [0x14, 0x00, ...flash.slice(addr, addr + n), 0x00]; addr += n; break; }
          default: resp = [body[0], 0x00];
        }
        const out = [0x1B, seq, resp.length >> 8, resp.length & 0xff, 0x0E, ...resp];
        let c2 = 0; for (const b of out) c2 ^= b;
        out.push(c2);
        d.reply(out);
      }
    }
  };
  return d;
}

(async () => {
  const prog = Uint8Array.from([86, 77, 1, 0, 16, 0, 17, 0, 18, 0, 1, 0, 0, 0, 0, 0, 0x2C, 0x2C]);
  // Uno (Optiboot 115200)
  {
    const fw = FIRMWARE.images.atmega328p;
    const image = HexUtil.buildImage(fw, prog);
    const dev = optiboot(fw, 115200);
    await Uploader.upload(fakePort(dev), BOARDS.uno, fw, image, { log: () => {} });
    for (let i = 0; i < image.length; i++) assert.strictEqual(dev.flash[i], image[i], 'octet ' + i);
    console.log('OK Uno : image écrite et vérifiée (' + image.length + ' octets)');
  }
  // Nano avec ancien bootloader (57600) : la première vitesse échoue puis la seconde fonctionne
  {
    const fw = FIRMWARE.images.atmega328p;
    const image = HexUtil.buildImage(fw, prog);
    const dev = optiboot(fw, 57600);
    const logs = [];
    const r = await Uploader.upload(fakePort(dev), BOARDS.nano, fw, image, { log: m => logs.push(m) });
    assert.strictEqual(r.baud, 57600);
    for (let i = 0; i < image.length; i++) assert.strictEqual(dev.flash[i], image[i]);
    console.log('OK Nano ancien bootloader : 57600 bauds après échec à 115200');
  }
  // Mega (STK500v2)
  {
    const fw = FIRMWARE.images.atmega2560;
    const image = HexUtil.buildImage(fw, prog);
    const dev = megaBoot(fw);
    await Uploader.upload(fakePort(dev), BOARDS.mega, fw, image, { log: () => {} });
    for (let i = 0; i < image.length; i++) assert.strictEqual(dev.flash[i], image[i], 'octet ' + i);
    console.log('OK Mega : image écrite et vérifiée (' + image.length + ' octets)');
  }
  // mauvaise carte : signature différente
  {
    const fw = FIRMWARE.images.atmega328p;
    const dev = optiboot(Object.assign({}, fw, { signature: [0x1e, 0x98, 0x01] }), 115200);
    await assert.rejects(Uploader.upload(fakePort(dev), BOARDS.uno, fw, HexUtil.buildImage(fw, prog), {}), /bonne carte/);
    console.log('OK mauvaise carte détectée');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
