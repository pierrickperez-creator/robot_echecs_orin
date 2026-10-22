/*
 * Application principale : interface, projets, simulation, moniteur série, téléversement, exercices.
 */
(function (root) {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const STORE_KEY = 'simulateurArduino.autosave.v1';

  const state = {
    project: null,      // { title, board, shield, circuit, exercise }
    sim: null,
    running: false,
    lastFrame: 0,
    boardSerial: null,
    boardPort: null,
    teacher: false
  };
  const APP = root.APP = { boardId: () => (state.project ? state.project.board : 'uno') };
  let editor, workspace, plotter;
  const audio = new AudioEngine();

  /* ================================================================ petits utilitaires */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3500);
  }
  function modal(title, html, onReady) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal-bg').hidden = false;
    if (onReady) onReady($('#modal-body'));
  }
  function closeModal() { $('#modal-bg').hidden = true; }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileName = (ext) => (state.project.title || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') + ext;

  /* ================================================================ messages */
  const messages = [];
  function addMsg(text, level, blockId) {
    if (messages.some(m => m.text === text)) return;
    messages.push({ text, level: level || 'info', blockId });
    renderMsgs();
    if (level === 'error') showTab('msgs');
  }
  function clearMsgs() { messages.length = 0; renderMsgs(); }
  function renderMsgs() {
    const ul = $('#msgs');
    ul.innerHTML = messages.map((m, i) => `<li class="${m.level}${m.blockId ? ' clickable' : ''}" data-i="${i}">${esc(m.text).replace(/\n/g, '<br>')}</li>`).join('') ||
      '<li class="info">Aucun message.</li>';
    const n = messages.filter(m => m.level !== 'info').length;
    $('#msg-count').hidden = !n;
    $('#msg-count').textContent = n;
  }

  /* ================================================================ Blockly */
  function setupBlockly() {
    const theme = Blockly.Theme.defineTheme('simuArduino', {
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: '#f7f9fb', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#1f2933',
        flyoutBackgroundColour: '#eef2f6', flyoutForegroundColour: '#1f2933', flyoutOpacity: 1,
        scrollbarColour: '#c5ccd6', insertionMarkerColour: '#00979c'
      },
      fontStyle: { family: '"Segoe UI", system-ui, sans-serif', size: 11 }
    });
    workspace = Blockly.inject('blockly', {
      toolbox: BlocksDef.toolbox(),
      renderer: 'zelos',
      theme,
      grid: { spacing: 24, length: 2, colour: '#dde3ea', snap: true },
      zoom: { controls: false, wheel: true, startScale: 0.72, maxScale: 2, minScale: 0.3, scaleSpeed: 1.1 },
      trashcan: false,
      sounds: false,
      media: 'vendor/media/',
      move: { scrollbars: true, drag: true, wheel: false }
    });
    let timer = null;
    workspace.addChangeListener(ev => {
      if (ev.isUiEvent) return;
      clearTimeout(timer);
      timer = setTimeout(() => { updateCodeView(); autosave(); }, 300);
    });
    new ResizeObserver(() => Blockly.svgResize(workspace)).observe($('#cpane-blocks'));
  }

  /* ================================================================ programme : blocs -> IR -> bytecode / C++ */
  function buildIR() {
    return IRBuilder.build(workspace, state.project.board);
  }
  function compileProgram() {
    workspace.getAllBlocks(false).forEach(b => b.setWarningText(null));
    const ir = buildIR();
    const res = Compiler.compile(ir);
    return { ir, bytes: res.bytes, res };
  }
  function showBuildError(e) {
    const msg = e.message || String(e);
    addMsg('Programme : ' + msg, 'error', e.blockId);
    if (e.blockId) {
      const b = workspace.getBlockById(e.blockId);
      if (b) { b.select(); b.setWarningText(msg); workspace.centerOnBlock(e.blockId); }
    }
    showCodeTab('blocks');
  }
  function circuitTypes() { return state.project.circuit.comps.map(c => c.type); }
  function cppOptions() {
    const pixelCount = {};
    let chainCount = 1;
    for (const cab of state.project.circuit.cables || []) {
      const comp = state.project.circuit.comps.find(c => c.id === cab.comp);
      if (!comp || !comp.def) continue;
      if (comp.def.kind === 'pixels') pixelCount[cab.port] = (comp.props && comp.props.count) || comp.def.props.count;
      if (comp.def.kind === 'chain') chainCount = (comp.props && comp.props.count) || 1;
    }
    return { circuitTypes: circuitTypes(), title: state.project.title, pixelCount, chainCount };
  }
  function generateCpp() {
    const ir = buildIR();
    return CppGen.generate(ir, cppOptions());
  }
  function highlight(code) {
    const TY = /^(void|long|float|bool|int|double|uint8_t|uint16_t|char|unsigned)$/;
    const KW = /^(if|else|for|while|return|break|continue|switch|case|default|true|false|HIGH|LOW|OUTPUT|INPUT|INPUT_PULLUP)$/;
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(^#include[^\n]*)|("(?:[^"\\\n]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/gm;
    let out = '', m;
    while ((m = re.exec(code))) {
      if (m[1]) out += '<span class="co">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="pp">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="st">' + esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="nu">' + m[4] + '</span>';
      else if (m[5]) out += TY.test(m[5]) ? '<span class="ty">' + m[5] + '</span>' : KW.test(m[5]) ? '<span class="kw">' + m[5] + '</span>' : m[5];
      else out += esc(m[6]);
    }
    return out;
  }
  function updateCodeView() {
    let code;
    try {
      code = generateCpp();
      const r = compileProgram();
      const fw = FIRMWARE.images[BOARDS[state.project.board].mcu];
      $('#prog-size').textContent = `programme : ${r.bytes.length} / ${fw.progSize} octets`;
    } catch (e) {
      code = '// Le programme contient une erreur :\n// ' + (e.message || e);
      $('#prog-size').textContent = '';
    }
    $('#code-view').innerHTML = highlight(code);
  }

  /* ================================================================ projet */
  function defaultProject() {
    return {
      format: 'simulateur-arduino', version: 1, title: 'Mon projet', board: 'uno', shield: true,
      circuit: { comps: [{ id: 'board', type: 'board', x: 0, y: 0 }], wires: [], cables: [] },
      blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'ard_setup', x: 20, y: 20 }, { type: 'ard_loop', x: 20, y: 160 }] } },
      exercise: null
    };
  }
  function serialize() {
    return {
      format: 'simulateur-arduino', version: 1,
      title: state.project.title, board: state.project.board, shield: state.project.shield,
      circuit: JSON.parse(editor.snapshot()),
      blocks: Blockly.serialization.workspaces.save(workspace),
      exercise: state.project.exercise || null,
      savedAt: new Date().toISOString()
    };
  }
  function loadProject(p, opts) {
    opts = opts || {};
    stopSim();
    if (!p || p.format !== 'simulateur-arduino') throw new Error('Ce fichier n\'est pas un projet du simulateur.');
    p = JSON.parse(JSON.stringify(p));
    const circ = p.circuit && p.circuit.comps ? { board: p.board, shield: !!p.shield, comps: p.circuit.comps, wires: p.circuit.wires || [], cables: p.circuit.cables || [] } : defaultProject().circuit;
    if (!circ.comps.some(c => c.type === 'board')) circ.comps.unshift({ id: 'board', type: 'board', x: 0, y: 0 });
    circ.board = p.board || 'uno';
    circ.shield = !!p.shield;
    state.project = { title: p.title || 'Projet', board: circ.board, shield: circ.shield, circuit: circ, exercise: p.exercise || null };
    $('#board-select').value = circ.board;
    $('#shield-check').checked = circ.shield;
    editor.setCircuit(circ);
    editor.undoStack = []; editor.redoStack = [];
    workspace.clear();
    // les menus déroulants des blocs dépendent de la carte : on la fixe avant le chargement
    Blockly.Events.disable();
    try { Blockly.serialization.workspaces.load(p.blocks || defaultProject().blocks, workspace); }
    catch (e) { console.error(e); addMsg('Certains blocs n\'ont pas pu être chargés : ' + e.message, 'warn'); }
    finally { Blockly.Events.enable(); }
    workspace.updateToolbox(BlocksDef.toolbox());
    applyLock();
    setTimeout(() => { editor.fit(); workspace.scrollCenter(); }, 30);
    updateCodeView();
    clearMsgs();
    document.title = state.project.title + ' — Simulateur Arduino';
    if (!opts.silent && state.project.exercise && state.project.exercise.text) showConsigne();
    $('#btn-consigne').style.display = state.project.exercise ? '' : 'none';
    autosave();
  }
  function autosave() {
    if (!state.project) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch (e) { /* stockage indisponible */ }
  }
  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { loadProject(JSON.parse(raw), { silent: true }); return true; }
    } catch (e) { console.warn(e); }
    return false;
  }
  function saveProject() {
    const data = JSON.stringify(serialize(), null, 1);
    download(fileName('.json'), data, 'application/json');
    toast('Projet enregistré dans vos téléchargements : ' + fileName('.json'));
  }
  function openProject() {
    const input = $('#file-input');
    input.value = '';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { loadProject(JSON.parse(r.result)); toast('Projet ouvert : ' + (state.project.title || f.name)); }
        catch (e) { modal('Ouverture impossible', `<p>${esc(e.message)}</p>`); }
      };
      r.readAsText(f);
    };
    input.click();
  }
  function newProject() {
    if (!confirm('Commencer un nouveau projet ? Le projet actuel sera remplacé (pensez à l\'enregistrer).')) return;
    const p = defaultProject();
    p.board = state.project.board;
    loadProject(p);
  }

  function setBoard(id) {
    if (id === state.project.board) return;
    stopSim();
    editor.pushUndo();
    state.project.board = id;
    state.project.circuit.board = id;
    // les fils reliés à des broches qui n'existent plus sont retirés
    const pins = new Set(BOARDS[id].pins.map(p => p.id));
    const before = state.project.circuit.wires.length;
    state.project.circuit.wires = state.project.circuit.wires.filter(w => (w.a.c !== 'board' || pins.has(w.a.p)) && (w.b.c !== 'board' || pins.has(w.b.p)));
    const ports = new Set(BOARDS[id].shieldPorts.map(p => p[0]));
    state.project.circuit.cables = state.project.circuit.cables.filter(c => ports.has(c.port));
    editor.render();
    editor.fit();
    workspace.updateToolbox(BlocksDef.toolbox());
    updateCodeView();
    autosave();
    if (state.project.circuit.wires.length < before) toast('Certains fils reliés à des broches absentes de cette carte ont été retirés.');
  }
  function setShield(on) {
    stopSim();
    editor.pushUndo();
    state.project.shield = on;
    state.project.circuit.shield = on;
    editor.render();
    autosave();
  }

  /* ================================================================ bibliothèque */
  function renderLibrary(filter) {
    const list = $('#lib-list');
    const f = (filter || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const fw328 = FIRMWARE.images.atmega328p.sys, fw2560 = FIRMWARE.images.atmega2560.sys;
    let html = '';
    for (const group of CATALOG.groups) {
      const items = CATALOG.list.filter(c => c.group === group && (!f || (c.name + ' ' + (c.desc || '') + ' ' + group).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(f)));
      if (!items.length) continue;
      html += `<details class="lib-group" ${f || group === 'Composants de base' || group.includes('Boutons') ? 'open' : ''}><summary>${esc(group)} (${items.length})</summary><div class="lib-items">`;
      for (const c of items) {
        const support = boardSupport(c, fw328, fw2560);
        html += `<div class="lib-item" draggable="true" data-type="${c.type}" title="${esc(c.name + (c.desc ? ' — ' + c.desc : ''))}">${DRAW.thumbnail(c)}${esc(c.name)}${support ? `<span class="so">${support}</span>` : ''}</div>`;
      }
      html += '</div></details>';
    }
    list.innerHTML = html || '<p class="hint">Aucun composant trouvé.</p>';
  }
  // modules dont le pilote n'existe pas (encore) dans le micrologiciel
  const KIND_SYS = { gesture: 'gestureRead', co2: 'co2Read', encoder: 'encoderRead', ir: 'irRead', rfid: 'rfidRead', keypad: 'keypadRead', mp3: 'mp3Play',
    color: 'colorRead', irtemp: 'irTempRead', motor: 'motorI2C' };
  function boardSupport(def, fw328, fw2560) {
    let sys = KIND_SYS[def.kind] || (def.sim && def.sim.sys);
    if (def.kind === 'none') return 'non simulé';
    if (def.simOnly) sys = def.simOnly[0];
    if (!sys) return '';
    if (!fw2560.includes(sys)) return 'simulation seulement';
    if (!fw328.includes(sys)) return 'carte : Mega seulement';
    return '';
  }

  /* ================================================================ panneau des propriétés */
  function renderProps(sel) {
    const box = $('#props');
    if (!sel) { box.hidden = true; return; }
    const c = state.project.circuit;
    if (sel.wire) {
      const w = c.wires.find(x => x.id === sel.wire);
      if (!w) { box.hidden = true; return; }
      box.innerHTML = `<h3>Fil</h3><p class="desc">Double-cliquez sur un fil pour ajouter un coude.</p>
        <div class="section">Couleur</div><div class="swatches">${WIRE_COLORS.map(([col, n]) => `<span class="swatch" title="${n}" data-color="${col}" style="background:${col}"></span>`).join('')}</div>
        <div class="btns"><button class="mini" data-act="straight">Redresser</button><button class="mini danger" data-act="del">Supprimer</button></div>`;
      box.hidden = false;
      box.querySelectorAll('.swatch').forEach(s => s.onclick = () => editor.setWireColor(s.dataset.color));
      bindPropButtons(box);
      return;
    }
    if (sel.cable) {
      const cab = c.cables.find(x => x.comp === sel.cable);
      const comp = c.comps.find(x => x.id === sel.cable);
      box.innerHTML = `<h3>Câble Grove</h3><p class="desc">${esc(comp ? comp.def.name : '')} → port ${esc(cab ? cab.port : '')}</p>
        <div class="btns"><button class="mini danger" data-act="del">Débrancher</button></div>`;
      box.hidden = false;
      bindPropButtons(box);
      return;
    }
    const comp = c.comps.find(x => x.id === sel.comp);
    if (!comp) { box.hidden = true; return; }
    if (comp.type === 'board') {
      const b = BOARDS[c.board];
      box.innerHTML = `<h3>${esc(b.name)}</h3><p class="desc">Microcontrôleur ${b.mcu.toUpperCase()}, broches PWM (~) : ${b.pwm.join(', ')}.
        ${c.shield ? 'Le shield Grove est en place : glissez un module puis reliez son connecteur blanc à un port.' : 'Cochez « Shield Grove » en haut pour brancher des modules Grove.'}</p>
        <p class="desc">Survolez une broche pour voir son nom ; cliquez dessus pour tirer un fil.</p>`;
      box.hidden = false;
      return;
    }
    const def = comp.def;
    let html = `<h3>${esc(def.name)}</h3>${def.desc ? `<p class="desc">${esc(def.desc)}</p>` : ''}`;
    // port Grove
    if (def.conn && c.shield && editor.locked) {
      const cab = (c.cables || []).find(x => x.comp === comp.id);
      html += `<p class="desc">Branché sur le port <b>${cab ? esc(cab.port.replace('_', ' n°')) : '—'}</b>.</p>`;
    } else if (def.conn && c.shield) {
      const cab = (c.cables || []).find(x => x.comp === comp.id);
      const ports = BOARDS[c.board].shieldPorts.map(p => p[0]);
      const kind = id => BOARDS[c.board].portKind(id);
      const ok = id => (def.conn === 'analog' ? kind(id) === 'analog' : def.conn === 'i2c' ? kind(id) === 'i2c' : def.conn === 'uart' ? kind(id) === 'uart' : kind(id) === 'digital' || kind(id) === 'analog');
      html += `<div class="row"><label>Port Grove</label><select data-port>
        <option value="">— non branché —</option>
        ${ports.map(p => `<option value="${p}" ${cab && cab.port === p ? 'selected' : ''}>${p.replace('_', ' n°')}${ok(p) ? '' : ' (inadapté)'}</option>`).join('')}</select></div>`;
      if (cab && !ok(cab.port)) html += `<p class="note">Ce module ${def.conn === 'analog' ? 'analogique doit être branché sur un port A' : def.conn === 'i2c' ? 'I2C doit être branché sur un port I2C' : 'doit être branché sur un port ' + def.conn}.</p>`;
      if (!cab) html += `<p class="note">Choisissez un port ou tirez un câble depuis le connecteur blanc du module.</p>`;
    } else if (def.conn && !c.shield) {
      html += `<p class="note">Sans shield Grove, reliez les broches GND, VCC et SIG du module avec des fils.</p>`;
    }
    if (!editor.locked) {
      html += propsFields(comp);
    }
    html += simControls(comp);
    if (!editor.locked) html += `<div class="btns"><button class="mini" data-act="rot">↻ Tourner (R)</button><button class="mini danger" data-act="del">Supprimer (Suppr)</button></div>`;
    box.innerHTML = html;
    box.hidden = false;
    bindPropButtons(box);
    const portSel = box.querySelector('[data-port]');
    if (portSel) portSel.onchange = () => { editor.setCable(comp.id, portSel.value || null); renderProps(sel); };
    bindSimControls(box, comp);
  }
  function bindPropButtons(box) {
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'del') { if (guardLock()) editor.deleteSelection(); }
      if (b.dataset.act === 'rot') { if (guardLock()) editor.rotateSelection(); }
      if (b.dataset.act === 'straight') editor.straighten();
    });
  }
  function propsFields(comp) {
    const def = comp.def;
    let h = '';
    if (def.kind === 'resistor') {
      h += `<div class="row"><label>Valeur (Ω)</label><input type="number" min="1" step="1" data-prop="ohms" value="${comp.props.ohms}" list="ohms-list">
        <datalist id="ohms-list">${[100, 150, 220, 330, 470, 1000, 2200, 4700, 10000, 47000, 100000].map(v => `<option value="${v}">`).join('')}</datalist></div>`;
    }
    if (def.kind === 'pot') h += `<div class="row"><label>Valeur (Ω)</label><input type="number" min="100" step="100" data-prop="ohms" value="${comp.props.ohms}"></div>`;
    if (def.kind === 'chain') h += `<div class="row"><label>LED en chaîne</label><input type="number" min="1" max="10" data-prop="count" value="${comp.props.count || 1}"></div>`;
    return h;
  }
  const slider = (key, label, min, max, step, unit, v) =>
    `<div class="row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" data-sim="${key}" value="${v}"><span class="val" data-val="${key}">${fmtV(v)} ${unit || ''}</span></div>`;
  const fmtV = v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
  function simControls(comp) {
    const def = comp.def, s = comp.sim;
    let h = '';
    const sect = t => `<div class="section">${t}</div>`;
    switch (def.kind) {
      case 'din':
        h += sect('Simulation');
        if (s.mode === 'pulse') h += `<div class="row"><button class="mini ${comp.rt.active !== false ? 'on' : ''}" data-toggle="pulse">Pouls ${comp.rt.active !== false ? 'présent' : 'absent'}</button></div>` + slider('bpm', 'Pouls (bpm)', 40, 180, 1, '', s.bpm);
        else h += `<div class="row"><button class="mini ${comp.rt.active ? 'on' : ''}" data-hold="${s.mode === 'press' ? 1 : 0}">${esc(s.action)}${s.mode === 'press' ? ' (maintenir)' : ''}</button></div><p class="desc">Astuce : vous pouvez aussi cliquer directement sur le module.</p>`;
        break;
      case 'button':
        h += sect('Simulation') + `<div class="row"><button class="mini" data-hold="1">Appuyer (maintenir)</button></div><p class="desc">Ou cliquez sur le bouton dans le circuit pendant la simulation.</p>`;
        break;
      case 'switch': h += sect('Simulation') + `<div class="row"><button class="mini" data-toggle="switch">Basculer (${s.right ? 'à droite' : 'à gauche'})</button></div>`; break;
      case 'ain': h += sect('Simulation') + slider('value', esc(s.label || 'Valeur'), s.min, s.max, (s.max - s.min) / 200, esc(s.unit), s.value); break;
      case 'pot': h += sect('Simulation') + slider('value', 'Position', 0, 100, 1, '%', s.value); break;
      case 'ldr': h += sect('Simulation') + slider('value', 'Lumière', 0, 100, 1, '%', s.value); break;
      case 'ntc': h += sect('Simulation') + slider('value', 'Température', -20, 100, 0.5, '°C', s.value); break;
      case 'hcsr04': case 'ultrasonic': h += sect('Simulation') + slider('value', 'Distance', 2, def.kind === 'hcsr04' ? 400 : 350, 1, 'cm', s.value); break;
      case 'dht': case 'thi2c':
        h += sect('Simulation') + slider('temp', 'Température', -20, 60, 0.5, '°C', s.temp) + slider('hum', 'Humidité', 0, 100, 1, '%', s.hum); break;
      case 'baro':
        h += sect('Simulation') + slider('temp', 'Température', -20, 60, 0.5, '°C', s.temp) + slider('pressure', 'Pression', 900, 1100, 0.25, 'hPa', s.pressure);
        if (s.hum !== null && s.hum !== undefined) h += slider('hum', 'Humidité', 0, 100, 1, '%', s.hum);
        break;
      case 'accel':
        h += sect('Simulation (en g)') + slider('x', 'X', -2, 2, 0.05, 'g', s.x) + slider('y', 'Y', -2, 2, 0.05, 'g', s.y) + slider('z', 'Z', -2, 2, 0.05, 'g', s.z);
        if (s.gx !== undefined) h += slider('gx', 'Rotation X', -250, 250, 1, '°/s', s.gx) + slider('gy', 'Rotation Y', -250, 250, 1, '°/s', s.gy) + slider('gz', 'Rotation Z', -250, 250, 1, '°/s', s.gz);
        h += `<div class="btns"><button class="mini" data-preset="flat">À plat</button><button class="mini" data-preset="tiltx">Incliné</button><button class="mini" data-preset="shake">Secoué</button></div>`;
        break;
      case 'i2cval': h += sect('Simulation') + slider('value', esc(s.label), s.min, s.max, (s.max - s.min) / 400, esc(s.unit), s.value); break;
      case 'color': h += sect('Couleur vue') + slider('r', 'Rouge', 0, 255, 1, '', s.r) + slider('g', 'Vert', 0, 255, 1, '', s.g) + slider('b', 'Bleu', 0, 255, 1, '', s.b); break;
      case 'irtemp': h += sect('Simulation') + slider('obj', 'Objet visé', -20, 120, 0.5, '°C', s.obj) + slider('amb', 'Ambiante', -20, 60, 0.5, '°C', s.amb); break;
      case 'co2': h += sect('Simulation') + slider('co2', 'CO2', 400, 5000, 10, 'ppm', s.co2) + slider('temp', 'Température', -10, 50, 0.5, '°C', s.temp) + slider('hum', 'Humidité', 0, 100, 1, '%', s.hum); break;
      case 'joystick': h += sect('Simulation') + slider('x', 'Axe X', 0, 1023, 1, '', s.x) + slider('y', 'Axe Y', 0, 1023, 1, '', s.y) +
        `<div class="row"><button class="mini" data-hold="1">Appuyer (maintenir)</button><button class="mini" data-preset="center">Centrer</button></div>`; break;
      case 'gesture': h += sect('Faire un geste') + `<div class="keys">${[['↑', 1], ['↓', 2], ['←', 3], ['→', 4], ['avant', 5], ['arrière', 6], ['↻', 7], ['↺', 8]].map(([l, v]) => `<button class="mini" data-gesture="${v}">${l}</button>`).join('')}</div>`; break;
      case 'encoder': h += sect('Simulation') + `<div class="row"><button class="mini" data-enc="-1">◀ tourner</button><button class="mini" data-enc="1">tourner ▶</button><span class="val" data-val="pos">${comp.rt.pos || 0}</span></div>`; break;
      case 'ir': h += sect('Télécommande') + `<div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '▲', 0, '▼'].map((k, i) => `<button class="mini" data-ir="${[0x0C, 0x18, 0x5E, 0x08, 0x1C, 0x5A, 0x42, 0x52, 0x4A, 0x46, 0x16, 0x15][i]}">${k}</button>`).join('')}</div><p class="desc">Chaque touche envoie son code (ex. touche 1 = 12).</p>`; break;
      case 'rfid': h += sect('Présenter un badge') + `<div class="btns">${[['Badge A', 0x1A2B3C], ['Badge B', 0x4D5E6F], ['Badge C', 0x778899]].map(([l, v]) => `<button class="mini" data-card="${v}">${l} (${v})</button>`).join('')}</div>`; break;
      case 'keypad': h += sect('Clavier') + `<div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map(k => `<button class="mini" data-key="${k === '*' ? 10 : k === '#' ? 11 : k}">${k}</button>`).join('')}</div>`; break;
      case 'rtc': h += `<p class="desc">L'horloge simulée suit l'heure de l'ordinateur (réglable par le programme).</p>`; break;
    }
    return h;
  }
  function bindSimControls(box, comp) {
    const live = () => { if (state.sim) state.sim.interact(); editor.dynCache.delete(comp.id); editor.updateDynamic(state.sim); autosaveSoon(); };
    box.querySelectorAll('[data-sim]').forEach(inp => inp.oninput = () => {
      comp.sim[inp.dataset.sim] = +inp.value;
      const v = box.querySelector(`[data-val="${inp.dataset.sim}"]`);
      if (v) v.textContent = fmtV(+inp.value) + ' ' + (v.textContent.split(' ').slice(1).join(' '));
      live();
    });
    box.querySelectorAll('[data-prop]').forEach(inp => inp.onchange = () => {
      if (!guardLock()) return;
      editor.pushUndo();
      comp.props[inp.dataset.prop] = +inp.value;
      editor.refreshComp(comp);
      stopSimForEdit();
      autosave();
      updateCodeView();
    });
    box.querySelectorAll('[data-hold]').forEach(b => {
      const press = on => { setActive(comp, on); b.classList.toggle('on', on); live(); };
      if (b.dataset.hold === '1') {
        b.onmousedown = () => press(true);
        b.onmouseup = b.onmouseleave = () => { if (b.classList.contains('on')) press(false); };
        b.ontouchstart = e => { e.preventDefault(); press(true); };
        b.ontouchend = () => press(false);
      } else b.onclick = () => { press(!isActive(comp)); };
    });
    box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
      if (b.dataset.toggle === 'switch') comp.sim.right = !comp.sim.right;
      if (b.dataset.toggle === 'pulse') comp.rt.active = comp.rt.active === false;
      live(); renderProps(editor.sel);
    });
    box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const p = b.dataset.preset;
      if (p === 'flat') Object.assign(comp.sim, { x: 0, y: 0, z: 1 });
      if (p === 'tiltx') Object.assign(comp.sim, { x: 0.71, y: 0, z: 0.71 });
      if (p === 'shake') Object.assign(comp.sim, { x: 1.6, y: -1.2, z: 1.9 });
      if (p === 'center') Object.assign(comp.sim, { x: 512, y: 512 });
      live(); renderProps(editor.sel);
    });
    box.querySelectorAll('[data-gesture]').forEach(b => b.onclick = () => { comp.rt.gesture = +b.dataset.gesture; live(); });
    box.querySelectorAll('[data-enc]').forEach(b => b.onclick = () => {
      comp.rt.pos = (comp.rt.pos || 0) + +b.dataset.enc;
      box.querySelector('[data-val="pos"]').textContent = comp.rt.pos; live();
    });
    box.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => { comp.rt.code = +b.dataset.ir; live(); });
    box.querySelectorAll('[data-card]').forEach(b => b.onclick = () => { comp.rt.card = +b.dataset.card; live(); });
    box.querySelectorAll('[data-key]').forEach(b => b.onclick = () => { comp.rt.key = +b.dataset.key; live(); });
  }
  function isActive(comp) { return comp.def.kind === 'button' || comp.def.kind === 'joystick' ? !!comp.rt.pressed : !!comp.rt.active; }
  function setActive(comp, on) {
    if (comp.def.kind === 'button' || comp.def.kind === 'joystick') comp.rt.pressed = on;
    else comp.rt.active = on;
  }
  let autosaveTimer = null;
  function autosaveSoon() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosave, 800); }

  // clic direct sur une pièce pendant la simulation
  function interactDown(comp) {
    const def = comp.def;
    if (!def) return false;
    if (def.kind === 'button' || def.kind === 'joystick') { comp.rt.pressed = true; }
    else if (def.kind === 'din') {
      if (def.sim.mode === 'press') comp.rt.active = true;
      else if (def.sim.mode === 'pulse') comp.rt.active = comp.rt.active === false;
      else comp.rt.active = !comp.rt.active;
    } else if (def.kind === 'switch') comp.sim.right = !comp.sim.right;
    else return false;
    editor.select({ comp: comp.id });
    if (state.sim) state.sim.interact();
    editor.updateDynamic(state.sim);
    return true;
  }
  function interactUp(comp) {
    const def = comp.def;
    if (def.kind === 'button' || def.kind === 'joystick') comp.rt.pressed = false;
    else if (def.kind === 'din' && def.sim.mode === 'press') comp.rt.active = false;
    if (state.sim) state.sim.interact();
    editor.updateDynamic(state.sim);
    renderProps(editor.sel);
  }

  /* ================================================================ simulation */
  function startSim() {
    clearMsgs();
    let prog;
    try { prog = compileProgram(); }
    catch (e) { showBuildError(e); return; }
    prog.ir.warnings.forEach(w => addMsg(w.msg, 'warn', w.blockId));
    // vérification de l'utilisation des modules du programme
    checkModules(prog.ir);
    const circuit = state.project.circuit;
    serialAppend('', true);
    plotter.clear();
    state.sim = new SimLib.Simulator(circuit, {
      onSerial: t => { serialAppend(t); plotter.feed(t); },
      onWarn: (m, level) => addMsg(m, level),
      onError: m => { addMsg(m, 'error'); }
    });
    try { state.sim.load(prog.bytes); }
    catch (e) { addMsg(e.message, 'error'); state.sim = null; return; }
    state.running = true;
    editor.running = true;
    editor.cancelMode();
    $('#btn-run').textContent = '■ Arrêter la simulation';
    $('#btn-run').classList.add('running');
    audio.ensure();
    state.lastFrame = performance.now();
    requestAnimationFrame(frame);
    renderProps(editor.sel);
  }
  function stopSim() {
    if (!state.running) return;
    state.running = false;
    editor.running = false;
    audio.stopAll();
    if (state.sim) state.project.circuit.comps.forEach(c => { if (c.rt) { c.rt.pressed = false; if (c.def && c.def.kind === 'din' && c.def.sim.mode === 'press') c.rt.active = false; } });
    state.sim = null;
    editor.updateDynamic(null);
    $('#btn-run').textContent = '▶ Démarrer la simulation';
    $('#btn-run').classList.remove('running');
    $('#sim-status').textContent = '';
  }
  function stopSimForEdit() {
    if (state.running) { stopSim(); toast('Simulation arrêtée : le circuit a été modifié.'); }
  }
  function frame(now) {
    if (!state.running || !state.sim) return;
    const dt = Math.min(100, now - state.lastFrame);
    state.lastFrame = now;
    const r = state.sim.advance(dt);
    editor.updateDynamic(state.sim);
    audio.update(state.sim.sounds);
    const t = state.sim.timeUs / 1e6;
    $('#sim-status').textContent = `Simulation : ${t.toFixed(1)} s${r.late ? ' (ralentie : programme très chargé)' : ''}${state.sim.vm && state.sim.vm.halted ? ' — programme arrêté' : ''}`;
    if ($('#pane-plot').classList.contains('active')) plotter.draw();
    requestAnimationFrame(frame);
  }
  function checkModules(ir) {
    const circuit = state.project.circuit;
    const used = Compiler.usedSys(ir);
    const kindsInCircuit = new Set(circuit.comps.filter(c => c.def).map(c => c.def.kind));
    const need = { lcdClear: 'lcd', lcdSetCursor: 'lcd', lcdRGB: 'lcd', oledClear: 'oled', oledSetCursor: 'oled', tm1637Number: 'tm1637', ledBarLevel: 'ledbar',
      ultrasonicCm: 'ultrasonic', dhtRead: 'dht', accelRead: 'accel', baroRead: 'baro', thI2CRead: 'thi2c', pixelSet: 'pixels', pixelFill: 'pixels', chainRGB: 'chain', servoWrite: 'servo' };
    const names = { lcd: 'écran LCD', oled: 'écran OLED', tm1637: 'afficheur 4 chiffres', ledbar: 'barre de LED', ultrasonic: 'capteur à ultrasons', dht: 'capteur DHT',
      accel: 'accéléromètre', baro: 'baromètre', thi2c: 'capteur de température I2C', pixels: 'ruban de LED', chain: 'LED RGB chaînable', servo: 'servomoteur' };
    const missing = new Set();
    for (const fn of used) if (need[fn] && !kindsInCircuit.has(need[fn])) missing.add(names[need[fn]]);
    if (used.has('lcdClear') || used.has('lcdSetCursor')) { /* rien */ }
    const printsLcd = JSON.stringify(ir).includes('"target":1');
    if (printsLcd && !kindsInCircuit.has('lcd')) missing.add('écran LCD');
    if (JSON.stringify(ir).includes('"target":2') && !kindsInCircuit.has('oled')) missing.add('écran OLED');
    for (const m of missing) addMsg(`Le programme utilise un ${m}, mais il n'y en a pas dans le circuit.`, 'warn');
  }

  /* ================================================================ moniteur série */
  let serialBuf = '';
  let serialFlush = null;
  let lineStart = true;
  function serialAppend(text, reset) {
    const out = $('#serial-out');
    if (reset) { out.textContent = ''; serialBuf = ''; lineStart = true; return; }
    if ($('#serial-time').checked) {
      let s = '';
      for (const ch of text.replace(/\r/g, '')) {
        if (lineStart) { s += new Date().toLocaleTimeString('fr-FR') + ' → '; lineStart = false; }
        s += ch;
        if (ch === '\n') lineStart = true;
      }
      serialBuf += s;
    } else serialBuf += text.replace(/\r/g, '');
    if (!serialFlush) serialFlush = setTimeout(() => {
      serialFlush = null;
      out.textContent += serialBuf;
      serialBuf = '';
      if (out.textContent.length > 60000) out.textContent = out.textContent.slice(-40000);
      if ($('#serial-autoscroll').checked) out.scrollTop = out.scrollHeight;
    }, 50);
  }
  async function serialSend() {
    const inp = $('#serial-input');
    const eol = $('#serial-eol').value.replace('\\n', '\n').replace('\\r', '\r');
    const text = inp.value + eol;
    if ($('#serial-source').value === 'board') {
      if (state.boardSerial) await state.boardSerial.send(text);
      else toast('Connectez d\'abord la carte (bouton « Connecter »).');
    } else if (state.sim) state.sim.sendSerial(text);
    else toast('Démarrez la simulation pour envoyer des données.');
    inp.value = '';
  }
  async function toggleBoardSerial() {
    if (state.boardSerial) {
      await state.boardSerial.close();
      state.boardSerial = null;
      $('#serial-connect').textContent = 'Connecter';
      return;
    }
    try {
      const port = state.boardPort || await Uploader.choosePort(true);
      state.boardPort = port;
      state.boardSerial = new Uploader.BoardSerial(port, t => { serialAppend(t); plotter.feed(t); if ($('#pane-plot').classList.contains('active')) plotter.draw(); });
      state.boardSerial.onError = e => { addMsg('Liaison série interrompue : ' + e.message, 'warn'); toggleBoardSerial(); };
      await state.boardSerial.open(+$('#serial-baud').value);
      $('#serial-connect').textContent = 'Déconnecter';
      toast('Moniteur série connecté à la carte.');
    } catch (e) {
      state.boardSerial = null;
      modal('Connexion impossible', `<p>${esc(e.message)}</p>${helpDriversHtml()}`);
    }
  }

  /* ================================================================ téléversement */
  function helpDriversHtml() {
    return `<div class="callout warn"><b>La carte n'apparaît pas dans la liste ?</b><ul>
      <li>Utilisez <b>Google Chrome</b> ou <b>Microsoft Edge</b> (Firefox ne permet pas l'accès USB).</li>
      <li>Les cartes <b>officielles</b> (Uno, Mega) sont reconnues par Windows 10/11 sans pilote.</li>
      <li>Les <b>clones</b> (puce CH340, souvent les Nano) : Windows 10/11 installe en général le pilote automatiquement via Windows Update
      à la première connexion (patientez 1 minute avec Internet). Sinon, le pilote CH340 doit être installé une fois par l'administrateur du poste.</li>
      <li>Essayez un autre câble USB : certains câbles ne transmettent que l'alimentation.</li></ul></div>`;
  }
  function uploadDialog() {
    let prog;
    try { prog = compileProgram(); } catch (e) { showBuildError(e); return; }
    const board = BOARDS[state.project.board];
    const fw = FIRMWARE.images[board.mcu];
    const used = [...Compiler.usedSys(prog.ir)];
    const missing = used.filter(s => !fw.sys.includes(s));
    let image;
    try { image = HexUtil.buildImage(fw, prog.bytes); } catch (e) { modal('Programme trop long', `<p>${esc(e.message)}</p>`); return; }
    const supported = Uploader.supported();
    modal('Téléverser sur la carte', `
      <p>Le programme va être envoyé sur une <b>${esc(board.name)}</b> reliée en USB. Il y restera, même carte débranchée.</p>
      ${missing.length ? `<div class="callout warn">Attention : ces fonctions ne sont pas encore disponibles sur la vraie ${esc(board.name)} et renverront 0 :
        <b>${missing.map(esc).join(', ')}</b>${board.mcu === 'atmega328p' ? ' (certaines existent sur la Mega, qui a plus de mémoire)' : ''}.</div>` : ''}
      ${supported ? '' : '<div class="callout warn">Ce navigateur ne permet pas l\'accès USB. Ouvrez le simulateur avec <b>Google Chrome</b> ou <b>Microsoft Edge</b>, ou utilisez « Exporter le fichier .hex ».</div>'}
      <ol><li>Branchez la carte avec le câble USB.</li><li>Cliquez sur « Choisir le port et téléverser ».</li>
      <li>Dans la fenêtre de Chrome, choisissez le port de la carte (ex. « USB-SERIAL CH340 » ou « Arduino Uno (COM3) ») puis « Connexion ».</li></ol>
      <div class="progress"><div id="up-bar"></div></div>
      <div class="log" id="up-log">Prêt.</div>
      <div class="actions">
        <button class="tb" id="up-hex">Télécharger le .hex</button>
        <button class="tb primary" id="up-go" ${supported ? '' : 'disabled'}>Choisir le port et téléverser</button>
      </div>
      <details><summary>Aide : pilotes et problèmes fréquents</summary>${helpDriversHtml()}</details>`, body => {
      const log = m => { const l = body.querySelector('#up-log'); l.textContent += '\n' + m; l.scrollTop = l.scrollHeight; };
      body.querySelector('#up-hex').onclick = () => download(fileName('_' + board.id + '.hex'), HexUtil.toHex(image));
      body.querySelector('#up-go').onclick = async () => {
        const btn = body.querySelector('#up-go');
        btn.disabled = true;
        try {
          if (state.boardSerial) { await state.boardSerial.close(); state.boardSerial = null; $('#serial-connect').textContent = 'Connecter'; }
          const port = await Uploader.choosePort(false);
          state.boardPort = port;
          const t0 = performance.now();
          const r = await Uploader.upload(port, board, fw, image, { log, progress: f => { body.querySelector('#up-bar').style.width = Math.round(f * 100) + '%'; } });
          log(`Terminé en ${((performance.now() - t0) / 1000).toFixed(1)} s (${r.baud} bauds). Le programme démarre sur la carte.`);
          body.querySelector('#up-bar').style.width = '100%';
          toast('Programme téléversé sur la carte ✔');
        } catch (e) {
          log('✖ ' + e.message);
        } finally { btn.disabled = false; }
      };
    });
  }
  function exportHex() {
    let prog;
    try { prog = compileProgram(); } catch (e) { showBuildError(e); return; }
    const board = BOARDS[state.project.board];
    const fw = FIRMWARE.images[board.mcu];
    try {
      download(fileName('_' + board.id + '.hex'), HexUtil.toHex(HexUtil.buildImage(fw, prog.bytes)));
      toast('Fichier .hex exporté (programme + interpréteur), utilisable avec avrdude ou XLoader.');
    } catch (e) { modal('Export impossible', `<p>${esc(e.message)}</p>`); }
  }
  function exportIno() {
    try {
      download(fileName('.ino'), generateCpp());
      toast('Code Arduino exporté : ' + fileName('.ino'));
    } catch (e) { showBuildError(e); }
  }

  /* ================================================================ exercices */
  function mdToHtml(md) {
    const lines = esc(md || '').split(/\n/);
    let html = '', list = false;
    for (let l of lines) {
      l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
      if (/^\s*[-•]\s+/.test(l)) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + l.replace(/^\s*[-•]\s+/, '') + '</li>'; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (/^#{1,3}\s/.test(l)) html += '<h2>' + l.replace(/^#+\s/, '') + '</h2>';
      else if (l.trim()) html += '<p>' + l + '</p>';
    }
    if (list) html += '</ul>';
    return html;
  }
  function showConsigne() {
    const ex = state.project.exercise;
    if (!ex) { modal('Consigne', '<p>Ce projet ne contient pas de consigne. (Mode enseignant : menu Fichier.)</p>'); return; }
    modal(ex.title || 'Consigne', `<div class="consigne">${mdToHtml(ex.text)}</div>${ex.locked ? '<p class="hint">🔒 Le circuit est fourni par l\'enseignant : vous ne pouvez modifier que le programme.</p>' : ''}
      <div class="actions"><button class="tb primary" id="cons-ok">C'est parti !</button></div>`, b => { b.querySelector('#cons-ok').onclick = closeModal; });
  }
  function teacherDialog() {
    const ex = state.project.exercise || { title: state.project.title, text: '', locked: false };
    modal('Mode enseignant : créer un exercice', `
      <p>Préparez le circuit (et éventuellement un début de programme), écrivez la consigne puis enregistrez l'exercice. Distribuez le fichier .json aux élèves : ils l'ouvrent avec « Fichier &gt; Ouvrir ».</p>
      <h3>Titre</h3><input type="text" id="ex-title" value="${esc(ex.title || '')}">
      <h3>Consigne</h3><textarea id="ex-text" placeholder="Ex. : Programmez le feu tricolore : vert 3 s, orange 1 s, rouge 3 s.&#10;- utilisez les broches D11, D12, D13&#10;- **bonus** : ajoutez un bouton piéton">${esc(ex.text || '')}</textarea>
      <p class="hint">Mise en forme : **gras**, *italique*, lignes commençant par « - » pour une liste, « # » pour un titre.</p>
      <label class="check"><input type="checkbox" id="ex-lock" ${ex.locked ? 'checked' : ''}> Verrouiller le circuit (les élèves ne modifient que le programme)</label>
      <div class="actions">
        <button class="tb" id="ex-remove">Retirer la consigne</button>
        <button class="tb" id="ex-apply">Appliquer</button>
        <button class="tb primary" id="ex-save">Appliquer et enregistrer l'exercice</button>
      </div>`, b => {
      const apply = () => {
        state.project.exercise = { title: b.querySelector('#ex-title').value.trim(), text: b.querySelector('#ex-text').value, locked: b.querySelector('#ex-lock').checked };
        if (state.project.exercise.title) state.project.title = state.project.exercise.title;
        state.teacher = true;
        applyLock();
        $('#btn-consigne').style.display = '';
        autosave();
      };
      b.querySelector('#ex-apply').onclick = () => { apply(); closeModal(); toast('Consigne enregistrée dans le projet.'); };
      b.querySelector('#ex-save').onclick = () => { apply(); closeModal(); saveProject(); };
      b.querySelector('#ex-remove').onclick = () => { state.project.exercise = null; applyLock(); $('#btn-consigne').style.display = 'none'; closeModal(); autosave(); };
    });
  }
  function applyLock() {
    const locked = !!(state.project.exercise && state.project.exercise.locked && !state.teacher);
    editor.locked = locked;
    $('#lock-badge').hidden = !locked;
    $('#library').classList.toggle('locked', locked);
    $('#board-select').disabled = locked;
    $('#shield-check').disabled = locked;
  }
  function guardLock() {
    if (editor.locked) { toast('Le circuit est verrouillé par l\'enseignant.'); return false; }
    return true;
  }

  /* ================================================================ aide */
  function helpDialog() {
    modal('Aide — Simulateur Arduino', `
      <h3>1. Construire le circuit</h3>
      <ul><li>Choisissez la carte (Uno, Nano, Mega) en haut ; cochez <b>Shield Grove</b> pour utiliser les modules Grove.</li>
      <li>Glissez un composant depuis la liste de gauche (ou cliquez dessus puis dans le circuit).</li>
      <li><b>Modules Grove</b> : ils se branchent automatiquement sur un port libre ; changez le port dans le panneau de droite ou tirez le câble depuis le connecteur blanc vers un port.</li>
      <li><b>Fils</b> : cliquez sur une broche (elle s'éclaire au survol), puis sur une autre. Cliquez dans le vide pour faire un coude ; <kbd>Échap</kbd> annule. Double-clic sur un fil : ajouter un coude.</li>
      <li>Les pattes posées sur les trous de la plaque d'essai ou des connecteurs de la carte sont reliées automatiquement.</li>
      <li><kbd>R</kbd> tourne la pièce sélectionnée, <kbd>Suppr</kbd> la supprime, <kbd>Ctrl</kbd>+<kbd>Z</kbd> annule. Molette : zoom ; glisser le fond : déplacer la vue.</li></ul>
      <h3>2. Programmer avec les blocs</h3>
      <ul><li>« Au démarrage » s'exécute une fois, « Répéter indéfiniment » en boucle (comme setup et loop).</li>
      <li>L'onglet <b>Code Arduino</b> montre le programme C++ équivalent ; il peut être exporté en <b>.ino</b> pour l'IDE Arduino.</li>
      <li>Les réglages <code>pinMode</code> des sorties et <code>Serial.begin(9600)</code> sont ajoutés automatiquement s'ils manquent.</li></ul>
      <h3>3. Simuler</h3>
      <ul><li>« Démarrer la simulation » (<kbd>F5</kbd>). Cliquez sur les boutons du circuit, réglez les capteurs dans le panneau de droite.</li>
      <li>Le simulateur calcule les tensions et courants : une LED sans résistance grille, un court-circuit est signalé (onglet <b>Messages</b>).</li>
      <li>Le <b>moniteur série</b> et le <b>traceur série</b> fonctionnent comme dans l'IDE Arduino.</li></ul>
      <h3>4. Téléverser sur la vraie carte</h3>
      <ul><li>Avec Chrome ou Edge, « Téléverser sur la carte » envoie le programme par USB, sans logiciel à installer.</li>
      <li>La première fois, l'interpréteur du simulateur est installé sur la carte avec le programme (quelques secondes).</li>
      <li>Pour revenir à l'IDE Arduino, il suffit de téléverser un autre croquis : rien n'est abîmé.</li></ul>
      ${helpDriversHtml()}
      <h3>5. Enregistrer</h3>
      <ul><li>Le travail est sauvegardé automatiquement dans le navigateur. « Fichier &gt; Enregistrer » crée un fichier .json à rendre ou à rouvrir plus tard.</li>
      <li>Enseignants : « Fichier &gt; Mode enseignant » pour écrire une consigne et verrouiller le circuit.</li></ul>
      <p class="hint">Micrologiciel : ${esc(FIRMWARE.built)} — ${CATALOG.list.length} composants.</p>`);
  }

  /* ================================================================ onglets, menus, raccourcis */
  function showTab(name) {
    $$('#bottom .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $$('#bottom .tabpane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
    $('#bottom').classList.remove('collapsed');
    if (name === 'plot') { plotter.dirty = true; setTimeout(() => plotter.draw(), 20); }
  }
  function showCodeTab(name) {
    $$('#code-pane .tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === name));
    $$('#code-pane .ctabpane').forEach(p => p.classList.toggle('active', p.id === 'cpane-' + name));
    if (name === 'text') updateCodeView();
    if (name === 'blocks') setTimeout(() => Blockly.svgResize(workspace), 10);
  }
  function bindUI() {
    // menus
    $$('[data-menu]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const m = $('#menu-' + b.dataset.menu);
      const open = m.classList.contains('open');
      $$('.dropdown').forEach(d => d.classList.remove('open'));
      if (!open) m.classList.add('open');
    });
    document.addEventListener('click', () => $$('.dropdown').forEach(d => d.classList.remove('open')));
    $$('#menu-file [data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'new') newProject();
      if (a === 'open') openProject();
      if (a === 'save') saveProject();
      if (a === 'export-ino') exportIno();
      if (a === 'export-hex') exportHex();
      if (a === 'teacher') teacherDialog();
    });
    $('#menu-examples').innerHTML = EXAMPLES.map((ex, i) => `<button data-ex="${i}">${esc(ex.title)}<span class="ex-desc">${esc(ex.desc)}</span></button>`).join('');
    $$('#menu-examples [data-ex]').forEach(b => b.onclick = () => {
      if (!confirm('Ouvrir cet exemple ? Le projet actuel sera remplacé (pensez à l\'enregistrer).')) return;
      loadProject(EXAMPLES[+b.dataset.ex]);
      toast('Exemple chargé : cliquez sur « Démarrer la simulation ».');
    });
    $('#board-select').onchange = e => setBoard(e.target.value);
    $('#shield-check').onchange = e => setShield(e.target.checked);
    $('#btn-run').onclick = () => (state.running ? stopSim() : startSim());
    $('#btn-upload').onclick = uploadDialog;
    $('#btn-consigne').onclick = showConsigne;
    $('#btn-help').onclick = helpDialog;
    $('#btn-sound').onclick = () => { const on = audio.toggle(); $('#btn-sound').textContent = on ? '🔊' : '🔇'; };
    $('#modal-close').onclick = closeModal;
    $('#modal-bg').onclick = e => { if (e.target.id === 'modal-bg') closeModal(); };
    $$('#bottom .tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));
    $$('#code-pane .tab').forEach(t => t.onclick = () => showCodeTab(t.dataset.ctab));
    $('#bottom-toggle').onclick = () => {
      const b = $('#bottom');
      b.classList.toggle('collapsed');
      $('#bottom-toggle').textContent = b.classList.contains('collapsed') ? '▴' : '▾';
    };
    $('#msgs').onclick = e => {
      const li = e.target.closest('li');
      if (!li) return;
      const m = messages[+li.dataset.i];
      if (m && m.blockId) { showCodeTab('blocks'); const b = workspace.getBlockById(m.blockId); if (b) { b.select(); workspace.centerOnBlock(m.blockId); } }
    };
    // moniteur série
    $('#serial-clear').onclick = () => { serialAppend('', true); plotter.clear(); };
    $('#serial-send').onclick = serialSend;
    $('#serial-input').onkeydown = e => { if (e.key === 'Enter') serialSend(); };
    $('#serial-source').onchange = e => {
      const board = e.target.value === 'board';
      $('#serial-baud-wrap').hidden = !board;
      $('#serial-connect').hidden = !board;
      if (!board && state.boardSerial) toggleBoardSerial();
      if (board && !Uploader.supported()) toast('La liaison avec la carte nécessite Chrome ou Edge.');
    };
    $('#serial-connect').onclick = toggleBoardSerial;
    // code
    $('#copy-code').onclick = () => {
      const code = $('#code-view').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Code copié.'), () => {
        const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Code copié.');
      });
    };
    $('#dl-code').onclick = exportIno;
    // circuit
    $$('[data-zoom]').forEach(b => b.onclick = () => {
      if (b.dataset.zoom === 'in') editor.zoom(1.25);
      if (b.dataset.zoom === 'out') editor.zoom(0.8);
      if (b.dataset.zoom === 'fit') editor.fit();
    });
    $('#btn-undo').onclick = () => { if (guardLock()) { stopSimForEdit(); editor.undo(); } };
    $('#btn-redo').onclick = () => { if (guardLock()) { stopSimForEdit(); editor.redo(); } };
    // bibliothèque
    $('#lib-search').oninput = e => renderLibrary(e.target.value);
    $('#lib-list').addEventListener('click', e => {
      const it = e.target.closest('.lib-item');
      if (!it || !guardLock()) return;
      editor.startPlacing(it.dataset.type);
      toast('Cliquez dans le circuit pour poser « ' + CATALOG.byType[it.dataset.type].name + ' » (Échap pour annuler).', 2500);
    });
    $('#lib-list').addEventListener('dragstart', e => {
      const it = e.target.closest('.lib-item');
      if (!it) return;
      e.dataTransfer.setData('text/x-comp', it.dataset.type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    // séparateur redimensionnable
    const sp = $('#splitter');
    sp.onmousedown = e => {
      e.preventDefault();
      const move = ev => {
        const w = Math.max(280, Math.min(window.innerWidth - 520, window.innerWidth - ev.clientX));
        document.documentElement.style.setProperty('--code-w', w + 'px');
        Blockly.svgResize(workspace);
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    // raccourcis clavier
    window.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.closest('.blocklyWidgetDiv, #blockly');
      if (e.key === 'F5') { e.preventDefault(); state.running ? stopSim() : startSim(); return; }
      if (e.key === 'Escape') { editor.cancelMode(); closeModal(); return; }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && editor.sel) { e.preventDefault(); if (guardLock()) { stopSimForEdit(); editor.deleteSelection(); } }
      if ((e.key === 'r' || e.key === 'R') && editor.sel && !e.ctrlKey) { if (guardLock()) { stopSimForEdit(); editor.rotateSelection(); } }
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (guardLock()) { stopSimForEdit(); editor.undo(); } }
      if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); if (guardLock()) { stopSimForEdit(); editor.redo(); } }
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveProject(); }
    });
    window.addEventListener('beforeunload', autosave);
  }

  /* ================================================================ démarrage */
  function init() {
    setupBlockly();
    plotter = new Plotter($('#plot'), $('#plot-legend'));
    new ResizeObserver(() => { plotter.dirty = true; plotter.draw(); }).observe($('#pane-plot'));
    editor = new Editor($('#circuit'), {
      onChange: () => { stopSimForEdit(); autosave(); renderProps(editor.sel); updateCodeView(); },
      onSelect: sel => renderProps(sel),
      onToast: m => toast(m, 4500),
      onDropComponent: (type, w) => {
        if (!guardLock()) return;
        stopSimForEdit();
        editor.addComponent(type, w.x, w.y);
      },
      onInteractDown: comp => interactDown(comp),
      onInteractUp: comp => interactUp(comp)
    });
    root.EDITOR = editor;
    bindUI();
    renderLibrary('');
    state.project = defaultProject();
    if (!restoreAutosave()) loadProject(EXAMPLES[1], { silent: true });
    renderMsgs();
    if (!Uploader.supported()) addMsg('Ce navigateur ne permet pas le téléversement USB : utilisez Google Chrome ou Microsoft Edge pour envoyer le programme sur une vraie carte.', 'info');
  }
  // accès pour les tests automatisés
  APP.state = state;
  APP.start = startSim;
  APP.stop = stopSim;
  APP.loadProject = p => loadProject(p, { silent: true });
  APP.serialize = serialize;
  APP.cpp = generateCpp;
  APP.workspace = () => workspace;
  APP.messages = messages;

  window.addEventListener('DOMContentLoaded', init);
})(this);
