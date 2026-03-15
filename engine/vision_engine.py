import cv2
import numpy as np
import time
import os

class VisionEngine:
    def __init__(self, board_size=10):
        self.board_size = board_size # 10x10 pour inclure le cimetière
        self.homography_matrix = None
        self.reference_frame = None # Photo du plateau stable
        
    def auto_calibrate(self, frame):
        """
        Détecte les 4 Dames Noires aux coins du plateau.
        Le plateau est de 200x200mm, soit 10x10 cases de 20mm.
        Retourne True si la calibration a réussi.
        """
        # 1. Prétraitement
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # On cherche des zones très sombres (les dames noires sur fond clair)
        _, thresh = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY_INV)
        
        # 2. Trouver les contours des marqueurs
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        centers = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            # Filtre par taille (ni trop petit comme du bruit, ni trop gros)
            if 100 < area < 5000:
                M = cv2.moments(cnt)
                if M["m00"] != 0:
                    cX = int(M["m10"] / M["m00"])
                    cY = int(M["m01"] / M["m00"])
                    centers.append((cX, cY))
        
        if len(centers) < 4:
            print(f"[VISION] Pas assez de marqueurs trouvés : {len(centers)}/4")
            return False
            
        # 3. Trier les 4 points : haut-gauche, haut-droite, bas-droite, bas-gauche
        centers = self._sort_points(centers[:4])
        
        # 4. Calculer l'homographie
        # On veut projeter ces 4 points sur un carré parfait de 400x400 pixels
        dst_pts = np.array([
            [0, 0],
            [399, 0],
            [399, 399],
            [0, 399]
        ], dtype="float32")
        
        src_pts = np.array(centers, dtype="float32")
        self.homography_matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
        print("[VISION] Calibration réussie !")
        return True

    def _sort_points(self, pts):
        """Trie les points dans l'ordre : [top-left, top-right, bottom-right, bottom-left]"""
        rect = np.zeros((4, 2), dtype="float32")
        s = np.sum(pts, axis=1)
        rect[0] = pts[np.argmin(s)] # Top-left (somme min)
        rect[2] = pts[np.argmax(s)] # Bottom-right (somme max)
        
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)] # Top-right (diff min)
        rect[3] = pts[np.argmax(diff)] # Bottom-left (diff max)
        return rect

    def get_warped_board(self, frame):
        """Applique le redressement de perspective sur l'image"""
        if self.homography_matrix is None:
            return None
        return cv2.warpPerspective(frame, self.homography_matrix, (400, 400))

    def detect_move(self, current_frame):
        """
        Compare l'image actuelle à l'image de référence pour identifier un mouvement.
        Retourne un coup au format UCI (ex: 'e2e4') ou None.
        """
        if self.reference_frame is None or self.homography_matrix is None:
            self.reference_frame = self.get_warped_board(current_frame)
            return None
            
        new_board = self.get_warped_board(current_frame)
        
        # Analyse par différence
        diff = cv2.absdiff(self.reference_frame, new_board)
        gray_diff = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        _, thresh = cv2.threshold(gray_diff, 30, 255, cv2.THRESH_BINARY)
        
        # Analyser chaque case (10x10)
        # Rappel : Colonne 0 = Zone Noire, Colonne 9 = Zone Blanche, Col 1-8 = Plateau
        # On ne s'intéresse qu'au plateau 8x8 pour le coup UCI (Indices 1 à 8)
        changes = []
        cell_size = 40 # 400px / 10 cases
        
        for r in range(10):
            for c in range(10):
                # Découpe de la case
                y1, y2 = r * cell_size, (r + 1) * cell_size
                x1, x2 = c * cell_size, (c + 1) * cell_size
                
                # Zone de test (on réduit un peu pour éviter les bords des cases)
                roi = thresh[y1+5:y2-5, x1+5:x2-5]
                score = np.sum(roi) / 255
                
                if score > (cell_size * cell_size * 0.2): # 20% de la case a changé
                    changes.append((c, r))
        
       # Un coup classique = une case qui se vide, une case qui se remplit
        if len(changes) == 2:
            c1, r1 = changes[0]
            c2, r2 = changes[1]
            
            if 1 <= c1 <= 8 and 1 <= r1 <= 8 and 1 <= c2 <= 8 and 1 <= r2 <= 8:
                files = "abcdefgh"
                
                # Fonction locale pour évaluer la "quantité de pièce" sur une case
                def get_piece_presence(frame, c, r):
                    y1, y2 = r * cell_size, (r + 1) * cell_size
                    x1, x2 = c * cell_size, (c + 1) * cell_size
                    roi = frame[y1+5:y2-5, x1+5:x2-5]
                    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                    _, thresh = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)
                    return np.sum(thresh)

                # On compare la présence de pièce entre AVANT et MAINTENANT
                diff1 = get_piece_presence(new_board, c1, r1) - get_piece_presence(self.reference_frame, c1, r1)
                diff2 = get_piece_presence(new_board, c2, r2) - get_piece_presence(self.reference_frame, c2, r2)

                # La case source est celle qui a PERDU une pièce (différence la plus négative)
                if diff1 < diff2:
                    src, dest = (c1, r1), (c2, r2)
                else:
                    src, dest = (c2, r2), (c1, r1)

                sq1 = files[src[0]-1] + str(src[1])
                sq2 = files[dest[0]-1] + str(dest[1])
                
                shape_name = self.recognize_piece_shape(new_board, dest[0], dest[1])
                if shape_name:
                    print(f"[VISION] Pièce identifiée à l'arrivée : {shape_name}")

                return sq1 + sq2 
                
        return None

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
        if not contours: return None
        
        cnt = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(cnt)
        if area < 50: return None
        
        # Approche par approximation de polygone
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
        sides = len(approx)
        
        if sides == 3: return "Cavalier (Triangle)"
        if sides == 4: return "Dame (Carré)"
        if sides == 6: return "Tour (Hexagone)"
        
        # Pour les formes plus complexes (Rond, Coeur, Étoile), on pourrait utiliser les moments de Hu
        # ou un classifieur, mais commençons par les côtés simples.
        if 8 <= sides <= 12: return "Roi (Rond)"
        if sides > 12: return "Pion (Étoile)"
        
        return "Fou (Coeur)" # Fallback par défaut pour les formes courbes/complexes

    def get_debug_frame(self, frame):
        """Produit une image redressée avec les cases et les noms des pièces détectées."""
        warped = self.get_warped_board(frame)
        if warped is None: return frame
        
        debug_img = warped.copy()
        cell_size = 40
        
        for r in range(1, 9): # On ne dessine que l'échiquier 8x8
            for c in range(1, 9):
                y1, y2 = r * cell_size, (r + 1) * cell_size
                x1, x2 = c * cell_size, (c + 1) * cell_size
                
                # Dessiner la grille
                cv2.rectangle(debug_img, (x1, y1), (x2, y2), (0, 255, 0), 1)
                
                # Tenter d'identifier la pièce sur cette case
                shape = self.recognize_piece_shape(warped, c, r)
                if shape:
                    label = shape.split(' ')[0] # Juste le nom
                    cv2.putText(debug_img, label, (x1+2, y1+25), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
        
        return debug_img

    def update_reference(self, frame):
        """Met à jour l'image de référence après un mouvement du robot."""
        self.reference_frame = self.get_warped_board(frame)
