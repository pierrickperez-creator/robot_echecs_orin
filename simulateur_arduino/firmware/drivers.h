#pragma once
#include <Arduino.h>

extern bool serialOn;
void ensureSerial();
float sysCall(uint8_t id, float *a);
Print &printTarget(uint8_t t);
void printNewline(uint8_t t);
extern bool bgActive;
void bgPoll();
