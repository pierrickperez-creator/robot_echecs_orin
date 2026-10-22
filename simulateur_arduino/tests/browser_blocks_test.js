// Vérifie que chaque bloc de la boîte à outils se traduit en bytecode et en C++ sans erreur, et s'exécute dans le simulateur.
// Utilisation : NODE_PATH=$(npm root -g) node tests/browser_blocks_test.js
const { chromium } = require('playwright');
const path = require('path');

const file = 'file://' + path.resolve(__dirname, '../dist/simulateur_arduino.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(file);
  await page.waitForFunction(() => window.APP && window.APP.state && window.APP.state.project);
  const report = await page.evaluate(async () => {
    const out = [];
    const ws = APP.workspace();
    const tb = BlocksDef.toolbox();
    const items = [];
    const walk = list => list.forEach(x => { if (x.kind === 'block') items.push(x); if (x.contents) walk(x.contents); });
    walk(tb.contents);
    for (const boardId of ['uno', 'mega']) {
      APP.state.project.board = boardId;
      for (const item of items) {
        if (['ard_setup', 'ard_loop'].includes(item.type)) continue;
        ws.clear();
        const def = JSON.parse(JSON.stringify(item));
        delete def.kind;
        let b;
        try {
          b = Blockly.serialization.blocks.append(def, ws);
        } catch (e) { out.push({ type: item.type, step: 'création', err: e.message }); continue; }
        const loop = ws.newBlock('ard_loop');
        try {
          if (b.outputConnection) {
            const isBool = (b.outputConnection.getCheck() || []).includes('Boolean');
            const holder = ws.newBlock(isBool ? 'controls_if' : 'ard_serial_print');
            holder.getInput(isBool ? 'IF0' : 'VALUE').connection.connect(b.outputConnection);
            loop.getInput('DO').connection.connect(holder.previousConnection);
          } else if (item.type === 'controls_flow_statements') {
            const rep = ws.newBlock('controls_repeat_ext');
            rep.getInput('DO').connection.connect(b.previousConnection);
            loop.getInput('DO').connection.connect(rep.previousConnection);
          } else {
            loop.getInput('DO').connection.connect(b.previousConnection);
          }
          // ajoute une attente pour que la boucle ne tourne pas à vide
          const d = ws.newBlock('ard_delay');
          const last = loop.getInputTargetBlock('DO').lastConnectionInStack(true);
          last.connect(d.previousConnection);
          const ir = IRBuilder.build(ws, boardId);
          const bc = Compiler.compile(ir);
          const cpp = CppGen.generate(ir, { circuitTypes: [] });
          if (!cpp.includes('void loop()')) throw new Error('C++ incomplet');
          // exécution rapide dans le simulateur
          const circuit = { board: boardId, shield: true, comps: [{ id: 'board', type: 'board', x: 0, y: 0 }], wires: [], cables: [] };
          const sim = new SimLib.Simulator(circuit, { onSerial() {}, onWarn() {} });
          let vmErr = null;
          sim.o.onError = m => { vmErr = m; };
          sim.load(bc.bytes);
          sim.advance(30);
          if (vmErr) throw new Error('VM : ' + vmErr);
          out.push({ type: item.type, ok: true });
        } catch (e) {
          out.push({ type: item.type + (item.fields && item.fields.MOD ? ' / ' + item.fields.MOD : ''), board: boardId, err: e.message });
        }
      }
    }
    return { total: items.length, out };
  });
  const bad = report.out.filter(r => !r.ok);
  bad.forEach(r => console.log('ÉCHEC', r.board || '', r.type, '—', r.err));
  console.log(`${report.out.length - bad.length} / ${report.out.length} essais de blocs réussis (${report.total} blocs dans la boîte à outils).`);
  if (errors.length) console.log('Erreurs JavaScript :', errors.slice(0, 5).join(' | '));
  await browser.close();
  process.exit(bad.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
