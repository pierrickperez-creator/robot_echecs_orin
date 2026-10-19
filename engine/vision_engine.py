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

    # ── Apprentissage des socles (forme ↔ pièce) ─────────────────────────────
    PIECE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "piece_shapes.json")
    HI_CELL = 60   # px par case pour l'analyse de forme (≈ résolution native de la caméra)

    def _warp_hi(self, frame):
        s = self.HI_CELL / 40.0
        m = np.diag([s, s, 1.0]) @ self.homography_matrix
        return cv2.warpPerspective(frame, m, (10 * self.HI_CELL, 10 * self.HI_CELL))

    @staticmethod
    def _piece_mask(warped):
        """Pièces (blanches comme noires) = peu colorées ; le bois est jaune-orangé."""
        lab = cv2.cvtColor(cv2.GaussianBlur(warped, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
        chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
        mask = (chroma < getattr(config, "VISION_PIECE_CHROMA_MAX", 20)).astype(np.uint8) * 255
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), lab[..., 0]

    def _base_features(self, mask, lum, square):
        """Descripteurs de la forme du socle posé sur `square` (None si case vide)."""
        n = self.HI_CELL
        c, r = self.square_to_cell(square)
        m = n // 10
        crop = mask[r * n - m:(r + 1) * n + m, c * n - m:(c + 1) * n + m]
        lcrop = lum[r * n - m:(r + 1) * n + m, c * n - m:(c + 1) * n + m]
        cnts, _ = cv2.findContours(crop, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        ctr = np.array([crop.shape[1] / 2, crop.shape[0] / 2])
        best, best_score = None, 0
        for cnt in cnts:
            area = cv2.contourArea(cnt)
            if area < 0.12 * n * n:
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            score = area / (1 + np.linalg.norm(np.array([x + w / 2, y + h / 2]) - ctr))
            if score > best_score:
                best, best_score = cnt, score
        if best is None:
            return None
        area = cv2.contourArea(best)
        hull = cv2.convexHull(best)
        hull_area = max(cv2.contourArea(hull), 1)
        peri = max(cv2.arcLength(best, True), 1)
        approx = cv2.approxPolyDP(best, 0.03 * peri, True)
        defects = 0
        hull_idx = cv2.convexHull(best, returnPoints=False)
        if hull_idx is not None and len(hull_idx) > 3:
            d = cv2.convexityDefects(best, hull_idx)
            if d is not None:
                defects = int((d[:, 0, 3] / 256.0 > 0.08 * n).sum())
        hu = cv2.HuMoments(cv2.moments(best)).flatten()[:3]
        hu = -np.sign(hu) * np.log10(np.abs(hu) + 1e-12)
        piece_mask = np.zeros_like(crop)
        cv2.drawContours(piece_mask, [best], -1, 255, -1)
        mean_l = float(lcrop[piece_mask > 0].mean())
        feats = [area / (n * n), area / hull_area, 4 * np.pi * area / peri ** 2,
                 min(len(approx), 12) / 12.0, min(defects, 6) / 6.0] + list(hu / 4.0)
        return {"features": [float(f) for f in feats], "lum": mean_l}

    def learn_piece_bases(self, frame, board):
        """
        Mémorise la forme du socle de chaque pièce présente sur `board` (position connue,
        normalement la position de départ). Enregistre piece_shapes.json et une planche
        d'images piece_shapes.jpg. Retourne un rapport (dont une estimation de fiabilité).
        """
        import json
        warped = self._warp_hi(frame)
        mask, lum = self._piece_mask(warped)
        samples, missing = [], []
        for sq, piece in board.piece_map().items():
            f = self._base_features(mask, lum, sq)
            if f is None:
                missing.append(piece.symbol())
                continue
            samples.append({"square": sq, "piece": piece.symbol(), **f})
        dark = [s["lum"] for s in samples if s["piece"].islower()]
        light = [s["lum"] for s in samples if s["piece"].isupper()]
        lum_split = (np.mean(dark) + np.mean(light)) / 2 if dark and light else 110.0
        self.piece_db = {"samples": samples, "lum_split": float(lum_split),
                         "date": time.strftime("%Y-%m-%d %H:%M:%S")}
        with open(self.PIECE_FILE, "w") as fh:
            json.dump(self.piece_db, fh, indent=1)
        self._save_piece_sheet(warped, mask, board)

        # Fiabilité estimée : chaque socle reconnu à partir de tous les autres
        ok_type = ok_full = 0
        errors = []
        for i, s in enumerate(samples):
            others = samples[:i] + samples[i + 1:]
            guess = self._knn(s["features"], s["lum"], others, lum_split)
            ok_type += guess.lower() == s["piece"].lower()
            ok_full += guess == s["piece"]
            if guess != s["piece"]:
                import chess
                errors.append(f"{chess.square_name(s['square'])}:{s['piece']}→{guess}")
        n = max(len(samples), 1)
        return {"learned": len(samples), "missing": missing,
                "type_accuracy": round(100 * ok_type / n), "full_accuracy": round(100 * ok_full / n),
                "errors": errors}

    def _knn(self, feats, lum, samples, lum_split, k=3):
        is_black = lum < lum_split
        # La forme ne dépend pas de la couleur : on compare à tous les socles appris,
        # la couleur est donnée à part par la luminosité.
        d = sorted(samples, key=lambda s: np.linalg.norm(np.array(s["features"]) - np.array(feats)))[:k]
        votes = {}
        for rank, s in enumerate(d):
            t = s["piece"].lower()
            votes[t] = votes.get(t, 0) + 1.0 / (1 + rank)
        t = max(votes, key=votes.get)
        return t if is_black else t.upper()

    def load_piece_db(self):
        import json
        try:
            with open(self.PIECE_FILE) as fh:
                self.piece_db = json.load(fh)
        except Exception:
            self.piece_db = None
        return self.piece_db

    def identify_piece(self, frame, square):
        """Symbole de la pièce sur `square` d'après la forme de son socle (None si inconnu)."""
        db = getattr(self, "piece_db", None) or self.load_piece_db()
        if not db or self.homography_matrix is None:
            return None
        warped = self._warp_hi(frame)
        mask, lum = self._piece_mask(warped)
        f = self._base_features(mask, lum, square)
        if f is None:
            return None
        return self._knn(f["features"], f["lum"], db["samples"], db["lum_split"])

    def _save_piece_sheet(self, warped, mask, board):
        """Planche de contrôle : chaque case occupée, image + masque du socle."""
        import chess
        n = self.HI_CELL
        tiles = []
        for sq in sorted(board.piece_map(), key=lambda q: (-(q // 8), q % 8)):
            c, r = self.square_to_cell(sq)
            img = warped[r * n:(r + 1) * n, c * n:(c + 1) * n].copy()
            msk = cv2.cvtColor(mask[r * n:(r + 1) * n, c * n:(c + 1) * n], cv2.COLOR_GRAY2BGR)
            tile = np.vstack([img, msk])
            cv2.putText(tile, f"{chess.square_name(sq)} {board.piece_at(sq).symbol()}", (2, 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            tiles.append(tile)
        if tiles:
            rows = [np.hstack(tiles[i:i + 8]) for i in range(0, len(tiles), 8)]
            w = max(r_.shape[1] for r_ in rows)
            rows = [np.pad(r_, ((0, 0), (0, w - r_.shape[1]), (0, 0))) for r_ in rows]
            cv2.imwrite(os.path.splitext(self.PIECE_FILE)[0] + ".jpg", np.vstack(rows))

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
