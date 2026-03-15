from flask import Flask, render_template, Response, request, jsonify
import sys
import os
import time
import threading
import json
import serial
import chess

# --- Protection Import OpenCV ---
try:
    import cv2
except ImportError:
    print("ERREUR: OpenCV manquant. (pip install opencv-python)")
    sys.exit(1)

# --- Configuration ---
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path: sys.path.append(parent_dir)

import config
from engine.chess_logic import ChessEngine
from engine.vision_engine import VisionEngine

app = Flask(__name__)
game_engine = ChessEngine()
vision_engine = VisionEngine()

# --- GLOBALS ---
ser = None
serial_lock = threading.Lock()
gcode_log_buffer = []
bayer_mode = 0  # 0=Auto, 1-4=Manuels pour corriger le vert
stop_requested = False # DRAPEAU DE SÉCURITÉ

# =============================================================================
# GESTION MATÉRIEL (MOTEURS)
# =============================================================================
def init_printer():
    """Initialise la connexion série comme le script de test."""
    global ser
    if config.SIMULATION_MODE:
        log_gcode("MODE SIMULATION ACTIVE")
        return

    port = config.MARLIN_PORT
    baud = config.MARLIN_BAUD
    
    if not port:
        log_gcode("ERREUR: Aucun port configuré dans config.py")
        return

    try:
        log_gcode(f"Connexion à {port}...")
        ser = serial.Serial(port, baud, timeout=1)
        
        # Reset de la carte (DTR)
        ser.dtr = False
        time.sleep(0.1)
        ser.dtr = True
        time.sleep(2.0) # Attente reboot
        ser.reset_input_buffer()
        
        log_gcode("Imprimante connectée !")
        # Configuration des steps/mm pour l'axe Z (Tiges T8)
        log_gcode("Calibration Z (M92 Z400)...")
        send_gcode_raw("M92 Z400")
        send_gcode_raw("M500") # Sauvegarde EEPROM

        # On envoie un M105 juste pour réveiller la com
        send_gcode_raw("M105")
        
    except Exception as e:
        log_gcode(f"Erreur Connexion: {e}")
        ser = None

def send_gcode_raw(command):
    """Envoie du G-Code brut et attend le 'ok'."""
    global ser
    if config.SIMULATION_MODE:
        log_gcode(f"[SIMU] {command}")
        return True
        
    if not ser:
        return False

    with serial_lock:
        try:
            full_cmd = f"{command}\n".encode()
            ser.write(full_cmd)
            
            # On lit la réponse jusqu'au 'ok'
            start = time.time()
            while time.time() - start < 5.0: # Timeout sécurité 5s
                if ser.in_waiting:
                    line = ser.readline().decode(errors='ignore').strip()
                    if line == "ok" or "ok" in line:
                        return True
            return False # Timeout
        except Exception as e:
            log_gcode(f"Erreur Envoi: {e}")
            return False

def log_gcode(msg):
    global gcode_log_buffer
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")
    gcode_log_buffer.append(f"[{ts}] {msg}")
    if len(gcode_log_buffer) > 50: gcode_log_buffer.pop(0)

# Fonctions de mouvement haut niveau
def move_xyz(x, y, z):
    global stop_requested
    if stop_requested: return # Arrêt immédiat si demandé
    
    # En absolu
    send_gcode_raw("G90")
    cmd = f"G0 X{x:.2f} Y{y:.2f} Z{z:.2f} F{config.FEED_TRAVEL}"
    send_gcode_raw(cmd)
    send_gcode_raw("M400") # Attente fin mouvement

def home_all():
    send_gcode_raw("G28 X Y Z")

def magnet(state):
    global stop_requested
    if stop_requested: return
    
    # state: True=ON, False=OFF
    pwm = 255 if state else 0
    # M42 P22 S255 (Pin 22 est souvent le fan ou une pin libre)
    send_gcode_raw(f"M42 P{config.MAGNET_PIN} S{pwm}")

def check_buttons():
    """Vérifie l'état du bouton physique via M119."""
    if config.SIMULATION_MODE: return False
    if not ser: return False
    
    # On évite de spammer trop fort pour ne pas saturer le buffer série
    with serial_lock:
        try:
            ser.write(b"M119\n")
            time.sleep(0.05)
            resp = ""
            while ser.in_waiting:
                resp += ser.readline().decode(errors='ignore')
            
            # Recherche de la ligne correspondant au bouton configurer
            target = config.ENDSTOP_BUTTON_NAME.lower()
            for line in resp.split("\n"):
                if target in line.lower() and "triggered" in line.lower():
                    return True
        except: pass
    return False

# --- VARIABLES DE FLUX ---
game_status_msg = "Initialisation..."
is_calibrated = False

def move_to_vision():
    """Déplace la tête à la position optimale pour la caméra."""
    move_xyz(config.VISION_X, config.VISION_Y, config.Z_VISION)
    time.sleep(1) # Attente stabilisation mécanique/focus cam

def game_watcher_loop():
    """Boucle de fond qui gère les étapes du jeu basé sur le bouton physique."""
    global game_status_msg, is_calibrated
    
    while True:
        # 1. ATTENTE CALIBRATION (Si pas faite)
        if not is_calibrated:
            game_status_msg = "Placer les 4 Dames Noires aux coins..."
            if check_buttons():
                log_gcode("Calibration demandée : Recul tête...")
                move_to_vision()
                frame_bytes = camera.get_frame_raw()
                if frame_bytes is not None:
                    if vision_engine.auto_calibrate(frame_bytes):
                        is_calibrated = True
                        game_status_msg = "Calibration OK ! À toi de jouer."
                        # Prendre la photo de référence initiale
                        vision_engine.update_reference(frame_bytes)
                        time.sleep(2)
                else:
                    game_status_msg = "Erreur Caméra pour calibration."
            time.sleep(0.5)
            continue

        # 2. TOUR HUMAIN (Attente bouton)
        if game_engine.board.turn == chess.WHITE:
            game_status_msg = "À toi de jouer (Blanc)"
            if check_buttons():
                game_status_msg = "Recul tête & Analyse..."
                log_gcode("Bouton pressé : Recul tête (Z100)...")
                move_to_vision()
                
                new_frame = camera.get_frame_raw()
                if new_frame is not None:
                    uci = vision_engine.detect_move(new_frame)
                    if uci and game_engine.push_uci(uci):
                        log_gcode(f"Mouvement détecté : {uci}")
                        game_engine.start_clock()
                        # Le tour passe aux Noirs automatiquement dans le board
                    else:
                        game_status_msg = "Coup non reconnu ou illégal. Réessaie."
                        log_gcode(f"Vision détection échec ou illégal : {uci}")
                        time.sleep(2)
        
        # 3. TOUR ROBOT (Automatique une fois que turn == chess.BLACK)
        elif game_engine.board.turn == chess.BLACK:
            game_status_msg = "Le robot joue..."
            
            move = game_engine.compute_bot_move()
            if move:
                log_gcode(f"Robot calcule : {move.uci()}")
                execute_move_sequence(move)
                game_engine.board.push(move)
                game_engine.start_clock()
                
                # Prise de photo de vérification / Mise à jour référence
                move_to_vision()
                final_frame = camera.get_frame_raw()
                if final_frame is not None:
                    vision_engine.update_reference(final_frame)
                
                game_status_msg = "À toi de jouer."
            else:
                game_status_msg = "Erreur IA."
        
        time.sleep(0.2)

# Lancement du watcher
threading.Thread(target=game_watcher_loop, daemon=True).start()

# =============================================================================
# GESTION VISION (CAMERA)
# =============================================================================
class CameraStream:
    def __init__(self):
        self.frame = b''
        self.last_mat = None
        self.running = True
        self.lock = threading.Lock()
        self.t = threading.Thread(target=self.update)
        self.t.daemon = True
        self.t.start()

    def update(self):
        # Choix de la source selon config
        src = 0
        method = cv2.CAP_V4L2
        
        if config.USE_GSTREAMER:
            src = (
                "nvarguscamerasrc sensor-id=0 ! "
                "video/x-raw(memory:NVMM), width=1280, height=720, format=NV12, framerate=30/1 ! "
                "nvvidconv flip-method=0 ! "
                "video/x-raw, width=640, height=360, format=BGRx ! "
                "videoconvert ! video/x-raw, format=BGR ! appsink drop=1"
            )
            method = cv2.CAP_GSTREAMER
        
        log_gcode(f"Démarrage Caméra ({'GStreamer' if config.USE_GSTREAMER else 'V4L2'})...")
        cap = cv2.VideoCapture(src, method)
        time.sleep(1)

        while self.running:
            if not cap.isOpened():
                time.sleep(1)
                try: cap.open(src, method)
                except: pass
                continue

            ret, img = cap.read()
            if ret:
                # Correction Bayer (Ecran vert) si nécessaire
                if bayer_mode > 0:
                    try:
                        if len(img.shape) == 3: gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                        else: gray = img
                        
                        code = None
                        if bayer_mode == 1: code = cv2.COLOR_BayerBG2BGR
                        elif bayer_mode == 2: code = cv2.COLOR_BayerGB2BGR
                        elif bayer_mode == 3: code = cv2.COLOR_BayerRG2BGR
                        elif bayer_mode == 4: code = cv2.COLOR_BayerGR2BGR
                        
                        if code: img = cv2.cvtColor(gray, code)
                    except: pass

                # Resize pour fluidité web
                # Conversion en Matrice (pour traitement interne)
                
                if config.BOARD_PX != 640:
                    img_resized = cv2.resize(img, (640, 360))
                else:
                    img_resized = img

                # Encodage JPG
                _, buf = cv2.imencode('.jpg', img_resized)

                # Le verrou protège maintenant la copie de la matrice !
                with self.lock:
                    self.last_mat = img.copy()
                    self.frame = buf.tobytes()
            else:
                time.sleep(0.1)
        
        cap.release()

    def get_frame(self):
        with self.lock: return self.frame

    def get_frame_raw(self):
        """Retourne l'image brute (Mat) pour OpenCV."""
        if not hasattr(self, 'last_mat'): return None
        with self.lock: return self.last_mat

# Démarrage threads
init_printer()
camera = CameraStream()

# =============================================================================
# LOGIQUE JEU & API
# =============================================================================
def calculate_xy(square_name):
    # Convertit "e2" en (X, Y) mm
    col = ord(square_name[0]) - ord('a') # 0..7
    row = int(square_name[1]) - 1        # 0..7
    
    # Repère machine
    x = config.BOARD_OFFSET_X + (col * config.SQUARE_SIZE_MM) + (config.SQUARE_SIZE_MM/2)
    y = config.BOARD_OFFSET_Y + (row * config.SQUARE_SIZE_MM) + (config.SQUARE_SIZE_MM/2)
    return x, y

def execute_move_sequence(move):
    """Génère et exécute la séquence G-Code pour un coup d'échecs."""
    global stop_requested
    board = game_engine.board
    
    # variable de classe ou globale pour suivre les index des cimetières
    # Pour l'instant, faisons une méthode simple qui parcourt les listes
    # ou mieux, lire les pièces manquantes.
    
    # 1. Gestion de la Prise (Capture)
    if board.is_capture(move):
        victim_sq = move.to_square
        if board.is_en_passant(move):
            offset = -8 if board.turn == chess.WHITE else 8
            victim_sq = move.to_square + offset
        
        victim_piece = board.piece_at(victim_sq)
        victim_name = chess.square_name(victim_sq)
        log_gcode(f"Capture en {victim_name}")
        
        vx, vy = calculate_xy(victim_name)
        
        # Détermination du cimetière
        graveyard_x, graveyard_y = 10, 10 # Fallback
        
        # Obtenir les pièces capturées actuelles
        captured = game_engine.get_captured_pieces()
        victims_color = 'w' if victim_piece and victim_piece.color == chess.WHITE else 'b'
        
        if victims_color == 'b':
            # La victime est noire (mangée par les blancs)
            # On cherche combien de pièces noires ont déjà été mangées (avant ce coup)
            idx = len(captured['b']) # On compte le nombre de pièces mangées
            if idx < len(config.BLACK_GRAVEYARD):
                graveyard_x, graveyard_y = config.BLACK_GRAVEYARD[idx]
        else:
            # La victime est blanche
            idx = len(captured['w'])
            if idx < len(config.WHITE_GRAVEYARD):
                graveyard_x, graveyard_y = config.WHITE_GRAVEYARD[idx]

        log_gcode(f"Cimetière cible: X{graveyard_x} Y{graveyard_y}")
        
        # Séquence Prise (avec check STOP à chaque étape)
        move_xyz(vx, vy, config.Z_SAFE_REL); 
        move_xyz(vx, vy, config.Z_PICK_REL); magnet(True); time.sleep(0.5)
        if stop_requested: return
        
        move_xyz(vx, vy, config.Z_TRAVEL_REL)
        move_xyz(graveyard_x, graveyard_y, config.Z_TRAVEL_REL)
        if stop_requested: return
        
        move_xyz(graveyard_x, graveyard_y, config.Z_PICK_REL); magnet(False); time.sleep(0.5)
        move_xyz(graveyard_x, graveyard_y, config.Z_SAFE_REL)
        if stop_requested: return

# 2. Gestion de la Promotion (Nouveau !)
    if move.promotion:
        src = chess.square_name(move.from_square)
        dst = chess.square_name(move.to_square)
        sx, sy = calculate_xy(src)
        dx, dy = calculate_xy(dst)
        
        promoter_color = 'w' if board.turn == chess.WHITE else 'b'
        captured = game_engine.get_captured_pieces()
        idx = len(captured[promoter_color])
        
        # Déterminer les coordonnées du cimetière et de la réserve
        if promoter_color == 'w':
            graveyard_x, graveyard_y = config.WHITE_GRAVEYARD[min(idx, len(config.WHITE_GRAVEYARD)-1)]
            res_idx = min(game_engine.used_white_queens, len(config.WHITE_QUEEN_RESERVE)-1)
            reserve_x, reserve_y = config.WHITE_QUEEN_RESERVE[res_idx]
            game_engine.used_white_queens += 1
        else:
            graveyard_x, graveyard_y = config.BLACK_GRAVEYARD[min(idx, len(config.BLACK_GRAVEYARD)-1)]
            res_idx = min(game_engine.used_black_queens, len(config.BLACK_QUEEN_RESERVE)-1)
            reserve_x, reserve_y = config.BLACK_QUEEN_RESERVE[res_idx]
            game_engine.used_black_queens += 1

        log_gcode(f"Promotion ! Pion {src} -> Cimetiere, Dame -> {dst}")
        
        # A. Le Pion va au cimetière
        move_xyz(sx, sy, config.Z_SAFE_REL)
        move_xyz(sx, sy, config.Z_PICK_REL); magnet(True); time.sleep(0.5)
        if stop_requested: return
        move_xyz(sx, sy, config.Z_TRAVEL_REL)
        move_xyz(graveyard_x, graveyard_y, config.Z_TRAVEL_REL)
        move_xyz(graveyard_x, graveyard_y, config.Z_PICK_REL); magnet(False); time.sleep(0.5)
        move_xyz(graveyard_x, graveyard_y, config.Z_SAFE_REL)
        if stop_requested: return
        
        # B. La Dame de réserve va sur la case de destination
        move_xyz(reserve_x, reserve_y, config.Z_SAFE_REL)
        move_xyz(reserve_x, reserve_y, config.Z_PICK_REL); magnet(True); time.sleep(0.5)
        if stop_requested: return
        move_xyz(reserve_x, reserve_y, config.Z_TRAVEL_REL)
        move_xyz(dx, dy, config.Z_TRAVEL_REL)
        move_xyz(dx, dy, config.Z_PICK_REL); magnet(False); time.sleep(0.5)
        move_xyz(dx, dy, config.Z_SAFE_REL)
        
        return # Fin de la séquence pour une promotion

    # 3. Gestion du Déplacement Classique
    src = chess.square_name(move.from_square)
    dst = chess.square_name(move.to_square)
    sx, sy = calculate_xy(src)
    dx, dy = calculate_xy(dst)
    
    log_gcode(f"Deplacement {src} -> {dst}")
    
    move_xyz(sx, sy, config.Z_SAFE_REL)
    move_xyz(sx, sy, config.Z_PICK_REL); magnet(True); time.sleep(0.5)
    if stop_requested: return
    
    move_xyz(sx, sy, config.Z_TRAVEL_REL)
    move_xyz(dx, dy, config.Z_TRAVEL_REL)
    if stop_requested: return
    
    move_xyz(dx, dy, config.Z_PICK_REL); magnet(False); time.sleep(0.5)
    move_xyz(dx, dy, config.Z_SAFE_REL)

    # 4. Gestion du Roque (Déplacement de la Tour)
    if board.is_castling(move):
        if move.to_square == chess.G1:   r_src, r_dst = "h1", "f1"
        elif move.to_square == chess.C1: r_src, r_dst = "a1", "d1"
        elif move.to_square == chess.G8: r_src, r_dst = "h8", "f8"
        elif move.to_square == chess.C8: r_src, r_dst = "a8", "d8"
        else: r_src = r_dst = None
            
        if r_src and r_dst:
            log_gcode(f"Roque : Deplacement Tour {r_src} -> {r_dst}")
            rsx, rsy = calculate_xy(r_src)
            rdx, rdy = calculate_xy(r_dst)
            
            move_xyz(rsx, rsy, config.Z_SAFE_REL)
            move_xyz(rsx, rsy, config.Z_PICK_REL); magnet(True); time.sleep(0.5)
            if stop_requested: return
            move_xyz(rsx, rsy, config.Z_TRAVEL_REL)
            move_xyz(rdx, rdy, config.Z_TRAVEL_REL)
            if stop_requested: return
            move_xyz(rdx, rdy, config.Z_PICK_REL); magnet(False); time.sleep(0.5)
            move_xyz(rdx, rdy, config.Z_SAFE_REL)

# --- ROUTES FLASK ---

@app.route('/')
def index(): return render_template('game.html')

@app.route('/settings')
def settings():
    return render_template('settings.html', 
                           cam_status="OK" if camera.get_frame() else "NO SIGNAL",
                           marlin_status="CONNECTÉ" if ser else "ERREUR")

@app.route('/video_feed')
def video_feed():
    def gen():
        while True:
            frame = camera.get_frame()
            if frame:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            time.sleep(0.05)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/video_feed/vision')
def video_feed_vision():
    def gen():
        while True:
            raw = camera.get_frame_raw()
            if raw is not None:
                debug_frame = vision_engine.get_debug_frame(raw)
                _, buf = cv2.imencode('.jpg', debug_frame)
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
            time.sleep(0.1)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/status')
def api_status():
    game_engine.update_clock()
    
    # Correction horloge si on vient d'annuler
    if not game_engine.clock_running and not game_engine.is_game_over():
         pass # On laisse l'horloge telle quelle
         
    return jsonify({
        'fen': game_engine.get_fen(),
        'turn': 'white' if game_engine.board.turn == chess.WHITE else 'black',
        'legal_moves': game_engine.get_legal_moves(),
        'last_move': game_engine.get_last_move_uci(),
        'pgn': game_engine.get_pgn(),
        'is_game_over': game_engine.is_game_over(),
        'captured_w': game_engine.get_captured_pieces()['w'],
        'captured_b': game_engine.get_captured_pieces()['b'],
        'time_white': int(game_engine.time_white),
        'time_black': int(game_engine.time_black),
        'status_msg': game_status_msg, # On ajoute le message d'état vision
        'is_calibrated': is_calibrated,
        'button_state': check_buttons(), # Test du bouton physique
        'logs': list(gcode_log_buffer)[-10:] if gcode_log_buffer else []
    })

@app.route('/api/move', methods=['POST'])
def api_move():
    import chess
    uci = request.json.get('uci')
    log_gcode(f"Joueur déclare : {uci}")
    if game_engine.push_uci(uci):
        game_engine.start_clock()
    return jsonify({"status": "ok", "fen": game_engine.get_fen()})

@app.route('/api/bot_move', methods=['POST'])
def api_bot_move():
    global stop_requested
    stop_requested = False # On réarme le stop au début d'un nouveau coup
    
    import chess
    move = game_engine.compute_bot_move()
    if move:
        log_gcode(f"Robot joue : {move.uci()}")
        
        execute_move_sequence(move)
        
        game_engine.board.push(move)
        game_engine.start_clock()
        return jsonify({"status": "ok", "uci": move.uci(), "fen": game_engine.get_fen()})
    return jsonify({"status": "error"})

@app.route('/api/undo', methods=['POST'])
def api_undo():
    log_gcode("Annulation du dernier coup (Undo)")
    game_engine.undo()
    return jsonify({"status": "ok", "fen": game_engine.get_fen()})

@app.route('/api/reset', methods=['POST'])
def api_reset():
    log_gcode("Nouvelle Partie (Reset)")
    game_engine.reset()
    return jsonify({"status": "ok", "fen": game_engine.get_fen()})

# --- Commandes Manuelles (Settings) ---
@app.route('/cmd/home', methods=['POST'])
def cmd_home():
    log_gcode("Commande HOME")
    home_all()
    return jsonify({"status": "ok"})

@app.route('/cmd/move_manual', methods=['POST'])
def cmd_manual():
    axis = request.json.get('axis') 
    dist = float(request.json.get('dist'))
    log_gcode(f"Manuel {axis.upper()} {dist}")
    
    send_gcode_raw("G91")
    send_gcode_raw(f"G0 {axis.upper()}{dist} F2000")
    send_gcode_raw("G90")
    return jsonify({"status": "ok"})

@app.route('/cmd/cycle_bayer', methods=['POST'])
def cmd_cycle_bayer():
    global bayer_mode
    bayer_mode = (bayer_mode + 1) % 5
    log_gcode(f"Mode Bayer : {bayer_mode}")
    return jsonify({"status": "ok", "mode": bayer_mode})

@app.route('/cmd/stop', methods=['POST'])
def cmd_stop():
    global stop_requested
    stop_requested = True # Active le drapeau rouge
    log_gcode("!!! ARRET D'URGENCE !!!")
    
    # On BYPASS le serial_lock car M400 le bloque pendant le mouvement !
    if ser:
        try:
            ser.write(b"M410\n")
        except Exception as e:
            log_gcode(f"Erreur M410: {e}")
            
    return jsonify({"status": "ok"})

@app.route('/cmd/goto_coords', methods=['POST'])
def cmd_goto_coords():
    x = float(request.json.get('x'))
    y = float(request.json.get('y'))
    log_gcode(f"Calibration: Aller en X{x} Y{y}")
    send_gcode_raw(f"G0 Z{config.Z_SAFE_REL} F{config.FEED_Z}")
    send_gcode_raw(f"G0 X{x} Y{y} F{config.FEED_TRAVEL}")
    send_gcode_raw(f"G0 Z{config.Z_TRAVEL_REL} F{config.FEED_Z}")
    return jsonify({"status": "ok"})

@app.route('/api/magnet', methods=['POST'])
def api_magnet():
    state = request.json.get('state', False)
    log_gcode(f"Test Aimant : {'ON' if state else 'OFF'}")
    magnet(state)
    return jsonify({"status": "ok", "state": state})

@app.route('/api/run_tests', methods=['POST'])
def api_run_tests():
    import unittest
    import io
    import sys
    import os
    
    # S'assurer que le dossier tests est accessible
    tests_dir = os.path.join(parent_dir, 'tests')
    if tests_dir not in sys.path:
        sys.path.append(tests_dir)
        
    try:
        from tests.test_chess_logic import TestChessLogic
        
        # Capture la sortie console des tests
        stream = io.StringIO()
        runner = unittest.TextTestRunner(stream=stream, verbosity=2)
        suite = unittest.TestLoader().loadTestsFromTestCase(TestChessLogic)
        result = runner.run(suite)
        
        return jsonify({
            "status": "ok" if result.wasSuccessful() else "error",
            "output": stream.getvalue(),
            "run": result.testsRun,
            "failures": len(result.failures),
            "errors": len(result.errors)
        })
    except Exception as e:
        return jsonify({"status": "error", "output": str(e), "run": 0, "failures": 0, "errors": 1})

@app.route('/cmd/physical_move', methods=['POST'])
def cmd_physical_move():
    """Exécute un mouvement physique brut d'un point A à un point B."""
    src = request.json.get('src')
    dst = request.json.get('dst')
    
    def get_loc_xy(loc):
        # 1. Case du plateau (ex: "e2")
        if len(loc) == 2 and loc[0] in "abcdefgh" and loc[1] in "12345678":
            return calculate_xy(loc)
        # 2. Cimetière Blanc (ex: "wg0")
        elif loc.startswith('wg'):
            idx = int(loc[2:])
            if idx < len(config.WHITE_GRAVEYARD): return config.WHITE_GRAVEYARD[idx]
        # 3. Cimetière Noir (ex: "bg0")
        elif loc.startswith('bg'):
            idx = int(loc[2:])
            if idx < len(config.BLACK_GRAVEYARD): return config.BLACK_GRAVEYARD[idx]
        # 4. Réserve Dames Blanches (ex: "wq0")
        elif loc.startswith('wq'):
            idx = int(loc[2:])
            if idx < len(config.WHITE_QUEEN_RESERVE): return config.WHITE_QUEEN_RESERVE[idx]
        # 5. Réserve Dames Noires (ex: "bq0")
        elif loc.startswith('bq'):
            idx = int(loc[2:])
            if idx < len(config.BLACK_QUEEN_RESERVE): return config.BLACK_QUEEN_RESERVE[idx]
        return None

    p_src = get_loc_xy(src)
    p_dst = get_loc_xy(dst)

    if not p_src or not p_dst:
        return jsonify({"status": "error", "msg": f"Coordonnées invalides: {src} ou {dst}"})

    log_gcode(f"Mouvement manuel physique : {src} -> {dst}")
    
    # Séquence physique de déplacement
    sx, sy = p_src
    dx, dy = p_dst
    
    move_xyz(sx, sy, config.Z_SAFE_REL)
    move_xyz(sx, sy, config.Z_PICK_REL)
    magnet(True)
    time.sleep(0.5)
    
    move_xyz(sx, sy, config.Z_TRAVEL_REL)
    move_xyz(dx, dy, config.Z_TRAVEL_REL)
    
    move_xyz(dx, dy, config.Z_PICK_REL)
    magnet(False)
    time.sleep(0.5)
    
    move_xyz(dx, dy, config.Z_SAFE_REL)
    
    return jsonify({"status": "ok"})

@app.route('/api/vision_frame')
def api_vision_frame():
    """Retourne une seule image JPEG de la vision (pour l'écran TFT)"""
    raw = camera.get_frame_raw()
    if raw is not None:
        debug_frame = vision_engine.get_debug_frame(raw)
        _, buf = cv2.imencode('.jpg', debug_frame)
        return Response(buf.tobytes(), mimetype='image/jpeg')
    return jsonify({"status": "error"}), 404

@app.route('/api/edit_board', methods=['POST'])
def api_edit_board():
    """Modifie la mémoire du plateau (corrige une erreur de l'IA)"""
    import chess
    sq_name = request.json.get('square')   # ex: 'e2'
    piece_symbol = request.json.get('piece') # 'P', 'k', ou '' (vide)
    
    try:
        sq_idx = chess.parse_square(sq_name)
        if piece_symbol == "":
            game_engine.board.remove_piece_at(sq_idx)
        else:
            piece = chess.Piece.from_symbol(piece_symbol)
            game_engine.board.set_piece_at(sq_idx, piece)
        
        log_gcode(f"Mémoire modifiée : {sq_name} -> {piece_symbol if piece_symbol else 'Vide'}")
        return jsonify({"status": "ok", "fen": game_engine.get_fen()})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)})

@app.route('/api/export_usb', methods=['POST'])
def api_export_usb():
    """Exporte l'historique PGN sur une clé USB branchée"""
    import datetime
    import glob
    import os
    
    # Cherche les clés USB montées sur le Jetson (Ubuntu monte dans /media/ ou /mnt/)
    usb_paths = glob.glob('/media/*/*') + glob.glob('/mnt/*')
    if not usb_paths:
        return jsonify({"status": "error", "msg": "Aucune clé USB détectée. Branchez-en une."})
    
    target_dir = usb_paths[0] # Prend la première clé trouvée
    date_str = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"partie_robot_{date_str}.pgn"
    filepath = os.path.join(target_dir, filename)
    
    try:
        pgn_data = game_engine.get_pgn()
        with open(filepath, 'w') as f:
            f.write(pgn_data)
        log_gcode(f"Partie sauvegardée sur USB : {filename}")
        return jsonify({"status": "ok", "msg": f"Sauvegardé avec succès sur :\n{filename}"})
    except Exception as e:
        return jsonify({"status": "error", "msg": f"Erreur d'écriture : {str(e)}"})

@app.route('/api/set_elo', methods=['POST'])
def api_set_elo():
    """Change le niveau ELO de Stockfish"""
    elo = request.json.get('elo')
    if elo:
        game_engine.set_elo(elo)
        log_gcode(f"Niveau d'IA changé : ELO {elo}")
        return jsonify({"status": "ok"})
    return jsonify({"status": "error"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
