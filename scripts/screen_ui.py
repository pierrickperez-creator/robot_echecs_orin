#!/usr/bin/env python3
import tkinter as tk
from tkinter import messagebox, Toplevel
import requests
import time
import random
import io
from PIL import Image, ImageTk

# Configuration
API_BASE_URL = "http://localhost:5000"
UPDATE_MS = 500
from config import DEFAULT_ELO  # Rafraîchissement toutes les 500ms

class ChessRobotUI(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("Robot Echecs")
        self.geometry("480x320") # Résolution cible (Quimat 3.5" paysage)
        self.configure(bg="#222222")
        
        # Plein écran ou sans bordure (décommenter sur le Raspberry Pi / Jetson)
        self.attributes('-fullscreen', True)
        
        # Masquer le curseur de la souris (utile pour les écrans tactiles purs)
        self.config(cursor="none")
        
        # Styles de base
        self.btn_font = ("Arial", 14, "bold")
        self.clock_font = ("Courier", 32, "bold")
        self.text_color = "#EEEEEE"
        
        # Variables d'état
        self.logs_text = tk.StringVar()
        self.time_w_str = tk.StringVar(value="10:00")
        self.time_b_str = tk.StringVar(value="10:00")
        self.status_msg = tk.StringVar(value="Initialisation...")
        self.magnet_on = False
        
        self.manual_frame = tk.Frame()
        self.manual_src = None
        self.manual_dst = None
        self.manual_labels = {}
        self.manual_state = {}
        self.manual_status_lbl = None
        self.init_manual_state()
        
        self.vision_frame = tk.Frame()
        self.edit_frame = tk.Frame()
        self.current_view = "main" # Permet de savoir quelle boucle faire tourner
        self.edit_labels = {}
        self.vision_lbl = None
        self.vision_photo = None
        
        self.elo_var = tk.IntVar(value=DEFAULT_ELO)
        self.elo_lbl_str = tk.StringVar(value=f"🤖 IA: {DEFAULT_ELO}")
        
        self.game_over_active = False # Verrou pour l'animation
        
        self.main_frame = tk.Frame()
        self.settings_frame = tk.Frame()
        self.status_label = tk.Label()
        self.log_label = tk.Label()
        self.btn_status_label = tk.Label()

        self.create_main_view()
        self.create_settings_view()
        
        self.show_main_view()
        
        # Lancement de la boucle de mise à jour
        self.update_status()

    # --- Vues ---
    def create_main_view(self):
        self.main_frame = tk.Frame(self, bg="#222222")
        
        # Horloges
        clocks_frame = tk.Frame(self.main_frame, bg="#222222")
        clocks_frame.pack(fill=tk.X, pady=10)
        
        white_frame = tk.Frame(clocks_frame, bg="#DDDDDD", bd=3, relief=tk.RAISED)
        white_frame.pack(side=tk.LEFT, expand=True, fill=tk.BOTH, padx=10)
        tk.Label(white_frame, text="BLANCS", bg="#DDDDDD", fg="#000000", font=("Arial", 12)).pack()
        tk.Label(white_frame, textvariable=self.time_w_str, bg="#DDDDDD", fg="#000000", font=self.clock_font).pack(pady=5)
        
        black_frame = tk.Frame(clocks_frame, bg="#333333", bd=3, relief=tk.RAISED)
        black_frame.pack(side=tk.RIGHT, expand=True, fill=tk.BOTH, padx=10)
        tk.Label(black_frame, text="NOIRS", bg="#333333", fg="#FFFFFF", font=("Arial", 12)).pack()
        tk.Label(black_frame, textvariable=self.time_b_str, bg="#333333", fg="#FFFFFF", font=self.clock_font).pack(pady=5)

        # Message de Statut (Centre)
        self.status_label = tk.Label(self.main_frame, textvariable=self.status_msg, bg="#222222", fg="#00BFFF", font=("Arial", 16, "bold"), wraplength=460)
        self.status_label.pack(fill=tk.BOTH, expand=True, pady=10)

        # Réglage ELO (Nouveau)
        elo_frame = tk.Frame(self.main_frame, bg="#222222")
        elo_frame.pack(fill=tk.X, pady=2)
        tk.Button(elo_frame, textvariable=self.elo_lbl_str, bg="#444444", fg="#FFEB3B", font=("Arial", 12, "bold"), command=self.open_elo_numpad).pack(expand=True, padx=20, fill=tk.X)

        # Boutons de contrôle (Simplifiés)
        btn_frame = tk.Frame(self.main_frame, bg="#222222")
        btn_frame.pack(fill=tk.X, pady=5)
        
        undo_btn = tk.Button(btn_frame, text="⟲ Annuler", bg="#FF9800", fg="#000000", font=self.btn_font, command=self.cmd_undo)
        undo_btn.pack(side=tk.LEFT, expand=True, fill=tk.BOTH, padx=5)
        
        reset_btn = tk.Button(btn_frame, text="Nouvelle Partie", bg="#4CAF50", fg="#FFFFFF", font=self.btn_font, command=self.cmd_reset)
        reset_btn.pack(side=tk.LEFT, expand=True, fill=tk.BOTH, padx=5)
        
        # Bouton Paramètres (en bas)
        settings_btn = tk.Button(self.main_frame, text="⚙️ Paramètres Moteurs", bg="#607D8B", fg="#FFFFFF", font=("Arial", 12), command=self.show_settings_view)
        settings_btn.pack(fill=tk.X, padx=10, pady=5)

    def create_settings_view(self):
        self.settings_frame = tk.Frame(self, bg="#222222")
        
        top_frame = tk.Frame(self.settings_frame, bg="#222222")
        top_frame.pack(fill=tk.X, pady=5)
        tk.Label(top_frame, text="🔧 Mouvements Manuels", bg="#222222", fg=self.text_color, font=("Arial", 14, "bold")).pack(side=tk.LEFT, padx=10)
        tk.Button(top_frame, text="Retour", bg="#555555", fg="#FFFFFF", command=self.show_main_view).pack(side=tk.RIGHT, padx=10)
        
        # Boutons de Jogging
        jog_frame = tk.Frame(self.settings_frame, bg="#222222")
        jog_frame.pack(pady=10)
        
        tk.Button(jog_frame, text="🏠 HOME", bg="#2196F3", fg="#FFFFFF", font=self.btn_font, width=8, command=self.cmd_home).grid(row=0, column=1, pady=5)
        
        tk.Button(jog_frame, text="+Y", bg="#777777", fg="#FFFFFF", width=5, font=self.btn_font, command=lambda: self.cmd_jog('y', 10)).grid(row=1, column=1)
        tk.Button(jog_frame, text="-X", bg="#777777", fg="#FFFFFF", width=5, font=self.btn_font, command=lambda: self.cmd_jog('x', -10)).grid(row=2, column=0)
        tk.Button(jog_frame, text="+X", bg="#777777", fg="#FFFFFF", width=5, font=self.btn_font, command=lambda: self.cmd_jog('x', 10)).grid(row=2, column=2)
        tk.Button(jog_frame, text="-Y", bg="#777777", fg="#FFFFFF", width=5, font=self.btn_font, command=lambda: self.cmd_jog('y', -10)).grid(row=3, column=1)
        
        tk.Button(jog_frame, text="+Z", bg="#9C27B0", fg="#FFFFFF", width=5, font=self.btn_font, command=lambda: self.cmd_jog('z', 10)).grid(row=1, column=3, padx=20)
        tk.Button(jog_frame, text="🧲 Aimant", bg="#607D8B", fg="#FFFFFF", width=8, font=("Arial", 12, "bold"), command=self.cmd_toggle_magnet).grid(row=2, column=3, padx=20)
        
        # Bouton de Tests Unitaires
        tk.Button(jog_frame, text="🧪 Tests IA", bg="#FFC107", fg="#000000", width=10, font=("Arial", 12, "bold"), command=self.cmd_run_tests).grid(row=3, column=3, padx=20)
        
        # Bouton Mode Manuel
        tk.Button(jog_frame, text="🕹️ Mode Manuel (Plateau)", bg="#E91E63", fg="#FFFFFF", font=("Arial", 12, "bold"), command=self.show_manual_view).grid(row=4, column=0, columnspan=2, pady=10)
        
        # Ligne de boutons d'administration
        admin_frame = tk.Frame(self.settings_frame, bg="#222222")
        admin_frame.pack(pady=5, fill=tk.X)
        
        tk.Button(admin_frame, text="👁️ Vision Directe", bg="#9C27B0", fg="#FFFFFF", font=("Arial", 10, "bold"), command=self.show_vision_view).pack(side=tk.LEFT, expand=True, padx=2)
        tk.Button(admin_frame, text="🧠 Corriger Plateau", bg="#E91E63", fg="#FFFFFF", font=("Arial", 10, "bold"), command=self.show_edit_view).pack(side=tk.LEFT, expand=True, padx=2)
        tk.Button(admin_frame, text="💾 Exporter USB", bg="#00BCD4", fg="#000000", font=("Arial", 10, "bold"), command=self.cmd_export_usb).pack(side=tk.LEFT, expand=True, padx=2)
        
        # Test Bouton
        self.btn_status_label = tk.Label(jog_frame, text="Bouton: RELACHÉ", bg="#333333", fg="#AAAAAA", font=("Arial", 10, "bold"))
        self.btn_status_label.grid(row=4, column=1, columnspan=3, pady=10)

        # Zone de logs
        log_frame = tk.Frame(self.settings_frame, bg="#000000", bd=2, relief=tk.SUNKEN)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        self.log_label = tk.Label(log_frame, textvariable=self.logs_text, bg="#000000", fg="#00FF00", font=("Courier", 10), justify=tk.LEFT, anchor="nw")
        self.log_label.pack(fill=tk.BOTH, expand=True)

    # --- Navigation ---
    def show_main_view(self):
        self.settings_frame.pack_forget()
        self.main_frame.pack(fill=tk.BOTH, expand=True)

    def show_settings_view(self):
        self.main_frame.pack_forget()
        self.settings_frame.pack(fill=tk.BOTH, expand=True)

    # --- API Calls ---
    def send_post(self, endpoint, payload=None):
        try:
            url = f"{API_BASE_URL}{endpoint}"
            requests.post(url, json=payload or {}, timeout=2)
            return True
        except requests.exceptions.RequestException as e:
            print(f"API Error {endpoint}: {e}")
            return False

    def cmd_undo(self): self.send_post('/api/undo')
    def cmd_reset(self): 
        if messagebox.askyesno("Nouvelle Partie", "Voulez-vous réinitialiser la partie ?"):
            self.send_post('/api/reset')
    def cmd_stop(self): self.send_post('/cmd/stop')
    def cmd_home(self): self.send_post('/cmd/home')
    def cmd_jog(self, axis, dist): self.send_post('/cmd/move_manual', {"axis": axis, "dist": dist})
    def cmd_toggle_magnet(self):
        self.magnet_on = not self.magnet_on
        self.send_post('/api/magnet', {"state": self.magnet_on})

    def cmd_run_tests(self):
        self.logs_text.set("Lancement des tests unitaires...")
        self.update() # Force le rafraîchissement de l'écran
        try:
            # Timeout un peu plus long car Stockfish doit démarrer plusieurs fois
            response = requests.post(f"{API_BASE_URL}/api/run_tests", timeout=10)
            if response.status_code == 200:
                data = response.json()
                res_text = f"Tests: {data['run']} | Échecs: {data['failures']} | Err: {data['errors']}"
                
                if data['status'] == 'ok':
                    messagebox.showinfo("Tests Réussis ✅", res_text + "\n\nTous les systèmes logiques sont opérationnels.")
                    self.logs_text.set("Tests unitaires : SUCCÈS ✅")
                else:
                    messagebox.showerror("Échec des Tests ❌", res_text + "\n\nDétails:\n" + data['output'])
                    self.logs_text.set("Tests unitaires : ÉCHEC ❌")
        except Exception as e:
            messagebox.showerror("Erreur", f"Impossible de lancer les tests: {e}")
            self.logs_text.set("Erreur de connexion aux tests.")

    def init_manual_state(self):
        """Initialise la position virtuelle des pièces pour le mode manuel."""
        self.manual_state = {f"{c}{r}": "" for c in "abcdefgh" for r in "12345678"}
        # Pions
        for c in "abcdefgh":
            self.manual_state[f"{c}2"] = "♙"
            self.manual_state[f"{c}7"] = "♟"
        # Autres pièces
        pieces_w = "♖♘♗♕♔♗♘♖"
        pieces_b = "♜♞♝♛♚♝♞♜"
        for i, c in enumerate("abcdefgh"):
            self.manual_state[f"{c}1"] = pieces_w[i]
            self.manual_state[f"{c}8"] = pieces_b[i]
        
        # Cimetières (18 slots chacun selon config.py)
        for i in range(18):
            self.manual_state[f"wg{i}"] = ""
            self.manual_state[f"bg{i}"] = ""
        
        # Réserves de Dames
        self.manual_state["wq0"] = "♕"
        self.manual_state["wq1"] = "♕"
        self.manual_state["bq0"] = "♛"
        self.manual_state["bq1"] = "♛"

    def create_manual_view(self):
        self.manual_frame = tk.Frame(self, bg="#222222")
        
        # En-tête
        top_frame = tk.Frame(self.manual_frame, bg="#222222")
        top_frame.pack(fill=tk.X, pady=2)
        tk.Label(top_frame, text="🕹️ Déplacement Manuel Physique", bg="#222222", fg="#FFFFFF", font=("Arial", 12, "bold")).pack(side=tk.LEFT, padx=10)
        tk.Button(top_frame, text="Retour", bg="#555555", fg="#FFFFFF", command=self.show_settings_view).pack(side=tk.RIGHT, padx=10)

        # Zone centrale (Plateau + Cimetières)
        center_frame = tk.Frame(self.manual_frame, bg="#222222")
        center_frame.pack(expand=True)

        # Fonction utilitaire pour créer une case cliquable
        def create_square(parent, loc, bg_color, fg_color, size=28):
            lbl = tk.Label(parent, text=self.manual_state[loc], bg=bg_color, fg=fg_color, font=("Arial", 16), width=2, height=1, relief=tk.RAISED)
            lbl.bind("<Button-1>", lambda e, l=loc: self.on_manual_click(l))
            self.manual_labels[loc] = {"widget": lbl, "default_bg": bg_color}
            return lbl

        # --- GAUCHE : Cimetière Noir + Dames Noires ---
        left_frame = tk.Frame(center_frame, bg="#333333", bd=2, relief=tk.SUNKEN)
        left_frame.grid(row=0, column=0, padx=5)
        tk.Label(left_frame, text="Cim. Noir", bg="#333333", fg="#AAAAAA", font=("Arial", 8)).grid(row=0, column=0, columnspan=3)
        for i in range(18):
            create_square(left_frame, f"bg{i}", "#444444", "#000000").grid(row=1+(i//3), column=i%3, padx=1, pady=1)
        tk.Label(left_frame, text="Dames", bg="#333333", fg="#AAAAAA", font=("Arial", 8)).grid(row=8, column=0, columnspan=3)
        create_square(left_frame, "bq0", "#2196F3", "#000000").grid(row=9, column=0, padx=1, pady=1)
        create_square(left_frame, "bq1", "#2196F3", "#000000").grid(row=9, column=1, padx=1, pady=1)

        # --- CENTRE : Plateau 8x8 ---
        board_frame = tk.Frame(center_frame, bg="#000000", bd=2)
        board_frame.grid(row=0, column=1, padx=5)
        files = "abcdefgh"
        for r in range(8, 0, -1):
            for c in range(8):
                loc = f"{files[c]}{r}"
                bg_color = "#f0d9b5" if (r + c) % 2 != 0 else "#b58863"
                create_square(board_frame, loc, bg_color, "#000000").grid(row=8-r, column=c)

        # --- DROITE : Cimetière Blanc + Dames Blanches ---
        right_frame = tk.Frame(center_frame, bg="#333333", bd=2, relief=tk.SUNKEN)
        right_frame.grid(row=0, column=2, padx=5)
        tk.Label(right_frame, text="Cim. Blanc", bg="#333333", fg="#AAAAAA", font=("Arial", 8)).grid(row=0, column=0, columnspan=3)
        for i in range(18):
            create_square(right_frame, f"wg{i}", "#444444", "#000000").grid(row=1+(i//3), column=i%3, padx=1, pady=1)
        tk.Label(right_frame, text="Dames", bg="#333333", fg="#AAAAAA", font=("Arial", 8)).grid(row=8, column=0, columnspan=3)
        create_square(right_frame, "wq0", "#4CAF50", "#000000").grid(row=9, column=0, padx=1, pady=1)
        create_square(right_frame, "wq1", "#4CAF50", "#000000").grid(row=9, column=1, padx=1, pady=1)

        # --- BAS : Contrôles ---
        bottom_frame = tk.Frame(self.manual_frame, bg="#222222")
        bottom_frame.pack(fill=tk.X, pady=5)
        
        self.manual_status_lbl = tk.Label(bottom_frame, text="Sélectionnez une pièce à déplacer.", bg="#222222", fg="#00FF00", font=("Arial", 10))
        self.manual_status_lbl.pack(side=tk.TOP)

        tk.Button(bottom_frame, text="❌ Annuler", bg="#FF9800", font=("Arial", 12, "bold"), command=self.cmd_manual_cancel).pack(side=tk.LEFT, expand=True, fill=tk.X, padx=10)
        tk.Button(bottom_frame, text="✅ VALIDER LE MOUVEMENT", bg="#4CAF50", fg="#FFFFFF", font=("Arial", 12, "bold"), command=self.cmd_manual_validate).pack(side=tk.RIGHT, expand=True, fill=tk.X, padx=10)

    def on_manual_click(self, loc):
        """Gère la sélection Source -> Destination."""
        if self.manual_src is None:
            if self.manual_state[loc] == "": return # Case vide
            self.manual_src = loc
            self.manual_labels[loc]["widget"].config(bg="#FFFF00") # Highlight Jaune
            self.manual_status_lbl.config(text=f"Source: {loc}. Sélectionnez la destination.")
        elif self.manual_dst is None and loc != self.manual_src:
            self.manual_dst = loc
            self.manual_labels[loc]["widget"].config(bg="#FF9800") # Highlight Orange
            self.manual_status_lbl.config(text=f"Prêt à déplacer : {self.manual_src} -> {self.manual_dst}. Cliquez sur VALIDER.")
        elif loc == self.manual_src:
            self.cmd_manual_cancel() # Clic sur la même case = annuler

    def cmd_manual_cancel(self):
        if self.manual_src: self.manual_labels[self.manual_src]["widget"].config(bg=self.manual_labels[self.manual_src]["default_bg"])
        if self.manual_dst: self.manual_labels[self.manual_dst]["widget"].config(bg=self.manual_labels[self.manual_dst]["default_bg"])
        self.manual_src = None
        self.manual_dst = None
        self.manual_status_lbl.config(text="Sélectionnez une pièce à déplacer.")

    def cmd_manual_validate(self):
        if not self.manual_src or not self.manual_dst: return
        
        self.manual_status_lbl.config(text="Mouvement physique en cours...")
        self.update()
        
        payload = {"src": self.manual_src, "dst": self.manual_dst}
        try:
            response = requests.post(f"{API_BASE_URL}/cmd/physical_move", json=payload, timeout=15)
            if response.status_code == 200 and response.json().get("status") == "ok":
                # Mise à jour visuelle du plateau virtuel
                piece = self.manual_state[self.manual_src]
                self.manual_state[self.manual_dst] = piece
                self.manual_state[self.manual_src] = ""
                
                self.manual_labels[self.manual_src]["widget"].config(text="")
                self.manual_labels[self.manual_dst]["widget"].config(text=piece)
                
                self.manual_status_lbl.config(text="Mouvement terminé avec succès !")
            else:
                self.manual_status_lbl.config(text="Erreur lors du mouvement physique.")
        except Exception as e:
            self.manual_status_lbl.config(text=f"Erreur de connexion: {e}")
            
        self.cmd_manual_cancel()

    def show_manual_view(self):
        self.hide_all_views()
        # On crée la vue à la volée si elle n'existe pas encore
        if not self.manual_frame.winfo_children():
            self.create_manual_view()
        self.manual_frame.pack(fill=tk.BOTH, expand=True)
        self.current_view = "manual"

    # ==========================================
    # EXPORT USB
    # ==========================================
    def cmd_export_usb(self):
        self.logs_text.set("Recherche de clé USB...")
        self.update()
        try:
            res = requests.post(f"{API_BASE_URL}/api/export_usb", timeout=5)
            data = res.json()
            if data['status'] == 'ok':
                messagebox.showinfo("Export Réussi", data['msg'])
                self.logs_text.set("Export USB : OK")
            else:
                messagebox.showerror("Erreur USB", data['msg'])
                self.logs_text.set("Export USB : ÉCHEC")
        except Exception as e:
            messagebox.showerror("Erreur", f"Impossible de contacter le serveur:\n{e}")

    # ==========================================
    # VUE VISION EN DIRECT
    # ==========================================
    def create_vision_view(self):
        self.vision_frame = tk.Frame(self, bg="#000000")
        
        top = tk.Frame(self.vision_frame, bg="#222222")
        top.pack(fill=tk.X)
        tk.Label(top, text="👁️ Retour Vision IA", bg="#222222", fg="#FFFFFF", font=("Arial", 12, "bold")).pack(side=tk.LEFT, padx=10)
        tk.Button(top, text="Retour", bg="#555555", fg="#FFFFFF", command=self.show_settings_view).pack(side=tk.RIGHT, padx=10)
        
        self.vision_lbl = tk.Label(self.vision_frame, bg="#000000")
        self.vision_lbl.pack(expand=True)

    def update_vision_loop(self):
        if self.current_view != "vision": return
        try:
            res = requests.get(f"{API_BASE_URL}/api/vision_frame", timeout=1)
            if res.status_code == 200:
                img_data = Image.open(io.BytesIO(res.content))
                img_data = img_data.resize((320, 240)) # Adapté à l'écran 3.5"
                self.vision_photo = ImageTk.PhotoImage(img_data)
                self.vision_lbl.config(image=self.vision_photo)
        except: pass
        self.after(200, self.update_vision_loop) # 5 FPS

    def show_vision_view(self):
        self.hide_all_views()
        if not self.vision_frame.winfo_children(): self.create_vision_view()
        self.vision_frame.pack(fill=tk.BOTH, expand=True)
        self.current_view = "vision"
        self.update_vision_loop()

    # ==========================================
    # VUE CORRECTION MÉMOIRE PLATEAU
    # ==========================================
    def create_edit_view(self):
        self.edit_frame = tk.Frame(self, bg="#222222")
        
        top = tk.Frame(self.edit_frame, bg="#222222")
        top.pack(fill=tk.X)
        tk.Label(top, text="🧠 Correction Mémoire", bg="#222222", fg="#FFEB3B", font=("Arial", 12, "bold")).pack(side=tk.LEFT, padx=10)
        tk.Button(top, text="Retour", bg="#555555", fg="#FFFFFF", command=self.show_settings_view).pack(side=tk.RIGHT, padx=10)
        tk.Label(top, text="Touchez une case pour modifier", bg="#222222", fg="#AAAAAA", font=("Arial", 8)).pack(side=tk.BOTTOM)

        board_frame = tk.Frame(self.edit_frame, bg="#000000", bd=2)
        board_frame.pack(expand=True)
        
        files = "abcdefgh"
        for r in range(8, 0, -1):
            for c in range(8):
                loc = f"{files[c]}{r}"
                bg_color = "#f0d9b5" if (r + c) % 2 != 0 else "#b58863"
                lbl = tk.Label(board_frame, text="", bg=bg_color, fg="#000000", font=("Arial", 18), width=2, height=1)
                lbl.grid(row=8-r, column=c)
                lbl.bind("<Button-1>", lambda e, l=loc: self.open_piece_selector(l))
                self.edit_labels[loc] = lbl

    def refresh_edit_board(self):
        """Récupère le FEN actuel et met à jour l'affichage."""
        try:
            res = requests.get(f"{API_BASE_URL}/api/status", timeout=2)
            fen = res.json().get('fen', '').split(' ')[0]
            
            pieces_map = {'p':'♟', 'r':'♜', 'n':'♞', 'b':'♝', 'q':'♛', 'k':'♚', 
                          'P':'♙', 'R':'♖', 'N':'♘', 'B':'♗', 'Q':'♕', 'K':'♔'}
            
            rows = fen.split('/')
            files = "abcdefgh"
            for r_idx, row in enumerate(rows):
                c_idx = 0
                for char in row:
                    if char.isdigit():
                        for _ in range(int(char)):
                            loc = f"{files[c_idx]}{8-r_idx}"
                            self.edit_labels[loc].config(text="")
                            c_idx += 1
                    else:
                        loc = f"{files[c_idx]}{8-r_idx}"
                        self.edit_labels[loc].config(text=pieces_map[char])
                        c_idx += 1
        except Exception as e:
            print("Erreur refresh edit board:", e)

    def open_piece_selector(self, loc):
        """Ouvre un popup pour choisir la pièce à placer sur la case."""
        popup = tk.Toplevel(self)
        popup.title(f"Modifier {loc}")
        popup.geometry("380x180+50+50")
        popup.configure(bg="#333333")
        popup.attributes('-topmost', True) # Reste au premier plan
        
        tk.Label(popup, text=f"Quelle pièce placer en {loc} ?", bg="#333333", fg="#FFFFFF", font=("Arial", 12, "bold")).pack(pady=5)
        
        grid_frame = tk.Frame(popup, bg="#333333")
        grid_frame.pack()
        
        pieces_w = [('♔', 'K'), ('♕', 'Q'), ('♖', 'R'), ('♗', 'B'), ('♘', 'N'), ('♙', 'P')]
        pieces_b = [('♚', 'k'), ('♛', 'q'), ('♜', 'r'), ('♝', 'b'), ('♞', 'n'), ('♟', 'p')]
        
        def select_piece(symbol):
            requests.post(f"{API_BASE_URL}/api/edit_board", json={"square": loc, "piece": symbol})
            self.refresh_edit_board()
            popup.destroy()

        # Ligne Blancs
        for i, (icon, sym) in enumerate(pieces_w):
            tk.Button(grid_frame, text=icon, font=("Arial", 20), bg="#EEEEEE", fg="#000000", width=2, command=lambda s=sym: select_piece(s)).grid(row=0, column=i, padx=2, pady=2)
        # Ligne Noirs
        for i, (icon, sym) in enumerate(pieces_b):
            tk.Button(grid_frame, text=icon, font=("Arial", 20), bg="#555555", fg="#000000", width=2, command=lambda s=sym: select_piece(s)).grid(row=1, column=i, padx=2, pady=2)
            
        # Bouton Vider
        tk.Button(popup, text="❌ Vider la case", bg="#F44336", fg="#FFFFFF", font=("Arial", 12, "bold"), command=lambda: select_piece("")).pack(fill=tk.X, padx=20, pady=10)

    def open_elo_numpad(self):
        """Ouvre un pavé numérique pour saisir l'ELO."""
        popup = tk.Toplevel(self)
        popup.title("Réglage ELO")
        popup.geometry("300x400+90+10")
        popup.configure(bg="#333333")
        popup.attributes('-topmost', True)
        
        current_entry = tk.StringVar(value="")
        
        display = tk.Label(popup, textvariable=current_entry, bg="#000000", fg="#00FF00", font=("Arial", 24, "bold"), height=2)
        display.pack(fill=tk.X, padx=10, pady=10)
        
        grid = tk.Frame(popup, bg="#333333")
        grid.pack(expand=True, fill=tk.BOTH)
        
        def add_digit(d):
            if len(current_entry.get()) < 4:
                current_entry.set(current_entry.get() + str(d))
        
        def clear():
            current_entry.set("")
            
        def validate():
            val = current_entry.get()
            if not val: return
            try:
                elo = int(val)
                # Bornage
                elo = max(100, min(3200, elo))
                self.elo_var.set(elo)
                self.elo_lbl_str.set(f"🤖 IA: {elo}")
                requests.post(f"{API_BASE_URL}/api/set_elo", json={"elo": elo})
            except: pass
            popup.destroy()

        # Boutons 1-9
        for i in range(9):
            num = i + 1
            tk.Button(grid, text=str(num), font=("Arial", 18, "bold"), bg="#555555", fg="#FFFFFF", width=4, height=2, command=lambda n=num: add_digit(n)).grid(row=i//3, column=i%3, padx=5, pady=5)
            
        # Ligne du bas (0, C, OK)
        tk.Button(grid, text="C", font=("Arial", 18, "bold"), bg="#F44336", fg="#FFFFFF", width=4, height=2, command=clear).grid(row=3, column=0, padx=5, pady=5)
        tk.Button(grid, text="0", font=("Arial", 18, "bold"), bg="#555555", fg="#FFFFFF", width=4, height=2, command=lambda: add_digit(0)).grid(row=3, column=1, padx=5, pady=5)
        tk.Button(grid, text="OK", font=("Arial", 18, "bold"), bg="#4CAF50", fg="#FFFFFF", width=4, height=2, command=validate).grid(row=3, column=2, padx=5, pady=5)

    def show_game_over_animation(self, loser_turn):
        """Affiche une animation de victoire fun."""
        self.game_over_active = True
        winner = "BLANCS" if loser_turn == "black" else "NOIRS"
        
        overlay = tk.Toplevel(self)
        overlay.title("GAME OVER")
        overlay.geometry("480x320+0+0")
        overlay.overrideredirect(True) # Plein écran sans bordures
        overlay.attributes('-topmost', True)
        
        canvas = tk.Canvas(overlay, bg="#1a1a1a", highlightthickness=0)
        canvas.pack(fill=tk.BOTH, expand=True)
        
        # Message de victoire
        title_color = "#FFD700" if winner == "BLANCS" else "#FFFFFF"
        canvas.create_text(240, 100, text="GAME OVER", font=("Arial", 30, "bold"), fill="#FF5252")
        canvas.create_text(240, 160, text=f"VICTOIRE DES {winner} !", font=("Arial", 20, "bold"), fill=title_color)
        
        particles = []
        colors = ["#FF5252", "#FFEB3B", "#4CAF50", "#2196F3", "#9C27B0", "#FF9800"]
        emojis = ["🏆", "🎉", "✨", "🔥", "👑", "⭐"]
        
        # Création des particules (Confettis et Emojis)
        for _ in range(30):
            p = {
                'id': canvas.create_oval(0,0,10,10, fill=random.choice(colors)),
                'x': 240, 'y': 320,
                'vx': random.uniform(-5, 5), 'vy': random.uniform(-10, -15),
                'grav': 0.4
            }
            particles.append(p)
            
        for _ in range(10):
            p = {
                'id': canvas.create_text(0,0, text=random.choice(emojis), font=("Arial", 16)),
                'x': 240, 'y': 320,
                'vx': random.uniform(-4, 4), 'vy': random.uniform(-8, -12),
                'grav': 0.3
            }
            particles.append(p)

        def animate():
            if not overlay.winfo_exists(): return
            for p in particles:
                p['x'] += p['vx']
                p['y'] += p['vy']
                p['vy'] += p['grav']
                canvas.coords(p['id'], p['x'], p['y'])
                # Rebondir ou réapparaître
                if p['y'] > 350:
                    p['y'] = 320
                    p['vy'] = random.uniform(-8, -14)
            overlay.after(30, animate)

        animate()
        
        # Bouton Fermer
        def close_anim():
            self.game_over_active = False # Permet de relancer une partie
            overlay.destroy()
            self.cmd_reset() # On remet le plateau à zéro pour la suite

        tk.Button(overlay, text="NOUVELLE PARTIE", bg="#4CAF50", fg="#FFFFFF", font=("Arial", 14, "bold"), command=close_anim).place(x=140, y=240, width=200, height=50)

    def show_edit_view(self):
        self.hide_all_views()
        if not self.edit_frame.winfo_children(): self.create_edit_view()
        self.edit_frame.pack(fill=tk.BOTH, expand=True)
        self.current_view = "edit"
        self.refresh_edit_board()

    # ==========================================
    # GESTION DES VUES
    # ==========================================
    def hide_all_views(self):
        self.main_frame.pack_forget()
        self.settings_frame.pack_forget()
        if hasattr(self, 'manual_frame'): self.manual_frame.pack_forget()
        if hasattr(self, 'vision_frame'): self.vision_frame.pack_forget()
        if hasattr(self, 'edit_frame'): self.edit_frame.pack_forget()

    def show_main_view(self):
        self.hide_all_views()
        self.main_frame.pack(fill=tk.BOTH, expand=True)
        self.current_view = "main"

    def show_settings_view(self):
        self.hide_all_views()
        self.settings_frame.pack(fill=tk.BOTH, expand=True)
        self.current_view = "settings"
    def format_time(self, seconds):
        if seconds is None: return "--:--"
        m = int(seconds) // 60
        s = int(seconds) % 60
        return f"{m:02d}:{s:02d}"

    def update_status(self):
        try:
            response = requests.get(f"{API_BASE_URL}/api/status", timeout=1)
            if response.status_code == 200:
                data = response.json()
                
                # Maj Horloges
                self.time_w_str.set(self.format_time(data.get("time_white", 600)))
                self.time_b_str.set(self.format_time(data.get("time_black", 600)))
                
                # Maj Message Statut
                self.status_msg.set(data.get("status_msg", "En attente..."))
                
                # Maj Logs
                logs = data.get("logs", [])
                self.logs_text.set("\n".join(logs[-5:])) # Affiche les 5 derniers
                
                # Maj Statut Bouton
                btn_on = data.get("button_state", False)
                if btn_on:
                    self.btn_status_label.config(text="Bouton: APPUYÉ ✅", fg="#00FF00")
                else:
                    self.btn_status_label.config(text="Bouton: RELACHÉ", fg="#AAAAAA")
                
        except requests.exceptions.RequestException:
            # Mode Hors-Ligne
            self.logs_text.set("Serveur injoignable...")

        # Planifier la prochaine mise à jour
        self.after(UPDATE_MS, self.update_status)

if __name__ == "__main__":
    app = ChessRobotUI()
    app.mainloop()
