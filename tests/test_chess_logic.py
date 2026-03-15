import unittest
import chess
import sys
import os

# Ajout du dossier parent au path pour importer le moteur du robot
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.chess_logic import ChessEngine

class TestChessLogic(unittest.TestCase):
    def setUp(self):
        """Initialisation d'une nouvelle partie avant chaque test."""
        self.engine = ChessEngine()

    def test_initial_state(self):
        """Vérifie l'état initial du plateau."""
        self.assertEqual(self.engine.board.turn, chess.WHITE)
        self.assertFalse(self.engine.is_game_over())
        self.assertEqual(len(self.engine.get_legal_moves()), 20) # 20 coups possibles au 1er tour

    def test_legal_moves_generation(self):
        """Vérifie la génération des coups légaux."""
        moves = self.engine.get_legal_moves()
        self.assertIn('e2e4', moves) # Pion blanc avance de 2
        self.assertIn('g1f3', moves) # Cavalier blanc sort
        self.assertNotIn('e2e5', moves) # Coup illégal (trop loin)

    def test_piece_movement(self):
        """Vérifie le déplacement valide d'une pièce."""
        success = self.engine.push_uci('e2e4')
        self.assertTrue(success)
        self.assertEqual(self.engine.board.piece_at(chess.E4).symbol(), 'P')
        self.assertEqual(self.engine.board.turn, chess.BLACK)

    def test_invalid_movement(self):
        """Vérifie le rejet strict des coups illégaux."""
        success = self.engine.push_uci('e2e5') # Pion trop loin
        self.assertFalse(success)
        
        success = self.engine.push_uci('b1c3') # Pion bloque le cavalier
        self.assertFalse(success)

    def test_checkmate_detection(self):
        """Vérifie la détection de l'échec et mat (Mat du lion)."""
        self.engine.push_uci('f2f3')
        self.engine.push_uci('e7e5')
        self.engine.push_uci('g2g4')
        self.engine.push_uci('d8h4') # Échec et mat par la Dame noire
        
        self.assertTrue(self.engine.is_game_over())
        self.assertTrue(self.engine.board.is_checkmate())

    def test_capture_tracking(self):
        """Vérifie le suivi des pièces capturées (pour le Cimetière)."""
        self.engine.push_uci('e2e4')
        self.engine.push_uci('d7d5')
        self.engine.push_uci('e4d5') # Blanc capture le pion noir
        
        captured = self.engine.get_captured_pieces()
        self.assertIn('♟', captured['b']) # Un pion noir a été capturé
        self.assertEqual(len(captured['b']), 1)

    def tearDown(self):
        """Nettoyage et fermeture de Stockfish après chaque test."""
        self.engine.close()

if __name__ == '__main__':
    unittest.main()
