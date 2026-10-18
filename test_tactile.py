import spidev
import time

print("Ouverture du bus SPI pour le tactile...")
spi_touch = spidev.SpiDev()
# On ouvre le bus 0, device 1 (ce qui correspond à la broche CS1 / Pin 26)
spi_touch.open(0, 1)
spi_touch.max_speed_hz = 1000000

def read_touch():
    # Envoi de la commande pour lire l'axe X (0xD0)
    reply_x = spi_touch.xfer2([0xD0, 0x00, 0x00])
    x = (reply_x[1] << 5) | (reply_x[2] >> 3)
    
    # Envoi de la commande pour lire l'axe Y (0x90)
    reply_y = spi_touch.xfer2([0x90, 0x00, 0x00])
    y = (reply_y[1] << 5) | (reply_y[2] >> 3)
    
    return x, y

print("Touchez l'écran ! (Ctrl+C pour quitter)")
try:
    while True:
        x, y = read_touch()
        # On filtre les valeurs à 0 (quand on ne touche pas l'écran)
        if x > 10 and y > 10 and x < 4095 and y < 4095:
            print(f"👉 Tactile détecté -> X: {x} | Y: {y}")
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\nFin du test.")
finally:
    spi_touch.close()
