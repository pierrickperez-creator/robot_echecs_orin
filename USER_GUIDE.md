# 📖 Guide Utilisateur - Robot Échec Automatisé

Ce guide vous explique comment installer et utiliser votre robot, même si vous n'êtes pas un expert en informatique. Suivez simplement les **"Missions"** ci-dessous.

---

## 🏁 ÉTAPE 0 : Installer le "Cerveau" du Robot (Première fois)

Si vous venez de changer de carte Jetson Orin ou si vous installez tout pour la première fois, suivez ce guide pas-à-pas.

### ⌨️ Comment utiliser le Terminal ?
Le "Terminal" est l'application noire où l'on tape des commandes.
1. Appuyez simultanément sur les touches **Ctrl + Alt + T** de votre clavier pour l'ouvrir.
2. Pour coller une commande, faites un **Clic Droit** puis **Coller**.
3. **IMPORTANT** : Quand on vous demande votre mot de passe, tapez-le (il ne s'affiche pas à l'écran, c'est normal !) puis appuyez sur **Entrée**.

### 📝 Mission 1 : Préparer le terrain
Copiez et collez cette ligne dans le terminal, puis appuyez sur **Entrée** :
```bash
sudo apt-get update && sudo apt-get install -y python3-pip git stockfish python3-tk
```
*(Cela installe les outils de base et Stockfish, le moteur qui calcule les coups d'échecs).*

### 📦 Mission 2 : Installer les accessoires (Bibliothèques)
Copiez et collez cette ligne et appuyez sur **Entrée** :
```bash
pip3 install flask pyserial python-chess opencv-python numpy Pillow requests
```
*(Cela installe les petits programmes qui permettent au robot de voir, de bouger et d'afficher l'écran tactile).*

*(Le robot va s'éteindre et se rallumer tout seul. C'est normal !)*

### 📁 Mission 4 : Télécharger le programme du Robot
Une fois l'écran fonctionnel, ouvrez à nouveau le terminal (**Ctrl + Alt + T**) et tapez :
```bash
git clone https://github.com/pierrickperez-creator/robot_echecs_orin.git
cd robot_echecs_orin
```

### ⚡ Mission FINAL : Lancer le robot au démarrage
Pour ne pas avoir à tout retaper à chaque fois :
1. Cherchez l'application **"Startup Applications"** (ou "Applications au démarrage") dans le menu du Jetson.
2. Cliquez sur **Add** (Ajouter).
3. Dans "Command", tapez : `python3 /home/votre_nom/robot_echecs_orin/scripts/screen_ui.py`
4. Enregistrez. Désormais, le robot s'allumera en même temps que la carte !

---

## 🚀 Mission : Sauvegarder votre travail sur GitHub

Si vous voulez mettre à jour votre compte `pierrickperez-creator` avec nos dernières modifications, suivez ces étapes :

### 1. Créez le dépôt sur le site GitHub
1. Allez sur [github.com](https://github.com) et connectez-vous.
2. Cliquez sur le bouton vert **"New"** (Nouveau) en haut à gauche.
3. Nommez-le exactement : `robot_echecs_orin`
4. Laissez tout le reste par défaut et cliquez sur **"Create repository"**.

### 2. Envoyez les fichiers depuis le Jetson
Ouvrez votre terminal (**Ctrl + Alt + T**) et tapez ces lignes une par une :

```bash
cd robot_echecs_orin
git init
git add .
git commit -m "Première version du robot autonome"
git branch -M main
git remote add origin https://github.com/pierrickperez-creator/robot_echecs_orin.git
git push -u origin main
```
*(GitHub vous demandera votre nom d'utilisateur et un "Token" (mot de passe spécial). C'est la seule étape un peu technique !)*

---

## 🆘 Dépannage pour tous
- **"Je tape mon mot de passe mais rien ne bouge"** : C'est la sécurité Linux. Tapez quand même et appuyez sur Entrée !
- **"L'écran tactile est tout blanc"** : Vérifiez que vous avez bien fait la **Mission 3** et que l'écran est bien clipsé.
- **"Le robot ne bouge pas"** : Vérifiez que le câble USB entre le Jetson Orin et la carte moteur (Marlin) est bien branché.

---

## 🛠️ 1. Installation Matérielle (Branchements)

### Ordre de connexion recommandé :
1. **Caméra** : Connectez la caméra (CSI ou USB) sur le Jetson Orin. Assurez-vous qu'elle est bien fixée sur la tête d'impression.
2. **Carte Marlin (MKS/RAMPS)** : Reliez la carte Marlin au Jetson Orin via le câble USB.
3. **Écran TFT** : L'écran tactile Quimat 3.5" doit être enfiché sur les ports GPIO du Jetson Orin.
4. **Bouton Physique** : Branchez votre bouton de validation sur le port Endstop `Z_MAX` (ou celui configuré dans `config.py`) de la carte Marlin.
5. **Alimentation** : Allumez d'abord l'alimentation du robot (moteurs), puis celle du Jetson Orin.

---

## 🚀 2. Démarrage du Système

### Mode Automatique (Recommandé)
Le robot est configuré pour démarrer tout seul. À l'allumage du Jetson Orin :
- Le **Backend** (Serveur Flask & Vision) démarre en arrière-plan.
- L'**Interface Tactile** (TFT) s'affiche en plein écran après quelques secondes.

### 1. Réglage ELO via Pavé Numérique
- **Invention** : Ajout d'une interface de saisie directe `Toplevel` avec un pavé numérique optimisé pour le tactile.
- **Bénéfice** : Permet de choisir précisément sa difficulté entre 100 (débutant) et 3200 (grand maître) sans bouton +/- fastidieux.

### 2. Mode Manuel (Bac à sable) Debug)
Si vous devez lancer les programmes manuellement via un terminal :
1. Ouvrez un terminal dans le dossier `robot_echecs_orin`.
2. Lancez le serveur : `python3 web/app.py`
3. Ouvrez un deuxième terminal et lancez l'interface : `python3 scripts/screen_ui.py`

---

## ♟️ 3. Déroulement d'une Partie

### Étape 1 : Calibration (Indispensable au démarrage)
1. L'écran affiche : **"Placer les 4 Dames Noires aux coins..."**.
2. Placez manuellement 4 Dames Noires sur les cases de coin du plateau (0,0 ; 9,0 ; 0,9 ; 9,9).
3. Appuyez sur le **bouton physique**.
4. Le bras remonte en `Z=100`, prend une photo, et valide la géométrie du plateau.

### Étape 2 : Votre Tour (Blancs)
1. L'écran affiche : **"À toi de jouer"**.
2. Déplacez votre pièce sur l'échiquier.
3. Appuyez sur le **bouton physique**.
4. Le bras remonte en `Z=100`, analyse votre coup et met à jour l'horloge.

### Étape 3 : Niveau de l'IA (ELO)
Avant de commencer, vous pouvez régler la force du robot :
1. Sur l'écran d'accueil, cliquez sur le bouton **🤖 IA: XXXX**.
2. Saisissez le niveau souhaité sur le pavé numérique (entre 100 et 3200).
3. Appuyez sur **OK** pour valider.

### Étape 4 : Tour du Robot (Noirs)
1. L'écran affiche : **"Le robot joue..."**.
2. Le robot calcule son coup avec Stockfish.
3. Le bras exécute le mouvement physiquement (déplacement des pièces et gestion du cimetière).
4. Le bras remonte une dernière fois pour vérifier sa position avant de vous redonner la main.

---

### 🕹️ Pilotage Manuel (Mode Bac à Sable)
Si vous souhaitez déplacer des pièces sans que l'IA ne valide les coups (pour réorganiser le plateau ou tester les actionneurs) :
1. Allez dans **Settings** > **🕹️ Mode Manuel (Plateau)**.
2. Touchez une pièce à déplacer (elle devient jaune).
3. Touchez la destination (elle devient orange).
4. Appuyez sur **VALIDER LE MOUVEMENT**. Le robot effectuera l'action physiquement.

## ⚙️ 4. Réglages et Fonctions Avancées

### Test de l'aimant
Utilisez le bouton **"🧲 Aimant"** dans les réglages pour vérifier la puissance de levage.

### 👁️ Vision Directe (TFT)
Cliquez sur **👁️ Vision Directe** pour voir le flux caméra redressé directement sur l'écran tactile. Utile pour vérifier l'alignement sans PC.

### 🧠 Correction de Mémoire
Si le robot a mal interprété un coup (ex: confusion de pièce) :
1. Cliquez sur **🧠 Corriger Plateau**.
2. Touchez la case erronée sur l'échiquier virtuel.
3. Sélectionnez la pièce réelle présente sur la case dans le popup.
4. La mémoire du robot est corrigée instantanément.

### 💾 Export USB des Parties
Pour récupérer vos exploits :
1. Branchez une clé USB sur le Jetson Orin.
2. Cliquez sur **💾 Exporter USB**.
3. Le fichier PGN de la partie en cours sera copié sur la clé.

### En cas d'urgence
Appuyez sur le bouton **STOP** de l'écran tactile pour couper immédiatement les mouvements moteurs.

---

*Bonne partie !* 🤖♟️
