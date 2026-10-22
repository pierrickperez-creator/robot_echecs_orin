// Projets d'exemple (circuit + blocs) proposés dans le menu « Exemples »
(function (root) {
  const num = v => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
  const blk = (type, fields, inputs) => ({ block: Object.assign({ type }, fields ? { fields } : {}, inputs ? { inputs } : {}) });
  const txt = t => ({ shadow: { type: 'text', fields: { TEXT: t } } });
  // relie une liste de blocs par « next »
  const seq = (...items) => {
    const list = items.flat().map(x => x.block);
    for (let i = 0; i < list.length - 1; i++) list[i].next = { block: list[i + 1] };
    return list.length ? { block: list[0] } : undefined;
  };
  const program = (setup, loop, vars) => ({
    blocks: { languageVersion: 0, blocks: [
      Object.assign({ type: 'ard_setup', x: 20, y: 20 }, setup ? { inputs: { DO: setup } } : {}),
      Object.assign({ type: 'ard_loop', x: 20, y: 160 }, loop ? { inputs: { DO: loop } } : {})
    ] },
    variables: vars || []
  });
  const delay = (v, unit) => blk('ard_delay', { UNIT: unit || 'ms' }, { TIME: num(v) });
  const write = (pin, high) => blk('ard_digital_write', { PIN: pin }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: high ? '1' : '0' } } } });
  const board = { id: 'board', type: 'board', x: 0, y: 0 };
  const project = (title, desc, boardId, shield, comps, wires, cables, blocks) => ({
    format: 'simulateur-arduino', version: 1, title, desc, board: boardId, shield,
    circuit: { comps: [board, ...comps], wires: wires || [], cables: cables || [] },
    blocks, exercise: null
  });

  const EX = [];

  EX.push(project('Clignotement de la LED intégrée', 'La LED « L » (broche 13) s\'allume et s\'éteint chaque seconde.', 'uno', false, [], [], [],
    program(null, seq(write('D13', true), delay(1, 's'), write('D13', false), delay(1, 's')))));

  EX.push(project('Bouton et LED (Grove)', 'La LED s\'allume tant qu\'on appuie sur le bouton. Cliquez sur le bouton pendant la simulation.', 'uno', true,
    [{ id: 'btn', type: 'grove_button', x: 320, y: 10 }, { id: 'led', type: 'grove_led_red', x: 320, y: 130 }], [],
    [{ comp: 'btn', port: 'D2' }, { comp: 'led', port: 'D4' }],
    program(null, seq({ block: {
      type: 'controls_if', extraState: { hasElse: true },
      inputs: {
        IF0: blk('grove_din', { MOD: 'grove_button', PORT: 'D2' }),
        DO0: blk('grove_dout', { STATE: '1', MOD: 'grove_led_red', PORT: 'D4' }),
        ELSE: blk('grove_dout', { STATE: '0', MOD: 'grove_led_red', PORT: 'D4' })
      }
    } }))));

  EX.push(project('Potentiomètre et servomoteur (Grove)', 'Le servomoteur suit la position du potentiomètre. Réglez le potentiomètre dans le panneau de droite.', 'uno', true,
    [{ id: 'pot', type: 'grove_rotary', x: 320, y: 10 }, { id: 'servo', type: 'grove_servo', x: 320, y: 130 }], [],
    [{ comp: 'pot', port: 'A0' }, { comp: 'servo', port: 'D5' }],
    program(null, seq(
      blk('servo_write', { PORT: 'D5' }, { ANGLE: blk('ard_map', null, {
        X: blk('grove_ain', { MOD: 'grove_rotary', PORT: 'A0' }), A: num(0), B: num(1023), C: num(0), D: num(180)
      }) }),
      delay(20)))));

  EX.push(project('Thermomètre sur écran LCD (Grove)', 'Affiche la température ; l\'écran devient rouge au-dessus de 25 °C.', 'uno', true,
    [{ id: 'temp', type: 'grove_temperature', x: 320, y: 10 }, { id: 'lcd', type: 'grove_lcd_rgb', x: -30, y: 250 }], [],
    [{ comp: 'temp', port: 'A0' }, { comp: 'lcd', port: 'I2C_1' }],
    program(null, seq(
      blk('variables_set', { VAR: { id: 'v_t' } }, { VALUE: blk('grove_ain_temp', { PORT: 'A0' }) }),
      blk('lcd_cursor', null, { COL: num(0), ROW: num(0) }),
      blk('lcd_print', null, { VALUE: { block: { type: 'text_join', extraState: { itemCount: 3 }, inputs: {
        ADD0: txt('Temp: '),
        ADD1: blk('ard_decimals', { DEC: 1 }, { X: blk('variables_get', { VAR: { id: 'v_t' } }) }),
        ADD2: txt(' °C   ')
      } } } }),
      { block: { type: 'controls_if', extraState: { hasElse: true }, inputs: {
        IF0: blk('logic_compare', { OP: 'GT' }, { A: blk('variables_get', { VAR: { id: 'v_t' } }), B: num(25) }),
        DO0: blk('lcd_rgb', null, { COLOR: { shadow: { type: 'color_named', fields: { C: '255,0,0' } } } }),
        ELSE: blk('lcd_rgb', null, { COLOR: { shadow: { type: 'color_named', fields: { C: '0,0,255' } } } })
      } } },
      delay(500)), [{ name: 'temperature', id: 'v_t' }])));

  // feu tricolore sur plaque d'essai : résistance de b(c) à b(c+4), LED anode e(c+4) cathode e(c+5)
  {
    const bbX = 0, bbY = 260;
    const hole = (row, col) => {
      const rows = { a: 50, b: 60, c: 70, d: 80, e: 90 };
      return { x: bbX + 20 + (col - 1) * 10, y: bbY + rows[row] };
    };
    const comps = [{ id: 'bb', type: 'breadboard', x: bbX, y: bbY }];
    const wires = [];
    const leds = [['led_red', 'D13', 2], ['led_yellow', 'D12', 10], ['led_green', 'D11', 18]];
    leds.forEach(([type, pin, c], i) => {
      comps.push(Object.assign({ id: 'r' + i, type: 'resistor', props: { ohms: 220 } }, hole('b', c)));
      comps.push(Object.assign({ id: 'l' + i, type }, hole('e', c + 4)));
      wires.push({ id: 'wp' + i, a: { c: 'board', p: pin }, b: { c: 'bb', p: 'a' + c }, pts: [], color: '#2e7d32' });
      wires.push({ id: 'wg' + i, a: { c: 'bb', p: 'a' + (c + 5) }, b: { c: 'bb', p: 'TN' + (c + 5) }, pts: [], color: '#212121' });
    });
    wires.push({ id: 'wgnd', a: { c: 'board', p: 'GND_T' }, b: { c: 'bb', p: 'TN1' }, pts: [{ x: 110, y: 240 }, { x: 20, y: 240 }], color: '#212121' });
    EX.push(project('Feu tricolore sur plaque d\'essai', 'Trois LED avec leurs résistances de 220 Ω, câblées sur D11, D12 et D13.', 'uno', false, comps, wires, [],
      program(null, seq(
        write('D11', true), delay(3, 's'), write('D11', false),
        write('D12', true), delay(1, 's'), write('D12', false),
        write('D13', true), delay(3, 's'), write('D13', false)))));
  }

  EX.push(project('Radar de recul : ultrasons et barre de LED (Grove)', 'Plus l\'obstacle est proche, plus la barre s\'allume. La distance s\'affiche aussi dans le moniteur série.', 'uno', true,
    [{ id: 'us', type: 'grove_ultrasonic', x: 320, y: 0 }, { id: 'bar', type: 'grove_ledbar', x: 320, y: 120 }], [],
    [{ comp: 'us', port: 'D7' }, { comp: 'bar', port: 'D2' }],
    program(null, seq(
      blk('variables_set', { VAR: { id: 'v_d' } }, { VALUE: blk('grove_ultrasonic', { PORT: 'D7' }) }),
      blk('ard_serial_print', { NL: '1' }, { VALUE: { block: { type: 'text_join', extraState: { itemCount: 3 }, inputs: {
        ADD0: txt('Distance : '), ADD1: blk('variables_get', { VAR: { id: 'v_d' } }), ADD2: txt(' cm') } } } }),
      blk('ledbar_level', { PORT: 'D2' }, { N: blk('math_constrain', null, {
        VALUE: blk('ard_map', null, { X: blk('variables_get', { VAR: { id: 'v_d' } }), A: num(5), B: num(100), C: num(10), D: num(0) }),
        LOW: num(0), HIGH: num(10) }) }),
      delay(100)), [{ name: 'distance', id: 'v_d' }])));

  EX.push(project('Courbe de luminosité (traceur série)', 'Ouvrez l\'onglet « Traceur série » et faites varier la lumière dans le panneau de droite.', 'uno', true,
    [{ id: 'light', type: 'grove_light', x: 320, y: 10 }, { id: 'snd', type: 'grove_sound', x: 320, y: 130 }], [],
    [{ comp: 'light', port: 'A0' }, { comp: 'snd', port: 'A2' }],
    program(null, seq(
      { block: { type: 'ard_serial_plot', fields: { N1: 'lumiere', N2: 'son', N3: '' }, inputs: {
        V1: blk('grove_ain', { MOD: 'grove_light', PORT: 'A0' }), V2: blk('grove_ain', { MOD: 'grove_sound', PORT: 'A2' }) } } },
      delay(50)))));

  EX.push(project('Nano : bouton-poussoir avec INPUT_PULLUP', 'Un bouton relié entre D2 et GND, sans résistance grâce à la résistance de rappel interne.', 'nano', false,
    [{ id: 'bb', type: 'breadboard', x: -60, y: 120 }, { id: 'pb', type: 'pushbutton', x: 50, y: 210 }],
    [{ id: 'w1', a: { c: 'board', p: 'D2_t' }, b: { c: 'bb', p: 'a10' }, pts: [{ x: 120, y: -20 }, { x: 250, y: -20 }, { x: 250, y: 120 }, { x: 50, y: 120 }], color: '#2e7d32' },
      { id: 'w2', a: { c: 'board', p: 'GND_b' }, b: { c: 'bb', p: 'j12' }, pts: [{ x: 150, y: 100 }, { x: 290, y: 100 }, { x: 290, y: 340 }, { x: 70, y: 340 }], color: '#212121' }],
    [],
    program(seq(blk('ard_pin_mode', { PIN: 'D2', MODE: '2' }), blk('ard_pin_mode', { PIN: 'D13', MODE: '1' })),
      seq({ block: { type: 'controls_if', extraState: { hasElse: true }, inputs: {
        IF0: blk('logic_compare', { OP: 'EQ' }, { A: blk('ard_digital_read', { PIN: 'D2' }), B: { block: { type: 'ard_highlow', fields: { V: '0' } } } }),
        DO0: write('D13', true), ELSE: write('D13', false) } } }, delay(10)))));

  // moteur commandé par un transistor NPN, mesures au multimètre
  {
    const bbX = 0, bbY = 260;
    const rows = { a: 50, b: 60, c: 70, d: 80, e: 90, f: 120, g: 130, h: 140, i: 150, j: 160 };
    const hole = (row, col) => ({ x: bbX + 20 + (col - 1) * 10, y: bbY + rows[row] });
    const comps = [
      { id: 'bb', type: 'breadboard', x: bbX, y: bbY },
      Object.assign({ id: 'q', type: 'npn' }, hole('d', 10)),
      Object.assign({ id: 'rb', type: 'resistor', props: { ohms: 1000 } }, hole('b', 7)),
      Object.assign({ id: 'm', type: 'dcmotor' }, hole('h', 20)),
      Object.assign({ id: 'd', type: 'diode' }, hole('f', 20)),  // cathode (bague) côté +5 V
      { id: 'amp', type: 'multimeter', x: 400, y: 470, sim: { mode: 'A' } },
      { id: 'volt', type: 'multimeter', x: 400, y: 260, sim: { mode: 'V' } }
    ];
    const w = (id, a, b, color, pts) => ({ id, a, b, pts: pts || [], color });
    const wires = [
      w('w1', { c: 'board', p: 'D9' }, { c: 'bb', p: 'a7' }, '#2e7d32'),
      w('w2', { c: 'board', p: 'GND_T' }, { c: 'bb', p: 'a10' }, '#212121', [{ x: 110, y: 240 }, { x: 110, y: 240 }]),
      w('w3', { c: 'bb', p: 'a12' }, { c: 'bb', p: 'j20' }, '#1565c0', [{ x: 130, y: 250 }, { x: 225, y: 250 }, { x: 225, y: 440 }, { x: 210, y: 440 }]),
      w('w4', { c: 'board', p: '5V' }, { c: 'amp', p: 'A' }, '#d32f2f', [{ x: 150, y: 230 }, { x: 370, y: 230 }, { x: 370, y: 490 }, { x: 400, y: 490 }]),
      w('w5', { c: 'amp', p: 'COM' }, { c: 'bb', p: 'j24' }, '#d32f2f', [{ x: 420, y: 500 }, { x: 250, y: 500 }]),
      w('w6', { c: 'bb', p: 'j22' }, { c: 'bb', p: 'i24' }, '#d32f2f'),
      w('w7', { c: 'volt', p: 'V' }, { c: 'bb', p: 'g22' }, '#d32f2f', [{ x: 440, y: 290 }, { x: 330, y: 290 }, { x: 330, y: 390 }, { x: 230, y: 390 }]),
      w('w8', { c: 'volt', p: 'COM' }, { c: 'bb', p: 'g20' }, '#212121', [{ x: 420, y: 280 }, { x: 320, y: 280 }, { x: 320, y: 380 }, { x: 210, y: 380 }])
    ];
    EX.push(project('Moteur commandé par un transistor', 'Une broche ne peut pas alimenter un moteur : le transistor NPN amplifie le courant. Le multimètre mesure courant et tension (diode de roue libre en parallèle sur le moteur).',
      'uno', false, comps, wires, [],
      program(null, seq(
        blk('ard_analog_write', { PIN: 'D9' }, { VALUE: num(255) }), delay(2, 's'),
        blk('ard_analog_write', { PIN: 'D9' }, { VALUE: num(120) }), delay(2, 's'),
        blk('ard_analog_write', { PIN: 'D9' }, { VALUE: num(0) }), delay(2, 's')))));
  }

  root.EXAMPLES = EX;
})(this);
