/*
 * Génération du code Arduino (.ino) à partir de l'IR.
 * Le code produit utilise les bibliothèques Arduino/Seeed habituelles pour pouvoir être ouvert
 * et étudié dans l'IDE Arduino. (Le téléversement depuis le simulateur n'utilise pas ce code :
 * il envoie le bytecode à l'interpréteur.)
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Compiler = isNode ? require('./compiler.js') : root.Compiler;
  const BOARDS = isNode ? require('./boards.js') : root.BOARDS;

  const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  const CTYPE = { bool: 'bool', int: 'long', float: 'float' };

  function generate(prog, opts) {
    opts = opts || {};
    const board = BOARDS[prog.board];
    const types = Compiler.inferTypes(prog);
    const circuit = new Set(opts.circuitTypes || []);
    const includes = new Set();
    const globals = [];          // déclarations d'objets
    const globalKeys = new Set();
    const setupInit = [];        // initialisations des bibliothèques
    const notes = [];
    let ctxProc = null;
    let tmp = 0;

    const g = (key, decl, init, inc) => {
      if (globalKeys.has(key)) return;
      globalKeys.add(key);
      if (inc) [].concat(inc).forEach(i => includes.add(i));
      if (decl) globals.push(decl);
      if (init) [].concat(init).forEach(i => setupInit.push(i));
    };
    const typeOf = e => types.typeOf(e, ctxProc);
    const pinStr = e => {
      if (e.k === 'pin') {
        const nm = String(e.name).toUpperCase();
        return nm[0] === 'A' ? nm : String(board.pinNumber(nm));
      }
      return ex(e);
    };
    const pinId = e => (e.k === 'pin' ? pinStr(e) : 'x');
    const isConst = e => e.k === 'num' || e.k === 'pin' || e.k === 'bool';
    const numStr = v => {
      if (Number.isInteger(v)) return String(v);
      let s = String(Math.fround(v) === v ? v : +v.toPrecision(7));
      if (!/[.e]/.test(s)) s += '.0';
      return s;
    };
    const cstr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

    /* ------------------------------------------------------------ expressions */
    function ex(e, parentPrec) {
      parentPrec = parentPrec || 0;
      switch (e.k) {
        case 'num': return e.v < 0 && parentPrec > 0 ? '(' + numStr(e.v) + ')' : numStr(e.v);
        case 'bool': return e.v ? 'true' : 'false';
        case 'var': return e.name;
        case 'pin': return pinStr(e);
        case 'str': return cstr(e.v);
        case 'neg': return '-' + ex(e.a, 7);
        case 'not': return '!' + ex(e.a, 7);
        case 'bin': {
          let op = e.op;
          const p = PREC[op];
          let a = ex(e.a, p), b = ex(e.b, p + 1);
          // digitalRead(x) == 1  ->  digitalRead(x) == HIGH
          if ((op === '==' || op === '!=') && e.a.k === 'sys' && e.a.fn === 'digitalRead' && e.b.k === 'num' && (e.b.v === 0 || e.b.v === 1)) b = e.b.v ? 'HIGH' : 'LOW';
          if (op === '/' && typeOf(e.a) !== 'float' && typeOf(e.b) !== 'float') {
            if (e.b.k === 'num') b = numStr(e.b.v) + '.0';
            else a = '(float)' + ex(e.a, 7);
          }
          if (op === '%' && (typeOf(e.a) === 'float' || typeOf(e.b) === 'float')) return 'fmod(' + ex(e.a) + ', ' + ex(e.b) + ')';
          const s = a + ' ' + op + ' ' + b;
          return p < parentPrec ? '(' + s + ')' : s;
        }
        case 'math': {
          const A = e.args.map(x => ex(x));
          switch (e.fn) {
            case 'ln': return 'log(' + A[0] + ')';
            case 'random': return 'random(' + A.join(', ') + ')';
            default: return e.fn + '(' + A.join(', ') + ')';
          }
        }
        case 'sys': return sysExpr(e);
        case 'call': return e.name + '(' + e.args.map(x => ex(x)).join(', ') + ')';
      }
      return '0';
    }

    /* ------------------------------------------------------------ appels système */
    function sysExpr(e) {
      const a = e.args;
      const A = a.map(x => ex(x));
      const P = () => pinStr(a[0]);
      switch (e.fn) {
        case 'digitalRead': return 'digitalRead(' + P() + ')';
        case 'analogRead': return 'analogRead(' + P() + ')';
        case 'millis': return 'millis()';
        case 'micros': return 'micros()';
        case 'pulseIn': return 'pulseIn(' + P() + ', ' + (a[1].v ? 'HIGH' : 'LOW') + ', ' + A[2] + 'UL)';
        case 'serialAvailable': return 'Serial.available()';
        case 'serialRead': return 'Serial.read()';
        case 'ultrasonicCm': {
          const id = 'ultrason' + pinId(a[0]);
          g(id, `Ultrasonic ${id}(${P()});`, null, 'Ultrasonic.h');
          return id + '.MeasureInCentimeters()';
        }
        case 'dhtRead': {
          const id = 'dht' + pinId(a[0]);
          g(id, `DHT ${id}(${P()}, DHT${a[1].v});`, `${id}.begin();`, 'DHT.h');
          return a[2].v === 0 ? id + '.readTemperature()' : id + '.readHumidity()';
        }
        case 'thI2CRead': {
          if (a[0].v === 1) {
            g('sht31', 'SHT31 sht31;', 'sht31.begin();', ['Wire.h', 'SHT31.h']);
            return a[1].v === 0 ? 'sht31.getTemperature()' : 'sht31.getHumidity()';
          }
          g('dht20', 'DHT dht20(DHT20);', ['Wire.begin();', 'dht20.begin();'], ['Wire.h', 'DHT.h']);
          return a[1].v === 0 ? 'dht20.readTemperature()' : 'dht20.readHumidity()';
        }
        case 'baroRead': {
          const bme = circuit.has('grove_bme280');
          const cls = bme ? 'BME280' : 'BMP280', id = bme ? 'bme280' : 'bmp280';
          g(id, `${cls} ${id};`, `${id}.init();`, ['Wire.h', bme ? 'Seeed_BME280.h' : 'Seeed_BMP280.h']);
          switch (a[0].v) {
            case 0: return id + '.getTemperature()';
            case 1: return id + '.getPressure()';
            case 2: return `${id}.calcAltitude(${id}.getPressure())`;
            default: return bme ? id + '.getHumidity()' : '0 /* humidité : BME280 seulement */';
          }
        }
        case 'accelRead': {
          const axis = 'XYZ'[a[0].v] || 'X';
          if (circuit.has('grove_lis3dhtr') || circuit.has('grove_imu6') && !circuit.has('grove_adxl345')) {
            g('lis', 'LIS3DHTR<TwoWire> accelero;', ['accelero.begin(Wire, 0x19);', 'accelero.setOutputDataRate(LIS3DHTR_DATARATE_100HZ);'], ['Wire.h', 'LIS3DHTR.h']);
            return `accelero.getAcceleration${axis}()`;
          }
          g('adxl', 'ADXL345 accelero;', 'accelero.powerOn();', ['Wire.h', 'ADXL345.h']);
          g('accelFn', null, null);
          helpers.add('accelADXL');
          return `accelerationADXL(${a[0].v})`;
        }
        case 'gyroRead': notes.push('gyroscope : à adapter à votre bibliothèque'); return '0 /* gyroscope */';
        case 'rtcRead': {
          g('rtc', 'DS1307 horloge;', 'horloge.begin();', ['Wire.h', 'DS1307.h']);
          helpers.add('rtc');
          return `lireHorloge(${a[0].v})`;
        }
        case 'i2cReadReg': helpers.add('i2c'); includes.add('Wire.h'); return `lireRegistreI2C(${A[0]}, ${A[1]})`;
        case 'lightI2CRead':
          g('tsl', null, ['Wire.begin();', 'TSL2561.init();'], ['Wire.h', 'Digital_Light_TSL2561.h']);
          return 'TSL2561.readVisibleLux()';
        case 'colorRead':
          g('tcs', 'Adafruit_TCS34725 capteurCouleur(TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X);', 'capteurCouleur.begin();', ['Wire.h', 'Adafruit_TCS34725.h']);
          helpers.add('color');
          return `lireCouleur(${a[0].v})`;
        case 'irTempRead':
          g('mlx', 'MLX90615 thermometreIR;', 'thermometreIR.begin();', ['Wire.h', 'MLX90615.h']);
          return a[0].v === 0 ? 'thermometreIR.getTemperature(MLX90615_OBJECT_TEMPERATURE)' : 'thermometreIR.getTemperature(MLX90615_AMBIENT_TEMPERATURE)';
        case 'fingerHeartRead': helpers.add('heart'); includes.add('Wire.h'); setupInitOnce('Wire.begin();'); return 'lirePouls()';
        case 'tofRead':
          g('tof', 'Seeed_vl53l0x capteurLaser;', 'capteurLaser.VL53L0X_common_init();', ['Seeed_vl53l0x.h']);
          notes.push('VL53L0X : voir les exemples de la bibliothèque Seeed_vl53l0x pour la lecture de la distance');
          return '0 /* distance VL53L0X (mm) */';
        case 'co2Read':
          g('scd30', null, ['Wire.begin();', 'scd30.initialize();'], ['Wire.h', 'SCD30.h']);
          helpers.add('co2');
          return `lireSCD30(${a[0].v})`;
        case 'gestureRead':
          g('paj', null, 'paj7620Init();', ['Wire.h', 'paj7620.h']);
          helpers.add('gesture');
          return 'lireGeste()';
        case 'encoderRead': {
          const id = 'encodeur' + pinId(a[0]);
          const p = board.pinNumber(a[0].name);
          g(id, `Encoder ${id}(${p}, ${p + 1});`, null, 'Encoder.h');
          return id + '.read() / 4';
        }
        case 'irRead': {
          g('irrecv', null, `IrReceiver.begin(${P()});`, 'IRremote.hpp');
          helpers.add('ir');
          return 'lireCodeIR()';
        }
        case 'rfidRead': helpers.add('rfid'); g('rfid', 'SoftwareSerial lecteurRFID(2, 3);', 'lecteurRFID.begin(9600);', 'SoftwareSerial.h'); return 'lireBadgeRFID()';
        case 'keypadRead': helpers.add('keypad'); g('keypad', 'SoftwareSerial clavier(2, 3);', 'clavier.begin(9600);', 'SoftwareSerial.h'); return 'lireClavier()';
      }
      return '0 /* ' + e.fn + ' */';
    }
    function setupInitOnce(line) { if (!setupInit.includes(line)) setupInit.push(line); }
    const helpers = new Set();

    function sysStmt(s) {
      const a = s.args;
      const A = a.map(x => ex(x));
      const P = () => pinStr(a[0]);
      switch (s.fn) {
        case 'pinMode': return `pinMode(${P()}, ${['INPUT', 'OUTPUT', 'INPUT_PULLUP'][a[1].v] || 'INPUT'});`;
        case 'digitalWrite': {
          const v = a[1].k === 'num' && (a[1].v === 0 || a[1].v === 1) ? (a[1].v ? 'HIGH' : 'LOW') : A[1];
          return `digitalWrite(${P()}, ${v});`;
        }
        case 'analogWrite': return `analogWrite(${P()}, ${A[1]});`;
        case 'delay': return `delay(${A[0]});`;
        case 'delayMicroseconds': return `delayMicroseconds(${A[0]});`;
        case 'tone': return `tone(${P()}, ${A[1]});`;
        case 'toneDur': return `tone(${P()}, ${A[1]}, ${A[2]});`;
        case 'noTone': return `noTone(${P()});`;
        case 'serialBegin': return `Serial.begin(${A[0]});`;
        case 'randomSeed': return `randomSeed(${A[0]});`;
        case 'servoWrite': {
          const id = 'servo' + pinId(a[0]);
          g(id, `Servo ${id};`, `${id}.attach(${P()});`, 'Servo.h');
          return `${id}.write(${A[1]});`;
        }
        case 'lcdClear': lcd(); return 'lcd.clear();';
        case 'lcdSetCursor': lcd(); return `lcd.setCursor(${A[0]}, ${A[1]});`;
        case 'lcdRGB': lcd(); return `lcd.setRGB(${A.join(', ')});`;
        case 'lcdBacklight': lcd(); return A[0] === '0' ? 'lcd.noDisplay();' : 'lcd.display();';
        case 'oledClear': oled(); return 'u8x8.clear();';
        case 'oledSetCursor': oled(); return `u8x8.setCursor(${A[0]}, ${A[1]});`;
        case 'oledPixel': oled(); return '// dessin de pixel : utilisez la bibliothèque U8g2 (mode graphique)';
        case 'tm1637Number': return tm(a[0]) + `.displayNum(${A[1]});`;
        case 'tm1637Clear': return tm(a[0]) + '.clearDisplay();';
        case 'tm1637Brightness': return tm(a[0]) + `.set(${A[1]});`;
        case 'tm1637Digits': {
          const id = tm(a[0]);
          return A.slice(1).map((d, i) => `${id}.display(${i}, ${d});`).join(' ');
        }
        case 'tm1637Colon': return tm(a[0]) + `.point(${a[1].v ? 'POINT_ON' : 'POINT_OFF'});`;
        case 'ledBarLevel': {
          const p = board.pinNumber(a[0].name);
          const id = 'barreLED' + p;
          g(id, `Grove_LED_Bar ${id}(${p + 1}, ${p}, 0);  // horloge, données, orientation`, `${id}.begin();`, 'Grove_LED_Bar.h');
          return `${id}.setLevel(${A[1]});`;
        }
        case 'chainRGB': {
          const p = board.pinNumber(a[0].name);
          const id = 'ledsRGB' + p;
          const count = opts.chainCount || 1;
          g(id, `ChainableLED ${id}(${p}, ${p + 1}, ${count});`, `${id}.init();`, 'ChainableLED.h');
          return `${id}.setColorRGB(${A.slice(1).join(', ')});`;
        }
        case 'pixelSet': case 'pixelFill': {
          const id = 'ruban' + pinId(a[0]);
          const count = (opts.pixelCount && opts.pixelCount[a[0].name]) || 30;
          g(id, `Adafruit_NeoPixel ${id}(${count}, ${P()}, NEO_GRB + NEO_KHZ800);`, `${id}.begin();`, 'Adafruit_NeoPixel.h');
          if (s.fn === 'pixelSet') return `${id}.setPixelColor(${A[1]}, ${A[2]}, ${A[3]}, ${A[4]}); ${id}.show();`;
          return `for (int i = 0; i < ${A[1]}; i++) ${id}.setPixelColor(i, ${A[2]}, ${A[3]}, ${A[4]});\n${id}.show();`;
        }
        case 'pixelShow': return `ruban${pinId(a[0])}.show();`;
        case 'rtcSet':
          g('rtc', 'DS1307 horloge;', 'horloge.begin();', ['Wire.h', 'DS1307.h']);
          return `horloge.fillByHMS(${A[0]}, ${A[1]}, ${A[2]}); horloge.fillByYMD(${A[5]}, ${A[4]}, ${A[3]}); horloge.setTime();`;
        case 'i2cWriteReg': helpers.add('i2c'); includes.add('Wire.h'); setupInitOnce('Wire.begin();'); return `ecrireRegistreI2C(${A.join(', ')});`;
        case 'motorI2C':
          g('motor', null, 'Motor.begin(0x0f);', ['Wire.h', 'Grove_I2C_Motor_Driver.h']);
          return `Motor.speed(${a[0].v ? 'MOTOR2' : 'MOTOR1'}, ${A[1]} * 100 / 255);`;
        case 'mp3Play': mp3(); return `mp3.playSDRootSong(${A[0]});`;
        case 'mp3Volume': mp3(); return `mp3.volume(${A[0]});`;
        case 'mp3Stop': mp3(); return 'mp3.stop();';
        case 'stepperI2C': return '// moteur pas à pas : non pris en charge';
      }
      const e = sysExpr(s);
      return e + ';';
    }
    function lcd() { g('lcd', 'rgb_lcd lcd;', 'lcd.begin(16, 2);', ['Wire.h', 'rgb_lcd.h']); }
    function oled() { g('oled', 'U8X8_SSD1306_128X64_NONAME_HW_I2C u8x8(U8X8_PIN_NONE);', ['u8x8.begin();', 'u8x8.setFont(u8x8_font_chroma48medium8_r);'], 'U8x8lib.h'); }
    function tm(p) {
      const n = board.pinNumber(p.name);
      const id = 'afficheur' + n;
      g(id, `TM1637 ${id}(${n}, ${n + 1});  // CLK, DIO`, [`${id}.init();`, `${id}.set(BRIGHT_TYPICAL);`], 'TM1637.h');
      return id;
    }
    function mp3() {
      g('mp3', 'SoftwareSerial liaisonMP3(2, 3);\nWT2003S<SoftwareSerial> mp3;', ['liaisonMP3.begin(9600);', 'mp3.init(liaisonMP3);'], ['SoftwareSerial.h', 'WT2003S_Player.h']);
    }

    /* ------------------------------------------------------------ instructions */
    function print(s, ind) {
      const obj = s.target === 1 ? (lcd(), 'lcd') : s.target === 2 ? (oled(), 'u8x8') : 'Serial';
      const lines = [];
      const parts = s.parts.slice();
      parts.forEach((p, i) => {
        const last = i === parts.length - 1;
        const fn = last && s.nl && obj === 'Serial' ? 'println' : 'print';
        let arg;
        if (p.k === 'str') arg = cstr(p.v);
        else {
          arg = ex(p);
          if (p.decimals !== undefined) arg += ', ' + p.decimals;
        }
        lines.push(`${ind}${obj}.${fn}(${arg});`);
      });
      if (!parts.length && s.nl && obj === 'Serial') lines.push(`${ind}Serial.println();`);
      if (s.nl && obj === 'lcd') lines.push(`${ind}lcd.setCursor(0, 1);`);
      if (s.nl && obj === 'u8x8') lines.push(`${ind}u8x8.println();`);
      return lines.join('\n');
    }

    function block(list, ind) {
      return (list || []).map(s => stmt(s, ind)).filter(x => x !== null).join('\n');
    }

    function stmt(s, ind) {
      const I = ind;
      const sub = list => block(list, ind + '  ');
      switch (s.k) {
        case 'set': return `${I}${s.name} = ${ex(s.e)};`;
        case 'change': {
          if (s.e.k === 'num' && s.e.v === 1) return `${I}${s.name}++;`;
          if (s.e.k === 'num' && s.e.v === -1) return `${I}${s.name}--;`;
          return `${I}${s.name} += ${ex(s.e)};`;
        }
        case 'if': {
          let out = '';
          s.branches.forEach((br, i) => {
            out += (i === 0 ? `${I}if (` : ` else if (`) + ex(br.cond) + ') {\n' + sub(br.body) + `\n${I}}`;
          });
          if (s.else && s.else.length) out += ' else {\n' + sub(s.else) + `\n${I}}`;
          return out;
        }
        case 'while': return `${I}while (${s.until ? '!(' + ex(s.cond) + ')' : ex(s.cond)}) {\n${sub(s.body)}\n${I}}`;
        case 'waitUntil': return `${I}while (!(${ex(s.cond)})) {\n${I}  // attente\n${I}}`;
        case 'repeat': {
          const v = 'repet' + (tmp++ || '');
          return `${I}for (int ${v} = 0; ${v} < ${ex(s.n)}; ${v}++) {\n${sub(s.body)}\n${I}}`;
        }
        case 'for': {
          const v = s.name;
          if (isConst(s.from) && isConst(s.to) && isConst(s.by)) {
            const from = s.from.v, to = s.to.v, by = Math.abs(s.by.v) || 1;
            const up = from <= to;
            const step = by === 1 ? (up ? `${v}++` : `${v}--`) : (up ? `${v} += ${numStr(by)}` : `${v} -= ${numStr(by)}`);
            return `${I}for (${v} = ${ex(s.from)}; ${v} ${up ? '<=' : '>='} ${ex(s.to)}; ${step}) {\n${sub(s.body)}\n${I}}`;
          }
          return `${I}for (${v} = ${ex(s.from)}; (${ex(s.from)} <= ${ex(s.to)}) ? ${v} <= ${ex(s.to)} : ${v} >= ${ex(s.to)}; ` +
            `${v} += (${ex(s.from)} <= ${ex(s.to)}) ? abs(${ex(s.by)}) : -abs(${ex(s.by)})) {\n${sub(s.body)}\n${I}}`;
        }
        case 'break': return `${I}break;`;
        case 'continue': return `${I}continue;`;
        case 'sys': return sysStmt(s).split('\n').map(l => I + l).join('\n') + (s.auto ? '  // ajouté automatiquement' : '');
        case 'call': return `${I}${s.name}(${s.args.map(x => ex(x)).join(', ')});`;
        case 'return': return s.e ? `${I}return ${ex(s.e)};` : `${I}return;`;
        case 'print': return print(s, I);
        case 'expr': return `${I}${ex(s.e)};`;
      }
      return `${I}// ${s.k}`;
    }

    /* ------------------------------------------------------------ assemblage */
    const procCode = [];
    for (const p of prog.procs || []) {
      ctxProc = p;
      const rt = p.ret ? (CTYPE[types.rets[p.name]] || 'long') : 'void';
      const params = p.params.map(n => `${CTYPE[types.params[p.name + ':' + n]] || 'long'} ${n}`).join(', ');
      let body = block(p.body, '  ');
      if (p.ret) body += (body ? '\n' : '') + `  return ${ex(p.ret)};`;
      procCode.push((p.comment ? `// ${p.comment}\n` : '') + `${rt} ${p.name}(${params}) {\n${body}\n}`);
      ctxProc = null;
    }
    const setupCode = block(prog.setup, '  ');
    const loopCode = block(prog.loop, '  ');

    const helperCode = [];
    if (helpers.has('accelADXL')) helperCode.push('// Accélération (g) d\'un axe de l\'ADXL345 (0 = X, 1 = Y, 2 = Z)\nfloat accelerationADXL(int axe) {\n  double xyz[3];\n  accelero.getAcceleration(xyz);\n  return xyz[axe];\n}');
    if (helpers.has('rtc')) helperCode.push('// Lecture d\'un champ de l\'horloge DS1307\nint lireHorloge(int champ) {\n  horloge.getTime();\n  switch (champ) {\n    case 0: return horloge.second;\n    case 1: return horloge.minute;\n    case 2: return horloge.hour;\n    case 3: return horloge.dayOfWeek;\n    case 4: return horloge.dayOfMonth;\n    case 5: return horloge.month;\n    default: return 2000 + horloge.year;\n  }\n}');
    if (helpers.has('i2c')) helperCode.push('void ecrireRegistreI2C(int adresse, int registre, int valeur) {\n  Wire.beginTransmission(adresse);\n  Wire.write(registre);\n  Wire.write(valeur);\n  Wire.endTransmission();\n}\n\nint lireRegistreI2C(int adresse, int registre) {\n  Wire.beginTransmission(adresse);\n  Wire.write(registre);\n  Wire.endTransmission(false);\n  Wire.requestFrom(adresse, 1);\n  return Wire.available() ? Wire.read() : 0;\n}');
    if (helpers.has('color')) helperCode.push('// Composante de couleur (0 = rouge, 1 = vert, 2 = bleu : 0-255 ; 3 = lumière totale)\nint lireCouleur(int canal) {\n  uint16_t r, g, b, c;\n  capteurCouleur.getRawData(&r, &g, &b, &c);\n  if (canal == 3) return c;\n  if (c == 0) return 0;\n  uint16_t v = canal == 0 ? r : (canal == 1 ? g : b);\n  return min(255L, (long)v * 255L / c);\n}');
    if (helpers.has('heart')) helperCode.push('// Capteur cardiaque à pince Grove (adresse I2C 0x50)\nint lirePouls() {\n  Wire.requestFrom(0x50, 1);\n  return Wire.available() ? Wire.read() : 0;\n}');
    if (helpers.has('co2')) helperCode.push('float mesuresSCD30[3];\n\n// 0 = CO2 (ppm), 1 = température, 2 = humidité\nfloat lireSCD30(int grandeur) {\n  if (scd30.isAvailable()) scd30.getCarbonDioxideConcentration(mesuresSCD30);\n  return mesuresSCD30[grandeur];\n}');
    if (helpers.has('gesture')) helperCode.push('// 0 aucun, 1 haut, 2 bas, 3 gauche, 4 droite, 5 avant, 6 arrière, 7 horaire, 8 anti-horaire\nint lireGeste() {\n  uint8_t data = 0;\n  paj7620ReadReg(0x43, 1, &data);\n  switch (data) {\n    case GES_UP_FLAG: return 1;\n    case GES_DOWN_FLAG: return 2;\n    case GES_LEFT_FLAG: return 3;\n    case GES_RIGHT_FLAG: return 4;\n    case GES_FORWARD_FLAG: return 5;\n    case GES_BACKWARD_FLAG: return 6;\n    case GES_CLOCKWISE_FLAG: return 7;\n    case GES_COUNT_CLOCKWISE_FLAG: return 8;\n  }\n  return 0;\n}');
    if (helpers.has('ir')) helperCode.push('long lireCodeIR() {\n  if (!IrReceiver.decode()) return 0;\n  long code = IrReceiver.decodedIRData.command;\n  IrReceiver.resume();\n  return code;\n}');
    if (helpers.has('rfid')) helperCode.push('// Lit un badge 125 kHz (trame ASCII de 14 octets) ; 0 si aucun\nlong lireBadgeRFID() {\n  if (lecteurRFID.available() < 14) return 0;\n  char trame[14];\n  lecteurRFID.readBytes(trame, 14);\n  char hex[7] = {trame[5], trame[6], trame[7], trame[8], trame[9], trame[10], 0};\n  return strtol(hex, NULL, 16);\n}');
    if (helpers.has('keypad')) helperCode.push('// Clavier 12 touches Grove : renvoie 0-9, 10 (*), 11 (#) ou -1\nint lireClavier() {\n  if (!clavier.available()) return -1;\n  int c = clavier.read();\n  if (c >= 0xE1 && c <= 0xE9) return c - 0xE0;\n  if (c == 0xEB) return 0;\n  if (c == 0xEA) return 10;\n  if (c == 0xEC) return 11;\n  return -1;\n}');

    const out = [];
    out.push('/*');
    out.push(` * Programme généré par le Simulateur Arduino — carte : ${board.name}`);
    if (opts.title) out.push(` * ${opts.title}`);
    const extLibs = [...includes].filter(i => !['Wire.h', 'Servo.h', 'SoftwareSerial.h'].includes(i));
    if (extLibs.length) {
      out.push(' *');
      out.push(' * Bibliothèques à installer dans l\'IDE Arduino (Croquis > Inclure une bibliothèque > Gérer) :');
      const LIBNAMES = {
        'rgb_lcd.h': 'Grove - LCD RGB Backlight', 'U8x8lib.h': 'U8g2', 'TM1637.h': 'Grove 4-Digit Display',
        'Grove_LED_Bar.h': 'Grove LED Bar', 'ChainableLED.h': 'ChainableLED', 'Adafruit_NeoPixel.h': 'Adafruit NeoPixel',
        'Ultrasonic.h': 'Grove Ultrasonic Ranger', 'DHT.h': 'Grove Temperature And Humidity Sensor', 'SHT31.h': 'Grove SHT31',
        'Seeed_BMP280.h': 'Grove BMP280', 'Seeed_BME280.h': 'Grove BME280', 'ADXL345.h': 'Grove 3-Axis Digital Accelerometer ADXL345',
        'LIS3DHTR.h': 'Grove 3-Axis Digital Accelerometer LIS3DHTR', 'DS1307.h': 'Grove RTC DS1307', 'Digital_Light_TSL2561.h': 'Grove Digital Light Sensor',
        'Adafruit_TCS34725.h': 'Adafruit TCS34725', 'MLX90615.h': 'Grove Digital Infrared Temperature Sensor', 'Seeed_vl53l0x.h': 'Grove VL53L0X',
        'SCD30.h': 'Grove SCD30', 'paj7620.h': 'Grove Gesture PAJ7620', 'Encoder.h': 'Encoder (Paul Stoffregen)', 'IRremote.hpp': 'IRremote',
        'Grove_I2C_Motor_Driver.h': 'Grove I2C Motor Driver', 'WT2003S_Player.h': 'Grove MP3 v3'
      };
      extLibs.forEach(i => out.push(` *   - ${LIBNAMES[i] || i}`));
    }
    if (notes.length) { out.push(' *'); [...new Set(notes)].forEach(nn => out.push(' * Remarque : ' + nn)); }
    out.push(' */');
    out.push('');
    [...includes].forEach(i => out.push(`#include <${i}>`));
    if (includes.size) out.push('');
    if (globals.length) { out.push(...globals); out.push(''); }
    const varDecls = Object.entries(types.vars).filter(([n]) => !n.startsWith('_'))
      .map(([n, t]) => `${CTYPE[t]} ${n} = ${t === 'bool' ? 'false' : '0'};`);
    if (varDecls.length) { out.push('// variables'); out.push(...varDecls); out.push(''); }
    out.push('void setup() {');
    const init = setupInit.map(l => '  ' + l);
    const bodyLines = [];
    if (init.length) bodyLines.push(...init);
    if (setupCode) bodyLines.push(setupCode);
    out.push(bodyLines.join('\n'));
    out.push('}');
    out.push('');
    out.push('void loop() {');
    out.push(loopCode);
    out.push('}');
    if (procCode.length || helperCode.length) {
      out.push('');
      out.push([...procCode, ...helperCode].join('\n\n'));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  }

  const API = { generate };
  if (isNode) module.exports = API;
  else root.CppGen = API;
})(this);
