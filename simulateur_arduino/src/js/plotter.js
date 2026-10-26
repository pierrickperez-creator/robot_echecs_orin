/*
 * Traceur série : lit les lignes du moniteur série et trace les nombres.
 * Formats acceptés : « 12 34 56 », « 12,34 », « temp:21.5,hum:40 » (comme le traceur de l'IDE Arduino).
 */
(function (root) {
  const COLORS = ['#1565c0', '#d32f2f', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f'];
  class Plotter {
    constructor(canvas, legend) {
      this.cv = canvas; this.legend = legend;
      this.series = new Map();
      this.max = 400;
      this.partial = '';
      this.dirty = false;
    }
    clear() { this.series.clear(); this.partial = ''; this.dirty = true; this.draw(); }
    feed(text) {
      this.partial += text;
      const lines = this.partial.split(/\r?\n/);
      this.partial = lines.pop();
      for (const line of lines) this.line(line);
      if (this.partial.length > 500) this.partial = '';
    }
    line(line) {
      const tokens = line.trim().split(/[\s,;\t]+/).filter(Boolean);
      let idx = 0;
      let any = false;
      for (const tok of tokens) {
        let name, val;
        const m = /^([^:]+):(-?[\d.]+(?:e-?\d+)?)$/i.exec(tok);
        if (m) { name = m[1]; val = parseFloat(m[2]); }
        else if (/^-?[\d.]+(?:e-?\d+)?$/i.test(tok)) { name = 'valeur ' + (idx + 1); val = parseFloat(tok); }
        else continue;
        idx++;
        if (!isFinite(val)) continue;
        if (!this.series.has(name)) this.series.set(name, []);
        const s = this.series.get(name);
        s.push(val);
        if (s.length > this.max) s.shift();
        any = true;
      }
      if (any) this.dirty = true;
    }
    draw() {
      if (!this.dirty) return;
      this.dirty = false;
      const cv = this.cv;
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const dpr = root.devicePixelRatio || 1;
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      const W = r.width, H = r.height, L = 46, B = 18, T = 10;
      g.clearRect(0, 0, W, H);
      let lo = Infinity, hi = -Infinity;
      for (const s of this.series.values()) for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (!isFinite(lo)) {
        g.fillStyle = '#90a4ae'; g.font = '13px sans-serif';
        g.fillText('Envoyez des nombres avec « moniteur série : afficher » ou « traceur série » pour les voir ici.', 20, H / 2);
        this.legend.innerHTML = '';
        return;
      }
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
      const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
      const dark = document.documentElement.dataset.theme === 'dark';
      g.strokeStyle = dark ? '#2a3442' : '#eceff1'; g.fillStyle = dark ? '#95a3b4' : '#78909c'; g.font = '11px sans-serif'; g.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = lo + (hi - lo) * i / 4;
        g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - 6, y(v)); g.stroke();
        g.fillText(+v.toPrecision(4), 4, y(v) + 4);
      }
      let k = 0;
      const leg = [];
      for (const [name, s] of this.series) {
        const col = COLORS[k++ % COLORS.length];
        g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath();
        s.forEach((v, i) => {
          const x = L + (W - L - 8) * (i + this.max - s.length) / (this.max - 1);
          if (i === 0) g.moveTo(x, y(v)); else g.lineTo(x, y(v));
        });
        g.stroke();
        leg.push(`<span style="color:${col}">■ ${name.replace(/</g, '&lt;')} : ${+s[s.length - 1].toPrecision(5)}</span>`);
      }
      this.legend.innerHTML = leg.join('');
    }
  }
  root.Plotter = Plotter;
})(this);
