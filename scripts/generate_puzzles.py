#!/usr/bin/env python3
"""
Génère les puzzles de la page Progresser (data/puzzles.json).

Des parties sont jouées par un Stockfish affaibli et un peu aléatoire ; à chaque position,
un Stockfish à pleine puissance cherche un mat forcé pour le camp au trait. On ne garde que
les positions où le PREMIER coup du mat est unique (la 2e meilleure ligne ne mate pas aussi vite).
    mat en 1 → facile   mat en 2 → normal   mat en 3 → difficile   mat en 4 → extrême
Usage : python3 scripts/generate_puzzles.py [nombre par niveau, 25 par défaut]
"""
import json
import os
import random
import sys
import chess
import chess.engine

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import STOCKFISH_PATH  # noqa: E402

LEVELS = {1: "facile", 2: "normal", 3: "difficile", 4: "extreme"}
PER_LEVEL = int(sys.argv[1]) if len(sys.argv) > 1 else 25
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "puzzles.json")


def main():
    random.seed(2026)
    player = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    player.configure({"Skill Level": 8})
    judge = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
    found = {n: [] for n in LEVELS}
    seen = set()
    games = 0
    try:
        while any(len(v) < PER_LEVEL for v in found.values()) and games < 3000:
            games += 1
            board = chess.Board()
            strong = chess.WHITE if games % 2 else chess.BLACK   # le camp gagnant alterne
            levels_in_game = set()   # variété : au plus 2 puzzles par partie, de niveaux différents
            while not board.is_game_over() and board.fullmove_number < 80:
                if board.fullmove_number >= 6 and board.turn == strong and board.board_fen() not in seen:
                    seen.add(board.board_fen())
                    # Tri rapide : y a-t-il un mat en vue ?
                    quick = judge.analyse(board, chess.engine.Limit(depth=9))
                    m = quick["score"].pov(board.turn).mate()
                    if m in LEVELS and len(found[m]) < PER_LEVEL and m not in levels_in_game \
                            and len(levels_in_game) < 2:
                        info = judge.analyse(board, chess.engine.Limit(depth=18), multipv=2)
                        mate = info[0]["score"].pov(board.turn).mate()
                        second = info[1]["score"].pov(board.turn).mate() if len(info) > 1 else None
                        unique = second is None or second <= 0 or second > mate
                        line = [mv.uci() for mv in info[0]["pv"][:2 * mate - 1]] if mate in LEVELS else []
                        if mate in LEVELS and unique and len(line) == 2 * mate - 1 \
                                and len(found[mate]) < PER_LEVEL:
                            levels_in_game.add(mate)
                            found[mate].append({"fen": board.fen(), "mate_in": mate,
                                                "side": "white" if board.turn else "black",
                                                "solution": line})
                            print(f"partie {games} : mat en {mate} "
                                  f"({' '.join(f'{n}:{len(v)}' for n, v in found.items())})", flush=True)
                # Le camp fort joue bien, l'autre souvent au hasard : des mats arrivent vite
                if board.turn != strong and random.random() < 0.45:
                    move = random.choice(list(board.legal_moves))
                else:
                    move = player.play(board, chess.engine.Limit(time=0.02)).move
                board.push(move)
            if games % 10 == 0:
                print(f"... {games} parties", flush=True)
    finally:
        player.quit()
        judge.quit()

    puzzles = []
    for n, level in LEVELS.items():
        for i, p in enumerate(found[n], 1):
            puzzles.append({"id": f"{level}-{i:02d}", "level": level, **p})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(puzzles, f, indent=1)
    print(f"{len(puzzles)} puzzles écrits dans {OUT} ({games} parties)")


if __name__ == "__main__":
    main()
