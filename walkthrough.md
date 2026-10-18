# Journal Technique — Robot Échecs Orin (Mars 2026)

> Ce document est le journal chronologique de toutes les modifications apportées au projet.
> Il est destiné aux développeurs ou à quiconque reprend le projet après une pause.

---

## Session 1 : Calibration et Cimetière Dynamique (Février 2026)

### 1.1 Calibration de l'axe Z (Tiges T8)

**Fichier modifié :** `web/app.py` — fonction `init_printer()`

La fonction envoie automatiquement `M92 Z400` + `M500` (sauvegarde EEPROM) à la connexion initiale.
Cela garantit que les tiges T8 sont calibrées à 400 steps/mm même après réinitialisation de la carte.

### 1.2 Offsets XY et configuration plateau

**Fichier modifié :** `config.py`

Variables `BOARD_OFFSET_X` et `BOARD_OFFSET_Y` pour positionner le coin A1 physique.
Valeur par défaut = `SQUARE_SIZE_MM` (20 mm), correspondant à une case de marge en bas-gauche.

### 1.3 Cimetière dynamique

**Fichier modifié :** `web/app.py` — fonction `execute_move_sequence()`

Le système lit le nombre de pièces déjà capturées par couleur pour déposer chaque nouvelle pièce
au bon emplacement dans `WHITE_GRAVEYARD` / `BLACK_GRAVEYARD` (tableaux définis dans `config.py`).

---

## Session 2 : Interface Web (Écran TFT, Vision, Horloges)

### 2.1 Horloges d'échecs classiques

**Fichiers modifiés :** `web/app.py`, `engine/chess_logic.py`

Horloge de 10 min par joueur, déclenchée automatiquement à chaque changement de trait.

### 2.2 Application TFT Tkinter

**Fichier créé :** `scripts/screen_ui.py`

Interface graphique pour écran Quimat 3.5" (480×320). Affiche horloges, boutons d'action,
log GCode. Se connecte en HTTP local à `http://localhost:5000`.

### 2.3 Moteur de vision OpenCV

**Fichier créé :** `engine/vision_engine.py`

- Redressement de l'image par homographie (4 dames noires aux coins = calibration)
- Détection des coups : comparaison avant/après la photo
- Identification des pièces par forme de socle (triangle = cavalier, hexagone = tour…)

---

## Session 3 : Mars 2026 — Refonte Majeure

Cette session correspond aux modifications réalisées lors de la mise en service physique du robot.
Elle est documentée en détail ci-dessous.

---

### 3.1 Résolution de la panne du navigateur (snap cassé)

**Problème :** Après une mise à jour du kernel Jetson (5.15.148-tegra), tous les navigateurs
installés via snap refusaient de se lancer. Erreur : `cap_dac_override: Function not implemented`
dans `/usr/lib/snapd/snap-confine`.

**Solution retenue :** Installer `epiphany-browser` (GNOME Web) via `apt` — sans snap.

```bash
sudo apt install epiphany-browser
```

**Fichiers mis à jour :**

- `~/.config/autostart/robot-echecs-kiosk.desktop` — Exec changé pour `epiphany-browser http://localhost:5000`
- `~/Desktop/Robot-Echecs.desktop` — idem

**Note :** Les flags `--application-mode --profile` d'Epiphany provoquaient un crash au démarrage
(race condition GNOME). Ils ont été supprimés. Epiphany s'ouvre désormais en fenêtre standard,
puis le service systemd attend 3 secondes et envoie `wmctrl -r :ACTIVE: -b add,fullscreen`.

---

### 3.2 Auto-déverrouillage du trousseau GNOME (mot de passe au démarrage)

**Problème :** Une fenêtre demandant le mot de passe du trousseau GNOME apparaissait à chaque
démarrage, bloquant l'expérience kiosque.

**Solution :** Créer un trousseau avec mot de passe vide via `python-secretstorage` :

```python
import secretstorage
bus = secretstorage.dbus_init()
col = secretstorage.get_default_collection(bus)
col.unlock()
```

Lancé une fois manuellement. Le trousseau est ensuite déverrouillé automatiquement.

---

### 3.3 Correction du panneau GCode (mode hors ligne)

**Problème :** Le panneau GCode de l'interface web n'affichait que les coups d'échecs (en notation UCI)
et pas les véritables commandes GCode envoyées à l'imprimante.

**Cause :** La fonction `send_gcode_raw()` dans `app.py` ne loguait les commandes que dans
`SIMULATION_MODE = True`. En mode réel sans imprimante connectée (`ser is None`), rien n'était
loggué.

**Correction dans `web/app.py` :**

```python
def send_gcode_raw(cmd):
    if ser:
        ser.write((cmd + "\n").encode())
        # ... lecture réponse ...
    else:
        log_gcode(f"[HORS LIGNE] {cmd}")  # ← ajouté
```

---

### 3.4 Affichage du vainqueur dans la célébration (confettis)

**Problème :** L'écran de fin de partie avec confettis n'indiquait pas qui avait gagné.

**Corrections :**

**Backend (`web/app.py`) :** L'endpoint `/api/status` renvoyait `str(outcome)` (représentation Python)
au lieu du résultat. Corrigé pour renvoyer `outcome.result()` (`'1-0'`, `'0-1'`, `'1/2-1/2'`) ou
`'pat'` pour les pats (stalemate).

```python
if board.is_stalemate():
    outcome_str = 'pat'
else:
    outcome_str = board.outcome().result()  # '1-0' / '0-1' / '1/2-1/2'
```

**Frontend (`web/templates/index.html`) :** Table de traduction des résultats :

```javascript
const VICTORY_TEXTS = {
    '1-0':     'LES BLANCS ONT GAGNÉ !',
    '0-1':     'LES NOIRS ONT GAGNÉ !',
    'pat':     'PAT !',
    '1/2-1/2': 'MATCH NUL !',
};
```

---

### 3.5 Nouvelle page : Parties Légendaires

**Fichier créé :** `web/templates/legendaires.html`
**Fichier modifié :** `web/app.py` (ajout de toutes les routes `/legendaires` et `/api/leg/*`)

#### 3.5.1 Les 6 parties intégrées

Stockées dans `LEGENDARY_GAMES` (liste de dicts) dans `app.py` avec leur PGN complet :

| ID | Nom | Joueurs | Année |
|----|-----|---------|-------|
| immortal | L'Immortelle | Anderssen vs Kieseritzky | 1851 |
| opera | La Partie de l'Opéra | Morphy vs Duke of Brunswick | 1858 |
| evergreen | La Partie Toujours Verte | Anderssen vs Dufresne | 1852 |
| century | La Partie du Siècle | Byrne vs Fischer | 1956 |
| fischer_spassky | Fischer vs Spassky (partie 6) | Fischer vs Spassky | 1972 |
| kasparov | L'Immortelle de Kasparov | Kasparov vs Topalov | 1999 |

#### 3.5.2 Architecture backend

Variables d'état globales :

```python
leg_game_id    = None   # ID de la partie chargée
leg_moves      = []     # Liste des coups (objets chess.Move)
leg_index      = 0      # Index du coup actuel
leg_board      = None   # Échiquier python-chess
leg_cap_w      = 0      # Compteur pièces blanches capturées
leg_cap_b      = 0      # Compteur pièces noires capturées
```

Fonction `_parse_legendary_pgn(pgn_str)` : parse le PGN et retourne la liste des coups.

Fonction `execute_leg_move_sequence(move, board_before)` : génère et envoie le GCode physique
pour chaque coup légendaire (identique à `execute_move_sequence` mais avec ses propres compteurs).

Helper `_leg_captured(color)` : retourne le prochain emplacement de cimetière pour une pièce capturée.

#### 3.5.3 Bug critique corrigé : décorateur sur la mauvaise fonction

Lors de l'ajout de `_leg_captured()` par édition, le décorateur `@app.route('/api/leg/next_move')`
s'était retrouvé attaché à `_leg_captured` au lieu de `api_leg_next_move`. Résultat : la route
renvoyait des données invalides, l'historique affichait "undefined".

**Correction :** réordonner le code pour que `_leg_captured()` soit défini *avant* le décorateur :

```python
def _leg_captured(color):
    ...

@app.route('/api/leg/next_move', methods=['POST'])
def api_leg_next_move():
    ...
```

#### 3.5.4 Minuteur et boutons Play/Pause séparés

**Problème de timing :** Le premier coup ne jouait qu'après le délai initial. Les coups suivants
attendaient le bon délai mais l'intervalle ne s'appliquait qu'aux coups des Noirs.

**Solution JS dans `legendaires.html` :**

```javascript
function startPlay() {
    playing = true;
    nextMove(true);        // ← premier coup immédiat
    // scheduleNext() est appelé à l'intérieur de nextMove() si playing = true
}

function scheduleNext() {
    clearTimeout(playTimer);
    if (playing) {
        playTimer = setTimeout(() => nextMove(true), intervalMs);
    }
}
```

Deux boutons séparés (`▶ JOUER` et `⏸ PAUSE`) plutôt qu'un toggle.

#### 3.5.5 Cimetière sur la page légendaires

La grille 10×10 (`#graveyard-grid`) affiche les 64 cases d'échiquier + 36 slots de cimetière.
`renderGraveyard(data)` colore les cases capturées en bleu (noires) ou vert (blanches).

#### 3.5.6 Log GCode sur la page légendaires

Polling toutes les 1,5 s vers `/api/gcode_log` (même endpoint que la page principale).

---

### 3.6 Sécurité : déclenchement manuel du robot

**Problème de sécurité :** En mode automatique, le robot se déplaçait dès qu'un coup était détecté,
sans vérifier que le joueur avait retiré ses mains du plateau. Risque de collision.

**Solution :** Le robot ne joue que lorsque le joueur appuie explicitement sur le bouton.

#### 3.6.1 Variables d'état ajoutées dans `app.py`

```python
button_state         = False  # état courant du bouton physique
robot_move_requested = False  # flag edge rising (montant) du bouton
```

#### 3.6.2 Détection de front montant (bouton physique)

Le thread `button_poll_loop` tourne en arrière-plan et détecte le front montant :

```python
def button_poll_loop():
    global button_state, robot_move_requested
    prev = False
    while button_thread_running:
        current = is_button_pressed()
        if current and not prev:          # front montant = pression
            robot_move_requested = True
        button_state = current
        prev = current
        time.sleep(0.2)
```

`is_button_pressed()` envoie `M119` à Marlin et parse la réponse pour `z_max: TRIGGERED`.

#### 3.6.3 Champ `robot_turn` dans `/api/status`

```python
robot_turn = (game_engine.board.turn == chess.WHITE) != config.HUMAN_PLAYS_WHITE
```

(XOR logique : c'est le tour du robot si le tour actuel de l'échiquier n'est PAS la couleur humaine)

#### 3.6.4 Endpoint `/api/bot_move` sécurisé

Le robot ne joue que si `robot_turn` est True. Après avoir joué, `robot_move_requested = False`.

#### 3.6.5 UI de sécurité dans `index.html`

Bandeau orange animé quand c'est le tour du robot :

```html
<div id="safety-banner" style="display:none">
  ⚠️ Retirez vos mains — Appuyez sur JOUER ROBOT
</div>
```

Bouton JOUER ROBOT :
- Classe `ready` (vert pulsant) quand c'est le tour du robot
- Classe `waiting` (gris, `cursor: not-allowed`) sinon

```css
@keyframes pulse-green {
    0%, 100% { box-shadow: 0 0 8px #27ae60aa; }
    50%       { box-shadow: 0 0 24px #27ae6088; }
}
#btn-play-robot.ready {
    background: #27ae60;
    animation: pulse-green 1.2s infinite;
}
#btn-play-robot.waiting { background: #555; cursor: not-allowed; }
```

Le polling JS vérifie aussi `robot_move_requested` : si le bouton physique a été pressé,
`playRobotMove()` est appelé automatiquement.

---

### 3.7 Choix de la couleur au démarrage de la partie

**Fichier modifié :** `web/templates/index.html`, `web/app.py`

#### 3.7.1 Route `/api/set_color`

```python
@app.route('/api/set_color', methods=['POST'])
def set_color():
    data = request.json
    config.HUMAN_PLAYS_WHITE = data.get('human_plays_white', True)
    # reset de la partie
    ...
```

#### 3.7.2 Modal de choix de couleur (HTML/CSS)

Affiché par `resetGame()` à la place du `confirm()` précédent :

```html
<div id="color-modal">
  <h2>♟ Nouvelle partie</h2>
  <p>Quelle couleur voulez-vous jouer ?</p>
  <button onclick="startGameWithColor(true)">⬜ BLANCS — Vous jouez en premier</button>
  <button onclick="startGameWithColor(false)">⬛ NOIRS — Le robot joue en premier</button>
</div>
```

Si le joueur choisit Noirs : `config.HUMAN_PLAYS_WHITE = False`, la page charge automatiquement
en mode "robot joue en premier" avec le bandeau de sécurité activé.

---

### 3.8 Position caméra configurable

**Problème :** La caméra est fixée à l'arrière de la tête d'impression. Pour photographier
l'intégralité du plateau, la tête doit se lever à 10 cm et le plateau doit reculer au maximum.

**Fichier modifié :** `config.py`

```python
VISION_X  = 100.0        # mm — tête centrée horizontalement
VISION_Y  = BED_SIZE_MM  # mm — plateau reculé au maximum (200 mm)
Z_VISION  = 100.0        # mm — hauteur de la tête (10 cm de recul)
```

**Fichier modifié :** `web/app.py`

Fonction ajoutée :

```python
def move_to_vision_position():
    log_gcode(f"→ Position caméra : X{config.VISION_X} Y{config.VISION_Y} Z{config.Z_VISION}")
    move_xyz(config.VISION_X, config.VISION_Y, config.Z_VISION)
```

Appelée à la fin de `execute_move_sequence()` pour que le robot se positionne pour la photo
après chaque coup joué.

---

### 3.9 Bouton 📷 POSITION CAMÉRA dans le Contrôle Manuel

**Fichier modifié :** `web/templates/controle_manuel.html`

Route ajoutée dans `app.py` :

```python
@app.route('/cmd/goto_vision', methods=['POST'])
def cmd_goto_vision():
    move_to_vision_position()
    return jsonify({'status': 'ok'})
```

Bouton violet dans l'interface :

```html
<button class="btn-purple" onclick="gotoVision()">📷 POSITION CAMÉRA</button>
```

Utile pour vérifier que la caméra voit bien l'intégralité du plateau avant de démarrer une partie.

---

## Récapitulatif des fichiers modifiés (Mars 2026)

| Fichier | Nature des modifications |
|---------|--------------------------|
| `config.py` | Ajout `VISION_X`, `VISION_Y`, `Z_VISION` |
| `web/app.py` | GCode hors-ligne, sécurité bouton, choix couleur, position caméra, parties légendaires (routes + logique), correction résultat fin de partie |
| `web/templates/index.html` | Modal couleur, UI sécurité (bandeau + bouton pulsant), textes victoire |
| `web/templates/legendaires.html` | Nouvelle page (créée de zéro) |
| `web/templates/controle_manuel.html` | Bouton 📷 POSITION CAMÉRA |
| `~/.config/autostart/robot-echecs-kiosk.desktop` | Passage à epiphany-browser |
| `~/Desktop/Robot-Echecs.desktop` | Passage à epiphany-browser |
| `USER_GUIDE.md` | Réécriture complète pour non-techniciens |

---

## Points à tester sur la machine physique

- [ ] **Calibration plateau** : vérifier que l'aimant s'aligne sur A1 avec `BOARD_OFFSET_X/Y`
- [ ] **Position caméra** : bouton 📷 → vérifier que tout le plateau est visible
- [ ] **Bouton physique** : presser l'endstop Z_MAX → le robot doit jouer
- [ ] **Sécurité** : le robot ne doit PAS jouer automatiquement sans pression du bouton
- [ ] **Parties légendaires** : tester avec robot branché que les GCode s'exécutent bien
- [ ] **Cimetière légendaires** : capturer des pièces et vérifier le placement physique
- [ ] **Choix de couleur** : tester que "Noirs" force le robot à jouer en premier

---

*Bonne partie !* 🤖♟️
