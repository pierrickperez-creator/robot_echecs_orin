#!/usr/bin/env bash
# Lance l'interface web en plein écran au démarrage de la session (sans clavier ni souris).
# Appelé par ~/.config/autostart/robot-echecs-kiosk.desktop

URL="http://127.0.0.1:5000"
# Coquille locale : affiche l'application et la recharge toute seule après un
# redémarrage du serveur (au lieu de la page d'erreur bloquante du navigateur).
# Servie par un mini serveur à part (port 5001), indépendant du serveur du robot :
# le navigateur refuse d'afficher l'application dans une page ouverte en file://.
SHELL_DIR="$(cd "$(dirname "$0")/.." && pwd)/web/kiosk_shell"
SHELL_PAGE="http://127.0.0.1:5001/kiosk.html"
if ! curl -s -o /dev/null "$SHELL_PAGE"; then
    setsid python3 -m http.server 5001 --bind 127.0.0.1 --directory "$SHELL_DIR" >/dev/null 2>&1 < /dev/null &
    for _ in $(seq 1 20); do curl -s -o /dev/null "$SHELL_PAGE" && break; sleep 0.5; done
fi

# 1. Attendre que le serveur Flask réponde (max ~2 min)
for _ in $(seq 1 120); do
    curl -s -o /dev/null "$URL" && break
    sleep 1
done

# 2. Lancer le navigateur
epiphany-browser "$SHELL_PAGE" &

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
