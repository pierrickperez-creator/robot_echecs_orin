#!/bin/bash
# Compile le micrologiciel interpréteur pour ATmega328P (Uno, Nano) et ATmega2560 (Mega),
# puis génère src/js/firmware_data.js (image .hex + adresse de la zone programme).
# Prérequis (Ubuntu/Debian) : apt install gcc-avr avr-libc binutils-avr arduino-core-avr
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CORE_ROOT="${ARDUINO_AVR:-/usr/share/arduino/hardware/arduino/avr}"
OUT="$HERE/build"
mkdir -p "$OUT"

node "$ROOT/tools/gen_spec_h.js"
node "$ROOT/tools/gen_font.js"

build() {
  local name=$1 mcu=$2 variant=$3 progsize=$4
  local dir="$OUT/$name"
  rm -rf "$dir"; mkdir -p "$dir"
  local CFLAGS="-mmcu=$mcu -DF_CPU=16000000L -DARDUINO=10806 -DARDUINO_ARCH_AVR -Os -ffunction-sections -fdata-sections -w -flto -mcall-prologues"
  local INC="-I$CORE_ROOT/cores/arduino -I$CORE_ROOT/variants/$variant -I$CORE_ROOT/libraries/Wire/src -I$CORE_ROOT/libraries/Wire/src/utility -I$HERE"
  local objs=()
  for f in "$CORE_ROOT"/cores/arduino/*.c "$CORE_ROOT"/libraries/Wire/src/utility/*.c; do
    o="$dir/$(basename "$f").o"; avr-gcc $CFLAGS $INC -c "$f" -o "$o"; objs+=("$o")
  done
  for f in "$CORE_ROOT"/cores/arduino/*.cpp "$CORE_ROOT"/libraries/Wire/src/*.cpp "$HERE"/vm_main.cpp "$HERE"/drivers.cpp; do
    o="$dir/$(basename "$f").o"
    avr-g++ $CFLAGS -std=gnu++11 -fno-exceptions -fno-threadsafe-statics $INC -c "$f" -o "$o"; objs+=("$o")
  done
  for f in "$CORE_ROOT"/cores/arduino/*.S; do
    [ -e "$f" ] || continue
    o="$dir/$(basename "$f").o"; avr-gcc $CFLAGS -x assembler-with-cpp $INC -c "$f" -o "$o"; objs+=("$o")
  done
  avr-gcc ${CFLAGS/-flto/} -DPROG_SIZE=$progsize -c "$HERE/prog.c" -o "$dir/prog.o"; objs+=("$dir/prog.o")
  avr-gcc -mmcu=$mcu -Os -flto -mcall-prologues -Wl,--gc-sections -o "$dir/vm.elf" "${objs[@]}" -lm
  avr-objcopy -O ihex -R .eeprom "$dir/vm.elf" "$dir/vm.hex"
  avr-size "$dir/vm.elf"
  # l'image doit laisser la place au bootloader (2 Ko pour l'ancien bootloader des Nano, 8 Ko sur la Mega)
  local used limit
  used=$(avr-size "$dir/vm.elf" | awk 'NR==2{print $1+$2}')
  limit=$([ "$mcu" = atmega2560 ] && echo 253952 || echo 30720)
  if [ "$used" -gt "$limit" ]; then echo "ERREUR : micrologiciel trop gros pour $mcu ($used > $limit octets)"; exit 1; fi
  local addr
  addr=$(avr-nm "$dir/vm.elf" | awk '$3=="userProg"{print $1}')
  echo "$name : userProg à 0x$addr ($progsize octets)"
  echo "$addr" > "$dir/prog_addr.txt"
  # appels système compilés (numéros des « case » de sysCall après préprocesseur)
  avr-g++ $CFLAGS -std=gnu++11 $INC -E "$HERE/drivers.cpp" \
    | sed -n '/^float sysCall(/,$p' | grep -oE 'case [0-9]+:' | grep -oE '[0-9]+' | sort -n | uniq > "$dir/sys_ids.txt"
}

build atmega328p atmega328p standard 4096
build atmega2560 atmega2560 mega 16384

node "$ROOT/tools/gen_firmware_js.js" "$OUT"
