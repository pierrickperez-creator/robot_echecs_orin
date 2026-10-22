/*
 * Lecture des fichiers Intel HEX et préparation de l'image à téléverser :
 * le bytecode de l'élève est copié dans la zone userProg du micrologiciel.
 */
(function (root) {
  function parseHex(text) {
    const mem = new Map();
    let base = 0, maxAddr = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] !== ':') throw new Error('Fichier HEX invalide');
      const bytes = [];
      for (let i = 1; i < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
      const len = bytes[0], addr = (bytes[1] << 8) | bytes[2], type = bytes[3];
      let sum = 0;
      for (const b of bytes) sum = (sum + b) & 0xFF;
      if (sum !== 0) throw new Error('Somme de contrôle HEX invalide');
      if (type === 0) {
        for (let i = 0; i < len; i++) {
          const a = base + addr + i;
          mem.set(a, bytes[4 + i]);
          if (a + 1 > maxAddr) maxAddr = a + 1;
        }
      } else if (type === 1) break;
      else if (type === 2) base = ((bytes[4] << 8) | bytes[5]) << 4;
      else if (type === 4) base = ((bytes[4] << 8) | bytes[5]) << 16;
    }
    const data = new Uint8Array(maxAddr).fill(0xFF);
    for (const [a, v] of mem) data[a] = v;
    return data;
  }

  // image du micrologiciel + programme ; renvoie un Uint8Array arrondi à la page
  function buildImage(fw, progBytes) {
    if (progBytes.length > fw.progSize) {
      throw new Error(`Programme trop long pour cette carte (${progBytes.length} octets, maximum ${fw.progSize}).`);
    }
    const img = parseHex(fw.hex);
    const size = Math.ceil(img.length / fw.pageSize) * fw.pageSize;
    const out = new Uint8Array(size).fill(0xFF);
    out.set(img);
    out.set(progBytes, fw.progAddr);
    return out;
  }

  // liste des pages à écrire : on saute les pages entièrement vides (0xFF)
  function pages(image, pageSize) {
    const list = [];
    for (let a = 0; a < image.length; a += pageSize) {
      const chunk = image.subarray(a, a + pageSize);
      if (chunk.some(b => b !== 0xFF)) list.push({ addr: a, data: chunk });
    }
    return list;
  }

  // fichier .hex du programme complet (pour téléverser avec un autre outil, ex. avrdude/XLoader)
  function toHex(image) {
    const lines = [];
    let ext = -1;
    for (let a = 0; a < image.length; a += 16) {
      const chunk = image.subarray(a, Math.min(a + 16, image.length));
      if (chunk.every(b => b === 0xFF)) continue;
      const hi = a >> 16;
      if (hi !== ext) {
        ext = hi;
        const rec = [2, 0, 0, 4, (hi >> 8) & 0xFF, hi & 0xFF];
        lines.push(record(rec));
      }
      const rec = [chunk.length, (a >> 8) & 0xFF, a & 0xFF, 0, ...chunk];
      lines.push(record(rec));
    }
    lines.push(':00000001FF');
    return lines.join('\n') + '\n';
  }
  function record(bytes) {
    let sum = 0;
    for (const b of bytes) sum = (sum + b) & 0xFF;
    bytes.push((0x100 - sum) & 0xFF);
    return ':' + bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  }

  const API = { parseHex, buildImage, pages, toHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HexUtil = API;
})(this);
