// Test de bout en bout dans Chromium : ouverture du fichier HTML unique, exemples, simulation, captures.
// Utilisation : NODE_PATH=$(npm root -g) node tests/browser_test.js [dossier_captures]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const file = 'file://' + path.resolve(__dirname, '../dist/simulateur_arduino.html');
const shots = process.argv[2] || path.resolve(__dirname, '../dist/captures');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(file);
  await page.waitForFunction(() => window.APP && window.APP.state && window.APP.state.project);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, '01_accueil.png') });

  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'OK   ' : 'ÉCHEC ') + name + (detail ? ' — ' + detail : '')); };

  // exemple bouton + LED Grove
  await page.evaluate(() => { APP.loadProject(EXAMPLES[1]); APP.start(); });
  await page.waitForTimeout(400);
  let led = await page.evaluate(() => EDITOR.comp('led').rt.on);
  check('LED Grove éteinte au repos', led === false);
  await page.evaluate(() => { const b = EDITOR.comp('btn'); b.rt.active = true; APP.state.sim.interact(); });
  await page.waitForTimeout(300);
  led = await page.evaluate(() => EDITOR.comp('led').rt.on);
  check('LED Grove allumée quand le bouton est appuyé', led === true);
  await page.screenshot({ path: path.join(shots, '02_bouton_led.png') });
  await page.evaluate(() => APP.stop());

  // exemple LCD thermomètre
  await page.evaluate(() => { APP.loadProject(EXAMPLES[3]); APP.start(); });
  await page.waitForTimeout(1200);
  const lcd = await page.evaluate(() => EDITOR.comp('lcd').rt.lcd.lines[0].join(''));
  check('LCD affiche la température', /^Temp: 2\d\.\d °C/.test(lcd), JSON.stringify(lcd));
  await page.screenshot({ path: path.join(shots, '03_lcd.png') });
  await page.evaluate(() => APP.stop());

  // feu tricolore sur plaque d'essai
  await page.evaluate(() => { APP.loadProject(EXAMPLES[4]); APP.start(); });
  await page.waitForTimeout(700);
  const bright = await page.evaluate(() => [0, 1, 2].map(i => (EDITOR.comp('l' + i).rt.bright || [0])[0]));
  check('Feu tricolore : LED verte allumée seule', bright[2] > 0.5 && bright[0] === 0 && bright[1] === 0, JSON.stringify(bright));
  const burned = await page.evaluate(() => [0, 1, 2].some(i => EDITOR.comp('l' + i).rt.burned));
  check('Aucune LED grillée (résistances présentes)', !burned);
  await page.screenshot({ path: path.join(shots, '04_feu_tricolore.png') });
  await page.evaluate(() => APP.stop());

  // radar : ultrason + barre de LED + moniteur série
  await page.evaluate(() => { APP.loadProject(EXAMPLES[5]); APP.start(); });
  await page.waitForTimeout(800);
  const radar = await page.evaluate(() => ({ level: EDITOR.comp('bar').rt.level, serial: document.querySelector('#serial-out').textContent }));
  check('Barre de LED pilotée par la distance', radar.level > 0 && radar.level < 10, 'niveau ' + radar.level);
  check('Moniteur série reçoit la distance', /Distance : 40 cm/.test(radar.serial), JSON.stringify(radar.serial.slice(0, 60)));
  await page.screenshot({ path: path.join(shots, '05_radar.png') });
  await page.evaluate(() => APP.stop());

  // traceur
  await page.evaluate(() => { APP.loadProject(EXAMPLES[6]); APP.start(); });
  await page.click('[data-tab="plot"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, '06_traceur.png') });
  await page.evaluate(() => APP.stop());

  // code Arduino généré
  await page.evaluate(() => APP.loadProject(EXAMPLES[3]));
  await page.click('[data-ctab="text"]');
  await page.waitForTimeout(300);
  const code = await page.evaluate(() => document.querySelector('#code-view').textContent);
  check('Code .ino généré', code.includes('rgb_lcd lcd;') && code.includes('void loop()'), code.length + ' caractères');
  await page.screenshot({ path: path.join(shots, '07_code.png') });
  await page.click('[data-ctab="blocks"]');

  // Nano et Mega
  for (const [i, name] of [[7, 'nano'], [0, 'uno']]) {
    await page.evaluate(n => { APP.loadProject(EXAMPLES[n]); APP.start(); }, i);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, `08_${name}.png`) });
    await page.evaluate(() => APP.stop());
  }
  await page.selectOption('#board-select', 'mega');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '09_mega.png') });

  check('Aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `${failed} échec(s)` : 'Tous les tests navigateur sont passés.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
