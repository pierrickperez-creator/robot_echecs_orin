// Sons des buzzers et haut-parleurs pendant la simulation (Web Audio)
(function (root) {
  class AudioEngine {
    constructor() { this.ctx = null; this.osc = new Map(); this.muted = false; }
    ensure() {
      if (this.ctx || this.muted) return;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    }
    update(sounds) {
      if (this.muted) { this.stopAll(); return; }
      this.ensure();
      if (!this.ctx) return;
      const seen = new Set();
      for (const s of sounds || []) {
        seen.add(s.id);
        let o = this.osc.get(s.id);
        if (!o) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'square';
          gain.gain.value = 0.035;
          osc.connect(gain).connect(this.ctx.destination);
          osc.start();
          o = { osc, gain };
          this.osc.set(s.id, o);
        }
        o.osc.frequency.setTargetAtTime(Math.max(20, Math.min(12000, s.freq)), this.ctx.currentTime, 0.005);
      }
      for (const [id, o] of this.osc) if (!seen.has(id)) { o.osc.stop(); o.osc.disconnect(); this.osc.delete(id); }
    }
    stopAll() {
      for (const o of this.osc.values()) { try { o.osc.stop(); o.osc.disconnect(); } catch (e) { /* déjà arrêté */ } }
      this.osc.clear();
    }
    toggle() { this.muted = !this.muted; if (this.muted) this.stopAll(); return !this.muted; }
  }
  root.AudioEngine = AudioEngine;
})(this);
