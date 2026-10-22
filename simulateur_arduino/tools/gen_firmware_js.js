// Génère src/js/firmware_data.js à partir des images compilées par firmware/build.sh
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const S = require('../src/js/vm_spec.js');

const fw = {};
for (const [name, cfg] of Object.entries({
  atmega328p: { progSize: 4608, pageSize: 128, signature: [0x1e, 0x95, 0x0f], flashSize: 32768 - 512 },
  atmega2560: { progSize: 16384, pageSize: 256, signature: [0x1e, 0x98, 0x01], flashSize: 262144 - 8192 }
})) {
  const dir = path.join(out, name);
  const hex = fs.readFileSync(path.join(dir, 'vm.hex'), 'utf8');
  const progAddr = parseInt(fs.readFileSync(path.join(dir, 'prog_addr.txt'), 'utf8').trim(), 16);
  // appels système réellement compilés pour cette puce (les autres renvoient 0 sur la carte)
  const ids = fs.readFileSync(path.join(dir, 'sys_ids.txt'), 'utf8').split(/\s+/).filter(Boolean).map(Number);
  const sys = ids.map(i => S.SYS[i][0]);
  fw[name] = Object.assign({ hex, progAddr, sys }, cfg);
}
const js = '// FICHIER GÉNÉRÉ par tools/gen_firmware_js.js (firmware/build.sh) — ne pas modifier\n' +
  'const FIRMWARE = ' + JSON.stringify({ built: new Date().toISOString().slice(0, 10), images: fw }) + ';\n' +
  "if (typeof module !== 'undefined') module.exports = FIRMWARE;\n";
fs.writeFileSync(path.join(__dirname, '../src/js/firmware_data.js'), js);
console.log('src/js/firmware_data.js écrit ;', Object.entries(fw).map(([k, v]) => `${k}: ${v.sys.length}/${S.SYS.length} appels`).join(', '));
