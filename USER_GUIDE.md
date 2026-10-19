# 📖 Guide Utilisateur — Robot Échecs Automatisé

> Ce guide est écrit pour tout le monde, même sans connaissance en informatique.
> Lisez-le du début à la fin la première fois. Ensuite, servez-vous-en comme référence.

---

## 📋 Table des matières

1. [Ce qu'est ce robot](#1-ce-quest-ce-robot)
2. [Matériel nécessaire](#2-matériel-nécessaire)
3. [Branchements](#3-branchements)
4. [Démarrage du système](#4-démarrage-du-système)
5. [L'interface web — Vue d'ensemble](#5-linterface-web--vue-densemble)
6. [Jouer une partie contre le robot](#6-jouer-une-partie-contre-le-robot)
7. [Page Simulation (jouer sans le robot physique)](#7-page-simulation-jouer-sans-le-robot-physique)
8. [Page Parties Légendaires](#8-page-parties-légendaires)
9. [Page Contrôle Manuel](#9-page-contrôle-manuel)
10. [Réglages importants](#10-réglages-importants)
11. [Sécurité](#11-sécurité)
12. [En cas de problème](#12-en-cas-de-problème)
13. [Installation depuis zéro](#13-installation-depuis-zéro)

---

## 1. Ce qu'est ce robot

Ce robot est une imprimante 3D modifiée qui joue aux échecs. À la place d'imprimer, elle déplace les pièces sur un échiquier grâce à un électro-aimant fixé sous la tête d'impression.

Une caméra fixée à l'arrière de la tête d'impression permet au robot de "voir" le plateau et d'analyser les coups du joueur humain. Un cerveau électronique (le Jetson Orin) fait tourner un moteur d'échecs professionnel appelé **Stockfish**.

**En résumé : vous jouez vos coups à la main sur le plateau, le robot joue les siens tout seul.**

---

## 2. Matériel nécessaire

| Composant | Rôle |
|-----------|------|
| NVIDIA Jetson Orin | Le "cerveau" — fait tourner tous les programmes |
| Imprimante 3D (DiscoEasy 200) | Le bras robotique qui déplace les pièces |
| Carte Marlin (MKS/RAMPS) | Pilote les moteurs de l'imprimante |
| Caméra USB | Voit le plateau pour analyser les coups |
| Échiquier + pièces | Le plateau de jeu (pièces avec socles magnétiques) |
| Écran tactile (ou écran + clavier) | Affiche l'interface |

---

## 3. Branchements

Branchez dans cet ordre :

1. **Caméra USB** → port USB du Jetson Orin
2. **Câble USB** entre la carte Marlin et le Jetson Orin
3. **Alimentation de l'imprimante** → branchez en premier
4. **Alimentation du Jetson Orin** → branchez en dernier

> ⚠️ **Important** : Allumez toujours l'imprimante AVANT le Jetson Orin.

---

## 4. Démarrage du système

### Démarrage automatique (normal)

Quand vous allumez le Jetson Orin, **tout démarre tout seul** en 20 à 30 secondes :
- Le serveur du robot démarre en arrière-plan
- Le navigateur s'ouvre automatiquement en plein écran sur l'interface du robot

Vous n'avez rien à faire.

### Si l'interface ne s'ouvre pas

Ouvrez un terminal (Ctrl+Alt+T) et tapez :
```bash
sudo systemctl restart robot-echecs.service
```
Puis attendez 5 secondes et actualisez le navigateur.

### Accéder à l'interface depuis un autre appareil

Si vous avez un téléphone ou une tablette sur le même réseau Wi-Fi, tapez dans le navigateur :
```
http://[adresse-IP-du-Jetson]:5000
```
*(Vous pouvez trouver l'adresse IP en tapant `hostname -I` dans un terminal)*

---

## 5. L'interface web — Vue d'ensemble

L'interface se compose de **4 pages** accessibles depuis le menu en haut de l'écran principal.

```
┌─────────────────────────────────────────────────────────┐
│  ♟ Robot Échecs   [Simulation] [★ Légendaires] [Manuel] │
├────────────────────────────┬────────────────────────────┤
│                            │  Panneau de droite :       │
│    Échiquier               │  - Horloges                │
│    (avec cimetière         │  - Statut de la partie     │
│     autour)                │  - Boutons d'action        │
│                            │  - Historique des coups    │
│                            │  - Log GCode               │
└────────────────────────────┴────────────────────────────┘
```

### Le panneau de droite expliqué

- **Horloges** : temps restant pour chaque joueur (si activé)
- **Statut** : message indiquant ce qui se passe ("À vous de jouer", "Robot réfléchit..."...)
- **Niveau ELO** : curseur de 100 (débutant) à 3200 (grand maître mondial). 500 = joueur amateur.
- **Bouton 🤖 JOUER ROBOT** : déclenche le coup du robot (voir section Sécurité)
- **Historique** : liste de tous les coups joués dans la partie
- **Log GCode** : affiche en temps réel les commandes envoyées à l'imprimante

---

## 6. Jouer une partie contre le robot

### Étape 1 — Démarrer une nouvelle partie

Cliquez sur le bouton **NOUVELLE PARTIE**.

Un écran de choix apparaît :

```
┌──────────────────────────────────────┐
│         ♟ Nouvelle partie            │
│   Quelle couleur voulez-vous jouer ? │
│                                      │
│  ┌──────────┐      ┌──────────┐      │
│  │    ⬜    │      │    ⬛    │      │
│  │  BLANCS  │      │  NOIRS   │      │
│  │ Vous     │      │  Robot   │      │
│  │ jouez en │      │  joue en │      │
│  │ premier  │      │  premier │      │
│  └──────────┘      └──────────┘      │
└──────────────────────────────────────┘
```

- **BLANCS** : vous jouez en premier (les blancs ouvrent toujours la partie aux échecs)
- **NOIRS** : le robot joue en premier

### Étape 2 — Si vous jouez les Blancs

1. Déplacez physiquement votre pièce sur le plateau (pour une prise, posez vous-même la pièce prise au cimetière)
2. **Retirez votre main** de la zone de jeu
3. Appuyez sur **✅ J'AI JOUÉ** (bouton bleu)
4. Le robot prend une photo, la compare à la photo prise après son dernier coup et retrouve votre coup
5. Il réfléchit puis joue son coup — **ne touchez pas le plateau pendant qu'il bouge !**
6. À la fin, la tête retourne en position caméra et reprend une photo de référence
7. Le bouton redevient **✅ J'AI JOUÉ** : à vous

**Si la caméra n'arrive pas à reconnaître votre coup** (caméra débranchée, main dans le champ, lumière qui a changé…), une fenêtre s'ouvre : touchez la pièce que vous avez déplacée, puis sa case d'arrivée. Le bouton **📷 Réessayer la caméra** relance la photo. Une promotion donne toujours une dame.

### Étape 3 — Si vous jouez les Noirs

Le robot joue les Blancs et commence :
1. Le bandeau orange apparaît automatiquement
2. **Éloignez vos mains**
3. Appuyez sur **🤖 JOUER ROBOT** pour que le robot joue son premier coup
4. Ensuite, jouez votre coup et appuyez sur **✅ J'AI JOUÉ**

### Avant la première partie : calibrer la caméra (une seule fois)

1. Page **🎮 Manuel**, faites un **🏠 HOME G28**
2. Videz le plateau et posez **4 dames noires sur a1, h1, a8 et h8**
3. Appuyez sur **🎯 CALIBRER CAMÉRA** : la tête va en position caméra et repère les 4 dames
4. Remettez les pièces en position de départ, appuyez sur **📸 PHOTO RÉFÉRENCE**
5. Touchez l'image sous les boutons : les noms de cases (a1, e4…) doivent correspondre au vrai plateau. Sinon, ajustez `VISION_FLIP_FILES`, `VISION_FLIP_RANKS` ou `VISION_SWAP_AXES` dans `config.py`

La calibration est enregistrée dans `vision_calibration.json` et reste valable tant que la caméra ne bouge pas.

### Fin de partie

Quand la partie se termine (échec et mat, pat, nulle), une animation de confettis apparaît avec le résultat :
- **"LES BLANCS ONT GAGNÉ !"**
- **"LES NOIRS ONT GAGNÉ !"**
- **"PAT !"** — aucun joueur ne peut bouger mais le roi n'est pas en échec (nul)
- **"MATCH NUL !"** — autres formes de nulle (répétition, règle des 50 coups...)

Cliquez n'importe où pour fermer l'animation.

### Annuler un coup

Cliquez sur **ANNULER COUP** pour revenir deux demi-coups en arrière (votre coup + celui du robot).

> ⚠️ Le plateau physique ne se réinitialise pas automatiquement — vous devez replacer les pièces à la main selon ce que montre l'échiquier à l'écran. Le coup suivant sera saisi à l'écran (ou appuyez sur **📸 PHOTO RÉFÉRENCE** dans la page Manuel une fois les pièces replacées).

### Modifier une pièce (correction d'erreur)

Si la position à l'écran ne correspond pas au plateau réel (suite à une erreur de vision) :
1. Activez le **bouton MODIFIER PIÈCE** (il devient orange)
2. Cliquez sur la case à corriger sur l'échiquier
3. Choisissez la pièce correcte dans le sélecteur qui apparaît
4. Désactivez le mode modification

### Exporter la partie sur clé USB

1. Branchez une clé USB sur le Jetson Orin
2. Cliquez sur **EXPORT USB**
3. Un fichier `.pgn` (format universel des parties d'échecs) est copié sur la clé
4. Ce fichier peut être ouvert sur Chess.com, Lichess, ou tout logiciel d'échecs

---

## 7. Page Simulation (jouer sans le robot physique)

Accessible via le bouton **♟ Simulation** dans le menu.

Cette page vous permet de jouer contre Stockfish **sans que le robot physique bouge**. Utile pour :
- Tester votre niveau
- Vérifier que Stockfish fonctionne
- S'entraîner

### Comment jouer en simulation

1. Cliquez sur la pièce que vous voulez déplacer (elle se met en évidence)
2. Cliquez sur la case de destination
3. Stockfish joue automatiquement sa réponse

### Régler la difficulté

Le curseur **ELO Stockfish** va de 100 (très facile) à 3200 (impossible à battre). Commencez à 500 pour un défi raisonnable.

---

## 8. Page Parties Légendaires

Accessible via le bouton **★ Légendaires** dans le menu.

Cette page rejoue automatiquement les plus grandes parties de l'histoire des échecs, **coup par coup**, avec le robot physique qui déplace les pièces !

### Les 6 parties disponibles

| Partie | Joueurs | Année | Particularité |
|--------|---------|-------|---------------|
| L'Immortelle | Anderssen vs Kieseritzky | 1851 | Le sacrifice de toutes les pièces |
| La Partie de l'Opéra | Morphy vs Duke of Brunswick | 1858 | Jouée pendant un opéra |
| La Partie Toujours Verte | Anderssen vs Dufresne | 1852 | Combinaison finale magistrale |
| La Partie du Siècle | Byrne vs Fischer | 1956 | Fischer avait 13 ans |
| Fischer vs Spassky — Partie 6 | Fischer vs Spassky | 1972 | Championnat du monde |
| L'Immortelle de Kasparov | Kasparov vs Topalov | 1999 | Le coup Rd7 légendaire |

### Comment utiliser cette page

1. **Sélectionnez une partie** en cliquant dessus dans la liste (elle se met en évidence)
2. Cliquez sur **▶ JOUER** — le premier coup se joue immédiatement, puis les suivants toutes les 10 secondes
3. Cliquez sur **⏸ PAUSE** pour mettre en pause
4. Utilisez **⏮** et **⏭** pour reculer ou avancer d'un coup à la fois
5. Cliquez sur **↺** pour revenir au début de la partie

### Régler la vitesse

Le curseur **Intervalle** permet de choisir le temps entre chaque coup (de 2 à 30 secondes).

### Le cimetière

Les pièces capturées apparaissent autour de l'échiquier, comme dans une vraie partie. Les blanches en bas, les noires en haut.

### Le log GCode

En bas du panneau, vous voyez en temps réel les commandes envoyées à l'imprimante pour chaque déplacement physique.

---

## 9. Page Contrôle Manuel

Accessible via le bouton **🎮 Manuel** dans le menu.

Cette page permet de contrôler manuellement les moteurs du robot sans jouer aux échecs. Utile pour :
- Calibrer la position du plateau
- Tester l'électro-aimant
- Diagnostiquer un problème

### Les contrôles disponibles

**Déplacement case par case** : Cliquez sur la grille 10×10 pour envoyer la tête directement au-dessus de cette case.

**Jogging fin** : Les flèches ← → ↑ ↓ déplacent la tête par petits pas (0.5mm, 1mm, 5mm ou 10mm selon le réglage).

**Boutons d'action** :
- **🏠 HOME G28** : Remet la tête en position d'origine (indispensable avant toute utilisation)
- **📷 POSITION CAMÉRA** : Déplace la tête en position de photo (Y 180, tête levée à 15 cm : tout l'échiquier est visible) — utile pour vérifier que la caméra voit bien tout le plateau
- **📌 DÉFINIR POSITION HOME** : Enregistre la position actuelle comme nouvelle origine
- **⛔ URGENCE** : Arrêt immédiat de tous les moteurs

**Aimant** : Bouton pour activer/désactiver l'électro-aimant manuellement.

**Réglage Z de prise** : Ajuste la hauteur à laquelle l'aimant attrape les pièces.

**Caméra** : **🎯 CALIBRER CAMÉRA** et **📸 PHOTO RÉFÉRENCE** (voir « Calibrer la caméra » au chapitre 6), avec l'image analysée par le robot.

---

## 10. Réglages importants

Ces valeurs se trouvent dans le fichier `config.py`. Pour les modifier, ouvrez un terminal et tapez :
```bash
nano /home/pp/robot_echecs_orin/config.py
```
*(Ctrl+X pour quitter, Y pour sauvegarder)*

### Valeurs à connaître

| Variable | Valeur par défaut | Signification |
|----------|-------------------|---------------|
| `SIMULATION_MODE` | `False` | Mettre `True` si pas d'imprimante branchée |
| `HUMAN_PLAYS_WHITE` | `True` | Couleur par défaut au démarrage |
| `DEFAULT_ELO` | `500` | Niveau Stockfish par défaut |
| `MARLIN_PORT` | `/dev/ttyUSB0` | Port USB de la carte Marlin |
| `BOARD_OFFSET_X` | `20.0` | Position X du coin A1 de l'échiquier (mm) |
| `BOARD_OFFSET_Y` | `20.0` | Position Y du coin A1 de l'échiquier (mm) |
| `Z_BOARD` | `3.0` | Hauteur Z au niveau du plateau (mm) |
| `Z_PICK_REL` | `31.0` | Hauteur de transport d'une pièce (mm) |
| `VISION_X` | `100.0` | Position X de la tête pour la photo (mm) |
| `VISION_Y` | `200.0` | Position Y du plateau pour la photo (max = reculé) |
| `Z_VISION` | `100.0` | Hauteur Z pour la photo (10 cm) |

### Calibration du plateau

Si les pièces ne s'alignent pas bien avec les cases :
1. Ouvrez la page **Contrôle Manuel**
2. Cliquez sur la case **A1** (coin bas-gauche)
3. Vérifiez que l'aimant est exactement centré sur la case
4. Si décalé, modifiez `BOARD_OFFSET_X` et `BOARD_OFFSET_Y` dans `config.py`
5. Recommencez jusqu'à l'alignement parfait

---

## 11. Sécurité

### ⚠️ Règle absolue : ne jamais approcher les mains pendant le mouvement du robot

La tête d'impression se déplace rapidement et peut blesser. Respectez toujours cette procédure :

1. **Jouez votre coup**
2. **Retirez complètement vos mains** du plateau et de la zone de jeu
3. Attendez que le **bandeau orange** apparaisse à l'écran
4. Appuyez sur **🤖 JOUER ROBOT** SEULEMENT quand vos mains sont loin
5. **N'approchez pas** pendant que le robot bouge (attendez que le mouvement soit terminé)

Le bouton **⛔ STOP D'URGENCE** arrête immédiatement tous les moteurs si nécessaire.

---

## 12. En cas de problème

### "Le navigateur ne s'ouvre pas au démarrage"
```bash
sudo systemctl restart robot-echecs.service
```
Puis attendez 10 secondes et rouvrez le navigateur.

### "L'imprimante ne répond pas / ne bouge pas"
1. Vérifiez que le câble USB entre l'imprimante et le Jetson est bien branché
2. Vérifiez que `MARLIN_PORT` dans `config.py` correspond au bon port :
```bash
ls /dev/ttyUSB*
```
3. Redémarrez le service

### "Les navigateurs ne s'ouvrent pas"
Ce problème arrive parfois après une mise à jour du système. Solution :
```bash
sudo apt install epiphany-browser
```
Puis utilisez Epiphany (GNOME Web) comme navigateur.

### "Je tape mon mot de passe mais rien ne s'affiche"
C'est normal sous Linux — le mot de passe ne s'affiche pas pour des raisons de sécurité. Tapez-le quand même et appuyez sur Entrée.

### "Le robot déplace la pièce au mauvais endroit"
Le plateau n'est pas bien calibré. Allez dans **Contrôle Manuel** et recalibrez `BOARD_OFFSET_X` / `BOARD_OFFSET_Y`.

### "La caméra ne voit pas bien le plateau"
1. Allez dans **Contrôle Manuel**
2. Appuyez sur **📷 POSITION CAMÉRA**
3. Vérifiez que toute la surface du plateau est visible dans le flux caméra
4. Si besoin, ajustez `VISION_X`, `VISION_Y`, ou `Z_VISION` dans `config.py`

### Étape 1 — Prérequis système
```bash
sudo apt-get update
sudo apt-get install -y python3-pip git stockfish epiphany-browser wmctrl
```

### Étape 2 — Bibliothèques Python
```bash
pip3 install flask pyserial python-chess opencv-python numpy Pillow requests
```

### Étape 3 — Télécharger le programme
```bash
cd ~
git clone https://github.com/pierrickperez-creator/robot_echecs_orin.git
cd robot_echecs_orin
```

### Étape 4 — Configurer le démarrage automatique

**Service système (démarrage du serveur Flask) :**
```bash
sudo cp /home/pp/robot_echecs_orin/web/robot-echecs.service /etc/systemd/system/
sudo systemctl enable robot-echecs.service
sudo systemctl start robot-echecs.service
```

**Ouverture automatique du navigateur :**
```bash
mkdir -p ~/.config/autostart
# Le fichier robot-echecs-kiosk.desktop est déjà configuré
```

### Étape 5 — Vérifier l'installation
```bash
systemctl is-active robot-echecs.service
```
Si la réponse est `active`, tout fonctionne.

---

*Bonne partie !* 🤖♟️
