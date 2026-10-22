/*
 * Zone réservée au programme de l'élève (bytecode).
 * Le simulateur remplace ces octets dans l'image .hex avant le téléversement.
 * Remplie de 0xFF pour que les pages inutilisées puissent être sautées.
 */
#include <avr/pgmspace.h>

#ifndef PROG_SIZE
#define PROG_SIZE 8192
#endif

const unsigned char userProg[PROG_SIZE] __attribute__((used)) PROGMEM = {
  [0 ... PROG_SIZE - 1] = 0xFF
};
