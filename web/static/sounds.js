// Sons du robot, générés dans le navigateur (aucun fichier nécessaire).
// Un fichier personnel dans sounds/ (coup.mp3, echec.mp3, victoire.mp3, defaite.mp3)
// remplace le son généré correspondant.
(function () {
    let ctx = null;
    const cfg = { on: true, volume: 0.8, move: 'carillon', check: 'alerte' };

    function audio() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }
    // Le navigateur n'autorise le son qu'après un premier toucher de l'écran
    document.addEventListener('pointerdown', () => { try { audio(); } catch (e) {} }, { once: true });

    function note(freq, start, dur, vol = 0.25, type = 'triangle', cutoff = 2500) {
        const c = audio(), t = c.currentTime + start;
        const osc = c.createOscillator(), gain = c.createGain(), lp = c.createBiquadFilter();
        osc.type = type; osc.frequency.value = freq;
        lp.type = 'lowpass'; lp.frequency.value = cutoff;           // son rond, pas criard
        const v = Math.max(0.0002, vol * cfg.volume);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(v, t + 0.012);        // attaque douce
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);     // extinction lente
        osc.connect(lp); lp.connect(gain); gain.connect(c.destination);
        osc.start(t); osc.stop(t + dur + 0.05);
    }

    // Choix proposés dans la page Manuel
    const MOVE = {
        carillon:  { label: 'Carillon',  play: () => { note(523.25, 0, 0.9, 0.22); note(783.99, 0.14, 1.1, 0.18); note(1046.5, 0.14, 1.1, 0.05, 'sine'); } },
        clochette: { label: 'Clochette', play: () => { note(1318.5, 0, 1.2, 0.14, 'sine'); note(2637, 0, 0.6, 0.04, 'sine'); note(1760, 0.18, 1.2, 0.10, 'sine'); } },
        bois:      { label: 'Bois',      play: () => { note(659.25, 0, 0.25, 0.30, 'triangle', 1500); note(880, 0.12, 0.3, 0.26, 'triangle', 1500); } },
        harpe:     { label: 'Harpe',     play: () => { [392, 493.88, 587.33, 783.99].forEach((f, i) => note(f, i * 0.07, 0.9, 0.15)); } },
        doux:      { label: 'Note douce', play: () => { note(659.25, 0, 1.4, 0.2, 'sine', 1800); } },
    };
    const CHECK = {
        alerte:  { label: 'Alerte',       play: () => { note(880, 0, 0.18, 0.22, 'square', 1800); note(659.25, 0.2, 0.35, 0.22, 'square', 1800); } },
        cloche:  { label: 'Cloche',       play: () => { note(987.77, 0, 1.0, 0.2, 'sine'); note(987.77, 0.35, 1.2, 0.18, 'sine'); } },
        fanfare: { label: 'Petit clairon', play: () => { [523.25, 523.25, 783.99].forEach((f, i) => note(f, i * 0.12, i === 2 ? 0.6 : 0.12, 0.2, 'sawtooth', 1600)); } },
        grave:   { label: 'Note grave',   play: () => { note(196, 0, 0.9, 0.35, 'triangle', 900); note(146.83, 0.25, 1.0, 0.3, 'triangle', 900); } },
    };
    const OTHER = {
        // Fanfare « trésor » originale : arpège qui monte puis accord tenu
        victoire: () => {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.13, 0.5, 0.2));
            [523.25, 659.25, 783.99, 1046.5].forEach(f => note(f, 0.6, 1.8, 0.12));
            note(1318.5, 0.6, 1.8, 0.06, 'sine');
        },
        defaite: () => { [659.25, 587.33, 523.25, 392.0].forEach((f, i) => note(f, i * 0.18, 0.6, 0.16)); },
        nulle: () => { note(587.33, 0, 0.6, 0.16); note(587.33, 0.25, 0.9, 0.14); },
    };

    function generated(name) {
        if (name === 'coup') return (MOVE[cfg.move] || MOVE.carillon).play;
        if (name === 'echec') return (CHECK[cfg.check] || CHECK.alerte).play;
        return OTHER[name];
    }

    function playFile(file, fallback) {
        let done = false;
        const once = () => { if (!done) { done = true; fallback(); } };
        const a = new Audio('/sounds/' + file + '?t=' + Date.now());
        a.volume = cfg.volume;
        a.onerror = once;
        a.play().then(() => { done = true; }).catch(once);
    }

    window.RobotSounds = {
        cfg, MOVE, CHECK,
        set(c) { Object.assign(cfg, c || {}); },
        // Son d'un évènement de partie : 'coup', 'echec', 'victoire', 'defaite', 'nulle'
        play(name) {
            if (!cfg.on) return;
            const gen = generated(name);
            try { playFile(name + '.mp3', () => gen && gen()); } catch (e) {}
        },
        // Aperçu d'un choix (page Manuel), même si le son est coupé
        preview(group, key) {
            const g = group === 'check' ? CHECK : MOVE;
            try { g[key] && g[key].play(); } catch (e) {}
        },
    };
})();
