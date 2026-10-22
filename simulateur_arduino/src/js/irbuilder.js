/*
 * Traduction de l'espace de travail Blockly en représentation intermédiaire (IR, voir compiler.js).
 * L'IR sert ensuite à produire le bytecode (simulateur + carte) et le code Arduino (.ino).
 */
(function (root) {
  const KEYWORDS = new Set(('auto break case char const continue default do double else enum extern float for goto if int long ' +
    'register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class ' +
    'new delete this public private protected template namespace using virtual operator friend inline setup loop main HIGH LOW ' +
    'INPUT OUTPUT INPUT_PULLUP Serial String byte word boolean delay millis micros map min max abs constrain random round').split(' '));

  function sanitize(name, used) {
    let s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!s || /^[0-9]/.test(s)) s = 'v_' + s;
    if (KEYWORDS.has(s)) s = s + '_';
    return s;
  }

  class BuildError extends Error {
    constructor(msg, blockId) { super(msg); this.blockId = blockId; }
  }

  function build(workspace, boardId) {
    const board = BOARDS[boardId];
    const ctx = {
      outPins: new Set(), explicitModes: new Set(), usesSerial: false, hasSerialBegin: false,
      helpers: {}, warnings: [], modules: new Set(), varNames: {}, usedNames: new Set()
    };
    const n = v => ({ k: 'num', v });
    const pin = name => ({ k: 'pin', name });
    const nextPin = name => board.pinName(board.pinNumber(name) + 1);
    const sys = (fn, ...args) => ({ k: 'sys', fn, args });
    const bin = (op, a, b) => ({ k: 'bin', op, a, b });
    const math = (fn, ...args) => ({ k: 'math', fn, args });

    const varName = (id, fallback) => {
      if (ctx.varNames[id]) return ctx.varNames[id];
      const model = id && workspace.getVariableById(id);
      const raw = model ? model.name : (fallback || id);
      let s = sanitize(raw);
      let k = 2;
      while ([...Object.values(ctx.varNames)].includes(s)) s = sanitize(raw) + '_' + (k++);
      ctx.varNames[id] = s;
      return s;
    };
    const procNames = {};
    const procName = raw => {
      if (!procNames[raw]) procNames[raw] = sanitize(raw);
      return procNames[raw];
    };

    function val(block, name, def) {
      const b = block.getInputTargetBlock(name);
      if (!b) return def === undefined ? n(0) : def;
      return expr(b);
    }
    function cond(block, name) { return val(block, name, { k: 'bool', v: false }); }

    function colorOf(block, name) {
      const b = block.getInputTargetBlock(name);
      if (!b) return [n(0), n(0), n(0)];
      if (b.type === 'color_named') return b.getFieldValue('C').split(',').map(x => n(+x));
      if (b.type === 'color_rgb') return [val(b, 'R'), val(b, 'G'), val(b, 'B')];
      const c = expr(b);
      return [
        math('floor', bin('/', c, n(65536))),
        bin('%', math('floor', bin('/', c, n(256))), n(256)),
        bin('%', math('floor', c), n(256))
      ];
    }

    function helper(name, def) {
      if (!ctx.helpers[name]) ctx.helpers[name] = Object.assign({ name, helper: true }, def);
      return name;
    }

    function textParts(block, name) {
      const b = block.getInputTargetBlock(name);
      if (!b) return [];
      if (b.type === 'text') return [{ k: 'str', v: b.getFieldValue('TEXT') }];
      if (b.type === 'text_join') {
        const parts = [];
        for (let i = 0; i < b.itemCount_; i++) parts.push(...textParts(b, 'ADD' + i));
        return parts;
      }
      return [expr(b)];
    }

    function useModule(type) { ctx.modules.add(type); }

    /* ---------------------------------------------------------------- expressions */
    function expr(b) {
      const f = k => b.getFieldValue(k);
      switch (b.type) {
        case 'math_number': return n(Number(f('NUM')));
        case 'logic_boolean': return { k: 'bool', v: f('BOOL') === 'TRUE' };
        case 'variables_get': return { k: 'var', name: varName(f('VAR')) };
        case 'math_arithmetic': {
          const a = val(b, 'A'), c = val(b, 'B');
          const op = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' }[f('OP')];
          if (op) return bin(op, a, c);
          return math('pow', a, c);
        }
        case 'math_single': {
          const x = val(b, 'NUM');
          switch (f('OP')) {
            case 'ROOT': return math('sqrt', x);
            case 'ABS': return math('abs', x);
            case 'NEG': return { k: 'neg', a: x };
            case 'LN': return math('ln', x);
            case 'LOG10': return math('log10', x);
            case 'EXP': return math('exp', x);
            case 'POW10': return math('pow', n(10), x);
          }
          break;
        }
        case 'math_trig': {
          const x = val(b, 'NUM');
          const op = f('OP').toLowerCase();
          const k = Math.PI / 180;
          if (['sin', 'cos', 'tan'].includes(op)) return math(op, bin('*', x, n(k)));
          return bin('/', math(op, x), n(k));
        }
        case 'math_round': return math({ ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' }[f('OP')], val(b, 'NUM'));
        case 'math_modulo': return bin('%', val(b, 'DIVIDEND'), val(b, 'DIVISOR'));
        case 'math_constrain': return math('constrain', val(b, 'VALUE'), val(b, 'LOW'), val(b, 'HIGH'));
        case 'math_random_int': return math('random', val(b, 'FROM'), bin('+', val(b, 'TO'), n(1)));
        case 'math_constant': return n({ PI: Math.PI, E: Math.E, GOLDEN_RATIO: (1 + Math.sqrt(5)) / 2, SQRT2: Math.SQRT2, SQRT1_2: Math.SQRT1_2, INFINITY: 3.4e38 }[f('CONSTANT')]);
        case 'math_number_property': {
          const x = val(b, 'NUMBER_TO_CHECK');
          switch (f('PROPERTY')) {
            case 'EVEN': return bin('==', bin('%', x, n(2)), n(0));
            case 'ODD': return bin('!=', bin('%', x, n(2)), n(0));
            case 'WHOLE': return bin('==', bin('%', x, n(1)), n(0));
            case 'POSITIVE': return bin('>', x, n(0));
            case 'NEGATIVE': return bin('<', x, n(0));
            case 'DIVISIBLE_BY': return bin('==', bin('%', x, val(b, 'DIVISOR')), n(0));
            default: throw new BuildError('Le test « est premier » n\'est pas disponible.', b.id);
          }
        }
        case 'logic_compare':
          return bin({ EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[f('OP')], val(b, 'A'), val(b, 'B'));
        case 'logic_operation': return bin(f('OP') === 'AND' ? '&&' : '||', cond(b, 'A'), cond(b, 'B'));
        case 'logic_negate': return { k: 'not', a: cond(b, 'BOOL') };
        case 'text': {
          const t = f('TEXT');
          if (/^-?\d+(\.\d+)?$/.test(t.trim())) return n(Number(t));
          throw new BuildError('Un texte ne peut être utilisé que dans un bloc « afficher ».', b.id);
        }
        case 'text_join': throw new BuildError('« créer un texte avec » ne peut être utilisé que dans un bloc « afficher ».', b.id);
        case 'procedures_callreturn': {
          const name = procName(b.getProcedureCall());
          const args = (b.arguments_ || []).map((_, i) => val(b, 'ARG' + i));
          return { k: 'call', name, args, blockId: b.id };
        }
        case 'ard_millis': return sys('millis');
        case 'ard_micros': return sys('micros');
        case 'ard_map': return math('map', val(b, 'X'), val(b, 'A'), val(b, 'B'), val(b, 'C'), val(b, 'D'));
        case 'ard_minmax': return math(f('FN'), val(b, 'A'), val(b, 'B'));
        case 'ard_decimals': return Object.assign({}, val(b, 'X'), { decimals: Number(f('DEC')) });
        case 'ard_highlow': return n(Number(f('V')));
        case 'ard_digital_read': return sys('digitalRead', pin(f('PIN')));
        case 'ard_analog_read': return sys('analogRead', pin(f('PIN')));
        case 'ard_pulsein': return sys('pulseIn', pin(f('PIN')), n(+f('LEVEL')), n(1000000));
        case 'ard_serial_available': return sys('serialAvailable');
        case 'ard_serial_read': return sys('serialRead');
        case 'ard_char_code': return n((f('C') || ' ').charCodeAt(0));
        case 'color_named': { const [r, g, bl] = f('C').split(',').map(Number); return n(r * 65536 + g * 256 + bl); }
        case 'color_rgb': return bin('+', bin('+', bin('*', math('constrain', val(b, 'R'), n(0), n(255)), n(65536)),
          bin('*', math('constrain', val(b, 'G'), n(0), n(255)), n(256))), math('constrain', val(b, 'B'), n(0), n(255)));
        /* ------------------------- Grove */
        case 'grove_din': {
          const def = CATALOG.byType[f('MOD')];
          useModule(f('MOD'));
          return bin('==', sys('digitalRead', pin(f('PORT'))), n(def && def.sim ? def.sim.active : 1));
        }
        case 'grove_ain': useModule(f('MOD')); return sys('analogRead', pin(f('PORT')));
        case 'grove_ain_angle': return math('map', sys('analogRead', pin(f('PORT'))), n(0), n(1023), n(0), n(300));
        case 'grove_ain_temp': {
          helper('temperatureGrove', {
            params: ['broche'], body: [],
            ret: bin('-', bin('/', n(1), bin('+', bin('/', math('ln', bin('-', bin('/', n(1023), sys('analogRead', { k: 'var', name: 'broche' })), n(1))), n(4275)), n(1 / 298.15))), n(273.15)),
            comment: 'Capteur de température Grove v1.2 : thermistance B = 4275, R0 = 100 kΩ'
          });
          return { k: 'call', name: 'temperatureGrove', args: [pin(f('PORT'))] };
        }
        case 'grove_joystick': {
          const p = f('PORT');
          if (f('AXIS') === 'X') return sys('analogRead', pin(p));
          if (f('AXIS') === 'Y') return sys('analogRead', pin(nextPin(p)));
          return bin('>=', sys('analogRead', pin(p)), n(1020));
        }
        case 'grove_ultrasonic': return sys('ultrasonicCm', pin(f('PORT')));
        case 'grove_dht': {
          const def = CATALOG.byType[f('MOD')];
          return sys('dhtRead', pin(f('PORT')), n(def ? def.sim.dhtType : 11), n(+f('WHAT')));
        }
        case 'grove_thi2c': {
          const def = CATALOG.byType[f('MOD')];
          return sys('thI2CRead', n(def ? def.sim.model : 0), n(+f('WHAT')));
        }
        case 'grove_baro': {
          const w = +f('WHAT');
          return w === 1 ? bin('/', sys('baroRead', n(1)), n(100)) : sys('baroRead', n(w));
        }
        case 'grove_accel': return sys('accelRead', n(+f('AXIS')));
        case 'grove_gyro': return sys('gyroRead', n(+f('AXIS')));
        case 'grove_lux': return sys('lightI2CRead');
        case 'grove_heart': return sys('fingerHeartRead');
        case 'grove_tof': return sys('tofRead');
        case 'grove_rfid': return sys('rfidRead');
        case 'grove_keypad': return sys('keypadRead');
        case 'grove_color': return sys('colorRead', n(+f('CH')));
        case 'grove_irtemp': return sys('irTempRead', n(+f('W')));
        case 'grove_co2': return sys('co2Read', n(+f('W')));
        case 'grove_gesture': return f('G') === 'N' ? sys('gestureRead') : bin('==', sys('gestureRead'), n(+f('G')));
        case 'grove_rtc': return sys('rtcRead', n(+f('F')));
        case 'grove_encoder': return sys('encoderRead', pin(f('PORT')));
        case 'grove_ir': return sys('irRead', pin(f('PORT')));
        case 'hcsr04_distance': {
          ctx.outPins.add(f('TRIG'));
          helper('distanceHCSR04', {
            params: ['trig', 'echo'],
            body: [
              { k: 'sys', fn: 'digitalWrite', args: [{ k: 'var', name: 'trig' }, n(0)] },
              { k: 'sys', fn: 'delayMicroseconds', args: [n(2)] },
              { k: 'sys', fn: 'digitalWrite', args: [{ k: 'var', name: 'trig' }, n(1)] },
              { k: 'sys', fn: 'delayMicroseconds', args: [n(10)] },
              { k: 'sys', fn: 'digitalWrite', args: [{ k: 'var', name: 'trig' }, n(0)] }
            ],
            ret: bin('/', sys('pulseIn', { k: 'var', name: 'echo' }, n(1), n(30000)), n(58)),
            comment: 'Capteur HC-SR04 : impulsion de 10 µs sur Trig, durée de l\'écho / 58 = distance en cm'
          });
          return { k: 'call', name: 'distanceHCSR04', args: [pin(f('TRIG')), pin(f('ECHO'))] };
        }
      }
      throw new BuildError('Ce bloc ne peut pas être utilisé ici (' + b.type + ').', b.id);
    }

    /* ---------------------------------------------------------------- instructions */
    function stmts(first) {
      const out = [];
      for (let b = first; b; b = b.getNextBlock()) {
        if (!b.isEnabled()) continue;
        const r = stmt(b);
        if (Array.isArray(r)) out.push(...r); else if (r) out.push(r);
      }
      return out;
    }
    const body = (b, name) => stmts(b.getInputTargetBlock(name));
    const out = p => { ctx.outPins.add(p); };

    function stmt(b) {
      const f = k => b.getFieldValue(k);
      const id = b.id;
      switch (b.type) {
        case 'variables_set': return { k: 'set', name: varName(f('VAR')), e: val(b, 'VALUE'), blockId: id };
        case 'math_change': return { k: 'change', name: varName(f('VAR')), e: val(b, 'DELTA'), blockId: id };
        case 'controls_if': {
          const branches = [];
          for (let i = 0; b.getInput('IF' + i); i++) branches.push({ cond: cond(b, 'IF' + i), body: body(b, 'DO' + i) });
          return { k: 'if', branches, else: b.getInput('ELSE') ? body(b, 'ELSE') : null, blockId: id };
        }
        case 'controls_repeat_ext': return { k: 'repeat', n: val(b, 'TIMES'), body: body(b, 'DO'), blockId: id };
        case 'controls_repeat': return { k: 'repeat', n: n(+f('TIMES')), body: body(b, 'DO'), blockId: id };
        case 'controls_whileUntil': return { k: 'while', until: f('MODE') === 'UNTIL', cond: cond(b, 'BOOL'), body: body(b, 'DO'), blockId: id };
        case 'controls_for':
          return { k: 'for', name: varName(f('VAR')), from: val(b, 'FROM'), to: val(b, 'TO'), by: val(b, 'BY', n(1)), body: body(b, 'DO'), blockId: id };
        case 'controls_flow_statements': return { k: f('FLOW') === 'BREAK' ? 'break' : 'continue', blockId: id };
        case 'procedures_callnoreturn': {
          const name = procName(b.getProcedureCall());
          const args = (b.arguments_ || []).map((_, i) => val(b, 'ARG' + i));
          return { k: 'call', name, args, blockId: id };
        }
        case 'procedures_ifreturn': {
          const ret = { k: 'return', e: b.hasReturnValue_ ? val(b, 'VALUE') : null, blockId: id };
          return { k: 'if', branches: [{ cond: cond(b, 'CONDITION'), body: [ret] }], else: null, blockId: id };
        }
        case 'ard_delay': {
          const t = val(b, 'TIME');
          return { k: 'sys', fn: 'delay', args: [f('UNIT') === 's' ? bin('*', t, n(1000)) : t], blockId: id };
        }
        case 'ard_delay_us': return { k: 'sys', fn: 'delayMicroseconds', args: [val(b, 'TIME')], blockId: id };
        case 'ard_wait_until': return { k: 'waitUntil', cond: cond(b, 'COND'), blockId: id };
        case 'ard_pin_mode': ctx.explicitModes.add(f('PIN')); return { k: 'sys', fn: 'pinMode', args: [pin(f('PIN')), n(+f('MODE'))], blockId: id };
        case 'ard_digital_write': out(f('PIN')); return { k: 'sys', fn: 'digitalWrite', args: [pin(f('PIN')), val(b, 'VALUE')], blockId: id };
        case 'ard_analog_write': return { k: 'sys', fn: 'analogWrite', args: [pin(f('PIN')), val(b, 'VALUE')], blockId: id };
        case 'ard_tone': return { k: 'sys', fn: 'tone', args: [pin(f('PIN')), val(b, 'FREQ')], blockId: id };
        case 'ard_notone': return { k: 'sys', fn: 'noTone', args: [pin(f('PIN'))], blockId: id };
        case 'ard_serial_begin': ctx.hasSerialBegin = true; return { k: 'sys', fn: 'serialBegin', args: [n(+f('BAUD'))], blockId: id };
        case 'ard_serial_print':
          ctx.usesSerial = true;
          return { k: 'print', target: 0, parts: textParts(b, 'VALUE'), nl: f('NL') === '1', blockId: id };
        case 'ard_serial_plot': {
          ctx.usesSerial = true;
          const parts = [];
          for (let i = 1; i <= 3; i++) {
            if (!b.getInputTargetBlock('V' + i)) continue;
            if (parts.length) parts.push({ k: 'str', v: ',' });
            parts.push({ k: 'str', v: (f('N' + i) || ('v' + i)).replace(/[\s:,]/g, '_') + ':' });
            parts.push(val(b, 'V' + i));
          }
          return { k: 'print', target: 0, parts, nl: true, blockId: id };
        }
        /* ------------------------- Grove : sorties */
        case 'grove_dout': useModule(f('MOD')); out(f('PORT')); return { k: 'sys', fn: 'digitalWrite', args: [pin(f('PORT')), n(+f('STATE'))], blockId: id };
        case 'grove_dout2': { const p = nextPin(f('PORT')); out(p); return { k: 'sys', fn: 'digitalWrite', args: [pin(p), n(+f('STATE'))], blockId: id }; }
        case 'grove_pwm': useModule(f('MOD')); return { k: 'sys', fn: 'analogWrite', args: [pin(f('PORT')), val(b, 'VALUE')], blockId: id };
        case 'grove_note': {
          const freq = +f('NOTE'), dur = val(b, 'DUR');
          if (!freq) return [{ k: 'sys', fn: 'noTone', args: [pin(f('PORT'))] }, { k: 'sys', fn: 'delay', args: [dur], blockId: id }];
          return [{ k: 'sys', fn: 'toneDur', args: [pin(f('PORT')), n(freq), dur], blockId: id }, { k: 'sys', fn: 'delay', args: [dur] }];
        }
        case 'grove_freq': return { k: 'sys', fn: 'tone', args: [pin(f('PORT')), val(b, 'FREQ')], blockId: id };
        case 'grove_notone': return { k: 'sys', fn: 'noTone', args: [pin(f('PORT'))], blockId: id };
        case 'servo_write': return { k: 'sys', fn: 'servoWrite', args: [pin(f('PORT')), val(b, 'ANGLE')], blockId: id };
        case 'grove_motor': return { k: 'sys', fn: 'motorI2C', args: [n(+f('M')), val(b, 'SPEED')], blockId: id };
        case 'grove_chain': return { k: 'sys', fn: 'chainRGB', args: [pin(f('PORT')), val(b, 'I'), ...colorOf(b, 'COLOR')], blockId: id };
        case 'grove_pixels': return { k: 'sys', fn: 'pixelSet', args: [pin(f('PORT')), val(b, 'I'), ...colorOf(b, 'COLOR')], blockId: id };
        case 'grove_pixels_fill': return { k: 'sys', fn: 'pixelFill', args: [pin(f('PORT')), val(b, 'N'), ...colorOf(b, 'COLOR')], blockId: id };
        case 'grove_mp3': return { k: 'sys', fn: f('ACT') === 'play' ? 'mp3Play' : 'mp3Volume', args: [val(b, 'N')], blockId: id };
        case 'grove_mp3_stop': return { k: 'sys', fn: 'mp3Stop', args: [], blockId: id };
        case 'grove_rtc_set': return { k: 'sys', fn: 'rtcSet', args: ['H', 'MI', 'S', 'D', 'MO', 'Y'].map(k => val(b, k)), blockId: id };
        /* ------------------------- afficheurs */
        case 'lcd_print': return { k: 'print', target: 1, parts: textParts(b, 'VALUE'), nl: false, blockId: id };
        case 'lcd_cursor': return { k: 'sys', fn: 'lcdSetCursor', args: [val(b, 'COL'), val(b, 'ROW')], blockId: id };
        case 'lcd_clear': return { k: 'sys', fn: 'lcdClear', args: [], blockId: id };
        case 'lcd_rgb': return { k: 'sys', fn: 'lcdRGB', args: colorOf(b, 'COLOR'), blockId: id };
        case 'oled_print': return { k: 'print', target: 2, parts: textParts(b, 'VALUE'), nl: false, blockId: id };
        case 'oled_cursor': return { k: 'sys', fn: 'oledSetCursor', args: [val(b, 'COL'), val(b, 'ROW')], blockId: id };
        case 'oled_clear': return { k: 'sys', fn: 'oledClear', args: [], blockId: id };
        case 'tm_number': return { k: 'sys', fn: 'tm1637Number', args: [pin(f('PORT')), val(b, 'N')], blockId: id };
        case 'tm_digits': return { k: 'sys', fn: 'tm1637Digits', args: [pin(f('PORT')), val(b, 'D0'), val(b, 'D1'), val(b, 'D2'), val(b, 'D3')], blockId: id };
        case 'tm_colon': return { k: 'sys', fn: 'tm1637Colon', args: [pin(f('PORT')), n(+f('ON'))], blockId: id };
        case 'tm_bright': return { k: 'sys', fn: 'tm1637Brightness', args: [pin(f('PORT')), val(b, 'B')], blockId: id };
        case 'tm_clear': return { k: 'sys', fn: 'tm1637Clear', args: [pin(f('PORT'))], blockId: id };
        case 'ledbar_level': return { k: 'sys', fn: 'ledBarLevel', args: [pin(f('PORT')), val(b, 'N')], blockId: id };
      }
      if (b.outputConnection) throw new BuildError('Ce bloc renvoie une valeur : il doit être placé dans un autre bloc.', b.id);
      throw new BuildError('Bloc non pris en charge : ' + b.type, b.id);
    }

    /* ---------------------------------------------------------------- programme complet */
    const tops = workspace.getTopBlocks(true);
    let setup = [], loop = [];
    const procs = [];
    let nSetup = 0, nLoop = 0;
    for (const t of tops) {
      if (!t.isEnabled()) continue;
      if (t.type === 'ard_setup') { setup = setup.concat(body(t, 'DO')); nSetup++; }
      else if (t.type === 'ard_loop') { loop = loop.concat(body(t, 'DO')); nLoop++; }
    }
    for (const t of tops) {
      if (!t.isEnabled()) continue;
      if (t.type === 'procedures_defnoreturn' || t.type === 'procedures_defreturn') {
        const params = (t.getVars ? t.getVars() : []).map(v => sanitize(v));
        const name = procName(t.getFieldValue('NAME'));
        // les paramètres portent le nom de leur variable Blockly : on réutilise la même traduction
        (t.getVarModels ? t.getVarModels() : []).forEach((m, i) => { ctx.varNames[m.getId()] = params[i]; });
        const bodyIR = body(t, 'STACK');
        const ret = t.type === 'procedures_defreturn' ? val(t, 'RETURN') : null;
        procs.push({ name, params, body: bodyIR, ret, blockId: t.id });
      } else if (!['ard_setup', 'ard_loop'].includes(t.type)) {
        ctx.warnings.push({ msg: 'Des blocs ne sont reliés ni à « Au démarrage » ni à « Répéter indéfiniment » : ils sont ignorés.', blockId: t.id });
      }
    }
    if (nSetup > 1 || nLoop > 1) ctx.warnings.push({ msg: 'Plusieurs blocs « Au démarrage » ou « Répéter indéfiniment » : leurs contenus sont mis bout à bout.' });

    // instructions ajoutées automatiquement au début de « Au démarrage »
    const prelude = [];
    if (ctx.usesSerial && !ctx.hasSerialBegin) prelude.push({ k: 'sys', fn: 'serialBegin', args: [n(9600)], auto: true });
    for (const p of ctx.outPins) {
      if (!ctx.explicitModes.has(p)) prelude.push({ k: 'sys', fn: 'pinMode', args: [pin(p), n(1)], auto: true });
    }
    const helpers = Object.values(ctx.helpers);
    return {
      board: boardId,
      setup: prelude.concat(setup),
      loop,
      procs: procs.concat(helpers),
      warnings: ctx.warnings,
      modules: [...ctx.modules],
      autoCount: prelude.length
    };
  }

  root.IRBuilder = { build, BuildError, sanitize };
})(this);
