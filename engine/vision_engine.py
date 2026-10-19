import cv2
import numpy as np
import time
import os
import sys
import config


def open_camera():
    """
    Ouvre la caméra USB SQ11 via V4L2 standard (cv2.VideoCapture).
    Retourne un objet VideoCapture ou None en cas d'échec.
    """
    idx = config.CAMERA_USB_INDEX
    cap = cv2.VideoCapture(idx, cv2.CAP_V4L2)
    if not cap.isOpened():
        # Tentative sans forcer V4L2 (fallback générique)
        cap = cv2.VideoCapture(idx)
    if not cap.isOpened():
        print(f"[VISION] ERREUR : Impossible d'ouvrir la caméra USB (index={idx}).")
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  config.CAMERA_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.CAMERA_HEIGHT)
    # Désactiver l'autofocus si supporté (réduit les artefacts de flou)
    cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
    print(f"[VISION] Caméra USB ouverte : /dev/video{idx}  "
          f"({int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
          f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))})")
    return cap


def capture_frame(cap, n_warmup=5):
    """
    Capture une frame stable depuis la caméra.
    On lit n_warmup images pour laisser l'AGC/AWB se stabiliser.
    """
    for _ in range(n_warmup):
        cap.read()
    ret, frame = cap.read()
    if not ret or frame is None:
        print("[VISION] ERREUR : Lecture caméra échouée.")
        return None
    return frame


class VisionEngine:
    CALIB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "vision_calibration.json")

    def __init__(self, board_size=10):
        self.board_size = board_size  # 10x10 pour inclure le cimetière
        self.homography_matrix = None
        self.reference_frame = None  # Photo du plateau stable (redressée, niveaux de gris)
        self.last_scores = {}        # Score de changement par case (dernière détection)
        self.load_calibration()

    # ── Calibration persistante ─────────────────────────────────────────────
    def is_calibrated(self):
        return self.homography_matrix is not None

    def load_calibration(self):
        import json
        try:
            with open(self.CALIB_FILE) as f:
                self.homography_matrix = np.array(json.load(f)["homography"], dtype="float64")
            print(f"[VISION] Calibration chargée depuis {self.CALIB_FILE}")
        except FileNotFoundError:
            print("[VISION] Pas encore de calibration (page Contrôle manuel → CALIBRER CAMÉRA).")
        except Exception as e:
            print(f"[VISION] Calibration illisible : {e}")

    def save_calibration(self):
        import json
        with open(self.CALIB_FILE, "w") as f:
            json.dump({"homography": self.homography_matrix.tolist(),
                       "date": time.strftime("%Y-%m-%d %H:%M:%S")}, f, indent=2)

    def auto_calibrate(self, frame):
        """
        Détecte les 4 Dames Noires posées sur a1, h1, a8 et h8 (plateau vide autour).
        Le plateau est de 200x200mm, soit 10x10 cases de 20mm.
        Retourne True si la calibration a réussi.
        """
        # 1. Prétraitement : zones très sombres (pièces noires sur bois clair)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)
        h_img, w_img = gray.shape
        center = np.array([w_img / 2, h_img / 2])

        # 2. Taches sombres assez grosses pour être une pièce (le cadre, les pinces sont plus petits)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(thresh)
        blobs = []
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 0.0025 * w_img * h_img:
                continue
            ys, xs = np.nonzero(labels == i)
            pts = np.c_[xs, ys].astype(np.float32)
            # Vues par une caméra grand angle, les pièces hautes "penchent" vers l'extérieur :
            # le socle est la partie de la silhouette la plus proche du centre de l'image.
            dist = np.linalg.norm(pts - center, axis=1)
            k = max(20, int(len(pts) * 0.4))
            blobs.append((stats[i, cv2.CC_STAT_AREA], pts[np.argsort(dist)[:k]].mean(axis=0)))

        candidates = [tuple(p) for _, p in sorted(blobs, key=lambda b: -b[0])]
        # S'il reste des intrus, on garde les 4 points qui forment le plus grand quadrilatère
        centers = candidates
        if len(candidates) > 4:
            import itertools
            best_area = -1
            for quad in itertools.combinations(candidates[:8], 4):
                hull = cv2.convexHull(np.array(quad, dtype=np.float32))
                if len(hull) == 4 and cv2.contourArea(hull) > best_area:
                    best_area, centers = cv2.contourArea(hull), list(quad)

        # Le point trouvé est légèrement décalé vers le centre : on le repousse
        # de ~0,2 case vers l'extérieur (taille de case estimée sur l'écart entre repères).
        if len(centers) == 4:
            pts = np.array(centers, dtype=np.float32)
            side = np.mean([np.linalg.norm(pts[i] - pts[j]) for i in range(4) for j in range(i + 1, 4)
                            if np.linalg.norm(pts[i] - pts[j]) < 1.2 * np.median(
                                [np.linalg.norm(pts[a_] - pts[b_]) for a_ in range(4) for b_ in range(a_ + 1, 4)])])
            square_px = side / 7.0
            out = []
            for p in pts:
                v = p - center
                norm = np.linalg.norm(v)
                out.append(tuple(p + (v / norm) * 0.2 * square_px if norm > 0 else p))
            centers = out

        self.last_marker_count = len(centers)
        if len(centers) != 4:
            print(f"[VISION] Il faut exactement 4 marqueurs, trouvés : {len(centers)}")
            return False

        # 3. Trier les 4 points : haut-gauche, haut-droite, bas-droite, bas-gauche
        centers = self._sort_points(np.array(centers))

        # 4. Calculer l'homographie vers un carré de 400x400 px (10 cases de 40 px).
        # Les dames sont au centre de a1/h1/a8/h8 (cellules 1 et 8 de la grille 10x10),
        # ou, en mode ancien, au centre des 4 cases d'angle de la grille 10x10.
        if getattr(config, "VISION_CALIB_SQUARES", True):
            lo, hi = 60, 340
        else:
            lo, hi = 20, 380
        dst_pts = np.array([
            [lo, lo],
            [hi, lo],
            [hi, hi],
            [lo, hi]
        ], dtype="float32")

        src_pts = np.array(centers, dtype="float32")
        self.homography_matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
        print("[VISION] Calibration réussie !")
        return True

    def _sort_points(self, pts):
        """Trie les points dans l'ordre : [top-left, top-right, bottom-right, bottom-left]"""
        rect = np.zeros((4, 2), dtype="float32")
        s = np.sum(pts, axis=1)
        rect[0] = pts[np.argmin(s)]  # Top-left (somme min)
        rect[2] = pts[np.argmax(s)]  # Bottom-right (somme max)

        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]  # Top-right (diff min)
        rect[3] = pts[np.argmax(diff)]  # Bottom-left (diff max)
        return rect

    def get_warped_board(self, frame):
        """Applique le redressement de perspective sur l'image"""
        if self.homography_matrix is None:
            return None
        return cv2.warpPerspective(frame, self.homography_matrix, (400, 400))

    # ── Correspondance case d'échecs ↔ cellule de l'image redressée ─────────
    @staticmethod
    def square_to_cell(square):
        """
        Case python-chess (0..63) → (colonne, rangée) dans la grille 10x10 redressée.
        Par défaut : colonne a = cellule 1, rangée 1 = cellule 1 (en haut de l'image).
        Si les noms de cases de l'image de debug ne correspondent pas au plateau,
        ajuster VISION_FLIP_FILES / VISION_FLIP_RANKS / VISION_SWAP_AXES dans config.py.
        """
        f, r = square % 8, square // 8
        if getattr(config, "VISION_FLIP_FILES", False):
            f = 7 - f
        if getattr(config, "VISION_FLIP_RANKS", False):
            r = 7 - r
        c, row = f + 1, r + 1
        if getattr(config, "VISION_SWAP_AXES", False):
            c, row = row, c
        return c, row

    def _prepare(self, frame):
        """Redresse + niveaux de gris + léger flou (réduit le bruit capteur)."""
        warped = self.get_warped_board(frame)
        if warped is None:
            return None
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        return cv2.GaussianBlur(gray, (5, 5), 0)

    def set_reference(self, frame):
        """Mémorise la photo du plateau stable (après le coup du robot)."""
        self.reference_frame = self._prepare(frame)
        return self.reference_frame is not None

    def update_reference(self, frame):
        return self.set_reference(frame)

    def square_change_scores(self, frame):
        """Différence moyenne (0-255) entre la référence et `frame`, pour chaque case."""
        cur = self._prepare(frame)
        if cur is None or self.reference_frame is None:
            return None
        diff = cv2.absdiff(self.reference_frame, cur)
        cell, m = 40, 8  # marge : on ignore les bords de case
        scores = {}
        for sq in range(64):
            c, r = self.square_to_cell(sq)
            roi = diff[r * cell + m:(r + 1) * cell - m, c * cell + m:(c + 1) * cell - m]
            scores[sq] = float(roi.mean())
        self.last_scores = scores
        return scores

    @staticmethod
    def move_squares(board, move):
        """Cases dont le contenu change physiquement pour ce coup."""
        import chess
        sq = {move.from_square, move.to_square}
        if board.is_en_passant(move):
            sq.add(chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square)))
        elif board.is_castling(move):
            rank = chess.square_rank(move.from_square)
            if chess.square_file(move.to_square) > chess.square_file(move.from_square):
                sq |= {chess.square(7, rank), chess.square(5, rank)}
            else:
                sq |= {chess.square(0, rank), chess.square(3, rank)}
        return sq

    def detect_legal_move(self, board, frame):
        """
        Trouve le coup légal qui explique le mieux les changements vus par la caméra.
        Retourne (move ou None, message).
        """
        scores = self.square_change_scores(frame)
        if scores is None:
            return None, "Pas de photo de référence ou caméra non calibrée."
        thr = getattr(config, "VISION_DIFF_THRESHOLD", 18)
        changed = {sq for sq, v in scores.items() if v > thr}
        if not changed:
            return None, "Aucun changement vu sur le plateau."
        if len(changed) > 6:
            return None, f"Trop de cases modifiées ({len(changed)}) : main dans le champ ou lumière qui a changé ?"

        best, best_key, tie = None, None, False
        seen = set()
        for move in board.legal_moves:
            if move.promotion and move.promotion != 5:  # 5 = chess.QUEEN : promotion en dame
                continue
            squares = frozenset(self.move_squares(board, move))
            if squares in seen:
                continue
            seen.add(squares)
            if not squares <= changed:
                continue
            # Le meilleur coup explique le plus de changements et en laisse le moins
            key = (-len(changed - squares), len(squares), min(scores[s] for s in squares))
            if best_key is None or key[:2] > best_key[:2]:
                best, best_key, tie = move, key, False
            elif key[:2] == best_key[:2]:
                tie = True
                if key[2] > best_key[2]:
                    best, best_key = move, key
        if best is None:
            import chess
            names = ", ".join(sorted(chess.square_name(s) for s in changed))
            return None, f"Changements ({names}) ne correspondant à aucun coup légal."
        if tie:
            return None, "Plusieurs coups possibles, impossible de trancher."
        return best, "ok"

    def recognize_piece_shape(self, frame, col, row):
        """
        Analyse la forme du socle de la pièce sur une case donnée.
        Formes : Étoile (Pion), Hexagone (Tour), Triangle (Cavalier), Coeur (Fou), Rond (Roi), Carré (Dame).
        """
        cell_size = 40
        y1, y2 = row * cell_size, (row + 1) * cell_size
        x1, x2 = col * cell_size, (col + 1) * cell_size

        roi = frame[y1+5:y2-5, x1+5:x2-5]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        cnt = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(cnt)
        if area < 50:
            return None

        # Approche par approximation de polygone
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
        sides = len(approx)

        if sides == 3: return "Cavalier (Triangle)"
        if sides == 4: return "Dame (Carré)"
        if sides == 6: return "Tour (Hexagone)"

        # Pour les formes plus complexes (Rond, Coeur, Étoile)
        if 8 <= sides <= 12: return "Roi (Rond)"
        if sides > 12: return "Pion (Étoile)"

        return "Fou (Coeur)"  # Fallback par défaut pour les formes courbes/complexes

    def get_debug_frame(self, frame):
        """Produit une image redressée avec les cases et les noms des pièces détectées."""
        warped = self.get_warped_board(frame)
        if warped is None:
            return frame

        debug_img = warped.copy()
        cell_size = 40

        files = "abcdefgh"
        thr = getattr(config, "VISION_DIFF_THRESHOLD", 18)
        for sq in range(64):
            c, r = self.square_to_cell(sq)
            y1, y2 = r * cell_size, (r + 1) * cell_size
            x1, x2 = c * cell_size, (c + 1) * cell_size
            changed = self.last_scores.get(sq, 0) > thr
            # Grille (rouge = case vue comme modifiée au dernier coup)
            cv2.rectangle(debug_img, (x1, y1), (x2, y2), (0, 0, 255) if changed else (0, 255, 0), 1)
            # Nom de la case : permet de vérifier l'orientation caméra
            cv2.putText(debug_img, files[sq % 8] + str(sq // 8 + 1), (x1 + 3, y1 + 13),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 0), 1)

        return debug_img

    def update_reference(self, frame):
        """Met à jour l'image de référence après un mouvement du robot."""
        self.reference_frame = self.get_warped_board(frame)
