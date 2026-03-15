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
MARLIN_PORT = "/dev/ttyUSB0"  # Port détecté par le diagnostic
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
Z_VISION       = 100.0 # Hauteur pour que la caméra fixe voie tout le plateau

# Centre du plateau pour observation caméra
VISION_X       = 100.0
VISION_Y       = 100.0

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

# Réserves Dames
BLACK_QUEEN_RESERVE = [grid_xy(4, 9), grid_xy(5, 9)]
WHITE_QUEEN_RESERVE = [grid_xy(4, 0), grid_xy(5, 0)]

# --- VISION ---
USE_GSTREAMER = False     # Désactivé car le diagnostic a montré que V4L2 fonctionne mieux
CAMERA_MODEL  = "IMX219" 
CAM_ID_MAIN   = 0
CAM_ID_SECOND = 1
BOARD_PX      = 400
BOARD_CORNERS = None      # Sera calibré avec les 4 dames noires

# --- BOUTON DE VALIDATION (Branché sur un Endstop libre) ---
# Valeurs possibles : "x_min", "x_max", "y_min", "y_max", "z_min", "z_max"
ENDSTOP_BUTTON_NAME = "z_max" 

_detected_path = shutil.which("stockfish")
STOCKFISH_PATH = _detected_path if _detected_path else "/usr/games/stockfish"
STOCKFISH_MOVE_TIME = 1.0

# --- MARLIN BOARD PINS (M42 / M119) ---
# Ces pins se trouvent sur la carte MKS et non sur le Jetson Orin.
# Le Jetson Orin utilise uniquement ses GPIO pour l'écran tactile.
# MAGNET_PIN 22 correspond souvent à une pin de ventilateur ou libre sur RAMPS/MKS.
MAGNET_PIN = 22
