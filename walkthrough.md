# Résumé des Modifications (Mars 2026)

L'implémentation de la calibration et de la logique du cimetière (Graveyard) a été effectuée dans le code du Robot Échecs. 

## Changements Effectués

1. **Configuration des Steps/mm pour l'axe Z (Tiges T8)**
   - Fichier modifié : [app.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/web/app.py)
   - La fonction `init_printer()` envoie désormais automatiquement `M92 Z400` et `M500` (sauvegarde EEPROM) lors de la connexion initiale avec la carte Marlin. Cela s'assure que les nouvelles tiges T8 sont correctement calibrées sur 400 Steps/mm, même en cas de réinitialisation de la carte.

2. **Clarification des Offsets XY**
   - Fichier modifié : [config.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/config.py)
   - Des commentaires explicites ont été ajoutés autour des variables `BOARD_OFFSET_X` et `BOARD_OFFSET_Y` pour guider l'utilisateur. Ces valeurs déterminent la position physique exacte du centre de l'échiquier et doivent être ajustées finement sur la machine pour garantir la précision des déplacements au-dessus des cases.

3. **Logique Dynamique du Cimetière (Graveyard)**
   - Fichier modifié : [app.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/web/app.py)
   - La méthode de capture (`execute_move_sequence`) a été restructurée. 
   - Désormais, le système lit l'état actuel de la partie (`game_engine.get_captured_pieces()`) pour déterminer combien de pièces de la couleur de la victime ont déjà été capturées.
   - En fonction de ce nombre (l'index courrant), le bras robotique viendra déposer la pièce fraîchement capturée dans le bon emplacement vide, en piochant dans les tableaux `WHITE_GRAVEYARD` et `BLACK_GRAVEYARD` définis dans la configuration. Fini les dépôts statiques en `(10,10)`.

## Ce qu'il reste à tester sur la machine physique

Il n'est pas possible de tester ce code en simulation logicielle complète, ces manipulations nécessitent le matériel :

* **[Z]** Vérifier que l'axe Z grimpe bien de 10mm réels lorsqu'on demande +10 via l'interface `/settings` (Validation du `M92 Z400`).
* **[XY]** Déposer l'électro-aimant sur la case **A1**, en ajustant à tâtons `BOARD_OFFSET_X` et `BOARD_OFFSET_Y` dans `config.py` et en re-testant à chaque fois depuis l'interface Web en utilisant la grille 10x10 cliquable. 
* **[Cimetière]** Jouer une pseudo-partie et capturer 2 ou 3 pièces d'affilée pour s'assurer que le bras les dispose bien consécutivement en bordure de plateau, et qu'il ne tente pas de déposer une pièce en dehors des limites physiques du plateau (200x200mm).

## Intégration de l'Écran Quimat TFT 3.5" (Nouveau Frontend)

Pour le remplacement de l'interface navigateur locale par un écran dédié de 3.5 pouces :

1. **Horloges et Backend API**
   - Fichiers modifiés : [app.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/web/app.py) et [chess_logic.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/engine/chess_logic.py)
   - L'horloge d'échec classique a été ajoutée. Elle se lance automatiquement dès qu'un joueur passe son tour. Le temps (10 minutes par joueur) s'écoule pour Blancs ou Noirs en fonction du trait affiché par le moteur.
   - Les nouvelles URL de commandes locales telles que `/api/undo` et `/api/reset` ont été intégrées pour supporter le retour en arrière et la réinitialisation de partie.

2. **Application Graphique (Tkinter)**
   - Fichier créé : [screen_ui.py](file:///c:/Users/PC/Downloads/Robot%20Echec-20260210T152857Z-1-001/Robot%20Echec/robot_echecs_orin/scripts/screen_ui.py)
   - Conçu spécifiquement pour une résolution 480x320/320x480, un script `screen_ui.py` a été développé. Il affiche :
     * Les compteurs de l'Horloge actualisés deux fois par seconde avec appels à `/api/status`.
     * Des boutons majeurs (Undo, Nouvelle Partie, Stop).
     * Un onglet **Paramètres** conservant les actions manuelles (Jogging X/Y/Z) et le log G-Code direct.
   - Idéal pour fonctionner au démarrage du Jetson en plein écran (Kiosk mode) via *Pygame/Tkinter* tout en utilisant la communication locale `http://localhost:5000`.

## Vision par Ordinateur et Flux de Jeu Automatisé

L'étape ultime pour rendre le robot autonome sans interface web a été franchie avec l'intégration de la vision par ordinateur et du bouton physique de validation.

1. **Moteur de Vision (`vision_engine.py`)** 👁️
   - Un tout nouveau moteur basé sur **OpenCV** a été créé. Il permet de "redresser" l'image de la caméra pour obtenir une vue du dessus parfaite de l'échiquier.
   - **Calibration Physique** : Plus besoin de cliquer dans l'interface ! Il suffit de placer **4 Dames Noires** aux 4 coins du plateau (emplacements 0,0 ; 9,0 ; 0,9 ; 9,9) et d'appuyer sur le bouton physique. Le robot détectera automatiquement les coins.
   - **Détection des Coups** : Le système compare une photo prise avant et après votre mouvement pour identifier les cases qui ont changé de couleur, en déduisant ainsi votre coup (ex: e2 vers e4).

2. **Validation par Bouton Physique (M119)** 🕹️
   - Pour un feeling plus "arcade" et moins tactile, un bouton branché sur un port Endstop libre de la carte MKS (par défaut `X_MAX`) sert de validation.
   - Le backend scrute l'état des fins de course via la commande G-Code **`M119`**. Dès que vous appuyez sur le bouton, l'analyse de vision se lance.

3. **Flux de Jeu Séquentiel** 🏁
   - **Interface TFT** : L'écran affiche des messages clairs : *"À toi de jouer"*, *"Analyse du coup..."*, *"Le robot joue..."*.
   - **Vérification** : Après avoir déplacé une pièce, le robot prend systématiquement une photo de vérification pour s'assurer que le plateau est stable avant de vous redonner la main.

4. **Aperçu Vision en Temps Réel (Debug AI)** 📺
   - Dans les réglages de l'interface Web, un nouveau flux **"Identification des Pièces (Vision AI)"** a été ajouté.
   - Il affiche le plateau redressé avec des étiquettes dynamiques sur chaque case identifiant la pièce (ex: *Cavalier*, *Tour*) selon son socle.

4. **Reconnaissance des Socles (Identité des Pièces)** 🧩
   - Grâce à vos précisions sur les formes des socles, le système a été amélioré pour identifier le type de pièce qui arrive sur une case :
     * **Triangle** ➡️ Cavalier
     * **Hexagone** ➡️ Tour
     * **Carré** ➡️ Dame
     * **Étoile/Rond/Cœur** ➡️ Identifiés par le nombre de côtés.
   - Cette fonctionnalité permet au robot de valider que vous avez bien déplacé la pièce prévue par les règles du jeu, ajoutant une couche de sécurité contre les erreurs.

### 5. Test de Puissance de l'Électro-aimant 🧲
   - Un bouton de test manuel a été ajouté sur l'écran **TFT** (onglet Settings) et sur l'**interface Web**.
   - Il permet d'allumer/éteindre l'aimant à la demande pour vérifier qu'il est capable de soulever vos pièces d'échecs avant de lancer une partie.


### 4. Recul Automatique de la Tête (Z+100mm) 🏗️
   - Comme la caméra est fixée sur la tête d'impression, celle-ci doit s'écarter pour que la caméra puisse voir l'intégralité du plateau 10x10.
   - Avant chaque prise de photo, le robot effectue désormais une séquence automatique :
     1. Déplacement au centre du plateau (`X=100, Y=100`).
     2. Remontée à la hauteur de vision (`Z=100`).
     3. Pause de 1 seconde pour stabiliser l'image.
   - Cette logique est intégrée dans toutes les phases critiques (Calibration, Tour Humain, Vérification Robot).

## 🕹️ Avancées Mars 2026 : Interface Autonome Professionnelle

### 1. Célébration de Fin de Partie (Animation Fun) 🎉
- **Nouveauté** : Dès que l'IA détecte un échec et mat ou une pat, l'écran tactile s'illumine avec une explosion de confettis et d'emojis (🏆, 🔥, 🎉).
- **Fonctionnement** : Un canevas d'animation fluide a été intégré directement dans Tkinter, signifiant la victoire des Blancs ou des Noirs de manière festive.

### 2. Réglage ELO via Pavé Numérique
- **Fichiers modifiés** : `web/app.py`, `scripts/screen_ui.py`
- **Fonctionnement** : Un échiquier interactif complet (64 cases + 36 slots de cimetière + réserves) permet de piloter physiquement l'aimant d'un point A vers un point B par simple toucher. Idéal pour recalibrer manuellement ou simuler des coups sans validation de l'IA.

### 3. Vision Directe TFT 👁️
- **Invention** : Utilisation de la bibliothèque `Pillow` pour convertir le flux camera OpenCV en images compatibles Tkinter.
- **Bénéfice** : Vous voyez ce que le robot voit (plateau redressé, détection des pièces) à 5 FPS directement sur le petit écran Quimat. Fini le besoin d'ouvrir un navigateur sur un PC portable pour vérifier l'alignement.

### 3. Correction de Mémoire IA 🧠
- **Problème résolu** : Permet de corriger les erreurs rares de vision sans avoir à recommencer la partie.
- **Interface** : Un clic sur une case ouvre un sélecteur de pièces. La modification met à jour instantanément l'état du moteur `chess.Board` et le PGN.

### 4. Export USB des Parties 💾
- **Intégration** : Scrutage automatique des ports USB montés sur le Jetson Orin.
- **Résultat** : En un clic, le robot génère et copie un fichier `.pgn` complet de la partie sur votre clé USB, prêt pour l'analyse sur Chess.com ou Lichess.

> [!TIP]
> Ces outils de diagnostic et d'administration font du robot un système "Stand-alone" robuste et facile à maintenir sur le terrain.

---

*Bonne partie !* 🤖♟️
