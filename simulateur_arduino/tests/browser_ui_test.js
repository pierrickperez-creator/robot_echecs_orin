// Test des interactions à la souris dans Chromium
// Utilisation : NODE_PATH=$(npm root -g) node tests/browser_ui_test.js [dossier_captures]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const file = 'file://' + path.resolve(__dirname, '../dist/simulateur_arduino.html');
const shots = process.argv[2] || path.resolve(__dirname, '../dist/captures');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(file);
  await page.waitForFunction(() => window.APP && window.APP.state && window.APP.state.project);
  await page.keyboard.press('Escape');   // ferme l'écran d'accueil
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'OK   ' : 'ÉCHEC ') + name + (detail ? ' — ' + detail : '')); };

  // nouveau projet vide (Uno + shield)
  await page.click('[data-menu="file"]');
  await page.click('[data-act="new"]');
  await page.waitForTimeout(300);
  // coordonnées écran d'un point du circuit
  const screen = async (x, y) => page.evaluate(([x, y]) => {
    const r = document.querySelector('#circuit').getBoundingClientRect();
    const v = EDITOR.view;
    return { x: r.left + (x - v.x) * v.s, y: r.top + (y - v.y) * v.s };
  }, [x, y]);

  // 1) poser une plaque d'essai et une LED par clic dans la bibliothèque puis dans le circuit
  await page.click('.lib-item[data-type="breadboard"]');
  let p = await screen(320, 0);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
  let n = await page.evaluate(() => APP.state.project.circuit.comps.length);
  check('Plaque d\'essai ajoutée par clic', n === 2, n + ' pièces');

  // 2) glisser-déposer d'un module Grove : branché automatiquement sur un port libre
  await page.fill('#lib-search', 'bouton');
  await page.waitForTimeout(100);
  const dst = await screen(340, 20);
  const box = await page.locator('#circuit').boundingBox();
  await page.locator('.lib-item[data-type="grove_button"]').dragTo(page.locator('#circuit'), { targetPosition: { x: box.width * 0.4, y: 60 } });
  void dst;
  await page.waitForTimeout(300);
  const cable = await page.evaluate(() => APP.state.project.circuit.cables.map(c => c.port).join(','));
  check('Module Grove déposé et branché automatiquement', cable === 'D2', cable);
  await page.screenshot({ path: path.join(shots, '10_ui_ajout.png') });

  // 3) changer le port dans le panneau des propriétés
  await page.selectOption('#props [data-port]', 'D3');
  await page.waitForTimeout(100);
  const port = await page.evaluate(() => APP.state.project.circuit.cables[0].port);
  check('Port changé depuis le panneau', port === 'D3', port);

  await page.evaluate(() => { EDITOR.select(null); EDITOR.fit(); });
  // 4) tirer un fil de la broche D13 vers le trou a5 de la plaque (clic, clic)
  const pinPos = await page.evaluate(() => {
    const b = EDITOR.boardComp();
    const pin = BOARDS.uno.pins.find(q => q.id === 'D13');
    const bb = APP.state.project.circuit.comps.find(c => c.type === 'breadboard');
    const hole = PARTS.BB_PINS.find(h => h.id === 'a5');
    return { a: { x: b.x + pin.x, y: b.y + pin.y }, b: { x: bb.x + hole.x, y: bb.y + hole.y } };
  });
  await page.mouse.move(0, 0);
  p = await screen(pinPos.a.x, pinPos.a.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await page.mouse.up();
  p = await screen(pinPos.b.x, pinPos.b.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(200);
  const wire = await page.evaluate(() => APP.state.project.circuit.wires.map(w => w.a.p + '→' + w.b.p).join(','));
  check('Fil tiré de D13 vers a5', wire === 'D13→a5', wire);

  // 5) poser une LED rouge dans la plaque et une résistance, programme clignotant
  await page.evaluate(() => {
    const bb = APP.state.project.circuit.comps.find(c => c.type === 'breadboard');
    const h = id => { const q = PARTS.BB_PINS.find(x => x.id === id); return { x: bb.x + q.x, y: bb.y + q.y }; };
    let a = h('c9'); EDITOR.addComponent('led_red', a.x, a.y);
    a = h('b5'); EDITOR.addComponent('resistor', a.x, a.y);
  });
  await page.evaluate(() => { EDITOR.select(null); EDITOR.fit(); });
  // fil de la cathode (colonne 10) vers GND
  const g = await page.evaluate(() => {
    const bb = APP.state.project.circuit.comps.find(c => c.type === 'breadboard');
    const q = PARTS.BB_PINS.find(x => x.id === 'a10');
    const b = EDITOR.boardComp();
    const pin = BOARDS.uno.pins.find(x => x.id === 'GND_T');
    return { a: { x: bb.x + q.x, y: bb.y + q.y }, b: { x: b.x + pin.x, y: b.y + pin.y } };
  });
  p = await screen(g.a.x, g.a.y);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  p = await screen(g.b.x, g.b.y);
  await page.mouse.move(p.x, p.y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const nw = await page.evaluate(() => APP.state.project.circuit.wires.length);
  check('Fil tiré par glisser-déposer', nw === 2, nw + ' fils');

  // programme : LED13 = état du bouton Grove (D3)
  await page.evaluate(() => {
    APP.workspace().clear();
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [
      { type: 'ard_setup', x: 10, y: 10 },
      { type: 'ard_loop', x: 10, y: 120, inputs: { DO: { block: {
        type: 'ard_digital_write', fields: { PIN: 'D13' },
        inputs: { VALUE: { block: { type: 'grove_din', fields: { MOD: 'grove_button', PORT: 'D3' } } } } } } } }
    ] } }, APP.workspace());
  });
  await page.click('#btn-run');
  await page.waitForTimeout(300);
  let bright = await page.evaluate(() => APP.state.project.circuit.comps.find(c => c.type === 'led_red').rt.bright[0]);
  check('LED éteinte avant appui', bright === 0, bright);
  await page.evaluate(() => { EDITOR.select(null); EDITOR.fit(); });
  // clic maintenu sur le module bouton dans le circuit
  const btnPos = await page.evaluate(() => { const c = APP.state.project.circuit.comps.find(x => x.type === 'grove_button'); return { x: c.x + 40, y: c.y + 38 }; });
  p = await screen(btnPos.x, btnPos.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(300);
  bright = await page.evaluate(() => APP.state.project.circuit.comps.find(c => c.type === 'led_red').rt.bright[0]);
  const burned = await page.evaluate(() => APP.state.project.circuit.comps.find(c => c.type === 'led_red').rt.burned);
  check('LED allumée pendant l\'appui (via la résistance)', bright > 0.5 && !burned, 'luminosité ' + bright);
  await page.screenshot({ path: path.join(shots, '11_ui_simulation.png') });
  await page.mouse.up();
  await page.waitForTimeout(250);
  bright = await page.evaluate(() => APP.state.project.circuit.comps.find(c => c.type === 'led_red').rt.bright[0]);
  check('LED éteinte après relâchement', bright === 0, bright);
  await page.click('#btn-run');

  // 6) supprimer la résistance : la LED grille au prochain lancement
  await page.evaluate(() => {
    const r = APP.state.project.circuit.comps.find(c => c.type === 'resistor');
    EDITOR.select({ comp: r.id });
  });
  await page.keyboard.press('Delete');
  await page.evaluate(() => {
    const bb = APP.state.project.circuit.comps.find(c => c.type === 'breadboard');
    EDITOR.c.wires.push({ id: 'pont', a: { c: bb.id, p: 'a5' }, b: { c: bb.id, p: 'a9' }, pts: [], color: '#2e7d32' });
    EDITOR.render();
  });
  await page.click('#btn-run');
  const btn = await page.evaluate(() => APP.state.project.circuit.comps.find(x => x.type === 'grove_button'));
  await page.evaluate(() => { const b = APP.state.project.circuit.comps.find(x => x.type === 'grove_button'); b.rt.active = true; APP.state.sim.interact(); });
  await page.waitForTimeout(300);
  const msgs = await page.evaluate(() => APP.messages.map(m => m.text).join(' | '));
  check('LED grillée sans résistance + message', /grillé/.test(msgs), msgs.slice(0, 160));
  await page.screenshot({ path: path.join(shots, '12_ui_led_grillee.png') });
  await page.click('#btn-run');

  // 7) annuler (Ctrl+Z) restaure la résistance
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const hasR = await page.evaluate(() => APP.state.project.circuit.comps.some(c => c.type === 'resistor'));
  check('Annuler restaure la résistance', hasR);

  // 8) export du .ino et du projet (téléchargements)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { document.querySelector('[data-act="export-ino"]').click(); })]);
  const ino = fs.readFileSync(await dl.path(), 'utf8');
  check('Export .ino', ino.includes('void loop()') && ino.includes('digitalWrite(13, digitalRead(3) == HIGH)'), dl.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { document.querySelector('[data-act="save"]').click(); })]);
  const saved = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  check('Enregistrement du projet (.json)', saved.format === 'simulateur-arduino' && saved.circuit.comps.length >= 4);
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { document.querySelector('[data-act="export-hex"]').click(); })]);
  const hex = fs.readFileSync(await dl3.path(), 'utf8');
  check('Export .hex', hex.startsWith(':') && hex.trim().endsWith(':00000001FF'), hex.split('\n').length + ' lignes');

  // 9) rechargement de la page : sauvegarde automatique
  await page.reload();
  await page.waitForFunction(() => window.APP && window.APP.state && window.APP.state.project);
  const nAfter = await page.evaluate(() => APP.state.project.circuit.comps.length);
  check('Sauvegarde automatique après rechargement', nAfter === saved.circuit.comps.length, nAfter + ' pièces');

  // 10) mode enseignant : consigne + verrouillage
  await page.click('[data-menu="file"]');
  await page.click('[data-act="teacher"]');
  await page.fill('#ex-title', 'Exercice : bouton et LED');
  await page.fill('#ex-text', '# Objectif\nAllumez la LED quand on appuie sur le bouton.\n- utilisez **D13**');
  await page.check('#ex-lock');
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('#ex-save')]);
  const exo = JSON.parse(fs.readFileSync(await dl4.path(), 'utf8'));
  check('Exercice enregistré avec consigne', exo.exercise && exo.exercise.locked && /Objectif/.test(exo.exercise.text));
  // un élève ouvre l'exercice : circuit verrouillé
  await page.evaluate(p => { APP.state.teacher = false; APP.loadProject(p); }, exo);
  await page.evaluate(() => { const r = APP.state.project.circuit.comps.find(c => c.type === 'resistor'); EDITOR.select({ comp: r.id }); });
  await page.keyboard.press('Delete');
  const stillR = await page.evaluate(() => APP.state.project.circuit.comps.some(c => c.type === 'resistor'));
  check('Circuit verrouillé pour l\'élève', stillR && await page.isVisible('#lock-badge'));
  await page.screenshot({ path: path.join(shots, '13_ui_exercice.png') });

  // 11) fenêtre de téléversement (sans carte)
  await page.click('#btn-upload');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shots, '14_ui_televersement.png') });
  check('Fenêtre de téléversement', await page.isVisible('#up-go'));
  await page.click('#modal-close');

  check('Aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(x => !x).length;
  console.log(failed ? `${failed} échec(s)` : 'Tous les tests d\'interface sont passés.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
