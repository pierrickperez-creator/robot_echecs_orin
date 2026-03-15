import serial
import time
import glob
import sys
import os

# Tentative d'import OpenCV pour la caméra
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

print("=== 🕵️  DIAGNOSTIC COMPLET SYSTÈME (V8 - Permissif) ===")

# --- 1. VERIFICATION CONFIGURATION ---
print("\n--- 1. CONFIGURATION ---")
try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(current_dir))
    if project_root not in sys.path:
        sys.path.append(project_root)
        
    from robot_echecs_orin import config
    import importlib
    importlib.reload(config)
    
    print(f"Mode Simulation : {'✅ ACTIVÉ' if config.SIMULATION_MODE else '❌ DÉSACTIVÉ (Mode Réel)'}")
    print(f"Port Configuré  : {config.MARLIN_PORT}")
    
    if config.SIMULATION_MODE:
        print("⚠️  ATTENTION : Le robot ne bougera PAS en mode simulation !")
except ImportError as e:
    print(f"⚠️  Impossible de lire config.py : {e}")

# --- 2. DIAGNOSTIC IMPRIMANTE & MOUVEMENT ---
print("\n--- 2. IMPRIMANTE 3D (CONNEXION + MOTEURS) ---")
ports = glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*')
valid_port = None

if not ports:
    print("❌ AUCUN PORT SÉRIE TROUVÉ ! (Câble débranché ?)")
else:
    print(f"✅ Ports détectés : {ports}")
    for port in ports:
        print(f"\n>> Test connexion sur {port} (250000 bauds)...")
        try:
            s = serial.Serial(port, 250000, timeout=1)
            
            # Reboot Arduino
            print("   Reboot carte (DTR)...")
            s.dtr = False; time.sleep(0.1); s.dtr = True
            time.sleep(2.0) 
            s.reset_input_buffer()
            
            print("   Envoi M105...")
            s.write(b"M105\n")
            
            start = time.time()
            resp = ""
            while time.time() - start < 4:
                if s.in_waiting:
                    try: 
                        line = s.readline().decode(errors='ignore').strip()
                        if line: resp += line
                    except: pass
            
            if "ok" in resp or "T:" in resp or "start" in resp:
                print(f"🎉 COMMUNICATION OK sur {port}.")
                
                if "Err" in resp or "MINTEMP" in resp:
                     # On affiche l'erreur mais on tente quand même si c'est juste MINTEMP
                     print("⚠️  ERREUR SIGNALÉE : L'imprimante signale 'Err' ou 'MINTEMP'.")
                     print("    -> Essai de forçage du mouvement (XYZ souvent autorisé).")
                     valid_port = port
                elif "T:0.0" in resp or "T:0 " in resp:
                    print("⚠️  ALERTE TEMPÉRATURE : La sonde indique 0°C (T:0.0).")
                    print("    -> Pas grave pour un robot d'échecs (XYZ autorisé).")
                    valid_port = port # ON AUTORISE LE TEST
                else:
                    valid_port = port
                    print("✅ Statut : PRÊTE.")
            else:
                print("❌ Pas de réponse cohérente (Timeout).")
            s.close()
        except Exception as e:
            print(f"❌ Erreur : {e}")

# --- TEST MOTEUR ---
if valid_port:
    print("\n⚡ TEST MOTEUR (AXE X) ⚡")
    print("ATTENTION : Le robot va bouger de 1cm à droite puis revenir.")
    try:
        choix = input("Voulez-vous lancer ce test ? (o/n) : ")
    except EOFError:
        choix = 'n'
        
    if choix.lower() == 'o':
        try:
            print(">> Initialisation connexion Moteur...")
            s = serial.Serial(valid_port, 250000, timeout=1)
            
            print("   Attente du redémarrage de la carte (peut prendre 5-10s)...")
            boot_start = time.time()
            while time.time() - boot_start < 6:
                if s.in_waiting: s.readline()
                else: time.sleep(0.1)
            
            print("   Carte prête. Envoi commandes...")
            s.reset_input_buffer()

            cmds = [
                "G91",          # Position relative
                "G0 X10 F3000", # Droite 10mm
                "M400",         # Attendre fin mouvement
            ]
            for cmd in cmds:
                print(f"   Envoi: {cmd}")
                s.write(f"{cmd}\n".encode())
                time.sleep(0.1)
            
            print("   -> Mouvement ALLER envoyé.")
            time.sleep(1)
            
            print("   Envoi: G0 X-10 F3000")
            s.write(b"G0 X-10 F3000\n") 
            s.write(b"G90\n")
            print("   -> Mouvement RETOUR envoyé.")
            
            s.close()
            print("\n✅ CONCLUSION : Si ça a bougé, tout est OK pour le site Web !")
        except Exception as e:
            print(f"❌ Erreur pendant le mouvement : {e}")
    else:
        print("Test moteur annulé.")

# --- 3. DIAGNOSTIC CAMERA ---
print("\n--- 3. CAMÉRA & VISION ---")
if HAS_OPENCV:
    video_devices = glob.glob('/dev/video*')
    if video_devices:
        cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret: print(f"✅ Caméra USB OK ({frame.shape[1]}x{frame.shape[0]})")
            else: print("⚠️  Image noire.")
            cap.release()
        else: print("❌ Échec ouverture Caméra.")
    else: print("❌ Pas de caméra branchée.")
else: print("❌ OpenCV manquant.")

print("\n=== FIN ===")
