/* Tessera Tribes — vector art library. Every sprite is drawn with Canvas 2D paths in a
   tile-relative space: 100 units = one tile width, (0,0) = the sprite's ground anchor, y grows downward. */
(function (G) {
'use strict';
const TT = G.TT;
const ART = TT.ART = {};
const PI = Math.PI, TAU = PI * 2;

// ---------------------------------------------------------------- color
function rgbOf(c) {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t);
}
const css = c => typeof c === 'string' ? c : '#' + c.toString(16).padStart(6, '0');
const lt = (c, t) => mix(c, 0xffffff, t);
const dk = (c, t) => mix(c, 0x000000, t);
const rgba = (c, a) => { const A = rgbOf(c); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; };
ART.mix = mix; ART.css = css; ART.lt = lt; ART.dk = dk; ART.rgba = rgba;

const INK = 0x2a2140;          // one outline ink for the whole set
const INKS = css(INK);
const LW = 1.5;                // outline weight (units)

// ---------------------------------------------------------------- path helpers
function lg(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(s => gr.addColorStop(s[0], css(s[1]))); return gr; }
function rg(g, x, y, r, stops, fx, fy) { const gr = g.createRadialGradient(fx == null ? x : fx, fy == null ? y : fy, 0, x, y, r); stops.forEach(s => gr.addColorStop(s[0], typeof s[1] === 'string' ? s[1] : css(s[1]))); return gr; }
function fill(g, f) { g.fillStyle = f; g.fill(); }
function stroke(g, s, w) { g.lineWidth = w || LW; g.strokeStyle = s || INKS; g.stroke(); }
function fs(g, f, w) { fill(g, f); stroke(g, INKS, w); }
function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0.01, r), 0, TAU); }
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function poly(g, pts, close) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); if (close !== false) g.closePath(); }
function line(g, x1, y1, x2, y2, c, w) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineCap = 'round'; stroke(g, css(c), w); }
function shadow(g, x, y, rx, ry, a) { ell(g, x, y, rx, ry); g.fillStyle = 'rgba(28,20,52,' + (a == null ? 0.26 : a) + ')'; g.fill(); }
function limb(g, x1, y1, x2, y2, w, c) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
  g.lineWidth = w + LW * 2; g.strokeStyle = INKS; g.stroke();
  g.lineWidth = w; g.strokeStyle = css(c); g.stroke();
}
function limb3(g, x1, y1, xm, ym, x2, y2, w, c) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(xm, ym); g.lineTo(x2, y2);
  g.lineWidth = w + LW * 2; g.strokeStyle = INKS; g.stroke();
  g.lineWidth = w; g.strokeStyle = css(c); g.stroke();
}
ART.h = { lg, rg, fill, stroke, fs, ell, circ, rr, poly, line, shadow, limb };

// ---------------------------------------------------------------- tribe look
const TRIBE_LOOK = {
  verdant:     { skin: 0xe8b88c, hair: 0x6b4426, pants: 0x5a4a32, trim: 0xf3e3a1, roof: 'thatch', wall: 0xe7d2a8 },
  ironpeak:    { skin: 0xdcaa82, hair: 0x3b3038, pants: 0x4a4458, trim: 0xd9dce6, roof: 'slate', wall: 0xc9c3d2 },
  tidecallers: { skin: 0xc68b5e, hair: 0x1f2a36, pants: 0x2f5560, trim: 0xf6efd9, roof: 'stilt', wall: 0xead8b4 },
  emberfolk:   { skin: 0xb5784f, hair: 0x2c1810, pants: 0x5a2c22, trim: 0xffc35a, roof: 'terra', wall: 0xe6c39a },
  frostkin:    { skin: 0xf2d4bf, hair: 0xe9e2d6, pants: 0x5d6b80, trim: 0x8fb4d8, roof: 'snow', wall: 0xa77a52 },
  sunspire:    { skin: 0xa86c44, hair: 0x1b1410, pants: 0x6b4a2a, trim: 0xfff0b8, roof: 'dome', wall: 0xf0dcb0 },
};
ART.look = id => TRIBE_LOOK[id] || TRIBE_LOOK.verdant;
const METAL = 0xc7cfd8, METAL_D = 0x7d8796, WOOD = 0x9a6436, WOOD_D = 0x5e3a1d, GOLD = 0xf2c14e, LEATHER = 0x7a4a2a;

function emblem(g, tribe, x, y, s, c) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = css(c); g.strokeStyle = css(c); g.lineCap = 'round'; g.lineJoin = 'round';
  switch (tribe) {
    case 'verdant': g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(6, -1, 0, 6); g.quadraticCurveTo(-6, -1, 0, -6); g.fill(); g.beginPath(); g.moveTo(0, -4); g.lineTo(0, 7); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke(); break;
    case 'ironpeak': poly(g, [-6, 5, -1, -5, 1.5, -1, 3, -3, 7, 5]); g.fill(); break;
    case 'tidecallers': g.beginPath(); g.moveTo(-7, 2); g.quadraticCurveTo(-3.5, -4, 0, 1); g.quadraticCurveTo(3.5, 6, 7, 0); g.lineWidth = 2.4; g.stroke(); g.beginPath(); g.moveTo(-7, -3); g.quadraticCurveTo(-3.5, -8, 0, -3); g.quadraticCurveTo(3.5, 1, 7, -4); g.lineWidth = 1.6; g.stroke(); break;
    case 'emberfolk': g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-6, 4, -5, -2, -1, -7); g.bezierCurveTo(-1, -3, 2, -3, 1.5, -6); g.bezierCurveTo(6, -2, 6, 4, 0, 6); g.fill(); break;
    case 'frostkin': for (let k = 0; k < 3; k++) { g.save(); g.rotate(k * PI / 3); g.beginPath(); g.moveTo(0, -6.5); g.lineTo(0, 6.5); g.moveTo(-2, -4.5); g.lineTo(0, -3); g.lineTo(2, -4.5); g.moveTo(-2, 4.5); g.lineTo(0, 3); g.lineTo(2, 4.5); g.lineWidth = 1.5; g.stroke(); g.restore(); } break;
    case 'sunspire': circ(g, 0, 0, 3.2); g.fill(); for (let k = 0; k < 8; k++) { const a = k * PI / 4; g.beginPath(); g.moveTo(Math.cos(a) * 4.6, Math.sin(a) * 4.6); g.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); g.lineWidth = 1.6; g.stroke(); } break;
  }
  g.restore();
}
ART.emblem = emblem;

// ---------------------------------------------------------------- humanoid parts
function head(g, x, y, r, L, tribe, opts) {
  opts = opts || {};
  // neck
  rr(g, x - 3, y + r - 3, 6, 5, 2); fs(g, css(dk(L.skin, 0.12)), 1.2);
  circ(g, x, y, r); fs(g, rg(g, x - r * 0.3, y - r * 0.35, r * 1.3, [[0, lt(L.skin, 0.18)], [0.7, L.skin], [1, dk(L.skin, 0.12)]]));
  if (opts.hood) return;
  // face (looking right)
  if (!opts.noFace) {
    g.fillStyle = INKS;
    ell(g, x + r * 0.32, y - r * 0.05, r * 0.11, r * 0.16); g.fill();
    ell(g, x + r * 0.74, y - r * 0.05, r * 0.1, r * 0.15); g.fill();
    ell(g, x + r * 0.55, y + r * 0.38, r * 0.2, r * 0.11); g.fillStyle = 'rgba(232,96,96,.35)'; g.fill();
    g.beginPath(); g.arc(x + r * 0.55, y + r * 0.42, r * 0.16, 0.2, PI - 0.4); g.lineWidth = 0.9; g.strokeStyle = 'rgba(42,33,64,.7)'; g.stroke();
  }
  if (opts.helmet) return helmet(g, x, y, r, opts.plume);
  headgear(g, x, y, r, L, tribe);
}
function helmet(g, x, y, r, plume) {
  // plume first (behind)
  if (plume != null) {
    g.beginPath(); g.moveTo(x - 2, y - r * 0.9); g.bezierCurveTo(x - r * 1.4, y - r * 1.9, x - r * 2.2, y - r * 0.6, x - r * 1.9, y + r * 0.4);
    g.bezierCurveTo(x - r * 1.5, y - r * 0.4, x - r * 1.1, y - r * 0.9, x - 1, y - r * 0.5); g.closePath();
    fs(g, lg(g, x, y - r * 2, x - r * 2, y, [[0, lt(plume, 0.25)], [1, dk(plume, 0.15)]]), 1.2);
  }
  g.beginPath(); g.arc(x, y - 0.5, r * 1.06, PI * 1.02, TAU * 0.995); g.lineTo(x + r * 1.05, y + r * 0.15); g.lineTo(x - r * 1.05, y + r * 0.15); g.closePath();
  fs(g, lg(g, x - r, y - r, x + r, y + r * 0.2, [[0, lt(METAL, 0.35)], [0.5, METAL], [1, METAL_D]]));
  rr(g, x + r * 0.42, y - r * 0.1, r * 0.22, r * 0.75, 1); fs(g, css(METAL_D), 1);
  g.beginPath(); g.arc(x - r * 0.2, y - r * 0.4, r * 0.55, PI * 1.15, PI * 1.55); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke();
}
function headgear(g, x, y, r, L, tribe) {
  const hair = css(L.hair);
  switch (tribe) {
    case 'verdant': {
      g.beginPath(); g.arc(x, y, r * 1.02, PI * 1.05, TAU * 0.98); g.quadraticCurveTo(x + r * 0.3, y - r * 0.45, x - r * 0.9, y - r * 0.1); g.closePath(); fs(g, hair, 1.2);
      const leaves = [[-0.6, -0.9, -0.8], [0, -1.15, 0], [0.62, -0.9, 0.8]];
      for (const [dx, dy, rot] of leaves) {
        g.save(); g.translate(x + dx * r, y + dy * r); g.rotate(rot);
        g.beginPath(); g.moveTo(0, r * 0.45); g.quadraticCurveTo(r * 0.42, -r * 0.1, 0, -r * 0.55); g.quadraticCurveTo(-r * 0.42, -r * 0.1, 0, r * 0.45);
        fs(g, lg(g, 0, -r * 0.5, 0, r * 0.5, [[0, 0x8fd468], [1, 0x3f8a3a]]), 1.1);
        line(g, 0, r * 0.35, 0, -r * 0.4, 0x2f6a2a, 0.7);
        g.restore();
      }
      rr(g, x - r * 1.0, y - r * 0.55, r * 2, r * 0.3, 2); fs(g, css(0x6e8f3a), 1);
      break;
    }
    case 'ironpeak': {
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(x + s * r * 0.75, y - r * 0.5); g.bezierCurveTo(x + s * r * 1.6, y - r * 0.6, x + s * r * 1.7, y - r * 1.5, x + s * r * 1.25, y - r * 1.9);
        g.bezierCurveTo(x + s * r * 1.3, y - r * 1.3, x + s * r * 1.0, y - r * 0.95, x + s * r * 0.55, y - r * 0.85); g.closePath();
        fs(g, lg(g, x, y - r * 2, x + s * r, y, [[0, 0xfaf3e0], [1, 0xc9b994]]), 1.1);
      }
      g.beginPath(); g.arc(x, y - 0.5, r * 1.06, PI * 1.02, TAU * 0.995); g.closePath();
      fs(g, lg(g, x - r, y - r, x + r, y, [[0, 0xb8b4c8], [1, 0x6c6680]]));
      rr(g, x - r * 1.08, y - r * 0.18, r * 2.16, r * 0.3, 1.5); fs(g, css(0x8c86a0), 1);
      for (let k = -1; k <= 1; k++) { circ(g, x + k * r * 0.6, y - r * 0.03, r * 0.08); fill(g, css(0xe6e2f0)); }
      break;
    }
    case 'tidecallers': {
      g.beginPath(); g.arc(x, y, r * 1.03, PI * 1.0, TAU); g.quadraticCurveTo(x, y - r * 0.35, x - r * 1.03, y); fs(g, hair, 1.2);
      // topknot
      circ(g, x - r * 0.4, y - r * 1.15, r * 0.36); fs(g, hair, 1.1);
      rr(g, x - r * 1.05, y - r * 0.5, r * 2.1, r * 0.34, 2); fs(g, css(0x2bb7c6), 1);
      // shell
      g.save(); g.translate(x + r * 0.15, y - r * 0.35);
      g.beginPath(); g.moveTo(0, r * 0.25); g.lineTo(-r * 0.32, -r * 0.18); g.quadraticCurveTo(0, -r * 0.48, r * 0.32, -r * 0.18); g.closePath(); fs(g, css(0xfff1de), 0.9);
      for (const a of [-0.5, 0, 0.5]) line(g, 0, r * 0.2, Math.sin(a) * r * 0.3, -r * 0.28, 0xd9b48c, 0.6);
      g.restore();
      break;
    }
    case 'emberfolk': {
      const tufts = [[-0.75, -0.55, -0.9, -1.55], [-0.3, -0.95, -0.3, -2.0], [0.2, -1.0, 0.35, -1.85], [0.65, -0.75, 0.95, -1.35]];
      for (const [bx, by, tx, ty] of tufts) {
        g.beginPath(); g.moveTo(x + (bx - 0.28) * r, y + by * r + 2); g.quadraticCurveTo(x + (tx - 0.1) * r, y + (ty + 0.5) * r, x + tx * r, y + ty * r);
        g.quadraticCurveTo(x + (tx + 0.25) * r, y + (ty + 0.7) * r, x + (bx + 0.3) * r, y + by * r + 2); g.closePath();
        fs(g, lg(g, 0, y - r * 2, 0, y, [[0, 0xffe36a], [0.5, 0xff8a2a], [1, 0xd8432a]]), 1.1);
      }
      g.beginPath(); g.arc(x, y, r * 1.02, PI * 1.05, TAU * 0.97); g.quadraticCurveTo(x, y - r * 0.4, x - r * 0.95, y - r * 0.15); fs(g, hair, 1.1);
      rr(g, x - r * 1.0, y - r * 0.45, r * 2, r * 0.26, 2); fs(g, css(0xc8402e), 1);
      // war paint
      line(g, x + r * 0.2, y + r * 0.15, x + r * 0.9, y + r * 0.15, 0xd8432a, 1.1);
      break;
    }
    case 'frostkin': {
      // fur hood
      g.beginPath(); g.arc(x, y + r * 0.1, r * 1.32, PI * 0.78, PI * 2.22); fs(g, lg(g, x, y - r, x, y + r, [[0, 0x9cc0e4], [1, 0x5f87b4]]), 1.2);
      circ(g, x + r * 0.1, y + r * 0.05, r * 0.98); fs(g, rg(g, x - r * 0.2, y - r * 0.2, r * 1.2, [[0, lt(L.skin, 0.2)], [1, L.skin]]), 1.1);
      for (let k = 0; k < 9; k++) {
        const a = PI * 0.75 + k * (PI * 1.5) / 8;
        circ(g, x + Math.cos(a) * r * 1.12, y + r * 0.05 + Math.sin(a) * r * 1.12, r * 0.3); fill(g, css(0xfbfbff));
      }
      g.fillStyle = INKS;
      ell(g, x + r * 0.36, y, r * 0.11, r * 0.16); g.fill(); ell(g, x + r * 0.78, y, r * 0.1, r * 0.15); g.fill();
      ell(g, x + r * 0.58, y + r * 0.42, r * 0.2, r * 0.11); g.fillStyle = 'rgba(232,110,120,.45)'; g.fill();
      break;
    }
    case 'sunspire': {
      g.beginPath(); g.arc(x, y, r * 1.03, PI * 1.0, TAU); g.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x - r * 1.03, y + r * 0.4); fs(g, hair, 1.1);
      rr(g, x - r * 1.04, y - r * 0.55, r * 2.08, r * 0.28, 1.5); fs(g, lg(g, 0, y - r * 0.6, 0, y - r * 0.25, [[0, 0xffe7a0], [1, 0xc9902a]]), 1);
      // sun disc
      const sx = x + r * 0.05, sy = y - r * 0.95;
      for (let k = 0; k < 10; k++) { const a = -PI / 2 + (k - 4.5) * 0.3; g.beginPath(); g.moveTo(sx + Math.cos(a) * r * 0.38, sy + Math.sin(a) * r * 0.38); g.lineTo(sx + Math.cos(a) * r * 0.72, sy + Math.sin(a) * r * 0.72); g.lineWidth = 1.4; g.strokeStyle = css(0xf2b22e); g.lineCap = 'round'; g.stroke(); }
      circ(g, sx, sy, r * 0.36); fs(g, rg(g, sx - 1, sy - 1, r * 0.4, [[0, 0xfff6c8], [1, 0xf0a828]]), 1);
      break;
    }
  }
}
function legs(g, L, spread) {
  const s = spread || 0;
  for (const dx of [-5.5 - s, 5.5 + s]) {
    rr(g, dx - 3.4, -19, 6.8, 16, 2.5); fs(g, lg(g, dx - 3, 0, dx + 3, 0, [[0, lt(L.pants, 0.15)], [1, dk(L.pants, 0.15)]]), 1.3);
    g.beginPath(); g.moveTo(dx - 3.8, -5); g.lineTo(dx + 3.4, -5); g.quadraticCurveTo(dx + 7, -4, dx + 6.5, 0); g.lineTo(dx - 3.8, 0); g.closePath(); fs(g, css(0x4a3222), 1.3);
  }
}
function tunic(g, cloth, trim, opts) {
  opts = opts || {};
  const top = opts.top || -42, hem = opts.hem || -14, sw = opts.sw || 10.5, hw = opts.hw || 12.5;
  g.beginPath(); g.moveTo(-sw, top + 2); g.quadraticCurveTo(0, top - 2, sw, top + 2);
  g.lineTo(hw, hem); g.quadraticCurveTo(0, hem + 3, -hw, hem); g.closePath();
  fs(g, lg(g, -hw, top, hw, hem, [[0, lt(cloth, 0.22)], [0.55, cloth], [1, dk(cloth, 0.22)]]));
  if (!opts.noTrim) {
    g.save(); g.clip();
    g.beginPath(); g.moveTo(-hw - 2, hem - 3.5); g.quadraticCurveTo(0, hem - 0.5, hw + 2, hem - 3.5); g.lineTo(hw + 2, hem + 4); g.lineTo(-hw - 2, hem + 4); g.closePath(); fill(g, css(trim));
    for (let k = -2; k <= 2; k++) { circ(g, k * 4.5, hem - 1, 0.8); fill(g, css(dk(trim, 0.35))); }
    g.restore();
    // collar
    g.beginPath(); g.moveTo(-4.5, top + 0.5); g.lineTo(0, top + 6); g.lineTo(4.5, top + 0.5); g.lineWidth = 1.6; g.strokeStyle = css(trim); g.stroke();
  }
  if (!opts.noBelt) {
    rr(g, -hw + 1.2, -27, hw * 2 - 2.4, 4.2, 1.5); fs(g, css(LEATHER), 1.1);
    rr(g, 1.5, -27.6, 5, 5.4, 1); fs(g, css(GOLD), 0.9);
  }
}
function robe(g, cloth, trim, pattern) {
  g.beginPath(); g.moveTo(-10, -40); g.quadraticCurveTo(0, -44, 10, -40); g.lineTo(16, -1); g.quadraticCurveTo(0, 2, -16, -1); g.closePath();
  fs(g, lg(g, -16, -40, 16, 0, [[0, lt(cloth, 0.2)], [0.55, cloth], [1, dk(cloth, 0.28)]]));
  g.save(); g.clip();
  g.beginPath(); g.moveTo(-18, -6); g.quadraticCurveTo(0, -3, 18, -6); g.lineTo(18, 4); g.lineTo(-18, 4); g.closePath(); fill(g, css(trim));
  if (pattern) {
    g.beginPath();
    for (let k = -16; k <= 16; k += 4) { g.moveTo(k, -3.5); g.lineTo(k + 2, -6.5); g.lineTo(k + 4, -3.5); }
    g.lineWidth = 1; g.strokeStyle = css(dk(trim, 0.45)); g.stroke();
  }
  // fold lines
  for (const fx of [-6, 3]) { g.beginPath(); g.moveTo(fx, -30); g.quadraticCurveTo(fx + 1.5, -16, fx - 1, -6); g.lineWidth = 0.9; g.strokeStyle = rgba(dk(cloth, 0.45), 0.5); g.stroke(); }
  g.restore();
}
function hand(g, x, y, L, r) { circ(g, x, y, r || 3.1); fs(g, css(L.skin), 1.2); }

// ---------------------------------------------------------------- weapons & gear
function club(g, x, y, ang, len) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(-1.6, 3); g.lineTo(-2.8, -len * 0.55); g.quadraticCurveTo(-5.5, -len, 0, -len - 3); g.quadraticCurveTo(5.5, -len, 2.8, -len * 0.55); g.lineTo(1.6, 3); g.closePath();
  fs(g, lg(g, -5, 0, 5, 0, [[0, lt(WOOD, 0.25)], [1, dk(WOOD, 0.2)]]));
  for (const k of [0.62, 0.8]) { circ(g, 1, -len * k, 0.9); fill(g, css(WOOD_D)); }
  rr(g, -2.4, -4, 4.8, 4, 1); fs(g, css(LEATHER), 0.9);
  g.restore();
}
function sword(g, x, y, ang, len) {
  g.save(); g.translate(x, y); g.rotate(ang);
  poly(g, [-2.2, -5, -2.2, -len, 0, -len - 4.5, 2.2, -len, 2.2, -5]); fs(g, lg(g, -2, 0, 2, 0, [[0, 0xffffff], [0.5, METAL], [1, METAL_D]]), 1.2);
  line(g, 0, -7, 0, -len + 1, 0x9aa4b2, 0.7);
  rr(g, -6.5, -6.5, 13, 3, 1.4); fs(g, css(GOLD), 1.1);
  rr(g, -1.7, -3.5, 3.4, 6, 1); fs(g, css(LEATHER), 1);
  circ(g, 0, 3.6, 2); fs(g, css(GOLD), 1);
  g.restore();
}
function spear(g, x1, y1, x2, y2, tipC) {
  line(g, x1, y1, x2, y2, INK, 3.6); line(g, x1, y1, x2, y2, WOOD, 2);
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.save(); g.translate(x2, y2); g.rotate(a);
  poly(g, [-1, -2.6, 8, 0, -1, 2.6]); fs(g, lg(g, 0, -3, 0, 3, [[0, 0xffffff], [1, tipC || METAL_D]]), 1.1);
  g.restore();
}
function kiteShield(g, x, y, w, h, color, tribe) {
  g.beginPath(); g.moveTo(x - w / 2, y - h / 2 + 3); g.quadraticCurveTo(x, y - h / 2 - 3, x + w / 2, y - h / 2 + 3);
  g.quadraticCurveTo(x + w / 2 + 1, y + h * 0.1, x, y + h / 2); g.quadraticCurveTo(x - w / 2 - 1, y + h * 0.1, x - w / 2, y - h / 2 + 3); g.closePath();
  fill(g, lg(g, x - w / 2, y - h / 2, x + w / 2, y + h / 2, [[0, lt(color, 0.28)], [0.6, color], [1, dk(color, 0.25)]]));
  g.lineWidth = 3.4; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = css(METAL); g.stroke();
  emblem(g, tribe, x, y - h * 0.06, w / 20, lt(color, 0.85));
  for (const [dx, dy] of [[-w * 0.33, -h * 0.3], [w * 0.33, -h * 0.3], [0, h * 0.34]]) { circ(g, x + dx, y + dy, 1); fill(g, css(0xeef2f6)); }
}
function roundShield(g, x, y, r, color, tribe) {
  circ(g, x, y, r); fill(g, rg(g, x - r * 0.3, y - r * 0.3, r * 1.2, [[0, lt(color, 0.3)], [1, dk(color, 0.2)]]));
  g.lineWidth = 3; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = css(METAL); g.stroke();
  emblem(g, tribe, x, y, r / 9, lt(color, 0.85));
}
function bow(g, x, y, h) {
  g.beginPath(); g.moveTo(x - 1, y - h / 2); g.quadraticCurveTo(x + h * 0.42, y, x - 1, y + h / 2);
  g.lineWidth = 4; g.strokeStyle = INKS; g.lineCap = 'round'; g.stroke(); g.lineWidth = 2.3; g.strokeStyle = css(0x7a4a24); g.stroke();
  line(g, x - 1, y - h / 2, x - 1, y + h / 2, 0xf3ecd8, 0.7);
}
function arrowFletch(g, x, y, c) { poly(g, [x, y, x - 3, y - 4, x + 1, y - 2]); fill(g, css(c)); poly(g, [x, y, x + 3, y - 4, x - 1, y - 2]); fill(g, css(lt(c, 0.3))); }

// ---------------------------------------------------------------- horse
function horse(g, coat, mane, cloth, tribe, armored) {
  const leg = (x, bend, back) => {
    const k = bend ? 3 : 0;
    g.beginPath(); g.moveTo(x - 2.4, -18); g.lineTo(x - 2.2 + k, -9); g.lineTo(x - 2 - (bend ? 1 : 0), -2); g.lineTo(x + 2.2 - (bend ? 1 : 0), -2); g.lineTo(x + 2.2 + k, -9); g.lineTo(x + 2.4, -18); g.closePath();
    fs(g, css(back ? dk(coat, 0.18) : coat), 1.2);
    rr(g, x - 2.8 - (bend ? 1 : 0), -3.4, 5.4, 3.6, 1.2); fs(g, css(0x3a2a20), 1.1);
  };
  leg(-15, false, true); leg(16, true, true);
  // tail
  g.beginPath(); g.moveTo(-22, -30); g.bezierCurveTo(-34, -30, -33, -15, -29, -9); g.bezierCurveTo(-27, -16, -25, -22, -21, -25); g.closePath(); fs(g, lg(g, -33, -30, -24, -10, [[0, lt(mane, 0.2)], [1, dk(mane, 0.2)]]), 1.2);
  // body
  ell(g, -1, -27, 23, 10.5); fs(g, lg(g, 0, -38, 0, -17, [[0, lt(coat, 0.22)], [0.6, coat], [1, dk(coat, 0.22)]]));
  // neck + head
  g.beginPath(); g.moveTo(12, -34); g.bezierCurveTo(17, -42, 21, -50, 27, -55); g.lineTo(36, -52); g.quadraticCurveTo(41, -48, 40, -44);
  g.quadraticCurveTo(37, -41, 33, -43); g.bezierCurveTo(29, -40, 25, -32, 21, -24); g.closePath();
  fs(g, lg(g, 15, -55, 30, -25, [[0, lt(coat, 0.2)], [1, dk(coat, 0.1)]]));
  poly(g, [27, -55, 27.5, -61, 31, -55.5]); fs(g, css(dk(coat, 0.1)), 1.1);
  circ(g, 33, -50, 1.1); fill(g, INKS);
  circ(g, 39, -45, 0.8); fill(g, INKS);
  // mane
  g.beginPath(); g.moveTo(26, -56); g.bezierCurveTo(20, -52, 15, -44, 11, -36); g.lineTo(14, -34); g.bezierCurveTo(18, -42, 22, -48, 28, -53); g.closePath(); fs(g, css(mane), 1.1);
  leg(-10, false, false); leg(11, false, false);
  if (armored) {
    g.beginPath(); g.moveTo(-21, -31); g.quadraticCurveTo(-1, -40, 15, -33); g.lineTo(17, -18); g.quadraticCurveTo(-2, -12, -22, -19); g.closePath();
    fs(g, lg(g, 0, -40, 0, -14, [[0, lt(cloth, 0.2)], [1, dk(cloth, 0.2)]]));
    g.save(); g.clip(); g.beginPath(); g.moveTo(-24, -21); g.quadraticCurveTo(-2, -15, 19, -21); g.lineTo(19, -12); g.lineTo(-24, -12); g.closePath(); fill(g, css(GOLD));
    for (let k = -18; k < 16; k += 5) { poly(g, [k, -18, k + 2.5, -14.5, k + 5, -18]); fill(g, css(dk(cloth, 0.2))); }
    g.restore();
    emblem(g, tribe, -3, -27, 0.75, lt(cloth, 0.85));
    // chanfron
    g.beginPath(); g.moveTo(28, -55); g.lineTo(37, -52); g.lineTo(39, -46); g.lineTo(31, -48); g.closePath(); fs(g, lg(g, 28, -55, 38, -46, [[0, 0xffffff], [1, METAL_D]]), 1);
  } else {
    // saddle blanket
    rr(g, -9, -38, 16, 9, 3); fs(g, lg(g, 0, -38, 0, -29, [[0, lt(cloth, 0.2)], [1, dk(cloth, 0.15)]]), 1.2);
    line(g, -8, -31.2, 6, -31.2, lt(cloth, 0.75), 1);
    rr(g, -6, -41, 11, 4, 2); fs(g, css(LEATHER), 1.1);
    // bridle
    g.beginPath(); g.moveTo(30, -53); g.lineTo(37, -44); g.moveTo(31, -46); g.lineTo(18, -40); g.lineWidth = 0.9; g.strokeStyle = css(0x3a2418); g.stroke();
  }
}

// ---------------------------------------------------------------- units
const UNIT_BOX = { x0: -60, y0: -112, x1: 62, y1: 16 };
ART.UNIT_BOX = UNIT_BOX;

// the giant towers over everyone (a normal unit is scale 1)
const GIANT_SCALE = 1.6;
function giantBody(g, C, L, tribe) {
    limb(g, -9, -38, -14, -22, 7, dk(L.skin, 0.12)); hand(g, -14, -21, L, 3.8);
    legs(g, { pants: dk(L.skin, 0.1) }, 1);
    // bare torso + fur
    g.beginPath(); g.moveTo(-12, -40); g.quadraticCurveTo(0, -45, 12, -40); g.lineTo(13, -16); g.quadraticCurveTo(0, -12, -13, -16); g.closePath();
    fs(g, lg(g, -12, -44, 12, -16, [[0, lt(L.skin, 0.15)], [1, dk(L.skin, 0.18)]]));
    line(g, -4, -36, -3, -26, dk(L.skin, 0.25), 0.8); line(g, 4, -36, 3, -26, dk(L.skin, 0.25), 0.8);
    // war paint in tribe color
    line(g, -9, -33, -3, -31, C, 1.6); line(g, 9, -33, 3, -31, C, 1.6);
    g.beginPath(); g.moveTo(-14, -21); g.lineTo(14, -21); g.lineTo(15, -12); for (let k = 15; k >= -15; k -= 3) g.lineTo(k, k % 2 ? -9 : -11.5); g.closePath();
    fs(g, lg(g, 0, -21, 0, -9, [[0, 0x9a6a3a], [1, 0x5e3a1d]]), 1.2);
    rr(g, -13, -23, 26, 3.5, 1.4); fs(g, css(C), 1);
    head(g, 1, -53, 11.5, L, tribe);
    // beard
    g.beginPath(); g.moveTo(-3, -50); g.quadraticCurveTo(5, -36, 13, -48); g.quadraticCurveTo(8, -45, 4, -47); g.closePath(); fs(g, css(dk(L.hair === 0xe9e2d6 ? 0xd6cdbf : 0x5a3a22, 0)), 1);
    // club over shoulder
    club(g, 11, -34, -0.45, 30);
    limb(g, 9, -38, 12, -33, 7, L.skin); hand(g, 12, -33, L, 3.8);
}
function drawUnit(g, o) {
  // o: { type, naval, color, tribe, ghost }
  const C = o.color, L = ART.look(o.tribe), tribe = o.tribe;
  const trim = L.trim;
  if (o.naval) return drawBoat(g, o.naval, C, L, tribe, o.type);
  switch (o.type) {
    case 'warrior': {
      shadow(g, 0, 0, 15, 4.5);
      limb(g, -8, -38, -12, -24, 5.6, dk(C, 0.12)); hand(g, -12, -23, L);
      legs(g, L);
      tunic(g, C, trim);
      // small hide buckler on back arm
      ell(g, -13, -27, 6.5, 8.5); fs(g, lg(g, -19, -34, -7, -19, [[0, 0xc89b62], [1, 0x8c6236]]));
      g.beginPath(); g.ellipse(-13, -27, 4.2, 6, 0, 0, TAU); g.lineWidth = 0.8; g.strokeStyle = 'rgba(60,35,20,.6)'; g.setLineDash([1.5, 1.5]); g.stroke(); g.setLineDash([]);
      head(g, 2, -54, 11, L, tribe);
      club(g, 13, -30, 0.55, 26);
      limb(g, 8, -38, 12, -31, 5.6, C); hand(g, 13, -30, L);
      break;
    }
    case 'archer': {
      shadow(g, 0, 0, 15, 4.5);
      // quiver
      g.save(); g.translate(-9, -36); g.rotate(-0.35);
      rr(g, -3.5, -12, 7, 20, 2.5); fs(g, lg(g, -3, 0, 3, 0, [[0, 0xa36a3a], [1, 0x6b4020]]));
      for (const fx of [-1.6, 1.6]) { line(g, fx, -12, fx, -17, 0xe9dcc0, 0.8); arrowFletch(g, fx, -17, trim); }
      g.restore();
      legs(g, L);
      tunic(g, dk(C, 0.08), trim);
      // hood / cape
      g.beginPath(); g.moveTo(-10, -44); g.quadraticCurveTo(-16, -30, -13, -18); g.lineTo(-8, -20); g.quadraticCurveTo(-10, -32, -5, -42); g.closePath(); fs(g, css(dk(C, 0.25)), 1.2);
      limb(g, -7, -38, 3, -40, 5.4, dk(C, 0.15)); hand(g, 3, -40, L);
      head(g, 1, -54, 11, L, tribe);
      bow(g, 18, -40, 34);
      line(g, 3, -40, 25, -40, 0xd9c49a, 1.3);
      poly(g, [25, -42.3, 30, -40, 25, -37.7]); fs(g, css(METAL), 0.8);
      arrowFletch(g, 4, -40, trim);
      limb(g, 8, -38, 17, -40, 5.4, C); hand(g, 17.5, -40, L);
      break;
    }
    case 'defender': {
      shadow(g, 0, 0, 16, 4.6);
      spear(g, -13, 2, -13, -70);
      limb(g, -8, -38, -13, -28, 5.8, dk(C, 0.12)); hand(g, -13, -28, L);
      legs(g, L, 0.6);
      tunic(g, C, trim, { hw: 13.5 });
      head(g, 1, -54, 11, L, tribe, { helmet: true, plume: C });
      kiteShield(g, 9, -30, 22, 32, C, tribe);
      break;
    }
    case 'swordsman': {
      shadow(g, 0, 0, 16, 4.6);
      limb(g, -8, -38, -13, -28, 5.8, METAL_D); roundShield(g, -14, -28, 9.5, C, tribe);
      legs(g, L, 0.5);
      tunic(g, METAL, trim, { noTrim: true });
      // tabard
      g.beginPath(); g.moveTo(-5, -41); g.lineTo(5, -41); g.lineTo(6, -14); g.lineTo(0, -11); g.lineTo(-6, -14); g.closePath(); fs(g, lg(g, 0, -41, 0, -11, [[0, lt(C, 0.2)], [1, dk(C, 0.15)]]), 1.2);
      emblem(g, tribe, 0, -26, 0.55, lt(C, 0.85));
      // pauldron
      ell(g, 8, -39, 5, 3.6, -0.3); fs(g, lg(g, 4, -42, 12, -36, [[0, 0xffffff], [1, METAL_D]]), 1.1);
      head(g, 1, -54, 11, L, tribe, { helmet: true, plume: C });
      sword(g, 14, -32, 0.32, 30);
      limb(g, 8, -38, 13, -32, 5.8, METAL); hand(g, 14, -32, L);
      break;
    }
    case 'rider': {
      shadow(g, 2, 0, 27, 5.5);
      horse(g, 0xa8673a, 0x3a2418, C, tribe, false);
      // rider
      g.save(); g.translate(-2, -30); g.scale(0.82, 0.82);
      limb(g, -2, -5, 2, 6, 5.5, L.pants);
      tunic(g, C, trim, { hem: -6, top: -40 });
      spear(g, 10, 6, 28, -46);
      head(g, 1, -52, 11, L, tribe);
      limb(g, 7, -36, 13, -24, 5.4, C); hand(g, 13, -23, L);
      g.restore();
      break;
    }
    case 'knight': {
      shadow(g, 2, 0, 28, 5.6);
      horse(g, 0xdfdcd5, 0x8f8a84, C, tribe, true);
      g.save(); g.translate(-3, -32); g.scale(0.84, 0.84);
      limb(g, -2, -5, 3, 7, 5.6, METAL_D);
      tunic(g, METAL, trim, { hem: -6, top: -40, noTrim: true });
      g.beginPath(); g.moveTo(-5, -39); g.lineTo(5, -39); g.lineTo(6, -8); g.lineTo(-6, -8); g.closePath(); fs(g, lg(g, 0, -39, 0, -8, [[0, lt(C, 0.2)], [1, dk(C, 0.15)]]), 1.1);
      head(g, 1, -52, 11, L, tribe, { helmet: true, plume: C });
      // lance with pennant
      g.save(); g.rotate(-0.42);
      line(g, -8, -16, 60, -16, INK, 5); line(g, -8, -16, 60, -16, 0xd8c39a, 3.2);
      poly(g, [60, -18.5, 70, -16, 60, -13.5]); fs(g, css(METAL), 1.1);
      poly(g, [52, -16, 41, -16, 44, -24, 50, -21]); fs(g, css(C), 1.1);
      rr(g, 3, -21, 6, 10, 2); fs(g, css(METAL_D), 1);
      g.restore();
      limb(g, 7, -36, 12, -26, 5.4, METAL); hand(g, 12, -25, L);
      g.restore();
      break;
    }
    case 'catapult': {
      shadow(g, 0, 0, 30, 5.5);
      const wheel = (x) => {
        circ(g, x, -9, 9); fs(g, lg(g, x - 9, -18, x + 9, 0, [[0, lt(WOOD, 0.15)], [1, dk(WOOD, 0.2)]]), 1.4);
        circ(g, x, -9, 6.4); g.lineWidth = 1; g.strokeStyle = css(WOOD_D); g.stroke();
        for (let k = 0; k < 6; k++) { const a = k * PI / 3; line(g, x, -9, x + Math.cos(a) * 6.4, -9 + Math.sin(a) * 6.4, WOOD_D, 1.1); }
        circ(g, x, -9, 2); fs(g, css(METAL_D), 1);
      };
      wheel(-17);
      rr(g, -30, -21, 58, 7, 2); fs(g, lg(g, 0, -21, 0, -14, [[0, lt(WOOD, 0.2)], [1, dk(WOOD, 0.15)]]));
      // A-frame
      poly(g, [-6, -20, 2, -46, 6, -46, 12, -20]); fs(g, lg(g, -6, -46, 12, -20, [[0, lt(WOOD, 0.1)], [1, dk(WOOD, 0.2)]]));
      poly(g, [-1, -20, 3, -40, 5, -40, 7, -20]); fill(g, css(dk(WOOD, 0.35)));
      // arm
      g.save(); g.translate(4, -40); g.rotate(-0.95);
      rr(g, -3, -2, 40, 5, 2); fs(g, lg(g, 0, -2, 0, 3, [[0, lt(WOOD, 0.25)], [1, WOOD]]));
      g.beginPath(); g.moveTo(31, -2); g.quadraticCurveTo(36, -9, 42, -3); g.lineTo(42, 1); g.lineTo(31, 1); g.closePath(); fs(g, css(LEATHER), 1.1);
      circ(g, 37, -5, 4.6); fs(g, rg(g, 35.5, -6.5, 6, [[0, 0xd6d0c4], [1, 0x7e786c]]), 1.2);
      g.restore();
      circ(g, 4, -40, 2.4); fs(g, css(METAL_D), 1);
      // rope + counterweight
      line(g, 4, -40, -16, -22, 0xcbb38a, 1);
      rr(g, -21, -30, 9, 9, 1.5); fs(g, lg(g, -21, -30, -12, -21, [[0, 0x9a9488], [1, 0x5e5850]]));
      wheel(17);
      // pennant
      line(g, 26, -21, 26, -48, WOOD_D, 1.6);
      poly(g, [26, -48, 38, -44, 26, -40]); fs(g, css(C), 1.1);
      break;
    }
    case 'shaman': {
      shadow(g, 0, 0, 16, 4.6);
      robe(g, C, trim, true);
      limb(g, -8, -38, -10, -24, 5.4, dk(C, 0.1)); hand(g, -10, -23, L);
      // necklace
      g.beginPath(); g.arc(1, -40, 6, 0.3, PI - 0.3); g.lineWidth = 1.1; g.strokeStyle = css(0xf6efd9); g.stroke();
      for (const a of [0.6, 1.57, 2.5]) { circ(g, 1 + Math.cos(a) * 6, -40 + Math.sin(a) * 6, 1.2); fill(g, css(0xd8432a)); }
      head(g, 2, -54, 11, L, tribe);
      // face paint
      line(g, 5, -57, 12, -57, 0xf6efd9, 1); line(g, 5, -50, 11, -50, 0xf6efd9, 0.8);
      // feathers
      for (const [dx, a, c] of [[-6, -0.55, C], [-2, -0.2, 0xf6efd9], [2, 0.1, 0xd8432a]]) {
        g.save(); g.translate(2 + dx, -64); g.rotate(a);
        g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(4, -6, 0, -15); g.quadraticCurveTo(-4, -6, 0, 2); fs(g, css(c), 1);
        line(g, 0, 1, 0, -13, dk(c, 0.4), 0.6); g.restore();
      }
      // staff
      line(g, 16, 1, 18, -66, INK, 4.2); line(g, 16, 1, 18, -66, WOOD, 2.6);
      g.save(); g.translate(18, -72);
      circ(g, 0, 0, 9); fill(g, rg(g, 0, 0, 9, [[0, 'rgba(141,255,176,.65)'], [1, 'rgba(141,255,176,0)']]));
      poly(g, [0, -6, 4, 0, 0, 6, -4, 0]); fs(g, lg(g, -4, -6, 4, 6, [[0, 0xd8ffe4], [0.5, 0x4be38a], [1, 0x1f9a58]]), 1.1);
      g.restore();
      line(g, 16, -66, 13, -56, 0xf6efd9, 0.8); poly(g, [13, -56, 11.5, -50, 14.5, -50]); fill(g, css(C));
      limb(g, 8, -38, 16, -34, 5.4, C); hand(g, 16.5, -34, L);
      break;
    }
    case 'mindbender': {
      shadow(g, 0, 0, 16, 4.6);
      const rob = mix(C, 0x3a2a6e, 0.55);
      robe(g, rob, lt(C, 0.4), false);
      // hood
      g.beginPath(); g.arc(1, -53, 13, PI * 0.85, PI * 2.15); g.lineTo(13, -40); g.quadraticCurveTo(1, -36, -11, -42); g.closePath();
      fs(g, lg(g, -12, -66, 14, -40, [[0, lt(rob, 0.2)], [1, dk(rob, 0.3)]]));
      ell(g, 4, -51, 8, 8.5); fill(g, css(0x1a1430));
      for (const ex of [2, 7.5]) { circ(g, ex, -52, 3); fill(g, 'rgba(160,240,255,.35)'); circ(g, ex, -52, 1.3); fill(g, css(0xc8fbff)); }
      limb(g, -7, -38, 4, -46, 5.2, rob); limb(g, 8, -38, 14, -47, 5.2, rob);
      hand(g, 5, -46, L, 2.7); hand(g, 14, -47.5, L, 2.7);
      // orb
      const ox = 10, oy = -64;
      circ(g, ox, oy, 14); fill(g, rg(g, ox, oy, 14, [[0, 'rgba(199,155,255,.6)'], [1, 'rgba(199,155,255,0)']]));
      circ(g, ox, oy, 6.5); fs(g, rg(g, ox - 2, oy - 2, 8, [[0, 0xffffff], [0.35, 0xd9b8ff], [1, 0x7a3fd8]]), 1.1);
      g.beginPath(); g.ellipse(ox, oy, 11, 3.2, -0.35, 0, TAU); g.lineWidth = 1; g.strokeStyle = 'rgba(230,210,255,.9)'; g.stroke();
      emblem(g, tribe, 1, -24, 0.6, lt(C, 0.6));
      break;
    }
    case 'cloak': {
      shadow(g, 0, 0, 15, 4.5);
      const cl = mix(C, 0x1c1830, 0.62);
      // long hooded cloak
      g.beginPath(); g.moveTo(-9, -44); g.quadraticCurveTo(-17, -20, -15, 0); g.quadraticCurveTo(0, 3, 14, 0); g.quadraticCurveTo(15, -22, 9, -44); g.closePath();
      fs(g, lg(g, -15, -44, 15, 0, [[0, lt(cl, 0.18)], [0.6, cl], [1, dk(cl, 0.35)]]));
      g.save(); g.clip(); for (const fx of [-7, 0, 6]) { g.beginPath(); g.moveTo(fx, -36); g.quadraticCurveTo(fx + 2, -18, fx - 1, 2); g.lineWidth = 1; g.strokeStyle = rgba(0x000000, 0.25); g.stroke(); }
      g.beginPath(); g.moveTo(-18, -6); g.quadraticCurveTo(0, -2, 18, -6); g.lineTo(18, 4); g.lineTo(-18, 4); g.closePath(); fill(g, css(C)); g.restore();
      // hood with shadowed face and glinting eyes
      g.beginPath(); g.arc(1, -51, 12.5, PI * 0.82, PI * 2.18); g.lineTo(12, -38); g.quadraticCurveTo(1, -34, -10, -38); g.closePath();
      fs(g, lg(g, -12, -64, 13, -38, [[0, lt(cl, 0.22)], [1, dk(cl, 0.3)]]));
      g.beginPath(); g.moveTo(-1, -63); g.quadraticCurveTo(-8, -66, -12, -60); g.lineWidth = 1.2; g.strokeStyle = rgba(0xffffff, 0.25); g.stroke();
      ell(g, 5, -49, 7, 7.5); fill(g, css(0x0e0c18));
      for (const ex of [3.5, 8.2]) { ell(g, ex, -50, 1.6, 1.1); fill(g, css(0xfff3b0)); }
      // dagger held low
      g.save(); g.translate(12, -22); g.rotate(0.5);
      poly(g, [-1.4, -3, -1.4, -15, 0, -18.5, 1.4, -15, 1.4, -3]); fs(g, lg(g, -1.5, 0, 1.5, 0, [[0, 0xffffff], [1, METAL_D]]), 1);
      rr(g, -4, -3.5, 8, 2.4, 1); fs(g, css(GOLD), 0.9); rr(g, -1.3, -1.5, 2.6, 5, 1); fs(g, css(LEATHER), 0.9);
      g.restore();
      hand(g, 12, -22, L, 2.8);
      emblem(g, tribe, -4, -26, 0.5, lt(C, 0.4));
      break;
    }
    case 'balloon': {
      shadow(g, 0, 0, 12, 3.4, 0.16);
      // ropes
      for (const [a, b] of [[-17, -6], [17, 6], [-7, -3], [7, 3]]) line(g, a, -60, b, -36, 0x6b5434, 0.8);
      // envelope
      g.save();
      g.beginPath(); g.moveTo(-8, -58); g.bezierCurveTo(-30, -66, -32, -104, 0, -108); g.bezierCurveTo(32, -104, 30, -66, 8, -58); g.closePath();
      g.save(); g.clip();
      fill(g, css(0xf5ecd6));
      for (let k = -3; k <= 3; k += 2) {
        g.beginPath(); g.ellipse(k * 5.2, -84, 5.2 * (1 - Math.abs(k) * 0.12), 30, 0, 0, TAU); fill(g, css(k === 1 || k === -1 ? C : dk(C, 0.12)));
      }
      fill(g, 'transparent');
      g.beginPath(); g.ellipse(-10, -94, 7, 10, -0.4, 0, TAU); fill(g, 'rgba(255,255,255,.35)');
      g.restore();
      g.beginPath(); g.moveTo(-8, -58); g.bezierCurveTo(-30, -66, -32, -104, 0, -108); g.bezierCurveTo(32, -104, 30, -66, 8, -58); g.closePath(); stroke(g, INKS, 1.6);
      // gore lines
      for (const k of [-10.4, 0, 10.4]) { g.beginPath(); g.moveTo(k * 0.5, -58); g.quadraticCurveTo(k * 1.7, -84, k * 0.6, -107); g.lineWidth = 0.8; g.strokeStyle = 'rgba(42,33,64,.45)'; g.stroke(); }
      g.restore();
      rr(g, -9, -61, 18, 4, 1.5); fs(g, css(0x8a6a3a), 1.1);
      // burner glow
      circ(g, 0, -55, 3.5); fill(g, 'rgba(255,170,60,.7)');
      // basket
      rr(g, -9, -37, 18, 12, 2.5); fs(g, lg(g, 0, -37, 0, -25, [[0, 0xd6a35c], [1, 0x9a6a32]]));
      g.beginPath(); for (let k = -6; k <= 6; k += 4) { g.moveTo(k, -37); g.lineTo(k, -25); } g.moveTo(-9, -31); g.lineTo(9, -31); g.lineWidth = 0.7; g.strokeStyle = 'rgba(80,50,20,.6)'; g.stroke();
      head(g, 1, -42, 6.5, L, tribe);
      // sandbags
      for (const sx of [-10.5, 10.5]) { ell(g, sx, -27, 2.6, 3.2); fs(g, css(0xc7b28a), 1); }
      break;
    }
    case 'giant': {
      shadow(g, 0, 0, 30, 7.5);
      g.save(); g.scale(GIANT_SCALE, GIANT_SCALE);
      giantBody(g, C, L, tribe);
      g.restore();
      break;
    }
    default: break;
  }
}

function drawBoat(g, kind, C, L, tribe, rider) {
  const big = rider === 'giant';
  // water ripple base
  ell(g, 0, 0, big ? 42 : 34, 6); fill(g, 'rgba(255,255,255,.22)');
  const hull = kind === 'battleship' ? 0x4a4858 : kind === 'ship' ? 0x8a5530 : 0xa66c3a;
  const len = (kind === 'boat' ? 30 : 37) + (big ? 7 : 0);
  // mast(s) and sails behind/above
  const mast = (x, h) => { line(g, x, -12, x, -12 - h, INK, 3.6); line(g, x, -12, x, -12 - h, WOOD_D, 2); };
  if (kind === 'boat') {
    mast(-2, 46);
    g.beginPath(); g.moveTo(0, -56); g.quadraticCurveTo(20, -38, 22, -16); g.lineTo(0, -16); g.closePath();
    fs(g, lg(g, 0, -56, 22, -16, [[0, 0xfffaf0], [1, 0xe6dcc6]]), 1.3);
    g.save(); g.clip(); g.beginPath(); g.moveTo(0, -34); g.lineTo(24, -34); g.lineTo(24, -28); g.lineTo(0, -28); fill(g, css(C)); g.restore();
    g.beginPath(); g.moveTo(0, -56); g.quadraticCurveTo(20, -38, 22, -16); g.lineTo(0, -16); g.closePath(); stroke(g, INKS, 1.3);
  } else {
    mast(-10, kind === 'battleship' ? 54 : 50); mast(12, 42);
    const sq = (x, top, w, h, c) => {
      g.beginPath(); g.moveTo(x - w / 2, top); g.quadraticCurveTo(x, top - 3, x + w / 2, top); g.quadraticCurveTo(x + w / 2 + 3, top + h / 2, x + w / 2, top + h);
      g.quadraticCurveTo(x, top + h + 3, x - w / 2, top + h); g.quadraticCurveTo(x - w / 2 + 3, top + h / 2, x - w / 2, top); g.closePath();
      fs(g, lg(g, x - w / 2, top, x + w / 2, top + h, [[0, lt(c, 0.25)], [1, dk(c, 0.1)]]), 1.3);
    };
    sq(-10, -58, 26, 16, kind === 'battleship' ? C : 0xf7f0de); sq(-10, -38, 30, 16, 0xf7f0de);
    sq(12, -48, 22, 14, kind === 'battleship' ? 0xf7f0de : C); sq(12, -30, 24, 13, 0xf7f0de);
    emblem(g, tribe, -10, -30, 0.7, kind === 'battleship' ? 0x6a6a7a : C);
    // flag
    poly(g, [-10, -66, 2, -63, -10, -60]); fs(g, css(C), 1);
  }
  if (big) {
    // the giant sits in the hull: only the upper body shows above the gunwale, his legs are hidden by the planks
    const gx = kind === 'boat' ? -15 : 1;
    g.save(); g.beginPath(); g.rect(-120, -220, 240, 214); g.clip();
    g.translate(gx, 10); g.scale(GIANT_SCALE * 0.82, GIANT_SCALE * 0.82);
    giantBody(g, C, L, tribe);
    g.restore();
  }
  // hull
  g.beginPath(); g.moveTo(-len, -14); g.lineTo(len - 6, -14); g.quadraticCurveTo(len + 6, -14, len + 9, -20);
  g.quadraticCurveTo(len + 4, -2, len - 8, 0); g.lineTo(-len + 6, 0); g.quadraticCurveTo(-len - 2, -4, -len, -14); g.closePath();
  fs(g, lg(g, 0, -20, 0, 0, [[0, lt(hull, 0.18)], [1, dk(hull, 0.25)]]));
  g.save(); g.clip();
  if (kind === 'battleship') {
    rr(g, -len - 2, -5, len * 2 + 12, 6, 0); fill(g, css(0xa83a32));
    for (let k = -len + 8; k < len - 4; k += 10) { circ(g, k, -9, 2.4); fs(g, css(0x1d1c26), 1); }
    for (let k = -len + 3; k < len; k += 5) { circ(g, k, -12.5, 0.6); fill(g, 'rgba(255,255,255,.4)'); }
  } else {
    for (const yy of [-9.5, -5]) { g.beginPath(); g.moveTo(-len - 2, yy); g.lineTo(len + 8, yy); g.lineWidth = 0.8; g.strokeStyle = rgba(dk(hull, 0.45), 0.7); g.stroke(); }
    rr(g, -len - 2, -15, len * 2 + 12, 3, 0); fill(g, css(C));
  }
  g.restore();
  g.beginPath(); g.moveTo(-len, -14); g.lineTo(len - 6, -14); g.quadraticCurveTo(len + 6, -14, len + 9, -20);
  g.quadraticCurveTo(len + 4, -2, len - 8, 0); g.lineTo(-len + 6, 0); g.quadraticCurveTo(-len - 2, -4, -len, -14); g.closePath(); stroke(g, INKS, 1.5);
  // passenger (a giant is already aboard, filling the deck)
  if (!big) head(g, kind === 'boat' ? -12 : -24, -20, 6.2, L, tribe);
  // foam
  for (const [x, r] of [[len + 7, 3], [len + 2, 2.2], [-len + 1, 2.4]]) { circ(g, x, -1, r); fill(g, 'rgba(255,255,255,.8)'); }
}
ART.drawUnit = drawUnit;

// ---------------------------------------------------------------- terrain features
function pine(g, x, y, s, leaf, snow) {
  g.save(); g.translate(x, y); g.scale(s, s);
  shadow(g, 2, 0, 9, 3, 0.22);
  rr(g, -2, -8, 4, 9, 1); fs(g, css(0x6e4a2d), 1.1);
  const tiers = [[-7, 13, 12], [-15, 11, 11], [-22, 8, 10]];
  tiers.forEach(([ty, w, hgt], k) => {
    g.beginPath(); g.moveTo(-w, ty); g.quadraticCurveTo(0, ty + 3, w, ty); g.lineTo(0, ty - hgt - 4); g.closePath();
    fs(g, lg(g, -w, ty - hgt, w, ty, [[0, lt(leaf, 0.22 + k * 0.05)], [0.6, leaf], [1, dk(leaf, 0.25)]]), 1.2);
    if (snow) { g.beginPath(); g.moveTo(-w * 0.45, ty - hgt * 0.55); g.lineTo(0, ty - hgt - 4); g.lineTo(w * 0.45, ty - hgt * 0.55); g.quadraticCurveTo(0, ty - hgt * 0.35, -w * 0.45, ty - hgt * 0.55); fill(g, 'rgba(255,255,255,.92)'); }
  });
  g.restore();
}
function broadleaf(g, x, y, s, leaf) {
  g.save(); g.translate(x, y); g.scale(s, s);
  shadow(g, 2, 0, 10, 3.2, 0.22);
  g.beginPath(); g.moveTo(-2.4, 0); g.lineTo(-1.6, -12); g.lineTo(-5, -17); g.lineTo(-3.5, -18); g.lineTo(0, -14); g.lineTo(3, -19); g.lineTo(4.4, -18); g.lineTo(1.8, -12); g.lineTo(2.4, 0); g.closePath(); fs(g, css(0x7a5232), 1.1);
  const blobs = [[-6, -20, 8], [6, -21, 8], [0, -27, 9.5], [-1, -18, 8]];
  g.beginPath(); for (const [bx, by, br] of blobs) { g.moveTo(bx + br, by); g.arc(bx, by, br, 0, TAU); }
  fill(g, lg(g, -10, -36, 10, -12, [[0, lt(leaf, 0.3)], [0.55, leaf], [1, dk(leaf, 0.22)]]));
  for (const [bx, by, br] of blobs) { circ(g, bx, by, br); stroke(g, INKS, 1.2); }
  g.beginPath(); for (const [bx, by, br] of blobs) { g.moveTo(bx + br - 0.8, by); g.arc(bx, by, br - 0.8, 0, TAU); }
  fill(g, lg(g, -10, -36, 10, -12, [[0, lt(leaf, 0.3)], [0.55, leaf], [1, dk(leaf, 0.22)]]));
  circ(g, -3, -29, 3); fill(g, 'rgba(255,255,255,.22)'); circ(g, 4, -25, 1.6); fill(g, 'rgba(255,255,255,.18)');
  g.restore();
}
ART.forest = function (g, seed, sk, snow) {
  const r = k => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const spots = [[-18, -4], [18, -10], [2, 14], [24, 14], [-26, 20]];
  const n = 2 + (r(1) > 0.55 ? 1 : 0);
  const pts = spots.slice(0, n).map((p, k) => [p[0] + (r(k + 2) - 0.5) * 8, p[1] + (r(k + 7) - 0.5) * 6, k]).sort((a, b) => a[1] - b[1]);
  for (const [x, y, k] of pts) {
    const s = 0.9 + r(k + 11) * 0.35, leaf = sk.leaf[(k + (r(3) * 3) | 0) % sk.leaf.length];
    if (snow || r(k + 5) > 0.4) pine(g, x, y, s, leaf, snow); else broadleaf(g, x, y, s * 0.95, leaf);
  }
};
ART.mountain = function (g, seed, sk, snowAll) {
  const r = k => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const peak = (x, base, w, hgt, rock, snow, s2) => {
    shadow(g, x + 2, base, w * 0.9, 4, 0.2);
    const tx = x + (r(s2) - 0.5) * w * 0.25, ty = base - hgt;
    poly(g, [x - w, base, tx, ty, x + w, base]); fill(g, lg(g, x - w, ty, x + w, base, [[0, lt(rock, 0.18)], [1, dk(rock, 0.1)]]));
    // shaded right face
    poly(g, [tx, ty, x + w, base, x + w * 0.15, base, tx + w * 0.12, ty + hgt * 0.45]); fill(g, rgba(dk(rock, 0.35), 0.55));
    // ridge strokes
    g.beginPath(); g.moveTo(tx - w * 0.15, ty + hgt * 0.35); g.lineTo(tx - w * 0.35, ty + hgt * 0.62); g.moveTo(tx + w * 0.05, ty + hgt * 0.55); g.lineTo(tx - w * 0.05, ty + hgt * 0.8); g.lineWidth = 0.9; g.strokeStyle = rgba(dk(rock, 0.5), 0.5); g.stroke();
    if (snow) {
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + w * 0.34, ty + hgt * 0.33); g.lineTo(tx + w * 0.18, ty + hgt * 0.28); g.lineTo(tx + w * 0.06, ty + hgt * 0.38);
      g.lineTo(tx - w * 0.08, ty + hgt * 0.27); g.lineTo(tx - w * 0.2, ty + hgt * 0.36); g.lineTo(tx - w * 0.33, ty + hgt * 0.31); g.closePath();
      fs(g, lg(g, tx - w * 0.3, ty, tx + w * 0.3, ty + hgt * 0.4, [[0, 0xffffff], [1, 0xd8e2f0]]), 1.1);
    }
    poly(g, [x - w, base, tx, ty, x + w, base]); stroke(g, INKS, 1.4);
  };
  peak(-18, -4, 18, 34, sk.peak[1], snowAll, 21);
  peak(6, 16, 30, 58, sk.peak[0], true, 22);
  // boulders
  for (const [bx, by, br] of [[-28, 22, 4.5], [30, 20, 3.6]]) { ell(g, bx, by, br * 1.3, br); fs(g, css(lt(sk.peak[2], 0.1)), 1.1); }
};

// ---------------------------------------------------------------- resources & improvements
ART.resource = function (g, kind, seed) {
  switch (kind) {
    case 'fruit': {
      for (const [bx, by, s] of [[-14, 6, 1], [12, 12, 0.85]]) {
        g.save(); g.translate(bx, by); g.scale(s, s);
        shadow(g, 0, 2, 13, 3.5, 0.22);
        const blobs = [[-7, -6, 7.5], [6, -7, 7], [0, -12, 8], [-1, -4, 7]];
        g.beginPath(); for (const [x, y, rr2] of blobs) { g.moveTo(x + rr2, y); g.arc(x, y, rr2, 0, TAU); }
        fill(g, lg(g, 0, -20, 0, 2, [[0, 0x8fd16a], [1, 0x3f8a3a]]));
        for (const [x, y, rr2] of blobs) { circ(g, x, y, rr2); stroke(g, INKS, 1.1); }
        g.beginPath(); for (const [x, y, rr2] of blobs) { g.moveTo(x + rr2 - 0.7, y); g.arc(x, y, rr2 - 0.7, 0, TAU); } fill(g, lg(g, 0, -20, 0, 2, [[0, 0x8fd16a], [1, 0x3f8a3a]]));
        for (const [x, y] of [[-7, -9], [4, -13], [7, -4], [-2, -3], [-1, -15]]) { circ(g, x, y, 2.6); fs(g, rg(g, x - 0.8, y - 0.8, 3, [[0, 0xffb0a0], [0.4, 0xf0503c], [1, 0xa82820]]), 0.9); circ(g, x - 0.8, y - 0.9, 0.7); fill(g, 'rgba(255,255,255,.8)'); }
        g.restore();
      }
      break;
    }
    case 'crop': {
      // a low patch of wild wheat lying on the ground
      ell(g, 0, 4, 32, 16); fs(g, rg(g, -6, 0, 34, [[0, 0xf3d878], [1, 0xc99a34]]), 1.2);
      for (let r2 = 0; r2 < 4; r2++) for (let k = 0; k < 5 - (r2 % 2); k++) {
        const x = -20 + k * 10 + (r2 % 2) * 5, y = -6 + r2 * 6;
        if ((x * x) / 900 + ((y - 4) * (y - 4)) / 196 > 1) continue;
        for (const dx of [-1.6, 0, 1.6]) { line(g, x + dx, y + 2, x + dx * 1.6, y - 4, 0xb08a2a, 1); ell(g, x + dx * 1.7, y - 5, 1.2, 2, dx * 0.3); fill(g, css(0xffe08a)); }
      }
      break;
    }
    case 'game': {
      g.save(); g.translate(4, 10);
      shadow(g, 0, 0, 14, 3.4, 0.24);
      const fur = 0xb0703a;
      for (const [lx, back] of [[-8, true], [8, true]]) { rr(g, lx - 1.4, -12, 2.8, 12, 1); fs(g, css(dk(fur, back ? 0.2 : 0)), 1); }
      ell(g, 0, -15, 12, 6); fs(g, lg(g, 0, -21, 0, -9, [[0, lt(fur, 0.15)], [1, dk(fur, 0.15)]]));
      ell(g, -2, -11.5, 7, 2.2); fill(g, 'rgba(255,240,220,.55)');
      circ(g, -11, -17, 2.2); fs(g, css(0xfaf3e6), 1);
      for (const lx of [-6, 9]) { rr(g, lx - 1.4, -12, 2.8, 12, 1); fs(g, css(fur), 1); }
      g.beginPath(); g.moveTo(8, -19); g.lineTo(12, -28); g.lineTo(16, -26); g.lineTo(13, -17); g.closePath(); fs(g, css(fur), 1.1);
      ell(g, 16, -28, 5, 3.4, 0.3); fs(g, css(lt(fur, 0.05)), 1.1);
      circ(g, 17, -29, 0.9); fill(g, INKS);
      g.beginPath(); g.moveTo(13, -31); g.lineTo(11, -38); g.lineTo(8, -40); g.moveTo(11, -38); g.lineTo(13, -41); g.moveTo(15, -31); g.lineTo(17, -38); g.lineTo(15, -41); g.moveTo(17, -38); g.lineTo(20, -40);
      g.lineCap = 'round'; g.lineWidth = 2.6; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 1.3; g.strokeStyle = css(0xe9dcc0); g.stroke();
      g.restore();
      break;
    }
    case 'fish': {
      for (const [rx, ry, s] of [[-14, 10, 1], [16, -8, 0.7]]) { g.beginPath(); g.ellipse(rx, ry, 12 * s, 4 * s, 0, 0, TAU); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke(); }
      ART.fishBody(g, 6, -2, 1, 0.2);
      break;
    }
    case 'whale': {
      for (const [rx, ry, s] of [[-2, 14, 1.3], [20, 4, 0.7]]) { g.beginPath(); g.ellipse(rx, ry, 18 * s, 5 * s, 0, 0, TAU); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(); }
      // back and tail breaking the surface
      g.beginPath(); g.moveTo(-24, 12); g.bezierCurveTo(-20, -6, 8, -10, 16, 10); g.closePath();
      fs(g, lg(g, 0, -8, 0, 12, [[0, 0x5a7fa8], [1, 0x2f4f78]]), 1.3);
      g.beginPath(); g.moveTo(-14, 2); g.bezierCurveTo(-6, -4, 4, -4, 10, 4); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
      circ(g, 10, 4, 1.2); fill(g, INKS);
      g.save(); g.translate(22, 6); g.rotate(-0.5);
      g.beginPath(); g.moveTo(0, 4); g.quadraticCurveTo(-2, -4, -9, -8); g.quadraticCurveTo(-2, -6, 0, -2); g.quadraticCurveTo(2, -6, 9, -8); g.quadraticCurveTo(2, -4, 0, 4); g.closePath();
      fs(g, css(0x3f6590), 1.2); g.restore();
      // spout
      for (const [dx, h2] of [[-3, 18], [0, 22], [3, 18]]) { g.beginPath(); g.moveTo(-6, -6); g.quadraticCurveTo(-6 + dx, -6 - h2 * 0.6, -6 + dx * 2.6, -6 - h2 * 0.8); g.lineWidth = 2.2; g.strokeStyle = 'rgba(220,245,255,.9)'; g.stroke(); }
      for (const [dx, dy] of [[-14, -22], [2, -24], [-6, -27]]) { circ(g, dx, dy, 1.8); fill(g, 'rgba(220,245,255,.9)'); }
      break;
    }
    case 'ore': {
      ell(g, 0, 12, 20, 6); fs(g, lg(g, 0, 6, 0, 18, [[0, 0x9a9488], [1, 0x6a645a]]), 1.2);
      const xs = [[-8, 10, 6, 19, -0.25], [3, 9, 7, 24, 0.05], [12, 12, 5, 15, 0.35]];
      for (const [x, y, w, hgt, a] of xs) {
        g.save(); g.translate(x, y); g.rotate(a);
        poly(g, [-w, 0, -w * 0.8, -hgt * 0.8, 0, -hgt, w * 0.8, -hgt * 0.8, w, 0]); fill(g, css(0x7a5ce0));
        poly(g, [0, -hgt, w * 0.8, -hgt * 0.8, w, 0, 0, 0]); fill(g, css(0x5236b8));
        poly(g, [-w * 0.8, -hgt * 0.8, 0, -hgt, -w * 0.15, -hgt * 0.4, -w * 0.6, -hgt * 0.35]); fill(g, 'rgba(230,220,255,.7)');
        poly(g, [-w, 0, -w * 0.8, -hgt * 0.8, 0, -hgt, w * 0.8, -hgt * 0.8, w, 0]); stroke(g, INKS, 1.2);
        g.restore();
      }
      break;
    }
  }
};
ART.fishBody = function (g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot || 0); g.scale(s, s);
  g.beginPath(); g.moveTo(-11, 0); g.quadraticCurveTo(-2, -8, 9, -1); g.quadraticCurveTo(-2, 7, -11, 0); g.closePath();
  fs(g, lg(g, 0, -7, 0, 6, [[0, 0xffd26a], [0.5, 0xff9a3a], [1, 0xe0602a]]), 1.2);
  poly(g, [-10, 0, -17, -6, -15.5, 0, -17, 6]); fs(g, css(0xe0602a), 1.1);
  poly(g, [-2, -5, 2, -9, 4, -4]); fs(g, css(0xffb24a), 0.9);
  circ(g, 5, -1.5, 1.4); fill(g, css(0xffffff)); circ(g, 5.4, -1.5, 0.7); fill(g, INKS);
  g.beginPath(); g.moveTo(-4, -3); g.quadraticCurveTo(-1, 0, -4, 3); g.lineWidth = 0.7; g.strokeStyle = 'rgba(160,60,20,.6)'; g.stroke();
  g.restore();
};
ART.improvement = function (g, kind, sk, color) {
  if (kind === 'temple') return ART.temple(g, color);
  if (kind === 'market') return ART.market(g, color);
  switch (kind) {
    case 'farm': {
      // a square ploughed field seen from above, rows of crops, a fence corner
      rr(g, -32, -34, 64, 60, 6); fs(g, lg(g, 0, -34, 0, 26, [[0, 0xbd8f58], [1, 0x8a5e34]]), 1.4);
      g.save(); rr(g, -32, -34, 64, 60, 6); g.clip();
      for (let k = 0; k < 6; k++) {
        const y = -29 + k * 10;
        rr(g, -30, y, 60, 5.2, 2.6); fill(g, css(k % 2 ? 0x8ec24e : 0xdcb747));
        for (let j = 0; j < 6; j++) { circ(g, -25 + j * 10, y + 1.2, 1.5); fill(g, css(k % 2 ? 0xc0e47a : 0xfff0a0)); }
        line(g, -30, y + 7.5, 30, y + 7.5, 0x6e4626, 0.8);
      }
      g.restore();
      rr(g, -32, -34, 64, 60, 6); stroke(g, INKS, 1.4);
      for (const [x, y] of [[-32, 26], [-14, 26], [32, 26], [32, 8]]) { rr(g, x - 1.6, y - 8, 3.2, 10, 1); fs(g, css(0x8a5a33), 0.9); }
      line(g, -32, 21, -14, 21, 0x8a5a33, 1.4); line(g, 32, 21, 32, 3, 0x8a5a33, 1.4);
      break;
    }
    case 'mine': {
      ell(g, -4, 8, 30, 14); fs(g, lg(g, 0, -6, 0, 20, [[0, lt(sk.peak[2], 0.1)], [1, dk(sk.peak[2], 0.2)]]), 1.2);
      g.beginPath(); g.moveTo(-18, 10); g.lineTo(-18, -6); g.quadraticCurveTo(-8, -15, 2, -6); g.lineTo(2, 10); g.closePath(); fs(g, css(0x1e1828), 1.2);
      rr(g, -21, -9, 4.5, 20, 1); fs(g, css(WOOD), 1); rr(g, 0, -9, 4.5, 20, 1); fs(g, css(WOOD), 1); rr(g, -22, -12, 28, 4.5, 1); fs(g, css(lt(WOOD, 0.1)), 1);
      // cart
      rr(g, 10, 2, 16, 9, 2); fs(g, lg(g, 10, 2, 26, 11, [[0, 0x8a8e96], [1, 0x50545c]]), 1.2);
      for (const [x, y] of [[13, 0], [18, -1], [22, 0.5]]) { poly(g, [x - 2.5, y + 2, x, y - 3, x + 2.5, y + 2]); fs(g, css(0x8a6cf0), 0.8); }
      for (const x of [14, 22]) { circ(g, x, 12, 2.4); fs(g, css(0x3a3640), 1); }
      line(g, 4, 15, 36, 15, 0x6a5a48, 1.2);
      break;
    }
    case 'lumber': {
      shadow(g, 0, 18, 24, 4, 0.22);
      // cabin
      g.save(); g.translate(-6, 14);
      for (let k = 0; k < 4; k++) { rr(g, -16, -5 - k * 5, 32, 5, 2.5); fs(g, lg(g, 0, -5 - k * 5, 0, -k * 5, [[0, 0xc4895a], [1, 0x8a5a33]]), 1); }
      rr(g, -3.5, -12, 7, 12, 1); fs(g, css(0x4a3020), 1);
      poly(g, [-20, -19, 0, -33, 20, -19]); fs(g, lg(g, 0, -33, 0, -19, [[0, 0xa8452e], [1, 0x7a2e20]]));
      line(g, -14, -23, 14, -23, 0x5a2014, 0.8);
      g.restore();
      // log pile
      for (const [x, y] of [[20, 14], [27, 14], [23.5, 8]]) { circ(g, x, y, 3.6); fs(g, css(0xc89b62), 1.1); circ(g, x, y, 1.6); g.lineWidth = 0.6; g.strokeStyle = 'rgba(90,58,30,.7)'; g.stroke(); }
      // stump with axe
      ell(g, -30, 18, 5, 2.4); fs(g, css(0xd6aa70), 1); line(g, -30, 18, -26, 8, WOOD_D, 1.6); poly(g, [-27, 7, -22, 6, -24, 11]); fs(g, css(METAL), 0.9);
      break;
    }
    case 'port': {
      // a plank pier running along the tile's long axis, a boathouse at its root, a rowboat moored alongside
      const C = color == null ? 0xd9443a : color;
      const L2 = (a, b, t) => a + (b - a) * t;
      const ripple = (x, y, s) => { g.beginPath(); g.ellipse(x, y, 7 * s, 2.6 * s, 0, 0, TAU); g.lineWidth = 1.1; g.strokeStyle = 'rgba(255,255,255,.65)'; g.stroke(); };
      const post = (x, y, hh) => { ripple(x, y + hh, 0.8); rr(g, x - 1.9, y - 1, 3.8, hh + 1, 1.2); fs(g, lg(g, x - 2, 0, x + 2, 0, [[0, 0x7a4f2a], [1, 0x4a2e16]]), 1); circ(g, x, y - 1, 1.9); fs(g, css(0x8a5a33), 0.8); };
      for (const [rx, ry, s] of [[34, 18, 1.1], [-38, -4, 0.9], [-2, 34, 1]]) ripple(rx, ry, s);
      post(-19, -25, 9); post(31, 9, 9);
      // rowboat behind the pier, tied to the far post
      g.save(); g.translate(18, -16); g.rotate(0.58);
      g.beginPath(); g.moveTo(-13, -2); g.quadraticCurveTo(0, 6, 14, -2); g.lineTo(11, -5.5); g.lineTo(-11, -5.5); g.closePath();
      fs(g, lg(g, 0, -6, 0, 5, [[0, 0xc08a52], [1, 0x7a4a24]]), 1.1);
      line(g, -10, -4, 10, -4, C, 1.6);
      line(g, -5, -7.5, 7, -1.5, 0xe0cba0, 1.1);
      g.restore();
      // deck top
      poly(g, [-37, -12, -20, -27, 33, 7, 16, 22]);
      fs(g, lg(g, -37, -27, 33, 22, [[0, 0xd8ac72], [0.6, 0xc08a52], [1, 0xa4733f]]), 1.3);
      for (let k = 1; k < 7; k++) { const t = k / 7; line(g, L2(-37, 16, t), L2(-12, 22, t), L2(-20, 33, t), L2(-27, 7, t), 0x7a4f2a, 0.7); }
      for (let k = 0; k < 7; k++) { const t = (k + 0.5) / 7; for (const u of [0.18, 0.82]) { const x = L2(L2(-37, -20, u), L2(16, 33, u), t), y = L2(L2(-12, -27, u), L2(22, 7, u), t); circ(g, x, y, 0.55); fill(g, 'rgba(60,35,20,.7)'); } }
      // deck edges facing the viewer
      poly(g, [-37, -12, 16, 22, 16, 26, -37, -8]); fs(g, css(0x7a4f2a), 1.1);
      poly(g, [16, 22, 33, 7, 33, 11, 16, 26]); fs(g, css(0x5e3a1d), 1.1);
      post(-35, -6, 8); post(-10, 10, 8); post(16, 27, 8);
      // boathouse at the landward end
      g.save(); g.translate(-23, -17);
      shadow(g, 1, 0.5, 11, 2.6, 0.22);
      rr(g, -9, -12, 18, 12, 1); fs(g, lg(g, -9, 0, 9, 0, [[0, 0xefdcb4], [1, 0xbd9e70]]));
      for (let k = -6; k <= 6; k += 4) line(g, k, -11, k, -1, 0x9a7a50, 0.6);
      rr(g, -2.6, -8.5, 5.2, 8.5, 1); fs(g, css(0x4a3020), 0.9);
      poly(g, [-12.5, -11, 0, -21.5, 12.5, -11]); fs(g, lg(g, 0, -21.5, 0, -11, [[0, lt(C, 0.25)], [1, dk(C, 0.2)]]));
      line(g, -9, -13.2, 9, -13.2, dk(C, 0.35), 0.7);
      line(g, 0, -21.5, 0, -33, 0x5e3a1d, 1.5);
      g.beginPath(); g.moveTo(0, -33); g.quadraticCurveTo(5, -31.5, 10, -30.5); g.quadraticCurveTo(5, -29, 0, -27.5); g.closePath(); fs(g, css(C), 0.9);
      g.restore();
      // cargo
      rr(g, 1, -9, 8, 7, 1.2); fs(g, lg(g, 1, -9, 9, -2, [[0, 0xc8915a], [1, 0x9a6a3a]]), 1); line(g, 1, -9, 9, -2, 0x7a4a24, 0.6); line(g, 9, -9, 1, -2, 0x7a4a24, 0.6);
      rr(g, 3, -15.5, 6, 6, 1); fs(g, css(0xb88350), 1);
      ell(g, 13, -3.5, 3.2, 4); fs(g, lg(g, 10, -7, 16, 0, [[0, 0x9a6a3a], [1, 0x6e4523]]), 1);
      line(g, 9.9, -4.6, 16.1, -4.6, 0x3a2a20, 0.7); line(g, 9.9, -2, 16.1, -2, 0x3a2a20, 0.7);
      // lantern at the pier head
      line(g, 26, 7, 26, -10, 0x3a2a20, 1.7);
      line(g, 26, -10, 29.5, -10, 0x3a2a20, 1.2);
      circ(g, 29.5, -6.5, 7); fill(g, 'rgba(255,211,106,.22)');
      rr(g, 27.4, -9, 4.2, 5.2, 1.2); fs(g, css(0x3a3640), 0.9); circ(g, 29.5, -6.4, 1.5); fill(g, css(0xffd36a));
      // mooring rope
      g.beginPath(); g.moveTo(31, 6); g.quadraticCurveTo(28, -6, 22, -14); g.lineWidth = 0.9; g.strokeStyle = css(0xe0cba0); g.stroke();
      break;
    }
  }
};
ART.temple = function (g, color) {
  const C = color == null ? 0xd9a441 : color;
  shadow(g, 0, 14, 26, 5, 0.22);
  rr(g, -24, 6, 48, 8, 2); fs(g, lg(g, 0, 6, 0, 14, [[0, 0xe9e2d2], [1, 0xb8b0a0]]));
  rr(g, -20, 0, 40, 7, 2); fs(g, css(0xd8d0bf), 1.1);
  for (const x of [-15, -5, 5, 15]) { rr(g, x - 2.6, -22, 5.2, 22, 1); fs(g, lg(g, x - 2.6, 0, x + 2.6, 0, [[0, 0xfffaf0], [1, 0xc9c1b0]]), 1); }
  rr(g, -22, -26, 44, 5, 1.5); fs(g, css(0xe6dfcf), 1.1);
  poly(g, [-25, -26, 0, -40, 25, -26]); fs(g, lg(g, 0, -40, 0, -26, [[0, lt(C, 0.3)], [1, dk(C, 0.15)]]));
  circ(g, 0, -31, 3); fs(g, css(0xfff3b0), 0.9);
  circ(g, 0, -12, 9); fill(g, rg(g, 0, -12, 9, [[0, 'rgba(255,236,160,.6)'], [1, 'rgba(255,236,160,0)']]));
  ell(g, 0, -6, 3, 4); fs(g, css(0xffc94a), 0.9);
};
ART.milestone = function (g) {
  g.beginPath(); g.moveTo(-34, 22); g.quadraticCurveTo(-6, 6, 4, -4); g.quadraticCurveTo(14, -14, 34, -18); g.lineTo(34, -8); g.quadraticCurveTo(18, -4, 10, 6); g.quadraticCurveTo(0, 18, -22, 30); g.closePath();
  fs(g, lg(g, 0, -18, 0, 30, [[0, 0xd8b98a], [1, 0xa8885a]]), 1.2);
  for (const [x, y] of [[-20, 20], [-6, 10], [8, 0], [22, -8]]) { ell(g, x, y, 3, 1.5, -0.5); fill(g, 'rgba(110,80,50,.45)'); }
  rr(g, 10, -24, 9, 22, 4); fs(g, lg(g, 10, 0, 19, 0, [[0, 0xe6dfcf], [1, 0xa8a090]]), 1.2);
  line(g, 12, -16, 17, -16, 0x7a7266, 1); line(g, 12, -12, 17, -12, 0x7a7266, 1);
};
ART.market = function (g, color) {
  const C = color == null ? 0xd9443a : color;
  shadow(g, 0, 14, 24, 5, 0.22);
  rr(g, -20, -2, 40, 14, 2); fs(g, lg(g, 0, -2, 0, 12, [[0, 0xc89b62], [1, 0x8a5a33]]));
  for (const x of [-18, 16]) { rr(g, x, -26, 3, 26, 1); fs(g, css(0x6e4a2d), 1); }
  g.beginPath(); g.moveTo(-24, -24); g.lineTo(24, -24); g.lineTo(20, -14); for (let k = 4; k >= -4; k--) g.quadraticCurveTo(k * 5 + 2.5, -9, k * 5, -14); g.closePath();
  g.save(); g.clip(); for (let k = -5; k < 5; k++) { rr(g, k * 5, -26, 5, 20, 0); fill(g, css(k % 2 ? C : 0xfff3e0)); } g.restore();
  g.beginPath(); g.moveTo(-24, -24); g.lineTo(24, -24); g.lineTo(20, -14); g.lineTo(-20, -14); g.closePath(); stroke(g, INKS, 1.2);
  for (const [x, c] of [[-10, 0xf0503c], [-2, 0xf0c94a], [7, 0x8fd16a]]) { circ(g, x, -5, 3.6); fs(g, css(c), 1); }
  circ(g, 14, -6, 4); fs(g, rg(g, 13, -7, 5, [[0, 0xfff3b0], [1, 0xd9a441]]), 1);
};
ART.trident = function (g) {
  for (const [rx, ry, s] of [[0, 20, 1.4], [-14, 10, 0.8]]) { g.beginPath(); g.ellipse(rx, ry, 16 * s, 4.5 * s, 0, 0, TAU); g.lineWidth = 1.2; g.strokeStyle = 'rgba(160,230,255,.8)'; g.stroke(); }
  line(g, 0, 22, 0, -24, INK, 5); line(g, 0, 22, 0, -24, 0xe8c25a, 3);
  g.beginPath(); g.moveTo(-12, -16); g.quadraticCurveTo(-12, -6, 0, -6); g.quadraticCurveTo(12, -6, 12, -16); g.lineWidth = 5; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 3; g.strokeStyle = css(0xe8c25a); g.stroke();
  for (const x of [-12, 0, 12]) { poly(g, [x - 3.5, -18, x, -30 - (x ? 0 : 4), x + 3.5, -18]); fs(g, lg(g, x - 3, -30, x + 3, -18, [[0, 0xffffff], [1, METAL_D]]), 1.1); }
};
ART.ruin = function (g) {
  shadow(g, 0, 12, 26, 5, 0.22);
  const col = (x, h, broken) => {
    rr(g, x - 5.5, 12 - h, 11, h, 1.5); fs(g, lg(g, x - 5, 0, x + 5, 0, [[0, 0xe6dfcf], [1, 0x9e9686]]));
    for (const fx of [-2, 1.5]) line(g, x + fx, 14 - h, x + fx, 10, 0x8a8274, 0.6);
    rr(g, x - 7, 9, 14, 4, 1); fs(g, css(0xc9c1b0), 1);
    if (!broken) { rr(g, x - 7, 10 - h, 14, 4, 1); fs(g, css(0xd8d0bf), 1); }
    else { poly(g, [x - 5.5, 12 - h, x - 2, 9 - h, x + 1, 13 - h, x + 5.5, 10 - h]); fs(g, css(0xd8d0bf), 1); }
  };
  col(-14, 34, false); col(14, 24, true);
  rr(g, -22, -26, 30, 6, 1.5); fs(g, lg(g, 0, -26, 0, -20, [[0, 0xeee7d6], [1, 0xb0a898]]));
  // fallen block + vines
  g.save(); g.translate(20, 16); g.rotate(0.25); rr(g, -9, -4, 18, 7, 1.5); fs(g, css(0xc9c1b0), 1); g.restore();
  g.beginPath(); g.moveTo(-18, -20); g.quadraticCurveTo(-22, -6, -16, 4); g.lineWidth = 1.4; g.strokeStyle = css(0x4f9a3f); g.stroke();
  for (const [x, y] of [[-20, -12], [-18, -4], [-17, 2]]) { ell(g, x, y, 2.2, 1.3, 0.6); fill(g, css(0x6fbf4a)); }
  // rune glow
  circ(g, 0, -4, 12); fill(g, rg(g, 0, -4, 12, [[0, 'rgba(143,240,255,.55)'], [1, 'rgba(143,240,255,0)']]));
  poly(g, [0, -10, 4, -4, 0, 2, -4, -4]); fs(g, css(0xbff8ff), 1);
};

// ---------------------------------------------------------------- buildings & cities
function house(g, x, y, s, style, roofC, wallC, opts) {
  opts = opts || {};
  g.save(); g.translate(x, y); g.scale(s, s);
  shadow(g, 1, 0.5, 13, 3, 0.22);
  const win = opts.night ? 0xffd36a : 0x3a3050;
  if (style === 'thatch') {
    rr(g, -9, -12, 18, 12, 3); fs(g, lg(g, -9, 0, 9, 0, [[0, lt(wallC, 0.1)], [1, dk(wallC, 0.15)]]));
    rr(g, -2.5, -8, 5, 8, 2.5); fs(g, css(0x5a3a22), 1);
    g.beginPath(); g.moveTo(-13, -10); g.quadraticCurveTo(-6, -30, 0, -31); g.quadraticCurveTo(6, -30, 13, -10); g.quadraticCurveTo(0, -7, -13, -10); g.closePath();
    fs(g, lg(g, -13, -31, 13, -8, [[0, lt(roofC, 0.25)], [1, dk(roofC, 0.2)]]));
    g.beginPath(); for (let k = -9; k <= 9; k += 4.5) { g.moveTo(k * 0.25, -29); g.quadraticCurveTo(k * 0.8, -20, k, -10); } g.lineWidth = 0.7; g.strokeStyle = rgba(dk(roofC, 0.45), 0.6); g.stroke();
  } else if (style === 'dome') {
    rr(g, -10, -13, 20, 13, 1.5); fs(g, lg(g, -10, 0, 10, 0, [[0, lt(wallC, 0.12)], [1, dk(wallC, 0.15)]]));
    g.beginPath(); g.moveTo(-3, 0); g.lineTo(-3, -6); g.arc(0, -6, 3, PI, 0); g.lineTo(3, 0); fs(g, css(0x5a3a22), 1);
    g.beginPath(); g.moveTo(-11, -13); g.bezierCurveTo(-11, -27, 11, -27, 11, -13); g.closePath(); fs(g, lg(g, -10, -26, 10, -13, [[0, lt(roofC, 0.35)], [0.6, roofC], [1, dk(roofC, 0.2)]]));
    line(g, 0, -24, 0, -29, GOLD, 1.4); circ(g, 0, -30, 1.6); fs(g, css(GOLD), 0.8);
    g.beginPath(); g.ellipse(-4, -20, 2.5, 3.6, -0.4, 0, TAU); fill(g, 'rgba(255,255,255,.35)');
  } else {
    // gable family: slate (stone), stilt, terra, snow
    const stilt = style === 'stilt';
    const by = stilt ? -5 : 0;
    if (stilt) for (const sx of [-7, 7]) { rr(g, sx - 1.2, -6, 2.4, 6, 0.5); fs(g, css(WOOD_D), 0.9); }
    rr(g, -10, by - 13, 20, 13, 1.2); fs(g, lg(g, -10, 0, 10, 0, [[0, lt(wallC, 0.1)], [1, dk(wallC, 0.18)]]));
    if (style === 'slate') { g.save(); rr(g, -10, by - 13, 20, 13, 1.2); g.clip(); for (let r2 = 0; r2 < 3; r2++) for (let c = -2; c <= 2; c++) { rr(g, c * 7 - 3 + (r2 % 2) * 3.5, by - 13 + r2 * 4.5, 6, 3.6, 0.8); g.lineWidth = 0.6; g.strokeStyle = 'rgba(60,50,70,.35)'; g.stroke(); } g.restore(); }
    if (style === 'snow' || style === 'stilt') { for (let k = -8; k <= 8; k += 4) line(g, k, by - 12, k, by - 1, dk(wallC, 0.3), 0.6); }
    rr(g, -6.5, by - 9, 4.5, 4.5, 0.8); fs(g, css(win), 0.9);
    rr(g, 1.5, by - 9, 4.5, 9, 0.8); fs(g, css(0x5a3a22), 0.9);
    poly(g, [-13, by - 12, 0, by - 25, 13, by - 12]); fs(g, lg(g, -13, by - 25, 13, by - 12, [[0, lt(roofC, 0.25)], [1, dk(roofC, 0.18)]]));
    if (style === 'terra') { g.save(); poly(g, [-13, by - 12, 0, by - 25, 13, by - 12]); g.clip(); for (let k = 0; k < 4; k++) { g.beginPath(); for (let j = -14; j < 14; j += 3.2) g.arc(j, by - 13.5 - k * 3.4, 1.6, 0, PI); g.lineWidth = 0.6; g.strokeStyle = rgba(dk(roofC, 0.45), 0.6); g.stroke(); } g.restore(); }
    if (style === 'snow') { g.beginPath(); g.moveTo(-13, by - 12); g.lineTo(0, by - 25); g.lineTo(13, by - 12); g.quadraticCurveTo(10, by - 10, 8, by - 13); g.quadraticCurveTo(4, by - 11, 0, by - 15); g.quadraticCurveTo(-5, by - 11, -9, by - 13); g.quadraticCurveTo(-11, by - 10, -13, by - 12); fs(g, css(0xffffff), 1); }
    if (!opts.noChimney) { rr(g, 5, by - 24, 3.6, 7, 0.6); fs(g, css(style === 'snow' ? 0x8a8e9a : 0x9a6a4a), 0.9); }
  }
  g.restore();
}
function keep(g, x, y, s, C, L, tribe) {
  g.save(); g.translate(x, y); g.scale(s, s);
  shadow(g, 1, 0.5, 14, 3.4, 0.24);
  rr(g, -9, -34, 18, 34, 1.5); fs(g, lg(g, -9, 0, 9, 0, [[0, lt(L.wall, 0.15)], [1, dk(L.wall, 0.2)]]));
  for (let k = -9; k < 9; k += 4.5) { rr(g, k, -38, 3, 4.5, 0.5); fs(g, css(lt(L.wall, 0.05)), 1); }
  rr(g, -3, -10, 6, 10, 3); fs(g, css(0x4a3020), 1);
  rr(g, -1.5, -26, 3, 6, 1.5); fs(g, css(0x3a3050), 0.8);
  rr(g, -9, -18, 18, 3, 0.5); fill(g, css(C));
  emblem(g, tribe, 0, -30, 0.45, lt(C, 0.1));
  g.restore();
}
ART.CITY_BOX = { x0: -62, y0: -118, x1: 62, y1: 50 };
ART.city = function (g, c, tribe, color, night) {
  // c: {level, walls, capital, workshop, parks}
  const L = ART.look(tribe), style = L.roof;
  const roofC = style === 'snow' ? 0x7d8fb0 : color;
  const lvl = Math.min(c.level, 6);
  // buildings ring the back and sides of the tile so a unit standing in front never hides the city
  const spots = [[-27, -16], [27, -18], [-31, 8], [31, 6], [-13, -32], [15, -33], [-30, 30], [30, 30]];
  const n = Math.min(spots.length, lvl + 1);
  if (c.walls) {
    g.beginPath(); g.ellipse(0, 4, 47, 38, 0, PI, TAU); g.lineWidth = 7; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 5; g.strokeStyle = css(0xb7b0a2); g.stroke();
  }
  const items = [];
  for (let k = 0; k < n; k++) items.push({ x: spots[k][0], y: spots[k][1], kind: 'house', s: 1.1 + (k < lvl - 2 ? 0.16 : 0) });
  if (c.capital) items.push({ x: 1, y: -18, kind: 'keep', s: 1.15 + Math.min(lvl, 5) * 0.04 });
  else items.push({ x: 1, y: -16, kind: 'plaza' });
  if (c.workshop) items.push({ x: 32, y: -4, kind: 'workshop' });
  for (let k = 0; k < (c.parks || 0) && k < 2; k++) items.push({ x: -34 + k * 8, y: 30, kind: 'park' });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.kind === 'house') house(g, it.x, it.y, it.s, style, roofC, L.wall, { night });
    else if (it.kind === 'keep') keep(g, it.x, it.y, it.s, color, L, tribe);
    else if (it.kind === 'plaza') { ell(g, it.x, it.y, 6, 3); fs(g, css(0xb7b0a2), 1); line(g, it.x, it.y, it.x, it.y - 26, WOOD_D, 1.6); }
    else if (it.kind === 'workshop') { house(g, it.x, it.y, 0.75, 'slate', 0x6a5a4a, 0x9a8a7a, {}); }
    else if (it.kind === 'park') { broadleaf(g, it.x, it.y, 0.6, 0x4fae4a); }
  }
  if (c.walls) {
    g.beginPath(); g.ellipse(0, 4, 47, 38, 0, 0, PI); g.lineWidth = 8; g.strokeStyle = INKS; g.stroke(); g.lineWidth = 6; g.strokeStyle = css(0xcfc8b8); g.stroke();
    for (let k = 0; k <= 8; k++) { const a = k / 8 * PI; const x = Math.cos(a) * 47, y = 4 + Math.sin(a) * 38; rr(g, x - 2.6, y - 7, 5.2, 5, 0.6); fs(g, css(0xd8d0bf), 1); }
    rr(g, -6, 34, 12, 9, 4); fs(g, css(0x4a3020), 1.2);
  }
};
ART.village = function (g, seed) {
  const huts = [[-16, -6, 0.95], [14, -10, 0.85], [2, 14, 1]];
  // fence
  g.beginPath(); g.ellipse(0, 4, 34, 22, 0, 0, TAU); g.lineWidth = 1; g.setLineDash([2, 3]); g.strokeStyle = 'rgba(110,80,50,.7)'; g.stroke(); g.setLineDash([]);
  for (const [x, y, s] of huts) house(g, x, y, s, 'thatch', 0xd8b56a, 0xc9a77c);
  // fire pit
  ell(g, 24, 16, 6, 3); fs(g, css(0x8a8274), 1);
};

// ---------------------------------------------------------------- clouds (fog)
ART.cloud = function (g, seed) {
  const r = k => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
  const puffs = [];
  for (let k = 0; k < 6; k++) puffs.push([(r(k) - 0.5) * 70, (r(k + 9) - 0.5) * 60, 20 + r(k + 20) * 14]);
  g.beginPath(); for (const [x, y, rr2] of puffs) { g.moveTo(x + rr2, y + 6); g.arc(x, y + 6, rr2, 0, TAU); } fill(g, 'rgba(150,152,205,.55)');
  g.beginPath(); for (const [x, y, rr2] of puffs) { g.moveTo(x + rr2, y); g.arc(x, y, rr2, 0, TAU); } fill(g, lg(g, 0, -45, 0, 40, [[0, 0xfcfcff], [1, 0xdcdff3]]));
  for (const [x, y, rr2] of puffs) { circ(g, x - rr2 * 0.3, y - rr2 * 0.35, rr2 * 0.45); fill(g, 'rgba(255,255,255,.55)'); }
};

// ---------------------------------------------------------------- UI thumbnails
// draw any sprite into a canvas element sized in CSS pixels
ART.thumb = function (cv, spec, cssSize) {
  const dpr = Math.min(2, G.devicePixelRatio || 1);
  const S = cssSize || 54;
  cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const fit = (box, pad) => {
    const w = box.x1 - box.x0, hh = box.y1 - box.y0, k = (S - (pad || 4) * 2) / Math.max(w, hh);
    g.translate(S / 2 - (box.x0 + w / 2) * k, S / 2 - (box.y0 + hh / 2) * k); g.scale(k, k);
  };
  if (spec.kind === 'unit') {
    const box = spec.naval ? (spec.type === 'giant' ? { x0: -54, y0: -96, x1: 56, y1: 6 } : { x0: -44, y0: -72, x1: 48, y1: 6 }) : spec.type === 'balloon' ? { x0: -36, y0: -112, x1: 36, y1: 4 } : spec.type === 'giant' ? { x0: -48, y0: -124, x1: 48, y1: 6 } : (spec.type === 'rider' || spec.type === 'knight') ? { x0: -38, y0: -88, x1: 50, y1: 6 } : spec.type === 'catapult' ? { x0: -34, y0: -66, x1: 44, y1: 6 } : { x0: -26, y0: -82, x1: 30, y1: 6 };
    fit(box, spec.pad);
    drawUnit(g, spec);
  } else if (spec.kind === 'city') { fit({ x0: -56, y0: -66, x1: 56, y1: 46 }); ART.city(g, spec.city, spec.tribe, spec.color); }
  else if (spec.kind === 'village') { fit({ x0: -40, y0: -40, x1: 40, y1: 30 }); ART.village(g, 1); }
  else if (spec.kind === 'resource') { fit({ x0: -34, y0: -34, x1: 34, y1: 26 }); ART.resource(g, spec.res, 1); }
  else if (spec.kind === 'improvement') { fit({ x0: -40, y0: -46, x1: 40, y1: 36 }); ART.improvement(g, spec.imp, spec.sk, spec.color); }
  else if (spec.kind === 'forest') { fit({ x0: -40, y0: -46, x1: 40, y1: 30 }); ART.forest(g, 3, spec.sk, spec.snow); }
  else if (spec.kind === 'mountain') { fit({ x0: -40, y0: -46, x1: 40, y1: 30 }); ART.mountain(g, 3, spec.sk, false); }
  else if (spec.kind === 'ruin') { fit({ x0: -30, y0: -34, x1: 30, y1: 22 }); ART.ruin(g); }
  else if (spec.kind === 'milestone') { fit({ x0: -36, y0: -34, x1: 36, y1: 34 }); ART.milestone(g); }
  else if (spec.kind === 'market') { fit({ x0: -28, y0: -32, x1: 28, y1: 22 }); ART.market(g, spec.color); }
  else if (spec.kind === 'trident') { fit({ x0: -30, y0: -36, x1: 30, y1: 28 }); ART.trident(g); }
  else if (spec.kind === 'temple') { fit({ x0: -30, y0: -44, x1: 30, y1: 22 }); ART.temple(g, spec.color); }
};

})(typeof window !== 'undefined' ? window : globalThis);
