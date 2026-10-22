/*
 * Appels système de la VM : entrées/sorties Arduino et pilotes des modules Grove.
 * Chaque « case SYS_xxx » ci-dessous est détecté par firmware/build.sh pour savoir
 * quels appels sont réellement disponibles sur la carte (les autres renvoient 0).
 */
#include <Arduino.h>
#include <Wire.h>
#include <avr/pgmspace.h>
#include "vm_spec.h"
#include "drivers.h"
#include "font5x7.h"

// FULL_DRIVERS = 0 retire les pilotes I2C les moins courants si la mémoire venait à manquer
#ifndef FULL_DRIVERS
#define FULL_DRIVERS 1
#endif
#if defined(__AVR_ATmega2560__)
#define PIXEL_MAX 120
#else
#define PIXEL_MAX 30
#endif

/* ------------------------------------------------------------------ I2C */
static bool wireOn = false;
static void wireBegin() {
  if (!wireOn) { Wire.begin(); wireOn = true; }
}
static bool i2cPresent(uint8_t addr) {
  wireBegin();
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}
static void i2cWrite8(uint8_t addr, uint8_t reg, uint8_t v) {
  wireBegin();
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(v);
  Wire.endTransmission();
}
static uint8_t i2cReadBytes(uint8_t addr, uint8_t reg, uint8_t *buf, uint8_t n) {
  wireBegin();
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0;
  uint8_t got = Wire.requestFrom(addr, n);
  for (uint8_t i = 0; i < got && i < n; i++) buf[i] = Wire.read();
  return got;
}
static uint8_t i2cRead8(uint8_t addr, uint8_t reg) {
  uint8_t v = 0;
  i2cReadBytes(addr, reg, &v, 1);
  return v;
}

/* ------------------------------------------------------------------ Servo (Timer1) */
#define SERVO_MAX 8
struct ServoCh { uint8_t pin; volatile uint8_t *port; uint8_t mask; uint16_t ticks; };
static ServoCh servos[SERVO_MAX];
static uint8_t nServos = 0;
static volatile int8_t curServo = -1;

ISR(TIMER1_COMPA_vect) {
  if (curServo >= 0 && curServo < nServos) *servos[curServo].port &= ~servos[curServo].mask;
  else TCNT1 = 0;
  curServo++;
  if (curServo < nServos) {
    OCR1A = TCNT1 + servos[curServo].ticks;
    *servos[curServo].port |= servos[curServo].mask;
  } else {
    if ((uint16_t)(TCNT1 + 8) < 40000u) OCR1A = 40000u;
    else OCR1A = TCNT1 + 8;
    curServo = -1;
  }
}

static void servoWrite(uint8_t pin, float angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  uint16_t us = 544 + (uint16_t)(angle * (2400 - 544) / 180.0f);
  int8_t idx = -1;
  for (uint8_t i = 0; i < nServos; i++) if (servos[i].pin == pin) idx = i;
  if (idx < 0) {
    if (nServos >= SERVO_MAX) return;
    idx = nServos;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    servos[idx].pin = pin;
    servos[idx].port = portOutputRegister(digitalPinToPort(pin));
    servos[idx].mask = digitalPinToBitMask(pin);
    servos[idx].ticks = us * 2;
    uint8_t s = SREG; cli();
    nServos++;
    if (nServos == 1) {
      TCCR1A = 0;
      TCCR1B = _BV(CS11);  // prédiviseur 8 : 0,5 µs par tic
      TCNT1 = 0;
      OCR1A = 100;
      TIFR1 |= _BV(OCF1A);
      TIMSK1 |= _BV(OCIE1A);
    }
    SREG = s;
    return;
  }
  uint8_t s = SREG; cli();
  servos[idx].ticks = us * 2;
  SREG = s;
}

/* ------------------------------------------------------------------ Ultrason Grove (1 fil) */
static long ultrasonicCm(uint8_t pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(2);
  digitalWrite(pin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pin, LOW);
  pinMode(pin, INPUT);
  long d = pulseIn(pin, HIGH, 30000UL);
  return d / 29 / 2;
}

/* ------------------------------------------------------------------ DHT11 / DHT22 */
static uint8_t dhtPin = 255;
static unsigned long dhtLast = 0;
static float dhtT = 0, dhtH = 0;

static uint16_t dhtPulse(volatile uint8_t *in, uint8_t mask, uint8_t level) {
  uint16_t n = 0;
  uint8_t want = level ? mask : 0;
  while ((*in & mask) == want) {
    if (++n >= 4000) return 0xFFFF;
  }
  return n;
}

static void dhtRead(uint8_t pin, uint8_t type) {
  if (pin == dhtPin && dhtLast != 0 && millis() - dhtLast < 2000) return;
  uint8_t d[5] = {0, 0, 0, 0, 0};
  volatile uint8_t *in = portInputRegister(digitalPinToPort(pin));
  uint8_t mask = digitalPinToBitMask(pin);
  pinMode(pin, INPUT_PULLUP);
  delay(1);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  if (type == 11) delay(20); else delayMicroseconds(1100);
  bool ok = true;
  uint8_t s = SREG;
  cli();
  pinMode(pin, INPUT_PULLUP);
  delayMicroseconds(55);
  if (dhtPulse(in, mask, 0) == 0xFFFF || dhtPulse(in, mask, 1) == 0xFFFF) ok = false;
  for (uint8_t i = 0; ok && i < 40; i++) {
    uint16_t lo = dhtPulse(in, mask, 0);
    uint16_t hi = dhtPulse(in, mask, 1);
    if (lo == 0xFFFF || hi == 0xFFFF) { ok = false; break; }
    d[i / 8] <<= 1;
    if (hi > lo) d[i / 8] |= 1;
  }
  SREG = s;
  dhtPin = pin;
  dhtLast = millis() | 1;
  if (!ok || d[4] != (uint8_t)(d[0] + d[1] + d[2] + d[3])) return;  // garde la dernière mesure
  if (type == 11) {
    dhtH = d[0] + d[1] * 0.1f;
    dhtT = (d[2] & 0x7F) + (d[3] & 0x0F) * 0.1f;
    if (d[2] & 0x80) dhtT = -dhtT;
  } else {
    dhtH = (((uint16_t)d[0] << 8) | d[1]) * 0.1f;
    dhtT = ((((uint16_t)d[2] & 0x7F) << 8) | d[3]) * 0.1f;
    if (d[2] & 0x80) dhtT = -dhtT;
  }
}

/* ------------------------------------------------------------------ LCD Grove (RGB ou non) */
#define LCD_ADDR 0x3E
static bool lcdOn = false;
static uint8_t rgbAddr = 0;  // 0x62 (v4), 0x30 (v5) ou 0
static uint8_t lcdCol = 0, lcdRow = 0;

static void lcdCmd(uint8_t v) {
  Wire.beginTransmission(LCD_ADDR);
  Wire.write(0x80);
  Wire.write(v);
  Wire.endTransmission();
}
static void lcdData(uint8_t v) {
  Wire.beginTransmission(LCD_ADDR);
  Wire.write(0x40);
  Wire.write(v);
  Wire.endTransmission();
}
static void lcdRGB(uint8_t r, uint8_t g, uint8_t b);
static void lcdInit() {
  if (lcdOn) return;
  lcdOn = true;
  wireBegin();
  delay(50);
  lcdCmd(0x28); delayMicroseconds(4500);
  lcdCmd(0x28); delayMicroseconds(150);
  lcdCmd(0x28);
  lcdCmd(0x28);
  lcdCmd(0x0C);
  lcdCmd(0x01); delayMicroseconds(2000);
  lcdCmd(0x06);
  if (i2cPresent(0x62)) {
    rgbAddr = 0x62;
    i2cWrite8(rgbAddr, 0x00, 0x00);
    i2cWrite8(rgbAddr, 0x08, 0xFF);
    i2cWrite8(rgbAddr, 0x01, 0x20);
  } else if (i2cPresent(0x30)) {
    rgbAddr = 0x30;
    i2cWrite8(rgbAddr, 0x00, 0x07);
    delayMicroseconds(200);
    i2cWrite8(rgbAddr, 0x04, 0x15);
  }
  lcdRGB(255, 255, 255);
}
static void lcdRGB(uint8_t r, uint8_t g, uint8_t b) {
  if (rgbAddr == 0x62) {
    i2cWrite8(rgbAddr, 0x04, r); i2cWrite8(rgbAddr, 0x03, g); i2cWrite8(rgbAddr, 0x02, b);
  } else if (rgbAddr == 0x30) {
    i2cWrite8(rgbAddr, 0x06, r); i2cWrite8(rgbAddr, 0x07, g); i2cWrite8(rgbAddr, 0x08, b);
  }
}
static void lcdSetCursor(uint8_t col, uint8_t row) {
  lcdInit();
  lcdCol = col; lcdRow = row & 1;
  lcdCmd((lcdRow == 0 ? 0x80 : 0xC0) | (col & 0x3F));
}
class LcdPrint : public Print {
 public:
  size_t write(uint8_t c) {
    lcdInit();
    if (c == '\r' || c == '\n') return 1;
    if (c == 0xB0) c = 0xDF;  // symbole degré du HD44780
    lcdData(c);
    lcdCol++;
    return 1;
  }
};
static LcdPrint lcdOut;

/* ------------------------------------------------------------------ OLED SSD1306/SSD1315 128x64 (texte 16x8) */
#define OLED_ADDR 0x3C
static bool oledOn = false;
static uint8_t oledCol = 0, oledRow = 0;
static void oledCmd(uint8_t c) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}
static const uint8_t OLED_INIT[] PROGMEM = {
  0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0x8D, 0x14, 0x20, 0x02,
  0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF
};
static void oledPos(uint8_t col, uint8_t row) {
  oledCol = col & 15; oledRow = row & 7;
  uint8_t x = oledCol * 8;
  oledCmd(0xB0 | oledRow);
  oledCmd(0x00 | (x & 0x0F));
  oledCmd(0x10 | (x >> 4));
}
static void oledClear();
static void oledInit() {
  if (oledOn) return;
  oledOn = true;
  wireBegin();
  for (uint8_t i = 0; i < sizeof(OLED_INIT); i++) oledCmd(pgm_read_byte(OLED_INIT + i));
  oledClear();
}
static void oledClear() {
  oledInit();
  for (uint8_t p = 0; p < 8; p++) {
    oledPos(0, p);
    for (uint8_t k = 0; k < 8; k++) {
      Wire.beginTransmission(OLED_ADDR);
      Wire.write(0x40);
      for (uint8_t i = 0; i < 16; i++) Wire.write(0);
      Wire.endTransmission();
    }
  }
  oledPos(0, 0);
}
class OledPrint : public Print {
 public:
  size_t write(uint8_t c) {
    oledInit();
    if (c == '\r' || c == '\n') return 1;
    uint8_t idx;
    if (c == 0xB0) idx = 95;
    else if (c >= 32 && c <= 126) idx = c - 32;
    else idx = '?' - 32;
    if (oledCol > 15) oledPos(0, oledRow + 1);
    Wire.beginTransmission(OLED_ADDR);
    Wire.write(0x40);
    Wire.write(0);
    for (uint8_t i = 0; i < 5; i++) Wire.write(pgm_read_byte(FONT5X7 + idx * 5 + i));
    Wire.write(0);
    Wire.write(0);
    Wire.endTransmission();
    oledCol++;
    return 1;
  }
};
static OledPrint oledOut;

Print &printTarget(uint8_t t) {
  if (t == TGT_LCD) return lcdOut;
  if (t == TGT_OLED) return oledOut;
  ensureSerial();
  return Serial;
}
void printNewline(uint8_t t) {
  if (t == TGT_LCD) lcdSetCursor(0, lcdRow + 1);
  else if (t == TGT_OLED) { oledInit(); oledPos(0, oledRow + 1); }
}

/* ------------------------------------------------------------------ Afficheur 4 chiffres TM1637 */
static const uint8_t SEG[] PROGMEM = {0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f};
static uint8_t tmBright = 2;
static bool tmColon = false;
static uint8_t tmSegs[4];
static void tmBit(uint8_t clk, uint8_t dio, uint8_t b) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(clk, LOW);
    digitalWrite(dio, b & 1);
    b >>= 1;
    delayMicroseconds(3);
    digitalWrite(clk, HIGH);
    delayMicroseconds(3);
  }
  digitalWrite(clk, LOW);
  pinMode(dio, INPUT_PULLUP);
  delayMicroseconds(3);
  digitalWrite(clk, HIGH);
  delayMicroseconds(3);
  digitalWrite(clk, LOW);
  pinMode(dio, OUTPUT);
}
static void tmStart(uint8_t clk, uint8_t dio) {
  digitalWrite(clk, HIGH); digitalWrite(dio, HIGH); delayMicroseconds(3);
  digitalWrite(dio, LOW); delayMicroseconds(3); digitalWrite(clk, LOW);
}
static void tmStop(uint8_t clk, uint8_t dio) {
  digitalWrite(clk, LOW); digitalWrite(dio, LOW); delayMicroseconds(3);
  digitalWrite(clk, HIGH); delayMicroseconds(3); digitalWrite(dio, HIGH);
}
static void tmShow(uint8_t clk) {
  uint8_t dio = clk + 1;
  pinMode(clk, OUTPUT); pinMode(dio, OUTPUT);
  tmStart(clk, dio); tmBit(clk, dio, 0x40); tmStop(clk, dio);
  tmStart(clk, dio); tmBit(clk, dio, 0xC0);
  for (uint8_t i = 0; i < 4; i++) tmBit(clk, dio, tmSegs[i] | (i == 1 && tmColon ? 0x80 : 0));
  tmStop(clk, dio);
  tmStart(clk, dio); tmBit(clk, dio, 0x88 | (tmBright & 7)); tmStop(clk, dio);
}
static void tmNumber(uint8_t clk, long n) {
  if (n > 9999) n = 9999;
  if (n < -999) n = -999;
  bool neg = n < 0;
  if (neg) n = -n;
  for (int8_t i = 3; i >= 0; i--) {
    if (n == 0 && i < 3) tmSegs[i] = 0;
    else { tmSegs[i] = pgm_read_byte(SEG + n % 10); n /= 10; }
  }
  if (neg) for (int8_t i = 3; i >= 0; i--) if (tmSegs[i] == 0) { tmSegs[i] = 0x40; break; }
  tmShow(clk);
}

/* ------------------------------------------------------------------ Barre de LED MY9221 */
static void barSend(uint8_t data, uint8_t clk, uint16_t bits, uint8_t &cs) {
  for (uint8_t i = 0; i < 16; i++) {
    digitalWrite(data, (bits & 0x8000) ? HIGH : LOW);
    cs ^= 1;
    digitalWrite(clk, cs);
    bits <<= 1;
  }
}
static void barLevel(uint8_t data, float level) {
  uint8_t clk = data + 1;
  pinMode(data, OUTPUT); pinMode(clk, OUTPUT);
  uint8_t cs = 0;
  digitalWrite(clk, LOW);
  barSend(data, clk, 0x0000, cs);
  for (uint8_t i = 0; i < 10; i++) {
    float v = level - (9 - i);  // la LED n°10 (rouge) est la première envoyée
    barSend(data, clk, v >= 1 ? 0xFF : (v > 0 ? 0x80 : 0x00), cs);
  }
  barSend(data, clk, 0, cs);
  barSend(data, clk, 0, cs);
  digitalWrite(data, LOW);
  delayMicroseconds(10);
  for (uint8_t i = 0; i < 4; i++) { digitalWrite(data, HIGH); digitalWrite(data, LOW); }
}

/* ------------------------------------------------------------------ LED RGB chaînables P9813 */
#define CHAIN_MAX 10
static uint8_t chain[CHAIN_MAX][3];
static uint8_t chainN = 0;
static void chainByte(uint8_t clk, uint8_t data, uint8_t b) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(data, (b & 0x80) ? HIGH : LOW);
    digitalWrite(clk, LOW); delayMicroseconds(20);
    digitalWrite(clk, HIGH); delayMicroseconds(20);
    b <<= 1;
  }
}
static void chainSet(uint8_t clk, uint8_t idx, uint8_t r, uint8_t g, uint8_t b) {
  if (idx >= CHAIN_MAX) return;
  uint8_t data = clk + 1;
  pinMode(clk, OUTPUT); pinMode(data, OUTPUT);
  chain[idx][0] = r; chain[idx][1] = g; chain[idx][2] = b;
  if (idx + 1 > chainN) chainN = idx + 1;
  for (uint8_t i = 0; i < 4; i++) chainByte(clk, data, 0);
  for (uint8_t i = 0; i < chainN; i++) {
    uint8_t R = chain[i][0], G = chain[i][1], B = chain[i][2];
    uint8_t p = 0xC0;
    if (!(B & 0x80)) p |= 0x20;
    if (!(B & 0x40)) p |= 0x10;
    if (!(G & 0x80)) p |= 0x08;
    if (!(G & 0x40)) p |= 0x04;
    if (!(R & 0x80)) p |= 0x02;
    if (!(R & 0x40)) p |= 0x01;
    chainByte(clk, data, p);
    chainByte(clk, data, B);
    chainByte(clk, data, G);
    chainByte(clk, data, R);
  }
  for (uint8_t i = 0; i < 4; i++) chainByte(clk, data, 0);
}

/* ------------------------------------------------------------------ LED adressables WS2812 (16 MHz) */
static uint8_t pixels[PIXEL_MAX * 3];
static uint8_t pixPin = 255;
static uint8_t pixCount = 0;

static void pixelShow(uint8_t pin, uint8_t count) {
  if (count > PIXEL_MAX) count = PIXEL_MAX;
  if (count == 0) return;
  pinMode(pin, OUTPUT);
  volatile uint8_t *port = portOutputRegister(digitalPinToPort(pin));
  uint8_t pinMask = digitalPinToBitMask(pin);
  uint16_t i = count * 3;
  uint8_t *ptr = pixels;
  uint8_t b = *ptr++, hi, lo, next, bit = 8;
  uint8_t s = SREG;
  cli();
  hi = *port | pinMask;
  lo = *port & ~pinMask;
  next = lo;
  asm volatile(
      "head20:"                   "\n\t"
      "st   %a[port],  %[hi]"     "\n\t"
      "sbrc %[byte],  7"          "\n\t"
      "mov  %[next], %[hi]"       "\n\t"
      "dec  %[bit]"               "\n\t"
      "st   %a[port],  %[next]"   "\n\t"
      "mov  %[next] ,  %[lo]"     "\n\t"
      "breq nextbyte20"           "\n\t"
      "rol  %[byte]"              "\n\t"
      "rjmp .+0"                  "\n\t"
      "nop"                       "\n\t"
      "st   %a[port],  %[lo]"     "\n\t"
      "nop"                       "\n\t"
      "rjmp .+0"                  "\n\t"
      "rjmp head20"               "\n\t"
      "nextbyte20:"               "\n\t"
      "ldi  %[bit]  ,  8"         "\n\t"
      "ld   %[byte] ,  %a[ptr]+"  "\n\t"
      "st   %a[port], %[lo]"      "\n\t"
      "nop"                       "\n\t"
      "sbiw %[count], 1"          "\n\t"
      "brne head20"               "\n"
      : [port] "+e"(port), [byte] "+r"(b), [bit] "+r"(bit), [next] "+r"(next), [count] "+w"(i), [ptr] "+e"(ptr)
      : [hi] "r"(hi), [lo] "r"(lo));
  SREG = s;
  delayMicroseconds(60);
}
static void pixelSet(uint8_t pin, uint8_t idx, uint8_t r, uint8_t g, uint8_t b) {
  if (pin != pixPin) { memset(pixels, 0, sizeof(pixels)); pixPin = pin; pixCount = 0; }
  if (idx >= PIXEL_MAX) return;
  pixels[idx * 3] = g; pixels[idx * 3 + 1] = r; pixels[idx * 3 + 2] = b;
  if (idx + 1 > pixCount) pixCount = idx + 1;
}

/* ------------------------------------------------------------------ Accéléromètre ADXL345 / LIS3DHTR / LSM6DS3 (+ gyroscope) */
static uint8_t accelType = 0;  // 1 ADXL345, 2 LIS3DHTR, 3 LSM6DS3, 0xFF absent
static uint8_t accAddr = 0x19;
static void accelProbe() {
  if (accelType) return;
  accelType = 0xFF;
  if (i2cPresent(0x53) && i2cRead8(0x53, 0x00) == 0xE5) {
    accelType = 1;
    accAddr = 0x53;
    i2cWrite8(0x53, 0x31, 0x0B);  // pleine résolution ±16 g
    i2cWrite8(0x53, 0x2D, 0x08);  // mesure
  } else {
    for (uint8_t a = 0x18; a <= 0x19; a++)
      if (i2cPresent(a) && i2cRead8(a, 0x0F) == 0x33) { accAddr = a; accelType = 2; }
    for (uint8_t a = 0x6A; a <= 0x6B; a++) {
      uint8_t id = i2cPresent(a) ? i2cRead8(a, 0x0F) : 0;
      if (id == 0x69 || id == 0x6A) { accAddr = a; accelType = 3; }
    }
    if (accelType == 2) {
      i2cWrite8(accAddr, 0x20, 0x57);  // 100 Hz, 3 axes
      i2cWrite8(accAddr, 0x23, 0x08);  // haute résolution ±2 g
    } else if (accelType == 3) {
      i2cWrite8(accAddr, 0x10, 0x40);  // accéléromètre 104 Hz ±2 g
      i2cWrite8(accAddr, 0x11, 0x4C);  // gyroscope 104 Hz 2000 °/s
    }
  }
  delay(10);
}
static int16_t accRaw(uint8_t reg, uint8_t axis) {
  uint8_t d[2];
  if (i2cReadBytes(accAddr, reg + axis * 2, d, 2) != 2) return 0;
  return (int16_t)(d[0] | (d[1] << 8));
}
static float accelRead(uint8_t axis) {
  accelProbe();
  if (accelType == 1) return accRaw(0x32, axis) * 0.0039f;
  if (accelType == 2) return (accRaw(0x28 | 0x80, axis) >> 4) * 0.001f;
  if (accelType == 3) return accRaw(0x28, axis) * 0.000061f;
  return 0;
}
static float gyroRead(uint8_t axis) {
  accelProbe();
  if (accelType == 3) return accRaw(0x22, axis) * 0.07f;
  return 0;
}

/* ------------------------------------------------------------------ Baromètre BMP280 / BME280 */
static uint8_t baroAddr = 0;  // 0 inconnu, 0xFF absent
static bool baroHum = false;
static uint16_t T1, P1;
static int16_t T2, T3, P2, P3, P4, P5, P6, P7, P8, P9, H2, H4, H5;
static uint8_t H1, H3;
static int8_t H6;
static float baroRead(uint8_t what) {
  if (baroAddr == 0) {
    baroAddr = 0xFF;
    for (uint8_t a = 0x77; a >= 0x76; a--) {
      if (!i2cPresent(a)) continue;
      uint8_t id = i2cRead8(a, 0xD0);
      if (id == 0x58 || id == 0x60) { baroAddr = a; baroHum = (id == 0x60); break; }
    }
    if (baroAddr == 0xFF) return 0;
    uint8_t c[24];
    i2cReadBytes(baroAddr, 0x88, c, 24);
    T1 = c[0] | (c[1] << 8); T2 = c[2] | (c[3] << 8); T3 = c[4] | (c[5] << 8);
    P1 = c[6] | (c[7] << 8); P2 = c[8] | (c[9] << 8); P3 = c[10] | (c[11] << 8);
    P4 = c[12] | (c[13] << 8); P5 = c[14] | (c[15] << 8); P6 = c[16] | (c[17] << 8);
    P7 = c[18] | (c[19] << 8); P8 = c[20] | (c[21] << 8); P9 = c[22] | (c[23] << 8);
    if (baroHum) {
      H1 = i2cRead8(baroAddr, 0xA1);
      uint8_t h[7];
      i2cReadBytes(baroAddr, 0xE1, h, 7);
      H2 = h[0] | (h[1] << 8); H3 = h[2];
      H4 = ((int16_t)(int8_t)h[3] << 4) | (h[4] & 0x0F);
      H5 = ((int16_t)(int8_t)h[5] << 4) | (h[4] >> 4);
      H6 = (int8_t)h[6];
      i2cWrite8(baroAddr, 0xF2, 0x01);
    }
    i2cWrite8(baroAddr, 0xF5, 0xA0);
    i2cWrite8(baroAddr, 0xF4, 0x27);
    delay(20);
  }
  if (baroAddr == 0xFF) return 0;
  uint8_t d[8];
  i2cReadBytes(baroAddr, 0xF7, d, 8);
  int32_t adcP = ((uint32_t)d[0] << 12) | ((uint32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adcT = ((uint32_t)d[3] << 12) | ((uint32_t)d[4] << 4) | (d[5] >> 4);
  int32_t adcH = ((uint32_t)d[6] << 8) | d[7];
  float v1 = (adcT / 16384.0f - T1 / 1024.0f) * T2;
  float v2 = (adcT / 131072.0f - T1 / 8192.0f);
  v2 = v2 * v2 * T3;
  float tFine = v1 + v2;
  if (what == 0) return tFine / 5120.0f;
  if (what == 3) {
    if (!baroHum) return 0;
    float h = tFine - 76800.0f;
    h = (adcH - (H4 * 64.0f + H5 / 16384.0f * h)) *
        (H2 / 65536.0f * (1.0f + H6 / 67108864.0f * h * (1.0f + H3 / 67108864.0f * h)));
    h = h * (1.0f - H1 * h / 524288.0f);
    return h < 0 ? 0 : (h > 100 ? 100 : h);
  }
  v1 = tFine / 2.0f - 64000.0f;
  v2 = v1 * v1 * P6 / 32768.0f;
  v2 = v2 + v1 * P5 * 2.0f;
  v2 = v2 / 4.0f + P4 * 65536.0f;
  v1 = (P3 * v1 * v1 / 524288.0f + P2 * v1) / 524288.0f;
  v1 = (1.0f + v1 / 32768.0f) * P1;
  if (v1 == 0) return 0;
  float p = 1048576.0f - adcP;
  p = (p - v2 / 4096.0f) * 6250.0f / v1;
  v1 = P9 * p * p / 2147483648.0f;
  v2 = p * P8 / 32768.0f;
  p = p + (v1 + v2 + P7) / 16.0f;
  if (what == 1) return p;
  return 44330.0f * (1.0f - pow(p / 101325.0f, 0.1903f));
}

/* ------------------------------------------------------------------ Température/humidité I2C : DHT20 (AHT20) et SHT31 */
static unsigned long thLast = 0;
static uint8_t thModel = 255;
static float thT = 0, thH = 0;
static float thI2CRead(uint8_t model, uint8_t what) {
  if (model != thModel || thLast == 0 || millis() - thLast > 500) {
    uint8_t d[7];
    wireBegin();
    if (model == 0) {
      Wire.beginTransmission(0x38);
      Wire.write(0xAC); Wire.write(0x33); Wire.write(0x00);
      Wire.endTransmission();
      delay(80);
      if (Wire.requestFrom((uint8_t)0x38, (uint8_t)7) == 7) {
        for (uint8_t i = 0; i < 7; i++) d[i] = Wire.read();
        uint32_t h = ((uint32_t)d[1] << 12) | ((uint32_t)d[2] << 4) | (d[3] >> 4);
        uint32_t t = (((uint32_t)d[3] & 0x0F) << 16) | ((uint32_t)d[4] << 8) | d[5];
        thH = h * 100.0f / 1048576.0f;
        thT = t * 200.0f / 1048576.0f - 50.0f;
      }
    } else {
      Wire.beginTransmission(0x44);
      Wire.write(0x24); Wire.write(0x00);
      Wire.endTransmission();
      delay(16);
      if (Wire.requestFrom((uint8_t)0x44, (uint8_t)6) == 6) {
        for (uint8_t i = 0; i < 6; i++) d[i] = Wire.read();
        thT = -45.0f + 175.0f * (((uint16_t)d[0] << 8) | d[1]) / 65535.0f;
        thH = 100.0f * (((uint16_t)d[3] << 8) | d[4]) / 65535.0f;
      }
    }
    thModel = model;
    thLast = millis() | 1;
  }
  return what == 0 ? thT : thH;
}

/* ------------------------------------------------------------------ Horloge RTC DS1307 */
static uint8_t bcd(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }
static uint8_t tobcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }
static float rtcRead(uint8_t field) {
  uint8_t d[7];
  if (i2cReadBytes(0x68, 0x00, d, 7) != 7) return 0;
  switch (field) {
    case 0: return bcd(d[0] & 0x7F);
    case 1: return bcd(d[1]);
    case 2: return bcd(d[2] & 0x3F);
    case 3: return bcd(d[3]);
    case 4: return bcd(d[4]);
    case 5: return bcd(d[5]);
    default: return 2000 + bcd(d[6]);
  }
}
static void rtcSet(float *a) {
  wireBegin();
  Wire.beginTransmission(0x68);
  Wire.write(0x00);
  Wire.write(tobcd((uint8_t)a[2]));
  Wire.write(tobcd((uint8_t)a[1]));
  Wire.write(tobcd((uint8_t)a[0]));
  Wire.write(1);
  Wire.write(tobcd((uint8_t)a[3]));
  Wire.write(tobcd((uint8_t)a[4]));
  Wire.write(tobcd((uint8_t)((int)a[5] % 100)));
  Wire.endTransmission();
}

#if FULL_DRIVERS
/* ------------------------------------------------------------------ Lumière numérique TSL2561 */
static bool tslOn = false;
static float tslLux() {
  if (!tslOn) {
    tslOn = true;
    i2cWrite8(0x29, 0x80, 0x03);  // mise sous tension
    i2cWrite8(0x29, 0x81, 0x12);  // gain 16x, 402 ms
    delay(410);
  }
  uint8_t a[2], b[2];
  i2cReadBytes(0x29, 0xAC, a, 2);
  i2cReadBytes(0x29, 0xAE, b, 2);
  float ch0 = a[0] | (a[1] << 8), ch1 = b[0] | (b[1] << 8);
  if (ch0 == 0) return 0;
  float r = ch1 / ch0;
  if (r <= 0.5f) return 0.0304f * ch0 - 0.062f * ch0 * pow(r, 1.4f);
  if (r <= 0.61f) return 0.0224f * ch0 - 0.031f * ch1;
  if (r <= 0.80f) return 0.0128f * ch0 - 0.0153f * ch1;
  if (r <= 1.30f) return 0.00146f * ch0 - 0.00112f * ch1;
  return 0;
}

/* ------------------------------------------------------------------ Couleur TCS34725 */
static bool tcsOn = false;
static float colorRead(uint8_t ch) {
  if (!tcsOn) {
    tcsOn = true;
    i2cWrite8(0x29, 0x80 | 0x01, 0xEB);  // temps d'intégration ~50 ms
    i2cWrite8(0x29, 0x80 | 0x0F, 0x01);  // gain 4x
    i2cWrite8(0x29, 0x80 | 0x00, 0x01);
    delay(3);
    i2cWrite8(0x29, 0x80 | 0x00, 0x03);
    delay(60);
  }
  uint8_t d[8];
  if (i2cReadBytes(0x29, 0x80 | 0x20 | 0x14, d, 8) != 8) return 0;
  float c = d[0] | (d[1] << 8);
  if (ch == 3) return c;
  float v = d[2 + ch * 2] | (d[3 + ch * 2] << 8);
  if (c == 0) return 0;
  v = v * 255.0f / c;
  return v > 255 ? 255 : v;
}

/* ------------------------------------------------------------------ Thermomètre infrarouge MLX90615 */
static float irTempRead(uint8_t which) {
  uint8_t d[3];
  if (i2cReadBytes(0x5B, which == 0 ? 0x27 : 0x26, d, 3) < 2) return 0;
  return (d[0] | (d[1] << 8)) * 0.02f - 273.15f;
}

/* ------------------------------------------------------------------ Pilote moteurs I2C Grove (0x0F) */
static int16_t motSpeed[2] = {0, 0};
static void motorI2C(uint8_t m, int16_t speed) {
  if (m > 1) return;
  if (speed > 255) speed = 255;
  if (speed < -255) speed = -255;
  motSpeed[m] = speed;
  uint8_t dir = (motSpeed[0] >= 0 ? 0x02 : 0x01) | (motSpeed[1] >= 0 ? 0x08 : 0x04);
  wireBegin();
  Wire.beginTransmission(0x0F);
  Wire.write(0xAA); Wire.write(dir); Wire.write(0);
  Wire.endTransmission();
  delay(4);
  Wire.beginTransmission(0x0F);
  Wire.write(0x82);
  Wire.write((uint8_t)abs(motSpeed[0]));
  Wire.write((uint8_t)abs(motSpeed[1]));
  Wire.endTransmission();
  delay(4);
}

#endif

/* ------------------------------------------------------------------ Capteur de CO2 SCD30 (0x61) */
static bool scdOn = false;
static float scdVal[3] = {0, 0, 0};
static uint8_t scdCrc(uint8_t a, uint8_t b) {
  uint8_t crc = 0xFF;
  uint8_t d[2] = {a, b};
  for (uint8_t i = 0; i < 2; i++) {
    crc ^= d[i];
    for (uint8_t k = 0; k < 8; k++) crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1;
  }
  return crc;
}
static void scdCmd(uint16_t cmd, int32_t arg) {
  wireBegin();
  Wire.beginTransmission(0x61);
  Wire.write(cmd >> 8); Wire.write(cmd & 0xFF);
  if (arg >= 0) { Wire.write(arg >> 8); Wire.write(arg & 0xFF); Wire.write(scdCrc(arg >> 8, arg & 0xFF)); }
  Wire.endTransmission();
}
static float co2Read(uint8_t what) {
  if (!scdOn) { scdOn = true; scdCmd(0x0010, 0); delay(10); }
  scdCmd(0x0202, -1);
  delay(3);
  if (Wire.requestFrom((uint8_t)0x61, (uint8_t)3) == 3 && (Wire.read() << 8 | Wire.read()) == 1) {
    Wire.read();
    scdCmd(0x0300, -1);
    delay(3);
    if (Wire.requestFrom((uint8_t)0x61, (uint8_t)18) == 18) {
      for (uint8_t i = 0; i < 3; i++) {
        uint8_t b[6];
        for (uint8_t k = 0; k < 6; k++) b[k] = Wire.read();
        union { uint32_t u; float f; } cv;
        cv.u = ((uint32_t)b[0] << 24) | ((uint32_t)b[1] << 16) | ((uint32_t)b[3] << 8) | b[4];
        scdVal[i] = cv.f;
      }
    }
  } else {
    while (Wire.available()) Wire.read();
  }
  return scdVal[what > 2 ? 2 : what];
}

/* ------------------------------------------------------------------ Tâches de fond : encodeur rotatif et récepteur infrarouge */
// Ces modules envoient des signaux à tout moment : on les surveille entre deux instructions
// du programme et pendant les attentes.
bool bgActive = false;
static uint8_t encPin = 255, encPrev = 0;
static int16_t encCount = 0;
static const int8_t ENC_TABLE[16] PROGMEM = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
static uint8_t irPin = 255, irLevel = 1, irState = 0, irBits = 0;
static uint32_t irData = 0;
static unsigned long irEdge = 0;
static int16_t irCode = 0;

static void irEdgeSeen(uint8_t newLevel, unsigned long dur) {
  // newLevel : niveau après le front ; dur : durée du niveau précédent (µs)
  if (newLevel == 1) {            // fin d'une impulsion basse (porteuse détectée)
    if (dur > 8000 && dur < 10000) { irState = 1; return; }
    if (irState == 3 && (dur < 300 || dur > 800)) irState = 0;
  } else {                        // fin d'un niveau haut
    if (irState == 1) {
      if (dur > 4000 && dur < 5000) { irState = 3; irBits = 0; irData = 0; }
      else irState = 0;             // code de répétition : ignoré
      return;
    }
    if (irState == 3) {
      if (dur > 300 && dur < 800) irBits++;
      else if (dur > 1300 && dur < 1900) { irData |= (uint32_t)1 << irBits; irBits++; }
      else { irState = 0; return; }
      if (irBits == 32) { irCode = (irData >> 16) & 0xFF; irState = 0; }
    }
  }
}

void bgPoll() {
  if (encPin != 255) {
    uint8_t st = (digitalRead(encPin) << 1) | digitalRead(encPin + 1);
    if (st != encPrev) {
      encCount += (int8_t)pgm_read_byte(ENC_TABLE + ((encPrev << 2) | st));
      encPrev = st;
    }
  }
  if (irPin != 255) {
    uint8_t lv = digitalRead(irPin);
    if (lv != irLevel) {
      unsigned long now = micros();
      irEdgeSeen(lv, now - irEdge);
      irEdge = now;
      irLevel = lv;
    }
  }
}
static void vmDelay(unsigned long ms) {
  if (!bgActive) { delay(ms); return; }
  unsigned long t0 = millis();
  while (millis() - t0 < ms) bgPoll();
}
static float encoderRead(uint8_t pin) {
  if (encPin != pin) {
    encPin = pin;
    pinMode(pin, INPUT_PULLUP);
    pinMode(pin + 1, INPUT_PULLUP);
    encPrev = (digitalRead(pin) << 1) | digitalRead(pin + 1);
    encCount = 0;
    bgActive = true;
  }
  bgPoll();
  return encCount / 4;
}
static float irRead(uint8_t pin) {
  if (irPin != pin) {
    irPin = pin;
    pinMode(pin, INPUT_PULLUP);
    irLevel = digitalRead(pin);
    irEdge = micros();
    bgActive = true;
  }
  bgPoll();
  int16_t c = irCode;
  irCode = 0;
  return c;
}

/* ------------------------------------------------------------------ Aiguillage des appels système */
static uint8_t toByte(float v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return (uint8_t)v;
}

float sysCall(uint8_t id, float *a) {
  uint8_t pin = (uint8_t)a[0];
  switch (id) {
    case SYS_PINMODE:
      pinMode(pin, a[1] == 1 ? OUTPUT : (a[1] == 2 ? INPUT_PULLUP : INPUT));
      return 0;
    case SYS_DIGITALWRITE: digitalWrite(pin, a[1] != 0 ? HIGH : LOW); return 0;
    case SYS_DIGITALREAD: return digitalRead(pin);
    case SYS_ANALOGREAD: return analogRead(pin);
    case SYS_ANALOGWRITE: analogWrite(pin, toByte(a[1])); return 0;
    case SYS_DELAY: if (a[0] > 0) vmDelay((unsigned long)a[0]); return 0;
    case SYS_DELAYMICROSECONDS: if (a[0] > 0) delayMicroseconds((unsigned int)a[0]); return 0;
    case SYS_MILLIS: return millis();
    case SYS_MICROS: return micros();
    case SYS_TONE: if (a[1] >= 31) tone(pin, (unsigned int)a[1]); return 0;
    case SYS_TONEDUR: if (a[1] >= 31) tone(pin, (unsigned int)a[1], (unsigned long)a[2]); return 0;
    case SYS_NOTONE: noTone(pin); return 0;
    case SYS_PULSEIN: return pulseIn(pin, a[1] != 0 ? HIGH : LOW, a[2] > 0 ? (unsigned long)a[2] : 1000000UL);
    case SYS_SERIALBEGIN: Serial.begin((unsigned long)a[0]); serialOn = true; return 0;
    case SYS_SERIALAVAILABLE: ensureSerial(); return Serial.available();
    case SYS_SERIALREAD: ensureSerial(); return Serial.read();
    case SYS_RANDOMSEED: randomSeed((unsigned long)a[0]); return 0;
    case SYS_SERVOWRITE: servoWrite(pin, a[1]); return 0;
    case SYS_ULTRASONICCM: return ultrasonicCm(pin);
    case SYS_DHTREAD: dhtRead(pin, (uint8_t)a[1]); return a[2] == 0 ? dhtT : dhtH;
    case SYS_LCDCLEAR: lcdInit(); lcdCmd(0x01); delayMicroseconds(2000); lcdCol = lcdRow = 0; return 0;
    case SYS_LCDSETCURSOR: lcdSetCursor((uint8_t)a[0], (uint8_t)a[1]); return 0;
    case SYS_LCDRGB: lcdInit(); lcdRGB(toByte(a[0]), toByte(a[1]), toByte(a[2])); return 0;
    case SYS_LCDBACKLIGHT: lcdInit(); if (a[0] == 0) lcdRGB(0, 0, 0); else lcdRGB(255, 255, 255); return 0;
    case SYS_OLEDCLEAR: oledClear(); return 0;
    case SYS_OLEDSETCURSOR: oledInit(); oledPos((uint8_t)a[0], (uint8_t)a[1]); return 0;
    case SYS_TM1637NUMBER: tmNumber(pin, (long)a[1]); return 0;
    case SYS_TM1637CLEAR: memset(tmSegs, 0, 4); tmShow(pin); return 0;
    case SYS_TM1637BRIGHTNESS: tmBright = (uint8_t)a[1] & 7; tmShow(pin); return 0;
    case SYS_TM1637DIGITS:
      for (uint8_t i = 0; i < 4; i++) {
        int8_t d = (int8_t)a[1 + i];
        tmSegs[i] = (d >= 0 && d <= 9) ? pgm_read_byte(SEG + d) : 0;
      }
      tmShow(pin);
      return 0;
    case SYS_TM1637COLON: tmColon = a[1] != 0; tmShow(pin); return 0;
    case SYS_LEDBARLEVEL: barLevel(pin, a[1]); return 0;
    case SYS_CHAINRGB: chainSet(pin, (uint8_t)a[1], toByte(a[2]), toByte(a[3]), toByte(a[4])); return 0;
    case SYS_PIXELSET:
      pixelSet(pin, (uint8_t)a[1], toByte(a[2]), toByte(a[3]), toByte(a[4]));
      pixelShow(pin, pixCount);
      return 0;
    case SYS_PIXELSHOW: pixelShow(pin, (uint8_t)a[1]); return 0;
    case SYS_PIXELFILL: {
      uint8_t n = (uint8_t)a[1];
      for (uint8_t i = 0; i < n; i++) pixelSet(pin, i, toByte(a[2]), toByte(a[3]), toByte(a[4]));
      pixelShow(pin, n);
      return 0;
    }
    case SYS_ACCELREAD: return accelRead(pin > 2 ? 2 : pin);
    case SYS_GYROREAD: return gyroRead(pin > 2 ? 2 : pin);
    case SYS_CO2READ: return co2Read(pin);
    case SYS_ENCODERREAD: return encoderRead(pin);
    case SYS_IRREAD: return irRead(pin);
    case SYS_BAROREAD: return baroRead(pin);
    case SYS_THI2CREAD: return thI2CRead(pin, (uint8_t)a[1]);
    case SYS_RTCREAD: return rtcRead(pin);
    case SYS_RTCSET: rtcSet(a); return 0;
    case SYS_I2CWRITEREG: i2cWrite8(pin, (uint8_t)a[1], toByte(a[2])); return 0;
    case SYS_I2CREADREG: return i2cRead8(pin, (uint8_t)a[1]);
#if FULL_DRIVERS
    case SYS_LIGHTI2CREAD: return tslLux();
    case SYS_COLORREAD: return colorRead(pin > 3 ? 3 : pin);
    case SYS_IRTEMPREAD: return irTempRead(pin);
    case SYS_FINGERHEARTREAD: {
      wireBegin();
      if (Wire.requestFrom((uint8_t)0x50, (uint8_t)1) == 1) return Wire.read();
      return 0;
    }
    case SYS_MOTORI2C: motorI2C(pin, (int16_t)a[1]); return 0;
#endif
  }
  return 0;
}
