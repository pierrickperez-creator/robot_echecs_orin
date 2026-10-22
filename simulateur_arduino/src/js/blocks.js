/*
 * Définition des blocs (Blockly) et de la boîte à outils, en français.
 * La traduction des blocs en programme se trouve dans irbuilder.js.
 */
(function (root) {
  const COL = {
    prog: '#00979C', control: '#D6901A', logic: '#5B80A5', math: '#5B67A5', text: '#3E9C7A',
    vars: '#A55B80', func: '#995BA5', pins: '#2E7D32', serial: '#455A64',
    sensor: '#D84315', out: '#1565C0', disp: '#6A1B9A', comp: '#00838F'
  };

  const currentBoard = () => BOARDS[(root.APP && root.APP.boardId && root.APP.boardId()) || 'uno'];
  const opt = list => list.map(x => [x, x]);
  const allPins = () => opt([...currentBoard().digitalPins().filter((p, i) => i < currentBoard().analogBase), ...currentBoard().analogPins()]);
  const digitalPins = () => opt(currentBoard().digitalPins().filter((p, i) => i < currentBoard().analogBase).concat(currentBoard().analogPins().filter(p => !currentBoard().analogOnly.includes(currentBoard().pinNumber(p)))));
  const analogPins = () => opt(currentBoard().analogPins());
  const pwmPins = () => opt(currentBoard().pwm.map(n => 'D' + n));
  const groveDigital = () => {
    const b = currentBoard();
    const ports = b.groveDigitalPorts();
    const rest = b.digitalPins().filter((p, i) => i >= 2 && i < b.analogBase && !ports.includes(p));
    return opt(ports.concat(rest, b.analogPins().filter(p => !b.analogOnly.includes(b.pinNumber(p)))));
  };
  const groveAnalog = () => opt(currentBoard().analogPins());
  const modsOf = kinds => () => CATALOG.list.filter(c => kinds.includes(c.kind) && c.type.startsWith('grove_')).map(c => [c.name, c.type]);

  const NOTES = [['Do4', '262'], ['Do#4', '277'], ['Ré4', '294'], ['Ré#4', '311'], ['Mi4', '330'], ['Fa4', '349'], ['Fa#4', '370'],
    ['Sol4', '392'], ['Sol#4', '415'], ['La4', '440'], ['La#4', '466'], ['Si4', '494'], ['Do5', '523'], ['Do#5', '554'], ['Ré5', '587'],
    ['Ré#5', '622'], ['Mi5', '659'], ['Fa5', '698'], ['Fa#5', '740'], ['Sol5', '784'], ['Sol#5', '831'], ['La5', '880'], ['La#5', '932'],
    ['Si5', '988'], ['Do6', '1047'], ['silence', '0']];
  const COLORS = [['rouge', '255,0,0'], ['vert', '0,255,0'], ['bleu', '0,0,255'], ['jaune', '255,200,0'], ['orange', '255,100,0'],
    ['cyan', '0,255,255'], ['magenta', '255,0,255'], ['violet', '120,0,255'], ['rose', '255,80,120'], ['blanc', '255,255,255'], ['éteint (noir)', '0,0,0']];

  const B = Blockly.Blocks;
  const num = (b, name, label, check) => b.appendValueInput(name).setCheck(check === undefined ? 'Number' : check).appendField(label || '');

  function statement(b, colour, tip) {
    b.setPreviousStatement(true, null);
    b.setNextStatement(true, null);
    b.setColour(colour);
    if (tip) b.setTooltip(tip);
  }
  function output(b, colour, type, tip) {
    b.setOutput(true, type === undefined ? 'Number' : type);
    b.setColour(colour);
    if (tip) b.setTooltip(tip);
  }
  function modField(b, kinds, label) {
    const f = new Blockly.FieldDropdown(modsOf(kinds));
    b.appendDummyInput('MODLINE').appendField(label || '').appendField(f, 'MOD');
    return f;
  }

  /* ================================================================ programme */
  B.ard_setup = {
    init() {
      this.appendDummyInput().appendField('▶ Au démarrage');
      this.appendStatementInput('DO');
      this.setColour(COL.prog);
      this.setTooltip('Instructions exécutées une seule fois, à la mise sous tension (setup).');
      this.setDeletable(true);
    }
  };
  B.ard_loop = {
    init() {
      this.appendDummyInput().appendField('↻ Répéter indéfiniment');
      this.appendStatementInput('DO');
      this.setColour(COL.prog);
      this.setTooltip('Instructions répétées en boucle sans fin (loop).');
    }
  };

  /* ================================================================ contrôle */
  B.ard_delay = {
    init() {
      num(this, 'TIME', 'attendre');
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['millisecondes', 'ms'], ['secondes', 's']]), 'UNIT');
      this.setInputsInline(true);
      statement(this, COL.control, 'Met le programme en pause (delay).');
    }
  };
  B.ard_delay_us = {
    init() {
      num(this, 'TIME', 'attendre');
      this.appendDummyInput().appendField('microsecondes');
      this.setInputsInline(true);
      statement(this, COL.control, 'Pause très courte (delayMicroseconds).');
    }
  };
  B.ard_wait_until = {
    init() {
      num(this, 'COND', 'attendre jusqu\'à ce que', 'Boolean');
      statement(this, COL.control, 'Bloque le programme tant que la condition est fausse.');
    }
  };
  B.ard_millis = {
    init() {
      this.appendDummyInput().appendField('temps écoulé depuis le démarrage (ms)');
      output(this, COL.control, 'Number', 'millis()');
    }
  };
  B.ard_micros = {
    init() {
      this.appendDummyInput().appendField('temps écoulé (µs)');
      output(this, COL.control, 'Number', 'micros()');
    }
  };

  /* ================================================================ maths */
  B.ard_map = {
    init() {
      num(this, 'X', 'convertir');
      num(this, 'A', 'de [');
      num(this, 'B', ',');
      num(this, 'C', '] vers [');
      num(this, 'D', ',');
      this.appendDummyInput().appendField(']');
      this.setInputsInline(true);
      output(this, COL.math, 'Number', 'Règle de trois entière (map) : ramène une valeur d\'un intervalle à un autre.');
    }
  };
  B.ard_minmax = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['minimum', 'min'], ['maximum', 'max']]), 'FN');
      num(this, 'A', 'de');
      num(this, 'B', 'et');
      this.setInputsInline(true);
      output(this, COL.math);
    }
  };
  B.ard_decimals = {
    init() {
      num(this, 'X', 'nombre');
      this.appendDummyInput().appendField('avec')
        .appendField(new Blockly.FieldNumber(1, 0, 6, 1), 'DEC').appendField('décimale(s)');
      this.setInputsInline(true);
      output(this, COL.text, 'Number', 'Pour afficher un nombre avec un nombre de décimales choisi.');
    }
  };

  /* ================================================================ broches */
  B.ard_pin_mode = {
    init() {
      this.appendDummyInput().appendField('définir la broche')
        .appendField(new Blockly.FieldDropdown(allPins), 'PIN').appendField('en')
        .appendField(new Blockly.FieldDropdown([['sortie', '1'], ['entrée', '0'], ['entrée avec pull-up', '2']]), 'MODE');
      statement(this, COL.pins, 'pinMode()');
    }
  };
  B.ard_digital_write = {
    init() {
      this.appendDummyInput().appendField('mettre la broche').appendField(new Blockly.FieldDropdown(digitalPins), 'PIN');
      num(this, 'VALUE', 'à', null);
      this.setInputsInline(true);
      statement(this, COL.pins, 'digitalWrite() : HAUT = 5 V, BAS = 0 V.');
    }
  };
  B.ard_highlow = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['HAUT (1)', '1'], ['BAS (0)', '0']]), 'V');
      output(this, COL.pins, null);
    }
  };
  B.ard_digital_read = {
    init() {
      this.appendDummyInput().appendField('lire l\'état de la broche').appendField(new Blockly.FieldDropdown(digitalPins), 'PIN');
      output(this, COL.pins, null, 'digitalRead() : renvoie 1 (HAUT) ou 0 (BAS).');
    }
  };
  B.ard_analog_read = {
    init() {
      this.appendDummyInput().appendField('lire la valeur analogique').appendField(new Blockly.FieldDropdown(analogPins), 'PIN');
      output(this, COL.pins, 'Number', 'analogRead() : de 0 (0 V) à 1023 (5 V).');
    }
  };
  B.ard_analog_write = {
    init() {
      this.appendDummyInput().appendField('PWM : broche').appendField(new Blockly.FieldDropdown(pwmPins), 'PIN');
      num(this, 'VALUE', 'à');
      this.appendDummyInput().appendField('(0 à 255)');
      this.setInputsInline(true);
      statement(this, COL.pins, 'analogWrite() : sortie à rapport cyclique variable, broches ~ seulement.');
    }
  };
  B.ard_tone = {
    init() {
      this.appendDummyInput().appendField('jouer sur la broche').appendField(new Blockly.FieldDropdown(digitalPins), 'PIN');
      num(this, 'FREQ', 'la fréquence');
      this.appendDummyInput().appendField('Hz');
      this.setInputsInline(true);
      statement(this, COL.pins, 'tone() : son continu jusqu\'à « arrêter le son ».');
    }
  };
  B.ard_notone = {
    init() {
      this.appendDummyInput().appendField('arrêter le son sur la broche').appendField(new Blockly.FieldDropdown(digitalPins), 'PIN');
      statement(this, COL.pins, 'noTone()');
    }
  };
  B.ard_pulsein = {
    init() {
      this.appendDummyInput().appendField('durée (µs) d\'une impulsion')
        .appendField(new Blockly.FieldDropdown([['HAUTE', '1'], ['BASSE', '0']]), 'LEVEL')
        .appendField('sur la broche').appendField(new Blockly.FieldDropdown(digitalPins), 'PIN');
      output(this, COL.pins, 'Number', 'pulseIn() avec un délai maximal d\'une seconde.');
    }
  };

  /* ================================================================ série */
  B.ard_serial_begin = {
    init() {
      this.appendDummyInput().appendField('démarrer le moniteur série à')
        .appendField(new Blockly.FieldDropdown(opt(['9600', '115200', '57600', '38400', '19200', '4800', '2400', '300'])), 'BAUD')
        .appendField('bauds');
      statement(this, COL.serial, 'Serial.begin()');
    }
  };
  B.ard_serial_print = {
    init() {
      num(this, 'VALUE', 'moniteur série : afficher', null);
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['et aller à la ligne', '1'], ['sans aller à la ligne', '0']]), 'NL');
      this.setInputsInline(true);
      statement(this, COL.serial, 'Serial.print() / Serial.println()');
    }
  };
  B.ard_serial_plot = {
    init() {
      this.appendDummyInput().appendField('traceur série :');
      num(this, 'V1', '').appendField(new Blockly.FieldTextInput('valeur1'), 'N1');
      num(this, 'V2', '').appendField(new Blockly.FieldTextInput('valeur2'), 'N2');
      num(this, 'V3', '').appendField(new Blockly.FieldTextInput('valeur3'), 'N3');
      this.setInputsInline(true);
      statement(this, COL.serial, 'Envoie jusqu\'à trois valeurs nommées au traceur (laisser une case vide pour l\'ignorer).');
    }
  };
  B.ard_serial_available = {
    init() {
      this.appendDummyInput().appendField('nombre de caractères reçus sur le port série');
      output(this, COL.serial, 'Number', 'Serial.available()');
    }
  };
  B.ard_serial_read = {
    init() {
      this.appendDummyInput().appendField('lire un caractère reçu (code)');
      output(this, COL.serial, 'Number', 'Serial.read() : -1 si rien n\'a été reçu.');
    }
  };
  B.ard_char_code = {
    init() {
      this.appendDummyInput().appendField('code du caractère').appendField(new Blockly.FieldTextInput('a', v => (v ? v[0] : null)), 'C');
      output(this, COL.serial, 'Number');
    }
  };

  /* ================================================================ Grove : capteurs */
  const askOf = type => (CATALOG.byType[type] && CATALOG.byType[type].ask) || 'est actif';
  B.grove_din = {
    init() {
      const f = modField(this, ['din']);
      f.setValidator(v => { const lab = this.getField('ASK'); if (lab) lab.setValue(askOf(v) + ' ?'); return v; });
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT')
        .appendField(new Blockly.FieldLabelSerializable('est actif ?'), 'ASK');
      this.setInputsInline(true);
      output(this, COL.sensor, 'Boolean', 'Lit un module tout-ou-rien (digitalRead).');
    },
    onchange() { const lab = this.getField('ASK'); const t = askOf(this.getFieldValue('MOD')) + ' ?'; if (lab && lab.getValue() !== t) lab.setValue(t); }
  };
  B.grove_dout2 = {
    init() {
      this.appendDummyInput().appendField('bouton lumineux sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT')
        .appendField(': LED').appendField(new Blockly.FieldDropdown([['allumée', '1'], ['éteinte', '0']]), 'STATE');
      statement(this, COL.out, 'Commande la LED du bouton (signal blanc = broche suivante).');
    }
  };
  B.grove_ain = {
    init() {
      modField(this, ['ain'], 'valeur du');
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(groveAnalog), 'PORT').appendField('(0 à 1023)');
      this.setInputsInline(true);
      output(this, COL.sensor, 'Number', 'analogRead() du module.');
    }
  };
  B.grove_ain_angle = {
    init() {
      this.appendDummyInput().appendField('angle (°) du potentiomètre rotatif sur').appendField(new Blockly.FieldDropdown(groveAnalog), 'PORT');
      output(this, COL.sensor, 'Number', 'De 0 à 300°.');
    }
  };
  B.grove_ain_temp = {
    init() {
      this.appendDummyInput().appendField('température (°C) du capteur Grove sur').appendField(new Blockly.FieldDropdown(groveAnalog), 'PORT');
      output(this, COL.sensor, 'Number', 'Conversion de la thermistance du module Grove Temperature Sensor v1.2.');
    }
  };
  B.grove_joystick = {
    init() {
      this.appendDummyInput().appendField('joystick sur').appendField(new Blockly.FieldDropdown(groveAnalog), 'PORT')
        .appendField(new Blockly.FieldDropdown([['position X', 'X'], ['position Y', 'Y'], ['est appuyé ?', 'P']]), 'AXIS');
      output(this, COL.sensor, null, 'Positions de 0 à 1023 (≈512 au centre).');
    }
  };
  B.grove_ultrasonic = {
    init() {
      this.appendDummyInput().appendField('distance (cm) du capteur à ultrasons sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      output(this, COL.sensor, 'Number', 'Grove Ultrasonic Ranger (un seul fil de signal).');
    }
  };
  B.grove_dht = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['température (°C)', '0'], ['humidité (%)', '1']]), 'WHAT')
        .appendField('du');
      modField(this, ['dht']);
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      this.setInputsInline(true);
      output(this, COL.sensor, 'Number', 'DHT11 : une mesure par seconde au maximum ; DHT22 : toutes les 2 s.');
    }
  };
  B.grove_thi2c = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['température (°C)', '0'], ['humidité (%)', '1']]), 'WHAT')
        .appendField('du');
      modField(this, ['thi2c']);
      this.setInputsInline(true);
      output(this, COL.sensor, 'Number', 'Capteur I2C : à brancher sur un port I2C.');
    }
  };
  B.grove_baro = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['température (°C)', '0'], ['pression (hPa)', '1'], ['altitude (m)', '2'], ['humidité (%) (BME280)', '3']]), 'WHAT')
        .appendField('du baromètre (I2C)');
      output(this, COL.sensor, 'Number', 'BMP280 ou BME280 sur un port I2C.');
    }
  };
  B.grove_accel = {
    init() {
      this.appendDummyInput().appendField('accélération').appendField(new Blockly.FieldDropdown([['X', '0'], ['Y', '1'], ['Z', '2']]), 'AXIS')
        .appendField('(g) de l\'accéléromètre (I2C)');
      output(this, COL.sensor, 'Number', 'ADXL345 ou LIS3DHTR (détection automatique sur la carte). 1 g ≈ 9,81 m/s².');
    }
  };
  B.grove_gyro = {
    init() {
      this.appendDummyInput().appendField('vitesse de rotation').appendField(new Blockly.FieldDropdown([['X', '0'], ['Y', '1'], ['Z', '2']]), 'AXIS')
        .appendField('(°/s) du gyroscope (I2C)');
      output(this, COL.sensor, 'Number', 'Simulation uniquement pour l\'instant.');
    }
  };
  const simpleSensor = (name, label, tip) => {
    B[name] = { init() { this.appendDummyInput().appendField(label); output(this, COL.sensor, 'Number', tip); } };
  };
  simpleSensor('grove_lux', 'éclairement (lux) du capteur TSL2561 (I2C)', 'Capteur de lumière numérique. Carte Mega seulement (mémoire).');
  simpleSensor('grove_heart', 'pouls (battements/min) du capteur à pince (I2C)', 'Carte Mega seulement (mémoire).');
  simpleSensor('grove_tof', 'distance (mm) du capteur laser VL53L0X (I2C)', 'Simulation uniquement pour l\'instant.');
  simpleSensor('grove_rfid', 'identifiant du badge RFID lu (0 si aucun)', 'Simulation uniquement pour l\'instant.');
  simpleSensor('grove_keypad', 'touche appuyée sur le clavier (-1 si aucune)', 'Simulation uniquement pour l\'instant.');
  B.grove_color = {
    init() {
      this.appendDummyInput().appendField('quantité de').appendField(new Blockly.FieldDropdown([['rouge', '0'], ['vert', '1'], ['bleu', '2'], ['lumière totale', '3']]), 'CH')
        .appendField('du capteur de couleur (I2C)');
      output(this, COL.sensor, 'Number', 'Rouge, vert, bleu : 0 à 255. Carte Mega seulement (mémoire).');
    }
  };
  B.grove_irtemp = {
    init() {
      this.appendDummyInput().appendField('température').appendField(new Blockly.FieldDropdown([['de l\'objet visé', '0'], ['ambiante', '1']]), 'W')
        .appendField('(°C) du thermomètre infrarouge');
      output(this, COL.sensor, 'Number', 'MLX90615. Carte Mega seulement (mémoire).');
    }
  };
  B.grove_co2 = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['CO2 (ppm)', '0'], ['température (°C)', '1'], ['humidité (%)', '2']]), 'W')
        .appendField('du capteur SCD30');
      output(this, COL.sensor, 'Number', 'Simulation uniquement pour l\'instant.');
    }
  };
  B.grove_gesture = {
    init() {
      this.appendDummyInput().appendField('geste détecté').appendField(new Blockly.FieldDropdown([['est vers le haut', '1'], ['est vers le bas', '2'],
        ['est vers la gauche', '3'], ['est vers la droite', '4'], ['est vers l\'avant', '5'], ['est vers l\'arrière', '6'],
        ['est un tour horaire', '7'], ['est un tour anti-horaire', '8'], ['(numéro du geste)', 'N']]), 'G');
      output(this, COL.sensor, null, 'Chaque geste n\'est lu qu\'une fois : rangez-le dans une variable avec « (numéro du geste) » pour le tester plusieurs fois.');
    }
  };
  B.grove_rtc = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['heures', '2'], ['minutes', '1'], ['secondes', '0'], ['jour du mois', '4'],
        ['mois', '5'], ['année', '6'], ['jour de la semaine (1 = lundi)', '3']]), 'F').appendField('de l\'horloge RTC');
      output(this, COL.sensor, 'Number');
    }
  };
  B.grove_rtc_set = {
    init() {
      this.appendDummyInput().appendField('régler l\'horloge RTC à');
      num(this, 'H', ''); num(this, 'MI', 'h'); num(this, 'S', 'min');
      num(this, 'D', 's, le'); num(this, 'MO', '/'); num(this, 'Y', '/');
      this.setInputsInline(true);
      statement(this, COL.sensor);
    }
  };
  B.grove_encoder = {
    init() {
      this.appendDummyInput().appendField('position de l\'encodeur rotatif sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      output(this, COL.sensor, 'Number', 'Simulation uniquement pour l\'instant.');
    }
  };
  B.grove_ir = {
    init() {
      this.appendDummyInput().appendField('code reçu par le récepteur infrarouge sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      output(this, COL.sensor, 'Number', '0 si aucune touche de télécommande. Simulation uniquement pour l\'instant.');
    }
  };

  /* ================================================================ Grove : sorties */
  B.grove_dout = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown([['activer / allumer', '1'], ['désactiver / éteindre', '0']]), 'STATE');
      modField(this, ['dout', 'pwm', 'buzzer']);
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      this.setInputsInline(true);
      statement(this, COL.out, 'digitalWrite() sur le module.');
    }
  };
  B.grove_pwm = {
    init() {
      this.appendDummyInput().appendField('intensité du');
      modField(this, ['pwm']);
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(pwmPins), 'PORT');
      num(this, 'VALUE', 'à');
      this.appendDummyInput().appendField('(0 à 255)');
      this.setInputsInline(true);
      statement(this, COL.out, 'analogWrite() : uniquement sur les broches PWM (~).');
    }
  };
  B.grove_note = {
    init() {
      this.appendDummyInput().appendField('jouer la note').appendField(new Blockly.FieldDropdown(NOTES), 'NOTE');
      num(this, 'DUR', 'pendant');
      this.appendDummyInput().appendField('ms sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      this.setInputsInline(true);
      statement(this, COL.out, 'Joue la note puis attend la fin de la note.');
    }
  };
  B.grove_freq = {
    init() {
      num(this, 'FREQ', 'émettre un son de');
      this.appendDummyInput().appendField('Hz sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      this.setInputsInline(true);
      statement(this, COL.out, 'Son continu (tone).');
    }
  };
  B.grove_notone = {
    init() {
      this.appendDummyInput().appendField('arrêter le son sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      statement(this, COL.out);
    }
  };
  B.servo_write = {
    init() {
      this.appendDummyInput().appendField('servomoteur sur').appendField(new Blockly.FieldDropdown(digitalPins), 'PORT');
      num(this, 'ANGLE', 'tourner à');
      this.appendDummyInput().appendField('° (0 à 180)');
      this.setInputsInline(true);
      statement(this, COL.out);
    }
  };
  B.grove_motor = {
    init() {
      this.appendDummyInput().appendField('pilote moteurs I2C : moteur')
        .appendField(new Blockly.FieldDropdown([['A (M1)', '0'], ['B (M2)', '1']]), 'M');
      num(this, 'SPEED', 'vitesse');
      this.appendDummyInput().appendField('(-255 à 255)');
      this.setInputsInline(true);
      statement(this, COL.out, 'Carte Mega seulement (mémoire).');
    }
  };
  B.grove_chain = {
    init() {
      this.appendDummyInput().appendField('LED RGB chaînable sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'I', 'n°');
      num(this, 'COLOR', 'couleur', 'Colour');
      this.setInputsInline(true);
      statement(this, COL.out, 'La première LED de la chaîne porte le n° 0.');
    }
  };
  B.grove_pixels = {
    init() {
      this.appendDummyInput().appendField('LED adressable n°');
      num(this, 'I', '');
      this.appendDummyInput().appendField('sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'COLOR', 'couleur', 'Colour');
      this.setInputsInline(true);
      statement(this, COL.out, 'Ruban, barrette ou anneau de LED RGB (WS2812/WS2813). Première LED : n° 0.');
    }
  };
  B.grove_pixels_fill = {
    init() {
      num(this, 'N', 'allumer les');
      this.appendDummyInput().appendField('premières LED sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'COLOR', 'en', 'Colour');
      this.setInputsInline(true);
      statement(this, COL.out);
    }
  };
  B.grove_mp3 = {
    init() {
      this.appendDummyInput().appendField('lecteur MP3 :')
        .appendField(new Blockly.FieldDropdown([['jouer la piste n°', 'play'], ['régler le volume (0-30) à', 'vol']]), 'ACT');
      num(this, 'N', '');
      this.setInputsInline(true);
      statement(this, COL.out, 'Simulation uniquement pour l\'instant.');
    }
  };
  B.grove_mp3_stop = { init() { this.appendDummyInput().appendField('lecteur MP3 : arrêter'); statement(this, COL.out); } };

  /* ================================================================ couleurs */
  B.color_named = {
    init() {
      this.appendDummyInput().appendField(new Blockly.FieldDropdown(COLORS), 'C');
      output(this, COL.out, 'Colour');
    }
  };
  B.color_rgb = {
    init() {
      num(this, 'R', 'rouge');
      num(this, 'G', 'vert');
      num(this, 'B', 'bleu');
      this.setInputsInline(true);
      output(this, COL.out, 'Colour', 'Chaque composante de 0 à 255.');
    }
  };

  /* ================================================================ Grove : afficheurs */
  B.lcd_print = {
    init() {
      num(this, 'VALUE', 'écran LCD : afficher', null);
      this.setInputsInline(true);
      statement(this, COL.disp, 'Écrit à la position du curseur (16 caractères par ligne).');
    }
  };
  B.lcd_cursor = {
    init() {
      this.appendDummyInput().appendField('écran LCD : placer le curseur');
      num(this, 'COL', 'colonne (0-15)');
      num(this, 'ROW', 'ligne (0-1)');
      this.setInputsInline(true);
      statement(this, COL.disp);
    }
  };
  B.lcd_clear = { init() { this.appendDummyInput().appendField('écran LCD : effacer'); statement(this, COL.disp); } };
  B.lcd_rgb = {
    init() {
      num(this, 'COLOR', 'écran LCD : couleur du rétroéclairage', 'Colour');
      statement(this, COL.disp, 'Uniquement pour l\'écran LCD RGB.');
    }
  };
  B.oled_print = {
    init() {
      num(this, 'VALUE', 'écran OLED : afficher', null);
      this.setInputsInline(true);
      statement(this, COL.disp, '16 caractères × 8 lignes.');
    }
  };
  B.oled_cursor = {
    init() {
      this.appendDummyInput().appendField('écran OLED : placer le curseur');
      num(this, 'COL', 'colonne (0-15)');
      num(this, 'ROW', 'ligne (0-7)');
      this.setInputsInline(true);
      statement(this, COL.disp);
    }
  };
  B.oled_clear = { init() { this.appendDummyInput().appendField('écran OLED : effacer'); statement(this, COL.disp); } };
  B.tm_number = {
    init() {
      this.appendDummyInput().appendField('afficheur 4 chiffres sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'N', 'afficher le nombre');
      this.setInputsInline(true);
      statement(this, COL.disp, 'Nombre entier de -999 à 9999.');
    }
  };
  B.tm_digits = {
    init() {
      this.appendDummyInput().appendField('afficheur 4 chiffres sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'D0', 'chiffres'); num(this, 'D1', ''); num(this, 'D2', ''); num(this, 'D3', '');
      this.setInputsInline(true);
      statement(this, COL.disp, 'Un chiffre (0-9) par case, -1 pour une case vide.');
    }
  };
  B.tm_colon = {
    init() {
      this.appendDummyInput().appendField('afficheur 4 chiffres sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT')
        .appendField(': deux-points').appendField(new Blockly.FieldDropdown([['allumés', '1'], ['éteints', '0']]), 'ON');
      statement(this, COL.disp);
    }
  };
  B.tm_bright = {
    init() {
      this.appendDummyInput().appendField('afficheur 4 chiffres sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'B', 'luminosité (0-7)');
      this.setInputsInline(true);
      statement(this, COL.disp);
    }
  };
  B.tm_clear = {
    init() {
      this.appendDummyInput().appendField('afficheur 4 chiffres sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT').appendField(': effacer');
      statement(this, COL.disp);
    }
  };
  B.ledbar_level = {
    init() {
      this.appendDummyInput().appendField('barre de LED sur').appendField(new Blockly.FieldDropdown(groveDigital), 'PORT');
      num(this, 'N', 'niveau');
      this.appendDummyInput().appendField('(0 à 10)');
      this.setInputsInline(true);
      statement(this, COL.disp);
    }
  };

  /* ================================================================ composants de base */
  B.hcsr04_distance = {
    init() {
      this.appendDummyInput().appendField('distance (cm) du HC-SR04 : Trig')
        .appendField(new Blockly.FieldDropdown(digitalPins), 'TRIG').appendField('Echo')
        .appendField(new Blockly.FieldDropdown(digitalPins), 'ECHO');
      output(this, COL.comp, 'Number', 'Envoie une impulsion de 10 µs sur Trig puis mesure l\'écho.');
    }
  };

  /* ================================================================ boîte à outils */
  const shadowNum = v => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
  const shadowColor = c => ({ shadow: { type: 'color_named', fields: { C: c || '255,0,0' } } });
  const blk = (type, extra) => Object.assign({ kind: 'block', type }, extra || {});

  // blocs proposés pour un module du catalogue
  function moduleBlocks(def) {
    const port = (def.conn === 'analog') ? null : null;
    const out = [];
    const f = def.type;
    for (const k of def.blocks || []) {
      switch (k) {
        case 'din': out.push(blk('grove_din', { fields: { MOD: f } })); break;
        case 'dout2': out.push(blk('grove_dout2')); break;
        case 'ain': out.push(blk('grove_ain', { fields: { MOD: f } })); break;
        case 'ain_angle': out.push(blk('grove_ain_angle')); break;
        case 'ain_temp': out.push(blk('grove_ain_temp')); break;
        case 'joystick': out.push(blk('grove_joystick')); break;
        case 'dout': out.push(blk('grove_dout', { fields: { MOD: f } })); break;
        case 'pwm': out.push(blk('grove_pwm', { fields: { MOD: f, PORT: 'D3' }, inputs: { VALUE: shadowNum(128) } })); break;
        case 'tone':
          out.push(blk('grove_note', { inputs: { DUR: shadowNum(250) } }));
          out.push(blk('grove_freq', { inputs: { FREQ: shadowNum(440) } }));
          break;
        case 'notone': out.push(blk('grove_notone')); break;
        case 'servo': out.push(blk('servo_write', { fields: { PORT: 'D5' }, inputs: { ANGLE: shadowNum(90) } })); break;
        case 'ultrasonic': out.push(blk('grove_ultrasonic', { fields: { PORT: 'D7' } })); break;
        case 'dht': out.push(blk('grove_dht', { fields: { MOD: f } })); break;
        case 'thi2c': out.push(blk('grove_thi2c', { fields: { MOD: f } })); break;
        case 'baro': out.push(blk('grove_baro')); break;
        case 'accel': out.push(blk('grove_accel')); break;
        case 'gyro': out.push(blk('grove_gyro')); break;
        case 'lux': out.push(blk('grove_lux')); break;
        case 'color': out.push(blk('grove_color')); break;
        case 'irtemp': out.push(blk('grove_irtemp')); break;
        case 'heart': out.push(blk('grove_heart')); break;
        case 'tof': out.push(blk('grove_tof')); break;
        case 'co2': out.push(blk('grove_co2')); break;
        case 'gesture': out.push(blk('grove_gesture')); break;
        case 'rtc':
          out.push(blk('grove_rtc'));
          out.push(blk('grove_rtc_set', { inputs: { H: shadowNum(8), MI: shadowNum(0), S: shadowNum(0), D: shadowNum(1), MO: shadowNum(9), Y: shadowNum(2026) } }));
          break;
        case 'encoder': out.push(blk('grove_encoder')); break;
        case 'ir': out.push(blk('grove_ir')); break;
        case 'rfid': out.push(blk('grove_rfid')); break;
        case 'keypad': out.push(blk('grove_keypad')); break;
        case 'motor': out.push(blk('grove_motor', { inputs: { SPEED: shadowNum(200) } })); break;
        case 'mp3':
          out.push(blk('grove_mp3', { inputs: { N: shadowNum(1) } }));
          out.push(blk('grove_mp3_stop'));
          break;
        case 'chain': out.push(blk('grove_chain', { inputs: { I: shadowNum(0), COLOR: shadowColor() } })); break;
        case 'pixels':
          out.push(blk('grove_pixels', { inputs: { I: shadowNum(0), COLOR: shadowColor() } }));
          out.push(blk('grove_pixels_fill', { inputs: { N: shadowNum((def.props && def.props.count) || 10), COLOR: shadowColor('0,0,255') } }));
          break;
        case 'lcd_print': out.push(blk('lcd_print', { inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Bonjour !' } } } } })); break;
        case 'lcd_cursor': out.push(blk('lcd_cursor', { inputs: { COL: shadowNum(0), ROW: shadowNum(1) } })); break;
        case 'lcd_clear': out.push(blk('lcd_clear')); break;
        case 'lcd_rgb': out.push(blk('lcd_rgb', { inputs: { COLOR: shadowColor('0,0,255') } })); break;
        case 'oled_print': out.push(blk('oled_print', { inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Bonjour !' } } } } })); break;
        case 'oled_cursor': out.push(blk('oled_cursor', { inputs: { COL: shadowNum(0), ROW: shadowNum(2) } })); break;
        case 'oled_clear': out.push(blk('oled_clear')); break;
        case 'tm_number': out.push(blk('tm_number', { inputs: { N: shadowNum(1234) } })); break;
        case 'tm_digits': out.push(blk('tm_digits', { inputs: { D0: shadowNum(1), D1: shadowNum(2), D2: shadowNum(3), D3: shadowNum(4) } })); break;
        case 'tm_colon': out.push(blk('tm_colon')); break;
        case 'tm_bright': out.push(blk('tm_bright', { inputs: { B: shadowNum(4) } })); break;
        case 'tm_clear': out.push(blk('tm_clear')); break;
        case 'ledbar': out.push(blk('ledbar_level', { inputs: { N: shadowNum(5) } })); break;
      }
    }
    void port;
    return out;
  }

  function groveCategory(group, colour) {
    const contents = [];
    const seen = new Map();   // bloc déjà présent -> étiquette qui le précède
    for (const def of CATALOG.list.filter(c => c.group === group)) {
      const bl = moduleBlocks(def);
      if (!bl.length) continue;
      const label = { kind: 'label', text: def.name };
      const fresh = bl.filter(b => !seen.has(JSON.stringify(b)));
      if (!fresh.length) {
        // mêmes blocs qu'un module précédent : on complète simplement son étiquette
        const prev = seen.get(JSON.stringify(bl[0]));
        prev.text += ' · ' + def.name;
        continue;
      }
      contents.push(label);
      for (const b of fresh) {
        seen.set(JSON.stringify(b), label);
        contents.push(b);
      }
    }
    return { kind: 'category', name: group.replace('Grove – ', 'Grove : '), colour, contents };
  }

  function toolbox() {
    return {
      kind: 'categoryToolbox',
      contents: [
        { kind: 'category', name: 'Programme', colour: COL.prog, contents: [blk('ard_setup'), blk('ard_loop')] },
        { kind: 'category', name: 'Contrôle', colour: COL.control, contents: [
          blk('ard_delay', { inputs: { TIME: shadowNum(1000) } }),
          blk('controls_if'), blk('controls_if', { extraState: { hasElse: true } }),
          blk('controls_repeat_ext', { inputs: { TIMES: shadowNum(10) } }),
          blk('controls_whileUntil'),
          blk('controls_for', { inputs: { FROM: shadowNum(1), TO: shadowNum(10), BY: shadowNum(1) } }),
          blk('controls_flow_statements'),
          blk('ard_wait_until'),
          blk('ard_millis'), blk('ard_micros'),
          blk('ard_delay_us', { inputs: { TIME: shadowNum(10) } })
        ] },
        { kind: 'category', name: 'Logique', colour: COL.logic, contents: [
          blk('logic_compare'), blk('logic_operation'), blk('logic_negate'), blk('logic_boolean')
        ] },
        { kind: 'category', name: 'Maths', colour: COL.math, contents: [
          blk('math_number', { fields: { NUM: 0 } }),
          blk('math_arithmetic', { inputs: { A: shadowNum(1), B: shadowNum(1) } }),
          blk('math_modulo', { inputs: { DIVIDEND: shadowNum(10), DIVISOR: shadowNum(3) } }),
          blk('math_random_int', { inputs: { FROM: shadowNum(1), TO: shadowNum(6) } }),
          blk('ard_map', { inputs: { X: shadowNum(512), A: shadowNum(0), B: shadowNum(1023), C: shadowNum(0), D: shadowNum(255) } }),
          blk('math_constrain', { inputs: { VALUE: shadowNum(50), LOW: shadowNum(0), HIGH: shadowNum(100) } }),
          blk('ard_minmax', { inputs: { A: shadowNum(1), B: shadowNum(2) } }),
          blk('math_round', { inputs: { NUM: shadowNum(3.1) } }),
          blk('math_single', { inputs: { NUM: shadowNum(9) } }),
          blk('math_trig', { inputs: { NUM: shadowNum(45) } }),
          blk('math_constant'),
          blk('math_number_property', { inputs: { NUMBER_TO_CHECK: shadowNum(0) } })
        ] },
        { kind: 'category', name: 'Texte', colour: COL.text, contents: [
          blk('text'), blk('text_join'),
          blk('ard_decimals', { inputs: { X: shadowNum(3.14159) } })
        ] },
        { kind: 'category', name: 'Variables', colour: COL.vars, custom: 'VARIABLE' },
        { kind: 'category', name: 'Fonctions', colour: COL.func, custom: 'PROCEDURE' },
        { kind: 'sep' },
        { kind: 'category', name: 'Broches (entrées/sorties)', colour: COL.pins, contents: [
          blk('ard_pin_mode', { fields: { PIN: 'D13' } }),
          blk('ard_digital_write', { fields: { PIN: 'D13' }, inputs: { VALUE: { shadow: { type: 'ard_highlow' } } } }),
          blk('ard_highlow'),
          blk('ard_digital_read', { fields: { PIN: 'D2' } }),
          blk('ard_analog_read'),
          blk('ard_analog_write', { fields: { PIN: 'D3' }, inputs: { VALUE: shadowNum(128) } }),
          blk('ard_tone', { fields: { PIN: 'D8' }, inputs: { FREQ: shadowNum(440) } }),
          blk('ard_notone', { fields: { PIN: 'D8' } }),
          blk('ard_pulsein')
        ] },
        { kind: 'category', name: 'Moniteur série', colour: COL.serial, contents: [
          blk('ard_serial_begin'),
          blk('ard_serial_print', { inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'Bonjour' } } } } }),
          blk('ard_serial_plot'),
          blk('ard_serial_available'), blk('ard_serial_read'), blk('ard_char_code')
        ] },
        { kind: 'category', name: 'Composants de base', colour: COL.comp, contents: [
          blk('servo_write', { fields: { PORT: 'D9' }, inputs: { ANGLE: shadowNum(90) } }),
          blk('hcsr04_distance', { fields: { TRIG: 'D9', ECHO: 'D10' } })
        ] },
        { kind: 'sep' },
        groveCategory('Grove – Boutons et détecteurs', COL.sensor),
        groveCategory('Grove – Capteurs analogiques', COL.sensor),
        groveCategory('Grove – Capteurs numériques et I2C', COL.sensor),
        groveCategory('Grove – Sorties (LED, son, moteurs)', COL.out),
        Object.assign(groveCategory('Grove – Afficheurs', COL.disp), {}),
        { kind: 'category', name: 'Couleurs', colour: COL.out, contents: [blk('color_named'), blk('color_rgb', { inputs: { R: shadowNum(255), G: shadowNum(128), B: shadowNum(0) } })] }
      ]
    };
  }

  root.BlocksDef = { toolbox, COL, NOTES, COLORS };
})(this);
