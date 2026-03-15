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
        self.initial_time = 10 * 60 # 10 minutes en secondes par défaut
        self.time_white = self.initial_time
        self.time_black = self.initial_time
        self.last_tick = time.time()
        self.clock_running = False

 	# --- Compteurs de Dames de réserve utilisées ---
        self.used_white_queens = 0
        self.used_black_queens = 0

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

        if self.board.turn == chess.WHITE:
            self.time_white = max(0.0, self.time_white - dt)
        else:
            self.time_black = max(0.0, self.time_black - dt)

    def start_clock(self):
        self.clock_running = True
        self.last_tick = time.time()

    def stop_clock(self):
        self.update_clock()
        self.clock_running = False

    def set_elo(self, elo):
        if self.engine:
            try:
                self.engine.configure({"UCI_LimitStrength": True, "UCI_Elo": int(elo)})
            except: pass

    def reset(self):
        self.board.reset()
        self.time_white = self.initial_time
        self.time_black = self.initial_time
        self.clock_running = False
        self.used_white_queens = 0
        self.used_black_queens = 0

    def undo(self):
        # Annule jusqu'au tour du joueur
        if len(self.board.move_stack) >= 2:
            self.board.pop(); self.board.pop()
        elif len(self.board.move_stack) == 1:
            self.board.pop()

    def push_uci(self, uci):
        try:
            move = chess.Move.from_uci(uci)
            if move in self.board.legal_moves:
                self.board.push(move)
                return True
        except: pass
        return False

    def compute_bot_move(self):
        if not self.engine: 
            print("[ERREUR] Moteur IA absent.")
            return None
        try:
            # Temps de réflexion
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
