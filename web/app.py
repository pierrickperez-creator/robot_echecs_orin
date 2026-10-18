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
    print("✅ Moteurs et Configuration chargés avec succès.")
except ImportError as e:
    print(f"❌ Erreur critique : {e}")
    sys.exit(1)

app = Flask(__name__)
game_engine = ChessEngine()
vision_engine = VisionEngine()

# --- GLOBALS ---
ser = None
serial_lock = threading.Lock()
gcode_log_buffer = []
status_msg = "En attente du joueur Blanc..."
button_state        = False
robot_move_requested = False   # True quand le bouton physique vient d'être pressé
button_thread_running = True
clock_enabled = True
last_position = {'x': 0.0, 'y': 0.0, 'z': 0.0}
cap_w = 0   # pièces blanches capturées (index cimetière)
cap_b = 0   # pièces noires capturées (index cimetière)

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

def init_printer():
    global ser
    if config.SIMULATION_MODE:
        log_gcode("MODE SIMULATION : Aucun mouvement réel.")
        return
    if serial is None:
        log_gcode("AVERTISSEMENT : bibliothèque serial non installée.")
        return
    try:
        ser = serial.Serial(config.MARLIN_PORT, config.MARLIN_BAUD, timeout=1)
        time.sleep(2)  # Attente reboot Marlin
        send_gcode_raw("M92 Z400")  # Calibration Z
        # Forcer relais OFF immédiatement dès la connexion
        send_gcode_raw(f"M42 P{config.MAGNET_PIN} S0")
        log_gcode(f"✅ Marlin connecté sur {config.MARLIN_PORT} — relais OFF")
    except Exception as e:
        log_gcode(f"ERREUR CONNEXION MARLIN : {e}")
        ser = None

def send_gcode_raw(command):
    global ser
    if config.SIMULATION_MODE:
        log_gcode(f"[SIM] {command}")
        return True
    if not ser:
        log_gcode(f"[HORS LIGNE] {command}")
        return False
    with serial_lock:
        try:
            ser.write(f"{command}\n".encode())
            log_gcode(f"[→] {command}")
            return True
        except Exception as e:
            log_gcode(f"Erreur envoi GCode : {e}")
            return False

def send_gcode_wait(command, timeout=10):
    """Envoie un GCode et attend 'ok' de Marlin."""
    if not send_gcode_raw(command):
        return False
    if config.SIMULATION_MODE:
        return True
    if not ser:
        return False
    deadline = time.time() + timeout
    with serial_lock:
        while time.time() < deadline:
            line = ser.readline().decode(errors='ignore').strip()
            if line == 'ok':
                return True
    return False

def move_to_vision_position():
    """Déplace la tête en position caméra : plateau reculé au max, tête levée."""
    log_gcode(f"→ Position caméra : X{config.VISION_X} Y{config.VISION_Y} Z{config.Z_VISION}")
    move_xyz(config.VISION_X, config.VISION_Y, config.Z_VISION)


def move_xyz(x, y, z):
    """Déplacement absolu avec attente de fin de mouvement."""
    global last_position
    last_position = {'x': round(x, 2), 'y': round(y, 2), 'z': round(z, 2)}
    send_gcode_raw("G90")
    cmd = f"G0 X{x:.2f} Y{y:.2f} Z{z:.2f} F{config.FEED_TRAVEL}"
    send_gcode_raw(cmd)
    send_gcode_raw("M400")

_magnet_on_since = None   # timestamp d'activation (watchdog anti-surchauffe)

def magnet(state):
    """
    Active ou désactive le relais KS0055 sur D11.
    Utilise M42 (DIRECT_PIN_CONTROL requis dans Marlin Configuration_adv.h).
    M42 P11 S255 → pin HIGH (5V continu) → relais ON
    M42 P11 S0   → pin LOW  (0V)         → relais OFF
    """
    global _magnet_on_since
    pin = config.MAGNET_PIN
    if state:
        send_gcode_raw(f"M42 P{pin} S255")
        _magnet_on_since = time.time()
    else:
        send_gcode_raw(f"M42 P{pin} S0")
        _magnet_on_since = None

def magnet_watchdog():
    """Thread : coupe l'aimant automatiquement si resté actif trop longtemps."""
    max_on = getattr(config, 'MAGNET_MAX_ON_SEC', 30)
    while True:
        time.sleep(2)
        if _magnet_on_since and (time.time() - _magnet_on_since) > max_on:
            log_gcode(f"⚠ RELAIS coupé automatiquement (>{max_on}s) — protection thermique")
            idx = getattr(config, 'MAGNET_SERVO_IDX', 0)
            send_gcode_raw(f"M280 P{idx} S0")
            globals().update(_magnet_on_since=None)

def calculate_xy(square_name):
    """Calcule les coordonnées mm depuis une case (ex: 'e2')."""
    col = ord(square_name[0]) - ord('a')
    row = int(square_name[1]) - 1
    x = config.BOARD_OFFSET_X + (col * config.SQUARE_SIZE_MM) + (config.SQUARE_SIZE_MM / 2)
    y = config.BOARD_OFFSET_Y + (row * config.SQUARE_SIZE_MM) + (config.SQUARE_SIZE_MM / 2)
    return x, y

def is_button_pressed():
    """Interroge Marlin via M119 pour lire l'état du bouton (endstop)."""
    if config.SIMULATION_MODE or not ser:
        return False
    with serial_lock:
        try:
            ser.write(b"M119\n")
            deadline = time.time() + 2
            while time.time() < deadline:
                line = ser.readline().decode(errors='ignore').strip()
                if config.ENDSTOP_BUTTON_NAME in line:
                    return "TRIGGERED" in line.upper()
        except Exception:
            pass
    return False

def button_poll_loop():
    """Thread de surveillance du bouton de validation (détection de front montant)."""
    global button_state, robot_move_requested
    prev = False
    while button_thread_running:
        current = is_button_pressed()
        if current and not prev:          # front montant → le joueur vient d'appuyer
            robot_move_requested = True
        button_state = current
        prev = current
        time.sleep(0.2)

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
            ret, frame = cap.read()
            if ret and frame is not None:
                print(f"✅ Caméra USB (V4L2 id={cam_id}) ouverte avec succès.")
                return cap, f"USB V4L2 (id={cam_id})"
        cap.release()
        return None, None

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
# ÉTAT SIMULATION
# =============================================================================
sim_board = chess.Board()
sim_lock  = threading.Lock()


# =============================================================================
# ACTIONS PHYSIQUES (MOUVEMENTS DE PIÈCES)
# =============================================================================

def execute_move_sequence(uci_move):
    """
    Exécute la séquence physique complète pour un coup UCI (ex: 'e2e4').
    Gère la capture, la promotion (Dame), et le roque simplifié.
    """
    global status_msg, cap_w, cap_b
    import chess as chess_lib

    board = game_engine.board
    move = chess_lib.Move.from_uci(uci_move)

    src_sq = uci_move[:2]
    dst_sq = uci_move[2:4]
    src_x, src_y = calculate_xy(src_sq)
    dst_x, dst_y = calculate_xy(dst_sq)

    # Détection de prise
    captured_piece = board.piece_at(chess_lib.parse_square(dst_sq))
    is_capture = captured_piece is not None

    # Détection en passant
    is_en_passant = board.is_en_passant(move)

    # --- 1. Prise : déplacer la pièce capturée au cimetière ---
    if is_capture:
        status_msg = f"Capture de {dst_sq}..."
        graveyard = config.WHITE_GRAVEYARD if captured_piece.color == chess_lib.WHITE else config.BLACK_GRAVEYARD
        used = cap_w if captured_piece.color == chess_lib.WHITE else cap_b
        gx, gy = graveyard[min(used, len(graveyard) - 1)]
        move_xyz(dst_x, dst_y, config.Z_BOARD)
        magnet(True)
        move_xyz(dst_x, dst_y, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_BOARD)
        magnet(False)
        move_xyz(gx, gy, config.Z_TRAVEL_REL)
        if captured_piece.color == chess_lib.WHITE:
            cap_w += 1
        else:
            cap_b += 1

    elif is_en_passant:
        # Pion capturé en passant (case différente de dst)
        ep_col = ord(dst_sq[0]) - ord('a')
        ep_row = int(src_sq[1]) - 1  # Même rangée que la source
        ep_x = config.BOARD_OFFSET_X + ep_col * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
        ep_y = config.BOARD_OFFSET_Y + ep_row * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
        graveyard = config.BLACK_GRAVEYARD if board.turn == chess_lib.WHITE else config.WHITE_GRAVEYARD
        used = cap_b if board.turn == chess_lib.WHITE else cap_w
        gx, gy = graveyard[min(used, len(graveyard) - 1)]
        move_xyz(ep_x, ep_y, config.Z_BOARD)
        magnet(True)
        move_xyz(ep_x, ep_y, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_BOARD)
        magnet(False)
        move_xyz(gx, gy, config.Z_TRAVEL_REL)
        if board.turn == chess_lib.WHITE:
            cap_b += 1
        else:
            cap_w += 1

    # --- 2. Déplacer la pièce principale ---
    status_msg = f"Déplacement {src_sq} → {dst_sq}..."
    move_xyz(src_x, src_y, config.Z_BOARD)
    magnet(True)
    move_xyz(src_x, src_y, config.Z_PICK_REL)
    move_xyz(dst_x, dst_y, config.Z_PICK_REL)
    move_xyz(dst_x, dst_y, config.Z_BOARD)
    magnet(False)
    move_xyz(dst_x, dst_y, config.Z_TRAVEL_REL)

    # --- 3. Roque : déplacer la tour ---
    if board.is_castling(move):
        if chess_lib.square_file(move.to_square) == 6:  # Petit roque (côté roi)
            rook_src = dst_sq[0].replace(dst_sq[0], 'h') + dst_sq[1]
            rook_dst = 'f' + dst_sq[1]
        else:  # Grand roque (côté dame)
            rook_src = 'a' + dst_sq[1]
            rook_dst = 'd' + dst_sq[1]
        rx1, ry1 = calculate_xy(rook_src)
        rx2, ry2 = calculate_xy(rook_dst)
        move_xyz(rx1, ry1, config.Z_BOARD)
        magnet(True)
        move_xyz(rx1, ry1, config.Z_PICK_REL)
        move_xyz(rx2, ry2, config.Z_PICK_REL)
        move_xyz(rx2, ry2, config.Z_BOARD)
        magnet(False)
        move_xyz(rx2, ry2, config.Z_TRAVEL_REL)

    # --- 4. Promotion : placer une dame de réserve ---
    if move.promotion:
        color = board.turn
        reserve = config.WHITE_QUEEN_RESERVE if color == chess_lib.WHITE else config.BLACK_QUEEN_RESERVE
        used_idx = game_engine.used_white_queens if color == chess_lib.WHITE else game_engine.used_black_queens
        if used_idx < len(reserve):
            qx, qy = reserve[used_idx]
            move_xyz(qx, qy, config.Z_BOARD)
            magnet(True)
            move_xyz(qx, qy, config.Z_PICK_REL)
            move_xyz(dst_x, dst_y, config.Z_PICK_REL)
            move_xyz(dst_x, dst_y, config.Z_BOARD)
            magnet(False)
            move_xyz(dst_x, dst_y, config.Z_TRAVEL_REL)
            if color == chess_lib.WHITE:
                game_engine.used_white_queens += 1
            else:
                game_engine.used_black_queens += 1

    log_gcode(f"ROBOT JOUE : {uci_move}")
    status_msg = f"Robot a joué {uci_move}. À vous !"
    move_to_vision_position()


def move_piece(fx, fy, tx, ty):
    """Déplace physiquement une pièce de (fx,fy) à (tx,ty) avec l'aimant."""
    move_xyz(fx, fy, config.Z_BOARD)
    magnet(True)
    move_xyz(fx, fy, config.Z_PICK_REL)
    move_xyz(tx, ty, config.Z_PICK_REL)
    move_xyz(tx, ty, config.Z_BOARD)
    magnet(False)
    move_xyz(tx, ty, config.Z_TRAVEL_REL)


def reconstruct_capture_order():
    """
    Rejoue l'historique des coups pour retrouver le type de chaque pièce capturée
    dans l'ordre de capture (= ordre des slots cimetière).
    Retourne: (liste_types_blancs, liste_types_noirs) avec chess.PieceType.
    """
    import chess as chess_lib
    temp = chess_lib.Board()
    white_types = []
    black_types = []
    for move in game_engine.board.move_stack:
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
                lst = white_types if captured.color == chess_lib.WHITE else black_types
                # Si promotion, la pièce sur la case cible est la pièce promue, pas la pièce capturée
                lst.append(captured.piece_type)
        temp.push(move)
    return white_types, black_types


def reset_board_physically():
    """
    Replace toutes les pièces à leur position initiale physiquement.
    Algorithme :
      1. Identifier tous les emplacements actuels (échiquier + cimetière).
      2. Garer les pièces encore sur l'échiquier dans le cimetière.
      3. Replacer chaque pièce de son slot cimetière vers sa case de départ.
    """
    import chess as chess_lib
    global status_msg, cap_w, cap_b

    log_gcode("═══ RANGEMENT DU PLATEAU ═══")
    status_msg = "Rangement du plateau en cours..."

    # --- Positions de départ officielles ---
    WHITE_HOME = {
        chess_lib.PAWN:   ['a2','b2','c2','d2','e2','f2','g2','h2'],
        chess_lib.KNIGHT: ['b1','g1'],
        chess_lib.BISHOP: ['c1','f1'],
        chess_lib.ROOK:   ['a1','h1'],
        chess_lib.QUEEN:  ['d1'],
        chess_lib.KING:   ['e1'],
    }
    BLACK_HOME = {
        chess_lib.PAWN:   ['a7','b7','c7','d7','e7','f7','g7','h7'],
        chess_lib.KNIGHT: ['b8','g8'],
        chess_lib.BISHOP: ['c8','f8'],
        chess_lib.ROOK:   ['a8','h8'],
        chess_lib.QUEEN:  ['d8'],
        chess_lib.KING:   ['e8'],
    }

    # --- Reconstruire les types dans le cimetière ---
    w_grave_types, b_grave_types = reconstruct_capture_order()

    # --- Phase 1 : Garer les pièces de l'échiquier dans le cimetière ---
    # On les place dans les slots APRÈS les pièces déjà capturées
    park_w = []  # (slot_index, piece_type) pour les blancs garés
    park_b = []  # pour les noirs
    w_park_idx = len(w_grave_types)
    b_park_idx = len(b_grave_types)

    for sq in chess_lib.SQUARES:
        piece = game_engine.board.piece_at(sq)
        if piece is None:
            continue
        sq_name = chess_lib.square_name(sq)
        px, py = calculate_xy(sq_name)

        if piece.color == chess_lib.WHITE:
            slot = min(w_park_idx, len(config.WHITE_GRAVEYARD) - 1)
            gx, gy = config.WHITE_GRAVEYARD[slot]
            log_gcode(f"  Gare {sq_name} (blanc) → slot W{slot}")
            move_piece(px, py, gx, gy)
            park_w.append((slot, piece.piece_type))
            w_park_idx += 1
        else:
            slot = min(b_park_idx, len(config.BLACK_GRAVEYARD) - 1)
            gx, gy = config.BLACK_GRAVEYARD[slot]
            log_gcode(f"  Gare {sq_name} (noir) → slot B{slot}")
            move_piece(px, py, gx, gy)
            park_b.append((slot, piece.piece_type))
            b_park_idx += 1

    # --- Construire l'inventaire complet du cimetière ---
    # Format : (slot_index, piece_type) pour chaque pièce disponible
    all_white = [(i, pt) for i, pt in enumerate(w_grave_types)] + park_w
    all_black = [(i, pt) for i, pt in enumerate(b_grave_types)] + park_b

    # Grouper par type pour matcher aux cases de départ
    from collections import defaultdict
    avail_w = defaultdict(list)
    avail_b = defaultdict(list)
    for slot, pt in all_white:
        avail_w[pt].append(slot)
    for slot, pt in all_black:
        avail_b[pt].append(slot)

    # --- Phase 2 : Replacer chaque pièce à sa position de départ ---
    for pt, squares in WHITE_HOME.items():
        for sq_name in squares:
            if not avail_w[pt]:
                log_gcode(f"  ⚠ Manque blanc {chess_lib.piece_name(pt)} pour {sq_name}")
                continue
            slot = avail_w[pt].pop(0)
            gx, gy = config.WHITE_GRAVEYARD[slot]
            tx, ty = calculate_xy(sq_name)
            log_gcode(f"  W{slot} → {sq_name} ({chess_lib.piece_name(pt)})")
            move_piece(gx, gy, tx, ty)

    for pt, squares in BLACK_HOME.items():
        for sq_name in squares:
            if not avail_b[pt]:
                log_gcode(f"  ⚠ Manque noir {chess_lib.piece_name(pt)} pour {sq_name}")
                continue
            slot = avail_b[pt].pop(0)
            gx, gy = config.BLACK_GRAVEYARD[slot]
            tx, ty = calculate_xy(sq_name)
            log_gcode(f"  B{slot} → {sq_name} ({chess_lib.piece_name(pt)})")
            move_piece(gx, gy, tx, ty)

    log_gcode("═══ PLATEAU RANGÉ ═══")
    status_msg = "Plateau rangé ! Prêt pour une nouvelle partie."
    move_to_vision_position()


# =============================================================================
# ROUTES FLASK — STREAMING CAMÉRA
# =============================================================================

@app.route('/')
def index():
    return render_template('index.html')


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
    svg = chess.svg.board(
        board=game_engine.board,
        lastmove=last_move,
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
    return jsonify({
        'fen': game_engine.get_fen(),
        'turn': 'white' if game_engine.board.turn else 'black',
        'robot_turn': (game_engine.board.turn == chess.WHITE) != config.HUMAN_PLAYS_WHITE,
        'human_plays_white': config.HUMAN_PLAYS_WHITE,
        'logs': gcode_log_buffer[-10:],
        'status_msg': status_msg,
        'time_white': round(game_engine.time_white, 1),
        'time_black': round(game_engine.time_black, 1),
        'button_state': button_state,
        'robot_move_requested': robot_move_requested,
        'game_over': game_engine.is_game_over(),
        'outcome': ('pat' if outcome.termination == chess.Termination.STALEMATE else outcome.result()) if outcome else None,
        'legal_moves': game_engine.get_legal_moves(),
        'captured': game_engine.get_captured_pieces(),
        'move_count': len(game_engine.board.move_stack),
        'clock_enabled': clock_enabled,
        'used_white_queens': game_engine.used_white_queens,
        'used_black_queens': game_engine.used_black_queens,
        'clock_minutes': round(game_engine.initial_time / 60, 1),
        'moves': _build_move_history(),
    })


def _build_move_history():
    """Retourne l'historique des coups en notation SAN."""
    temp = chess.Board()
    result = []
    for move in game_engine.board.move_stack:
        try:
            result.append(temp.san(move))
            temp.push(move)
        except Exception:
            break
    return result


# =============================================================================
# ROUTES FLASK — COMMANDES DE JEU
# =============================================================================

@app.route('/api/undo', methods=['POST'])
def api_undo():
    """Annule le dernier coup (humain + robot)."""
    game_engine.undo()
    log_gcode("ANNULATION du dernier coup.")
    return jsonify({"status": "ok", "fen": game_engine.get_fen()})


@app.route('/api/reset', methods=['POST'])
def api_reset():
    """Remet le jeu à zéro."""
    global status_msg, cap_w, cap_b
    game_engine.reset()
    cap_w = 0
    cap_b = 0
    status_msg = "Nouvelle partie ! À vous de jouer (Blancs)."
    log_gcode("NOUVELLE PARTIE.")
    return jsonify({"status": "ok"})


@app.route('/api/reset_board_physical', methods=['POST'])
def api_reset_board_physical():
    """Lance le rangement physique du plateau dans un thread séparé."""
    global status_msg
    status_msg = "Rangement du plateau — ne touchez pas les pièces !"
    t = threading.Thread(target=reset_board_physically, daemon=True)
    t.start()
    return jsonify({"status": "ok"})


@app.route('/api/set_color', methods=['POST'])
def api_set_color():
    """Choisit la couleur du joueur humain et démarre une nouvelle partie."""
    global status_msg, robot_move_requested, cap_w, cap_b
    human_plays_white = bool(request.json.get('human_plays_white', True))
    config.HUMAN_PLAYS_WHITE = human_plays_white
    game_engine.reset()
    cap_w = 0
    cap_b = 0
    robot_plays_first = not human_plays_white
    if robot_plays_first:
        status_msg = "Robot joue les Blancs — retirez vos mains et appuyez sur JOUER ROBOT."
    else:
        status_msg = "Nouvelle partie ! À vous de jouer (Blancs)."
    log_gcode(f"NOUVELLE PARTIE — Humain={'Blancs' if human_plays_white else 'Noirs'}")
    return jsonify({"status": "ok",
                    "human_plays_white": human_plays_white,
                    "robot_plays_first": robot_plays_first})


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
    global status_msg, robot_move_requested
    robot_move_requested = False   # consommé
    status_msg = "Stockfish réfléchit..."
    move = game_engine.compute_bot_move()
    if move:
        t = threading.Thread(target=execute_move_sequence, args=(move.uci(),), daemon=True)
        t.start()
        game_engine.board.push(move)
        game_engine.start_clock()
        log_gcode(f"ROBOT JOUE : {move.uci()}")
        return jsonify({"status": "ok", "uci": move.uci()})
    status_msg = "Erreur IA."
    return jsonify({"status": "error"}), 500


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
    send_gcode_raw("G28")
    log_gcode("MOTEURS : Homing G28")
    last_position = {'x': 0.0, 'y': 0.0, 'z': 0.0}
    return jsonify({"status": "ok"})


@app.route('/cmd/goto_vision', methods=['POST'])
def cmd_goto_vision():
    """Déplace le robot en position caméra (depuis l'interface)."""
    threading.Thread(target=move_to_vision_position, daemon=True).start()
    return jsonify({"status": "ok",
                    "x": config.VISION_X, "y": config.VISION_Y, "z": config.Z_VISION})


@app.route('/api/set_home', methods=['POST'])
def api_set_home():
    """Définit la position actuelle des moteurs comme position HOME (M428 + M500)."""
    send_gcode_raw("M428")
    send_gcode_raw("M500")
    log_gcode("HOME : Position actuelle définie comme HOME (M428 + M500 sauvegardé)")
    return jsonify({"status": "ok"})


@app.route('/cmd/move_manual', methods=['POST'])
def cmd_manual():
    global last_position
    axis = request.json.get('axis', 'X').upper()
    dist = float(request.json.get('dist', 0))
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
    return jsonify({"status": "ok", "x": last_position['x'], "y": last_position['y'], "z": last_position['z']})


@app.route('/cmd/physical_move', methods=['POST'])
def cmd_physical_move():
    """
    Mode manuel : déplace physiquement une pièce de src vers dst.
    Accepte cases échiquier (ex: 'e2') ou cimetières (ex: 'wg0').
    """
    src = request.json.get('src', '')
    dst = request.json.get('dst', '')

    def resolve_xy(loc):
        """Résout la position XY d'un slot quelconque."""
        if len(loc) == 2 and loc[0].isalpha() and loc[1].isdigit():
            return calculate_xy(loc)
        # Cimetière blanc
        if loc.startswith('wg'):
            idx = int(loc[2:])
            return config.WHITE_GRAVEYARD[idx % len(config.WHITE_GRAVEYARD)]
        # Cimetière noir
        if loc.startswith('bg'):
            idx = int(loc[2:])
            return config.BLACK_GRAVEYARD[idx % len(config.BLACK_GRAVEYARD)]
        # Réserve Dame blanche
        if loc.startswith('wq'):
            idx = int(loc[2:])
            return config.WHITE_QUEEN_RESERVE[idx % len(config.WHITE_QUEEN_RESERVE)]
        # Réserve Dame noire
        if loc.startswith('bq'):
            idx = int(loc[2:])
            return config.BLACK_QUEEN_RESERVE[idx % len(config.BLACK_QUEEN_RESERVE)]
        raise ValueError(f"Slot inconnu : {loc}")

    try:
        sx, sy = resolve_xy(src)
        dx, dy = resolve_xy(dst)
        move_xyz(sx, sy, config.Z_BOARD)
        magnet(True)
        move_xyz(sx, sy, config.Z_PICK_REL)
        move_xyz(dx, dy, config.Z_PICK_REL)
        move_xyz(dx, dy, config.Z_BOARD)
        magnet(False)
        move_xyz(dx, dy, config.Z_TRAVEL_REL)
        log_gcode(f"MOUVEMENT MANUEL : {src} → {dst}")
        return jsonify({"status": "ok"})
    except Exception as e:
        log_gcode(f"ERREUR MOUVEMENT MANUEL : {e}")
        return jsonify({"status": "error", "msg": str(e)}), 400


@app.route('/emergency_stop', methods=['POST'])
def emergency_stop():
    send_gcode_raw("M410")
    magnet(False)
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
    x = c * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
    y = r * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
    move_xyz(x, y, config.Z_TRAVEL_REL)
    log_gcode(f"GOTO c={c} r={r} → X{x:.1f} Y{y:.1f} Z{config.Z_TRAVEL_REL}")
    return jsonify({"status": "ok", "x": x, "y": y, "z": config.Z_TRAVEL_REL})


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
    if game_engine.engine:
        try:
            game_engine.engine.configure({"UCI_LimitStrength": True, "UCI_Elo": elo})
        except Exception:
            pass
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
leg_cap_w  = 0   # pièces blanches capturées (index cimetière)
leg_cap_b  = 0   # pièces noires capturées (index cimetière)


def execute_leg_move_sequence(uci_move):
    """Exécute la séquence physique d'un coup pour les parties légendaires."""
    global leg_cap_w, leg_cap_b
    import chess as chess_lib

    board = leg_board
    move  = chess_lib.Move.from_uci(uci_move)
    src_sq, dst_sq = uci_move[:2], uci_move[2:4]
    src_x, src_y = calculate_xy(src_sq)
    dst_x, dst_y = calculate_xy(dst_sq)

    captured_piece  = board.piece_at(chess_lib.parse_square(dst_sq))
    is_capture      = captured_piece is not None
    is_en_passant   = board.is_en_passant(move)

    # --- 1. Prise : déplacer la pièce capturée au cimetière ---
    if is_capture:
        graveyard = config.WHITE_GRAVEYARD if captured_piece.color == chess_lib.WHITE else config.BLACK_GRAVEYARD
        used      = leg_cap_w if captured_piece.color == chess_lib.WHITE else leg_cap_b
        gx, gy    = graveyard[min(used, len(graveyard) - 1)]
        move_xyz(dst_x, dst_y, config.Z_BOARD);  magnet(True)
        move_xyz(dst_x, dst_y, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_BOARD);        magnet(False)
        move_xyz(gx, gy, config.Z_TRAVEL_REL)
        if captured_piece.color == chess_lib.WHITE:
            leg_cap_w += 1
        else:
            leg_cap_b += 1

    elif is_en_passant:
        ep_col = ord(dst_sq[0]) - ord('a')
        ep_row = int(src_sq[1]) - 1
        ep_x   = config.BOARD_OFFSET_X + ep_col * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
        ep_y   = config.BOARD_OFFSET_Y + ep_row * config.SQUARE_SIZE_MM + config.SQUARE_SIZE_MM / 2
        graveyard = config.BLACK_GRAVEYARD if board.turn == chess_lib.WHITE else config.WHITE_GRAVEYARD
        used      = leg_cap_b if board.turn == chess_lib.WHITE else leg_cap_w
        gx, gy    = graveyard[min(used, len(graveyard) - 1)]
        move_xyz(ep_x, ep_y, config.Z_BOARD);  magnet(True)
        move_xyz(ep_x, ep_y, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_PICK_REL)
        move_xyz(gx, gy, config.Z_BOARD);      magnet(False)
        move_xyz(gx, gy, config.Z_TRAVEL_REL)
        if board.turn == chess_lib.WHITE:
            leg_cap_b += 1
        else:
            leg_cap_w += 1

    # --- 2. Déplacer la pièce principale ---
    move_xyz(src_x, src_y, config.Z_BOARD);  magnet(True)
    move_xyz(src_x, src_y, config.Z_PICK_REL)
    move_xyz(dst_x, dst_y, config.Z_PICK_REL)
    move_xyz(dst_x, dst_y, config.Z_BOARD);  magnet(False)
    move_xyz(dst_x, dst_y, config.Z_TRAVEL_REL)

    # --- 3. Roque : déplacer la tour ---
    if board.is_castling(move):
        rook_src = ('h' if chess_lib.square_file(move.to_square) == 6 else 'a') + dst_sq[1]
        rook_dst = ('f' if chess_lib.square_file(move.to_square) == 6 else 'd') + dst_sq[1]
        rx1, ry1 = calculate_xy(rook_src)
        rx2, ry2 = calculate_xy(rook_dst)
        move_xyz(rx1, ry1, config.Z_BOARD);  magnet(True)
        move_xyz(rx1, ry1, config.Z_PICK_REL)
        move_xyz(rx2, ry2, config.Z_PICK_REL)
        move_xyz(rx2, ry2, config.Z_BOARD);  magnet(False)
        move_xyz(rx2, ry2, config.Z_TRAVEL_REL)

    # --- 4. Promotion : placer une dame de réserve ---
    if move.promotion:
        reserve  = config.WHITE_QUEEN_RESERVE if board.turn == chess_lib.WHITE else config.BLACK_QUEEN_RESERVE
        used_idx = 0
        if used_idx < len(reserve):
            qx, qy = reserve[used_idx]
            move_xyz(qx, qy, config.Z_BOARD);  magnet(True)
            move_xyz(qx, qy, config.Z_PICK_REL)
            move_xyz(dst_x, dst_y, config.Z_PICK_REL)
            move_xyz(dst_x, dst_y, config.Z_BOARD);  magnet(False)
            move_xyz(dst_x, dst_y, config.Z_TRAVEL_REL)

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
    global leg_board, leg_moves, leg_index, leg_name, leg_cap_w, leg_cap_b
    game_id = request.json.get('id', '')
    game = next((g for g in LEGENDARY_GAMES if g['id'] == game_id), None)
    if not game:
        return jsonify({'status': 'error', 'msg': 'Partie inconnue'}), 404
    moves = _parse_legendary_pgn(game['pgn'])
    if not moves:
        return jsonify({'status': 'error', 'msg': 'Erreur lecture PGN'}), 500
    with leg_lock:
        leg_board  = chess.Board()
        leg_moves  = moves
        leg_index  = 0
        leg_name   = game['name']
        leg_cap_w  = 0
        leg_cap_b  = 0
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


@app.route('/api/leg/next_move', methods=['POST'])
def api_leg_next_move():
    global leg_index
    with leg_lock:
        if leg_index >= len(leg_moves):
            return jsonify({'status': 'done'})
        move = leg_moves[leg_index]
        uci  = move.uci()
        execute_leg_move_sequence(uci)
        leg_board.push(move)
        leg_index += 1
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


@app.route('/api/leg/prev_move', methods=['POST'])
def api_leg_prev_move():
    global leg_index
    with leg_lock:
        if leg_index == 0:
            return jsonify({'status': 'start'})
        leg_board.pop()
        leg_index -= 1
        return jsonify({'status': 'ok', 'index': leg_index, 'total': len(leg_moves),
                        'captured': _leg_captured()})


@app.route('/api/leg/reset', methods=['POST'])
def api_leg_reset():
    global leg_board, leg_index, leg_cap_w, leg_cap_b
    with leg_lock:
        leg_board = chess.Board()
        leg_index = 0
        leg_cap_w = 0
        leg_cap_b = 0
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
    threading.Thread(target=button_poll_loop,  daemon=True).start()
    threading.Thread(target=magnet_watchdog,   daemon=True).start()
    log_gcode("🚀 Serveur Robot Échecs démarré.")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
