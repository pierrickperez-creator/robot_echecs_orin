import chess
import chess.engine
import chess.pgn
import io
import time
from config import *

class ChessEngine:
    def __init__(self):
        self.board = chess.Board()
        self.engine = None
        
        # --- Horloge ---
        self.initial_time = 20 * 60 # 20 minutes par joueur par défaut
        self.time_white = self.initial_time
        self.time_black = self.initial_time
        self.last_tick = time.time()
        self.clock_running = False
        self.clock_side = None        # couleur dont le temps s'écoule (None = celle qui a le trait)

        # --- Compteurs de Dames de réserve utilisées ---
        self.used_white_queens = 0
        self.used_black_queens = 0
        self._clear_registry()

        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
            self.set_elo(DEFAULT_ELO)
        except Exception as e:
            print(f"[ERREUR] Stockfish non démarré : {e}")

    def update_clock(self):
        if not self.clock_running or self.is_game_over():
            self.last_tick = time.time()
            return

        now = time.time()
        dt = now - self.last_tick
        self.last_tick = now

        side = self.board.turn if self.clock_side is None else self.clock_side
        if side == chess.WHITE:
            self.time_white = max(0.0, self.time_white - dt)
        else:
            self.time_black = max(0.0, self.time_black - dt)

    def start_clock(self, side=None):
        """
        Fait courir le temps de `side` (chess.WHITE / chess.BLACK). Le robot garde son
        horloge pendant qu'il réfléchit ET qu'il déplace ses pièces, même si le trait
        est déjà passé au joueur.
        """
        self.update_clock()
        self.clock_side = side
        self.clock_running = True
        self.last_tick = time.time()

    def stop_clock(self):
        self.update_clock()
        self.clock_running = False

    def set_elo(self, elo):
        """
        Règle la force de Stockfish. UCI_Elo a un minimum (1350 sur Stockfish 14) :
        en dessous, on passe par 'Skill Level' (0-20), sinon Stockfish jouerait à pleine force.
        """
        self.elo = int(elo)
        if not self.engine:
            return
        elo = int(elo)
        opts = self.engine.options
        try:
            elo_min = opts["UCI_Elo"].min if "UCI_Elo" in opts else 1350
            if elo >= elo_min:
                cfg = {"UCI_LimitStrength": True, "UCI_Elo": min(elo, opts["UCI_Elo"].max)}
                if "Skill Level" in opts:
                    cfg["Skill Level"] = 20
            else:
                # 100 Elo → niveau 0 … juste sous le minimum UCI_Elo → niveau 5
                skill = round(5 * max(0, elo - 100) / max(1, elo_min - 100))
                cfg = {"UCI_LimitStrength": False, "Skill Level": max(0, min(5, skill))}
            self.engine.configure(cfg)
            print(f"[IA] Force réglée : Elo demandé {elo} → {cfg}")
        except Exception as e:
            print(f"[ERREUR] Réglage Elo impossible : {e}")

    def _clear_registry(self):
        """
        Registre physique, indépendant de l'historique des coups (que python-chess
        efface à chaque correction MODIFIER PIÈCE) :
          graveyard[couleur] = [(demi-coup, type de pièce), ...] dans l'ordre des emplacements
          reserve[couleur]   = [demi-coup, ...] dames de réserve utilisées (promotions)
        """
        self.ply = 0
        self.graveyard = {chess.WHITE: [], chess.BLACK: []}
        self.reserve = {chess.WHITE: [], chess.BLACK: []}

    def register_move(self, move):
        """À appeler AVANT de jouer `move` : note les pièces qui partent au cimetière."""
        b = self.board
        captured = b.piece_at(move.to_square)
        if b.is_en_passant(move):
            captured = chess.Piece(chess.PAWN, not b.turn)
        if captured is not None:
            self.graveyard[captured.color].append((self.ply, captured.piece_type))
        if move.promotion:
            self.graveyard[b.turn].append((self.ply, chess.PAWN))   # le pion promu sort du plateau
            self.reserve[b.turn].append(self.ply)

    def push_move(self, move):
        """Joue `move` en tenant le registre à jour."""
        self.register_move(move)
        self.board.push(move)
        self.ply += 1

    def graveyard_types(self, color):
        return [t for _, t in self.graveyard[color]]

    def reserve_used(self, color):
        return len(self.reserve[color])

    def reset(self):
        self.board.reset()
        self.time_white = self.initial_time
        self.time_black = self.initial_time
        self.clock_running = False
        self.clock_side = None
        self.used_white_queens = 0
        self.used_black_queens = 0
        self._clear_registry()

    def undo(self):
        # Annule jusqu'au tour du joueur
        n = min(2, len(self.board.move_stack))
        for _ in range(n):
            self.board.pop()
        self.ply = max(0, self.ply - n)
        for c in (chess.WHITE, chess.BLACK):
            self.graveyard[c] = [e for e in self.graveyard[c] if e[0] < self.ply]
            self.reserve[c] = [p for p in self.reserve[c] if p < self.ply]

    def push_uci(self, uci):
        try:
            move = chess.Move.from_uci(uci)
            if move in self.board.legal_moves:
                self.push_move(move)
                return True
        except: pass
        return False

    def compute_bot_move(self):
        if not self.engine: 
            print("[ERREUR] Moteur IA absent.")
            return None
        try:
            import random
            elo = getattr(self, 'elo', 1500)
            if elo < 1350:
                # Même au niveau 0, Stockfish joue autour de 1300 : pour un vrai débutant,
                # on ajoute des coups au hasard et on limite la profondeur de calcul.
                blunder = 0.6 * (1350 - elo) / 1250          # 100 Elo → 60 %, 800 → 26 %
                if random.random() < blunder:
                    legal = list(self.board.legal_moves)
                    # évite quand même de rater un mat en un coup évident
                    for m in legal:
                        self.board.push(m)
                        mate = self.board.is_checkmate()
                        self.board.pop()
                        if mate:
                            return m
                    return random.choice(legal)
                depth = 1 if elo < 600 else 2 if elo < 1000 else 4
                limit = chess.engine.Limit(depth=depth, time=STOCKFISH_MOVE_TIME)
            else:
                limit = chess.engine.Limit(time=STOCKFISH_MOVE_TIME)
            result = self.engine.play(self.board, limit)
            return result.move
        except Exception as e:
            print(f"[ERREUR] IA Plantée : {e}")
            return None

    def is_game_over(self): return self.board.is_game_over()
    def get_fen(self): return self.board.fen()
    
    def get_pgn(self):
        game = chess.pgn.Game.from_board(self.board)
        exporter = chess.pgn.StringExporter(headers=False, variations=False, comments=False)
        return game.accept(exporter)

    def get_last_move_uci(self):
        if self.board.move_stack: return self.board.peek().uci()
        return None

    def get_legal_moves(self):
        return [m.uci() for m in self.board.legal_moves]
    
    def get_captured_pieces(self):
        # Compte ce qui a été mangé
        piece_counts = { chess.PAWN: 8, chess.KNIGHT: 2, chess.BISHOP: 2, chess.ROOK: 2, chess.QUEEN: 1 }
        captured = {'w': [], 'b': []}
        for color, code in [(chess.WHITE, 'w'), (chess.BLACK, 'b')]:
            for p_type, max_count in piece_counts.items():
                current_count = len(self.board.pieces(p_type, color))
                missing = max_count - current_count
                symbol = chess.Piece(p_type, color).unicode_symbol()
                for _ in range(max(0, missing)):
                    captured[code].append(symbol)
        return captured

    def close(self):
        if self.engine: self.engine.quit()
