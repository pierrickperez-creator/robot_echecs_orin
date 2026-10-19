"""
config.py - Configuration du Robot Échecs
"""
import shutil

# --- MODES ---
SIMULATION_MODE = False  # Mettre à False pour piloter le vrai robot

# --- JEU ---
HUMAN_PLAYS_WHITE = True
DEFAULT_ELO = 500

# --- COM ---
# Nom stable de la carte (ne change pas si ttyUSB0 devient ttyUSB1 après un débranchement)
MARLIN_PORT = "/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_A505NFFE-if00-port0"  # MKS Base v1.5, FT232RL
MARLIN_BAUD = 250000          # Vitesse confirmée par le test V2

# --- GEOMETRIE PLATEAU (DiscoEasy 200 - 200x200mm) ---
# Grille 10x10 cases de 20mm
# Indices : 0 à 9 en X et Y.
BED_SIZE_MM = 200.0
GRID_CELLS  = 10
SQUARE_SIZE_MM = BED_SIZE_MM / GRID_CELLS # 20.0 mm

# L'échiquier (8x8) est centré, donc il occupe les indices 1 à 8 (colonnes b à i, rangées 2 à 9 relatives).
# A AJUSTER: Ces offsets déterminent la position physique exacte du plateau.
# Si l'aimant ne s'aligne pas avec le centre de la case A1 physique,
# modifiez ces valeurs (en millimètres).
BOARD_OFFSET_X = SQUARE_SIZE_MM 
BOARD_OFFSET_Y = SQUARE_SIZE_MM

# Hauteurs Z
Z_BOARD        = 3.0
Z_PICK_REL     = 31.0
Z_TRAVEL_REL   = 35.0
Z_SAFE_REL     = 50.0

# ── Position caméra (prise de photo pour interpréter le coup du joueur) ──────
# La caméra est fixée à l'arrière de la tête d'impression.
# Pour photographier le plateau correctement :
#   - Le plateau recule au maximum (Y = BED_SIZE_MM)
#   - La tête se lève pour avoir du recul (Z_VISION mm)
#   - La tête est centrée en X (VISION_X)
VISION_X       = 100.0        # mm — tête centrée horizontalement
VISION_Y       = 180.0        # mm — réglé sur la machine : tout l'échiquier 8x8 dans le champ
Z_VISION       = 115.0        # mm — repère du homing sur pion central (≈ Z150 de l'ancien repère plateau)
Z_MAX_SAFE     = 120.0        # mm — jamais au-dessus : à Z150 (nouveau repère) la tête a touché la butée haute

FEED_TRAVEL    = 4000.0
# Le PLATEAU bouge en Y avec les pièces dessus : démarrages et arrêts en douceur.
# Envoyés au démarrage (M201 / M204 / M205), non sauvegardés dans la carte.
Y_MAX_ACCEL    = 250          # mm/s² (firmware : 1000)
TRAVEL_ACCEL   = 1000         # mm/s² accélération des déplacements (firmware : 3000)
XY_JERK        = 5            # mm/s  changement de vitesse instantané (firmware : 20)
Z_MAX_FEED     = 14           # mm/s  vitesse max Z (firmware : 8). Si Z perd des pas (homing faux), baisser.
Z_MAX_ACCEL    = 80           # mm/s² accélération Z (firmware : 20)
FEED_Z         = 1000.0

# --- ZONES DE STOCKAGE (EN FORME DE U) ---
def grid_xy(c, r):
    return (c * SQUARE_SIZE_MM + SQUARE_SIZE_MM/2, r * SQUARE_SIZE_MM + SQUARE_SIZE_MM/2)

# Emplacements exprimés en cellules (colonne, rangée) de la grille 10x10 : a1 = (1, 1).
# Les coordonnées mm en sont déduites (calibration des prises si elle existe, sinon grid_xy).
BLACK_GRAVEYARD_CELLS = []
WHITE_GRAVEYARD_CELLS = []

# Zone NOIRE (Bleue) : Haut du plateau (Rangs 5 à 9)
for r in range(5, 10): BLACK_GRAVEYARD_CELLS.append((0, r)) # Gauche
for c in range(1, 9): BLACK_GRAVEYARD_CELLS.append((c, 9))  # Haut
for r in range(9, 4, -1): BLACK_GRAVEYARD_CELLS.append((9, r)) # Droite

# Zone BLANCHE (Verte) : Bas du plateau (Rangs 4 à 0)
for r in range(4, -1, -1): WHITE_GRAVEYARD_CELLS.append((0, r)) # Gauche
for c in range(1, 9): WHITE_GRAVEYARD_CELLS.append((c, 0))  # Bas
for r in range(0, 5): WHITE_GRAVEYARD_CELLS.append((9, r))  # Droite

# Réserves Dames (1 dame par couleur — cases I4 et I5, colonne droite)
WHITE_QUEEN_RESERVE_CELLS = [(9, 4)]   # I4 : colonne droite, rang 4 (zone blanche)
BLACK_QUEEN_RESERVE_CELLS = [(9, 5)]   # I5 : colonne droite, rang 5 (zone noire)

# Compatibilité : mêmes emplacements en mm théoriques
BLACK_GRAVEYARD = [grid_xy(c, r) for c, r in BLACK_GRAVEYARD_CELLS]
WHITE_GRAVEYARD = [grid_xy(c, r) for c, r in WHITE_GRAVEYARD_CELLS]
WHITE_QUEEN_RESERVE = [grid_xy(c, r) for c, r in WHITE_QUEEN_RESERVE_CELLS]
BLACK_QUEEN_RESERVE = [grid_xy(c, r) for c, r in BLACK_QUEEN_RESERVE_CELLS]

# --- PRISE DES PIÈCES (calibrée sur la machine, page Contrôle manuel) ---
# board_calibration.json contient : position de l'aimant au centre de a1, h1, a8 ;
# Z de l'aimant posé sur le plateau ; Z de prise facultatif (sinon surface + PIECE_HEIGHT_MM).
PIECE_HEIGHT_MM   = 33.0      # Toutes les pièces : 30 mm + tête de vis de 3 mm (prise par l'aimant)
HOVER_MM          = 1.0       # Survol au-dessus de la vis pour centrer l'aimant à l'œil
PICK_CLEARANCE_MM = 8.0       # Marge au-dessus de la plus haute pièce pendant les trajets
PICK_APPROACH_MM  = 4.0       # Les derniers mm de descente se font lentement
FEED_APPROACH     = 200.0     # mm/min pour l'approche finale
PICK_GOTO_Z       = 90.0      # Hauteur des trajets tant que les hauteurs de pièces sont inconnues
MAGNET_DWELL_MS   = 300       # Attente après activation / coupure de l'aimant

# --- VISION ---
# Caméra USB SQ11 (branchée via USB, détectée comme /dev/video0 ou /dev/video1)
CAMERA_USB_INDEX = 0          # Index V4L2 de la caméra USB (0 = première caméra USB détectée)
CAMERA_WIDTH  = 640           # Résolution en sortie de la caméra SQ11
CAMERA_HEIGHT = 480
# Réglages appliqués à l'ouverture (v4l2-ctl). Exposition et balance des blancs FIXES :
# en automatique, l'image change d'une photo à l'autre et fausse la comparaison des coups.
# Réglée sur la machine sous LED (en auto, 26 % de l'image était saturée en blanc au soleil).
CAMERA_V4L2_CONTROLS = {
    "auto_exposure": 1,                # 1 = manuel
    "exposure_time_absolute": 2500,     # volets fermés + bandeau LED (300 en plein soleil)
    "white_balance_automatic": 0,
    "white_balance_temperature": 3500,  # meilleur écart bois / plastique sous les LED
}
VISION_PIECE_CHROMA_MAX = 20  # Socles : seuil par défaut (recalculé à chaque apprentissage)
BOARD_PX      = 400
BOARD_CORNERS = None          # Sera calibré avec les 4 dames noires

# Détection du coup humain par comparaison de photos
# Calibration : 4 dames noires posées sur a1, h1, a8, h8 (les cimetières sont hors du champ caméra)
VISION_CALIB_SQUARES = True    # False = anciennes marques au centre des 4 cases d'angle de la grille 10x10
VISION_DIFF_THRESHOLD = 18     # Écart moyen (0-255) au-delà duquel une case est "modifiée"
VISION_SETTLE_SEC     = 1.0    # Pause après arrivée en position caméra (vibrations) avant la photo
# Orientation : si les noms de cases de l'image de debug ne collent pas au vrai plateau
VISION_FLIP_FILES = False      # inverse a↔h
VISION_FLIP_RANKS = True       # inverse 1↔8 (caméra montée : rangée 1 en bas de l'image)
VISION_SWAP_AXES  = False      # échange colonnes et rangées (caméra tournée de 90°)

# Variables utilisées par CameraStream dans app.py
USE_GSTREAMER  = False        # Pas de caméra CSI sur ce setup (SQ11 = USB uniquement)
CAM_ID_MAIN    = CAMERA_USB_INDEX   # Index principal  (/dev/video0)
CAM_ID_SECOND  = 1                  # Index secondaire (/dev/video1)

# --- DÉMARRAGE ---
HOME_ON_STARTUP = False   # Pas de homing automatique : il se lance depuis l'écran (bouton DÉMARRER)

# --- HOMING ---
# G28 du firmware Dagoma : le capteur (détection de la vis à ~6 mm) descend toujours au
# CENTRE du plateau. Un pion de référence y est posé pendant le homing, puis retiré.
# (Le firmware interdit de descendre sous le point de homing : pas de homing logiciel possible.)
VERIFY_SQUARE        = "e1"   # après le homing, l'aimant se place au-dessus de ce roi pour vérification
Z_BEFORE_PICK_CALIB  = 20.0   # hauteur des trajets juste après le homing, tant que la prise n'est pas réglée
Z_FLOOR_AFTER_HOME   = -2.0   # mesuré : le firmware autorise 2 mm sous le point de homing (Z_MIN_POS)
STEPPER_IDLE_OFF_SEC = 5      # coupe les moteurs après 5 s d'arrêt (supprime le sifflement)

_detected_path = shutil.which("stockfish")
STOCKFISH_PATH = _detected_path if _detected_path else "/usr/games/stockfish"
STOCKFISH_MOVE_TIME = 1.0

# --- MARLIN BOARD PINS ---
# Ces pins se trouvent sur la carte MKS et non sur le Jetson Orin.
# Le Jetson Orin utilise uniquement ses GPIO pour l'écran tactile.
# Relais KS0055 sur la broche D11. Testé sur la machine : le relais claque avec M42 P11,
# pas avec M280 (sortie servo inactive dans le firmware Dagoma).
MAGNET_MODE = "pin"       # "pin" = M42 P<MAGNET_PIN> S255/S0 ; "servo" = M280 P<idx> S<on/off>
MAGNET_PIN = 11
MAGNET_SERVO_IDX = 0      # Index servo Marlin : 0 = premier servo (D11 sur RAMPS/MKS)
MAGNET_SERVO_ON  = 180    # M280 P0 S180 → relais ON
MAGNET_SERVO_OFF = 0      # M280 P0 S0   → relais OFF
MAGNET_MAX_ON_SEC = 30    # Durée max d'activation avant coupure automatique (secondes)
