import time
import board
import digitalio
from PIL import Image, ImageDraw
from adafruit_rgb_display import hx8357

# --- CORRECTION DES BROCHES ---
cs_pin = digitalio.DigitalInOut(board.CE0)    # Pin 24 (Chip Select)
dc_pin = digitalio.DigitalInOut(board.D24)    # Pin 18 (Data/Command) - Corrigé !
reset_pin = digitalio.DigitalInOut(board.D25) # Pin 22 (Reset) - Corrigé !

spi = board.SPI()

print("Initialisation de l'écran...")
try:
    # Changement de pilote pour du 480x320 et baisse de la vitesse à 16MHz
    disp = hx8357.HX8357(spi, cs=cs_pin, dc=dc_pin, rst=reset_pin, baudrate=16000000)
    print("Driver HX8357 chargé.")
except Exception as e:
    print(f"Erreur init: {e}")
    exit()

# Création d'une image vierge à la taille de l'écran
image = Image.new("RGB", (disp.width, disp.height))
draw = ImageDraw.Draw(image)

print("Peinture en Rouge...")
draw.rectangle((0, 0, disp.width, disp.height), fill=(255, 0, 0))
disp.image(image)
time.sleep(2)

print("Peinture en Bleu...")
draw.rectangle((0, 0, disp.width, disp.height), fill=(0, 0, 255))
disp.image(image)
print("Test écran terminé !")
