// Pour chaque composant du catalogue : on le pose, on insère son exemple de code, on compile et on simule.
// Utilisation : NODE_PATH=$(npm root -g) node tests/browser_snippets_test.js
const { chromium } = require('playwright');
const path = require('path');

const file = 'file://' + path.resolve(__dirname, '../dist/simulateur_arduino.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(file);
  await page.waitForFunction(() => window.APP && window.APP.state && window.APP.state.project);
  await page.keyboard.press('Escape');
  const report = await page.evaluate(() => {
    const out = [];
    for (const def of CATALOG.list) {
      const empty = {
        format: 'simulateur-arduino', version: 1, title: 't', board: 'uno', shield: true,
        circuit: { comps: [{ id: 'board', type: 'board', x: 0, y: 0 }], wires: [], cables: [] },
        blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'ard_setup', x: 10, y: 10 }, { type: 'ard_loop', x: 10, y: 200 }] } }
      };
      APP.loadProject(empty);
      const comp = EDITOR.addComponent(def.type, 400, 50);
      const snip = APP.snippet(comp);
      if (!snip) { out.push({ type: def.type, none: true }); continue; }
      try {
        APP.insertSnippet(comp);
        const ir = IRBuilder.build(APP.workspace(), 'uno');
        const n = ir.setup.length + ir.loop.length;
        if (!n) throw new Error('aucun bloc inséré');
        const bc = Compiler.compile(ir);
        CppGen.generate(ir, { circuitTypes: [def.type] });
        let vmErr = null;
        const sim = new SimLib.Simulator(APP.state.project.circuit, { onSerial() {}, onWarn() {}, onError: m => { vmErr = m; } });
        sim.load(bc.bytes);
        sim.advance(50);
        if (vmErr) throw new Error(vmErr);
        out.push({ type: def.type, ok: true, port: (APP.state.project.circuit.cables[0] || {}).port });
      } catch (e) {
        out.push({ type: def.type, err: e.message });
      }
    }
    return out;
  });
  const bad = report.filter(r => r.err);
  bad.forEach(r => console.log('ÉCHEC', r.type, '—', r.err));
  const none = report.filter(r => r.none).map(r => r.type);
  console.log(`${report.filter(r => r.ok).length} composants avec exemple de code valide ; sans exemple : ${none.join(', ')}`);

  // l'exemple utilise bien le port réellement câblé
  const portCheck = await page.evaluate(() => {
    APP.loadProject({ format: 'simulateur-arduino', version: 1, title: 't', board: 'uno', shield: true,
      circuit: { comps: [{ id: 'board', type: 'board', x: 0, y: 0 }, { id: 'us', type: 'grove_ultrasonic', x: 400, y: 0 }], wires: [], cables: [{ comp: 'us', port: 'D7' }] },
      blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'ard_setup', x: 10, y: 10 }, { type: 'ard_loop', x: 10, y: 200 }] } } });
    APP.insertSnippet(EDITOR.comp('us'));
    return APP.cpp().includes('Ultrasonic ultrason7(7)');
  });
  console.log((portCheck ? 'OK   ' : 'ÉCHEC ') + 'exemple réglé sur le port câblé (D7)');
  // LED reliée à D12 à travers une résistance sur la plaque d'essai
  const traceCheck = await page.evaluate(() => {
    APP.loadProject(JSON.parse(JSON.stringify(EXAMPLES[4])));
    const s = APP.snippet(EDITOR.comp('l1'));
    return s && /D12/.test(s.desc);
  });
  console.log((traceCheck ? 'OK   ' : 'ÉCHEC ') + 'broche retrouvée à travers la résistance (LED jaune sur D12)');
  if (errors.length) console.log('Erreurs JavaScript :', errors.slice(0, 5).join(' | '));
  await browser.close();
  process.exit(bad.length || errors.length || !portCheck || !traceCheck ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
