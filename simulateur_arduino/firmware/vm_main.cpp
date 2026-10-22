/*
 * Micrologiciel « interpréteur » du Simulateur Arduino.
 * Il exécute le programme de l'élève (bytecode) rangé dans le tableau userProg (prog.c).
 * Le même bytecode est exécuté par le simulateur (src/js/vm.js) : les deux doivent rester identiques.
 */
#include <Arduino.h>
#include <avr/pgmspace.h>
#include "vm_spec.h"
#include "drivers.h"

extern "C" const unsigned char userProg[] PROGMEM;

#if defined(__AVR_ATmega2560__)
#define MAX_VARS 250
#define STACK_SIZE 64
#define CALL_DEPTH 32
#else
#define MAX_VARS 110
#define STACK_SIZE 40
#define CALL_DEPTH 16
#endif

static float vars[MAX_VARS];
static float stk[STACK_SIZE];
static uint8_t sp;
static uint16_t cstk[CALL_DEPTH];
static uint8_t csp;
static uint16_t pc;
static uint16_t progLen;
bool serialOn = false;

static inline uint8_t pb(uint16_t a) { return pgm_read_byte(userProg + a); }
static inline uint16_t pw(uint16_t a) { return pb(a) | ((uint16_t)pb(a + 1) << 8); }

static void blinkForever(uint16_t period) {
  pinMode(LED_BUILTIN, OUTPUT);
  for (;;) {
    digitalWrite(LED_BUILTIN, HIGH); delay(period);
    digitalWrite(LED_BUILTIN, LOW); delay(period);
  }
}

static void vmError(uint8_t code) {
  ensureSerial();
  Serial.print(F("\r\n[Erreur VM "));
  Serial.print(code);
  Serial.print(F(" a l'adresse "));
  Serial.print(pc);
  Serial.println(F("]"));
  blinkForever(100);
}

void ensureSerial() {
  if (!serialOn) { Serial.begin(9600); serialOn = true; }
}

static inline void push(float v) {
  if (sp >= STACK_SIZE) vmError(1);
  stk[sp++] = v;
}
static inline float pop() {
  if (sp == 0) vmError(2);
  return stk[--sp];
}

static float roundAway(float x) { return x < 0 ? -floor(-x + 0.5f) : floor(x + 0.5f); }

static float mathFn(uint8_t f) {
  float a, b, c, d, e;
  switch (f) {
    case MF_ABS: return fabs(pop());
    case MF_SQRT: return sqrt(pop());
    case MF_SIN: return sin(pop());
    case MF_COS: return cos(pop());
    case MF_TAN: return tan(pop());
    case MF_ASIN: return asin(pop());
    case MF_ACOS: return acos(pop());
    case MF_ATAN: return atan(pop());
    case MF_LN: return log(pop());
    case MF_LOG10: return log10(pop());
    case MF_EXP: return exp(pop());
    case MF_ROUND: return roundAway(pop());
    case MF_FLOOR: return floor(pop());
    case MF_CEIL: return ceil(pop());
    case MF_MIN: b = pop(); a = pop(); return a < b ? a : b;
    case MF_MAX: b = pop(); a = pop(); return a > b ? a : b;
    case MF_POW: b = pop(); a = pop(); return pow(a, b);
    case MF_ATAN2: b = pop(); a = pop(); return atan2(a, b);
    case MF_CONSTRAIN: c = pop(); b = pop(); a = pop(); return a < b ? b : (a > c ? c : a);
    case MF_MAP: {
      e = pop(); d = pop(); c = pop(); b = pop(); a = pop();
      long x = (long)a, inMin = (long)b, inMax = (long)c, outMin = (long)d, outMax = (long)e;
      if (inMax == inMin) return outMin;
      return (float)((x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin);
    }
    case MF_RANDOM: {
      b = pop(); a = pop();
      long lo = (long)a, hi = (long)b;
      if (hi <= lo) return lo;
      return (float)random(lo, hi);
    }
  }
  vmError(3);
  return 0;
}

static void printNumber(Print &out, float v, uint8_t dec) {
  if (isnan(v)) { out.print(F("nan")); return; }
  if (dec == 0) out.print((long)roundAway(v));
  else out.print(v, dec);
}

static void exec(uint16_t start) {
  pc = start;
  csp = 0;
  for (;;) {
    if (pc >= progLen) vmError(4);
    uint8_t op = pb(pc++);
    float a, b;
    switch (op) {
      case OP_HALT: blinkForever(1000); break;
      case OP_PUSHF: {
        union { uint32_t u; float f; } cv;
        cv.u = (uint32_t)pw(pc) | ((uint32_t)pw(pc + 2) << 16);
        pc += 4; push(cv.f); break;
      }
      case OP_PUSHB: push((int8_t)pb(pc)); pc++; break;
      case OP_PUSHW: push((int16_t)pw(pc)); pc += 2; break;
      case OP_LOAD: { uint8_t n = pb(pc++); if (n >= MAX_VARS) vmError(5); push(vars[n]); break; }
      case OP_STORE: { uint8_t n = pb(pc++); if (n >= MAX_VARS) vmError(5); vars[n] = pop(); break; }
      case OP_POP: pop(); break;
      case OP_DUP: a = pop(); push(a); push(a); break;
      case OP_ADD: b = pop(); a = pop(); push(a + b); break;
      case OP_SUB: b = pop(); a = pop(); push(a - b); break;
      case OP_MUL: b = pop(); a = pop(); push(a * b); break;
      case OP_DIV: b = pop(); a = pop(); push(a / b); break;
      case OP_MOD: b = pop(); a = pop(); push(fmod(a, b)); break;
      case OP_NEG: push(-pop()); break;
      case OP_TRUNC: push(trunc(pop())); break;
      case OP_EQ: b = pop(); a = pop(); push(a == b); break;
      case OP_NE: b = pop(); a = pop(); push(a != b); break;
      case OP_LT: b = pop(); a = pop(); push(a < b); break;
      case OP_LE: b = pop(); a = pop(); push(a <= b); break;
      case OP_GT: b = pop(); a = pop(); push(a > b); break;
      case OP_GE: b = pop(); a = pop(); push(a >= b); break;
      case OP_AND: b = pop(); a = pop(); push(a != 0 && b != 0); break;
      case OP_OR: b = pop(); a = pop(); push(a != 0 || b != 0); break;
      case OP_NOT: push(pop() == 0); break;
      case OP_JMP: pc = pw(pc); break;
      case OP_JZ: if (pop() == 0) pc = pw(pc); else pc += 2; break;
      case OP_JNZ: if (pop() != 0) pc = pw(pc); else pc += 2; break;
      case OP_CALL:
        if (csp >= CALL_DEPTH) vmError(6);
        cstk[csp++] = pc + 2;
        pc = pw(pc);
        break;
      case OP_RET:
        if (csp == 0) return;
        pc = cstk[--csp];
        break;
      case OP_RETV:
        if (csp == 0) { pop(); return; }
        pc = cstk[--csp];
        break;
      case OP_MATH: {
        uint8_t f = pb(pc++);
        push(mathFn(f));
        break;
      }
      case OP_SYS: {
        uint8_t id = pb(pc++);
        if (id >= SYS_COUNT) vmError(7);
        uint8_t info = pgm_read_byte(SYS_INFO + id);
        uint8_t n = info & 0x7F;
        float args[7];
        for (int8_t i = n - 1; i >= 0; i--) args[i] = pop();
        float r = sysCall(id, args);
        if (info & 0x80) push(r);
        break;
      }
      case OP_PRINTN: {
        uint8_t t = pb(pc), dec = pb(pc + 1);
        pc += 2;
        printNumber(printTarget(t), pop(), dec);
        break;
      }
      case OP_PRINTS: {
        uint8_t t = pb(pc), len = pb(pc + 1);
        pc += 2;
        Print &out = printTarget(t);
        for (uint8_t i = 0; i < len; i++) {
          uint8_t c = pb(pc + i);
          if (t == TGT_SERIAL && c >= 0x80) {  // Latin-1 -> UTF-8
            out.write(0xC0 | (c >> 6));
            out.write(0x80 | (c & 0x3F));
          } else {
            out.write(c);
          }
        }
        pc += len;
        break;
      }
      case OP_PRINTNL: {
        uint8_t t = pb(pc++);
        if (t == TGT_SERIAL) printTarget(t).print(F("\r\n"));
        else printNewline(t);
        break;
      }
      default:
        pc--;
        vmError(8);
    }
  }
}

void setup() {
  if (pb(0) != 'V' || pb(1) != 'M' || pb(2) != VM_VERSION) {
    ensureSerial();
    Serial.println(F("Simulateur Arduino : aucun programme. Televersez un programme depuis le simulateur."));
    blinkForever(1000);
  }
  uint8_t nv = pb(3);
  if (nv > MAX_VARS) {
    ensureSerial();
    Serial.println(F("Programme trop gros : trop de variables pour cette carte."));
    blinkForever(250);
  }
  progLen = pw(8);
  for (uint8_t i = 0; i < MAX_VARS; i++) vars[i] = 0;
  sp = 0;
  exec(pw(4));
}

void loop() {
  uint16_t start = pw(6);
  sp = 0;
  exec(start);
}
