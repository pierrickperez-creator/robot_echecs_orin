/*
 * Spécification de la machine virtuelle (VM) partagée par :
 *   - le simulateur (src/js/vm.js),
 *   - le micrologiciel téléversé sur la carte (firmware/, header généré par tools/gen_spec_h.js).
 *
 * Toute modification ici doit être suivie de : node tools/gen_spec_h.js && ./firmware/build.sh
 *
 * Format d'un programme (octets) :
 *   0  'V' 'M'          signature
 *   2  version           VMSPEC.VERSION
 *   3  nvars             nombre de variables globales
 *   4  setup  (u16 LE)   adresse du code « au démarrage »
 *   6  loop   (u16 LE)   adresse du code « répéter indéfiniment »
 *   8  len    (u16 LE)   longueur totale du programme
 *   10 board             identifiant de carte (BOARDS)
 *   11..15               réservé
 *   16 ...               code
 * Toutes les adresses sont relatives au début du programme.
 * Les valeurs manipulées sont des flottants 32 bits.
 */
(function (root) {
  const OP = {
    HALT: 0x00,
    PUSHF: 0x01,   // f32 LE
    PUSHB: 0x02,   // i8
    PUSHW: 0x03,   // i16 LE
    LOAD: 0x04,    // u8 n° de variable
    STORE: 0x05,   // u8
    POP: 0x06,
    DUP: 0x07,
    ADD: 0x10, SUB: 0x11, MUL: 0x12, DIV: 0x13, MOD: 0x14, NEG: 0x15, TRUNC: 0x16,
    EQ: 0x18, NE: 0x19, LT: 0x1A, LE: 0x1B, GT: 0x1C, GE: 0x1D,
    AND: 0x1E, OR: 0x1F, NOT: 0x20,
    JMP: 0x28,     // u16 adresse
    JZ: 0x29,      // u16
    JNZ: 0x2A,     // u16
    CALL: 0x2B,    // u16
    RET: 0x2C,     // retour sans valeur
    RETV: 0x2D,    // retour avec la valeur au sommet de pile
    MATH: 0x30,    // u8 n° de fonction (MATHFN)
    SYS: 0x40,     // u8 n° d'appel système (SYS)
    PRINTN: 0x41,  // u8 cible, u8 décimales ; dépile un nombre
    PRINTS: 0x42,  // u8 cible, u8 longueur, octets (Latin-1)
    PRINTNL: 0x43  // u8 cible : retour à la ligne
  };

  // Taille des opérandes de chaque opcode (hors PRINTS dont la taille est variable)
  const OPERANDS = {};
  for (const k in OP) OPERANDS[OP[k]] = 0;
  OPERANDS[OP.PUSHF] = 4; OPERANDS[OP.PUSHB] = 1; OPERANDS[OP.PUSHW] = 2;
  OPERANDS[OP.LOAD] = 1; OPERANDS[OP.STORE] = 1;
  OPERANDS[OP.JMP] = 2; OPERANDS[OP.JZ] = 2; OPERANDS[OP.JNZ] = 2; OPERANDS[OP.CALL] = 2;
  OPERANDS[OP.MATH] = 1; OPERANDS[OP.SYS] = 1;
  OPERANDS[OP.PRINTN] = 2; OPERANDS[OP.PRINTNL] = 1;

  // Fonctions mathématiques : [nom, nombre d'arguments]
  const MATHFN = [
    ['abs', 1], ['sqrt', 1], ['sin', 1], ['cos', 1], ['tan', 1],
    ['asin', 1], ['acos', 1], ['atan', 1], ['ln', 1], ['log10', 1],
    ['exp', 1], ['round', 1], ['floor', 1], ['ceil', 1],
    ['min', 2], ['max', 2], ['pow', 2], ['atan2', 2],
    ['constrain', 3], ['map', 5], ['random', 2]
  ];

  // Appels système : [nom, nb d'arguments, renvoie une valeur ?]
  // Le numéro est l'indice dans ce tableau (ne jamais réordonner : ajouter à la fin).
  const SYS = [
    ['nop', 0, 0],
    ['pinMode', 2, 0],          // broche, mode (0 INPUT, 1 OUTPUT, 2 INPUT_PULLUP)
    ['digitalWrite', 2, 0],
    ['digitalRead', 1, 1],
    ['analogRead', 1, 1],
    ['analogWrite', 2, 0],
    ['delay', 1, 0],
    ['delayMicroseconds', 1, 0],
    ['millis', 0, 1],
    ['micros', 0, 1],
    ['tone', 2, 0],             // broche, fréquence
    ['toneDur', 3, 0],          // broche, fréquence, durée ms
    ['noTone', 1, 0],
    ['pulseIn', 3, 1],          // broche, niveau, délai max µs
    ['serialBegin', 1, 0],
    ['serialAvailable', 0, 1],
    ['serialRead', 0, 1],
    ['randomSeed', 1, 0],
    ['servoWrite', 2, 0],       // broche, angle
    ['ultrasonicCm', 1, 1],     // broche (capteur Grove à 1 fil)
    ['dhtRead', 3, 1],          // broche, type (11/22), grandeur (0 temp, 1 hum)
    ['lcdClear', 0, 0],
    ['lcdSetCursor', 2, 0],     // colonne, ligne
    ['lcdRGB', 3, 0],
    ['oledClear', 0, 0],
    ['oledSetCursor', 2, 0],    // colonne 0-15, ligne 0-7
    ['tm1637Number', 2, 0],     // broche CLK (DIO = broche+1), nombre
    ['tm1637Clear', 1, 0],
    ['tm1637Brightness', 2, 0], // broche, 0-7
    ['ledBarLevel', 2, 0],      // broche DATA (CLK = broche+1), niveau 0-10
    ['chainRGB', 5, 0],         // broche CLK (DATA = broche+1), n°, r, g, b
    ['pixelSet', 5, 0],         // broche, n°, r, g, b
    ['pixelShow', 2, 0],        // broche, nombre de LED
    ['pixelFill', 5, 0],        // broche, nombre, r, g, b
    ['accelRead', 1, 1],        // axe 0 x / 1 y / 2 z (ADXL345 ou LIS3DHTR détecté)
    ['baroRead', 1, 1],         // 0 temp °C, 1 pression Pa, 2 altitude m, 3 humidité % (BME280)
    ['thI2CRead', 2, 1],        // modèle (0 DHT20/AHT20, 1 SHT31), grandeur (0 temp, 1 hum)
    ['rtcRead', 1, 1],          // 0 s,1 min,2 h,3 jour sem.,4 jour,5 mois,6 année
    ['rtcSet', 6, 0],           // h, min, s, jour, mois, année
    ['i2cWriteReg', 3, 0],      // adresse, registre, valeur
    ['i2cReadReg', 2, 1],       // adresse, registre
    ['lcdBacklight', 1, 0],     // 0/1 (LCD non RGB)
    ['tm1637Digits', 5, 0],     // broche, d0, d1, d2, d3 (-1 = vide)
    ['tm1637Colon', 2, 0],      // broche, 0/1
    ['lightI2CRead', 0, 1],     // capteur de lumière numérique TSL2561 (lux)
    ['colorRead', 1, 1],        // capteur couleur TCS34725 : 0 r,1 g,2 b,3 clair
    ['tofRead', 0, 1],          // distance VL53L0X (mm) — simulateur uniquement pour l'instant
    ['gyroRead', 1, 1],         // gyroscope (°/s) axe 0-2 (LSM6DS3/ITG3200)
    ['oledPixel', 3, 0],        // x, y, couleur (Mega uniquement sur carte)
    ['motorI2C', 2, 0],         // moteur (0/1), vitesse -255..255 (Grove I2C Motor Driver)
    ['stepperI2C', 1, 0],       // pas (Grove I2C Motor Driver)
    ['encoderRead', 1, 1],      // broche A (B = broche+1) : position
    ['irRead', 1, 1],           // broche : dernier code reçu (0 si aucun)
    ['mp3Play', 1, 0],          // n° de piste (lecteur MP3 Grove, UART logiciel D2/D3)
    ['mp3Volume', 1, 0],
    ['mp3Stop', 0, 0],
    ['gestureRead', 0, 1],      // capteur de gestes PAJ7620 : 0 aucun, 1 haut, 2 bas, 3 gauche, 4 droite, 5 avant, 6 arrière, 7 horaire, 8 anti-horaire
    ['fingerHeartRead', 0, 1],  // capteur cardiaque doigt (bpm)
    ['co2Read', 1, 1],          // SCD30 : 0 CO2 ppm, 1 temp, 2 hum
    ['irTempRead', 1, 1],       // MLX90615 : 0 objet, 1 ambiant
    ['rfidRead', 0, 1],         // lecteur RFID 125 kHz : dernier identifiant (0 aucun)
    ['keypadRead', 0, 1]        // clavier 12 touches : dernière touche (-1 aucune)
  ];

  const SYSID = {};
  SYS.forEach((s, i) => { SYSID[s[0]] = i; });
  const MATHID = {};
  MATHFN.forEach((m, i) => { MATHID[m[0]] = i; });

  const TARGET = { SERIAL: 0, LCD: 1, OLED: 2 };
  const BOARDS = { uno: 1, nano: 2, mega: 3 };

  const VMSPEC = {
    VERSION: 1, HEADER_SIZE: 16,
    OP, OPERANDS, MATHFN, MATHID, SYS, SYSID, TARGET, BOARDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = VMSPEC;
  else root.VMSPEC = VMSPEC;
})(this);
