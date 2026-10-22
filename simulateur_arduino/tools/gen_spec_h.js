// Génère firmware/vm_spec.h à partir de src/js/vm_spec.js
const fs = require('fs');
const path = require('path');
const S = require('../src/js/vm_spec.js');

const out = [];
out.push('// FICHIER GÉNÉRÉ par tools/gen_spec_h.js — ne pas modifier à la main');
out.push('#pragma once');
out.push(`#define VM_VERSION ${S.VERSION}`);
out.push(`#define VM_HEADER_SIZE ${S.HEADER_SIZE}`);
for (const k in S.OP) out.push(`#define OP_${k} 0x${S.OP[k].toString(16).padStart(2, '0')}`);
S.MATHFN.forEach((m, i) => out.push(`#define MF_${m[0].toUpperCase()} ${i}`));
S.SYS.forEach((s, i) => out.push(`#define SYS_${s[0].toUpperCase()} ${i}`));
out.push(`#define SYS_COUNT ${S.SYS.length}`);
out.push('// nombre d\'arguments et retour (bit 7) de chaque appel système');
out.push('static const uint8_t SYS_INFO[] PROGMEM = {' +
  S.SYS.map(s => s[1] | (s[2] ? 0x80 : 0)).join(',') + '};');
out.push('static const uint8_t MATH_ARGS[] PROGMEM = {' + S.MATHFN.map(m => m[1]).join(',') + '};');
for (const k in S.TARGET) out.push(`#define TGT_${k} ${S.TARGET[k]}`);
fs.writeFileSync(path.join(__dirname, '../firmware/vm_spec.h'), out.join('\n') + '\n');
console.log('firmware/vm_spec.h écrit');
