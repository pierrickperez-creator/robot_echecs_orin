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
Z_VISION       = 150.0        # mm — hauteur de la tête (à 100 mm seules les rangées 3-8 étaient visibles)

FEED_TRAVEL    = 4000.0
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
# Z de l'aimant posé sur le plateau ; Z de l'aimant posé sur la tête de chaque type de pièce.
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
HOME_ON_STARTUP = True    # Homing G28 puis position caméra au lancement du serveur

_detected_path = shutil.which("stockfish")
STOCKFISH_PATH = _detected_path if _detected_path else "/usr/games/stockfish"
STOCKFISH_MOVE_TIME = 1.0

# --- MARLIN BOARD PINS ---
# Ces pins se trouvent sur la carte MKS et non sur le Jetson Orin.
# Le Jetson Orin utilise uniquement ses GPIO pour l'écran tactile.
# Relais sur connecteur servo D11 via module KS0055, contrôlé par M280 (commande servo Marlin).
MAGNET_PIN = 11           # gardé pour référence, non utilisé par M280
MAGNET_SERVO_IDX = 0      # Index servo Marlin : 0 = premier servo (D11 sur RAMPS/MKS)
MAGNET_SERVO_ON  = 180    # M280 P0 S180 → relais ON
MAGNET_SERVO_OFF = 0      # M280 P0 S0   → relais OFF
MAGNET_MAX_ON_SEC = 30    # Durée max d'activation avant coupure automatique (secondes)
