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
MARLIN_PORT = "/dev/ttyUSB0"  # Port série carte Marlin (MKS Base v1.5, FT232RL)
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
VISION_Y       = BED_SIZE_MM  # mm — plateau reculé au maximum (200 mm)
Z_VISION       = 100.0        # mm — hauteur de la tête (10 cm)

FEED_TRAVEL    = 4000.0
FEED_Z         = 1000.0

# --- ZONES DE STOCKAGE (EN FORME DE U) ---
def grid_xy(c, r):
    return (c * SQUARE_SIZE_MM + SQUARE_SIZE_MM/2, r * SQUARE_SIZE_MM + SQUARE_SIZE_MM/2)

BLACK_GRAVEYARD = []
WHITE_GRAVEYARD = []

# Zone NOIRE (Bleue) : Haut du plateau (Rangs 5 à 9)
for r in range(5, 10): BLACK_GRAVEYARD.append(grid_xy(0, r)) # Gauche
for c in range(1, 9): BLACK_GRAVEYARD.append(grid_xy(c, 9))  # Haut
for r in range(9, 4, -1): BLACK_GRAVEYARD.append(grid_xy(9, r)) # Droite

# Zone BLANCHE (Verte) : Bas du plateau (Rangs 4 à 0)
for r in range(4, -1, -1): WHITE_GRAVEYARD.append(grid_xy(0, r)) # Gauche
for c in range(1, 9): WHITE_GRAVEYARD.append(grid_xy(c, 0))  # Bas
for r in range(0, 5): WHITE_GRAVEYARD.append(grid_xy(9, r))  # Droite

# Réserves Dames (1 dame par couleur — cases I4 et I5, colonne droite)
WHITE_QUEEN_RESERVE = [grid_xy(9, 4)]   # I4 : colonne droite, rang 4 (zone blanche)
BLACK_QUEEN_RESERVE = [grid_xy(9, 5)]   # I5 : colonne droite, rang 5 (zone noire)

# --- VISION ---
# Caméra USB SQ11 (branchée via USB, détectée comme /dev/video0 ou /dev/video1)
CAMERA_USB_INDEX = 0          # Index V4L2 de la caméra USB (0 = première caméra USB détectée)
CAMERA_WIDTH  = 640           # Résolution en sortie de la caméra SQ11
CAMERA_HEIGHT = 480
BOARD_PX      = 400
BOARD_CORNERS = None          # Sera calibré avec les 4 dames noires

# Variables utilisées par CameraStream dans app.py
USE_GSTREAMER  = False        # Pas de caméra CSI sur ce setup (SQ11 = USB uniquement)
CAM_ID_MAIN    = CAMERA_USB_INDEX   # Index principal  (/dev/video0)
CAM_ID_SECOND  = 1                  # Index secondaire (/dev/video1)

# --- BOUTON DE VALIDATION (Branché sur un Endstop libre) ---
# Valeurs possibles : "x_min", "x_max", "y_min", "y_max", "z_min", "z_max"
ENDSTOP_BUTTON_NAME = "z_max" 

_detected_path = shutil.which("stockfish")
STOCKFISH_PATH = _detected_path if _detected_path else "/usr/games/stockfish"
STOCKFISH_MOVE_TIME = 1.0

# --- MARLIN BOARD PINS (M42 / M119) ---
# Ces pins se trouvent sur la carte MKS et non sur le Jetson Orin.
# Le Jetson Orin utilise uniquement ses GPIO pour l'écran tactile.
# Relais sur connecteur servo D11 via module KS0055, contrôlé par M280 (commande servo Marlin).
MAGNET_PIN = 11           # gardé pour référence, non utilisé par M280
MAGNET_SERVO_IDX = 0      # Index servo Marlin : 0 = premier servo (D11 sur RAMPS/MKS)
MAGNET_MAX_ON_SEC = 30    # Durée max d'activation avant coupure automatique (secondes)
