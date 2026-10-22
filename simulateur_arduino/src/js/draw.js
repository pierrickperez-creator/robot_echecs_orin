/*
 * Dessins SVG des cartes et des composants.
 * Chaque dessin fournit une partie fixe (art) et une partie dynamique (dyn) recalculée pendant la simulation.
 */
(function (root) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rgb = a => `rgb(${a[0]},${a[1]},${a[2]})`;
  const LED_COL = { red: '#ff2a2a', green: '#2dff4a', yellow: '#ffe21a', blue: '#3a7bff', white: '#ffffff', orange: '#ff9a1a', purple: '#c45bff' };
  const LED_OFF = { red: '#9b2b2b', green: '#2f7d3a', yellow: '#b5a43a', blue: '#2c4a8f', white: '#d8d8d8', orange: '#b5702a', purple: '#6e3d8f' };

  /* ---------------------------------------------------------------- police pixel (LCD / OLED) */
  function glyphPath(ch, x0, y0, px, gap) {
    let code = ch.charCodeAt(0);
    let idx = code === 0xB0 || ch === '°' ? 95 : (code >= 32 && code <= 126 ? code - 32 : 31);
    let d = '';
    for (let c = 0; c < 5; c++) {
      const col = FONT5X7[idx * 5 + c];
      for (let r = 0; r < 7; r++) {
        if (col & (1 << r)) d += `M${(x0 + c * px).toFixed(2)} ${(y0 + r * px).toFixed(2)}h${(px - gap).toFixed(2)}v${(px - gap).toFixed(2)}h${(gap - px).toFixed(2)}z`;
      }
    }
    return d;
  }

  /* ---------------------------------------------------------------- broches et connecteurs */
  function header(x, y, n, vertical) {
    const w = vertical ? 10 : n * 10, h = vertical ? n * 10 : 10;
    return `<rect x="${x - 5}" y="${y - 5}" width="${w}" height="${h}" fill="#1a1a1a" rx="1"/>`;
  }
  function pinHole(x, y) {
    return `<rect x="${x - 2.6}" y="${y - 2.6}" width="5.2" height="5.2" fill="#3a3a3a"/><rect x="${x - 1.4}" y="${y - 1.4}" width="2.8" height="2.8" fill="#0a0a0a"/>`;
  }
  // regroupe les broches alignées en connecteurs
  function headersFor(pins) {
    const rows = {};
    for (const p of pins) {
      const key = 'y' + p.y;
      (rows[key] = rows[key] || []).push(p);
    }
    let s = '';
    for (const list of Object.values(rows)) {
      list.sort((a, b) => a.x - b.x);
      let start = 0;
      for (let i = 1; i <= list.length; i++) {
        if (i === list.length || list[i].x - list[i - 1].x !== 10) {
          s += header(list[start].x, list[start].y, i - start, false);
          start = i;
        }
      }
    }
    return s + pins.map(p => pinHole(p.x, p.y)).join('');
  }

  /* ---------------------------------------------------------------- cartes */
  function boardArt(boardId, shield) {
    const b = BOARDS[boardId];
    if (boardId === 'nano') return nanoArt(b, shield);
    const W = b.w, H = b.h;
    const isMega = boardId === 'mega';
    let s = '';
    s += `<rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="#0d7c8c" stroke="#075f6b" stroke-width="1.5"/>`;
    // trous de fixation
    for (const [x, y] of [[55, 7], [W - 12, 30], [W - 12, H - 30], [60, H - 8]]) s += `<circle cx="${x}" cy="${y}" r="4.5" fill="#f5f5f5" stroke="#bdbdbd"/>`;
    // USB et jack
    s += `<rect x="-12" y="30" width="48" height="44" rx="2" fill="#c9cdd1" stroke="#8a8f94"/><rect x="-8" y="36" width="40" height="32" fill="#aeb3b8"/>`;
    s += `<rect x="-8" y="150" width="46" height="36" rx="3" fill="#202020"/><circle cx="12" cy="168" r="9" fill="#3b3b3b"/>`;
    // microcontrôleur
    if (isMega) {
      s += `<rect x="190" y="80" width="70" height="70" fill="#262626" transform="rotate(45 225 115)"/><text x="225" y="118" fill="#aaa" font-size="7" text-anchor="middle">ATMEGA2560</text>`;
    } else {
      s += `<rect x="128" y="125" width="128" height="34" rx="2" fill="#262626"/>`;
      for (let i = 0; i < 14; i++) {
        s += `<rect x="${133 + i * 8.8}" y="121" width="3" height="4" fill="#c8c8c8"/><rect x="${133 + i * 8.8}" y="159" width="3" height="4" fill="#c8c8c8"/>`;
      }
      s += `<text x="192" y="145" fill="#9a9a9a" font-size="7" text-anchor="middle">ATMEGA328P</text>`;
    }
    // bouton reset, quartz, LED
    s += `<rect x="40" y="18" width="14" height="14" fill="#d8d8d8"/><circle cx="47" cy="25" r="4.5" fill="#c62828"/>`;
    s += `<text x="68" y="44" fill="#fff" font-size="5">L</text><text x="68" y="54" fill="#fff" font-size="5">TX</text><text x="68" y="64" fill="#fff" font-size="5">RX</text>`;
    s += `<text x="${isMega ? 330 : 236}" y="94" fill="#fff" font-size="5">ON</text>`;
    // logo
    s += `<text x="${isMega ? 120 : 112}" y="${isMega ? 80 : 92}" fill="#fff" font-size="${isMega ? 20 : 22}" font-weight="bold" font-family="Arial, sans-serif" letter-spacing="1">${isMega ? 'MEGA 2560' : 'UNO'}</text>`;
    s += `<text x="${isMega ? 122 : 114}" y="${isMega ? 96 : 106}" fill="#e0f7fa" font-size="9" font-family="Arial, sans-serif" letter-spacing="2">ARDUINO</text>`;
    s += `<text x="140" y="${H - 30}" fill="#fff" font-size="6" text-anchor="middle">POWER</text><text x="${isMega ? 270 : 215}" y="${H - 30}" fill="#fff" font-size="6" text-anchor="middle">ANALOG IN</text>`;
    s += `<text x="160" y="32" fill="#fff" font-size="6">DIGITAL (PWM ~)</text>`;
    s += headersFor(b.pins);
    // libellés des broches
    for (const p of b.pins) {
      const lab = esc(p.label);
      if (p.y <= 15) s += `<text x="${p.x}" y="${p.y + 9}" fill="#fff" font-size="4.2" text-anchor="end" transform="rotate(-90 ${p.x} ${p.y + 9})" dx="-0">${pwmMark(b, p)}${lab}</text>`;
      else if (p.y >= b.h - 15) s += `<text x="${p.x}" y="${p.y - 8}" fill="#fff" font-size="4.2" text-anchor="start" transform="rotate(-90 ${p.x} ${p.y - 8})">${lab}</text>`;
      else s += `<text x="${p.x === 370 ? p.x - 7 : p.x + 7}" y="${p.y + 1.5}" fill="#fff" font-size="4" text-anchor="${p.x === 370 ? 'end' : 'start'}">${lab}</text>`;
    }
    if (shield) s += shieldArt(b);
    return s;
  }
  function pwmMark(b, p) {
    const n = /^D(\d+)$/.exec(p.id);
    return n && b.pwm.includes(+n[1]) ? '~' : '';
  }

  function shieldArt(b) {
    const W = b.w;
    let s = `<rect x="34" y="22" width="${W - 50}" height="${b.h - 46}" rx="4" fill="#1b4f8f" fill-opacity="0.97" stroke="#0f3463"/>`;
    s += `<text x="${W - 22}" y="${b.h - 30}" fill="#cfe3ff" font-size="7" text-anchor="end" font-family="Arial">Grove Base Shield</text>`;
    s += b.shieldPorts.map(([id, x, y]) => portArt(id, x, y)).join('');
    return s;
  }
  function portArt(id, x, y) {
    const lab = id.replace(/_\d+$/, '');
    return `<g class="port" data-port="${id}">` +
      `<rect x="${x - 17}" y="${y - 7}" width="34" height="14" rx="1.5" fill="#f3efe2" stroke="#9e9a8c"/>` +
      `<rect x="${x - 14}" y="${y - 3}" width="28" height="7" fill="#d9d4c3"/>` +
      [0, 1, 2, 3].map(i => `<rect x="${x - 12 + i * 7}" y="${y - 1}" width="3" height="3" fill="#8d8a7f"/>`).join('') +
      `<text x="${x}" y="${y - 9.5}" fill="#fff" font-size="7" font-weight="bold" text-anchor="middle" font-family="Arial">${lab}</text></g>`;
  }

  function nanoArt(b, shield) {
    let s = '';
    if (shield) {
      s += `<rect x="-40" y="-70" width="260" height="210" rx="6" fill="#1b4f8f" stroke="#0f3463"/>`;
      s += `<text x="90" y="128" fill="#cfe3ff" font-size="7" text-anchor="middle" font-family="Arial">Grove Shield for Arduino Nano</text>`;
      s += b.shieldPorts.map(([id, x, y]) => portArt(id, x, y)).join('');
    }
    s += `<rect x="0" y="-5" width="${b.w}" height="${b.h + 10}" rx="3" fill="#0e6e9e" stroke="#08506f"/>`;
    s += `<rect x="-10" y="22" width="26" height="26" rx="2" fill="#c9cdd1" stroke="#8a8f94"/>`;
    s += `<rect x="70" y="22" width="26" height="26" fill="#262626" transform="rotate(45 83 35)"/>`;
    s += `<text x="125" y="38" fill="#fff" font-size="9" font-weight="bold" font-family="Arial">NANO</text>`;
    s += `<rect x="40" y="26" width="10" height="8" fill="#d8d8d8"/><circle cx="45" cy="30" r="2.5" fill="#c62828"/>`;
    s += `<text x="55" y="25" fill="#fff" font-size="4">L</text><text x="55" y="45" fill="#fff" font-size="4">TX RX</text>`;
    s += headersFor(b.pins);
    for (const p of b.pins) {
      const top = p.y < 30;
      s += `<text x="${p.x}" y="${top ? p.y + 8 : p.y - 6}" fill="#fff" font-size="3.6" text-anchor="${top ? 'end' : 'start'}" transform="rotate(-90 ${p.x} ${top ? p.y + 8 : p.y - 6})">${esc(p.label)}</text>`;
    }
    return s;
  }

  function boardDyn(boardId, sim) {
    const on = !!sim;
    const L = sim ? sim.boardLed : 0;
    const tx = sim && sim.txLed;
    if (boardId === 'nano') {
      return `<rect x="59" y="21" width="5" height="3" fill="${L ? '#ffb300' : '#6b5a2a'}"/>` + (L ? `<circle cx="61.5" cy="22.5" r="5" fill="#ffb300" opacity="0.4"/>` : '') +
        `<rect x="59" y="47" width="5" height="3" fill="${tx ? '#ffb300' : '#6b5a2a'}"/>` +
        `<rect x="150" y="47" width="5" height="3" fill="${on ? '#2dff4a' : '#2f6b3a'}"/>`;
    }
    const onX = boardId === 'mega' ? 320 : 226;
    return `<rect x="76" y="40" width="7" height="4" fill="${L ? '#ffb300' : '#6b5a2a'}"/>` + (L ? `<circle cx="79.5" cy="42" r="7" fill="#ffb300" opacity="${0.25 + 0.4 * L}"/>` : '') +
      `<rect x="76" y="50" width="7" height="4" fill="${tx ? '#ffb300' : '#6b5a2a'}"/>` +
      `<rect x="76" y="60" width="7" height="4" fill="#6b5a2a"/>` +
      `<rect x="${onX}" y="90" width="7" height="4" fill="${on ? '#2dff4a' : '#2f6b3a'}"/>` + (on ? `<circle cx="${onX + 3.5}" cy="92" r="6" fill="#2dff4a" opacity="0.35"/>` : '');
  }

  /* ---------------------------------------------------------------- plaque d'essai */
  function breadboardArt() {
    const BB = PARTS.BB;
    let s = `<rect x="0" y="0" width="${BB.w}" height="${BB.h}" rx="4" fill="#f4f4f2" stroke="#cfcfca"/>`;
    s += `<rect x="4" y="100" width="${BB.w - 8}" height="10" fill="#e3e3df"/>`;
    s += `<line x1="12" y1="4" x2="${BB.w - 12}" y2="4" stroke="#e53935" stroke-width="1"/><line x1="12" y1="26" x2="${BB.w - 12}" y2="26" stroke="#1e63d6" stroke-width="1"/>`;
    s += `<line x1="12" y1="174" x2="${BB.w - 12}" y2="174" stroke="#e53935" stroke-width="1"/><line x1="12" y1="196" x2="${BB.w - 12}" y2="196" stroke="#1e63d6" stroke-width="1"/>`;
    s += `<text x="6" y="12" fill="#e53935" font-size="7">+</text><text x="6" y="23" fill="#1e63d6" font-size="8">−</text>`;
    s += `<text x="6" y="182" fill="#e53935" font-size="7">+</text><text x="6" y="193" fill="#1e63d6" font-size="8">−</text>`;
    for (const p of PARTS.BB_PINS) s += `<rect x="${p.x - 1.8}" y="${p.y - 1.8}" width="3.6" height="3.6" fill="#555" rx="0.5"/>`;
    for (let c = 1; c <= BB.cols; c += (c === 1 ? 4 : 5)) s += `<text x="${BB.x0 + (c - 1) * 10}" y="44" fill="#999" font-size="4.5" text-anchor="middle">${c}</text>`;
    'abcdefghij'.split('').forEach((r, i) => {
      const y = (i < 5 ? BB.rowsTop[i] : BB.rowsBot[i - 5]) + 1.6;
      s += `<text x="10" y="${y}" fill="#999" font-size="4.5" text-anchor="middle">${r}</text><text x="${BB.w - 8}" y="${y}" fill="#999" font-size="4.5" text-anchor="middle">${r}</text>`;
    });
    return s;
  }

  /* ---------------------------------------------------------------- composants de base */
  const BAND = ['#000', '#7b3f00', '#e00', '#f80', '#fd0', '#0a0', '#00e', '#90f', '#888', '#fff'];
  function resistorBands(ohms) {
    ohms = Math.max(1, Math.round(ohms));
    let exp = 0;
    let v = ohms;
    while (v >= 100) { v = v / 10; exp++; }
    v = Math.round(v);
    if (v >= 100) { v = 10; exp++; }
    const d1 = Math.floor(v / 10), d2 = v % 10;
    return [BAND[d1], BAND[d2], BAND[Math.min(9, exp)], '#c9a227'];
  }
  function resistorArt(comp) {
    const ohms = +(comp.props && comp.props.ohms) || 220;
    const bands = resistorBands(ohms);
    return `<line x1="0" y1="0" x2="40" y2="0" stroke="#9e9e9e" stroke-width="1.6"/>` +
      `<rect x="8" y="-4.5" width="24" height="9" rx="4" fill="#e3c9a0" stroke="#b39466" stroke-width="0.6"/>` +
      bands.map((c, i) => `<rect x="${11.5 + i * 4.6 + (i === 3 ? 2 : 0)}" y="-4.3" width="2.4" height="8.6" fill="${c}"/>`).join('');
  }
  function ledArt(comp) {
    const col = (comp.def.props || {}).color || 'red';
    return `<path d="M0 0 V-14 M10 0 V-12" stroke="#a5a5a5" stroke-width="1.6" fill="none"/>` +
      `<path d="M-3 -14 h16 v-2 h-16z" fill="${LED_OFF[col]}"/>` +
      `<path d="M-1.5 -16 v-10 a6.5 6.5 0 0 1 13 0 v10z" fill="${LED_OFF[col]}" fill-opacity="0.9" stroke="#0002"/>` +
      `<text x="-3" y="-2" font-size="5" fill="#666">+</text>`;
  }
  function ledDyn(comp) {
    const col = (comp.def.props || {}).color || 'red';
    const b = comp.rt && comp.rt.bright ? comp.rt.bright[0] : 0;
    if (comp.rt && comp.rt.burned) return `<path d="M-1.5 -16 v-10 a6.5 6.5 0 0 1 13 0 v10z" fill="#3a3a3a"/><path d="M-2 -32 l14 18 M12 -32 l-14 18" stroke="#ff5722" stroke-width="1.8"/>`;
    if (!b) return '';
    return `<path d="M-1.5 -16 v-10 a6.5 6.5 0 0 1 13 0 v10z" fill="${LED_COL[col]}" opacity="${0.35 + 0.65 * b}"/>` +
      `<circle cx="5" cy="-24" r="${10 + 8 * b}" fill="${LED_COL[col]}" opacity="${0.25 * b}"/>`;
  }
  function rgbledArt() {
    return `<path d="M0 0 V-14 M10 0 V-17 M20 0 V-14 M30 0 V-14" stroke="#a5a5a5" stroke-width="1.6" fill="none"/>` +
      `<path d="M3 -17 v-12 a12 10 0 0 1 24 0 v12z" fill="#f2f2f2" fill-opacity="0.85" stroke="#bbb"/>` +
      `<text x="-1" y="5" font-size="4" fill="#c00">R</text><text x="9" y="5" font-size="4" fill="#333">−</text><text x="19" y="5" font-size="4" fill="#0a0">V</text><text x="29" y="5" font-size="4" fill="#00c">B</text>`;
  }
  function rgbledDyn(comp) {
    if (comp.rt && comp.rt.burned) return `<path d="M3 -17 v-12 a12 10 0 0 1 24 0 v12z" fill="#333"/>`;
    const b = (comp.rt && comp.rt.bright) || [0, 0, 0];
    if (!b[0] && !b[1] && !b[2]) return '';
    const c = [Math.round(255 * b[0]), Math.round(255 * b[1]), Math.round(255 * b[2])];
    const m = Math.max(...b);
    return `<path d="M3 -17 v-12 a12 10 0 0 1 24 0 v12z" fill="${rgb(c)}" opacity="${0.4 + 0.6 * m}"/><circle cx="15" cy="-27" r="${12 + 8 * m}" fill="${rgb(c)}" opacity="${0.3 * m}"/>`;
  }
  function pushbuttonArt() {
    return `<rect x="-3" y="-3" width="26" height="36" rx="2" fill="#333" stroke="#111"/>` +
      `<path d="M0 0 h-4 M20 0 h4 M0 30 h-4 M20 30 h4" stroke="#aaa" stroke-width="1.4"/>`;
  }
  function pushbuttonDyn(comp) {
    const p = comp.rt && comp.rt.pressed;
    return `<circle cx="10" cy="15" r="${p ? 8 : 9}" fill="${p ? '#5d4037' : '#795548'}" stroke="#3e2723" class="press"/>`;
  }
  function slideswitchArt() {
    return `<rect x="-6" y="-18" width="32" height="14" rx="2" fill="#424242"/><path d="M0 0 V-4 M10 0 V-4 M20 0 V-4" stroke="#aaa" stroke-width="1.6"/>`;
  }
  function slideswitchDyn(comp) {
    const r = comp.sim && comp.sim.right;
    return `<rect x="${r ? 11 : -1}" y="-16" width="10" height="10" rx="1.5" fill="#e0e0e0" class="press"/>`;
  }
  function potArt() {
    return `<path d="M0 0 V-6 M10 0 V-6 M20 0 V-6" stroke="#aaa" stroke-width="1.6"/>` +
      `<rect x="-8" y="-38" width="36" height="32" rx="3" fill="#1565c0" stroke="#0d47a1"/>`;
  }
  function potDyn(comp) {
    const v = comp.sim ? comp.sim.value : 50;
    const ang = -135 + 270 * v / 100;
    return `<g transform="rotate(${ang} 10 -22)"><circle cx="10" cy="-22" r="11" fill="#e0e0e0" stroke="#9e9e9e"/><rect x="9" y="-33" width="2" height="8" fill="#424242"/></g>`;
  }
  function ldrArt() {
    return `<path d="M0 0 V-12 M10 0 V-12" stroke="#aaa" stroke-width="1.6"/><circle cx="5" cy="-18" r="8" fill="#ef6c00" stroke="#bf360c"/>` +
      `<path d="M0 -22 h3 v3 h4 v3 h-4 v3 h3" stroke="#ffe0b2" stroke-width="1" fill="none"/>`;
  }
  function ntcArt() {
    return `<path d="M0 0 V-12 M10 0 V-12" stroke="#aaa" stroke-width="1.6"/><ellipse cx="5" cy="-18" rx="6" ry="8" fill="#5d4037"/><text x="5" y="-16" font-size="4" fill="#fff" text-anchor="middle">CTN</text>`;
  }
  function piezoArt() {
    return `<path d="M0 0 V-8 M20 0 V-8" stroke="#aaa" stroke-width="1.6"/><circle cx="10" cy="-20" r="15" fill="#212121"/><circle cx="10" cy="-20" r="3" fill="#000"/><text x="-4" y="-2" font-size="5" fill="#c00">+</text>`;
  }
  function soundDyn(freq, cx, cy) {
    if (!freq) return '';
    return `<g opacity="0.8"><path d="M${cx + 16} ${cy - 8} q6 8 0 16 M${cx + 22} ${cy - 12} q9 12 0 24" stroke="#ff9800" stroke-width="1.6" fill="none"/>` +
      `<text x="${cx}" y="${cy - 20}" font-size="6" fill="#e65100" text-anchor="middle">${Math.round(freq)} Hz</text></g>`;
  }
  function servoArt(comp, grove) {
    if (grove) return '';
    return `<path d="M0 0 V-8 M10 0 V-8 M20 0 V-8" stroke-width="2" stroke="#795548"/><path d="M10 0 V-8" stroke="#e53935" stroke-width="2"/><path d="M20 0 V-8" stroke="#ff9800" stroke-width="2"/>` +
      `<rect x="-2" y="-12" width="24" height="5" fill="#222"/>` +
      `<rect x="-30" y="-58" width="80" height="40" rx="3" fill="#1e88e5" stroke="#0d47a1"/><rect x="-36" y="-48" width="92" height="6" rx="2" fill="#1976d2"/>` +
      `<text x="10" y="-22" font-size="6" fill="#e3f2fd" text-anchor="middle">SERVO</text>`;
  }
  function servoDyn(comp, cx, cy) {
    const a = comp.rt && comp.rt.angle !== undefined ? comp.rt.angle : 90;
    return `<g transform="rotate(${a - 90} ${cx} ${cy})"><path d="M${cx - 4} ${cy} L${cx} ${cy - 30} L${cx + 4} ${cy} z" fill="#fafafa" stroke="#9e9e9e"/><circle cx="${cx}" cy="${cy}" r="7" fill="#fafafa" stroke="#9e9e9e"/></g>` +
      `<text x="${cx + 26}" y="${cy + 4}" font-size="6" fill="#333">${Math.round(a)}°</text>`;
  }
  function dcmotorArt() {
    return `<path d="M0 0 V-10 M20 0 V-10" stroke="#aaa" stroke-width="1.6"/><rect x="-14" y="-46" width="48" height="36" rx="10" fill="#9e9e9e" stroke="#616161"/><rect x="34" y="-31" width="10" height="5" fill="#bdbdbd"/>`;
  }
  function dcmotorDyn(comp) {
    comp.rt.ang = ((comp.rt.ang || 0) + (comp.rt.motor || 0) * 600) % 360;
    return `<g transform="rotate(${comp.rt.ang} 10 -28)"><rect x="9" y="-40" width="2" height="24" fill="#424242"/></g>` +
      (Math.abs(comp.rt.motor || 0) > 0.005 ? `<text x="10" y="-50" font-size="6" text-anchor="middle" fill="#333">${Math.round(Math.abs(comp.rt.motor) * 1000)} mA</text>` : '');
  }
  function hcsr04Art() {
    let s = `<path d="M0 0 V-8 M10 0 V-8 M20 0 V-8 M30 0 V-8" stroke="#aaa" stroke-width="1.6"/>`;
    s += `<rect x="-40" y="-52" width="110" height="44" rx="3" fill="#1565c0" stroke="#0d47a1"/>`;
    for (const cx of [-14, 44]) s += `<circle cx="${cx}" cy="-30" r="17" fill="#bdbdbd" stroke="#757575"/><circle cx="${cx}" cy="-30" r="12" fill="#424242"/>`;
    s += `<text x="15" y="-12" font-size="5" fill="#fff" text-anchor="middle">HC-SR04</text>`;
    s += ['VCC', 'Trig', 'Echo', 'GND'].map((l, i) => `<text x="${i * 10}" y="7" font-size="3.5" fill="#333" text-anchor="middle">${l}</text>`).join('');
    return s;
  }

  function diodeArt() {
    return `<line x1="0" y1="0" x2="40" y2="0" stroke="#9e9e9e" stroke-width="1.6"/>` +
      `<rect x="10" y="-4" width="20" height="8" rx="1.5" fill="#212121"/><rect x="25" y="-4" width="3" height="8" fill="#cfd8dc"/>`;
  }
  function npnArt() {
    return `<path d="M0 0 V-8 M10 0 V-8 M20 0 V-8" stroke="#a5a5a5" stroke-width="1.6"/>` +
      `<path d="M-4 -8 h28 v-8 a14 12 0 0 0 -28 0z" fill="#212121"/>` +
      `<text x="10" y="-12" font-size="4" fill="#bbb" text-anchor="middle">2N2222</text>` +
      `<text x="0" y="6" font-size="4" fill="#333" text-anchor="middle">E</text><text x="10" y="6" font-size="4" fill="#333" text-anchor="middle">B</text><text x="20" y="6" font-size="4" fill="#333" text-anchor="middle">C</text>`;
  }
  function npnDyn(comp) {
    if (comp.rt && comp.rt.burned) return `<path d="M-2 -28 l24 22 M22 -28 l-24 22" stroke="#ff5722" stroke-width="1.8"/>`;
    return '';
  }
  // segments de l'afficheur : a b c d e f g (et le point) dans un boîtier de 40 × 60
  const SEG7 = [[6, -16, 18, 3.5], [24.5, -14.5, 3.5, 17], [24.5, 5.5, 3.5, 17], [6, 23, 18, 3.5], [2, 5.5, 3.5, 17], [2, -14.5, 3.5, 17], [6, 3.3, 18, 3.5]];
  function sevensegArt(comp) {
    let s = `<rect x="-7" y="-22" width="54" height="74" rx="2" fill="#2b2b2b" stroke="#111"/>`;
    s += `<g transform="translate(5 0)">` + SEG7.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="#4a1f1f"/>`).join('') +
      `<circle cx="33" cy="25" r="2.2" fill="#4a1f1f"/></g>`;
    s += ['g', 'f', '−', 'a', 'b'].map((l, i) => `<text x="${i * 10}" y="-24" font-size="4" fill="#555" text-anchor="middle">${l}</text>`).join('');
    s += ['e', 'd', '−', 'c', '.'].map((l, i) => `<text x="${i * 10}" y="58" font-size="4" fill="#555" text-anchor="middle">${l}</text>`).join('');
    return s;
  }
  function sevensegDyn(comp) {
    if (comp.rt && comp.rt.burned) return `<path d="M-4 -18 l48 64 M44 -18 l-48 64" stroke="#ff5722" stroke-width="2"/>`;
    const b = (comp.rt && comp.rt.bright) || [];
    let s = '<g transform="translate(5 0)">';
    SEG7.forEach(([x, y, w, h], i) => { if (b[i] > 0.02) s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="#ff2a2a" opacity="${0.4 + 0.6 * b[i]}"/>`; });
    if (b[7] > 0.02) s += `<circle cx="33" cy="25" r="2.2" fill="#ff2a2a"/>`;
    return s + '</g>';
  }
  function multimeterArt() {
    let s = `<rect x="-30" y="-150" width="100" height="140" rx="10" fill="#f9a825" stroke="#c17900"/>`;
    s += `<rect x="-20" y="-140" width="80" height="34" rx="3" fill="#cfd8b0" stroke="#7a8060"/>`;
    s += `<circle cx="20" cy="-70" r="22" fill="#424242"/><circle cx="20" cy="-70" r="16" fill="#616161"/>`;
    s += `<text x="20" y="-98" font-size="6" text-anchor="middle" fill="#3e2723">V⎓</text><text x="44" y="-66" font-size="6" fill="#3e2723">mA</text>`;
    s += [['A', 0], ['COM', 20], ['V', 40]].map(([l, x]) => `<circle cx="${x}" cy="-20" r="5" fill="${l === 'COM' ? '#212121' : '#c62828'}"/><text x="${x}" y="-29" font-size="5" text-anchor="middle" fill="#3e2723">${l}</text>`).join('');
    s += `<path d="M0 -15 V0 M20 -15 V0 M40 -15 V0" stroke="#555" stroke-width="1.5"/>`;
    return s;
  }
  function multimeterDyn(comp, running) {
    const mode = (comp.sim && comp.sim.mode) || 'V';
    let txt = '- - -';
    if (running && comp.rt) {
      if (mode === 'V' && comp.rt.volts !== undefined) txt = comp.rt.volts.toFixed(2) + ' V';
      if (mode === 'A' && comp.rt.amps !== undefined) txt = (comp.rt.amps * 1000).toFixed(1) + ' mA';
    }
    const ang = mode === 'V' ? -60 : 60;
    return `<text x="20" y="-115" font-size="15" font-family="Consolas, monospace" text-anchor="middle" fill="#263238">${txt}</text>` +
      `<g transform="rotate(${ang} 20 -70)"><rect x="18.5" y="-90" width="3" height="18" fill="#fafafa"/></g>`;
  }

  /* ---------------------------------------------------------------- modules Grove */
  const ICONS = {
    button: '<circle cx="0" cy="0" r="11" fill="#424242"/><circle cx="0" cy="0" r="7.5" fill="#212121"/>',
    ledbutton: '<circle cx="0" cy="0" r="13" fill="#b71c1c"/><circle cx="0" cy="0" r="9" fill="#e53935"/>',
    switch: '<rect x="-12" y="-7" width="24" height="14" rx="2" fill="#424242"/><rect x="-10" y="-5" width="10" height="10" fill="#e0e0e0"/>',
    touch: '<circle cx="0" cy="0" r="13" fill="none" stroke="#ffd54f" stroke-width="2"/><circle cx="0" cy="0" r="7" fill="#ffd54f"/>',
    tilt: '<rect x="-5" y="-12" width="10" height="24" rx="5" fill="#9e9e9e"/><circle cx="0" cy="6" r="3.5" fill="#616161"/>',
    collision: '<rect x="-12" y="-6" width="24" height="12" fill="#eceff1"/><path d="M-12 -6 L14 -14" stroke="#cfd8dc" stroke-width="3"/>',
    magnet: '<path d="M-10 10 V-3 a10 10 0 0 1 20 0 V10 h-6 V-3 a4 4 0 0 0 -8 0 V10z" fill="#e53935"/><rect x="-10" y="6" width="6" height="4" fill="#cfd8dc"/><rect x="4" y="6" width="6" height="4" fill="#cfd8dc"/>',
    pir: '<circle cx="0" cy="0" r="16" fill="#fafafa" stroke="#bdbdbd"/><path d="M-11 -5 h22 M-12 2 h24 M-10 9 h20" stroke="#e0e0e0"/>',
    ir: '<rect x="-12" y="-7" width="10" height="14" rx="2" fill="#263238"/><rect x="2" y="-7" width="10" height="14" rx="2" fill="#4a148c"/>',
    vibration: '<rect x="-8" y="-8" width="16" height="16" rx="8" fill="#9e9e9e"/><path d="M-14 -6 q-3 6 0 12 M14 -6 q3 6 0 12" stroke="#ff9800" fill="none"/>',
    flame: '<path d="M0 -14 C8 -4 10 4 0 12 C-10 4 -8 -4 0 -14z" fill="#ff7043"/><path d="M0 -4 C4 1 4 5 0 9 C-4 5 -4 1 0 -4z" fill="#ffee58"/>',
    water: '<path d="M0 -14 C8 -2 9 4 0 10 C-9 4 -8 -2 0 -14z" fill="#4fc3f7"/>',
    heart: '<path d="M0 10 L-11 -1 a6 6 0 0 1 11 -8 a6 6 0 0 1 11 8z" fill="#e53935"/>',
    chip: '<rect x="-10" y="-10" width="20" height="20" fill="#212121"/><text x="0" y="3" font-size="6" fill="#aaa" text-anchor="middle">IC</text>',
    knob: '<circle cx="0" cy="0" r="14" fill="#e0e0e0" stroke="#9e9e9e"/><rect x="-1.5" y="-14" width="3" height="10" fill="#424242"/>',
    slider: '<rect x="-24" y="-3" width="48" height="6" rx="3" fill="#424242"/><rect x="-4" y="-9" width="8" height="18" rx="2" fill="#e0e0e0"/>',
    light: '<circle cx="0" cy="0" r="9" fill="#ef6c00"/><path d="M-4 -4 h3 v3 h3 v3 h-3 v3" stroke="#ffe0b2" fill="none"/>',
    sound: '<circle cx="0" cy="0" r="10" fill="#9e9e9e" stroke="#616161"/><circle cx="0" cy="0" r="4" fill="#424242"/>',
    thermo: '<rect x="-3" y="-14" width="6" height="20" rx="3" fill="#eceff1" stroke="#90a4ae"/><circle cx="0" cy="9" r="5" fill="#e53935"/>',
    moisture: '<path d="M-8 -14 V12 M8 -14 V12" stroke="#ffd54f" stroke-width="5"/>',
    sun: '<circle cx="0" cy="0" r="7" fill="#fdd835"/><path d="M0 -14 V-10 M0 10 V14 M-14 0 H-10 M10 0 H14" stroke="#fdd835" stroke-width="2"/>',
    gas: '<circle cx="0" cy="0" r="14" fill="#b0bec5" stroke="#78909c"/><circle cx="0" cy="0" r="9" fill="none" stroke="#546e7a" stroke-dasharray="2 2"/>',
    flex: '<path d="M-14 8 Q0 -16 14 8" stroke="#616161" stroke-width="4" fill="none"/>',
    force: '<circle cx="0" cy="0" r="12" fill="#cfd8dc" stroke="#78909c"/><circle cx="0" cy="0" r="6" fill="#eceff1"/>',
    hand: '<path d="M-8 10 V-6 M-3 10 V-12 M2 10 V-11 M7 10 V-7" stroke="#ffcc80" stroke-width="4" stroke-linecap="round"/>',
    bolt: '<path d="M2 -14 L-8 2 H0 L-3 14 L8 -3 H0z" fill="#fdd835"/>',
    joystick: '<circle cx="0" cy="0" r="16" fill="#424242"/><circle cx="0" cy="0" r="9" fill="#212121"/>',
    ultrasonic: '',
    dht: '<rect x="-11" y="-14" width="22" height="28" rx="2" fill="#29b6f6"/><path d="M-7 -9 h14 M-7 -4 h14 M-7 1 h14 M-7 6 h14" stroke="#0288d1"/>',
    baro: '<rect x="-7" y="-7" width="14" height="14" fill="#cfd8dc" stroke="#78909c"/><circle cx="3" cy="-3" r="1.4" fill="#37474f"/>',
    accel: '<rect x="-7" y="-7" width="14" height="14" fill="#212121"/><path d="M0 0 h12 M0 0 v-12 M0 0 l-8 8" stroke="#ff9800" stroke-width="1.5"/>',
    color: '<circle cx="0" cy="0" r="8" fill="#fff"/><circle cx="-3" cy="-2" r="3" fill="#e53935"/><circle cx="3" cy="-2" r="3" fill="#43a047"/><circle cx="0" cy="3" r="3" fill="#1e88e5"/>',
    clock: '<circle cx="0" cy="0" r="12" fill="#fafafa" stroke="#9e9e9e"/><path d="M0 0 V-8 M0 0 H6" stroke="#424242" stroke-width="1.5"/>',
    rfid: '<rect x="-16" y="-10" width="32" height="20" rx="3" fill="none" stroke="#ffd54f" stroke-width="2"/>',
    keypad: '<g fill="#eceff1">' + [0, 1, 2, 3].map(r => [0, 1, 2].map(c => `<rect x="${-12 + c * 9}" y="${-16 + r * 8}" width="7" height="6" rx="1"/>`).join('')).join('') + '</g>',
    led: '',
    buzzer: '<circle cx="0" cy="0" r="14" fill="#212121"/><circle cx="0" cy="0" r="3" fill="#000"/>',
    speaker: '<circle cx="0" cy="0" r="15" fill="#424242"/><circle cx="0" cy="0" r="9" fill="#616161"/><circle cx="0" cy="0" r="3" fill="#212121"/>',
    relay: '<rect x="-16" y="-12" width="32" height="24" rx="2" fill="#1e88e5"/><text x="0" y="2" font-size="5" fill="#fff" text-anchor="middle">RELAIS</text>',
    fan: '',
    laser: '<rect x="-14" y="-5" width="24" height="10" rx="2" fill="#b0bec5"/><circle cx="12" cy="0" r="3" fill="#e53935"/>',
    servo: '<rect x="-16" y="-10" width="32" height="20" rx="2" fill="#1e88e5"/>',
    motor: '<rect x="-60" y="-10" width="120" height="20" fill="#212121"/>',
    rgb: '',
    hub: '<rect x="-16" y="-8" width="32" height="16" fill="#f3efe2"/>',
    radio: '<path d="M-10 6 a14 14 0 0 1 20 0 M-6 2 a8 8 0 0 1 12 0" stroke="#fff" fill="none" stroke-width="2"/><circle cx="0" cy="8" r="2" fill="#fff"/>'
  };

  function groveBase(w, h, name, small) {
    let s = `<rect x="0" y="0" width="${w}" height="${h}" rx="5" fill="#1d5fa8" stroke="#123f72" stroke-width="1"/>`;
    for (const [x, y] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]]) s += `<circle cx="${x}" cy="${y}" r="3.6" fill="#fff" stroke="#c9c9c9"/>`;
    s += `<text x="${w / 2}" y="${small ? 12 : 13}" fill="#e3f2fd" font-size="${small ? 5.5 : 6.5}" text-anchor="middle" font-family="Arial" font-weight="bold">${esc(name)}</text>`;
    return s;
  }
  function groveConnector(g) {
    const a = g.groveAnchor;
    return `<g class="grove-conn"><rect x="${a.x - 20}" y="${a.y - 6}" width="40" height="13" rx="1.5" fill="#f3efe2" stroke="#9e9a8c"/>` +
      ['#222', '#e53935', '#f5f5f5', '#fdd835'].map((c, i) => `<rect x="${a.x - 16.5 + i * 10}" y="${a.y - 2}" width="3" height="3" fill="${c}" stroke="#555" stroke-width="0.3"/>`).join('') +
      `</g>` + g.pins.map(p => `<text x="${p.x}" y="${p.y + 6}" font-size="3" fill="#fff" text-anchor="middle">${p.label}</text>`).join('');
  }
  function shortName(def) {
    return def.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  }

  function groveArt(comp, g) {
    const def = comp.def;
    const w = g.w, h = g.h;
    let s = groveBase(w, h, shortName(def), shortName(def).length > 16);
    const cx = w / 2, cy = h / 2 - 2;
    if (def.icon === 'ultrasonic') {
      for (const x of [cx - 32, cx + 32]) s += `<circle cx="${x}" cy="${cy}" r="22" fill="#bdbdbd" stroke="#757575"/><circle cx="${x}" cy="${cy}" r="16" fill="#424242"/>`;
    } else if (def.icon === 'motor') {
      s += `<rect x="${cx - 40}" y="${cy - 14}" width="80" height="28" fill="#212121"/><text x="${cx}" y="${cy + 3}" font-size="6" fill="#ccc" text-anchor="middle">L298 · M1 M2</text>`;
    } else if (def.draw === 'servo' || def.kind === 'servo') {
      s += `<rect x="${cx - 26}" y="${cy - 14}" width="52" height="28" rx="2" fill="#1565c0" stroke="#0d47a1"/>`;
    } else if (ICONS[def.icon] !== undefined && ICONS[def.icon] !== '') {
      s += `<g transform="translate(${cx} ${cy})">${ICONS[def.icon]}</g>`;
    }
    s += groveConnector(g);
    return s;
  }

  function groveDyn(comp, g, running) {
    const def = comp.def, rt = comp.rt || {}, sim = comp.sim || {};
    const w = g.w, h = g.h, cx = w / 2, cy = h / 2 - 2;
    let s = '';
    switch (def.kind) {
      case 'pwm': case 'dout': {
        if (def.icon === 'led') {
          const col = (def.props && def.props.color) || 'red';
          const b = rt.bright || 0;
          s += `<path d="M${cx - 9} ${cy + 10} v-12 a9 9 0 0 1 18 0 v12z" fill="${b > 0.02 ? LED_COL[col] : LED_OFF[col]}" opacity="${b > 0.02 ? 0.45 + 0.55 * b : 0.9}" stroke="#0003"/>`;
          if (b > 0.02) s += `<circle cx="${cx}" cy="${cy - 2}" r="${16 + 10 * b}" fill="${LED_COL[col]}" opacity="${0.3 * b}"/>`;
        } else if (def.icon === 'fan') {
          rt.ang = ((rt.ang || 0) + (rt.bright || 0) * 40) % 360;
          s += `<g transform="rotate(${rt.ang} ${cx} ${cy})">` + [0, 120, 240].map(a => `<ellipse cx="${cx}" cy="${cy - 11}" rx="5" ry="11" fill="#90caf9" transform="rotate(${a} ${cx} ${cy})"/>`).join('') + `<circle cx="${cx}" cy="${cy}" r="4" fill="#1565c0"/></g>`;
        } else {
          s += `<circle cx="${w - 16}" cy="${h - 26}" r="3.5" fill="${rt.on ? '#ff5252' : '#5d2a2a'}"/>`;
          if (rt.on) s += `<circle cx="${w - 16}" cy="${h - 26}" r="7" fill="#ff5252" opacity="0.35"/>`;
          if (def.icon === 'vibration' && rt.on) s += `<path d="M${cx - 20} ${cy - 8} q-4 8 0 16 M${cx + 20} ${cy - 8} q4 8 0 16" stroke="#ffeb3b" fill="none" stroke-width="2"/>`;
        }
        break;
      }
      case 'buzzer': s += soundDyn(rt.freq, cx, cy); break;
      case 'din': {
        const act = !!rt.active;
        s += `<circle cx="${w - 16}" cy="${h - 26}" r="3.5" fill="${act ? '#76ff03' : '#33521a'}"/>`;
        if (act && ['button', 'ledbutton'].includes(def.icon)) s += `<circle cx="${cx}" cy="${cy}" r="${def.icon === 'ledbutton' ? 9 : 7}" fill="#000" opacity="0.35"/>`;
        if (def.blocks.includes('dout2') && rt.led) s += `<circle cx="${cx}" cy="${cy}" r="12" fill="#ff8a80" opacity="0.8"/>`;
        if (running) s += `<text x="${cx}" y="${h - 18}" font-size="5" fill="#ffeb3b" text-anchor="middle">${act ? esc(def.sim.action) + ' ✓' : 'cliquer'}</text>`;
        break;
      }
      case 'ain': {
        if (def.icon === 'knob') s += `<g transform="rotate(${-150 + 300 * (sim.value - sim.min) / (sim.max - sim.min)} ${cx} ${cy})"><rect x="${cx - 1.5}" y="${cy - 14}" width="3" height="10" fill="#d32f2f"/></g>`;
        s += `<text x="${cx}" y="${h - 18}" font-size="6" fill="#ffeb3b" text-anchor="middle">${fmt(sim.value)} ${esc(sim.unit || '')}</text>`;
        break;
      }
      case 'ultrasonic': s += `<text x="${cx}" y="${h - 16}" font-size="6.5" fill="#ffeb3b" text-anchor="middle">${fmt(sim.value)} cm</text>`; break;
      case 'dht': case 'thi2c': s += `<text x="${cx}" y="${h - 16}" font-size="5.5" fill="#ffeb3b" text-anchor="middle">${fmt(sim.temp)}°C ${fmt(sim.hum)}%</text>`; break;
      case 'baro': s += `<text x="${cx}" y="${h - 16}" font-size="5.5" fill="#ffeb3b" text-anchor="middle">${fmt(sim.pressure)} hPa ${fmt(sim.temp)}°C</text>`; break;
      case 'accel': s += `<text x="${cx}" y="${h - 16}" font-size="5" fill="#ffeb3b" text-anchor="middle">x${fmt(sim.x)} y${fmt(sim.y)} z${fmt(sim.z)} g</text>`; break;
      case 'i2cval': s += `<text x="${cx}" y="${h - 16}" font-size="6" fill="#ffeb3b" text-anchor="middle">${fmt(sim.value)} ${esc(sim.unit)}</text>`; break;
      case 'color': s += `<rect x="${cx + 18}" y="${cy - 8}" width="14" height="14" fill="${rgb([sim.r, sim.g, sim.b])}" stroke="#fff"/>`; break;
      case 'irtemp': s += `<text x="${cx}" y="${h - 16}" font-size="5.5" fill="#ffeb3b" text-anchor="middle">${fmt(sim.obj)}°C</text>`; break;
      case 'co2': s += `<text x="${cx}" y="${h - 16}" font-size="5.5" fill="#ffeb3b" text-anchor="middle">${fmt(sim.co2)} ppm</text>`; break;
      case 'joystick': {
        const x = ((rt.pressed ? 512 : sim.x) - 512) / 512 * 6, y = (sim.y - 512) / 512 * 6;
        s += `<circle cx="${cx + x}" cy="${cy - y}" r="9" fill="#616161" stroke="#212121"/>`;
        break;
      }
      case 'servo': s += servoDyn(comp, cx + 10, cy); break;
      case 'chain': {
        const c = (rt.leds && rt.leds[0]) || [0, 0, 0];
        const on = c[0] + c[1] + c[2] > 0;
        s += `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" rx="2" fill="${on ? rgb(c) : '#eee'}"/>`;
        if (on) s += `<circle cx="${cx}" cy="${cy}" r="20" fill="${rgb(c)}" opacity="0.35"/>`;
        if (rt.leds && rt.leds.length > 1) s += `<text x="${cx}" y="${h - 16}" font-size="5" fill="#fff" text-anchor="middle">${rt.leds.length} LED chaînées</text>`;
        break;
      }
      case 'motor': {
        const sp = rt.speed || [0, 0];
        rt.ang = rt.ang || [0, 0];
        [0, 1].forEach(i => {
          rt.ang[i] = (rt.ang[i] + sp[i] / 20) % 360;
          const x = i ? w - 30 : 30;
          s += `<g transform="rotate(${rt.ang[i]} ${x} ${cy})"><circle cx="${x}" cy="${cy}" r="14" fill="#424242"/><rect x="${x - 2}" y="${cy - 14}" width="4" height="28" fill="#ffca28"/></g>`;
          s += `<text x="${x}" y="${cy + 24}" font-size="5" fill="#fff" text-anchor="middle">${Math.round(sp[i])}</text>`;
        });
        break;
      }
      case 'mp3': if (rt.mp3 && rt.mp3.playing) s += `<text x="${cx}" y="${h - 16}" font-size="6" fill="#ffeb3b" text-anchor="middle">♪ piste ${rt.mp3.track}</text>`; break;
      case 'rtc': s += `<text x="${cx}" y="${h - 16}" font-size="5.5" fill="#ffeb3b" text-anchor="middle">${new Date(Date.now() + (rt.offset || 0)).toLocaleTimeString('fr-FR')}</text>`; break;
    }
    return s;
  }
  const fmt = v => (v === null || v === undefined ? '–' : (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10));

  /* ---------------------------------------------------------------- afficheurs */
  function lcdArt(comp, g) {
    const w = g.w, h = g.h;
    let s = groveBase(w, h, shortName(comp.def), false);
    s += `<rect x="18" y="20" width="${w - 36}" height="${h - 50}" rx="3" fill="#2b2b2b"/>`;
    s += groveConnector(g);
    return s;
  }
  function lcdDyn(comp, g, running) {
    const w = g.w;
    const l = comp.rt && comp.rt.lcd;
    const rgbOn = comp.def.props.rgb;
    let bg = rgbOn ? '#4a4a4a' : '#123c99';
    let fg = rgbOn ? '#1b1b1b' : '#e8f0ff';
    if (l && running) {
      const c = l.rgb;
      if (rgbOn) {
        bg = c[0] + c[1] + c[2] > 0 ? rgb(c.map(x => Math.round(40 + x * 0.85))) : '#2c2c2c';
      } else if (c[0] + c[1] + c[2] === 0) bg = '#0d1f4d';
    }
    const x0 = 26, y0 = 30, cw = (w - 52) / 16, px = cw / 6;
    let s = `<rect x="${x0 - 4}" y="${y0 - 6}" width="${w - 44}" height="${2 * px * 9 + 16}" fill="${bg}"/>`;
    let d = '', dOff = '';
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 16; c++) {
        const ch = l && running ? l.lines[r][c] : ' ';
        const gx = x0 + c * cw, gy = y0 + r * px * 9.5;
        dOff += `M${gx.toFixed(1)} ${gy.toFixed(1)}h${(px * 5).toFixed(1)}v${(px * 8).toFixed(1)}h${(-px * 5).toFixed(1)}z`;
        if (ch && ch !== ' ') d += glyphPath(ch, gx, gy, px, px * 0.15);
      }
    }
    s += `<path d="${dOff}" fill="#000" opacity="0.07"/><path d="${d}" fill="${fg}"/>`;
    return s;
  }
  function oledArt(comp, g) {
    const w = g.w, h = g.h;
    let s = groveBase(w, h, 'OLED 0,96"', false);
    s += `<rect x="12" y="18" width="${w - 24}" height="${(w - 24) / 2 + 8}" rx="2" fill="#0a0a0a" stroke="#333"/>`;
    s += groveConnector(g);
    return s;
  }
  function oledDyn(comp, g, running) {
    const w = g.w;
    const o = comp.rt && comp.rt.oled;
    if (!o || !running) return '';
    const sw = w - 32, x0 = 16, y0 = 22, px = sw / 128;
    let d = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 16; c++) {
        const ch = o.lines[r][c];
        if (ch && ch !== ' ') d += glyphPath(ch, x0 + (c * 8 + 1) * px, y0 + r * 8 * px, px, px * 0.1);
      }
    }
    if (o.px) {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if (o.px[y * 128 + x]) d += `M${(x0 + x * px).toFixed(1)} ${(y0 + y * px).toFixed(1)}h${px.toFixed(2)}v${px.toFixed(2)}h${(-px).toFixed(2)}z`;
    }
    return `<path d="${d}" fill="#7fd8ff"/>`;
  }

  // segments a b c d e f g d'un chiffre de 7 segments
  function sevenSeg(x, y, segs, onCol, offCol, sz) {
    const L = sz, T = sz * 0.18;
    const S = [
      [x + T, y, L, T], [x + L + T, y + T, T, L], [x + L + T, y + 2 * T + L, T, L], [x + T, y + 2 * L + 2 * T, L, T],
      [x, y + 2 * T + L, T, L], [x, y + T, T, L], [x + T, y + L + T, L, T]
    ];
    return S.map(([a, b, c, d], i) => `<rect x="${a.toFixed(1)}" y="${b.toFixed(1)}" width="${c.toFixed(1)}" height="${d.toFixed(1)}" rx="${(T / 2).toFixed(1)}" fill="${segs & (1 << i) ? onCol : offCol}"/>`).join('');
  }
  function tmArt(comp, g) {
    let s = groveBase(g.w, g.h, '4-Digit Display', false);
    s += `<rect x="14" y="18" width="${g.w - 28}" height="44" rx="2" fill="#1a1a1a"/>`;
    s += groveConnector(g);
    return s;
  }
  function tmDyn(comp, g, running) {
    const t = comp.rt && comp.rt.tm;
    const segs = t && running ? t.segs : [0, 0, 0, 0];
    const bright = t ? 0.45 + 0.08 * t.bright : 1;
    const on = `rgba(255,40,40,${bright})`;
    let s = '';
    for (let i = 0; i < 4; i++) s += sevenSeg(24 + i * 34 + (i > 1 ? 6 : 0), 24, segs[i], on, '#3a1414', 14);
    const colon = t && running && t.colon;
    s += `<circle cx="${g.w / 2}" cy="34" r="2" fill="${colon ? on : '#3a1414'}"/><circle cx="${g.w / 2}" cy="48" r="2" fill="${colon ? on : '#3a1414'}"/>`;
    return s;
  }
  function ledbarArt(comp, g) {
    let s = groveBase(g.w, g.h, 'LED Bar', false);
    s += `<rect x="14" y="20" width="${g.w - 28}" height="30" rx="2" fill="#212121"/>`;
    s += groveConnector(g);
    return s;
  }
  function ledbarDyn(comp, g, running) {
    const lvl = running && comp.rt ? comp.rt.level || 0 : 0;
    let s = '';
    for (let i = 0; i < 10; i++) {
      const col = i === 0 ? '#ff3030' : i < 3 ? '#ffb300' : '#30d630';
      const on = lvl - i >= 1 ? 1 : (lvl - i > 0 ? 0.5 : 0);
      s += `<rect x="${19 + i * 13.3}" y="24" width="9" height="22" rx="1" fill="${on ? col : '#3a3a3a'}" opacity="${on ? 0.5 + on / 2 : 1}"/>`;
    }
    return s;
  }
  function pixelsArt(comp, g) {
    const props = Object.assign({}, comp.def.props, comp.props);
    let s;
    if (props.shape === 'ring') {
      s = `<circle cx="${g.w / 2}" cy="${g.h / 2 - 6}" r="${g.w / 2 - 6}" fill="#1d5fa8" stroke="#123f72"/><circle cx="${g.w / 2}" cy="${g.h / 2 - 6}" r="${g.w / 2 - 30}" fill="#fff"/>`;
    } else {
      s = `<rect x="0" y="4" width="${g.w}" height="${g.h - 18}" rx="3" fill="${props.count >= 30 ? '#f5f5f5' : '#1d5fa8'}" stroke="#999"/>`;
    }
    s += groveConnector(g);
    return s;
  }
  function pixelPositions(comp, g) {
    const props = Object.assign({}, comp.def.props, comp.props);
    const n = props.count;
    const pos = [];
    if (props.shape === 'ring') {
      const R = g.w / 2 - 18, cx = g.w / 2, cy = g.h / 2 - 6;
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + 2 * Math.PI * i / n; pos.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    } else {
      const step = (g.w - 20) / n;
      for (let i = 0; i < n; i++) pos.push([10 + step * (i + 0.5), 22]);
    }
    return pos;
  }
  function pixelsDyn(comp, g, running) {
    const px = (running && comp.rt && comp.rt.pixels) || [];
    return pixelPositions(comp, g).map(([x, y], i) => {
      const c = px[i] || [0, 0, 0];
      const on = c[0] + c[1] + c[2] > 0;
      return `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="1.5" fill="${on ? rgb(c) : '#e8e8e8'}" stroke="#bbb" stroke-width="0.5"/>` +
        (on ? `<circle cx="${x}" cy="${y}" r="9" fill="${rgb(c)}" opacity="0.35"/>` : '');
    }).join('');
  }

  /* ---------------------------------------------------------------- aiguillage */
  function art(comp, circuit) {
    if (comp.type === 'board') return boardArt(circuit.board, circuit.shield);
    const def = comp.def;
    const g = PARTS.geometry(comp, circuit);
    switch (def.draw) {
      case 'breadboard': return breadboardArt();
      case 'resistor': return resistorArt(comp);
      case 'led': return ledArt(comp);
      case 'rgbled': return rgbledArt();
      case 'pushbutton': return pushbuttonArt();
      case 'slideswitch': return slideswitchArt();
      case 'potentiometer': return potArt();
      case 'ldr': return ldrArt();
      case 'ntc': return ntcArt();
      case 'piezo': return piezoArt();
      case 'servo': return servoArt(comp);
      case 'dcmotor': return dcmotorArt();
      case 'hcsr04': return hcsr04Art();
      case 'diode': return diodeArt();
      case 'npn': return npnArt();
      case 'sevenseg': return sevensegArt(comp);
      case 'multimeter': return multimeterArt();
      case 'lcd': return lcdArt(comp, g);
      case 'oled': return oledArt(comp, g);
      case 'tm1637': return tmArt(comp, g);
      case 'ledbar': return ledbarArt(comp, g);
      case 'pixels': return pixelsArt(comp, g);
      default: return groveArt(comp, g);
    }
  }
  function dyn(comp, circuit, sim) {
    const running = !!sim;
    if (comp.type === 'board') return boardDyn(circuit.board, sim);
    const def = comp.def;
    const g = PARTS.geometry(comp, circuit);
    switch (def.draw) {
      case 'led': return ledDyn(comp);
      case 'rgbled': return rgbledDyn(comp);
      case 'pushbutton': return pushbuttonDyn(comp);
      case 'slideswitch': return slideswitchDyn(comp);
      case 'potentiometer': return potDyn(comp);
      case 'piezo': return soundDyn(comp.rt && comp.rt.freq, 10, -20);
      case 'servo': return servoDyn(comp, 10, -38);
      case 'dcmotor': return running ? dcmotorDyn(comp) : '';
      case 'hcsr04': return `<text x="15" y="-56" font-size="6" fill="#1565c0" text-anchor="middle">${fmt(comp.sim && comp.sim.value)} cm</text>`;
      case 'ldr': return `<text x="5" y="-30" font-size="5" fill="#ef6c00" text-anchor="middle">${fmt(comp.sim && comp.sim.value)} %</text>`;
      case 'ntc': return `<text x="5" y="-30" font-size="5" fill="#5d4037" text-anchor="middle">${fmt(comp.sim && comp.sim.value)} °C</text>`;
      case 'npn': return npnDyn(comp);
      case 'sevenseg': return sevensegDyn(comp);
      case 'multimeter': return multimeterDyn(comp, running);
      case 'diode': return '';
      case 'lcd': return lcdDyn(comp, g, running);
      case 'oled': return oledDyn(comp, g, running);
      case 'tm1637': return tmDyn(comp, g, running);
      case 'ledbar': return ledbarDyn(comp, g, running);
      case 'pixels': return pixelsDyn(comp, g, running);
      case 'breadboard': case 'resistor': return '';
      default: return groveDyn(comp, g, running);
    }
  }

  // vignette pour la bibliothèque de composants
  function thumbnail(def) {
    const fake = { id: 'thumb', type: def.type, def, x: 0, y: 0, rot: 0, props: Object.assign({}, def.props), sim: Object.assign({}, def.sim), rt: {} };
    const circuit = { board: 'uno', shield: false };
    const g = PARTS.geometry(fake, circuit);
    const x0 = g.ox || 0, y0 = g.oy || 0;
    const pad = 6;
    return `<svg viewBox="${x0 - pad} ${y0 - pad} ${g.w + 2 * pad} ${g.h + 2 * pad + 6}" xmlns="http://www.w3.org/2000/svg">${art(fake, circuit)}${dyn(fake, circuit, null)}</svg>`;
  }

  root.DRAW = { art, dyn, thumbnail, LED_COL, esc, pixelPositions };
})(this);
