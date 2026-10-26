/*
 * Exemples de code (blocs) associés à chaque composant.
 * SNIPPETS.forComponent(comp, ctx) renvoie { desc, setup: [blocs], loop: [blocs] } au format JSON de Blockly,
 * déjà réglé sur les broches où le composant est réellement branché.
 * ctx = { board, port (port Grove ou broche du signal), pins: { idBroche: 'D4' | 'A0' | null } }
 */
(function (root) {
  const num = v => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
  const txt = t => ({ shadow: { type: 'text', fields: { TEXT: t } } });
  const B = (type, fields, inputs, extra) => Object.assign({ type }, fields ? { fields } : {}, inputs ? { inputs } : {}, extra || {});
  const val = b => ({ block: b });
  const chain = list => {
    if (!list || !list.length) return undefined;
    const copy = JSON.parse(JSON.stringify(list));
    for (let i = 0; i < copy.length - 1; i++) copy[i].next = { block: copy[i + 1] };
    return { block: copy[0] };
  };
  const delay = (ms, unit) => B('ard_delay', { UNIT: unit || 'ms' }, { TIME: num(ms) });
  const print = (input, nl) => B('ard_serial_print', { NL: nl === false ? '0' : '1' }, { VALUE: input });
  const join = (...parts) => ({ block: B('text_join', null, Object.fromEntries(parts.map((p, i) => ['ADD' + i, p])), { extraState: { itemCount: parts.length } }) });
  const getVar = name => val(B('variables_get', { VAR: { name } }));
  const setVar = (name, input) => B('variables_set', { VAR: { name } }, { VALUE: input });
  const ifElse = (cond, then, els) => B('controls_if', null, Object.assign({ IF0: cond, DO0: chain(then) }, els ? { ELSE: chain(els) } : {}),
    els ? { extraState: { hasElse: true } } : {});
  const compare = (a, op, b) => val(B('logic_compare', { OP: op }, { A: a, B: b }));
  const plot = (pairs) => {
    const fields = {}, inputs = {};
    pairs.forEach(([name, input], i) => { fields['N' + (i + 1)] = name; inputs['V' + (i + 1)] = input; });
    for (let i = pairs.length + 1; i <= 3; i++) fields['N' + i] = '';
    return B('ard_serial_plot', fields, inputs);
  };
  const color = c => ({ shadow: { type: 'color_named', fields: { C: c } } });
  const short = def => def.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();

  function forComponent(comp, ctx) {
    const def = comp.def;
    const board = ctx.board;
    const isPwm = p => !!p && /^D\d+$/.test(p) && board.isPwm(board.pinNumber(p));
    const D = ctx.port && /^[DA]\d+$/.test(ctx.port) ? ctx.port : null;
    const dig = D || 'D2';
    const ana = D && D[0] === 'A' ? D : 'A0';
    const name = short(def);
    const MOD = def.type;
    const pin = id => ctx.pins[id] || null;
    switch (def.kind) {
      /* ---------------------------------------------------------- Grove : entrées */
      case 'din':
        return {
          desc: `Affiche un message dans le moniteur série quand le module ${def.ask || 'est actif'}.`,
          loop: [ifElse(val(B('grove_din', { MOD, PORT: dig })), [print(txt(`${name} : ${def.ask || 'actif'} !`))]), delay(200)]
        };
      case 'ain': {
        if (def.sim && def.sim.conv === 'thermistor') {
          return {
            desc: 'Affiche la température en °C toutes les secondes.',
            loop: [print(join(txt('Température : '), val(B('ard_decimals', { DEC: 1 }, { X: val(B('grove_ain_temp', { PORT: ana })) })), txt(' °C'))), delay(1, 's')]
          };
        }
        return {
          desc: `Envoie la valeur du capteur (0 à 1023) au traceur série : ouvrez l'onglet « Traceur série ».`,
          loop: [plot([[MOD.replace('grove_', ''), val(B('grove_ain', { MOD, PORT: ana }))]]), delay(100)]
        };
      }
      case 'joystick':
        return {
          desc: 'Trace les positions X et Y du joystick.',
          loop: [plot([['X', val(B('grove_joystick', { PORT: ana, AXIS: 'X' }))], ['Y', val(B('grove_joystick', { PORT: ana, AXIS: 'Y' }))]]), delay(100)]
        };
      case 'ultrasonic':
        return {
          desc: 'Mesure la distance et l\'affiche dans le moniteur série.',
          loop: [setVar('distance', val(B('grove_ultrasonic', { PORT: dig }))),
            print(join(txt('Distance : '), getVar('distance'), txt(' cm'))), delay(200)]
        };
      case 'dht':
        return {
          desc: 'Affiche température et humidité toutes les 2 secondes (le DHT est lent).',
          loop: [print(join(txt('Température : '), val(B('grove_dht', { WHAT: '0', MOD, PORT: dig })), txt(' °C'))),
            print(join(txt('Humidité : '), val(B('grove_dht', { WHAT: '1', MOD, PORT: dig })), txt(' %'))), delay(2, 's')]
        };
      case 'thi2c':
        return {
          desc: 'Affiche température et humidité chaque seconde.',
          loop: [print(join(txt('Température : '), val(B('grove_thi2c', { WHAT: '0', MOD })), txt(' °C'))),
            print(join(txt('Humidité : '), val(B('grove_thi2c', { WHAT: '1', MOD })), txt(' %'))), delay(1, 's')]
        };
      case 'baro':
        return {
          desc: 'Affiche la pression atmosphérique, la température et l\'altitude.',
          loop: [print(join(txt('Pression : '), val(B('grove_baro', { WHAT: '1' })), txt(' hPa'))),
            print(join(txt('Température : '), val(B('grove_baro', { WHAT: '0' })), txt(' °C'))),
            print(join(txt('Altitude : '), val(B('grove_baro', { WHAT: '2' })), txt(' m'))), delay(1, 's')]
        };
      case 'accel':
        return {
          desc: 'Trace les accélérations X, Y, Z (en g) : penchez le module dans le panneau de réglage.',
          loop: [plot([['X', val(B('grove_accel', { AXIS: '0' }))], ['Y', val(B('grove_accel', { AXIS: '1' }))], ['Z', val(B('grove_accel', { AXIS: '2' }))]]), delay(100)]
        };
      case 'i2cval': {
        const block = { lightI2CRead: 'grove_lux', fingerHeartRead: 'grove_heart', tofRead: 'grove_tof' }[def.sim.sys];
        return {
          desc: `Affiche la mesure (${def.sim.unit}) chaque demi-seconde.`,
          loop: [print(join(txt(def.sim.label + ' : '), val(B(block)), txt(' ' + def.sim.unit))), delay(500)]
        };
      }
      case 'color':
        return {
          desc: 'Trace les quantités de rouge, vert et bleu vues par le capteur.',
          loop: [plot([['rouge', val(B('grove_color', { CH: '0' }))], ['vert', val(B('grove_color', { CH: '1' }))], ['bleu', val(B('grove_color', { CH: '2' }))]]), delay(200)]
        };
      case 'irtemp':
        return {
          desc: 'Affiche la température de l\'objet visé.',
          loop: [print(join(txt('Objet : '), val(B('grove_irtemp', { W: '0' })), txt(' °C'))), delay(500)]
        };
      case 'co2':
        return {
          desc: 'Affiche le taux de CO2 et allume une alerte au-dessus de 1000 ppm.',
          loop: [setVar('co2', val(B('grove_co2', { W: '0' }))),
            print(join(txt('CO2 : '), getVar('co2'), txt(' ppm'))),
            ifElse(compare(getVar('co2'), 'GT', num(1000)), [print(txt('Aérez la salle !'))]), delay(2, 's')]
        };
      case 'gesture':
        return {
          desc: 'Affiche le numéro du geste détecté (1 haut, 2 bas, 3 gauche, 4 droite…).',
          loop: [setVar('geste', val(B('grove_gesture', { G: 'N' }))),
            ifElse(compare(getVar('geste'), 'NEQ', num(0)), [print(join(txt('Geste n° '), getVar('geste')))]), delay(100)]
        };
      case 'rtc':
        return {
          desc: 'Affiche l\'heure chaque seconde (hh:mm:ss).',
          loop: [print(join(val(B('grove_rtc', { F: '2' })), txt(':'), val(B('grove_rtc', { F: '1' })), txt(':'), val(B('grove_rtc', { F: '0' })))), delay(1, 's')]
        };
      case 'encoder':
        return {
          desc: 'Affiche la position de l\'encodeur (tournez-le dans le panneau de réglage).',
          loop: [print(join(txt('Position : '), val(B('grove_encoder', { PORT: dig })))), delay(200)]
        };
      case 'ir':
        return {
          desc: 'Affiche le code de chaque touche de télécommande reçue.',
          loop: [setVar('code', val(B('grove_ir', { PORT: dig }))),
            ifElse(compare(getVar('code'), 'NEQ', num(0)), [print(join(txt('Touche : '), getVar('code')))]), delay(50)]
        };
      case 'rfid':
        return {
          desc: 'Affiche l\'identifiant de chaque badge présenté.',
          loop: [setVar('badge', val(B('grove_rfid'))),
            ifElse(compare(getVar('badge'), 'NEQ', num(0)), [print(join(txt('Badge : '), getVar('badge')))]), delay(100)]
        };
      case 'keypad':
        return {
          desc: 'Affiche chaque touche appuyée (10 = *, 11 = #).',
          loop: [setVar('touche', val(B('grove_keypad'))),
            ifElse(compare(getVar('touche'), 'GTE', num(0)), [print(join(txt('Touche : '), getVar('touche')))]), delay(50)]
        };

      /* ---------------------------------------------------------- Grove : sorties */
      case 'pwm':
        if (isPwm(dig)) {
          return {
            desc: `Fait varier progressivement l'intensité (port ${dig}, sortie PWM).`,
            loop: [B('controls_for', { VAR: { name: 'i' } }, { FROM: num(0), TO: num(255), BY: num(5),
              DO: chain([B('grove_pwm', { MOD, PORT: dig }, { VALUE: getVar('i') }), delay(15)]) }), delay(300)]
          };
        }
        // port non PWM : simple clignotement
        // falls through
      case 'dout':
        return {
          desc: `Active puis désactive le module chaque seconde${def.kind === 'pwm' && !isPwm(dig) ? ' (branchez-le sur D3, D5 ou D6 pour faire varier son intensité)' : ''}.`,
          loop: [B('grove_dout', { STATE: '1', MOD, PORT: dig }), delay(1, 's'), B('grove_dout', { STATE: '0', MOD, PORT: dig }), delay(1, 's')]
        };
      case 'buzzer':
        return {
          desc: 'Joue une petite mélodie (do, mi, sol, do) puis attend une seconde.',
          loop: [...['262', '330', '392', '523'].map(n => B('grove_note', { NOTE: n, PORT: dig }, { DUR: num(200) })), delay(1, 's')]
        };
      case 'servo': {
        const p = def.type === 'servo' ? (pin('SIG') || 'D9') : dig;
        return {
          desc: `Fait tourner le servomoteur (broche ${p}) à 0°, 90° puis 180°.`,
          loop: [0, 90, 180].flatMap(a => [B('servo_write', { PORT: p }, { ANGLE: num(a) }), delay(1, 's')])
        };
      }
      case 'motor':
        return {
          desc: 'Fait tourner le moteur A dans un sens, puis dans l\'autre, puis l\'arrête.',
          loop: [B('grove_motor', { M: '0' }, { SPEED: num(200) }), delay(2, 's'), B('grove_motor', { M: '0' }, { SPEED: num(-200) }), delay(2, 's'),
            B('grove_motor', { M: '0' }, { SPEED: num(0) }), delay(1, 's')]
        };
      case 'chain':
        return {
          desc: 'Fait passer la LED par le rouge, le vert et le bleu.',
          loop: ['255,0,0', '0,255,0', '0,0,255'].flatMap(c => [B('grove_chain', { PORT: dig }, { I: num(0), COLOR: color(c) }), delay(500)])
        };
      case 'pixels': {
        const n = (comp.props && comp.props.count) || (def.props && def.props.count) || 10;
        return {
          desc: `Allume les ${n} LED en rouge, puis en bleu.`,
          loop: [B('grove_pixels_fill', { PORT: dig }, { N: num(n), COLOR: color('255,0,0') }), delay(500),
            B('grove_pixels_fill', { PORT: dig }, { N: num(n), COLOR: color('0,0,255') }), delay(500)]
        };
      }
      case 'mp3':
        return {
          desc: 'Règle le volume et joue la piste 1 au démarrage.',
          setup: [B('grove_mp3', { ACT: 'vol' }, { N: num(20) }), B('grove_mp3', { ACT: 'play' }, { N: num(1) })]
        };

      /* ---------------------------------------------------------- Grove : afficheurs */
      case 'lcd':
        return {
          desc: 'Écrit « Bonjour ! » sur la première ligne et le temps écoulé sur la seconde.',
          setup: [B('lcd_clear'), ...(def.props.rgb ? [B('lcd_rgb', null, { COLOR: color('0,0,255') })] : []),
            B('lcd_cursor', null, { COL: num(0), ROW: num(0) }), B('lcd_print', null, { VALUE: txt('Bonjour !') })],
          loop: [B('lcd_cursor', null, { COL: num(0), ROW: num(1) }),
            B('lcd_print', null, { VALUE: join(val(B('math_round', { OP: 'ROUNDDOWN' }, { NUM: val(B('math_arithmetic', { OP: 'DIVIDE' }, { A: val(B('ard_millis')), B: num(1000) })) })), txt(' s   ')) }),
            delay(500)]
        };
      case 'oled':
        return {
          desc: 'Écrit un titre et le temps écoulé sur l\'écran OLED.',
          setup: [B('oled_clear'), B('oled_cursor', null, { COL: num(0), ROW: num(0) }), B('oled_print', null, { VALUE: txt('Bonjour !') })],
          loop: [B('oled_cursor', null, { COL: num(0), ROW: num(2) }),
            B('oled_print', null, { VALUE: join(val(B('math_round', { OP: 'ROUNDDOWN' }, { NUM: val(B('math_arithmetic', { OP: 'DIVIDE' }, { A: val(B('ard_millis')), B: num(1000) })) })), txt(' s   ')) }),
            delay(500)]
        };
      case 'tm1637':
        return {
          desc: 'Affiche un compteur de secondes.',
          setup: [B('tm_bright', { PORT: dig }, { B: num(4) })],
          loop: [B('tm_number', { PORT: dig }, { N: val(B('math_round', { OP: 'ROUNDDOWN' }, { NUM: val(B('math_arithmetic', { OP: 'DIVIDE' }, { A: val(B('ard_millis')), B: num(1000) })) })) }), delay(200)]
        };
      case 'ledbar':
        return {
          desc: 'Remplit la barre de LED progressivement.',
          loop: [B('controls_for', { VAR: { name: 'niveau' } }, { FROM: num(0), TO: num(10), BY: num(1),
            DO: chain([B('ledbar_level', { PORT: dig }, { N: getVar('niveau') }), delay(150)]) })]
        };

      /* ---------------------------------------------------------- composants de base */
      case 'led': {
        const p = pin('A') || 'D13';
        return {
          desc: `Fait clignoter la LED (broche ${p}).`,
          loop: [B('ard_digital_write', { PIN: p }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: '1' } } } }), delay(500),
            B('ard_digital_write', { PIN: p }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: '0' } } } }), delay(500)]
        };
      }
      case 'rgbled': {
        const ps = ['R', 'G', 'B'].map((id, i) => pin(id) || ['D9', 'D10', 'D11'][i]);
        const all = on => ps.map((p, i) => B('ard_digital_write', { PIN: p }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: on === i ? '1' : '0' } } } }));
        return {
          desc: `Allume tour à tour le rouge (${ps[0]}), le vert (${ps[1]}) et le bleu (${ps[2]}).`,
          loop: [...all(0), delay(500), ...all(1), delay(500), ...all(2), delay(500)]
        };
      }
      case 'button': {
        const p = pin('1a') || pin('1b') || pin('2a') || pin('2b') || 'D2';
        return {
          desc: `Lit le bouton sur ${p} avec la résistance de rappel interne (l'autre patte au GND) et allume la LED intégrée quand on appuie.`,
          setup: [B('ard_pin_mode', { PIN: p, MODE: '2' }), B('ard_pin_mode', { PIN: 'D13', MODE: '1' })],
          loop: [ifElse(compare(val(B('ard_digital_read', { PIN: p })), 'EQ', { block: B('ard_highlow', { V: '0' }) }),
            [B('ard_digital_write', { PIN: 'D13' }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: '1' } } } })],
            [B('ard_digital_write', { PIN: 'D13' }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: '0' } } } })]), delay(10)]
        };
      }
      case 'switch': {
        const p = pin('C') || 'D2';
        return {
          desc: `Affiche la position de l'interrupteur (broche ${p}).`,
          loop: [print(join(txt('Interrupteur : '), val(B('ard_digital_read', { PIN: p })))), delay(300)]
        };
      }
      case 'pot': case 'ldr': case 'ntc': {
        const p = [pin('W'), pin('1'), pin('2')].find(x => x && x[0] === 'A') || 'A0';
        return {
          desc: `Envoie la valeur lue sur ${p} (0 à 1023) au traceur série.`,
          loop: [plot([[def.kind === 'pot' ? 'potentiometre' : def.kind === 'ldr' ? 'lumiere' : 'temperature', val(B('ard_analog_read', { PIN: p }))]]), delay(100)]
        };
      }
      case 'piezo': {
        const p = pin('+') || pin('-') || 'D8';
        return {
          desc: `Joue un bip de 440 Hz toutes les secondes (broche ${p}).`,
          loop: [B('ard_tone', { PIN: p }, { FREQ: num(440) }), delay(200), B('ard_notone', { PIN: p }), delay(800)]
        };
      }
      case 'dcmotor': case 'npn': {
        const p = def.kind === 'npn' ? (pin('B') || 'D9') : (pin('1') || pin('2') || 'D9');
        const pw = isPwm(p) ? p : 'D9';
        return {
          desc: `Fait varier la vitesse par PWM sur ${pw}. Un moteur se commande à travers un transistor (voir l'exemple « Moteur commandé par un transistor »).`,
          loop: [255, 120, 0].flatMap(v => [B('ard_analog_write', { PIN: pw }, { VALUE: num(v) }), delay(2, 's')])
        };
      }
      case 'hcsr04': {
        const t = pin('TRIG') || 'D9', e = pin('ECHO') || 'D10';
        return {
          desc: `Mesure la distance (Trig ${t}, Echo ${e}) et l'affiche.`,
          loop: [setVar('distance', val(B('hcsr04_distance', { TRIG: t, ECHO: e }))),
            print(join(txt('Distance : '), getVar('distance'), txt(' cm'))), delay(200)]
        };
      }
      case 'sevenseg': {
        const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const ps = segs.map(s => pin(s)).filter(Boolean);
        if (!ps.length) return null;
        const on = props => ps.map(p => B('ard_digital_write', { PIN: p }, { VALUE: { shadow: { type: 'ard_highlow', fields: { V: props } } } }));
        const common = comp.props && comp.props.common === 'anode';
        return {
          desc: `Allume puis éteint tous les segments câblés (${ps.join(', ')}).`,
          loop: [...on(common ? '0' : '1'), delay(500), ...on(common ? '1' : '0'), delay(500)]
        };
      }
    }
    return null;
  }

  root.SNIPPETS = { forComponent, chain };
})(this);
