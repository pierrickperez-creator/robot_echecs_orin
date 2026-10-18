#!/usr/bin/env bash
# Lance l'interface web en plein écran au démarrage de la session (sans clavier ni souris).
# Appelé par ~/.config/autostart/robot-echecs-kiosk.desktop

URL="http://localhost:5000"

# 1. Attendre que le serveur Flask réponde (max ~2 min)
for _ in $(seq 1 120); do
    curl -s -o /dev/null "$URL" && break
    sleep 1
done

# 2. Lancer le navigateur
epiphany-browser "$URL" &

# 3. Attendre sa fenêtre puis la passer en plein écran
for _ in $(seq 1 60); do
    WIN=$(wmctrl -lx | awk 'tolower($3) ~ /epiphany/ {print $1; exit}')
    if [ -n "$WIN" ]; then
        sleep 2   # laisser GNOME finir de placer la fenêtre
        wmctrl -i -r "$WIN" -b add,fullscreen
        wmctrl -i -a "$WIN"
        break
    fi
    sleep 1
done

wait
