"""
puzzles.py - Puzzles « mat en N » de la page Progresser (générés par scripts/generate_puzzles.py).
"""
import json
import os
import threading
import chess
import chess.engine
from engine.coach import fr_san

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUZZLE_FILE = os.path.join(ROOT, "data", "puzzles.json")
DONE_FILE = os.path.join(ROOT, "data", "puzzles_resolus.json")
LEVEL_NAMES = {"facile": "Facile", "normal": "Normal", "difficile": "Difficile", "extreme": "Extrême"}
PIECE_FR = {chess.PAWN: "un pion", chess.KNIGHT: "un cavalier", chess.BISHOP: "un fou",
            chess.ROOK: "une tour", chess.QUEEN: "la dame", chess.KING: "le roi"}


def load_puzzles():
    try:
        with open(PUZZLE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return []


class PuzzleSession:
    def __init__(self, coach):
        self.coach = coach            # Coach : fournit le Stockfish à pleine puissance
        self.puzzles = load_puzzles()
        self.done = self._load_done()
        self.p = None
        self.board = chess.Board()
        self.ply = 0                  # position dans la ligne de solution
        self.remaining = 0            # coups de mat restants pour le joueur
        self.on_line = True           # le joueur suit-il la ligne de solution ?
        self.errors = 0
        self.lock = threading.Lock()

    # ── Suivi des puzzles réussis ──────────────────────────────────────────────
    def _load_done(self):
        try:
            with open(DONE_FILE) as f:
                return set(json.load(f))
        except Exception:
            return set()

    def _mark_done(self):
        self.done.add(self.p["id"])
        os.makedirs(os.path.dirname(DONE_FILE), exist_ok=True)
        with open(DONE_FILE, "w") as f:
            json.dump(sorted(self.done), f)

    def listing(self):
        return [{"id": p["id"], "level": p["level"], "mate_in": p["mate_in"], "side": p["side"],
                 "solved": p["id"] in self.done} for p in self.puzzles]

    # ── Partie en cours ────────────────────────────────────────────────────────
    def start(self, pid):
        self.p = next((p for p in self.puzzles if p["id"] == pid), None)
        if self.p is None:
            return False
        self.board = chess.Board(self.p["fen"])
        self.ply = 0
        self.remaining = self.p["mate_in"]
        self.on_line = True
        self.errors = 0
        return True

    def user_color(self):
        return chess.WHITE if self.p and self.p["side"] == "white" else chess.BLACK

    def solved(self):
        return self.board.is_checkmate() and self.board.turn != self.user_color()

    def _mates_in_time(self, after):
        """Après le coup du joueur : le mat reste-t-il forcé dans le nombre de coups restant ?"""
        if after.is_checkmate():
            return True
        with self.coach._lock:
            info = self.coach.engine().analyse(after, chess.engine.Limit(depth=16))
        m = info["score"].pov(self.user_color()).mate()
        return m is not None and 0 < m <= self.remaining - 1

    def try_move(self, uci):
        with self.lock:
            if self.p is None or self.solved():
                return "done", {}
            try:
                mv = chess.Move.from_uci(uci)
                if mv not in self.board.legal_moves:
                    mv = chess.Move.from_uci(uci + "q")
            except ValueError:
                return "illegal", {}
            if mv not in self.board.legal_moves:
                return "illegal", {}
            sol = self.p["solution"]
            expected = chess.Move.from_uci(sol[self.ply]) if self.on_line and self.ply < len(sol) else None
            after = self.board.copy(stack=False)
            after.push(mv)
            if mv != expected and not self._mates_in_time(after):
                self.errors += 1
                return "wrong", {"tried": fr_san(self.board.san(mv)),
                                 "hint": self.hint() if self.errors >= 2 else None}
            san = fr_san(self.board.san(mv))
            self.on_line = self.on_line and mv == expected
            self.board.push(mv)
            self.ply += 1
            self.remaining -= 1
            self.errors = 0
            if self.solved():
                self._mark_done()
                return "solved", {"san": san}
            # Réponse de l'adversaire : la ligne de solution, sinon sa meilleure défense
            if self.on_line and self.ply < len(sol):
                reply = chess.Move.from_uci(sol[self.ply])
            else:
                with self.coach._lock:
                    reply = self.coach.engine().play(self.board, chess.engine.Limit(depth=16)).move
            reply_san = fr_san(self.board.san(reply))
            self.board.push(reply)
            self.ply += 1
            return "correct", {"san": san, "reply": reply_san}

    def hint(self):
        """Indique la pièce à jouer (sans dire où)."""
        if self.p is None or self.solved():
            return None
        sol = self.p["solution"]
        if self.on_line and self.ply < len(sol):
            mv = chess.Move.from_uci(sol[self.ply])
        else:
            with self.coach._lock:
                mv = self.coach.engine().play(self.board, chess.engine.Limit(depth=16)).move
        piece = self.board.piece_at(mv.from_square)
        return f"Jouez {PIECE_FR[piece.piece_type]} ({chess.square_name(mv.from_square)})"

    def solution_text(self):
        """La ligne de solution complète, en notation française (depuis la position de départ)."""
        if self.p is None:
            return ""
        b = chess.Board(self.p["fen"])
        out = []
        for u in self.p["solution"]:
            m = chess.Move.from_uci(u)
            out.append(fr_san(b.san(m)))
            b.push(m)
        return " ".join(out)

    def state(self):
        p = self.p
        return {"id": p["id"] if p else None, "level": p["level"] if p else None,
                "level_name": LEVEL_NAMES.get(p["level"], "") if p else "",
                "mate_in": p["mate_in"] if p else 0, "side": p["side"] if p else "white",
                "remaining": self.remaining, "solved": self.solved(),
                "fen": self.board.fen(),
                "legal_moves": [m.uci() for m in self.board.legal_moves]}
