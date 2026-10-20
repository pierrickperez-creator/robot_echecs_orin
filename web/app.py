#!/usr/bin/env python3
"""
app.py - Serveur Flask du Robot Échecs
Gère la caméra, les moteurs Marlin, la logique de jeu et l'API REST complète.
"""
from flask import Flask, render_template, Response, request, jsonify
import sys
import os
import time
import threading
import shutil
import subprocess
import unittest
import io as stdlib_io
import cv2
import chess
import chess.svg
import chess.engine as chess_engine_mod

# --- Gestion des Chemins ---
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

try:
    import serial
except ImportError:
    serial = None

try:
    import config
    from engine.chess_logic import ChessEngine
    from engine.vision_engine import VisionEngine
    from engine.coach import Coach, OpeningTrainer, OPENINGS, fr_san
    print("✅ Moteurs et Configuration chargés avec succès.")
except ImportError as e:
    print(f"❌ Erreur critique : {e}")
    sys.exit(1)

app = Flask(__name__)
# Change à chaque démarrage du serveur : les pages ouvertes se rechargent d'elles-mêmes
# (l'écran du robot n'a ni clavier ni souris pour faire F5 après une mise à jour).
APP_VERSION = str(int(time.time()))
game_engine = ChessEngine()
vision_engine = VisionEngine()

# --- GLOBALS ---
ser = None
serial_lock = threading.Lock()
gcode_log_buffer = []
status_msg = "En attente du joueur Blanc..."
clock_enabled = True
last_position = {'x': 0.0, 'y': 0.0, 'z': 0.0}

# =============================================================================
# LOGIQUE MATÉRIEL (MOTEURS & AIMANT)
# =============================================================================

def log_gcode(msg):
    ts = time.strftime("%H:%M:%S")
    formatted = f"[{ts}] {msg}"
    gcode_log_buffer.append(formatted)
    if len(gcode_log_buffer) > 50:
        gcode_log_buffer.pop(0)
    print(formatted)

def find_marlin_port():
    """Port configuré s'il existe, sinon premier adaptateur série USB trouvé."""
    import glob
    if os.path.exists(config.MARLIN_PORT):
        return config.MARLIN_PORT
    for pattern in ("/dev/serial/by-id/*FTDI*", "/dev/ttyUSB*", "/dev/ttyACM*"):
        found = sorted(glob.glob(pattern))
        if found:
            log_gcode(f"Port {config.MARLIN_PORT} absent, utilisation de {found[0]}")
            return found[0]
    return config.MARLIN_PORT

SETTINGS_FILE = os.path.join(parent_dir, "robot_settings.json")
settings = {
    "z_feed": config.Z_MAX_FEED,                 # mm/s, vitesse max de l'axe Z
    "xy_feed": round(config.FEED_TRAVEL / 60),   # mm/s, déplacements horizontaux
    "sound": True,                               # sons de fin de coup / fin de partie
}


def load_settings():
    import json
    try:
        with open(SETTINGS_FILE) as f:
            settings.update(json.load(f))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"⚠️ Réglages illisibles : {e}")


def save_settings():
    import json
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


def apply_motion_settings():
    """Envoie à Marlin la vitesse Z (accélération proportionnelle) — non sauvegardé dans la carte."""
    z = float(settings["z_feed"])
    send_gcode_raw(f"M203 Z{z:g}")
    send_gcode_raw(f"M201 Z{int(z * 10)}")


load_settings()


def init_printer():
    global ser
    if config.SIMULATION_MODE:
        log_gcode("MODE SIMULATION : Aucun mouvement réel.")
        return
    if serial is None:
        log_gcode("AVERTISSEMENT : bibliothèque serial non installée.")
        return
    try:
        port = find_marlin_port()
        # Sans -hupcl, la fermeture/réouverture du port fait basculer DTR, ce qui redémarre la
        # carte Marlin : elle oublie alors son homing à chaque redémarrage du serveur.
        subprocess.run(['stty', '-F', port, '-hupcl'], capture_output=True)
        ser = serial.Serial(port, config.MARLIN_BAUD, timeout=1)
        time.sleep(2)  # Attente reboot Marlin
        ser.reset_input_buffer()
        send_gcode_raw("M92 Z400")  # Calibration Z
        magnet(False)               # Forcer relais OFF immédiatement dès la connexion
        # Moteurs coupés après quelques secondes d'arrêt : supprime le sifflement des moteurs
        # à l'arrêt. Z tient seul (tiges filetées) ; X/Y ne subissent aucun effort entre deux coups.
        send_gcode_raw(f"M84 S{getattr(config, 'STEPPER_IDLE_OFF_SEC', 5)}")
        # Plateau (Y) en douceur : les pièces posées dessus ne doivent pas glisser
        send_gcode_raw(f"M201 Y{config.Y_MAX_ACCEL}")
        send_gcode_raw(f"M204 T{config.TRAVEL_ACCEL}")
        send_gcode_raw(f"M205 X{config.XY_JERK}")
        # Axe Z plus rapide (firmware : 8 mm/s, 20 mm/s²) : les montées en position caméra
        # cassaient le rythme de la partie
        apply_motion_settings()     # vitesse Z réglable dans la page Manuel
        read_marlin_position()      # Marlin garde ses coordonnées si seul le serveur a redémarré
        restore_homing_state()
        log_gcode(f"✅ Marlin connecté sur {port} — relais OFF")
    except Exception as e:
        log_gcode(f"ERREUR CONNEXION MARLIN : {e}")
        ser = None

# Commandes longues : Marlin ne répond 'ok' qu'une fois terminées
_SLOW_GCODE_TIMEOUT = {"G28": 120, "M400": 120, "G29": 300}

def send_gcode_raw(command, timeout=None):
    """
    Envoie un GCode et attend le 'ok' de Marlin avant de rendre la main.
    Indispensable : sans cette attente, le petit buffer série de Marlin déborde
    et des commandes sont perdues (mouvements manquants).
    """
    global ser
    if config.SIMULATION_MODE:
        log_gcode(f"[SIM] {command}")
        return True
    if not ser:
        log_gcode(f"[HORS LIGNE] {command}")
        return False
    if timeout is None:
        timeout = _SLOW_GCODE_TIMEOUT.get(command.split()[0].upper(), 10)
    with serial_lock:
        try:
            ser.write(f"{command}\n".encode())
            log_gcode(f"[→] {command}")
            deadline = time.time() + timeout
            while time.time() < deadline:
                line = ser.readline().decode(errors='ignore').strip()
                if line.startswith("ok"):
                    return True
                if line.lower().startswith("error"):
                    log_gcode(f"[←] {line}")
            log_gcode(f"⚠️ Pas de 'ok' de Marlin pour {command} (>{timeout}s)")
            return False
        except Exception as e:
            log_gcode(f"Erreur envoi GCode : {e}")
            return False

def send_gcode_wait(command, timeout=10):
    """Envoie un GCode et attend 'ok' de Marlin."""
    return send_gcode_raw(command, timeout)

startup_state = "attente"   # attente → homing → verif → pret  (ou erreur)


def startup_sequence():
    """Au démarrage : homing puis position caméra."""
    if not ser and not config.SIMULATION_MODE:
        return
    global last_position, status_msg
    with robot_busy:
        status_msg = "Démarrage : mise en position du robot..."
        log_gcode("DÉMARRAGE : Homing G28...")
        if home_axes():
            move_to_vision_position()
            capture_reference()
            status_msg = "Robot prêt. Jouez votre coup puis appuyez sur J'AI JOUÉ."
        else:
            log_gcode("⚠️ Homing non confirmé — position caméra annulée.")
            status_msg = "⚠️ Homing non confirmé : vérifiez l'imprimante."

def move_to_vision_position():
    """Déplace la tête en position caméra : plateau reculé au max, tête levée."""
    log_gcode(f"→ Position caméra : X{config.VISION_X} Y{config.VISION_Y} Z{config.Z_VISION}")
    move_xyz(config.VISION_X, config.VISION_Y, config.Z_VISION)


class NotHomed(RuntimeError):
    pass


def move_xyz(x, y, z, feed=None):
    """Déplacement absolu avec attente de fin de mouvement."""
    global last_position
    if not homed and not config.SIMULATION_MODE:
        # Sans homing, Marlin ne sait pas où est la tête : un déplacement absolu peut
        # l'envoyer au-delà de la course (courroie sautée le 20/10).
        log_gcode(f"⛔ Déplacement X{x:.0f} Y{y:.0f} Z{z:.0f} refusé : homing non fait")
        raise NotHomed("Homing non fait : touchez DÉMARRER LE ROBOT")
    z_max = getattr(config, 'Z_MAX_SAFE', None)
    if z_max is not None and z > z_max:
        log_gcode(f"⚠️ Z{z:.1f} demandé, limité à Z{z_max:.1f} (butée haute)")
        z = z_max
    last_position = {'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2)}
    send_gcode_raw("G90")
    cmd = f"G0 X{x:.2f} Y{y:.2f} Z{z:.2f} F{feed or settings['xy_feed'] * 60}"
    send_gcode_raw(cmd)
    send_gcode_raw("M400")
    if homed:
        save_z_state()


def read_marlin_position():
    """
    Lit la position réelle (M114) et met à jour last_position.
    Indispensable après un homing : la DiscoEasy fait son origine Y en butée MAX,
    la tête n'est donc pas en Y0 après G28.
    """
    global last_position
    if config.SIMULATION_MODE or not ser:
        return last_position
    import re
    with serial_lock:
        try:
            ser.write(b"M114\n")
            deadline = time.time() + 3
            while time.time() < deadline:
                line = ser.readline().decode(errors='ignore')
                m = re.search(r"X:\s*(-?[\d.]+)\s*Y:\s*(-?[\d.]+)\s*Z:\s*(-?[\d.]+)", line)
                if m:
                    last_position = {'x': float(m.group(1)), 'y': float(m.group(2)), 'z': float(m.group(3))}
                if line.strip().startswith("ok") and m is None and last_position:
                    break
        except Exception as e:
            log_gcode(f"Lecture position impossible : {e}")
    return last_position


# ── Homing ───────────────────────────────────────────────────────────────────
STATE_FILE = os.path.join(parent_dir, "robot_state.json")
homed = False          # True une fois X, Y et Z référencés depuis le démarrage du serveur


def save_z_state():
    """Mémorise la hauteur Z : elle reste valable hors tension (tiges filetées)."""
    import json
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({"x": last_position['x'], "y": last_position['y'], "z": last_position['z'], "homed": homed,
                       "date": time.strftime("%Y-%m-%d %H:%M:%S")}, f)
    except Exception:
        pass


def restore_homing_state():
    """
    Au redémarrage du SERVEUR (pas de la carte) : si Marlin est toujours à la dernière
    position enregistrée, son homing est encore valable — pas besoin de le refaire.
    """
    global homed, startup_state
    import json
    try:
        with open(STATE_FILE) as f:
            st = json.load(f)
    except Exception:
        return
    pos = last_position
    same = all(abs(pos[k] - st.get(k, 1e9)) < 0.05 for k in ('x', 'y', 'z'))
    if st.get("homed") and same and any(abs(pos[k]) > 0.01 for k in ('x', 'y', 'z')):
        homed = True
        startup_state = "verif"
        log_gcode("Homing conservé (la carte n'a pas redémarré).")


def load_z_state():
    import json
    try:
        with open(STATE_FILE) as f:
            return json.load(f).get("z")
    except Exception:
        return None


def home_axes():
    """
    Homing du firmware (G28). Le capteur descend toujours au centre du plateau :
    un pion de référence doit y être posé (le capteur détecte sa vis) ; l'aimant est
    alors au-dessus de d3/e3, vides en position de départ.
    Retourne True si Marlin a confirmé.
    """
    global homed, status_msg
    homed = False
    if config.SIMULATION_MODE:
        homed = True
        return True
    if not ser:
        return False
    t0 = time.time()
    ok = send_gcode_raw("G28")
    duree = time.time() - t0
    if ok and duree > 75:
        # Moteurs sans courant : Marlin envoie les pas jusqu'au bout de la course sans toucher de butée
        log_gcode(f"⚠️ Homing anormalement long ({duree:.0f} s) : alimentation de l'imprimante allumée ?")
        status_msg = "⚠️ Les moteurs ne semblent pas alimentés : vérifiez l'interrupteur de l'imprimante."
        return False
    if not ok:
        log_gcode("⚠️ Homing non confirmé par Marlin")
        return False
    pos = read_marlin_position()
    homed = True
    save_z_state()
    log_gcode(f"✅ Homing terminé ({duree:.0f} s) : X{pos['x']} Y{pos['y']} Z{pos['z']}")
    return True


def hover_over_check_square():
    """Place l'aimant au-dessus du roi e1 (vérification visuelle de la hauteur et du centrage)."""
    sq = config.VERIFY_SQUARE
    x, y = calculate_xy(sq)
    z_safe = max(travel_z() if pick_ready() else config.Z_BEFORE_PICK_CALIB, last_position['z'])
    lift_to(z_safe)
    move_xyz(x, y, z_safe)
    if surface_z() is not None:
        z = pick_z('k') + config.HOVER_MM
        move_xyz(x, y, z + config.PICK_APPROACH_MM)
        move_xyz(x, y, z, feed=config.FEED_APPROACH)
        log_gcode(f"Aimant {config.HOVER_MM:g} mm au-dessus de la vis en {sq}")
    else:
        log_gcode(f"Aimant au-dessus de {sq} : descendez Z (aimant ON) jusqu'à soulever la pièce, puis 📌")


_magnet_on_since = None   # timestamp d'activation (watchdog anti-surchauffe)

def magnet_gcode(state):
    """Commande G-code du relais de l'aimant (config.MAGNET_MODE)."""
    if getattr(config, 'MAGNET_MODE', 'pin') == 'servo':
        val = config.MAGNET_SERVO_ON if state else config.MAGNET_SERVO_OFF
        return f"M280 P{config.MAGNET_SERVO_IDX} S{val}"
    return f"M42 P{config.MAGNET_PIN} S{255 if state else 0}"


def magnet(state):
    """Active ou désactive le relais KS0055 de l'électroaimant (broche D11)."""
    global _magnet_on_since
    send_gcode_raw(magnet_gcode(state))
    _magnet_on_since = time.time() if state else None

def magnet_watchdog():
    """Thread : coupe l'aimant automatiquement si resté actif trop longtemps."""
    max_on = getattr(config, 'MAGNET_MAX_ON_SEC', 30)
    while True:
        time.sleep(2)
        if _magnet_on_since and (time.time() - _magnet_on_since) > max_on:
            log_gcode(f"⚠ RELAIS coupé automatiquement (>{max_on}s) — protection thermique")
            magnet(False)

# ── Calibration des prises (board_calibration.json) ──────────────────────────
PICK_CALIB_FILE = os.path.join(parent_dir, "board_calibration.json")
PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k']
PIECE_NAMES = {'p': 'Pion', 'n': 'Cavalier', 'b': 'Fou', 'r': 'Tour', 'q': 'Dame', 'k': 'Roi'}


def load_pick_calib():
    import json
    try:
        with open(PICK_CALIB_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f"⚠️ Calibration des prises illisible : {e}")
        return {}


def save_pick_calib():
    import json
    with open(PICK_CALIB_FILE, "w") as f:
        json.dump(pick_calib, f, indent=2)


pick_calib = load_pick_calib()


def pick_missing():
    """Liste de ce qu'il reste à calibrer avant de pouvoir déplacer des pièces."""
    missing = [p for p in ('a1', 'h1', 'a8') if p not in pick_calib]
    if 'z_surface' not in pick_calib and not pick_calib.get('pick_z'):
        missing.append('hauteur de prise')
    return missing


def pick_ready():
    return config.SIMULATION_MODE or not pick_missing()


def grid_to_xy(c, r):
    """Cellule → position de l'aimant, correction globale de prise comprise."""
    x, y = _grid_to_xy_raw(c, r)
    return x + config.PICK_OFFSET_X, y + config.PICK_OFFSET_Y


def _grid_to_xy_raw(c, r):
    """
    Cellule (colonne, rangée) de la grille 10x10 → position de l'aimant en mm.
    a1 = (1, 1). Avec la calibration, transformation affine définie par a1, h1, a8
    (corrige décalage, échelle et léger biais du plateau) ; sinon valeurs théoriques.
    """
    fit = _affine_fit()
    if fit is None:
        return config.grid_xy(c, r)
    (ax, bx, cx), (ay, by, cy) = fit
    x, y = ax * c + bx * r + cx, ay * c + by * r + cy
    # Correction locale : chaque point mesuré corrige son voisinage (pondération 1/d²),
    # le modèle passe ainsi exactement par toutes les cases centrées à la main.
    num_x = num_y = den = 0.0
    for (pc, pr), (px, py) in _measured_points().items():
        d2 = (c - pc) ** 2 + (r - pr) ** 2
        rx = px - (ax * pc + bx * pr + cx)
        ry = py - (ay * pc + by * pr + cy)
        if d2 < 1e-9:
            return px, py
        w = 1.0 / d2
        num_x += w * rx
        num_y += w * ry
        den += w
    return x + num_x / den, y + num_y / den


def _measured_points():
    """Cases où l'aimant a été centré à la main : {cellule (c, r): (x, y)}."""
    pts = {}
    for sq in ('a1', 'h1', 'a8'):
        if sq in pick_calib:
            pts[sq] = pick_calib[sq]
    pts.update(pick_calib.get('points', {}))
    return {(ord(sq[0]) - 96, int(sq[1])): xy for sq, xy in pts.items()}


def _affine_fit():
    """
    Transformation (colonne, rangée) → (x, y) ajustée sur tous les points mesurés
    (moindres carrés : exacte avec 3 points, moyenne les erreurs de centrage au-delà).
    """
    pts = _measured_points()
    if len(pts) < 3:
        return None
    import numpy as np
    cells = np.array([[c, r, 1.0] for (c, r) in pts])
    xs = np.array([xy[0] for xy in pts.values()])
    ys = np.array([xy[1] for xy in pts.values()])
    if np.linalg.matrix_rank(cells) < 3:
        return None
    fx = np.linalg.lstsq(cells, xs, rcond=None)[0]
    fy = np.linalg.lstsq(cells, ys, rcond=None)[0]
    return tuple(fx), tuple(fy)


def calculate_xy(square_name):
    """Calcule les coordonnées mm depuis une case (ex: 'e2')."""
    col = ord(square_name[0]) - ord('a')
    row = int(square_name[1]) - 1
    return grid_to_xy(col + 1, row + 1)


def graveyard_xy(color_white, idx):
    cells = config.WHITE_GRAVEYARD_CELLS if color_white else config.BLACK_GRAVEYARD_CELLS
    return grid_to_xy(*cells[min(idx, len(cells) - 1)])


def reserve_xy(color_white, idx):
    cells = config.WHITE_QUEEN_RESERVE_CELLS if color_white else config.BLACK_QUEEN_RESERVE_CELLS
    return grid_to_xy(*cells[min(idx, len(cells) - 1)])


def piece_height(ptype):
    """
    Hauteur de prise au-dessus du plateau (mm) : mesurée si un réglage fin a été
    enregistré, sinon hauteur commune des pièces (30 mm + vis 3 mm).
    """
    if surface_z() is None:
        return None
    pz = pick_calib.get('pick_z', {})
    if ptype in pz:
        return pz[ptype] - surface_z()
    return config.PIECE_HEIGHT_MM


def surface_z():
    """Z de l'aimant posé sur le plateau : mesuré, ou déduit de la hauteur de prise."""
    if 'z_surface' in pick_calib:
        return pick_calib['z_surface']
    pz = pick_calib.get('pick_z', {})
    if pz:
        return min(pz.values()) - config.PIECE_HEIGHT_MM
    return None


def pick_z(ptype):
    return surface_z() + piece_height(ptype)


def travel_z():
    """Hauteur des trajets à vide : au-dessus de la plus haute pièce."""
    heights = [h for h in (piece_height(t) for t in PIECE_TYPES) if h is not None]
    if heights and surface_z() is not None:
        return surface_z() + max(heights) + config.PICK_CLEARANCE_MM
    return config.Z_BEFORE_PICK_CALIB if homed else config.PICK_GOTO_Z

# =============================================================================
# GESTION CAMÉRA (JETSON CSI / USB) — ROBUSTE
# =============================================================================

class CameraStream:
    """
    Capture vidéo en thread séparé.
    Essaie d'abord la caméra CSI (GStreamer/nvargus) puis USB V4L2.
    Stocke le dernier frame JPEG et le dernier frame OpenCV brut.
    """
    def __init__(self):
        self.frame_jpg = None       # Bytes JPEG pour le streaming
        self.frame_raw = None       # np.ndarray BGR pour la vision
        self.running = True
        self.cam_ok = False
        self.cam_type = "Aucune"
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._update, daemon=True)
        self._thread.start()

    def _try_gstreamer_csi(self):
        """Tente d'ouvrir la caméra CSI via le pipeline GStreamer Jetson."""
        gst = (
            "nvarguscamerasrc sensor-id=0 ! "
            "video/x-raw(memory:NVMM), width=1280, height=720, format=NV12, framerate=30/1 ! "
            "nvvidconv flip-method=0 ! video/x-raw, width=640, height=360, format=BGRx ! "
            "videoconvert ! video/x-raw, format=BGR ! appsink drop=1"
        )
        cap = cv2.VideoCapture(gst, cv2.CAP_GSTREAMER)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret and frame is not None:
                print("✅ Caméra CSI (GStreamer) ouverte avec succès.")
                return cap, "CSI GStreamer"
        cap.release()
        return None, None

    def _try_v4l2(self, cam_id=0):
        """Tente d'ouvrir une caméra USB/V4L2 standard en forçant MJPG."""
        cap = cv2.VideoCapture(cam_id, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap = cv2.VideoCapture(cam_id)
        if cap.isOpened():
            # Forcer MJPG : nécessaire pour les caméras grand angle qui ne supportent pas YUYV
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self._apply_v4l2_controls(cam_id)
            ret, frame = cap.read()
            if ret and frame is not None:
                print(f"✅ Caméra USB (V4L2 id={cam_id}) ouverte avec succès.")
                return cap, f"USB V4L2 (id={cam_id})"
        cap.release()
        return None, None

    @staticmethod
    def _apply_v4l2_controls(cam_id):
        """Exposition / balance des blancs fixes (config.CAMERA_V4L2_CONTROLS)."""
        controls = getattr(config, 'CAMERA_V4L2_CONTROLS', {})
        if not controls:
            return
        args = ['v4l2-ctl', '-d', f'/dev/video{cam_id}']
        for k, v in controls.items():
            args += ['-c', f'{k}={v}']
        try:
            subprocess.run(args, capture_output=True, timeout=5)
        except Exception as e:
            print(f"⚠️ Réglages caméra non appliqués : {e}")

    def _create_error_frame(self, message="Caméra non disponible"):
        """Crée une image JPEG d'erreur quand aucune caméra n'est accessible."""
        import numpy as np
        img = np.zeros((360, 640, 3), dtype='uint8')
        # Fond sombre avec texte d'erreur
        cv2.putText(img, "CAMERA ERROR", (150, 160),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 220), 3)
        cv2.putText(img, message, (80, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (180, 180, 180), 2)
        cv2.putText(img, "Verifiez la connexion camera", (100, 270),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 100, 100), 1)
        _, buf = cv2.imencode('.jpg', img)
        return buf.tobytes()

    def _open_any(self):
        """Essaie CSI puis les deux index USB. Retourne (cap, label) ou (None, None)."""
        if config.USE_GSTREAMER:
            cap, label = self._try_gstreamer_csi()
            if cap is not None:
                return cap, label
        for cam_id in (config.CAM_ID_MAIN, config.CAM_ID_SECOND):
            cap, label = self._try_v4l2(cam_id)
            if cap is not None:
                return cap, label
        return None, None

    def _update(self):
        """Boucle principale de capture vidéo, avec reconnexion automatique."""
        while self.running:
            cap, cam_label = self._open_any()

            # --- Aucune caméra exploitable : on réessaie plus tard ---
            if cap is None:
                with self._lock:
                    if self.cam_ok or self.frame_jpg is None:
                        print("❌ Aucune caméra ne renvoie d'image. Nouvel essai toutes les 5 s...")
                    self.frame_jpg = self._create_error_frame("Aucune image recue - nouvel essai...")
                    self.cam_ok = False
                    self.cam_type = "Erreur"
                time.sleep(5)
                continue

            with self._lock:
                self.cam_ok = True
                self.cam_type = cam_label
            log_gcode(f"📷 Caméra connectée : {cam_label}")

            consecutive_failures = 0
            while self.running:
                ret, img = cap.read()
                if ret and img is not None:
                    consecutive_failures = 0
                    # Encodage JPEG
                    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    with self._lock:
                        self.frame_jpg = buf.tobytes()
                        self.frame_raw = img.copy()
                else:
                    consecutive_failures += 1
                    time.sleep(0.05)
                    if consecutive_failures >= 20:
                        # Perte de signal prolongée → frame d'erreur puis reconnexion
                        with self._lock:
                            self.frame_jpg = self._create_error_frame("Signal perdu - reconnexion...")
                            self.cam_ok = False
                        log_gcode("⚠️ Caméra : perte de signal prolongée, reconnexion.")
                        break

            cap.release()

    def get_jpg(self):
        with self._lock:
            return self.frame_jpg

    def get_raw(self):
        """Retourne le frame brut OpenCV (np.ndarray) pour la vision."""
        with self._lock:
            return self.frame_raw.copy() if self.frame_raw is not None else None

    def stop(self):
        self.running = False


camera = CameraStream()


# =============================================================================
# VISION : PHOTO DE RÉFÉRENCE ET DÉTECTION DU COUP HUMAIN
# =============================================================================

def grab_stable_frame(n=3):
    """Moyenne de n images récentes (réduit le bruit). None si pas de caméra."""
    if not camera.cam_ok:
        return None
    frames = []
    for _ in range(n * 4):
        f = camera.get_raw()
        if f is not None:
            frames.append(f.astype('float32'))
            if len(frames) >= n:
                break
        time.sleep(0.12)
    if not frames:
        return None
    return (sum(frames) / len(frames)).astype('uint8')


def capture_reference():
    """Photo du plateau stable, tête en position caméra (à appeler après le coup du robot)."""
    time.sleep(getattr(config, 'VISION_SETTLE_SEC', 1.0))
    if not vision_engine.is_calibrated():
        log_gcode("📷 Caméra non calibrée : saisie du coup à l'écran.")
        vision_engine.reference_frame = None
        return False
    frame = grab_stable_frame()
    if frame is None or not vision_engine.set_reference(frame):
        log_gcode("📷 Photo de référence impossible (caméra indisponible).")
        vision_engine.reference_frame = None
        return False
    log_gcode("📷 Photo de référence prise.")
    return True


def vision_ready():
    return camera.cam_ok and vision_engine.is_calibrated() and vision_engine.reference_frame is not None

# =============================================================================
# ÉTAT SIMULATION
# =============================================================================
sim_board = chess.Board()
sim_lock  = threading.Lock()


# =============================================================================
# ACTIONS PHYSIQUES (MOUVEMENTS DE PIÈCES)
# =============================================================================

class PickNotCalibrated(RuntimeError):
    pass


def path_is_clear(fx, fy, tx, ty, occupied):
    """
    Vrai si le segment (fx,fy)→(tx,ty) ne passe à moins d'une largeur de pièce
    d'aucun emplacement occupé (hors départ et arrivée).
    """
    if occupied is None:
        return False          # occupation inconnue : on vole haut par sécurité
    r = config.PIECE_FOOTPRINT_MM
    dx, dy = tx - fx, ty - fy
    L2 = dx * dx + dy * dy
    for ox, oy in occupied:
        if (ox - fx) ** 2 + (oy - fy) ** 2 < 4 or (ox - tx) ** 2 + (oy - ty) ** 2 < 4:
            continue           # la pièce elle-même (départ) ou sa case d'arrivée
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((ox - fx) * dx + (oy - fy) * dy) / L2))
        px, py = fx + t * dx, fy + t * dy
        if (ox - px) ** 2 + (oy - py) ** 2 < r * r:
            return False
    return True


def move_piece(fx, fy, tx, ty, ptype='k', occupied=None):
    """
    Déplace physiquement une pièce de type `ptype` ('p','n','b','r','q','k')
    de (fx,fy) à (tx,ty). L'aimant se pose sur la tête de la pièce (hauteur
    calibrée pour chaque type).
    Transport : si `occupied` (liste des emplacements occupés, en mm) montre un
    trajet libre, la pièce glisse à quelques mm du plateau ; sinon elle passe
    au-dessus des autres pièces. `occupied` est mis à jour (départ → arrivée).
    """
    if not pick_ready():
        raise PickNotCalibrated("Prises non calibrées : " + ", ".join(pick_missing()))
    if not homed and not config.SIMULATION_MODE:
        raise PickNotCalibrated("Homing non fait : touchez DÉMARRER (ou HOME dans la page Manuel)")
    ptype = ptype.lower()
    if config.SIMULATION_MODE and piece_height(ptype) is None:
        z_pick, z_travel, z_carry = config.Z_BOARD, config.Z_TRAVEL_REL, config.Z_TRAVEL_REL
    else:
        z_pick = pick_z(ptype)
        z_travel = travel_z()
        z_carry = z_travel + piece_height(ptype)
        if path_is_clear(fx, fy, tx, ty, occupied):
            z_carry = z_pick + config.LOW_FLIGHT_MM   # le bas de la pièce frôle le plateau
    z_near = z_pick + config.PICK_APPROACH_MM

    lift_to(z_travel)
    move_xyz(fx, fy, z_travel)
    move_xyz(fx, fy, z_near)
    move_xyz(fx, fy, z_pick, feed=config.FEED_APPROACH)
    magnet(True)
    send_gcode_raw(f"G4 P{config.MAGNET_DWELL_MS}")
    move_xyz(fx, fy, z_carry)
    move_xyz(tx, ty, z_carry)
    move_xyz(tx, ty, z_near)
    move_xyz(tx, ty, z_pick, feed=config.FEED_APPROACH)
    magnet(False)
    send_gcode_raw(f"G4 P{config.MAGNET_DWELL_MS}")
    move_xyz(tx, ty, z_travel)
    if occupied is not None:
        occupied[:] = [o for o in occupied if (o[0] - fx) ** 2 + (o[1] - fy) ** 2 >= 4]
        occupied.append((tx, ty))


def lift_to(z):
    """Remonte à la hauteur z (si plus bas) sans bouger en XY."""
    if last_position['z'] < z:
        move_xyz(last_position['x'], last_position['y'], z)


def lift_to_travel():
    lift_to(travel_z())


def history_positions(board):
    """
    [(position juste avant le coup, coup), ...] dans l'ordre chronologique.
    Reconstruit en dépilant une copie : tient compte des corrections faites avec
    MODIFIER PIÈCE (rejouer depuis la position de départ planterait dans ce cas).
    """
    b = board.copy()
    out = []
    while b.move_stack:
        move = b.pop()
        out.append((b.copy(stack=False), move))
    out.reverse()
    return out


def graveyard_contents(board):
    """
    Rejoue l'historique de `board` pour retrouver, dans l'ordre, le type de chaque
    pièce posée au cimetière (= ordre des slots). Les pions promus y vont aussi.
    Retourne: (liste_types_blancs, liste_types_noirs) avec chess.PieceType.
    """
    import chess as chess_lib
    white_types = []
    black_types = []
    for temp, move in history_positions(board):
        if temp.is_en_passant(move):
            ep_sq = chess_lib.square(
                chess_lib.square_file(move.to_square),
                chess_lib.square_rank(move.from_square)
            )
            pawn = temp.piece_at(ep_sq)
            if pawn:
                (white_types if pawn.color == chess_lib.WHITE else black_types).append(chess_lib.PAWN)
        else:
            captured = temp.piece_at(move.to_square)
            if captured:
                (white_types if captured.color == chess_lib.WHITE else black_types).append(captured.piece_type)
        if move.promotion:
            (white_types if temp.turn == chess_lib.WHITE else black_types).append(chess_lib.PAWN)
    return white_types, black_types


def queens_used(board):
    """Nombre de dames de réserve déjà utilisées (promotions) : (blancs, noirs)."""
    import chess as chess_lib
    w = b = 0
    for temp, move in history_positions(board):
        if move.promotion:
            if temp.turn == chess_lib.WHITE:
                w += 1
            else:
                b += 1
    return w, b


def reconstruct_capture_order():
    return graveyard_contents(game_engine.board)


def physical_occupancy(board, counts=None):
    """
    Emplacements occupés (mm) pour la position `board` : cases de l'échiquier,
    cimetières et dames de réserve encore en place.
    counts = (nb cimetière blanc, nb cimetière noir, dames blanches utilisées, dames noires)
    (registre de la partie) ; à défaut, déduits de l'historique de `board`.
    """
    import chess as chess_lib
    occ = [calculate_xy(chess_lib.square_name(sq)) for sq in board.piece_map()]
    if counts is None:
        w_types, b_types = graveyard_contents(board)
        wq, bq = queens_used(board)
        counts = (len(w_types), len(b_types), wq, bq)
    nw, nb, wq, bq = counts
    occ += [graveyard_xy(True, i) for i in range(nw)]
    occ += [graveyard_xy(False, i) for i in range(nb)]
    occ += [grid_to_xy(*c) for c in config.WHITE_QUEEN_RESERVE_CELLS[wq:]]
    occ += [grid_to_xy(*c) for c in config.BLACK_QUEEN_RESERVE_CELLS[bq:]]
    return occ


def game_counts():
    """Compteurs du registre de la partie : (cimetière blanc, noir, dames blanches, noires)."""
    import chess as chess_lib
    e = game_engine
    return (len(e.graveyard[chess_lib.WHITE]), len(e.graveyard[chess_lib.BLACK]),
            e.reserve_used(chess_lib.WHITE), e.reserve_used(chess_lib.BLACK))


def perform_physical_move(board_before, move, counts=None):
    """
    Exécute physiquement `move` à partir de la position `board_before`
    (position AVANT le coup — passer une copie).
    Gère prise, prise en passant, roque et promotion (dame de réserve).
    Les index de cimetière/réserve sont déduits de l'historique, donc restent
    justes même après une annulation de coup.
    """
    import chess as chess_lib
    board = board_before
    uci_move = move.uci()
    src_sq, dst_sq = uci_move[:2], uci_move[2:4]
    src_x, src_y = calculate_xy(src_sq)
    dst_x, dst_y = calculate_xy(dst_sq)
    if counts is None:   # parties légendaires : historique complet, jamais corrigé
        w_types, b_types = graveyard_contents(board)
        wq_, bq_ = queens_used(board)
        counts = (len(w_types), len(b_types), wq_, bq_)
    w_used = {chess_lib.WHITE: counts[0], chess_lib.BLACK: counts[1]}
    occupied = physical_occupancy(board, counts)

    def to_graveyard(x, y, color, ptype):
        gx, gy = graveyard_xy(color == chess_lib.WHITE, w_used[color])
        move_piece(x, y, gx, gy, ptype, occupied)
        w_used[color] += 1

    mover = board.piece_at(move.from_square)
    mover_t = chess_lib.piece_symbol(mover.piece_type) if mover else 'k'

    # --- 1. Prise : la pièce capturée part au cimetière ---
    captured_piece = board.piece_at(move.to_square)
    if captured_piece is not None:
        to_graveyard(dst_x, dst_y, captured_piece.color,
                     chess_lib.piece_symbol(captured_piece.piece_type))
    elif board.is_en_passant(move):
        ep_x, ep_y = calculate_xy(dst_sq[0] + src_sq[1])  # pion pris : même rangée que la source
        to_graveyard(ep_x, ep_y, not board.turn, 'p')

    # --- 2. Pièce principale (un pion promu part au cimetière, remplacé par une dame) ---
    if move.promotion:
        to_graveyard(src_x, src_y, board.turn, 'p')
        reserve = config.WHITE_QUEEN_RESERVE_CELLS if board.turn == chess_lib.WHITE else config.BLACK_QUEEN_RESERVE_CELLS
        used_idx = counts[2] if board.turn == chess_lib.WHITE else counts[3]
        if used_idx < len(reserve):
            qx, qy = reserve_xy(board.turn == chess_lib.WHITE, used_idx)
            move_piece(qx, qy, dst_x, dst_y, 'q', occupied)
        else:
            log_gcode(f"⚠ Plus de dame en réserve : posez-la à la main sur {dst_sq}")
    else:
        move_piece(src_x, src_y, dst_x, dst_y, mover_t, occupied)

    # --- 3. Roque : déplacer la tour ---
    if board.is_castling(move):
        king_side = chess_lib.square_file(move.to_square) == 6
        rook_src = ('h' if king_side else 'a') + dst_sq[1]
        rook_dst = ('f' if king_side else 'd') + dst_sq[1]
        rx1, ry1 = calculate_xy(rook_src)
        rx2, ry2 = calculate_xy(rook_dst)
        move_piece(rx1, ry1, rx2, ry2, 'r', occupied)


robot_busy = threading.Lock()   # un seul coup robot à la fois (double appui écran)

def move_steps(board_before, move):
    """Déplacements de pièces À VÉRIFIER pour un coup : la pièce jouée, et la tour au roque."""
    import chess as chess_lib
    mover = board_before.piece_at(move.from_square)
    steps = [(move.from_square, move.to_square,
              chess_lib.piece_symbol(mover.piece_type) if mover else 'k')]
    if board_before.is_castling(move):
        rank = chess_lib.square_rank(move.from_square)
        king_side = chess_lib.square_file(move.to_square) > chess_lib.square_file(move.from_square)
        steps.append((chess_lib.square(7 if king_side else 0, rank),
                      chess_lib.square(5 if king_side else 3, rank), 'r'))
    return steps


def verify_physical_move(pre_frame, board_before, move):
    """
    Compare la photo prise avant le coup du robot à une nouvelle photo (tête en position
    caméra). Une case de départ qui n'a pas changé = pièce pas attrapée.
    Retourne (pas attrapées [(départ, arrivée, type)], lâchées en route [...]),
    ou None si la vérification est impossible (pas de caméra, pas de photo d'avant).
    """
    if pre_frame is None or not camera.cam_ok or not vision_engine.is_calibrated():
        return None
    time.sleep(getattr(config, 'VISION_SETTLE_SEC', 1.0))
    post = grab_stable_frame()
    if post is None:
        return None
    scores = vision_engine.scores_between(pre_frame, post)
    if scores is None:
        return None
    thr = getattr(config, "VISION_DIFF_THRESHOLD", 18)
    not_picked, dropped = [], []
    for src, dst, t in move_steps(board_before, move):
        captured = board_before.piece_at(dst) is not None
        if scores[src] < thr:
            not_picked.append((src, dst, t))
        elif scores[dst] < thr and not captured:
            dropped.append((src, dst, t))
    return not_picked, dropped


def retry_steps(steps):
    """Refait les déplacements ratés (transport en hauteur : l'occupation réelle est incertaine)."""
    import chess as chess_lib
    for src, dst, t in steps:
        (sx, sy) = calculate_xy(chess_lib.square_name(src))
        (dx, dy) = calculate_xy(chess_lib.square_name(dst))
        log_gcode(f"🔁 Nouvelle tentative : {PIECE_NAMES[t]} {chess_lib.square_name(src)} → {chess_lib.square_name(dst)}")
        move_piece(sx, sy, dx, dy, t)


def describe_failure(not_picked, dropped):
    import chess as chess_lib
    parts = [f"{PIECE_NAMES[t]} {chess_lib.square_name(a)} pas attrapé(e)" for a, b, t in not_picked]
    parts += [f"{PIECE_NAMES[t]} pas posé(e) en {chess_lib.square_name(b)}" for a, b, t in dropped]
    return ", ".join(parts)


pre_move_frame = None     # photo du plateau juste avant le coup du robot
retry_state = None        # prise ratée en attente : {board_before, move, pre_frame, not_picked, dropped}


def execute_move_sequence(board_before, move, counts=None, pre_frame=None):
    """Thread : joue physiquement le coup du robot, revient en position caméra et vérifie."""
    global status_msg
    try:
        status_msg = f"Déplacement {move.uci()}..."
        try:
            perform_physical_move(board_before, move, counts)
        except PickNotCalibrated as e:
            log_gcode(f"⛔ {e}")
            status_msg = f"Robot : {move.uci()} — déplacez la pièce à la main ({e})"
            game_engine.start_clock(game_engine.board.turn)
            return
        log_gcode(f"ROBOT JOUE : {move.uci()}")
        move_to_vision_position()
        if not _check_robot_move(board_before, move, pre_frame):
            return      # prise ratée : on attend « Réessayer » ou « C'est réglé »
        _finish_robot_turn(move)
    finally:
        robot_busy.release()


def _check_robot_move(board_before, move, pre_frame):
    """Vérifie le coup ; en cas d'échec, mémorise l'état pour « Réessayer ». True si tout va bien."""
    global retry_state, status_msg
    res = verify_physical_move(pre_frame, board_before, move)
    if res is None or (not res[0] and not res[1]):
        retry_state = None
        return True
    not_picked, dropped = res
    retry_state = {"board_before": board_before, "move": move, "pre_frame": pre_frame,
                   "not_picked": not_picked, "dropped": dropped}
    status_msg = "⚠️ Prise ratée : " + describe_failure(not_picked, dropped)
    log_gcode(status_msg)
    return False


def _finish_robot_turn(move):
    """Coup du robot terminé et vérifié : photo de référence, message, horloge du joueur."""
    global status_msg
    capture_reference()
    if game_engine.is_game_over():
        status_msg = f"Robot a joué {move.uci()}. Partie terminée !"
    else:
        status_msg = f"Robot a joué {move.uci()}. À vous : jouez puis appuyez sur J'AI JOUÉ."
        game_engine.start_clock(game_engine.board.turn)   # au joueur, une fois le robot revenu


def plan_board_reset(board, grave_w, grave_b, reserve_w_used, reserve_b_used):
    """
    Calcule la liste des déplacements qui remettent toutes les pièces en position de départ.
    Emplacements : ('sq', case) | ('gy', blanc?, index) | ('res', blanc?).
    Règles : une pièce déjà bien placée ne bouge pas ; une case de départ vide reçoit une
    pièce du bon type (cimetière d'abord, puis pièce mal placée) ; une mauvaise pièce qui
    occupe une case de départ est d'abord posée sur une case vide du centre. Jamais de
    pièce posée sur un emplacement occupé.
    Retourne (déplacements [(source, destination, type)], pièces manquantes).
    """
    import chess as chess_lib
    W, B = chess_lib.WHITE, chess_lib.BLACK
    state = {('sq', sq): (p.color, p.piece_type) for sq, p in board.piece_map().items()}
    for color, types in ((W, grave_w), (B, grave_b)):
        for i, t in enumerate(types):
            state[('gy', color, i)] = (color, t)
    if not reserve_w_used:
        state[('res', W)] = (W, chess_lib.QUEEN)
    if not reserve_b_used:
        state[('res', B)] = (B, chess_lib.QUEEN)

    start = chess_lib.Board()
    target = {('sq', sq): (p.color, p.piece_type) for sq, p in start.piece_map().items()}
    target[('res', W)] = (W, chess_lib.QUEEN)
    target[('res', B)] = (B, chess_lib.QUEEN)

    def ok(loc):
        return loc in target and state.get(loc) == target[loc]

    def free_graveyard(color):
        cells = config.WHITE_GRAVEYARD_CELLS if color == W else config.BLACK_GRAVEYARD_CELLS
        for i in range(len(cells)):
            if ('gy', color, i) not in state:
                return ('gy', color, i)
        return None

    def free_buffer():
        """Case vide hors cases de départ (rangées 3 à 6), au plus près du centre."""
        order = sorted((sq for sq in chess_lib.SQUARES if 2 <= chess_lib.square_rank(sq) <= 5),
                       key=lambda q: abs(chess_lib.square_file(q) - 3.5) + abs(chess_lib.square_rank(q) - 3.5))
        for sq in order:
            if ('sq', sq) not in state:
                return ('sq', sq)
        return None

    def rank_source(loc):
        # cimetière / réserve d'abord, puis échiquier hors case de départ, puis mauvaise case de départ
        if loc[0] in ('gy', 'res'):
            return 0
        return 1 if loc not in target else 2

    moves, missing = [], []
    skipped = set()
    for _ in range(300):
        todo = [t for t in target if t not in skipped and not ok(t)]
        if not todo:
            break
        empty = [t for t in todo if t not in state]
        if empty:
            dst = empty[0]
            need = target[dst]
            sources = sorted((l for l, v in state.items() if v == need and not ok(l)), key=rank_source)
            if not sources:
                missing.append((need, dst))
                skipped.add(dst)
                continue
            src = sources[0]
        else:
            # toutes les cases à remplir sont occupées par de mauvaises pièces : on en déplace une
            src = todo[0]
            dst = free_buffer() or free_graveyard(state[src][0])
            if dst is None:
                missing.append((state[src], src))
                skipped.add(src)
                continue
        moves.append((src, dst, state[src][1]))
        state[dst] = state.pop(src)

    # Pièces en trop sur l'échiquier (ex. dame de promotion quand la réserve est déjà pleine)
    for loc in [l for l in state if l[0] == 'sq' and not ok(l)]:
        dst = free_graveyard(state[loc][0])
        if dst is not None:
            moves.append((loc, dst, state[loc][1]))
            state[dst] = state.pop(loc)
    return moves, missing, state


def _loc_xy(loc):
    import chess as chess_lib
    if loc[0] == 'sq':
        return calculate_xy(chess_lib.square_name(loc[1]))
    if loc[0] == 'gy':
        return graveyard_xy(loc[1], loc[2])
    return reserve_xy(loc[1], 0)


def _loc_name(loc):
    import chess as chess_lib
    if loc[0] == 'sq':
        return chess_lib.square_name(loc[1])
    if loc[0] == 'gy':
        return f"cimetière {'blanc' if loc[1] else 'noir'} {loc[2] + 1}"
    return f"réserve dame {'blanche' if loc[1] else 'noire'}"


def reset_board_physically():
    """Replace toutes les pièces en position de départ (voir plan_board_reset)."""
    import chess as chess_lib
    global status_msg

    log_gcode("═══ RANGEMENT DU PLATEAU ═══")
    status_msg = "Rangement du plateau en cours..."
    e = game_engine
    moves, missing, final_state = plan_board_reset(
        e.board, e.graveyard_types(chess_lib.WHITE), e.graveyard_types(chess_lib.BLACK),
        e.reserve_used(chess_lib.WHITE), e.reserve_used(chess_lib.BLACK))
    log_gcode(f"  {len(moves)} déplacements prévus")
    for (color, t), loc in missing:
        log_gcode(f"  ⚠ Manque {PIECE_NAMES[chess_lib.piece_symbol(t)]} {'blanc' if color else 'noir'} pour {_loc_name(loc)}")

    occupied = [_loc_xy(l) for l in _reset_state_before(moves, final_state)]
    for i, (src, dst, t) in enumerate(moves, 1):
        status_msg = f"Rangement du plateau : {i}/{len(moves)} — ne touchez pas les pièces"
        log_gcode(f"  {i}. {PIECE_NAMES[chess_lib.piece_symbol(t)]} {_loc_name(src)} → {_loc_name(dst)}")
        (sx, sy), (dx, dy) = _loc_xy(src), _loc_xy(dst)
        move_piece(sx, sy, dx, dy, chess_lib.piece_symbol(t), occupied)

    log_gcode("═══ PLATEAU RANGÉ ═══")
    game_engine.reset()   # les pièces sont en position initiale : la mémoire aussi
    status_msg = ("Plateau rangé ! Prêt pour une nouvelle partie." if not missing else
                  "Plateau rangé, mais des pièces manquent (voir le journal).")
    move_to_vision_position()
    capture_reference()


def _reset_state_before(moves, final_state):
    """Emplacements occupés AVANT le rangement (état final rejoué à l'envers)."""
    state = dict(final_state)
    for src, dst, t in reversed(moves):
        state[src] = state.pop(dst)
    return list(state)


def _reset_board_thread():
    global status_msg
    try:
        reset_board_physically()
    except PickNotCalibrated as e:
        log_gcode(f"⛔ {e}")
        status_msg = f"Rangement impossible : {e}"
    finally:
        robot_busy.release()


# =============================================================================
# ROUTES FLASK — STREAMING CAMÉRA
# =============================================================================

@app.errorhandler(NotHomed)
def _not_homed(e):
    return jsonify({"status": "error", "msg": str(e)}), 400


@app.route('/')
def index():
    return render_template('index.html', coach=False)


@app.route('/progresser')
def progresser():
    """Partie normale avec le robot + analyse de chaque coup du joueur."""
    return render_template('index.html', coach=True)


@app.route('/progresser/ouvertures')
def ouvertures():
    return render_template('ouvertures.html')


# ── Coach (page Progresser) ───────────────────────────────────────────────────
coach = Coach()
coach_mode = False        # partie lancée depuis la page Progresser
coach_log = []            # appréciations des coups du joueur, dans l'ordre


def coach_grade_async(board_before, move, ply):
    """Analyse en parallèle : ne retarde pas la réponse du robot."""
    def run():
        try:
            g = coach.grade(board_before, move)
            g["ply"] = ply
            g["num"] = board_before.fullmove_number
            coach_log.append(g)
            log_gcode(f"🎓 {g['san']} : {g['label']}" + (f" (meilleur : {g['best_san']})" if g['best_san'] else ""))
        except Exception as e:
            log_gcode(f"Analyse du coup impossible : {e}")
    threading.Thread(target=run, daemon=True).start()


# ── Exercices d'ouvertures ────────────────────────────────────────────────────
trainer = OpeningTrainer()


@app.route('/api/op/list')
def api_op_list():
    return jsonify([{"id": o["id"], "name": o["name"], "side": o["side"], "idea": o["idea"]} for o in OPENINGS])


def _op_state(**extra):
    return jsonify({"status": "ok", "fen": trainer.board.fen(),
                    "side": trainer.op["side"] if trainer.op else "white",
                    "name": trainer.op["name"] if trainer.op else "",
                    "idea": trainer.op["idea"] if trainer.op else "",
                    "progress": trainer.idx, "total": len(trainer.op["moves"]) if trainer.op else 0,
                    "finished": trainer.finished(),
                    "legal_moves": [m.uci() for m in trainer.board.legal_moves], **extra})


@app.route('/api/op/start', methods=['POST'])
def api_op_start():
    if not trainer.start((request.get_json(silent=True) or {}).get('id', '')):
        return jsonify({"status": "error", "msg": "Ouverture inconnue"}), 404
    # Coups joués d'office par l'adversaire avant le premier coup du joueur (ex. 1.e4 pour les noirs)
    tmp, replies = chess.Board(), []
    for m in trainer.board.move_stack:
        replies.append(fr_san(tmp.san(m)))
        tmp.push(m)
    return _op_state(replies=replies)


@app.route('/api/op/move', methods=['POST'])
def api_op_move():
    result, info = trainer.try_move((request.get_json(silent=True) or {}).get('uci', ''))
    return _op_state(result=result, **info)


@app.route('/api/op/hint', methods=['POST'])
def api_op_hint():
    return _op_state(hint=trainer.hint())


@app.route('/op/board.svg')
def op_board_svg():
    import chess.svg
    b = trainer.board
    fill = {}
    sel = request.args.get('sel')
    if sel:
        try:
            sq = chess.parse_square(sel)
            fill[sq] = "#aaffaa"
            for m in b.legal_moves:
                if m.from_square == sq:
                    fill[m.to_square] = "#ffff88"
        except ValueError:
            pass
    last = b.peek() if b.move_stack else None
    flipped = bool(trainer.op and trainer.op["side"] == "black")
    svg = chess.svg.board(b, lastmove=last, fill=fill, coordinates=False, size=480, flipped=flipped)
    return Response(svg, mimetype='image/svg+xml')


@app.route('/video_feed')
def video_feed():
    """Stream MJPEG de la caméra en direct."""
    def gen():
        while True:
            jpg = camera.get_jpg()
            if jpg:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpg + b'\r\n')
            time.sleep(0.04)  # ~25 FPS max
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/snapshot')
def snapshot():
    """Retourne un seul frame JPEG — utilisé par le polling JS (plus compatible que MJPEG)."""
    jpg = camera.get_jpg()
    if jpg:
        return Response(jpg, mimetype='image/jpeg')
    return Response(status=204)  # No Content si pas de frame


@app.route('/api/vision_frame')
def api_vision_frame():
    """
    Retourne le dernier frame caméra en JPEG (utilisé par screen_ui.py).
    Si la vision IA est activée, retourne le frame annoté de debug.
    """
    raw = camera.get_raw()
    if raw is not None:
        debug_frame = vision_engine.get_debug_frame(raw)
        _, buf = cv2.imencode('.jpg', debug_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return Response(buf.tobytes(), mimetype='image/jpeg')

    # Aucun frame disponible → retourner l'image d'erreur
    jpg = camera.get_jpg()
    if jpg:
        return Response(jpg, mimetype='image/jpeg')
    return jsonify({"error": "Aucun frame disponible"}), 503


@app.route('/api/camera_status')
def api_camera_status():
    """Retourne le statut de la caméra pour diagnostic."""
    return jsonify({
        "cam_ok": camera.cam_ok,
        "cam_type": camera.cam_type,
        "has_frame": camera.get_jpg() is not None
    })


# =============================================================================
# ROUTES FLASK — ÉTAT DU JEU
# =============================================================================

@app.route('/board.svg')
def board_svg():
    """Génère le visuel SVG de l'échiquier actuel."""
    import chess.svg
    last_move = game_engine.board.peek() if game_engine.board.move_stack else None
    fill = {}
    selected = request.args.get('sel')
    if selected:
        try:
            sq = chess.parse_square(selected)
            fill[sq] = "#aaffaa"
            for m in game_engine.board.legal_moves:
                if m.from_square == sq:
                    fill[m.to_square] = "#ffff88"
        except ValueError:
            pass
    svg = chess.svg.board(
        board=game_engine.board,
        lastmove=last_move,
        fill=fill,
        coordinates=False,   # sans marge : un clic tombe exactement sur la bonne case
        size=450
    )
    return Response(svg, mimetype='image/svg+xml')


@app.route('/api/set_clock_time', methods=['POST'])
def api_set_clock_time():
    """Règle le temps initial de l'horloge (en minutes)."""
    minutes = max(1, min(90, int(request.json.get('minutes', 10))))
    game_engine.initial_time = minutes * 60
    game_engine.time_white   = game_engine.initial_time
    game_engine.time_black   = game_engine.initial_time
    game_engine.clock_running = False
    log_gcode(f"HORLOGE : {minutes} min par joueur")
    return jsonify({"status": "ok", "minutes": minutes})


@app.route('/api/set_clock', methods=['POST'])
def api_set_clock():
    """Active ou désactive l'horloge."""
    global clock_enabled
    clock_enabled = bool(request.json.get('enabled', True))
    if not clock_enabled:
        game_engine.stop_clock()
    return jsonify({"status": "ok", "clock_enabled": clock_enabled})


@app.route('/api/status')
def api_status():
    """Retourne l'état complet du jeu (compatible screen_ui.py)."""
    if clock_enabled:
        game_engine.update_clock()
    outcome = game_engine.board.outcome()
    # Calculs sur l'historique : ne doivent jamais bloquer l'écran de jeu
    try:
        wq, bq = game_engine.reserve_used(chess.WHITE), game_engine.reserve_used(chess.BLACK)
        moves = _build_move_history()
    except Exception as e:
        log_gcode(f"⚠️ Historique illisible : {e}")
        wq = bq = 0
        moves = []
    return jsonify({
        'fen': game_engine.get_fen(),
        'turn': 'white' if game_engine.board.turn else 'black',
        'robot_turn': (game_engine.board.turn == chess.WHITE) != config.HUMAN_PLAYS_WHITE,
        'human_plays_white': config.HUMAN_PLAYS_WHITE,
        'logs': gcode_log_buffer[-10:],
        'status_msg': status_msg,
        'time_white': round(game_engine.time_white, 1),
        'time_black': round(game_engine.time_black, 1),
        'game_over': game_engine.is_game_over(),
        'outcome': ('pat' if outcome.termination == chess.Termination.STALEMATE else outcome.result()) if outcome else None,
        'legal_moves': game_engine.get_legal_moves(),
        'captured': game_engine.get_captured_pieces(),
        'move_count': len(game_engine.board.move_stack),
        'clock_enabled': clock_enabled,
        'used_white_queens': wq,
        'used_black_queens': bq,
        'clock_minutes': round(game_engine.initial_time / 60, 1),
        'moves': moves,
        'robot_busy': robot_busy.locked(),
        'sound': settings['sound'],
        'coach': sorted(coach_log, key=lambda g: g['ply'])[-30:] if coach_mode else None,
        'retry': (None if retry_state is None else {
            'msg': status_msg, 'can_retry': bool(retry_state['not_picked'])}),
        'clock_side': (None if not game_engine.clock_running else
                       ('white' if (game_engine.board.turn if game_engine.clock_side is None
                                    else game_engine.clock_side) else 'black')),
        'startup_state': startup_state,
        'homed': homed,
        'pick_ready': pick_ready(),
        'vision_ready': vision_ready(),
    })


def _build_move_history():
    """Retourne l'historique des coups en notation SAN."""
    result = []
    for temp, move in history_positions(game_engine.board):
        try:
            result.append(temp.san(move))
        except Exception:
            result.append(move.uci())
    return result


# =============================================================================
# ROUTES FLASK — COMMANDES DE JEU
# =============================================================================

@app.route('/api/undo', methods=['POST'])
def api_undo():
    """Annule le dernier coup (humain + robot)."""
    game_engine.undo()
    coach_log[:] = [g for g in coach_log if g['ply'] < game_engine.ply]
    vision_engine.reference_frame = None   # plateau remis à la main : reprendre la photo
    log_gcode("ANNULATION du dernier coup — replacez les pièces à la main.")
    return jsonify({"status": "ok", "fen": game_engine.get_fen()})


@app.route('/api/reset', methods=['POST'])
def api_reset():
    """Remet le jeu à zéro."""
    global status_msg
    game_engine.reset()
    status_msg = "Nouvelle partie ! À vous de jouer (Blancs)."
    log_gcode("NOUVELLE PARTIE.")
    return jsonify({"status": "ok"})


@app.route('/api/reset_board_physical', methods=['POST'])
def api_reset_board_physical():
    """Lance le rangement physique du plateau dans un thread séparé."""
    global status_msg
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est déjà en mouvement."}), 409
    status_msg = "Rangement du plateau — ne touchez pas les pièces !"
    t = threading.Thread(target=_reset_board_thread, daemon=True)
    t.start()
    return jsonify({"status": "ok"})


@app.route('/api/set_color', methods=['POST'])
def api_set_color():
    """Choisit la couleur du joueur humain et démarre une nouvelle partie."""
    global status_msg
    human_plays_white = bool(request.json.get('human_plays_white', True))
    config.HUMAN_PLAYS_WHITE = human_plays_white
    global coach_mode
    coach_mode = bool(request.json.get('coach', False))
    coach_log.clear()
    game_engine.reset()
    robot_plays_first = not human_plays_white
    if robot_plays_first:
        status_msg = "Robot joue les Blancs — retirez vos mains et appuyez sur JOUER ROBOT."
    else:
        status_msg = "Nouvelle partie ! Jouez votre coup puis appuyez sur J'AI JOUÉ."
    global retry_state
    retry_state = None
    log_gcode(f"NOUVELLE PARTIE — Humain={'Blancs' if human_plays_white else 'Noirs'}")
    threading.Thread(target=_prepare_new_game, daemon=True).start()
    return jsonify({"status": "ok",
                    "human_plays_white": human_plays_white,
                    "robot_plays_first": robot_plays_first})


def _prepare_new_game():
    """Tête en position caméra puis photo de référence du plateau de départ."""
    if not robot_busy.acquire(timeout=120):
        return
    try:
        if not homed and not config.SIMULATION_MODE:
            log_gcode("Nouvelle partie : homing non fait, la tête ne bouge pas.")
            return
        move_to_vision_position()
        capture_reference()
    except NotHomed:
        pass
    finally:
        robot_busy.release()


@app.route('/api/startup/home', methods=['POST'])
def api_startup_home():
    """Bouton DÉMARRER de l'écran : homing (capteur sur la pièce de référence)."""
    global startup_state, status_msg
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est déjà en mouvement."}), 409

    def run():
        global startup_state, status_msg
        try:
            startup_state = "homing"
            status_msg = "Démarrage : mise en position du robot..."
            if home_axes():
                startup_state = "retrait"
                status_msg = "Retirez le pion de référence du centre du plateau."
            else:
                startup_state = "erreur"
        finally:
            robot_busy.release()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/api/startup/reset', methods=['POST'])
def api_startup_reset():
    """Relance la procédure de démarrage guidée (pion de référence, homing, vérification)."""
    global startup_state, homed
    if robot_busy.locked():
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    startup_state = "attente"
    homed = False
    return jsonify({"status": "ok"})


@app.route('/api/startup/removed', methods=['POST'])
def api_startup_removed():
    """Pion de référence retiré : l'aimant va au-dessus du roi e1 pour vérification."""
    global startup_state, status_msg
    if not homed:
        return jsonify({"status": "error", "msg": "Homing non fait."}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409

    def run():
        global startup_state, status_msg
        try:
            hover_over_check_square()
            startup_state = "verif"
            status_msg = f"Vérifiez que l'aimant est juste au-dessus du roi {config.VERIFY_SQUARE}."
        finally:
            robot_busy.release()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/api/startup/confirm', methods=['POST'])
def api_startup_confirm():
    """Après vérification visuelle : position caméra + photo de référence."""
    global startup_state, status_msg
    if not homed:
        return jsonify({"status": "error", "msg": "Homing non fait."}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409

    def run():
        global startup_state, status_msg
        try:
            move_to_vision_position()
            capture_reference()
            startup_state = "pret"
            status_msg = "Robot prêt. Jouez votre coup puis appuyez sur J'AI JOUÉ."
        finally:
            robot_busy.release()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/api/set_elo', methods=['POST'])
def api_set_elo():
    """Change le niveau ELO de Stockfish."""
    elo = request.json.get('elo', config.DEFAULT_ELO)
    elo = max(100, min(3200, int(elo)))
    game_engine.set_elo(elo)
    log_gcode(f"ELO fixé à {elo}.")
    return jsonify({"status": "ok", "elo": elo})


@app.route('/api/edit_board', methods=['POST'])
def api_edit_board():
    """Modifie manuellement une pièce sur le plateau (correction mémoire)."""
    import chess as chess_lib
    square_name = request.json.get('square', '')
    piece_symbol = request.json.get('piece', '')

    try:
        sq = chess_lib.parse_square(square_name)
        if piece_symbol == '':
            game_engine.board.remove_piece_at(sq)
        else:
            piece = chess_lib.Piece.from_symbol(piece_symbol)
            game_engine.board.set_piece_at(sq, piece)
        log_gcode(f"CORRECTION PLATEAU : {square_name} = '{piece_symbol}'")
        return jsonify({"status": "ok", "fen": game_engine.get_fen()})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 400


@app.route('/api/export_usb', methods=['POST'])
def api_export_usb():
    """Exporte les logs de partie sur une clé USB montée automatiquement."""
    import pwd
    username = pwd.getpwuid(os.getuid()).pw_name

    # Chercher dans /media/<user>/<clé>/ (standard Ubuntu), puis fallbacks
    search_roots = [
        f"/media/{username}",   # Ubuntu : /media/pp/<clé>/
        "/media/jetson",
        "/media/user",
        "/mnt/usb",
    ]
    usb_root = None
    for path in search_roots:
        if not os.path.isdir(path):
            continue
        try:
            subdirs = [
                os.path.join(path, d) for d in os.listdir(path)
                if os.path.isdir(os.path.join(path, d))
                and os.access(os.path.join(path, d), os.W_OK)
            ]
            if subdirs:
                usb_root = subdirs[0]
                break
        except PermissionError:
            continue

    if not usb_root:
        return jsonify({"status": "error", "msg": "Aucune clé USB détectée."}), 404

    try:
        dst_file = os.path.join(usb_root, f"partie_{time.strftime('%Y%m%d_%H%M%S')}.txt")
        with open(dst_file, 'w', encoding='utf-8') as f:
            f.write("=== ROBOT ÉCHECS - LOG DE PARTIE ===\n")
            f.write(f"Date : {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write("--- FEN Finale ---\n")
            f.write(game_engine.get_fen() + "\n\n")
            f.write("--- PGN ---\n")
            f.write(game_engine.get_pgn() + "\n\n")
            f.write("--- Logs GCode ---\n")
            f.write("\n".join(gcode_log_buffer))
        log_gcode(f"Export USB : {dst_file}")
        return jsonify({"status": "ok", "msg": f"Sauvegardé sur {usb_root}"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route('/api/bot_move', methods=['POST'])
def api_bot_move():
    """Demande à Stockfish de calculer et jouer un coup."""
    global status_msg
    robot_turn = (game_engine.board.turn == chess.WHITE) != config.HUMAN_PLAYS_WHITE
    if not robot_turn or game_engine.is_game_over():
        return jsonify({"status": "error", "msg": "Ce n'est pas au robot de jouer."}), 400
    if not pick_ready():
        return jsonify({"status": "error",
                        "msg": "Calibrez d'abord les prises (page Manuel) : " + ", ".join(pick_missing())}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est déjà en train de jouer."}), 409
    game_engine.start_clock(game_engine.board.turn)   # temps du robot : réflexion + mouvements
    global pre_move_frame
    pre_move_frame = grab_stable_frame(2) if vision_ready() else None
    move = start_robot_reply()
    if not move:
        return jsonify({"status": "error"}), 500
    return jsonify({"status": "ok", "uci": move.uci()})


def start_robot_reply():
    """
    Stockfish choisit un coup et le robot le joue (thread). L'appelant détient robot_busy,
    qui est relâché à la fin du mouvement (ou tout de suite en cas d'erreur).
    """
    global status_msg
    status_msg = "Stockfish réfléchit..."
    move = game_engine.compute_bot_move()
    if not move:
        robot_busy.release()
        status_msg = "Erreur IA."
        return None
    board_before = game_engine.board.copy()
    counts = game_counts()           # état du cimetière AVANT ce coup
    game_engine.push_move(move)      # inscrit la pièce prise au registre
    # L'horloge du joueur ne démarre qu'une fois le robot revenu en position (execute_move_sequence)
    threading.Thread(target=execute_move_sequence, args=(board_before, move, counts, pre_move_frame),
                     daemon=True).start()
    return move


@app.route('/api/validate_move', methods=['POST'])
def api_validate_move():
    """
    Le joueur a bougé sa pièce sur le plateau et appuie sur J'AI JOUÉ.
    - sans 'uci' : photo, comparaison avec la référence, choix du coup légal correspondant ;
    - avec 'uci' : coup saisi à l'écran (secours si la caméra n'a pas pu trancher).
    Si le coup est reconnu, le robot répond aussitôt.
    """
    global status_msg
    data = request.get_json(silent=True) or {}
    human_turn = (game_engine.board.turn == chess.WHITE) == config.HUMAN_PLAYS_WHITE
    if not human_turn or game_engine.is_game_over():
        return jsonify({"status": "error", "msg": "Ce n'est pas à vous de jouer."}), 400
    if retry_state is not None:
        return jsonify({"status": "error", "msg": "Le robot a raté une prise : réessayez ou corrigez d'abord."}), 400
    if not pick_ready():
        return jsonify({"status": "error",
                        "msg": "Calibrez d'abord les prises (page Manuel) : " + ", ".join(pick_missing())}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409

    uci = (data.get('uci') or '').strip().lower()
    if uci:
        source = "écran"
        try:
            move = chess.Move.from_uci(uci)
            if move not in game_engine.board.legal_moves:
                move = chess.Move.from_uci(uci + 'q')   # promotion : dame par défaut
        except ValueError:
            move = None
        if move is None or move not in game_engine.board.legal_moves:
            robot_busy.release()
            return jsonify({"status": "illegal", "msg": f"Coup illégal : {uci}"}), 400
    else:
        source = "caméra"
        if not vision_ready():
            robot_busy.release()
            reason = ("Caméra indisponible" if not camera.cam_ok else
                      "Caméra non calibrée" if not vision_engine.is_calibrated() else
                      "Pas de photo de référence")
            return jsonify({"status": "manual", "msg": f"{reason} : indiquez votre coup à l'écran."})
        status_msg = "📷 Analyse de votre coup..."
        frame = grab_stable_frame()
        if frame is not None:
            move, why = vision_engine.detect_legal_move(game_engine.board, frame)
        else:
            move, why = None, "Photo impossible."
        if move is None:
            robot_busy.release()
            status_msg = f"Coup non reconnu : {why}"
            log_gcode(f"📷 Coup non reconnu : {why}")
            return jsonify({"status": "manual", "msg": f"{why} Indiquez votre coup à l'écran."})

    global pre_move_frame
    if source == "caméra":
        pre_move_frame = frame
    else:
        pre_move_frame = grab_stable_frame(2) if vision_ready() else None
    san = game_engine.board.san(move)
    if coach_mode:
        coach_grade_async(game_engine.board.copy(stack=False), move, game_engine.ply)
    game_engine.push_move(move)      # une pièce prise par le joueur va au cimetière (registre)
    game_engine.start_clock(game_engine.board.turn)   # le temps du robot court : réflexion + mouvements
    log_gcode(f"JOUEUR JOUE : {move.uci()} ({san}, {source})")
    if game_engine.is_game_over():
        robot_busy.release()
        status_msg = f"Vous avez joué {san}. Partie terminée !"
        return jsonify({"status": "ok", "human": move.uci(), "san": san, "source": source, "robot": None})
    reply = start_robot_reply()
    return jsonify({"status": "ok", "human": move.uci(), "san": san, "source": source,
                    "robot": reply.uci() if reply else None})


@app.route('/api/vision/calibrate', methods=['POST'])
def api_vision_calibrate():
    """Calibration : plateau vide sauf 4 dames noires sur a1, h1, a8 et h8."""
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    try:
        move_to_vision_position()
        time.sleep(getattr(config, 'VISION_SETTLE_SEC', 1.0))
        frame = grab_stable_frame()
        if frame is None:
            return jsonify({"status": "error", "msg": "Caméra indisponible."}), 503
        if not vision_engine.auto_calibrate(frame):
            n = getattr(vision_engine, 'last_marker_count', 0)
            return jsonify({"status": "error",
                            "msg": f"{n} marqueur(s) trouvé(s) au lieu de 4. "
                                   "Plateau vide + 4 dames noires sur a1, h1, a8 et h8."}), 400
        vision_engine.save_calibration()
        log_gcode("📷 Calibration caméra réussie et enregistrée.")
        return jsonify({"status": "ok", "msg": "Calibration réussie et enregistrée."})
    finally:
        robot_busy.release()


@app.route('/api/vision/learn_pieces', methods=['POST'])
def api_vision_learn_pieces():
    """Apprend la forme des socles : toutes les pièces en position de départ."""
    if not vision_engine.is_calibrated():
        return jsonify({"status": "error", "msg": "Calibrez d'abord la caméra."}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    try:
        move_to_vision_position()
        time.sleep(getattr(config, 'VISION_SETTLE_SEC', 1.0))
        frame = grab_stable_frame(5)
        if frame is None:
            return jsonify({"status": "error", "msg": "Caméra indisponible."}), 503
        rep = vision_engine.learn_piece_bases(frame, chess.Board())
        log_gcode(f"♟ Socles appris : {rep['learned']} pièces, fiabilité estimée {rep['type_accuracy']} %")
        return jsonify({"status": "ok", **rep,
                        "msg": f"{rep['learned']} socles mémorisés — fiabilité estimée {rep['type_accuracy']} % "
                               f"(type de pièce), {rep['full_accuracy']} % (type + couleur)."})
    finally:
        robot_busy.release()


@app.route('/piece_shapes.jpg')
def piece_shapes_sheet():
    """Planche de contrôle de l'apprentissage des socles."""
    path = os.path.splitext(vision_engine.PIECE_FILE)[0] + ".jpg"
    if not os.path.exists(path):
        return Response(status=404)
    with open(path, 'rb') as fh:
        return Response(fh.read(), mimetype='image/jpeg')


@app.route('/api/vision/reference', methods=['POST'])
def api_vision_reference():
    """Reprend la photo de référence (après avoir remis des pièces en place à la main)."""
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    try:
        move_to_vision_position()
        ok = capture_reference()
        return jsonify({"status": "ok" if ok else "error",
                        "msg": "Photo de référence prise." if ok else "Photo impossible (caméra / calibration)."})
    finally:
        robot_busy.release()


@app.route('/api/player_move', methods=['POST'])
def api_player_move():
    """Enregistre un coup du joueur humain (validé par bouton/interface)."""
    global status_msg
    uci = request.json.get('uci', '')
    success = game_engine.push_uci(uci)
    if success:
        game_engine.stop_clock()
        log_gcode(f"JOUEUR JOUE : {uci}")
        status_msg = f"Coup {uci} enregistré. Robot réfléchit..."
        return jsonify({"status": "ok", "fen": game_engine.get_fen()})
    return jsonify({"status": "illegal", "msg": f"Coup illégal : {uci}"}), 400


@app.route('/api/run_tests', methods=['POST'])
def api_run_tests():
    """Lance les tests unitaires et retourne le rapport."""
    loader = unittest.TestLoader()
    tests_dir = os.path.join(parent_dir, 'tests')
    suite = loader.discover(tests_dir, pattern='test_*.py')
    stream = stdlib_io.StringIO()
    runner = unittest.TextTestRunner(stream=stream, verbosity=2)
    result = runner.run(suite)
    output = stream.getvalue()

    return jsonify({
        "status": "ok" if result.wasSuccessful() else "fail",
        "run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "output": output[-2000:]  # Limité pour l'affichage
    })


# =============================================================================
# ROUTES FLASK — COMMANDES MOTEURS
# =============================================================================

@app.route('/api/magnet', methods=['POST'])
def api_magnet():
    state = request.json.get('state', False)
    magnet(state)
    log_gcode(f"AIMANT : {'ON' if state else 'OFF'}")
    return jsonify({"status": "ok"})


@app.route('/cmd/home', methods=['POST'])
def cmd_home():
    global last_position
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Robot déjà en mouvement (homing en cours ?)"}), 409
    log_gcode("MOTEURS : Homing G28 (pion de référence au centre du plateau)")

    def run():
        try:
            if not home_axes():
                log_gcode("⚠️ Homing non confirmé par Marlin")
        finally:
            robot_busy.release()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/cmd/goto_vision', methods=['POST'])
def cmd_goto_vision():
    """Déplace le robot en position caméra (depuis l'interface)."""
    threading.Thread(target=move_to_vision_position, daemon=True).start()
    return jsonify({"status": "ok",
                    "x": config.VISION_X, "y": config.VISION_Y, "z": config.Z_VISION})


@app.route('/cmd/move_manual', methods=['POST'])
def cmd_manual():
    global last_position
    axis = request.json.get('axis', 'X').upper()
    dist = float(request.json.get('dist', 0))
    z_max = getattr(config, 'Z_MAX_SAFE', None)
    if axis == 'Z' and homed and z_max is not None and last_position['z'] + dist > z_max:
        dist = max(0.0, z_max - last_position['z'])
    feed = int(request.json.get('feed', 2000))
    send_gcode_raw("G91")  # Relatif
    send_gcode_raw(f"G0 {axis}{dist:.1f} F{feed}")
    send_gcode_raw("G90")  # Absolu
    log_gcode(f"MANUEL : {axis} {dist:+.1f}mm F{feed}")
    if axis == 'X':
        last_position['x'] = round(last_position['x'] + dist, 2)
    elif axis == 'Y':
        last_position['y'] = round(last_position['y'] + dist, 2)
    elif axis == 'Z':
        last_position['z'] = round(last_position['z'] + dist, 2)
        if homed:
            save_z_state()
    return jsonify({"status": "ok", "x": last_position['x'], "y": last_position['y'], "z": last_position['z']})


@app.route('/cmd/physical_move', methods=['POST'])
def cmd_physical_move():
    """
    Mode manuel : déplace physiquement une pièce de src vers dst.
    Accepte cases échiquier (ex: 'e2') ou cimetières (ex: 'wg0').
    """
    src = request.json.get('src', '')
    dst = request.json.get('dst', '')
    # Type de pièce : donné par la page, sinon celle de la partie sur la case, sinon le roi (le plus haut)
    ptype = (request.json.get('piece') or '').lower()
    if not ptype and len(src) == 2:
        try:
            p_ = game_engine.board.piece_at(chess.parse_square(src))
            ptype = p_.symbol().lower() if p_ else ''
        except ValueError:
            pass
    ptype = ptype if ptype in PIECE_TYPES else 'k'

    def resolve_xy(loc):
        """Résout la position XY d'un slot quelconque."""
        if len(loc) == 2 and loc[0].isalpha() and loc[1].isdigit():
            return calculate_xy(loc)
        # Cimetière blanc
        if loc.startswith('wg'):
            return graveyard_xy(True, int(loc[2:]) % len(config.WHITE_GRAVEYARD_CELLS))
        # Cimetière noir
        if loc.startswith('bg'):
            return graveyard_xy(False, int(loc[2:]) % len(config.BLACK_GRAVEYARD_CELLS))
        # Réserve Dame blanche
        if loc.startswith('wq'):
            return reserve_xy(True, int(loc[2:]))
        # Réserve Dame noire
        if loc.startswith('bq'):
            return reserve_xy(False, int(loc[2:]))
        raise ValueError(f"Slot inconnu : {loc}")

    try:
        sx, sy = resolve_xy(src)
        dx, dy = resolve_xy(dst)
        if not robot_busy.acquire(blocking=False):
            return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
        try:
            move_piece(sx, sy, dx, dy, ptype)
        finally:
            robot_busy.release()
        log_gcode(f"MOUVEMENT MANUEL : {src} → {dst} ({PIECE_NAMES[ptype]})")
        return jsonify({"status": "ok"})
    except Exception as e:
        log_gcode(f"ERREUR MOUVEMENT MANUEL : {e}")
        return jsonify({"status": "error", "msg": str(e)}), 400


@app.route('/emergency_stop', methods=['POST'])
def emergency_stop():
    # Écriture directe, sans attendre le verrou : un G28/M400 peut l'occuper longtemps
    if ser and not config.SIMULATION_MODE:
        try:
            ser.write(f"M410\n{magnet_gcode(False)}\n".encode())
        except Exception as e:
            log_gcode(f"Erreur arrêt d'urgence : {e}")
    log_gcode("!!! ARRÊT D'URGENCE !!!")
    return jsonify({"status": "ok"})


@app.route('/api/quit_kiosk', methods=['POST'])
def quit_kiosk():
    """Ferme Chromium et retourne au bureau."""
    subprocess.Popen(['pkill', '-f', 'epiphany'])
    return jsonify({"status": "ok"})


# =============================================================================
# ROUTES FLASK — PAGE CONTRÔLE MANUEL
# =============================================================================

@app.route('/controle_manuel')
def controle_manuel():
    return render_template('controle_manuel.html')


@app.route('/api/goto_grid', methods=['POST'])
def api_goto_grid():
    """Déplace le robot vers une case de la grille 10×10 (c, r)."""
    c = int(request.json.get('c', 0))
    r = int(request.json.get('r', 0))
    x, y = grid_to_xy(c, r)
    z = max(last_position['z'], travel_z())
    lift_to(z)
    move_xyz(x, y, z)
    log_gcode(f"GOTO c={c} r={r} → X{x:.1f} Y{y:.1f} Z{z:.1f}")
    return jsonify({"status": "ok", "x": x, "y": y, "z": z})


@app.route('/api/goto_z_pick', methods=['POST'])
def api_goto_z_pick():
    """Descend à la hauteur de prise Z_PICK_REL (XY inchangé)."""
    send_gcode_raw("G90")
    send_gcode_raw(f"G0 Z{config.Z_PICK_REL:.2f} F{config.FEED_Z}")
    send_gcode_raw("M400")
    global last_position
    last_position['z'] = config.Z_PICK_REL
    log_gcode(f"Z PRISE → Z{config.Z_PICK_REL:.1f}")
    return jsonify({"status": "ok", "z": config.Z_PICK_REL})


@app.route('/api/set_z_ref', methods=['POST'])
def api_set_z_ref():
    """Met à jour la hauteur de prise Z_PICK_REL."""
    z = float(request.json.get('z', config.Z_PICK_REL))
    config.Z_PICK_REL = round(z, 1)
    log_gcode(f"Z_PICK_REL défini à {config.Z_PICK_REL} mm")
    return jsonify({"status": "ok", "z_pick": config.Z_PICK_REL})


@app.route('/api/get_config')
def api_get_config():
    return jsonify({
        'z_board':  config.Z_BOARD,
        'z_pick':   config.Z_PICK_REL,
        'z_travel': config.Z_TRAVEL_REL,
        'feed':     config.FEED_TRAVEL,
    })


@app.route('/api/pick/status')
def api_pick_status():
    heights = {t: piece_height(t) for t in PIECE_TYPES}
    return jsonify({
        "calib": pick_calib, "missing": pick_missing(), "ready": pick_ready(),
        "heights": {PIECE_NAMES[t]: (round(h, 1) if h is not None else None) for t, h in heights.items()},
        "travel_z": round(travel_z(), 1), "position": last_position,
    })


@app.route('/api/pick/goto', methods=['POST'])
def api_pick_goto():
    """Place l'aimant au-dessus d'une case (estimation actuelle), à hauteur sûre."""
    sq = (request.json.get('square') or 'a1').lower()
    try:
        x, y = calculate_xy(sq)
    except Exception:
        return jsonify({"status": "error", "msg": f"Case inconnue : {sq}"}), 400
    z = max(last_position['z'], travel_z())
    lift_to(z)
    move_xyz(x, y, z)
    return jsonify({"status": "ok", "x": round(x, 2), "y": round(y, 2), "z": round(z, 2)})


@app.route('/api/pick/hover', methods=['POST'])
def api_pick_hover():
    """
    Amène l'aimant juste au-dessus de la vis d'une pièce posée sur `square`
    (HOVER_MM au-dessus de la hauteur de prise) pour vérifier / régler le centrage à l'œil.
    """
    if surface_z() is None:
        return jsonify({"status": "error", "msg": "Enregistrez d'abord la hauteur de prise."}), 400
    sq = (request.json.get('square') or 'a1').lower()
    try:
        x, y = calculate_xy(sq)
    except Exception:
        return jsonify({"status": "error", "msg": f"Case inconnue : {sq}"}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    try:
        z_hover = pick_z('p') + config.HOVER_MM
        lift_to(travel_z())
        move_xyz(x, y, max(last_position['z'], travel_z()))
        move_xyz(x, y, z_hover + config.PICK_APPROACH_MM)
        move_xyz(x, y, z_hover, feed=config.FEED_APPROACH)
        return jsonify({"status": "ok", "x": round(x, 2), "y": round(y, 2), "z": round(z_hover, 2),
                        "msg": f"Aimant {config.HOVER_MM:g} mm au-dessus de la vis en {sq}"})
    finally:
        robot_busy.release()


@app.route('/api/magnet/test', methods=['POST'])
def api_magnet_test():
    """
    Test du relais de l'aimant : 'servo' = M280 (réglage actuel), 'pin' = M42 sur la broche
    MAGNET_PIN. Active 2 s puis coupe : on doit entendre le relais claquer deux fois.
    """
    mode = (request.json.get('mode') or 'servo').lower()
    if mode == 'pin':
        on, off = f"M42 P{config.MAGNET_PIN} S255", f"M42 P{config.MAGNET_PIN} S0"
    else:
        idx = config.MAGNET_SERVO_IDX
        on, off = f"M280 P{idx} S{config.MAGNET_SERVO_ON}", f"M280 P{idx} S{config.MAGNET_SERVO_OFF}"
    send_gcode_raw(on)
    time.sleep(2)
    send_gcode_raw(off)
    log_gcode(f"🧲 Test relais ({mode}) : {on} puis {off}")
    return jsonify({"status": "ok", "msg": f"{on} pendant 2 s puis {off}. Le relais a-t-il claqué ?"})


@app.route('/api/pick/save', methods=['POST'])
def api_pick_save():
    """
    Enregistre la position actuelle de l'aimant :
      what = 'a1' | 'h1' | 'a8'  → centre de la case (X, Y)
      what = 'surface'           → aimant posé sur le plateau (Z)
      what = 'p','n','b','r','q','k' → aimant posé sur la tête de cette pièce (Z)
    """
    what = (request.json.get('what') or '').lower()
    pos = read_marlin_position()
    raw_x, raw_y = pos['x'] - config.PICK_OFFSET_X, pos['y'] - config.PICK_OFFSET_Y
    if what in ('a1', 'h1', 'a8'):
        pick_calib[what] = [round(raw_x, 2), round(raw_y, 2)]
        msg = f"{what} = X{pos['x']:.1f} Y{pos['y']:.1f}"
    elif what == 'point':
        sq = (request.json.get('square') or '').lower()
        if len(sq) != 2 or sq[0] not in 'abcdefgh' or sq[1] not in '12345678':
            return jsonify({"status": "error", "msg": f"Case inconnue : {sq}"}), 400
        before = calculate_xy(sq)
        pick_calib.setdefault('points', {})[sq] = [round(raw_x, 2), round(raw_y, 2)]
        msg = (f"{sq} centré à X{pos['x']:.1f} Y{pos['y']:.1f} "
               f"(écart corrigé X{pos['x'] - before[0]:+.1f} Y{pos['y'] - before[1]:+.1f})")
    elif what == 'surface':
        pick_calib['z_surface'] = round(pos['z'], 2)
        msg = f"Surface du plateau = Z{pos['z']:.1f}"
    elif what == 'all':
        pick_calib['pick_z'] = {t: round(pos['z'], 2) for t in PIECE_TYPES}
        # Surface absente ou incohérente (enregistrée au niveau de la vis) : on la déduit
        # de la hauteur de prise mesurée, les pièces faisant toutes PIECE_HEIGHT_MM.
        # La surface se déduit de la prise (pièces toutes à PIECE_HEIGHT_MM)
        pick_calib.pop('z_surface', None)
        h = piece_height('p')
        msg = f"Prise de toutes les pièces à Z{pos['z']:.1f}" + (f" ({h:.1f} mm au-dessus du plateau)" if h is not None else "")
    elif what in PIECE_TYPES:
        pick_calib.setdefault('pick_z', {})[what] = round(pos['z'], 2)
        h = piece_height(what)
        msg = f"{PIECE_NAMES[what]} : prise à Z{pos['z']:.1f}" + (f" (hauteur {h:.1f} mm)" if h is not None else "")
    else:
        return jsonify({"status": "error", "msg": f"Inconnu : {what}"}), 400
    pick_calib['date'] = time.strftime("%Y-%m-%d %H:%M:%S")
    save_pick_calib()
    log_gcode(f"🎯 Calibration prise : {msg}")
    return jsonify({"status": "ok", "msg": msg, "missing": pick_missing()})


@app.route('/api/pick/test', methods=['POST'])
def api_pick_test():
    """Teste une prise : pièce `piece` de `src` vers `dst` (dst = src : soulève et repose)."""
    src = (request.json.get('src') or '').lower()
    dst = (request.json.get('dst') or src).lower()
    ptype = (request.json.get('piece') or 'p').lower()
    if ptype not in PIECE_TYPES:
        return jsonify({"status": "error", "msg": "Type de pièce inconnu"}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409
    try:
        sx, sy = calculate_xy(src)
        dx, dy = calculate_xy(dst)
        move_piece(sx, sy, dx, dy, ptype)
        log_gcode(f"🧪 Test prise {PIECE_NAMES[ptype]} {src} → {dst}")
        return jsonify({"status": "ok", "msg": f"{PIECE_NAMES[ptype]} {src} → {dst} terminé"})
    except PickNotCalibrated as e:
        return jsonify({"status": "error", "msg": str(e)}), 400
    except Exception as e:
        return jsonify({"status": "error", "msg": f"Erreur : {e}"}), 400
    finally:
        robot_busy.release()


@app.route('/api/version')
def api_version():
    return jsonify({"version": APP_VERSION})


@app.route('/api/settings', methods=['GET', 'POST'])
def api_settings():
    """Lecture / modification des réglages (vitesses Z et XY, son)."""
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        if 'z_feed' in data:
            settings['z_feed'] = max(5.0, min(45.0, float(data['z_feed'])))
        if 'xy_feed' in data:
            settings['xy_feed'] = max(20.0, min(150.0, float(data['xy_feed'])))
        if 'sound' in data:
            settings['sound'] = bool(data['sound'])
        save_settings()
        if 'z_feed' in data:
            apply_motion_settings()
        log_gcode(f"Réglages : Z {settings['z_feed']:g} mm/s, XY {settings['xy_feed']:g} mm/s, "
                  f"son {'ON' if settings['sound'] else 'OFF'}")
    return jsonify({"status": "ok", **settings})


SOUNDS_DIR = os.path.join(parent_dir, "sounds")


@app.route('/sounds/<path:name>')
def custom_sound(name):
    """Sons personnels déposés dans sounds/ (ex. victoire.mp3, coup.mp3) : remplacent les sons générés."""
    from flask import send_from_directory
    if not os.path.isfile(os.path.join(SOUNDS_DIR, name)):
        return Response(status=404)
    return send_from_directory(SOUNDS_DIR, name)


@app.route('/api/retry_pick', methods=['POST'])
def api_retry_pick():
    """Refait les déplacements ratés du dernier coup du robot, puis revérifie."""
    global status_msg
    if retry_state is None:
        return jsonify({"status": "error", "msg": "Aucune prise à refaire."}), 400
    if not retry_state["not_picked"]:
        return jsonify({"status": "error",
                        "msg": "La pièce a été lâchée en route : replacez-la à la main puis « C'est réglé »."}), 400
    if not robot_busy.acquire(blocking=False):
        return jsonify({"status": "busy", "msg": "Le robot est en mouvement."}), 409

    def run():
        global status_msg
        try:
            st = retry_state
            status_msg = "🔁 Nouvelle tentative de prise..."
            retry_steps(st["not_picked"])
            move_to_vision_position()
            if _check_robot_move(st["board_before"], st["move"], st["pre_frame"]):
                log_gcode("✅ Prise réussie après nouvelle tentative")
                _finish_robot_turn(st["move"])
        except Exception as e:
            log_gcode(f"Erreur nouvelle tentative : {e}")
        finally:
            robot_busy.release()
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/api/retry_done', methods=['POST'])
def api_retry_done():
    """Le joueur a remis la pièce à la main : on reprend la partie."""
    global retry_state
    if retry_state is None:
        return jsonify({"status": "ok"})
    move = retry_state["move"]
    retry_state = None
    log_gcode("✋ Pièce replacée à la main")
    threading.Thread(target=_finish_robot_turn, args=(move,), daemon=True).start()
    return jsonify({"status": "ok"})


@app.route('/api/position')
def api_position():
    return jsonify(last_position)


@app.route('/api/gcode_log')
def api_gcode_log():
    return jsonify({"logs": list(gcode_log_buffer)})


# =============================================================================
# ROUTES FLASK — PAGE SIMULATION
# =============================================================================

@app.route('/simulation')
def simulation():
    return render_template('simulation.html')


@app.route('/sim/board.svg')
def sim_board_svg():
    selected = request.args.get('selected')
    fill = {}
    if selected:
        try:
            sq = chess.parse_square(selected)
            fill[sq] = "#aaffaa"
            for move in sim_board.legal_moves:
                if move.from_square == sq:
                    fill[move.to_square] = "#ffff88"
        except Exception:
            pass
    last_move = sim_board.peek() if sim_board.move_stack else None
    svg = chess.svg.board(sim_board, lastmove=last_move, fill=fill, size=500)
    return Response(svg, mimetype='image/svg+xml')


@app.route('/api/sim/status')
def api_sim_status():
    outcome = sim_board.outcome()
    piece_counts = {chess.PAWN: 8, chess.KNIGHT: 2, chess.BISHOP: 2,
                    chess.ROOK: 2, chess.QUEEN: 1}
    captured = {'w': [], 'b': []}
    for color, code in [(chess.WHITE, 'w'), (chess.BLACK, 'b')]:
        for p_type, max_count in piece_counts.items():
            sym = chess.Piece(p_type, color).unicode_symbol()
            for _ in range(max(0, max_count - len(sim_board.pieces(p_type, color)))):
                captured[code].append(sym)
    return jsonify({
        'fen': sim_board.fen(),
        'turn': 'white' if sim_board.turn else 'black',
        'game_over': sim_board.is_game_over(),
        'outcome': outcome.result() if outcome else None,
        'legal_moves': [m.uci() for m in sim_board.legal_moves],
        'move_count': len(sim_board.move_stack),
        'captured': captured,
    })


@app.route('/api/sim/move', methods=['POST'])
def api_sim_move():
    uci = request.json.get('uci', '')
    try:
        move = chess.Move.from_uci(uci)
        if move in sim_board.legal_moves:
            sim_board.push(move)
            return jsonify({"status": "ok"})
    except Exception:
        pass
    return jsonify({"status": "illegal"}), 400


@app.route('/api/sim/bot_move', methods=['POST'])
def api_sim_bot_move():
    if not game_engine.engine:
        return jsonify({"status": "error", "msg": "Stockfish non disponible"}), 500
    if sim_board.is_game_over():
        return jsonify({"status": "game_over"}), 400
    with sim_lock:
        try:
            limit = chess_engine_mod.Limit(time=config.STOCKFISH_MOVE_TIME)
            result = game_engine.engine.play(sim_board, limit)
            if result.move:
                sim_board.push(result.move)
                return jsonify({"status": "ok", "uci": result.move.uci()})
        except Exception as e:
            return jsonify({"status": "error", "msg": str(e)}), 500
    return jsonify({"status": "error"}), 500


@app.route('/api/sim/undo', methods=['POST'])
def api_sim_undo():
    with sim_lock:
        if len(sim_board.move_stack) >= 2:
            sim_board.pop(); sim_board.pop()
        elif len(sim_board.move_stack) == 1:
            sim_board.pop()
    return jsonify({"status": "ok"})


@app.route('/api/sim/export_usb', methods=['POST'])
def api_sim_export_usb():
    """Exporte le PGN de la partie simulation sur clé USB."""
    import pwd, chess.pgn as chess_pgn
    username = pwd.getpwuid(os.getuid()).pw_name
    usb_root = None
    for path in [f"/media/{username}", "/media/jetson", "/media/user", "/mnt/usb"]:
        if not os.path.isdir(path):
            continue
        try:
            subs = [os.path.join(path, d) for d in os.listdir(path)
                    if os.path.isdir(os.path.join(path, d))
                    and os.access(os.path.join(path, d), os.W_OK)]
            if subs:
                usb_root = subs[0]
                break
        except PermissionError:
            continue
    if not usb_root:
        return jsonify({"status": "error", "msg": "Aucune clé USB détectée."}), 404
    try:
        game = chess_pgn.Game.from_board(sim_board)
        game.headers["Event"] = "Simulation Robot Échecs"
        game.headers["Date"]  = time.strftime("%Y.%m.%d")
        pgn_str = str(game)
        dst = os.path.join(usb_root, f"simulation_{time.strftime('%Y%m%d_%H%M%S')}.pgn")
        with open(dst, 'w', encoding='utf-8') as f:
            f.write(pgn_str)
        return jsonify({"status": "ok", "msg": dst})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500


@app.route('/api/sim/reset', methods=['POST'])
def api_sim_reset():
    global sim_board
    with sim_lock:
        sim_board = chess.Board()
    return jsonify({"status": "ok"})


@app.route('/api/sim/set_elo', methods=['POST'])
def api_sim_set_elo():
    elo = request.json.get('elo', config.DEFAULT_ELO)
    elo = max(100, min(3200, int(elo)))
    game_engine.set_elo(elo)
    return jsonify({"status": "ok", "elo": elo})


# =============================================================================
# PARTIES LÉGENDAIRES
# =============================================================================

LEGENDARY_GAMES = [
    {
        "id": "immortelle_1851",
        "name": "L'Immortelle",
        "players": "Anderssen vs Kieseritzky",
        "year": "Londres, 1851",
        "pgn": "1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7#",
    },
    {
        "id": "opera_1858",
        "name": "La Partie de l'Opéra",
        "players": "Morphy vs Duke of Brunswick",
        "year": "Paris, 1858",
        "pgn": "1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#",
    },
    {
        "id": "evergreen_1852",
        "name": "La Partie Toujours Verte",
        "players": "Anderssen vs Dufresne",
        "year": "Berlin, 1852",
        "pgn": "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7#",
    },
    {
        "id": "siecle_1956",
        "name": "La Partie du Siècle",
        "players": "Byrne vs Fischer",
        "year": "New York, 1956",
        "pgn": "1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6 8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4 14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1 29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+ 36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2#",
    },
    {
        "id": "fischer_spassky_1972",
        "name": "Fischer vs Spassky — Partie 6",
        "players": "Fischer vs Spassky",
        "year": "Reykjavik, 1972",
        "pgn": "1. c4 e6 2. Nf3 d5 3. d4 Nf6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6 15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4 21. f4 Qe7 22. e5 Rb8 23. Bc4 Kh8 24. Qh3 Nf8 25. b3 a5 26. f5 exf5 27. Rxf5 Nh7 28. Rcf1 Qd8 29. Qg3 Re7 30. h4 Rbb7 31. e6 Rbc7 32. Qe5 Qe8 33. a4 Qd8 34. R1f2 Qe8 35. R2f3 Qd8 36. Bd3 Qe8 37. Qe4 Nf6 38. Rxf6 gxf6 39. Rxf6 Kg8 40. Bc4 Kh8 41. Qf4 1-0",
    },
    {
        "id": "kasparov_topalov_1999",
        "name": "L'Immortelle de Kasparov",
        "players": "Kasparov vs Topalov",
        "year": "Wijk aan Zee, 1999",
        "pgn": "1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0",
    },
]

# État de la partie légendaire en cours
leg_board  = chess.Board()
leg_lock   = threading.Lock()
leg_moves  = []   # liste de chess.Move de la partie chargée
leg_index  = 0    # position courante
leg_name   = ""


def execute_leg_move_sequence(uci_move):
    """Exécute la séquence physique d'un coup pour les parties légendaires."""
    import chess as chess_lib
    perform_physical_move(leg_board.copy(), chess_lib.Move.from_uci(uci_move))
    log_gcode(f"LÉGENDAIRE : {uci_move}")


def _parse_legendary_pgn(pgn_str):
    import chess.pgn as _pgn, io as _io
    game = _pgn.read_game(_io.StringIO(pgn_str))
    if not game:
        return []
    moves = []
    board = game.board()
    for move in game.mainline_moves():
        moves.append(move)
        board.push(move)
    return moves


@app.route('/legendaires')
def legendaires():
    return render_template('legendaires.html')


@app.route('/leg/board.svg')
def leg_board_svg():
    last_move = leg_board.peek() if leg_board.move_stack else None
    svg = chess.svg.board(leg_board, lastmove=last_move, size=500)
    return Response(svg, mimetype='image/svg+xml')


@app.route('/api/leg/games')
def api_leg_games():
    return jsonify([{"id": g["id"], "name": g["name"],
                     "players": g["players"], "year": g["year"]} for g in LEGENDARY_GAMES])


@app.route('/api/leg/load', methods=['POST'])
def api_leg_load():
    global leg_board, leg_moves, leg_index, leg_name
    game_id = request.json.get('id', '')
    game = next((g for g in LEGENDARY_GAMES if g['id'] == game_id), None)
    if not game:
        return jsonify({'status': 'error', 'msg': 'Partie inconnue'}), 404
    moves = _parse_legendary_pgn(game['pgn'])
    if not moves:
        return jsonify({'status': 'error', 'msg': 'Erreur lecture PGN'}), 500
    global leg_ref_frame, leg_retry
    leg_ref_frame = None
    leg_retry = None
    with leg_lock:
        leg_board  = chess.Board()
        leg_moves  = moves
        leg_index  = 0
        leg_name   = game['name']
    return jsonify({'status': 'ok', 'total': len(moves), 'name': game['name']})


def _leg_captured():
    """Calcule les pièces capturées à partir de l'état actuel de leg_board."""
    piece_counts = {chess.PAWN: 8, chess.KNIGHT: 2, chess.BISHOP: 2,
                    chess.ROOK: 2, chess.QUEEN: 1}
    captured = {'w': [], 'b': []}
    for color, code in [(chess.WHITE, 'w'), (chess.BLACK, 'b')]:
        for p_type, max_count in piece_counts.items():
            sym = chess.Piece(p_type, color).unicode_symbol()
            for _ in range(max(0, max_count - len(leg_board.pieces(p_type, color)))):
                captured[code].append(sym)
    return captured


leg_ref_frame = None   # photo du plateau avant le prochain coup légendaire (vérification)
leg_retry = None       # prise ratée en attente : {board_before, move, not_picked, dropped}


def _leg_verify_enabled():
    return (getattr(config, 'LEG_VERIFY', True) and camera.cam_ok
            and vision_engine.is_calibrated() and (homed or config.SIMULATION_MODE))


def _leg_photo():
    """Tête en position caméra, photo stable du plateau."""
    move_to_vision_position()
    time.sleep(getattr(config, 'VISION_SETTLE_SEC', 1.0))
    return grab_stable_frame()


def _leg_check(board_before, move):
    """Vérifie le coup légendaire (une nouvelle tentative automatique). True si tout est en place."""
    global leg_ref_frame, leg_retry
    move_to_vision_position()
    res = verify_physical_move(leg_ref_frame, board_before, move)
    if res and res[0]:
        retry_steps(res[0])
        move_to_vision_position()
        res = verify_physical_move(leg_ref_frame, board_before, move)
    if res and (res[0] or res[1]):
        leg_retry = {"board_before": board_before, "move": move, "not_picked": res[0], "dropped": res[1]}
        log_gcode("⚠️ Légendaire, prise ratée : " + describe_failure(res[0], res[1]))
        return False
    leg_retry = None
    leg_ref_frame = grab_stable_frame()
    return True


def _leg_response(status, uci=None, **extra):
    outcome = leg_board.outcome()
    return jsonify({
        'status': status, 'uci': uci, 'index': leg_index, 'total': len(leg_moves),
        'turn': 'white' if leg_board.turn else 'black',
        'game_over': leg_board.is_game_over() or leg_index >= len(leg_moves),
        'outcome': outcome.result() if outcome else None,
        'captured': _leg_captured(), **extra})


@app.route('/api/leg/next_move', methods=['POST'])
def api_leg_next_move():
    global leg_index, leg_ref_frame
    with leg_lock:
        if leg_retry is not None:
            return jsonify({'status': 'error', 'msg': "Prise ratée en attente : réessayez ou corrigez d'abord."}), 400
        if leg_index >= len(leg_moves):
            return jsonify({'status': 'done'})
        move = leg_moves[leg_index]
        uci  = move.uci()
        board_before = leg_board.copy()
        verify = _leg_verify_enabled()
        try:
            if verify and leg_ref_frame is None:
                leg_ref_frame = _leg_photo()
            execute_leg_move_sequence(uci)
        except (PickNotCalibrated, NotHomed) as e:
            return jsonify({'status': 'error', 'msg': str(e)}), 400
        leg_board.push(move)
        leg_index += 1
        if verify and not _leg_check(board_before, move):
            return _leg_response('retry', uci, msg="⚠️ Prise ratée : " +
                                 describe_failure(leg_retry["not_picked"], leg_retry["dropped"]),
                                 can_retry=bool(leg_retry["not_picked"]))
        outcome = leg_board.outcome()
        return jsonify({
            'status': 'ok',
            'uci': uci,
            'index': leg_index,
            'total': len(leg_moves),
            'turn': 'white' if leg_board.turn else 'black',
            'game_over': leg_board.is_game_over() or leg_index >= len(leg_moves),
            'outcome': outcome.result() if outcome else None,
            'captured': _leg_captured(),
        })


@app.route('/api/leg/retry', methods=['POST'])
def api_leg_retry():
    """Refait la prise ratée du dernier coup légendaire, puis revérifie."""
    with leg_lock:
        if leg_retry is None:
            return jsonify({'status': 'ok'})
        if not leg_retry["not_picked"]:
            return jsonify({'status': 'error', 'msg': "Pièce lâchée en route : replacez-la à la main."}), 400
        st = leg_retry
        retry_steps(st["not_picked"])
        if _leg_check(st["board_before"], st["move"]):
            return jsonify({'status': 'ok'})
        return jsonify({'status': 'retry', 'msg': "⚠️ Toujours raté : " +
                        describe_failure(leg_retry["not_picked"], leg_retry["dropped"]),
                        'can_retry': bool(leg_retry["not_picked"])})


@app.route('/api/leg/retry_done', methods=['POST'])
def api_leg_retry_done():
    """Pièce replacée à la main : nouvelle photo de référence, la lecture peut reprendre."""
    global leg_retry, leg_ref_frame
    with leg_lock:
        leg_retry = None
        leg_ref_frame = _leg_photo() if _leg_verify_enabled() else None
    return jsonify({'status': 'ok'})


@app.route('/api/leg/prev_move', methods=['POST'])
def api_leg_prev_move():
    global leg_index
    global leg_ref_frame, leg_retry
    leg_ref_frame = None
    leg_retry = None
    with leg_lock:
        if leg_index == 0:
            return jsonify({'status': 'start'})
        leg_board.pop()
        leg_index -= 1
        return jsonify({'status': 'ok', 'index': leg_index, 'total': len(leg_moves),
                        'captured': _leg_captured()})


@app.route('/api/leg/reset', methods=['POST'])
def api_leg_reset():
    global leg_board, leg_index
    global leg_ref_frame, leg_retry
    leg_ref_frame = None
    leg_retry = None
    with leg_lock:
        leg_board = chess.Board()
        leg_index = 0
    return jsonify({'status': 'ok', 'captured': {'w': [], 'b': []}})


@app.route('/api/leg/status')
def api_leg_status():
    with leg_lock:
        outcome = leg_board.outcome()
        return jsonify({
            'turn': 'white' if leg_board.turn else 'black',
            'game_over': leg_board.is_game_over() or leg_index >= len(leg_moves),
            'outcome': outcome.result() if outcome else None,
            'index': leg_index,
            'total': len(leg_moves),
            'name': leg_name,
            'captured': _leg_captured(),
        })


# =============================================================================
# DÉMARRAGE
# =============================================================================

if __name__ == '__main__':
    init_printer()
    threading.Thread(target=magnet_watchdog,   daemon=True).start()
    log_gcode("🚀 Serveur Robot Échecs démarré.")
    if getattr(config, 'HOME_ON_STARTUP', True):
        threading.Thread(target=startup_sequence, daemon=True).start()
    # '::' = IPv6 ET IPv4 (double pile). Sur l'Orin, « localhost » désigne d'abord ::1 :
    # avec 0.0.0.0 (IPv4 seul), le navigateur affichait au hasard « site indisponible ».
    app.run(host='::', port=5000, debug=False, threaded=True)
