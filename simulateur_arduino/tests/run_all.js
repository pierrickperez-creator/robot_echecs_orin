// Lance tous les tests. Les tests navigateur nécessitent Playwright (NODE_PATH=$(npm root -g)) et dist/ à jour.
const { spawnSync } = require('child_process');
const path = require('path');

const node = [
  'test_vm.js', 'test_sim.js', 'test_cpp.js', 'test_uploader.js', 'test_firmware_i2c.js', 'test_firmware_gpio.js'
];
const browser = ['browser_test.js', 'browser_ui_test.js', 'browser_blocks_test.js', 'browser_snippets_test.js'];

let canBrowser = true;
try { require.resolve('playwright'); } catch (e) { canBrowser = false; }

let failed = 0;
for (const t of node.concat(canBrowser ? browser : [])) {
  process.stdout.write(`\n=== ${t}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit', env: process.env, timeout: 300000 });
  if (r.status !== 0) { failed++; console.log(`>>> ${t} : ÉCHEC`); }
}
if (!canBrowser) console.log('\n(Playwright introuvable : tests navigateur ignorés. Lancez avec NODE_PATH=$(npm root -g).)');
console.log(failed ? `\n${failed} fichier(s) de test en échec.` : '\nTous les tests sont passés.');
process.exit(failed ? 1 : 0);
