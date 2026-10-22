// Génère la police 5x7 (ASCII 32..126 + « ° » en position 127) pour le micrologiciel et le simulateur.
// Police d'origine : oled-font-5x7 (MIT, Suz Hinton) — voir tools/oled-font-5x7.LICENSE
const fs = require('fs');
const path = require('path');
const f = require('./oled-font-5x7.js');
const glyph = ch => {
  if (ch === '~') return [0x08, 0x04, 0x08, 0x10, 0x08]; // absent de la police d'origine
  const i = f.lookup.indexOf(ch);
  if (i < 0) throw new Error('caractère absent : ' + ch);
  return f.fontData.slice(i * 5, i * 5 + 5);
};
const bytes = [];
for (let c = 32; c <= 126; c++) bytes.push(...glyph(String.fromCharCode(c)));
bytes.push(...glyph('°'));
const hex = bytes.map(b => '0x' + b.toString(16).padStart(2, '0'));
fs.writeFileSync(path.join(__dirname, '../firmware/font5x7.h'),
  '// FICHIER GÉNÉRÉ par tools/gen_font.js (police oled-font-5x7, licence MIT)\n#pragma once\n' +
  '// 96 caractères : ASCII 32..126 puis le symbole degré (indice 95)\n' +
  'static const uint8_t FONT5X7[] PROGMEM = {\n' + hex.join(',') + '\n};\n');
fs.writeFileSync(path.join(__dirname, '../src/js/font5x7.js'),
  '// FICHIER GÉNÉRÉ par tools/gen_font.js (police oled-font-5x7, licence MIT)\n' +
  '// ASCII 32..126 puis le symbole degré ; 5 colonnes par caractère, bit 0 = ligne du haut\n' +
  'const FONT5X7 = [' + bytes.join(',') + '];\n');
console.log('police générée :', bytes.length / 5, 'caractères');
