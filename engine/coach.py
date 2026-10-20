"""
coach.py - Analyse des coups du joueur (page « Progresser ») et exercices d'ouvertures.

L'analyse utilise un Stockfish séparé, à pleine puissance : celui qui joue contre le
joueur est volontairement affaibli (Elo bas) et donnerait de mauvais conseils.
"""
import math
import threading
import chess
import chess.engine
from config import STOCKFISH_PATH

COACH_TIME = 0.4   # secondes d'analyse par position (deux positions par coup)

# Appréciations, de la meilleure à la pire, selon la perte de chances de gain (en points de %)
GRADES = [
    # (seuil de perte, libellé, symbole, couleur)
    (2.0,   "Excellent",   "!",  "#2ecc71"),
    (5.0,   "Bon",         "✓",  "#7dcea0"),
    (10.0,  "Imprécision", "?!", "#f1c40f"),
    (20.0,  "Erreur",      "?",  "#e67e22"),
    (999.0, "Gaffe",       "??", "#e74c3c"),
]
BEST = ("Meilleur coup", "★", "#3498db")


def fr_san(san):
    """Notation française : C (cavalier), F (fou), T (tour), D (dame), R (roi)."""
    return san.translate(str.maketrans({"N": "C", "B": "F", "R": "T", "Q": "D", "K": "R"})) if san else san


def win_chance(cp):
    """Chances de gain (0-100 %) pour une évaluation en centipions (formule de Lichess)."""
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


class Coach:
    def __init__(self):
        self._engine = None
        self._lock = threading.Lock()

    def engine(self):
        if self._engine is None:
            self._engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
            try:
                self._engine.configure({"UCI_LimitStrength": False, "Skill Level": 20})
            except Exception:
                pass
        return self._engine

    def grade(self, board_before, move):
        """
        Note le coup `move` joué dans la position `board_before`.
        Retourne un dict : san, label, symbol, color, best_san, loss (points de % de gain perdus).
        """
        with self._lock:
            eng = self.engine()
            side = board_before.turn
            limit = chess.engine.Limit(time=COACH_TIME)
            info = eng.analyse(board_before, limit)
            best = info.get("pv", [None])[0]
            best_cp = info["score"].pov(side).score(mate_score=10000)
            after = board_before.copy(stack=False)
            after.push(move)
            if after.is_checkmate():
                played_cp = 10000
            else:
                played_cp = eng.analyse(after, limit)["score"].pov(side).score(mate_score=10000)
        loss = max(0.0, win_chance(best_cp) - win_chance(played_cp))
        san = fr_san(board_before.san(move))
        best_san = fr_san(board_before.san(best)) if best is not None else None
        if best is not None and move == best:
            label, symbol, color = BEST
        else:
            label, symbol, color = next((g[1], g[2], g[3]) for g in GRADES if loss < g[0])
        return {"san": san, "label": label, "symbol": symbol, "color": color,
                "best_san": None if move == best else best_san, "loss": round(loss, 1),
                "eval": round(played_cp / 100.0, 1) if abs(played_cp) < 9000 else None}

    def close(self):
        if self._engine:
            self._engine.quit()


# ── Exercices d'ouvertures ─────────────────────────────────────────────────────
# side : couleur du joueur ; moves : la ligne principale à retrouver (UCI)
OPENINGS = [
    {"id": "italienne", "name": "Partie italienne", "side": "white",
     "idea": "Développer vite, viser le point faible f7 avec le fou en c4, puis préparer d4.",
     "moves": "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4"},
    {"id": "espagnole", "name": "Partie espagnole", "side": "white",
     "idea": "Mettre la pression sur le cavalier c6 qui défend e5, et roquer tôt.",
     "moves": "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7"},
    {"id": "gambit-dame", "name": "Gambit dame", "side": "white",
     "idea": "Offrir le pion c4 pour contester le centre, développer les pièces vers le centre.",
     "moves": "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7"},
    {"id": "londres", "name": "Système de Londres", "side": "white",
     "idea": "Toujours la même structure solide : d4, Ff4, e3, Cf3, c3.",
     "moves": "d2d4 d7d5 c1f4 g8f6 e2e3 e7e6 g1f3 c7c5 c2c3 b8c6"},
    {"id": "sicilienne", "name": "Défense sicilienne", "side": "black",
     "idea": "Répondre à e4 par c5 : déséquilibrer la partie et contre-attaquer.",
     "moves": "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6"},
    {"id": "francaise", "name": "Défense française", "side": "black",
     "idea": "e6 puis d5 : défier le centre blanc depuis une position solide.",
     "moves": "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7"},
    {"id": "caro-kann", "name": "Défense Caro-Kann", "side": "black",
     "idea": "c6 puis d5, et sortir le fou c8 avant de jouer e6.",
     "moves": "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5"},
    {"id": "scandinave", "name": "Défense scandinave", "side": "black",
     "idea": "Attaquer e4 tout de suite avec d5, puis mettre la dame à l'abri en a5.",
     "moves": "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6"},
]
for _o in OPENINGS:
    _o["moves"] = _o["moves"].split()


class OpeningTrainer:
    """Le joueur doit retrouver les coups de son camp ; l'écran joue ceux de l'adversaire."""

    def __init__(self):
        self.op = None
        self.board = chess.Board()
        self.idx = 0
        self.errors = 0

    def start(self, op_id):
        self.op = next((o for o in OPENINGS if o["id"] == op_id), None)
        if self.op is None:
            return False
        self.board = chess.Board()
        self.idx = 0
        self.errors = 0
        self._auto_reply()
        return True

    def user_color(self):
        return chess.WHITE if self.op and self.op["side"] == "white" else chess.BLACK

    def _auto_reply(self):
        """Joue les coups de l'adversaire jusqu'au prochain coup du joueur."""
        replies = []
        while self.op and self.idx < len(self.op["moves"]) and self.board.turn != self.user_color():
            mv = chess.Move.from_uci(self.op["moves"][self.idx])
            replies.append(fr_san(self.board.san(mv)))
            self.board.push(mv)
            self.idx += 1
        return replies

    def finished(self):
        return self.op is not None and self.idx >= len(self.op["moves"])

    def expected(self):
        if not self.op or self.finished():
            return None
        return chess.Move.from_uci(self.op["moves"][self.idx])

    def try_move(self, uci):
        """Retourne (résultat, détails) : 'correct', 'wrong' ou 'illegal'."""
        exp = self.expected()
        if exp is None:
            return "done", {}
        try:
            mv = chess.Move.from_uci(uci)
        except ValueError:
            return "illegal", {}
        if mv not in self.board.legal_moves:
            mv = chess.Move.from_uci(uci + "q")
            if mv not in self.board.legal_moves:
                return "illegal", {}
        if mv != exp:
            self.errors += 1
            return "wrong", {"tried": fr_san(self.board.san(mv)),
                             "hint": self.hint() if self.errors >= 2 else None}
        san = fr_san(self.board.san(mv))
        self.board.push(mv)
        self.idx += 1
        self.errors = 0
        replies = self._auto_reply()
        return "correct", {"san": san, "replies": replies}

    def hint(self):
        exp = self.expected()
        if exp is None:
            return None
        piece = self.board.piece_at(exp.from_square)
        names = {chess.PAWN: "le pion", chess.KNIGHT: "un cavalier", chess.BISHOP: "un fou",
                 chess.ROOK: "une tour", chess.QUEEN: "la dame", chess.KING: "le roi"}
        return f"Indice : jouez {names[piece.piece_type]} ({chess.square_name(exp.from_square)})"
