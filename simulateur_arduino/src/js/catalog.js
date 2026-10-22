/*
 * Catalogue des composants : composants de base pour plaque d'essai et modules Grove.
 *
 * Champs principaux :
 *   type     identifiant unique
 *   name     nom affiché
 *   group    rubrique de la bibliothèque
 *   kind     comportement dans le simulateur (voir sim.js) :
 *              din (capteur tout-ou-rien), ain (capteur analogique), dout (sortie tout-ou-rien),
 *              pwm (sortie variable), buzzer, servo, ultrasonic, dht, lcd, oled, tm1637, ledbar,
 *              chain, pixels, accel, baro, thi2c, rtc, i2cval (capteur I2C à une valeur), joystick,
 *              motor, encoder, ir, mp3, gesture, keypad, rfid, et pour les composants de base :
 *              resistor, led, rgbled, button, switch, pot, ldr, ntc, piezo, dcmotor, hcsr04, breadboard
 *   conn     type de port Grove attendu : digital, analog, i2c, uart
 *   draw     dessin (voir draw.js)
 *   blocks   blocs proposés dans la boîte à outils (voir blocks.js)
 *   sim      paramètres de simulation
 *   ref      référence Seeed (indicative)
 */
(function (root) {
  const C = [];
  const add = o => { C.push(o); return o; };

  const G_IN = 'Grove – Boutons et détecteurs';
  const G_AN = 'Grove – Capteurs analogiques';
  const G_SENS = 'Grove – Capteurs numériques et I2C';
  const G_OUT = 'Grove – Sorties (LED, son, moteurs)';
  const G_DISP = 'Grove – Afficheurs';
  const G_COM = 'Grove – Communication et divers';
  const BASE = 'Composants de base';

  /* ======================================================== composants de base */
  add({ type: 'breadboard', name: 'Plaque d\'essai', group: BASE, kind: 'breadboard', draw: 'breadboard',
    desc: 'Plaque de prototypage 30 colonnes avec lignes d\'alimentation.' });
  add({ type: 'resistor', name: 'Résistance', group: BASE, kind: 'resistor', draw: 'resistor',
    props: { ohms: 220 }, desc: 'Limite le courant. Valeur réglable (Ω).' });
  for (const [col, label, vf] of [['red', 'rouge', 1.8], ['green', 'verte', 2.1], ['yellow', 'jaune', 2.0],
    ['blue', 'bleue', 3.0], ['white', 'blanche', 3.0], ['orange', 'orange', 2.0]]) {
    add({ type: 'led_' + col, name: 'LED ' + label, group: BASE, kind: 'led', draw: 'led',
      props: { color: col, vf }, desc: 'Diode électroluminescente. Patte longue (+) = anode. Pensez à la résistance !' });
  }
  add({ type: 'rgbled', name: 'LED RGB (cathode commune)', group: BASE, kind: 'rgbled', draw: 'rgbled',
    desc: '3 LED (rouge, verte, bleue) dans un même boîtier, cathode commune.' });
  add({ type: 'pushbutton', name: 'Bouton-poussoir', group: BASE, kind: 'button', draw: 'pushbutton',
    desc: 'Contact fermé tant qu\'on appuie. À placer à cheval sur la rainure centrale.' });
  add({ type: 'slideswitch', name: 'Interrupteur à glissière', group: BASE, kind: 'switch', draw: 'slideswitch',
    desc: 'La broche centrale est reliée à gauche ou à droite.' });
  add({ type: 'potentiometer', name: 'Potentiomètre 10 kΩ', group: BASE, kind: 'pot', draw: 'potentiometer',
    props: { ohms: 10000 }, sim: { value: 50 }, desc: 'Résistance variable : la broche du milieu est le curseur.' });
  add({ type: 'ldr', name: 'Photorésistance (LDR)', group: BASE, kind: 'ldr', draw: 'ldr',
    sim: { value: 50 }, desc: 'Sa résistance diminue quand la lumière augmente (≈1 MΩ dans le noir, ≈1 kΩ en plein jour).' });
  add({ type: 'ntc', name: 'Thermistance CTN 10 kΩ', group: BASE, kind: 'ntc', draw: 'ntc',
    sim: { value: 25 }, desc: 'Sa résistance diminue quand la température augmente (10 kΩ à 25 °C, B = 3950).' });
  add({ type: 'piezo', name: 'Buzzer piézo', group: BASE, kind: 'piezo', draw: 'piezo',
    desc: 'Émet un son avec tone() ou un signal carré.' });
  add({ type: 'servo', name: 'Servomoteur', group: BASE, kind: 'servo', draw: 'servo', pins3: true,
    desc: 'Fils : marron = GND, rouge = 5 V, orange = signal. Angle de 0 à 180°.' });
  add({ type: 'dcmotor', name: 'Moteur à courant continu', group: BASE, kind: 'dcmotor', draw: 'dcmotor',
    desc: 'Tourne d\'autant plus vite que la tension est grande. Une broche Arduino ne suffit pas (courant trop fort) !' });
  add({ type: 'hcsr04', name: 'Capteur ultrason HC-SR04', group: BASE, kind: 'hcsr04', draw: 'hcsr04',
    sim: { value: 50 }, desc: 'Broches VCC, Trig, Echo, GND. Mesure de 2 à 400 cm.' });

  /* ======================================================== Grove : boutons et détecteurs (tout-ou-rien) */
  const din = (type, name, o) => add(Object.assign({
    type: 'grove_' + type, name, group: G_IN, kind: 'din', conn: 'digital', draw: 'grove', blocks: ['din']
  }, o));
  din('button', 'Bouton', { icon: 'button', sim: { active: 1, mode: 'press', action: 'Appuyer' }, ask: 'est appuyé', ref: '101020003',
    desc: 'Renvoie HAUT (1) quand on appuie.' });
  din('button_p', 'Bouton (P)', { icon: 'button', sim: { active: 1, mode: 'press', action: 'Appuyer' }, ask: 'est appuyé', ref: '111020000' });
  din('led_button', 'Bouton lumineux (LED Button)', { icon: 'ledbutton', sim: { active: 0, mode: 'press', action: 'Appuyer' },
    ask: 'est appuyé', blocks: ['din', 'dout2'], ref: '111020044',
    desc: 'Signal jaune = bouton (BAS quand on appuie), signal blanc = LED.' });
  din('switch_p', 'Interrupteur (P)', { icon: 'switch', sim: { active: 1, mode: 'toggle', action: 'Basculer' }, ask: 'est fermé', ref: '101020004' });
  din('touch', 'Capteur tactile', { icon: 'touch', sim: { active: 1, mode: 'press', action: 'Toucher' }, ask: 'est touché', ref: '101020037',
    desc: 'Capteur capacitif TTP223 : HAUT quand on le touche.' });
  din('tilt', 'Capteur d\'inclinaison', { icon: 'tilt', sim: { active: 1, mode: 'toggle', action: 'Incliner' }, ask: 'est incliné', ref: '101020025' });
  din('collision', 'Capteur de collision', { icon: 'collision', sim: { active: 0, mode: 'press', action: 'Choc' }, ask: 'détecte un choc', ref: '101020069',
    desc: 'Renvoie BAS (0) lors d\'une collision.' });
  din('magnetic', 'Interrupteur magnétique (ILS)', { icon: 'magnet', sim: { active: 1, mode: 'toggle', action: 'Approcher l\'aimant' }, ask: 'détecte un aimant', ref: '101020038' });
  din('hall', 'Capteur à effet Hall', { icon: 'magnet', sim: { active: 0, mode: 'toggle', action: 'Approcher l\'aimant' }, ask: 'détecte un aimant', ref: '101020046',
    desc: 'Renvoie BAS (0) en présence d\'un champ magnétique.' });
  din('pir', 'Détecteur de mouvement PIR', { icon: 'pir', sim: { active: 1, mode: 'toggle', action: 'Mouvement' }, ask: 'détecte un mouvement', ref: '101020020' });
  din('mini_pir', 'Mini détecteur PIR', { icon: 'pir', sim: { active: 1, mode: 'toggle', action: 'Mouvement' }, ask: 'détecte un mouvement', ref: '101020353' });
  din('adj_pir', 'Détecteur PIR réglable', { icon: 'pir', sim: { active: 1, mode: 'toggle', action: 'Mouvement' }, ask: 'détecte un mouvement', ref: '101020617' });
  din('line_finder', 'Suiveur de ligne', { icon: 'ir', sim: { active: 1, mode: 'toggle', action: 'Ligne noire' }, ask: 'voit du noir', ref: '101020172',
    desc: 'Renvoie HAUT (1) au-dessus d\'une surface noire.' });
  din('ir_reflective', 'Capteur IR réfléchissant', { icon: 'ir', sim: { active: 0, mode: 'toggle', action: 'Objet proche' }, ask: 'détecte un objet', ref: '101020174',
    desc: 'Renvoie BAS (0) quand une surface claire réfléchit l\'infrarouge.' });
  din('ir_interrupter', 'Interrupteur IR de distance', { icon: 'ir', sim: { active: 0, mode: 'toggle', action: 'Obstacle' }, ask: 'détecte un obstacle', ref: '101020040' });
  din('vibration', 'Capteur de vibration (SW-420)', { icon: 'vibration', sim: { active: 1, mode: 'press', action: 'Secouer' }, ask: 'vibre', ref: '101020539' });
  din('flame', 'Capteur de flamme', { icon: 'flame', sim: { active: 0, mode: 'toggle', action: 'Flamme' }, ask: 'détecte une flamme', ref: '101020044',
    desc: 'Renvoie BAS (0) en présence d\'une flamme.' });
  din('water', 'Capteur d\'eau', { icon: 'water', sim: { active: 0, mode: 'toggle', action: 'Mouiller' }, ask: 'est mouillé', ref: '101020018',
    desc: 'Renvoie BAS (0) quand des gouttes relient les pistes.' });
  din('ear_heart', 'Capteur cardiaque (oreille)', { icon: 'heart', sim: { active: 1, mode: 'pulse', action: 'Pouls', bpm: 72 }, ask: 'détecte un battement', ref: '101020033',
    desc: 'Envoie une impulsion HAUT à chaque battement.' });
  din('doppler', 'Radar Doppler (BGT24LTR11)', { icon: 'pir', sim: { active: 1, mode: 'toggle', action: 'Mouvement' }, ask: 'détecte un mouvement', ref: '101020848' });
  din('tilt_ball', 'Capteur à bille', { icon: 'tilt', sim: { active: 1, mode: 'toggle', action: 'Incliner' }, ask: 'est incliné', ref: '101020025' });
  din('mech_keycap', 'Touche mécanique', { icon: 'button', sim: { active: 1, mode: 'press', action: 'Appuyer' }, ask: 'est appuyée', ref: '111020045' });
  din('digital_in', 'Entrée numérique générique', { icon: 'chip', sim: { active: 1, mode: 'toggle', action: 'Activer' }, ask: 'est actif',
    desc: 'Pour tout autre module Grove tout-ou-rien.' });

  /* ======================================================== Grove : capteurs analogiques */
  const ain = (type, name, o) => add(Object.assign({
    type: 'grove_' + type, name, group: G_AN, kind: 'ain', conn: 'analog', draw: 'grove', blocks: ['ain']
  }, o));
  ain('rotary', 'Potentiomètre rotatif', { icon: 'knob', sim: { min: 0, max: 300, unit: '°', value: 150, label: 'Angle' },
    blocks: ['ain', 'ain_angle'], ref: '101020017', desc: 'Angle de 0 à 300°, valeur 0 à 1023.' });
  ain('slide_pot', 'Potentiomètre à glissière', { icon: 'slider', sim: { min: 0, max: 100, unit: '%', value: 50, label: 'Position' }, ref: '101020036' });
  ain('light', 'Capteur de lumière', { icon: 'light', sim: { min: 0, max: 100, unit: '%', value: 50, label: 'Lumière' }, ref: '101020132',
    desc: 'Photorésistance : la valeur augmente avec la lumière.' });
  ain('sound', 'Capteur de son', { icon: 'sound', sim: { min: 0, max: 100, unit: '%', value: 20, label: 'Niveau sonore', noise: 0.15 }, ref: '101020023' });
  ain('loudness', 'Capteur de volume sonore', { icon: 'sound', sim: { min: 0, max: 100, unit: '%', value: 20, label: 'Niveau sonore' }, ref: '101020063' });
  ain('temperature', 'Capteur de température', { icon: 'thermo', sim: { min: -20, max: 80, unit: '°C', value: 22, label: 'Température', conv: 'thermistor' },
    blocks: ['ain', 'ain_temp'], ref: '101020015', desc: 'Thermistance (B = 4275). Bloc « température en °C » fourni.' });
  ain('moisture', 'Capteur d\'humidité du sol', { icon: 'moisture', sim: { min: 0, max: 100, unit: '%', value: 30, label: 'Humidité', maxRaw: 950 }, ref: '101020008' });
  ain('cap_moisture', 'Capteur d\'humidité capacitif', { icon: 'moisture', sim: { min: 0, max: 100, unit: '%', value: 30, label: 'Humidité', invert: true, maxRaw: 800 },
    ref: '101020614', desc: 'La valeur diminue quand le sol est humide.' });
  ain('uv', 'Capteur d\'UV', { icon: 'sun', sim: { min: 0, max: 11, unit: '(indice UV)', value: 3, label: 'Indice UV', maxRaw: 1023 }, ref: '101020043' });
  ain('mq2', 'Capteur de gaz MQ2 (fumée, butane)', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 10, label: 'Concentration' }, ref: '101020055' });
  ain('mq3', 'Capteur d\'alcool MQ3', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 10, label: 'Concentration' }, ref: '101020078' });
  ain('mq5', 'Capteur de gaz MQ5 (GPL, gaz naturel)', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 10, label: 'Concentration' }, ref: '101020056' });
  ain('mq9', 'Capteur de gaz MQ9 (CO, méthane)', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 10, label: 'Concentration' }, ref: '101020045' });
  ain('air_quality', 'Capteur de qualité de l\'air v1.3', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 15, label: 'Pollution' }, ref: '101020078' });
  ain('hcho', 'Capteur de formaldéhyde (HCHO)', { icon: 'gas', sim: { min: 0, max: 100, unit: '%', value: 5, label: 'Concentration' }, ref: '101020001' });
  ain('o2', 'Capteur d\'oxygène (O2)', { icon: 'gas', sim: { min: 0, max: 25, unit: '% O2', value: 21, label: 'Oxygène', maxRaw: 600 }, ref: '101020002' });
  ain('flex', 'Capteur de flexion', { icon: 'flex', sim: { min: 0, max: 90, unit: '°', value: 0, label: 'Flexion' }, ref: '101020051' });
  ain('force', 'Capteur de force (FSR)', { icon: 'force', sim: { min: 0, max: 100, unit: '%', value: 0, label: 'Pression' }, ref: '101020553' });
  ain('piezo_vib', 'Capteur piézo de vibration', { icon: 'vibration', sim: { min: 0, max: 100, unit: '%', value: 0, label: 'Vibration' }, ref: '101020031' });
  ain('gsr', 'Capteur GSR (conductance de la peau)', { icon: 'hand', sim: { min: 0, max: 100, unit: '%', value: 40, label: 'Conductance' }, ref: '101020052' });
  ain('emg', 'Capteur EMG (muscles)', { icon: 'hand', sim: { min: 0, max: 100, unit: '%', value: 20, label: 'Activité', noise: 0.1 }, ref: '101020058' });
  ain('electricity', 'Capteur de courant alternatif', { icon: 'bolt', sim: { min: 0, max: 5, unit: 'A', value: 1, label: 'Courant' }, ref: '101020004' });
  ain('voltage_div', 'Diviseur de tension', { icon: 'bolt', sim: { min: 0, max: 15, unit: 'V', value: 5, label: 'Tension mesurée', maxRaw: 1023 }, ref: '104020000' });
  ain('ph', 'Capteur de pH', { icon: 'water', sim: { min: 0, max: 14, unit: 'pH', value: 7, label: 'pH' }, ref: '101020669' });
  ain('tds', 'Capteur TDS (qualité de l\'eau)', { icon: 'water', sim: { min: 0, max: 1000, unit: 'ppm', value: 200, label: 'TDS', maxRaw: 900 }, ref: '101020753' });
  ain('turbidity', 'Capteur de turbidité', { icon: 'water', sim: { min: 0, max: 100, unit: '%', value: 10, label: 'Turbidité', invert: true }, ref: '101020752' });
  ain('ir_distance', 'Capteur de distance IR (Sharp 80 cm)', { icon: 'ir', sim: { min: 10, max: 80, unit: 'cm', value: 30, label: 'Distance', conv: 'sharp' }, ref: '101020042' });
  ain('water_level', 'Capteur de niveau d\'eau (analogique)', { icon: 'water', sim: { min: 0, max: 100, unit: '%', value: 50, label: 'Niveau' } });
  ain('analog_in', 'Entrée analogique générique', { icon: 'chip', sim: { min: 0, max: 1023, unit: '', value: 512, label: 'Valeur' },
    desc: 'Pour tout autre module Grove analogique (valeur brute 0-1023).' });
  add({ type: 'grove_joystick', name: 'Joystick (Thumb Joystick)', group: G_AN, kind: 'joystick', conn: 'analog', draw: 'grove', icon: 'joystick',
    blocks: ['joystick'], sim: { x: 512, y: 512 }, ref: '101020028', desc: 'Axe X sur la broche du port, axe Y sur la suivante. Appui = valeur 1023 sur X.' });

  /* ======================================================== Grove : capteurs numériques et I2C */
  add({ type: 'grove_ultrasonic', name: 'Capteur à ultrasons (Ultrasonic Ranger)', group: G_SENS, kind: 'ultrasonic', conn: 'digital',
    draw: 'grove', icon: 'ultrasonic', w: 2, blocks: ['ultrasonic'], sim: { value: 40, min: 2, max: 350, unit: 'cm', label: 'Distance' }, ref: '101020010' });
  add({ type: 'grove_dht11', name: 'Température et humidité DHT11 (bleu)', group: G_SENS, kind: 'dht', conn: 'digital', draw: 'grove', icon: 'dht',
    blocks: ['dht'], sim: { dhtType: 11, temp: 22, hum: 45 }, ref: '101020011' });
  add({ type: 'grove_dht22', name: 'Température et humidité DHT22 / AM2302 (blanc)', group: G_SENS, kind: 'dht', conn: 'digital', draw: 'grove', icon: 'dht',
    blocks: ['dht'], sim: { dhtType: 22, temp: 22, hum: 45 }, ref: '101020019' });
  add({ type: 'grove_dht20', name: 'Température et humidité DHT20 / AHT20 (I2C)', group: G_SENS, kind: 'thi2c', conn: 'i2c', draw: 'grove', icon: 'dht',
    blocks: ['thi2c'], sim: { model: 0, temp: 22, hum: 45 }, ref: '101020932' });
  add({ type: 'grove_sht31', name: 'Température et humidité SHT31 (I2C)', group: G_SENS, kind: 'thi2c', conn: 'i2c', draw: 'grove', icon: 'dht',
    blocks: ['thi2c'], sim: { model: 1, temp: 22, hum: 45 }, ref: '101020212' });
  add({ type: 'grove_bmp280', name: 'Baromètre BMP280 (I2C)', group: G_SENS, kind: 'baro', conn: 'i2c', draw: 'grove', icon: 'baro',
    blocks: ['baro'], sim: { temp: 21, pressure: 1013.25, hum: null }, ref: '101020192' });
  add({ type: 'grove_bme280', name: 'Capteur BME280 temp./humidité/pression (I2C)', group: G_SENS, kind: 'baro', conn: 'i2c', draw: 'grove', icon: 'baro',
    blocks: ['baro'], sim: { temp: 21, pressure: 1013.25, hum: 50 }, ref: '101020193' });
  add({ type: 'grove_adxl345', name: 'Accéléromètre 3 axes ADXL345 (I2C)', group: G_SENS, kind: 'accel', conn: 'i2c', draw: 'grove', icon: 'accel',
    blocks: ['accel'], sim: { x: 0, y: 0, z: 1 }, ref: '101020054' });
  add({ type: 'grove_lis3dhtr', name: 'Accéléromètre 3 axes LIS3DHTR (I2C)', group: G_SENS, kind: 'accel', conn: 'i2c', draw: 'grove', icon: 'accel',
    blocks: ['accel'], sim: { x: 0, y: 0, z: 1 }, ref: '101020583' });
  add({ type: 'grove_imu6', name: 'Centrale inertielle 6 axes LSM6DS3 (I2C)', group: G_SENS, kind: 'accel', conn: 'i2c', draw: 'grove', icon: 'accel',
    blocks: ['accel', 'gyro'], sim: { x: 0, y: 0, z: 1, gx: 0, gy: 0, gz: 0 }, ref: '105020012' });
  add({ type: 'grove_tsl2561', name: 'Capteur de lumière numérique TSL2561 (I2C)', group: G_SENS, kind: 'i2cval', conn: 'i2c', draw: 'grove', icon: 'light',
    blocks: ['lux'], sim: { value: 300, min: 0, max: 40000, unit: 'lux', label: 'Éclairement', sys: 'lightI2CRead' }, ref: '101020030' });
  add({ type: 'grove_tcs34725', name: 'Capteur de couleur TCS34725 (I2C)', group: G_SENS, kind: 'color', conn: 'i2c', draw: 'grove', icon: 'color',
    blocks: ['color'], sim: { r: 200, g: 50, b: 50 }, ref: '101020341' });
  add({ type: 'grove_mlx90615', name: 'Thermomètre infrarouge MLX90615 (I2C)', group: G_SENS, kind: 'irtemp', conn: 'i2c', draw: 'grove', icon: 'thermo',
    blocks: ['irtemp'], sim: { obj: 36.5, amb: 22 }, ref: '101020196' });
  add({ type: 'grove_finger_heart', name: 'Capteur cardiaque à pince (I2C)', group: G_SENS, kind: 'i2cval', conn: 'i2c', draw: 'grove', icon: 'heart',
    blocks: ['heart'], sim: { value: 72, min: 40, max: 180, unit: 'bpm', label: 'Pouls', sys: 'fingerHeartRead' }, ref: '103020024' });
  add({ type: 'grove_vl53l0x', name: 'Capteur de distance laser VL53L0X (I2C)', group: G_SENS, kind: 'i2cval', conn: 'i2c', draw: 'grove', icon: 'ultrasonic',
    blocks: ['tof'], sim: { value: 200, min: 30, max: 2000, unit: 'mm', label: 'Distance', sys: 'tofRead' }, ref: '101020532' });
  add({ type: 'grove_scd30', name: 'Capteur de CO2 SCD30 (I2C)', group: G_SENS, kind: 'co2', conn: 'i2c', draw: 'grove', icon: 'gas',
    blocks: ['co2'], sim: { co2: 450, temp: 22, hum: 45 }, ref: '101020634' });
  add({ type: 'grove_gesture', name: 'Capteur de gestes PAJ7620 (I2C)', group: G_SENS, kind: 'gesture', conn: 'i2c', draw: 'grove', icon: 'hand',
    blocks: ['gesture'], ref: '101020083' });
  add({ type: 'grove_rtc', name: 'Horloge temps réel DS1307 (I2C)', group: G_SENS, kind: 'rtc', conn: 'i2c', draw: 'grove', icon: 'clock',
    blocks: ['rtc'], ref: '101020013' });
  add({ type: 'grove_encoder', name: 'Encodeur rotatif', group: G_SENS, kind: 'encoder', conn: 'digital', draw: 'grove', icon: 'knob',
    blocks: ['encoder'], ref: '111020001' });
  add({ type: 'grove_ir_receiver', name: 'Récepteur infrarouge (télécommande)', group: G_SENS, kind: 'ir', conn: 'digital', draw: 'grove', icon: 'ir',
    blocks: ['ir'], ref: '101020016' });
  add({ type: 'grove_rfid', name: 'Lecteur RFID 125 kHz', group: G_SENS, kind: 'rfid', conn: 'uart', draw: 'grove', icon: 'rfid',
    blocks: ['rfid'], ref: '113020002' });
  add({ type: 'grove_keypad', name: 'Clavier 12 touches', group: G_SENS, kind: 'keypad', conn: 'uart', draw: 'grove', icon: 'keypad',
    blocks: ['keypad'], ref: '101020779' });

  /* ======================================================== Grove : sorties */
  const dout = (type, name, o) => add(Object.assign({
    type: 'grove_' + type, name, group: G_OUT, kind: 'dout', conn: 'digital', draw: 'grove', blocks: ['dout']
  }, o));
  for (const [col, label] of [['red', 'rouge'], ['green', 'verte'], ['blue', 'bleue'], ['yellow', 'jaune'], ['white', 'blanche'], ['purple', 'violette']]) {
    add({ type: 'grove_led_' + col, name: 'LED ' + label, group: G_OUT, kind: 'pwm', conn: 'digital', draw: 'grove', icon: 'led',
      props: { color: col }, blocks: ['dout', 'pwm'], verbs: ['allumer', 'éteindre'], ref: '104030005',
      desc: 'Module LED (avec sa résistance). Luminosité réglable sur une broche PWM (~).' });
  }
  add({ type: 'grove_buzzer', name: 'Buzzer', group: G_OUT, kind: 'buzzer', conn: 'digital', draw: 'grove', icon: 'buzzer',
    blocks: ['dout', 'tone', 'notone'], verbs: ['activer', 'arrêter'], ref: '107020000', desc: 'Sonne quand la broche est à HAUT, ou joue une note avec tone().' });
  add({ type: 'grove_speaker', name: 'Haut-parleur', group: G_OUT, kind: 'buzzer', conn: 'digital', draw: 'grove', icon: 'speaker',
    blocks: ['tone', 'notone'], ref: '107020001' });
  dout('relay', 'Relais', { icon: 'relay', verbs: ['fermer (activer)', 'ouvrir (désactiver)'], ref: '103020005', desc: 'Commande un circuit de puissance (lampe, moteur…).' });
  dout('relay_spdt', 'Relais SPDT 2 A', { icon: 'relay', verbs: ['activer', 'désactiver'], ref: '103020023' });
  dout('ssr', 'Relais statique (SSR)', { icon: 'relay', verbs: ['activer', 'désactiver'], ref: '103020004' });
  dout('vibrator', 'Moteur vibreur', { icon: 'vibration', verbs: ['activer', 'arrêter'], ref: '105020003' });
  dout('electromagnet', 'Électroaimant', { icon: 'magnet', verbs: ['activer', 'désactiver'], ref: '101020073' });
  dout('atomizer', 'Atomiseur d\'eau', { icon: 'water', verbs: ['activer', 'arrêter'], ref: '101020462' });
  dout('ir_emitter', 'Émetteur infrarouge', { icon: 'ir', verbs: ['activer', 'arrêter'], ref: '101020026' });
  dout('laser', 'Pointeur laser', { icon: 'laser', verbs: ['allumer', 'éteindre'], ref: '105020005' });
  dout('digital_out', 'Sortie numérique générique', { icon: 'chip', verbs: ['activer', 'désactiver'], desc: 'Pour tout autre module Grove à commander en tout-ou-rien.' });
  add({ type: 'grove_mosfet', name: 'MOSFET (commande de puissance)', group: G_OUT, kind: 'pwm', conn: 'digital', draw: 'grove', icon: 'chip',
    blocks: ['dout', 'pwm'], verbs: ['activer', 'désactiver'], ref: '103020008' });
  add({ type: 'grove_fan', name: 'Mini ventilateur', group: G_OUT, kind: 'pwm', conn: 'digital', draw: 'grove', icon: 'fan',
    blocks: ['dout', 'pwm'], verbs: ['démarrer', 'arrêter'], ref: '114990150' });
  add({ type: 'grove_servo', name: 'Servomoteur Grove', group: G_OUT, kind: 'servo', conn: 'digital', draw: 'grove', icon: 'servo',
    blocks: ['servo'], ref: '316010005' });
  add({ type: 'grove_motor_i2c', name: 'Pilote de moteurs I2C', group: G_OUT, kind: 'motor', conn: 'i2c', draw: 'grove', icon: 'motor', w: 2,
    blocks: ['motor'], ref: '105020093' });
  add({ type: 'grove_chainable_rgb', name: 'LED RGB chaînable (P9813)', group: G_OUT, kind: 'chain', conn: 'digital', draw: 'grove', icon: 'rgb',
    blocks: ['chain'], props: { count: 1 }, ref: '104020048' });
  add({ type: 'grove_rgb_stick', name: 'Barrette 10 LED RGB (WS2813)', group: G_OUT, kind: 'pixels', conn: 'digital', draw: 'pixels', icon: 'rgb',
    blocks: ['pixels'], props: { count: 10, shape: 'line' }, ref: '104020170' });
  add({ type: 'grove_rgb_ring16', name: 'Anneau 16 LED RGB (WS2813)', group: G_OUT, kind: 'pixels', conn: 'digital', draw: 'pixels', icon: 'rgb',
    blocks: ['pixels'], props: { count: 16, shape: 'ring' }, ref: '104020169' });
  add({ type: 'grove_rgb_ring24', name: 'Anneau 24 LED RGB (WS2813)', group: G_OUT, kind: 'pixels', conn: 'digital', draw: 'pixels', icon: 'rgb',
    blocks: ['pixels'], props: { count: 24, shape: 'ring' }, ref: '104020168' });
  add({ type: 'grove_rgb_strip30', name: 'Ruban 30 LED RGB (WS2812)', group: G_OUT, kind: 'pixels', conn: 'digital', draw: 'pixels', icon: 'rgb',
    blocks: ['pixels'], props: { count: 30, shape: 'line' }, ref: '104020107' });
  add({ type: 'grove_mp3', name: 'Lecteur MP3 v3', group: G_OUT, kind: 'mp3', conn: 'uart', draw: 'grove', icon: 'speaker',
    blocks: ['mp3'], ref: '107020069' });

  /* ======================================================== Grove : afficheurs */
  add({ type: 'grove_lcd_rgb', name: 'Écran LCD 16x2 rétroéclairé RGB', group: G_DISP, kind: 'lcd', conn: 'i2c', draw: 'lcd', icon: 'lcd',
    blocks: ['lcd_print', 'lcd_cursor', 'lcd_clear', 'lcd_rgb'], props: { rgb: true }, ref: '104030001' });
  add({ type: 'grove_lcd', name: 'Écran LCD 16x2 (blanc sur bleu)', group: G_DISP, kind: 'lcd', conn: 'i2c', draw: 'lcd', icon: 'lcd',
    blocks: ['lcd_print', 'lcd_cursor', 'lcd_clear'], props: { rgb: false }, ref: '104020111' });
  add({ type: 'grove_oled', name: 'Écran OLED 0,96" 128x64', group: G_DISP, kind: 'oled', conn: 'i2c', draw: 'oled', icon: 'oled',
    blocks: ['oled_print', 'oled_cursor', 'oled_clear'], ref: '104020208' });
  add({ type: 'grove_4digit', name: 'Afficheur 4 chiffres (TM1637)', group: G_DISP, kind: 'tm1637', conn: 'digital', draw: 'tm1637', icon: '4digit',
    blocks: ['tm_number', 'tm_digits', 'tm_colon', 'tm_bright', 'tm_clear'], ref: '104030003' });
  add({ type: 'grove_ledbar', name: 'Barre de 10 LED (MY9221)', group: G_DISP, kind: 'ledbar', conn: 'digital', draw: 'ledbar', icon: 'ledbar',
    blocks: ['ledbar'], ref: '104020006' });

  /* ======================================================== Grove : communication et divers */
  add({ type: 'grove_i2c_hub', name: 'Hub I2C (4 ports)', group: G_COM, kind: 'hub', conn: 'i2c', draw: 'grove', icon: 'hub',
    desc: 'Permet de brancher plusieurs modules I2C sur un même port (dans le simulateur, tous les ports I2C sont déjà reliés).' });
  add({ type: 'grove_bluetooth', name: 'Module Bluetooth (série)', group: G_COM, kind: 'none', conn: 'uart', draw: 'grove', icon: 'radio',
    desc: 'Non simulé : utilisez le moniteur série pour imiter la liaison.' });
  add({ type: 'grove_gps', name: 'GPS (série)', group: G_COM, kind: 'none', conn: 'uart', draw: 'grove', icon: 'radio', desc: 'Non simulé.' });
  add({ type: 'grove_lora', name: 'Module LoRa (série)', group: G_COM, kind: 'none', conn: 'uart', draw: 'grove', icon: 'radio', desc: 'Non simulé.' });
  add({ type: 'grove_wifi', name: 'Module Wi-Fi (série)', group: G_COM, kind: 'none', conn: 'uart', draw: 'grove', icon: 'radio', desc: 'Non simulé.' });

  const byType = {};
  C.forEach(c => { byType[c.type] = c; });
  const groups = [];
  C.forEach(c => { if (!groups.includes(c.group)) groups.push(c.group); });

  const CATALOG = { list: C, byType, groups };
  if (typeof module !== 'undefined' && module.exports) module.exports = CATALOG;
  else root.CATALOG = CATALOG;
})(this);
