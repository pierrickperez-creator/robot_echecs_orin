// Génère docs/MODULES.md : liste des composants et leur prise en charge (simulateur / vraie carte)
const fs = require('fs');
const path = require('path');
const CATALOG = require('../src/js/catalog.js');
const FIRMWARE = require('../src/js/firmware_data.js');

const KIND_SYS = { ultrasonic: 'ultrasonicCm', dht: 'dhtRead', thi2c: 'thI2CRead', baro: 'baroRead', accel: 'accelRead',
  lcd: 'lcdClear', oled: 'oledClear', tm1637: 'tm1637Number', ledbar: 'ledBarLevel', chain: 'chainRGB', pixels: 'pixelSet',
  servo: 'servoWrite', buzzer: 'tone', gesture: 'gestureRead', co2: 'co2Read', encoder: 'encoderRead', ir: 'irRead',
  rfid: 'rfidRead', keypad: 'keypadRead', mp3: 'mp3Play', color: 'colorRead', irtemp: 'irTempRead', motor: 'motorI2C', rtc: 'rtcRead' };
const uno = FIRMWARE.images.atmega328p.sys, mega = FIRMWARE.images.atmega2560.sys;

function support(def) {
  if (def.kind === 'none') return ['non simulé', '—'];
  if (def.kind === 'hub') return ['oui', 'oui'];
  let sys = (def.sim && def.sim.sys) || KIND_SYS[def.kind];
  if (def.simOnly) sys = def.simOnly[0];
  if (!sys) return ['oui', 'oui'];
  const u = uno.includes(sys), m = mega.includes(sys);
  return ['oui', u && m ? 'oui' : m ? 'Mega seulement' : 'pas encore'];
}

const conn = { digital: 'numérique (D)', analog: 'analogique (A)', i2c: 'I2C', uart: 'série (UART)' };
let md = '# Composants disponibles\n\n';
md += 'Fichier généré par `node tools/gen_modules_md.js`. « Carte réelle » indique si le micrologiciel téléversé sait piloter le module ';
md += '(Uno/Nano : mémoire limitée ; certains pilotes ne sont présents que sur la Mega).\n\n';
md += `Total : **${CATALOG.list.length} composants**, dont **${CATALOG.list.filter(c => c.type.startsWith('grove_')).length} modules Grove**.\n`;
for (const g of CATALOG.groups) {
  md += `\n## ${g}\n\n| Composant | Port Grove | Simulateur | Carte réelle | Réf. Seeed |\n|---|---|---|---|---|\n`;
  for (const c of CATALOG.list.filter(x => x.group === g)) {
    const [s, r] = support(c);
    md += `| ${c.name} | ${conn[c.conn] || '—'} | ${s} | ${r} | ${c.ref || ''} |\n`;
  }
}
fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../docs/MODULES.md'), md);
console.log('docs/MODULES.md écrit');
