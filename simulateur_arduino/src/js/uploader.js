/*
 * Téléversement vers une vraie carte par USB (API Web Serial de Chrome / Edge),
 * sans IDE ni logiciel à installer.
 *   - Uno, Nano : protocole STK500 v1 (Optiboot 115200 bauds, ancien bootloader Nano 57600 bauds)
 *   - Mega 2560 : protocole STK500 v2 (115200 bauds)
 * Le même objet sert aussi au moniteur série de la carte réelle.
 */
(function (root) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class UploadError extends Error {}

  /* ---------------------------------------------------------------- accès au port série */
  class PortIO {
    constructor(port) {
      this.port = port;
      this.buf = [];
      this.waiters = [];
      this.reading = false;
    }
    async open(baud) {
      await this.port.open({ baudRate: baud, bufferSize: 4096 });
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      this.reading = true;
      this.loop = (async () => {
        try {
          while (this.reading) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) {
              for (const b of value) this.buf.push(b);
              this.waiters.forEach(w => w());
            }
          }
        } catch (e) { /* port fermé */ }
      })();
    }
    async close() {
      this.reading = false;
      try { await this.reader.cancel(); } catch (e) { /* déjà fermé */ }
      try { this.reader.releaseLock(); } catch (e) { /* déjà libéré */ }
      try { this.writer.releaseLock(); } catch (e) { /* déjà libéré */ }
      try { await this.port.close(); } catch (e) { /* déjà fermé */ }
    }
    flush() { this.buf.length = 0; }
    async write(bytes) { await this.writer.write(Uint8Array.from(bytes)); }
    async read(n, timeout) {
      const end = Date.now() + timeout;
      while (this.buf.length < n) {
        const left = end - Date.now();
        if (left <= 0) throw new UploadError('délai dépassé');
        await new Promise(res => {
          const t = setTimeout(done, left);
          const w = () => { if (this.buf.length >= n) done(); };
          function done() { clearTimeout(t); res(); }
          this.waiters.push(w);
          setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); }, left + 5);
        });
      }
      return this.buf.splice(0, n);
    }
    async resetBoard() {
      // impulsion sur DTR/RTS : le condensateur de la carte provoque un reset
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(250);
      await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await sleep(60);
      this.flush();
    }
  }

  /* ---------------------------------------------------------------- STK500 v1 (Uno, Nano) */
  const V1 = { OK: 0x10, INSYNC: 0x14, CRC_EOP: 0x20 };
  async function v1cmd(io, bytes, respLen, timeout) {
    await io.write([...bytes, V1.CRC_EOP]);
    const r = await io.read(respLen + 2, timeout || 1000);
    if (r[0] !== V1.INSYNC || r[r.length - 1] !== V1.OK) throw new UploadError('réponse inattendue du bootloader');
    return r.slice(1, -1);
  }
  async function v1sync(io) {
    for (let i = 0; i < 8; i++) {
      io.flush();
      await io.write([0x30, V1.CRC_EOP]);
      try {
        const r = await io.read(2, 200);
        if (r[0] === V1.INSYNC && r[1] === V1.OK) {
          await sleep(20);
          io.flush();
          return true;
        }
      } catch (e) { /* on réessaie */ }
    }
    return false;
  }
  async function v1program(io, fw, pages, progress, verify) {
    // paramètres du composant (ignorés par Optiboot, utiles à l'ancien bootloader)
    const ps = fw.pageSize;
    await v1cmd(io, [0x42, 0x86, 0, 0, 1, 1, 1, 1, 3, 0xff, 0xff, 0xff, 0xff, ps >> 8, ps & 0xff, 0x04, 0x00, 0, 0, 0x80, 0], 0);
    await v1cmd(io, [0x50], 0);
    const sig = await v1cmd(io, [0x75], 3);
    if (sig.some((b, i) => b !== fw.signature[i])) {
      throw new UploadError(`microcontrôleur inattendu (signature ${sig.map(b => b.toString(16)).join(' ')}) : avez-vous choisi la bonne carte ?`);
    }
    let done = 0;
    for (const pg of pages) {
      const w = pg.addr >> 1;
      await v1cmd(io, [0x55, w & 0xff, (w >> 8) & 0xff], 0);
      await v1cmd(io, [0x64, ps >> 8, ps & 0xff, 0x46, ...pg.data], 0, 2000);
      progress(++done / pages.length / (verify ? 2 : 1));
    }
    if (verify) {
      for (const pg of pages) {
        const w = pg.addr >> 1;
        await v1cmd(io, [0x55, w & 0xff, (w >> 8) & 0xff], 0);
        const data = await v1cmd(io, [0x74, ps >> 8, ps & 0xff, 0x46], ps, 2000);
        for (let i = 0; i < ps; i++) {
          if (data[i] !== pg.data[i]) throw new UploadError(`erreur de vérification à l'adresse 0x${(pg.addr + i).toString(16)}`);
        }
        progress(0.5 + ++done / pages.length / 2 - 0.5);
      }
    }
    await v1cmd(io, [0x51], 0);
  }

  /* ---------------------------------------------------------------- STK500 v2 (Mega) */
  class V2 {
    constructor(io) { this.io = io; this.seq = 0; }
    async cmd(body, timeout) {
      const seq = this.seq = (this.seq + 1) & 0xff;
      const msg = [0x1B, seq, (body.length >> 8) & 0xff, body.length & 0xff, 0x0E, ...body];
      let ck = 0;
      for (const b of msg) ck ^= b;
      msg.push(ck);
      await this.io.write(msg);
      // lecture de la réponse
      const t = timeout || 1000;
      let start;
      do { start = (await this.io.read(1, t))[0]; } while (start !== 0x1B);
      const head = await this.io.read(4, t);
      const size = (head[1] << 8) | head[2];
      const resp = await this.io.read(size + 1, t);
      if (head[0] !== seq || head[3] !== 0x0E) throw new UploadError('trame STK500v2 invalide');
      if (resp[0] !== body[0] || resp[1] !== 0x00) throw new UploadError('commande refusée par le bootloader');
      return resp.slice(0, size);
    }
  }
  async function v2sync(io) {
    const v2 = new V2(io);
    for (let i = 0; i < 6; i++) {
      io.flush();
      try {
        await v2.cmd([0x01], 300);
        return v2;
      } catch (e) { /* on réessaie */ }
    }
    return null;
  }
  async function v2program(v2, fw, pages, progress, verify) {
    await v2.cmd([0x10, 200, 100, 25, 32, 0, 0x53, 3, 0xAC, 0x53, 0, 0]);
    const sig = [];
    for (let i = 0; i < 3; i++) sig.push((await v2.cmd([0x1B, 4, 0x30, 0, i, 0]))[2]);
    if (sig.some((b, i) => b !== fw.signature[i])) {
      throw new UploadError(`microcontrôleur inattendu (signature ${sig.map(b => b.toString(16)).join(' ')}) : avez-vous choisi la bonne carte ?`);
    }
    const ps = fw.pageSize;
    const load = async addr => {
      const w = (addr >> 1) | 0x80000000;
      await v2.cmd([0x06, (w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff]);
    };
    let done = 0;
    for (const pg of pages) {
      await load(pg.addr);
      await v2.cmd([0x13, ps >> 8, ps & 0xff, 0xC1, 0x0A, 0x40, 0x4C, 0x20, 0, 0, ...pg.data], 2000);
      progress(++done / pages.length / (verify ? 2 : 1));
    }
    if (verify) {
      for (const pg of pages) {
        await load(pg.addr);
        const r = await v2.cmd([0x14, ps >> 8, ps & 0xff, 0x20], 2000);
        const data = r.slice(2, 2 + ps);
        for (let i = 0; i < ps; i++) {
          if (data[i] !== pg.data[i]) throw new UploadError(`erreur de vérification à l'adresse 0x${(pg.addr + i).toString(16)}`);
        }
        progress(0.5 + ++done / pages.length / 2 - 0.5);
      }
    }
    await v2.cmd([0x11, 1, 1]);
  }

  /* ---------------------------------------------------------------- téléversement complet */
  async function upload(port, board, fw, image, opts) {
    opts = opts || {};
    const log = opts.log || (() => {});
    const progress = opts.progress || (() => {});
    const pages = HexUtil.pages(image, fw.pageSize);
    let lastErr = null;
    for (const baud of board.upload.bauds) {
      const io = new PortIO(port);
      try {
        log(`Connexion au bootloader à ${baud} bauds…`);
        await io.open(baud);
        await io.resetBoard();
        if (board.upload.protocol === 'stk500v2') {
          const v2 = await v2sync(io);
          if (!v2) throw new UploadError('pas de réponse');
          log('Bootloader trouvé. Écriture de ' + pages.length + ' pages…');
          await v2program(v2, fw, pages, progress, opts.verify !== false);
        } else {
          if (!(await v1sync(io))) throw new UploadError('pas de réponse');
          log('Bootloader trouvé. Écriture de ' + pages.length + ' pages…');
          await v1program(io, fw, pages, progress, opts.verify !== false);
        }
        await io.close();
        log('Téléversement terminé ✔');
        return { baud };
      } catch (e) {
        lastErr = e;
        await io.close();
        if (e.message !== 'pas de réponse' && e.message !== 'délai dépassé') break;
        log(`Pas de réponse à ${baud} bauds.`);
      }
    }
    throw new UploadError(friendly(lastErr, board));
  }

  function friendly(e, board) {
    const msg = e ? e.message : '';
    if (msg === 'pas de réponse' || msg === 'délai dépassé') {
      return `La carte ne répond pas. Vérifiez :\n• que le câble USB transmet les données (certains câbles ne font que la charge) ;\n` +
        `• que la carte choisie dans le simulateur est bien une ${board.name} ;\n• qu'aucun autre logiciel (IDE Arduino, autre onglet) n'utilise le port ;\n` +
        `• pour une carte clone (puce CH340), que Windows a bien reconnu la carte (voir l'aide).`;
    }
    return 'Échec du téléversement : ' + msg;
  }

  /* ---------------------------------------------------------------- moniteur série de la carte */
  class BoardSerial {
    constructor(port, onText) { this.port = port; this.onText = onText; this.io = null; }
    async open(baud) {
      this.io = new PortIO(this.port);
      await this.port.open({ baudRate: baud });
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      this.running = true;
      const dec = new TextDecoder('utf-8');
      (async () => {
        try {
          while (this.running) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.onText(dec.decode(value, { stream: true }));
          }
        } catch (e) { if (this.running && this.onError) this.onError(e); }
      })();
    }
    async send(text) {
      if (this.writer) await this.writer.write(new TextEncoder().encode(text));
    }
    async close() {
      this.running = false;
      try { await this.reader.cancel(); } catch (e) { /* déjà fermé */ }
      try { this.reader.releaseLock(); } catch (e) { /* déjà libéré */ }
      try { this.writer.releaseLock(); } catch (e) { /* déjà libéré */ }
      try { await this.port.close(); } catch (e) { /* déjà fermé */ }
    }
  }

  const supported = () => typeof navigator !== 'undefined' && 'serial' in navigator;
  async function choosePort(reuse) {
    if (!supported()) throw new UploadError('Le téléversement nécessite Google Chrome ou Microsoft Edge (API Web Serial).');
    if (reuse) {
      const ports = await navigator.serial.getPorts();
      if (ports.length === 1) return ports[0];
    }
    try {
      return await navigator.serial.requestPort();
    } catch (e) {
      throw new UploadError('Aucun port choisi.');
    }
  }

  const API = { upload, BoardSerial, choosePort, supported, UploadError, PortIO, _v1program: v1program, _v1sync: v1sync, _v2sync: v2sync, _v2program: v2program };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Uploader = API;
})(this);
