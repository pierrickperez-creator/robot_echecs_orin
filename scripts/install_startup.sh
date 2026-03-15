#!/usr/bin/env bash

# Script d'installation des services Systemd pour le Robot Echecs (Headless)
# Lance le backend Flask et l'interface TFT au démarrage.

if [ "$EUID" -ne 0 ]; then
  echo "Veuillez exécuter ce script en tant que root (sudo bash install_startup.sh <votre_user>)"
  exit 1
fi

if [ -z "$1" ]; then
  echo "Erreur : Spécifiez le nom d'utilisateur Ubuntu (ex: sudo bash install_startup.sh jetson)"
  exit 1
fi

USER_NAME=$1
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && cd .. && pwd )"

BACKEND_SERVICE="/etc/systemd/system/robot_backend.service"
TFT_SERVICE="/etc/systemd/system/robot_tft.service"

echo "Installation des services Systemd pour l'utilisateur $USER_NAME..."
echo "Chemin du projet détecté : $DIR"

# 1. Service Backend (Flask)
cat <<EOF > $BACKEND_SERVICE
[Unit]
Description=Robot Echecs - Backend Flask
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=/usr/bin/python3 $DIR/web/app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 2. Service Frontend (Ecran TFT)
cat <<EOF > $TFT_SERVICE
[Unit]
Description=Robot Echecs - Interface TFT (Tkinter)
After=graphical.target robot_backend.service
Requires=robot_backend.service

[Service]
Type=simple
User=$USER_NAME
Environment=DISPLAY=:0
WorkingDirectory=$DIR
ExecStart=/usr/bin/python3 $DIR/scripts/screen_ui.py
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
EOF

echo "Rechargement des daemons Systemd..."
systemctl daemon-reload

echo "Activation des services au démarrage..."
systemctl enable robot_backend.service
systemctl enable robot_tft.service

echo "Démarrage des services..."
systemctl restart robot_backend.service
systemctl restart robot_tft.service

echo "--------------------------------------------------------"
echo "Installation terminée !"
echo "Vérifiez l'état avec :"
echo "  sudo systemctl status robot_backend.service"
echo "  sudo systemctl status robot_tft.service"
echo "Les logs sont consultables avec 'journalctl -u robot_tft.service -f'"
echo "--------------------------------------------------------"
