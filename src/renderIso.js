/* Tessera Tribes — isometric renderer: raised tile blocks, upright side-view sprites, fog clouds, animations. */
(function (G) {
'use strict';
const TT = G.TT, ART = TT.ART, T = TT.T;
const R3 = TT.R3 = {};
const { mix, css, lt, dk, rgba } = ART;

let cv, g, dpr = 1, VW = 1, VH = 1;
let st = null, viewer = -1, W = 0, H = 0;
let relief = 1, speed = 1, instant = false, dayCycle = true, showGrid = true;
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now();

// ---------------------------------------------------------------- palette
const SKIN = {
  neutral:     { field: 0x8fcb5c, forest: 0x6aad49, leaf: [0x2f8a3f, 0x3c9a45, 0x2a7c39], peak: [0x9b9886, 0xa8a493, 0x8d8a7a] },
  verdant:     { field: 0x7cc451, forest: 0x5aa340, leaf: [0x23773a, 0x2f8a3c, 0x1f6b33], peak: [0x8f9a7c, 0x9aa586, 0x85906f] },
  ironpeak:    { field: 0xaba6cc, forest: 0x958fbd, leaf: [0x5a4d8c, 0x6a5aa0, 0x4c4178], peak: [0x7e7898, 0x8c86a6, 0x726c8a] },
  tidecallers: { field: 0x88d4b2, forest: 0x66bb97, leaf: [0x1f7f6b, 0x26917a, 0x1a6d5c], peak: [0x8aa39c, 0x97b0a8, 0x7d958e] },
  emberfolk:   { field: 0xd8a862, forest: 0xc08b4c, leaf: [0x9a4b26, 0xb05a2c, 0x7f3f20], peak: [0x9c6b55, 0xab7a62, 0x8d5f4b] },
  frostkin:    { field: 0xdbe5ee, forest: 0xc4d2e0, leaf: [0x3f6f66, 0x4d8076, 0x355f57], peak: [0xb0bccb, 0xc0cbd8, 0xa4b0c0] },
  sunspire:    { field: 0xe8cf88, forest: 0xd2b46b, leaf: [0x6f8f2e, 0x7f9f36, 0x5f7f26], peak: [0xc6aa7a, 0xd3b888, 0xb89d6e] },
};
R3.SKIN = SKIN;
const C = { ocean: 0x3a86c8, oceanDeep: 0x2a68ab, shallow: 0x5ec8dc, earth: 0x7a5a3c, gold: 0xffc94a, fog: 0xc9ccec, edgeWater: 0x1f4f86 };
const skinOf = tl => tl.owner >= 0 && st ? SKIN[st.players[tl.owner].tribe] : SKIN.neutral;
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const easeOut = k => 1 - Math.pow(1 - k, 3);
const easeOutBack = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const explored = i => viewer < 0 || st.players[viewer].explored[i];
R3.isVisible = (x, y) => !st || (x >= 0 && y >= 0 && x < W && y < H && explored(y * W + x));
R3.topY = () => 0;

// camera: VR = half-height of a tile diamond per px of tile width (0.25 is classic 2:1 iso; higher looks more top-down)
const VR = 0.34, KR = VR * 2, HS = 0.78, SPRY = 0.9;
// heights are in tile-width units
const LAND_H = 0.15, ELEV = 0.055, FOG_H = 0.08;
function targetH(i) {
  const tl = st.tiles[i];
  if (!explored(i)) return FOG_H;
  if (tl.t === T.OCEAN) return -0.035;
  if (tl.t === T.SHALLOW) return 0;
  return LAND_H + Math.max(0, tl.e) * ELEV * relief;
}

// ---------------------------------------------------------------- camera & projection
const cam = { x: 8, y: 8, z: 110, tx: 8, ty: 8, tz: 110, shake: 0, sx: 0, sy: 0, oy: 0, toy: 0 };
// keep the focus point centred in the part of the screen not covered by panels
R3.setInsets = function (top, bottom) { cam.toy = ((top || 0) - (bottom || 0)) / 2; };
R3.cam = cam;
function P(wx, wy, h) {
  return [(wx - wy - cam.x + cam.y) * cam.z * 0.5 + VW / 2 + cam.sx, (wx + wy - cam.x - cam.y) * cam.z * VR + VH / 2 + cam.oy - (h || 0) * cam.z * HS + cam.sy];
}
function inv(px, py) { // screen -> world (on the water plane)
  const u = (px - VW / 2 - cam.sx) / (cam.z * 0.5) + cam.x - cam.y;
  const v = (py - VH / 2 - cam.oy - cam.sy) / (cam.z * VR) + cam.x + cam.y;
  return [(u + v) / 2, (v - u) / 2];
}
R3.init = function (el) {
  cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  el.appendChild(cv);
  g = cv.getContext('2d');
  window.addEventListener('resize', R3.resize);
  R3.resize();
  requestAnimationFrame(frame);
};
R3.resize = function () {
  if (!cv) return;
  dpr = Math.min(2, G.devicePixelRatio || 1);
  VW = cv.parentElement.clientWidth || 1; VH = cv.parentElement.clientHeight || 1;
  cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr);
  clampCam();
};
R3.setOptions = function (o) {
  if (o.speed != null) speed = o.speed;
  if (o.instant != null) instant = o.instant;
  if (o.dayCycle != null) dayCycle = o.dayCycle;
  if (o.relief != null) relief = o.relief;
  if (o.grid != null) showGrid = o.grid;
};
const minZ = () => Math.max(26, Math.min(VW / ((W || 16) + 2), VH / (((W || 16) + (H || 16)) * VR + 1)));
const maxZ = () => 260;
function clampCam() {
  if (!W) return;
  cam.tz = Math.max(minZ(), Math.min(maxZ(), cam.tz));
  cam.tx = Math.max(-1, Math.min(W + 1, cam.tx)); cam.ty = Math.max(-1, Math.min(H + 1, cam.ty));
}
// panning moves the world under the finger: convert screen delta into world delta
R3.pan = function (dx, dy) {
  const du = -dx / (cam.z * 0.5), dv = -dy / (cam.z * VR);
  cam.tx += (du + dv) / 2; cam.ty += (dv - du) / 2;
  clampCam(); cam.x = cam.tx; cam.y = cam.ty;
};
R3.zoom = function (f, cx, cy) {
  const r = cv.getBoundingClientRect();
  const px = cx == null ? VW / 2 : cx - r.left, py = cy == null ? VH / 2 : cy - r.top;
  const before = inv(px, py);
  cam.tz = cam.tz / f; clampCam(); cam.z = cam.tz;
  const after = inv(px, py);
  cam.x = cam.tx = cam.tx + before[0] - after[0];
  cam.y = cam.ty = cam.ty + before[1] - after[1];
  clampCam();
};
R3.setZoom = function (z, immediate) { cam.tz = z; clampCam(); if (immediate) cam.z = cam.tz; };
R3.fit = function (leftPx) {
  const avail = VW - (leftPx || 0);
  cam.tz = Math.min(avail / (W + 1), (VH - 150) / ((W + H) * VR + 0.6));
  clampCam();
  // world center, shifted so the board sits in the free space
  cam.tx = W / 2; cam.ty = H / 2;
  const shift = (leftPx || 0) / 2 / (cam.z * 0.5 || 1);
  cam.tx -= shift / 2 * (cam.z / cam.tz); cam.ty += shift / 2 * (cam.z / cam.tz);
};
R3.rotate = function () {};
R3.topView = function () { R3.fit(); };
R3.focus = function (x, y, immediate) { cam.tx = x + 0.5; cam.ty = y + 0.5; clampCam(); if (immediate) { cam.x = cam.tx; cam.y = cam.ty; } };
R3.isOnScreen = function (x, y, m) {
  m = m == null ? 0.75 : m;
  const [sx, sy] = P(x + 0.5, y + 0.5, 0.15);
  return Math.abs(sx - VW / 2) < VW / 2 * m && Math.abs(sy - VH / 2 - cam.oy) < (VH / 2 - Math.abs(cam.oy)) * m;
};
R3.viewFootprint = function () {
  if (!st) return null;
  return [inv(0, 0), inv(VW, 0), inv(VW, VH), inv(0, VH)].map(p => [p[0] - 0.5, p[1] - 0.5]);
};
function inDiamond(px, py, x, y, h) {
  const [cx, cy] = P(x + 0.5, y + 0.5, h);
  return Math.abs(px - cx) / (cam.z * 0.5) + Math.abs(py - cy) / (cam.z * VR) <= 1;
}
R3.pick = function (clientX, clientY) {
  if (!st) return -1;
  const r = cv.getBoundingClientRect();
  const px = clientX - r.left, py = clientY - r.top;
  // units are drawn tall: prefer the front-most unit whose body is under the pointer
  let best = null;
  for (const u of st.units) {
    if (!TT.visibleTo(st, u, viewer)) continue;
    const d = disp.get(u.id); if (!d) continue;
    const [ax, ay] = unitAnchor(u, d);
    const top = (u.type === 'balloon' && !u.naval ? 1.0 : TT.UNITS[u.type].super ? 0.85 : 0.62) * cam.z * SPR * 100 * SPRY;
    if (px > ax - cam.z * 0.24 && px < ax + cam.z * 0.24 && py > ay - top && py < ay + cam.z * 0.06) {
      const depth = d.x + d.y;
      if (!best || depth > best.depth) best = { u, depth };
    }
  }
  if (best) return best.u.y * W + best.u.x;
  const [fx, fy] = inv(px, py);
  let hit = -1, hd = -1;
  for (let y = Math.floor(fy) - 1; y <= Math.floor(fy) + 2; y++) for (let x = Math.floor(fx) - 1; x <= Math.floor(fx) + 2; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (inDiamond(px, py, x, y, tileH[i]) && x + y > hd) { hd = x + y; hit = i; }
  }
  return hit;
};

// ---------------------------------------------------------------- sprite cache
const SPR = 0.0082; // css px per sprite unit, per px of tile width (100 units ≈ 0.82 tile)
const cache = new Map();
const BUCKETS = [0.2, 0.28, 0.4, 0.56, 0.8, 1.1, 1.5, 2.1, 2.9, 3.8, 4.8];
function bucket(need) { for (const b of BUCKETS) if (b >= need * 0.92) return b; return BUCKETS[BUCKETS.length - 1]; }
function sprite(key, box, draw, variant, opts) {
  const k = bucket(cam.z * SPR * dpr);
  const ck = key + (variant ? '|' + variant : '') + (opts && opts.halo ? '|h' : '') + '@' + k;
  let c = cache.get(ck);
  if (!c) {
    if (cache.size > 900) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((box.x1 - box.x0) * k)); c.height = Math.max(1, Math.ceil((box.y1 - box.y0) * k));
    const x = c.getContext('2d');
    x.scale(k, k); x.translate(-box.x0, -box.y0);
    x.lineJoin = 'round'; x.lineCap = 'round';
    draw(x);
    if (variant) postFx(c, variant);
    if (opts && opts.halo) haloize(c, k);
    if (opts && opts.soft) postFx(c, 'soft');
    cache.set(ck, c);
  }
  return c;
}
function postFx(c, v) {
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    if (v === 'spent') { d[i] = l * 0.7 + d[i] * 0.15 + 22; d[i + 1] = l * 0.7 + d[i + 1] * 0.15 + 22; d[i + 2] = l * 0.7 + d[i + 2] * 0.15 + 34; }
    else if (v === 'frozen') { d[i] = l * 0.55 + 70; d[i + 1] = l * 0.62 + 90; d[i + 2] = l * 0.5 + 130; }
    else if (v === 'flash') { d[i] = 255; d[i + 1] = 70; d[i + 2] = 55; }
    else if (v === 'soft') { d[i] = d[i] * 0.84 + l * 0.12 + 12; d[i + 1] = d[i + 1] * 0.84 + l * 0.12 + 12; d[i + 2] = d[i + 2] * 0.84 + l * 0.12 + 16; }
  }
  x.putImageData(im, 0, 0);
}
// a soft light outline so units read clearly against busy terrain
function haloize(c, k) {
  const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
  const t = tmp.getContext('2d');
  t.drawImage(c, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = 'rgba(255,255,255,0.85)'; t.fillRect(0, 0, c.width, c.height);
  const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
  const o = out.getContext('2d'), r = Math.max(1.5, k * 2.2);
  for (let a = 0; a < 8; a++) o.drawImage(tmp, Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r);
  o.drawImage(c, 0, 0);
  const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(out, 0, 0);
}
// draw a cached sprite with its ground anchor at screen point (sx, sy)
function blitAt(c, box, sx, sy, o) {
  o = o || {};
  const s = cam.z * SPR * (o.scale || 1);
  const w = (box.x1 - box.x0) * s, h = (box.y1 - box.y0) * s;
  if (sx + box.x1 * s < -30 || sx + box.x0 * s > VW + 30 || sy + box.y1 * s < -30 || sy + box.y0 * s > VH + 30) return;
  g.save();
  g.translate(sx, sy);
  if (o.rot) g.rotate(o.rot);
  if (o.skew) g.transform(1, 0, o.skew, 1, 0, 0);
  g.scale(o.flip ? -1 : 1, (o.sy || 1) * (o.noSquash ? 1 : SPRY));
  if (o.alpha != null) g.globalAlpha = Math.max(0, o.alpha);
  g.drawImage(c, box.x0 * s, box.y0 * s, w, h);
  g.restore();
}

// ---------------------------------------------------------------- per-tile data
let tileInfo = [], tileH = [], tileFog = [], tilePop = [], terrSig = '';
function rebuildTiles(animate) {
  const N = W * H;
  const old = tileInfo;
  tileInfo = [];
  for (let i = 0; i < N; i++) {
    const tl = st.tiles[i], x = i % W, y = (i / W) | 0, sk = skinOf(tl);
    const water = TT.isWater(tl.t);
    let top;
    if (tl.t === T.OCEAN) top = mix(C.ocean, C.oceanDeep, 0.35 + hash(x, y, 3) * 0.25);
    else if (tl.t === T.SHALLOW) top = mix(C.shallow, 0x52bcd2, hash(x, y, 3) * 0.4);
    else if (tl.t === T.FOREST) top = sk.forest;
    else if (tl.t === T.MOUNTAIN) top = mix(sk.field, sk.peak[2], 0.35);
    else top = sk.field;
    if (!water) top = mix(top, hash(x, y, 7) > 0.5 ? 0xffffff : 0x000000, hash(x, y, 9) * 0.045);
    const left = water ? C.edgeWater : mix(dk(top, 0.3), C.earth, 0.3);
    const right = water ? dk(C.edgeWater, 0.15) : mix(dk(top, 0.16), C.earth, 0.18);
    const sig = [tl.t, tl.e, tl.owner, tl.res, tl.imp, tl.ruin, tl.site, explored(i) ? 1 : 0].join(',');
    tileInfo.push({ top: css(top), topN: top, left: css(left), right: css(right), water, sig, snow: tl.owner >= 0 && st.players[tl.owner].tribe === 'frostkin' });
    if (animate && old[i] && old[i].sig !== sig && explored(i)) tilePop[i] = now();
  }
}

// ---------------------------------------------------------------- state
const disp = new Map();
const cityPop = new Map();
R3.setState = function (state, viewerPid) {
  st = state; viewer = viewerPid; W = st.W; H = st.H;
  for (const tw of tweens.splice(0)) { try { tw.fn(1); } catch (e) { /* stale */ } tw.res(); }
  for (const pr of projs.splice(0)) pr.res();
  disp.clear(); cityPop.clear(); parts.length = 0; floats.length = 0; rings.length = 0; beams.length = 0;
  tileInfo = []; terrSig = '';
  tileH = new Array(W * H).fill(0); tileFog = new Array(W * H).fill(1); tilePop = new Array(W * H).fill(0);
  rebuildTiles(false);
  for (let i = 0; i < W * H; i++) { tileH[i] = targetH(i); tileFog[i] = explored(i) ? 0 : 1; }
  R3.sync(true);
  const Pp = viewer >= 0 ? st.players[viewer] : null;
  if (Pp && Pp.capital >= 0) { const c = st.cities[Pp.capital]; cam.tz = Math.max(minZ(), Math.min(170, Math.max(Math.min(VW, VH * 1.6), 540) / 6.2)); R3.focus(c.x, c.y, true); }
  else R3.fit();
  cam.z = cam.tz; cam.x = cam.tx; cam.y = cam.ty;
  stormD = st.storm ? { x: st.storm.x + 0.5, y: st.storm.y + 0.5, a: 1 } : null;
};
R3.setViewer = function (pid) { viewer = pid; rebuildTiles(false); R3.sync(true); };
R3.sync = function (force) {
  if (!st) return;
  let sig = '';
  for (let i = 0; i < W * H; i++) { const t = st.tiles[i]; sig += t.t + '' + t.owner + (t.res || '') + (t.imp || '') + (t.ruin ? 1 : 0) + (explored(i) ? 'e' : 'u'); }
  if (force || sig !== terrSig) { rebuildTiles(!force); terrSig = sig; }
  const alive = new Set();
  for (const u of st.units) {
    alive.add(u.id);
    let d = disp.get(u.id);
    if (!d) { d = { uid: u.id, x: u.x + 0.5, y: u.y + 0.5, z: 0, face: u.x < W / 2 ? 1 : -1, busy: false, alpha: 1, scale: 1, flash: 0, tilt: 0, ph: Math.random() * 6 }; disp.set(u.id, d); }
    if (!d.busy) { d.x = u.x + 0.5; d.y = u.y + 0.5; }
  }
  for (const [id, d] of disp) if (!alive.has(id) && !d.dying) disp.delete(id);
};

// ---------------------------------------------------------------- highlights
let HL = {}, hoverI = -1, pathPts = null;
// enemies the selected unit could kill this turn: they tremble and sweat
let sweatSet = null;
R3.setSweat = function (set) { sweatSet = set && set.size ? set : null; };
function drawSweat(hx, hy, z, time, d) {
  const s = Math.max(0.9, z / 75);
  for (let k = 0; k < 4; k++) {
    const p = reduceMotion ? 0.35 : ((time * 1.25 + k / 4 + d.ph) % 1);
    const side = k % 2 ? 1 : -1;
    const x = hx + side * (10 + p * 14) * s, y = hy - 6 * s - Math.sin(p * Math.PI) * 10 * s + p * p * 14 * s;
    const a = Math.min(1, (1 - p) * 1.6);
    g.save(); g.translate(x, y); g.rotate(side * (0.5 + p * 0.6)); g.scale(s, s); g.globalAlpha = a;
    g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(4.6, 0.5, 0, 4); g.quadraticCurveTo(-4.6, 0.5, 0, -6); g.closePath();
    g.fillStyle = '#8fdcff'; g.fill(); g.lineWidth = 1.3; g.strokeStyle = '#1f5f8a'; g.stroke();
    g.beginPath(); g.ellipse(-1.2, 0.2, 0.9, 1.6, 0, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    g.restore();
  }
  // nervous "worry" strokes beside the head
  g.save(); g.lineCap = 'round'; g.lineWidth = Math.max(1.5, 2 * s); g.strokeStyle = 'rgba(31,95,138,0.85)';
  const jitter = reduceMotion ? 0 : Math.sin(time * 20) * s;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(hx + (16 + k * 4) * s + jitter, hy - (18 - k * 5) * s); g.lineTo(hx + (21 + k * 4) * s + jitter, hy - (20 - k * 5) * s); g.stroke(); }
  g.restore();
}
R3.setHighlights = function (h) { HL = h || {}; HL.movesSet = HL.moves ? new Set(HL.moves) : null; R3.selUnit = HL.unit || null; };
let actionable = null, actionPulse = 0;
// tiles where the viewer can harvest or build right now; `burst` makes them flash (after a new technology)
R3.setActionable = function (set, burst) { actionable = set && set.size ? set : null; if (burst) actionPulse = now(); };
R3.tileScreenPos = function (x, y) { if (!st) return null; const [sx, sy] = P(x + 0.5, y + 0.5, tileH[y * W + x] || 0); return { x: sx, y: sy, z: cam.z }; };
R3.unitScreenPos = function (uid) { const d = disp.get(uid), u = st && TT.getUnit(st, uid); if (!d || !u) return null; const [x, y] = unitAnchor(u, d); return { x, y, z: cam.z }; };
R3.setHover = function (i) { hoverI = i == null ? -1 : i; };
R3.setPath = function (p) { pathPts = p && p.length > 1 ? p : null; };

// ---------------------------------------------------------------- tweens & effects
const tweens = [];
function tween(dur, fn, ignoreSpeed) {
  return new Promise(res => {
    const d = instant ? 0 : dur * (ignoreSpeed ? 1 : speed);
    if (d <= 0 || reduceMotion) { fn(1); res(); return; }
    tweens.push({ t0: now(), d, fn, res });
  });
}
const wait = ms => tween(ms, () => {});
function stepTweens() {
  const t = now();
  for (let k = tweens.length - 1; k >= 0; k--) {
    const tw = tweens[k], p = Math.min(1, (t - tw.t0) / tw.d);
    try { tw.fn(p); } catch (e) { console.error('tween', e); tweens.splice(k, 1); tw.res(); continue; }
    if (p >= 1) { tweens.splice(k, 1); tw.res(); }
  }
}
const parts = [], floats = [], rings = [], projs = [], beams = [];
function groundH(x, y) { const ix = Math.floor(x), iy = Math.floor(y); return ix >= 0 && iy >= 0 && ix < W && iy < H ? Math.max(0, tileH[iy * W + ix]) : 0; }
function emit(x, y, o) {
  if (reduceMotion && !o.always) return;
  const n = o.n || 10, h0 = groundH(x, y) + (o.z || 0);
  for (let k = 0; k < n && parts.length < 700; k++) {
    const a = Math.random() * Math.PI * 2, sp = (o.speed || 1.5) * (0.35 + Math.random() * 0.8);
    const cols = Array.isArray(o.color) ? o.color : [o.color || 0xffffff];
    parts.push({ x: x + (Math.random() - 0.5) * (o.spread || 0.15), y: y + (Math.random() - 0.5) * (o.spread || 0.15), z: h0,
      vx: Math.cos(a) * sp * 0.45, vy: Math.sin(a) * sp * 0.45, vz: (o.up == null ? 1.4 : o.up) * (0.5 + Math.random()) * 0.6,
      g: (o.gravity == null ? 4 : o.gravity) * 0.6, life: 0, max: (o.life || 0.7) * (0.7 + Math.random() * 0.6), s: (o.size || 0.05) * (0.6 + Math.random() * 0.8),
      c: css(cols[(Math.random() * cols.length) | 0]), sq: !!o.square, drag: o.drag || 0.5, floor: h0 - (o.z || 0) - 0.02 });
  }
}
R3.emit = (x, y, z, o) => emit(x, y, o);
function floatText(x, y, text, cls) { if (!R3.isVisible(x, y)) return; floats.push({ x: x + 0.5, y: y + 0.5, h: groundH(x + 0.5, y + 0.5), text, cls: cls || '', t0: now() }); }
R3.floatText = floatText;
function ring(x, y, color, dur, maxR, width) { if (!R3.isVisible(x, y) || instant) return; rings.push({ x: x + 0.5, y: y + 0.5, c: css(color), t0: now(), d: dur || 600, r: maxR || 1, w: width || 0.05 }); }
function beam(x, y, color, dur) { if (!R3.isVisible(x, y) || instant) return; beams.push({ x: x + 0.5, y: y + 0.5, c: color, t0: now(), d: dur || 900 }); }
let stormD = null, lightning = null;

// ---------------------------------------------------------------- frame
let lastT = 0, dayK = 1;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
  if (!g) return;
  stepTweens();
  const tn = now();
  for (const [id, dd] of disp) {
    if (!dd.dying) continue;
    if (!dd.dyingSince) dd.dyingSince = tn;
    if (tn - dd.dyingSince > 2600 || (st && !st.units.some(u => u.id === id) && !dd.busy && tn - dd.dyingSince > 900)) disp.delete(id);
  }
  const k = 1 - Math.pow(0.0008, dt);
  cam.x = lerp(cam.x, cam.tx, k); cam.y = lerp(cam.y, cam.ty, k); cam.z = lerp(cam.z, cam.tz, k); cam.oy = lerp(cam.oy, cam.toy, k);
  if (cam.shake > 0 && !reduceMotion) { cam.sx = (Math.random() - 0.5) * cam.shake * 22; cam.sy = (Math.random() - 0.5) * cam.shake * 22; cam.shake = Math.max(0, cam.shake - dt * 1.8); } else { cam.sx = cam.sy = 0; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const time = t / 1000;
  drawBackdrop(time);
  if (!st) return;
  for (let i = 0; i < W * H; i++) {
    const th = targetH(i);
    if (tileH[i] !== th) { tileH[i] = reduceMotion ? th : lerp(tileH[i], th, Math.min(1, dt * 3.2)); if (Math.abs(tileH[i] - th) < 0.002) tileH[i] = th; }
    const ft = explored(i) ? 0 : 1;
    if (tileFog[i] !== ft) { tileFog[i] = reduceMotion ? ft : lerp(tileFog[i], ft, Math.min(1, dt * 2.4)); if (Math.abs(tileFog[i] - ft) < 0.01) tileFog[i] = ft; }
  }
  drawWorld(time);
  const phase = dayCycle ? ((st.turn - 1) % 10) / 10 : 0;
  dayK = lerp(dayK, 0.5 + 0.5 * Math.cos(phase * Math.PI * 2), Math.min(1, dt * 1.2));
  const night = (1 - dayK) * 0.3;
  if (night > 0.01) { g.fillStyle = 'rgba(22,26,78,' + night.toFixed(3) + ')'; g.fillRect(0, 0, VW, VH); }
  drawStorm(time, dt);
  drawOverlay(time);
  drawLabels(time);
  drawFx(dt, time);
}

function drawBackdrop(time) {
  // a pale low-poly sky-sea, like looking down through haze
  const grd = g.createLinearGradient(0, 0, 0, VH);
  grd.addColorStop(0, '#b9c8ec'); grd.addColorStop(1, '#8fa7dc');
  g.fillStyle = grd; g.fillRect(0, 0, VW, VH);
  const s = 90;
  g.lineWidth = 1;
  for (let y = -1; y < VH / s + 1; y++) for (let x = -1; x < VW / s + 1; x++) {
    const h0 = hash(x, y, 1), px = x * s + (y % 2 ? s / 2 : 0), py = y * s * 0.7;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + s, py); g.lineTo(px + s / 2, py + s * 0.7); g.closePath();
    g.fillStyle = 'rgba(255,255,255,' + (0.05 + h0 * 0.12).toFixed(3) + ')'; g.fill();
  }
}

function visibleRange() {
  const c = [inv(0, 0), inv(VW, 0), inv(0, VH + cam.z * 0.6), inv(VW, VH + cam.z * 0.6)];
  const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
  return { x0: Math.max(0, Math.floor(Math.min(...xs)) - 1), x1: Math.min(W - 1, Math.ceil(Math.max(...xs)) + 1), y0: Math.max(0, Math.floor(Math.min(...ys)) - 1), y1: Math.min(H - 1, Math.ceil(Math.max(...ys)) + 1) };
}

// fields lie flat on the tile: furrowed farmland, or a low patch of wild wheat
function drawField(x, y, h, z, tl, time) {
  const ins = 0.09, a = P(x + ins, y + ins, h), b = P(x + 1 - ins, y + ins, h), c = P(x + 1 - ins, y + 1 - ins, h), d = P(x + ins, y + 1 - ins, h);
  if (tl.imp === 'farm') {
    poly4(a, b, c, d);
    const grd = g.createLinearGradient(a[0], a[1], c[0], c[1]); grd.addColorStop(0, '#b98b55'); grd.addColorStop(1, '#8c5f35');
    g.fillStyle = grd; g.fill();
    g.save(); poly4(a, b, c, d); g.clip();
    const rows = 7;
    for (let k = 0; k < rows; k++) {
      const t = (k + 0.5) / rows;
      const p1 = P(x + ins, y + ins + t * (1 - 2 * ins), h), p2 = P(x + 1 - ins, y + ins + t * (1 - 2 * ins), h);
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]);
      g.lineWidth = Math.max(1.5, z * 0.045); g.lineCap = 'butt'; g.strokeStyle = k % 2 ? '#86bd4a' : '#dcb747'; g.stroke();
      g.lineWidth = Math.max(1, z * 0.008); g.strokeStyle = 'rgba(70,44,20,0.35)';
      const q1 = P(x + ins, y + ins + (t + 0.5 / rows) * (1 - 2 * ins), h), q2 = P(x + 1 - ins, y + ins + (t + 0.5 / rows) * (1 - 2 * ins), h);
      g.beginPath(); g.moveTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.stroke();
      if (z > 60) for (let j = 1; j < 6; j++) { const p = P(x + ins + j / 6 * (1 - 2 * ins), y + ins + t * (1 - 2 * ins), h); g.beginPath(); g.arc(p[0], p[1] - z * 0.012, Math.max(1, z * 0.011), 0, Math.PI * 2); g.fillStyle = k % 2 ? '#b9e06a' : '#ffe58a'; g.fill(); }
    }
    g.restore();
    poly4(a, b, c, d); g.lineWidth = Math.max(1.5, z * 0.014); g.strokeStyle = 'rgba(90,60,30,0.6)'; g.stroke();
  } else {
    // wild grain: a square patch on the tile (rounded corners), lighter than a tilled farm
    const [cx, cy] = P(x + 0.5, y + 0.5, h), rx = z * 0.3, ry = rx * KR, i2 = 0.2, rr = 0.07;
    const pts = [[x + i2, y + i2], [x + 1 - i2, y + i2], [x + 1 - i2, y + 1 - i2], [x + i2, y + 1 - i2]];
    g.beginPath();
    pts.forEach((q, k) => {
      const nx = pts[(k + 1) % 4], pv = pts[(k + 3) % 4];
      const toward = (o, f) => P(q[0] + Math.sign(o[0] - q[0]) * f, q[1] + Math.sign(o[1] - q[1]) * f, h);
      const s0 = toward(pv, rr), e0 = toward(nx, rr), c0 = P(q[0], q[1], h);
      if (k === 0) g.moveTo(s0[0], s0[1]); else g.lineTo(s0[0], s0[1]);
      g.quadraticCurveTo(c0[0], c0[1], e0[0], e0[1]);
    });
    g.closePath();
    const grd = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 0, cx, cy, rx * 1.2); grd.addColorStop(0, 'rgba(246,220,128,0.95)'); grd.addColorStop(1, 'rgba(204,156,54,0.9)');
    g.fillStyle = grd; g.fill();
    g.lineWidth = Math.max(1, z * 0.01); g.strokeStyle = 'rgba(150,108,30,0.45)'; g.stroke();
    // short wheat tufts in a loose grid, swaying a little
    const sway = reduceMotion ? 0 : Math.sin(time * 1.6 + x + y) * z * 0.004;
    g.lineCap = 'round';
    for (let r2 = -2; r2 <= 2; r2++) for (let k = -2; k <= 2; k++) {
      const [px, py] = P(x + 0.5 + k * 0.115 + (r2 % 2 ? 0.03 : 0), y + 0.5 + r2 * 0.115, h);
      const ht = z * 0.035;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + sway, py - ht); g.lineWidth = Math.max(1, z * 0.008); g.strokeStyle = '#a8822a'; g.stroke();
      g.beginPath(); g.ellipse(px + sway, py - ht, Math.max(1, z * 0.008), Math.max(1.5, z * 0.016), 0, 0, Math.PI * 2); g.fillStyle = '#ffe28a'; g.fill();
    }
  }
}
function drawRoad(x, y, h, z) {
  const tl = st.tiles[y * W + x], c = P(x + 0.5, y + 0.5, h);
  const links = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = st.tiles[ny * W + nx];
    if (TT.isWater(n.t) || !(n.road || n.site >= 0) || !explored(ny * W + nx)) continue;
    if (!tl.road && !n.road) continue; // two cities side by side don't need a road between them
    links.push(P(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, h));
  }
  if (!links.length && tl.site >= 0) return;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const w = Math.max(3, z * 0.11);
  for (const [lw, col] of [[w + 3, 'rgba(90,62,34,0.55)'], [w, '#cfae7c'], [w * 0.35, 'rgba(255,240,210,0.5)']]) {
    g.beginPath();
    if (links.length) for (const p of links) { g.moveTo(c[0], c[1]); g.lineTo(p[0], p[1]); }
    else { g.moveTo(c[0] - z * 0.12, c[1]); g.lineTo(c[0] + z * 0.12, c[1]); }
    g.lineWidth = lw; g.strokeStyle = col; g.stroke();
  }
  if (tl.road && !links.length) { g.beginPath(); g.ellipse(c[0], c[1], w * 0.9, w * 0.9 * KR, 0, 0, Math.PI * 2); g.fillStyle = '#cfae7c'; g.fill(); }
}
function poly4(a, b, c, d) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); }

function drawBlock(i, time) {
  const x = i % W, y = (i / W) | 0, h = tileH[i], ti = tileInfo[i], tl = st.tiles[i];
  const fog = tileFog[i] >= 0.999;
  const edge = x === W - 1 || y === H - 1;
  const base = edge ? -0.32 : -0.06;
  const N = P(x, y, h), E = P(x + 1, y, h), S = P(x + 1, y + 1, h), Wc = P(x, y + 1, h);
  if (Math.max(N[0], E[0], S[0], Wc[0]) < -10 || Math.min(N[0], E[0], S[0], Wc[0]) > VW + 10 || N[1] > VH + 10) return;
  const Eb = P(x + 1, y, base), Sb = P(x + 1, y + 1, base), Wb = P(x, y + 1, base);
  // side faces (only show when something in front is lower, or at the board edge)
  if (h > base + 0.001) {
    poly4(Wc, S, Sb, Wb); g.fillStyle = fog ? '#a9add6' : ti.left; g.fill();
    poly4(S, E, Eb, Sb); g.fillStyle = fog ? '#b6b9e0' : ti.right; g.fill();
    if (!fog && !ti.water) { // grass lip along the top of the side faces
      g.beginPath(); g.moveTo(Wc[0], Wc[1]); g.lineTo(S[0], S[1]); g.lineTo(E[0], E[1]);
      g.lineWidth = Math.max(1, cam.z * 0.02); g.strokeStyle = rgba(0xffffff, 0.18); g.stroke();
    }
  }
  poly4(N, E, S, Wc);
  if (fog) { g.fillStyle = '#c3c6ea'; g.fill(); return; }
  g.fillStyle = ti.top; g.fill();
  const z = cam.z;
  if (ti.water) {
    const shallow = tl.t === T.SHALLOW;
    const isW = (nx, ny) => nx < 0 || ny < 0 || nx >= W || ny >= H || TT.isWater(st.tiles[ny * W + nx].t);
    const nearLand = !isW(x - 1, y) || !isW(x + 1, y) || !isW(x, y - 1) || !isW(x, y + 1);
    // surface: light catches the back corner, depth darkens toward the front
    const grd = g.createLinearGradient(N[0], N[1], S[0], S[1]);
    grd.addColorStop(0, css(lt(ti.topN, shallow ? 0.22 : 0.12))); grd.addColorStop(1, css(dk(ti.topN, shallow ? 0.06 : 0.14)));
    poly4(N, E, S, Wc); g.fillStyle = grd; g.fill();
    g.save(); poly4(N, E, S, Wc); g.clip();
    if (shallow) {
      // sandy seabed seen through clear water
      for (let k = 0; k < 3; k++) {
        const [px, py] = P(x + 0.2 + hash(x, y, 60 + k) * 0.6, y + 0.2 + hash(x, y, 70 + k) * 0.6, h);
        const r = z * (0.1 + hash(x, y, 80 + k) * 0.08);
        g.beginPath(); g.ellipse(px, py, r, r * KR, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(255,238,190,' + (nearLand ? 0.3 : 0.18) + ')'; g.fill();
      }
      for (let k = 0; k < 5; k++) {
        const [px, py] = P(x + 0.12 + hash(x, y, 90 + k) * 0.76, y + 0.12 + hash(x, y, 100 + k) * 0.76, h);
        const r = z * (0.012 + hash(x, y, 110 + k) * 0.014);
        g.beginPath(); g.ellipse(px, py, r, r * KR, 0, 0, Math.PI * 2); g.fillStyle = k % 2 ? 'rgba(40,96,112,0.35)' : 'rgba(255,255,255,0.35)'; g.fill();
      }
      // drifting caustics
      {
        g.strokeStyle = 'rgba(255,255,255,0.17)'; g.lineWidth = Math.max(1, z * 0.01); g.beginPath();
        for (let k = 0; k < 2; k++) {
          const off = (k + 0.5) / 2, ph = (reduceMotion ? 0 : time * 0.6) + hash(x, y, 120 + k) * 6;
          for (let s = 0; s <= 6; s++) {
            const t = s / 6, wob = Math.sin(ph + t * 6.3) * 0.05;
            const [px, py] = P(x + t, y + off + wob, h);
            if (s) g.lineTo(px, py); else g.moveTo(px, py);
          }
        }
        g.stroke();
      }
    } else {
      // deep water: soft wave crests drifting slowly
      g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = Math.max(1, z * 0.016); g.lineCap = 'round'; g.beginPath();
      for (let k = 0; k < 2; k++) {
        const hx = hash(x, y, 20 + k), hy = hash(x, y, 30 + k);
        const [px, py] = P(x + 0.2 + ((hx + time * 0.03) % 1) * 0.6, y + 0.25 + hy * 0.5, h);
        g.moveTo(px - z * 0.08, py + z * 0.01); g.quadraticCurveTo(px - z * 0.02, py - z * 0.035, px + z * 0.06, py);
      }
      g.stroke();
    }
    g.restore();
    // pale reef rim where shallows drop off into deep water
    if (shallow) {
      const deep = (nx, ny) => nx >= 0 && ny >= 0 && nx < W && ny < H && st.tiles[ny * W + nx].t === T.OCEAN;
      const ins = 0.05, cx0 = x + 0.5, cy0 = y + 0.5, pt = (wx, wy) => P(wx + (cx0 - wx) * ins, wy + (cy0 - wy) * ins, h);
      g.beginPath();
      if (deep(x, y - 1)) { const a = pt(x, y), b = pt(x + 1, y); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (deep(x + 1, y)) { const a = pt(x + 1, y), b = pt(x + 1, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (deep(x, y + 1)) { const a = pt(x + 1, y + 1), b = pt(x, y + 1); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (deep(x - 1, y)) { const a = pt(x, y + 1), b = pt(x, y); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      g.lineWidth = Math.max(1.5, z * 0.022); g.strokeStyle = 'rgba(220,250,255,0.45)'; g.setLineDash([z * 0.05, z * 0.04]); g.stroke(); g.setLineDash([]);
    }
    // lily pads and reeds in quiet water by the shore
    if (shallow && nearLand && !tl.res && !tl.imp && hash(x, y, 130) < 0.45 && z > 40) {
      for (let k = 0; k < 2; k++) {
        const [px, py] = P(x + 0.25 + hash(x, y, 140 + k) * 0.5, y + 0.25 + hash(x, y, 150 + k) * 0.5, h);
        const r = z * (0.045 + k * 0.012), a0 = hash(x, y, 160 + k) * 6;
        g.beginPath(); g.ellipse(px, py, r, r * KR, 0, a0 + 0.35, a0 + Math.PI * 2 - 0.35); g.lineTo(px, py); g.closePath();
        g.fillStyle = '#5fae4a'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#2f6a2a'; g.stroke();
        if (k === 0) { g.beginPath(); g.arc(px, py - r * 0.4, r * 0.32, 0, Math.PI * 2); g.fillStyle = '#ffb3cf'; g.fill(); g.beginPath(); g.arc(px, py - r * 0.45, r * 0.13, 0, Math.PI * 2); g.fillStyle = '#ffe36a'; g.fill(); }
      }
      if (hash(x, y, 170) < 0.5) {
        const [rx, ry] = P(x + 0.2 + hash(x, y, 171) * 0.2, y + 0.2 + hash(x, y, 172) * 0.2, h);
        g.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const dx = (k - 1.5) * z * 0.018, hh = z * (0.09 + hash(x, y, 180 + k) * 0.06), sw = reduceMotion ? 0 : Math.sin(time * 1.4 + k) * z * 0.008;
          g.beginPath(); g.moveTo(rx + dx, ry); g.quadraticCurveTo(rx + dx + sw, ry - hh * 0.6, rx + dx + sw * 2, ry - hh);
          g.lineWidth = Math.max(1.2, z * 0.012); g.strokeStyle = '#3f7f3a'; g.stroke();
          if (k === 1) { g.beginPath(); g.ellipse(rx + dx + sw * 1.8, ry - hh * 0.8, z * 0.008, z * 0.022, 0, 0, Math.PI * 2); g.fillStyle = '#7a4f2a'; g.fill(); }
        }
      }
    }
    // foam where land rises behind this water tile
    const landAt = (nx, ny) => nx >= 0 && ny >= 0 && nx < W && ny < H && !TT.isWater(st.tiles[ny * W + nx].t) && explored(ny * W + nx);
    const fa = 0.5 + 0.2 * Math.sin(time * 1.7 + i);
    g.lineWidth = Math.max(1.5, z * 0.03); g.strokeStyle = 'rgba(255,255,255,' + fa.toFixed(2) + ')'; g.lineCap = 'round';
    g.beginPath();
    if (landAt(x, y - 1)) { const a = P(x + 0.04, y + 0.05, h), b = P(x + 0.96, y + 0.05, h); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    if (landAt(x - 1, y)) { const a = P(x + 0.05, y + 0.04, h), b = P(x + 0.05, y + 0.96, h); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
  } else if (false) {
    g.strokeStyle = 'rgba(30,60,20,0.18)'; g.lineWidth = Math.max(1, z * 0.012); g.beginPath();
    for (let k = 0; k < 3; k++) {
      const hx = hash(x, y, 40 + k), hy = hash(x, y, 50 + k);
      if (hx < 0.25) continue;
      const [px, py] = P(x + 0.2 + hx * 0.6, y + 0.2 + hy * 0.6, h);
      g.moveTo(px - z * 0.025, py - z * 0.035); g.lineTo(px, py); g.lineTo(px + z * 0.03, py - z * 0.04);
    }
    g.stroke();
  }
  if (!ti.water && (tl.imp === 'farm' || (tl.res === 'crop' && !tl.imp))) drawField(x, y, h, z, tl, time);
  if (!ti.water && (tl.road || tl.site >= 0)) drawRoad(x, y, h, z);
  if (showGrid && z > 36) { poly4(N, E, S, Wc); g.lineWidth = 1; g.strokeStyle = ti.water ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,20,0.10)'; g.stroke(); }
  // territory tint & borders on the top face
  if (tl.owner >= 0) {
    const col = st.players[tl.owner].color;
    if (ti.water) { poly4(N, E, S, Wc); g.fillStyle = rgba(col, 0.17); g.fill(); }
    const diff = (nx, ny) => nx < 0 || ny < 0 || nx >= W || ny >= H || st.tiles[ny * W + nx].owner !== tl.owner;
    const ins = 0.07, cx0 = x + 0.5, cy0 = y + 0.5;
    const pt = (wx, wy) => P(wx + (cx0 - wx) * ins, wy + (cy0 - wy) * ins, h);
    const segs = [];
    if (diff(x, y - 1)) segs.push([pt(x, y), pt(x + 1, y)]);
    if (diff(x + 1, y)) segs.push([pt(x + 1, y), pt(x + 1, y + 1)]);
    if (diff(x, y + 1)) segs.push([pt(x + 1, y + 1), pt(x, y + 1)]);
    if (diff(x - 1, y)) segs.push([pt(x, y + 1), pt(x, y)]);
    if (segs.length) {
      g.lineCap = 'round';
      g.beginPath(); for (const [a, b] of segs) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      const bw = Math.max(2.5, z * 0.045);
      g.lineWidth = bw + 2.5; g.strokeStyle = css(dk(col, 0.45)); g.stroke();
      g.lineWidth = bw; g.strokeStyle = css(lt(col, 0.08)); g.stroke();
      g.setLineDash([z * 0.06, z * 0.06]); g.lineWidth = bw * 0.45; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke(); g.setLineDash([]);
    }
  }
  // selection & move tints
  if (HL.sel === i) { poly4(N, E, S, Wc); g.fillStyle = 'rgba(255,236,160,' + (0.22 + 0.08 * Math.sin(time * 4)).toFixed(3) + ')'; g.fill(); }
  else if (HL.movesSet && HL.movesSet.has(i)) { poly4(N, E, S, Wc); g.fillStyle = 'rgba(255,255,255,0.16)'; g.fill(); }
}

// ---------------------------------------------------------------- world (painter's order)
const cityBox = ART.CITY_BOX, unitBox = ART.UNIT_BOX;
const decoBox = { x0: -62, y0: -84, x1: 62, y1: 48 };
const cloudBox = { x0: -72, y0: -72, x1: 72, y1: 72 };
function drawWorld(time) {
  const vr = visibleRange();
  const list = [];
  for (let y = vr.y0; y <= vr.y1; y++) for (let x = vr.x0; x <= vr.x1; x++) {
    const i = y * W + x, d = x + y;
    list.push({ k: d * 10, i, kind: 'block' });
    const tl = st.tiles[i];
    if (tileFog[i] < 0.995 && (tl.site >= 0 || tl.t === T.FOREST || tl.t === T.MOUNTAIN || tl.res || tl.imp || tl.ruin)) list.push({ k: d * 10 + 1, i, kind: 'deco' });
    if (tileFog[i] > 0.01) list.push({ k: d * 10 + 4, i, kind: 'cloud' });
  }
  for (const u of st.units) {
    const d = disp.get(u.id);
    if (!d) continue;
    if (!TT.visibleTo(st, u, viewer) && !d.busy) continue;
    if (u.x < vr.x0 - 1 || u.x > vr.x1 + 1 || u.y < vr.y0 - 1 || u.y > vr.y1 + 1) continue;
    list.push({ k: Math.ceil(d.x + d.y - 1 - 0.001) * 10 + 2, kind: 'unit', u, d });
  }
  for (const [, d] of disp) if (d.dying && d.ghost) list.push({ k: Math.ceil(d.x + d.y - 1 - 0.001) * 10 + 2, kind: 'unit', u: d.ghost, d });
  list.sort((a, b) => a.k - b.k);
  for (const it of list) {
    if (it.kind === 'block') drawBlock(it.i, time);
    else if (it.kind === 'deco') drawTileDeco(it.i, time);
    else if (it.kind === 'cloud') drawCloud(it.i, time);
    else drawUnit(it.u, it.d, time);
  }
}
function popScale(i) {
  const t0 = tilePop[i];
  if (!t0) return 1;
  const p = (now() - t0) / 450;
  if (p >= 1) { tilePop[i] = 0; return 1; }
  return Math.max(0.01, easeOutBack(p));
}
function drawTileDeco(i, time) {
  const tl = st.tiles[i], x = i % W, y = (i / W) | 0, sk = skinOf(tl);
  const h = tileH[i];
  const [sx, sy] = P(x + 0.5, y + 0.5, h);
  const fogA = 1 - tileFog[i], alpha = fogA < 1 ? fogA : null, ps = popScale(i);
  const tribeK = tl.owner >= 0 ? st.players[tl.owner].tribe : 'n';
  const behind = (nx, ny) => nx >= 0 && ny >= 0 && explored(ny * W + nx) && (TT.unitAt(st, nx, ny) || st.tiles[ny * W + nx].site >= 0);
  const tallA = behind(x - 1, y) || behind(x, y - 1) || behind(x - 1, y - 1) ? 0.45 : 1;
  const tallAlpha = (alpha == null ? 1 : alpha) * tallA;
  if (tl.t === T.MOUNTAIN) {
    const c = sprite('mtn|' + tribeK + '|' + (i % 7), decoBox, x2 => ART.mountain(x2, i % 7 + 1, sk, tl.e >= 3 && relief > 0.5), null, { soft: true });
    blitAt(c, decoBox, sx, sy + cam.z * 0.05, { alpha: tallAlpha, scale: ps * 1.0 });
  }
  if (tl.t === T.FOREST && !tl.imp) {
    const c = sprite('for|' + tribeK + '|' + (i % 9), decoBox, x2 => ART.forest(x2, i % 9 + 1, sk, tileInfo[i].snow), null, { soft: true });
    blitAt(c, decoBox, sx, sy + cam.z * 0.02, { alpha: tallAlpha, scale: ps * 0.9, skew: reduceMotion ? 0 : Math.sin(time * 1.3 + i) * 0.02 });
  }
  if (tl.imp && tl.imp !== 'farm') {
    const c = sprite('imp|' + tl.imp + '|' + tribeK, decoBox, x2 => ART.improvement(x2, tl.imp, sk, tl.owner >= 0 ? st.players[tl.owner].color : null));
    blitAt(c, decoBox, sx, sy, { alpha, scale: ps * 0.9 });
  }
  if (tl.res && tl.res !== 'crop' && !(tl.imp === 'farm' || tl.imp === 'mine')) {
    if (tl.res === 'fish') drawFish(sx, sy, time, i, alpha);
    else {
      const c = sprite('res|' + tl.res, decoBox, x2 => ART.resource(x2, tl.res, i));
      let oy = 0;
      if (tl.res === 'game' && !reduceMotion) { const cyc = (time * 0.6 + hash(x, y, 2) * 5) % 4; oy = cyc < 0.35 ? -Math.sin(cyc / 0.35 * Math.PI) * cam.z * 0.05 : 0; }
      blitAt(c, decoBox, sx, sy + oy, { alpha, scale: ps * 0.9, flip: tl.res === 'game' && hash(x, y, 4) > 0.5 });
    }
  }
  if (tl.ruin) { const c = sprite('ruin', decoBox, x2 => ART.ruin(x2)); blitAt(c, decoBox, sx, sy, { alpha, scale: ps * 0.9 }); }
  if (tl.site >= 0) drawCity(st.cities[tl.site], sx, sy, time, alpha);
}
function drawFish(sx, sy, time, i, alpha) {
  const z = cam.z, s = z * SPR;
  g.save(); g.translate(sx, sy); g.scale(s, s * KR);
  if (alpha != null) g.globalAlpha = alpha;
  for (const [rx, ry, k] of [[-16, 10, 1], [16, -10, 0.7]]) { g.beginPath(); g.ellipse(rx, ry, 13 * k, 7 * k, 0, 0, Math.PI * 2); g.lineWidth = 2.4; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(); }
  g.restore();
  const cyc = (time * 0.55 + (i % 13) * 0.37) % 3;
  g.save(); g.translate(sx, sy); g.scale(s, s);
  if (alpha != null) g.globalAlpha = alpha;
  if (cyc < 0.9 && !reduceMotion) {
    const k = cyc / 0.9;
    ART.fishBody(g, lerp(-22, 22, k), -Math.sin(k * Math.PI) * 30, 1, lerp(-0.9, 0.9, k));
  } else { g.globalAlpha = (alpha == null ? 1 : alpha) * 0.5; ART.fishBody(g, 4, -2, 0.9, 0.15 + Math.sin(time * 2 + i) * 0.1); }
  g.restore();
}
function drawCity(c, sx, sy, time, alpha) {
  const night = dayK < 0.45, z = cam.z, s = z * SPR;
  if (c.owner < 0) {
    blitAt(sprite('village', cityBox, x2 => ART.village(x2, c.id)), cityBox, sx, sy, { alpha });
    if (z > 30) {
      g.save(); g.translate(sx + 24 * s, sy + 16 * s); g.scale(s, s);
      const f = 1 + Math.sin(time * 14) * 0.12 + Math.sin(time * 9.3) * 0.08;
      g.beginPath(); g.moveTo(-3.5, 0); g.quadraticCurveTo(-4, -6 * f, 0, -11 * f); g.quadraticCurveTo(4, -6 * f, 3.5, 0); g.closePath(); g.fillStyle = '#ff9a2a'; g.fill();
      g.beginPath(); g.moveTo(-1.8, 0); g.quadraticCurveTo(-2, -3.5 * f, 0, -6.5 * f); g.quadraticCurveTo(2, -3.5 * f, 1.8, 0); g.closePath(); g.fillStyle = '#ffe36a'; g.fill();
      g.restore();
    }
    return;
  }
  const Pp = st.players[c.owner];
  const key = 'city|' + Pp.tribe + '|' + Math.min(c.level, 7) + '|' + (c.walls ? 1 : 0) + (c.capital ? 1 : 0) + (c.workshop ? 1 : 0) + Math.min(2, c.parks) + (night ? 'n' : 'd');
  let sc = 1;
  const pop = cityPop.get(c.id);
  if (pop) { const p = (now() - pop) / 500; if (p >= 1) cityPop.delete(c.id); else sc = easeOutBack(Math.max(0.02, p)); }
  blitAt(sprite(key, cityBox, x2 => ART.city(x2, c, Pp.tribe, Pp.color, night)), cityBox, sx, sy, { alpha, scale: sc });
  if (z > 36) {
    const fy = c.capital ? -18 - 38 * (1.15 + Math.min(c.level, 5) * 0.04) : -16 - 26;
    g.save(); g.translate(sx + 1 * s, sy + fy * s); g.scale(s, s);
    if (alpha != null) g.globalAlpha = alpha;
    if (c.capital) { g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.lineWidth = 1.6; g.strokeStyle = '#5e3a1d'; g.stroke(); g.translate(0, -14); }
    const wv = reduceMotion ? 0 : time * 6;
    g.beginPath(); g.moveTo(0, 0);
    for (let k = 0; k <= 6; k++) g.lineTo(k * 2.4, Math.sin(wv - k * 0.8) * 1.4 * (k / 6));
    for (let k = 6; k >= 0; k--) g.lineTo(k * 2.4, 7 + Math.sin(wv - k * 0.8) * 1.4 * (k / 6));
    g.closePath(); g.fillStyle = css(Pp.color); g.fill(); g.lineWidth = 1.1; g.strokeStyle = '#2a2140'; g.stroke();
    g.restore();
  }
  const crowd = TT.unitAt(st, c.x, c.y) || (c.x > 0 && TT.unitAt(st, c.x - 1, c.y)) || (c.y > 0 && TT.unitAt(st, c.x, c.y - 1)) || (c.x > 0 && c.y > 0 && TT.unitAt(st, c.x - 1, c.y - 1));
  if (!crowd && z > 40 && !reduceMotion && Math.random() < 0.008 * Math.min(4, c.level)) emit(c.x + 0.5 + (Math.random() - 0.5) * 0.3, c.y + 0.5 + (Math.random() - 0.5) * 0.3, { n: 1, color: [0xd0d1e0, 0xbfc0d3], speed: 0.04, up: 0.4, gravity: -0.1, life: 1.8, size: 0.035, z: 0.35 });
}

function unitAnchor(u, d) {
  const h = groundH(d.x, d.y);
  const tl = st.tiles[u.y * W + u.x];
  const onSite = !d.busy && tl && tl.site >= 0;
  const nav = d.form !== undefined ? d.form : u.naval;
  const atPort = !d.busy && tl && tl.imp === 'port' && nav;
  // on a city, stand at the front corner so the buildings stay visible; in a port, moor at the berth beside the pier
  const fx = onSite ? 0.22 : atPort ? 0.02 : 0, fy = onSite ? 0.22 : atPort ? 0.3 : 0;
  const [ax, ay] = P(d.x + fx, d.y + fy, Math.max(h, u.naval ? 0 : h) + d.z);
  return [ax, ay];
}
function drawUnit(u, d, time) {
  const Pp = st.players[u.owner];
  const nav = d.form !== undefined ? d.form : u.naval;
  const key = 'u|' + u.type + '|' + (nav || '') + '|' + Pp.tribe;
  const drawFn = x2 => ART.drawUnit(x2, { type: u.type, naval: nav, color: Pp.color, tribe: Pp.tribe });
  const spent = viewer === u.owner && st.current === u.owner && !Pp.isAI && !u.canMove && !u.canAttack && !d.busy;
  const c = sprite(key, unitBox, drawFn, u.frozen ? 'frozen' : spent ? 'spent' : null, { halo: true });
  const naval = !!nav, fly = u.type === 'balloon' && !naval;
  const stealthy = !naval && TT.UNITS[u.type].skills.indexOf('stealth') >= 0;
  let [ax, ay] = unitAnchor(u, d);
  const z = cam.z;
  let sy = 1, rot = d.tilt || 0;
  if (!d.busy && !reduceMotion) {
    if (naval) { ay += Math.sin(time * 1.6 + d.ph) * z * 0.008; rot += Math.sin(time * 1.3 + d.ph) * 0.04; }
    else if (fly) ay += (-0.05 + Math.sin(time * 1.2 + d.ph) * 0.025) * z;
    else sy = 1 + Math.sin(time * 2.4 + d.ph) * 0.018;
    if (R3.selUnit === u.id) ay -= Math.abs(Math.sin(time * 4.5)) * z * 0.06;
  }
  const [bx, by] = unitAnchor(u, Object.assign({}, d, { z: 0 }));
  const ready = viewer === u.owner && st.current === u.owner && !Pp.isAI && (u.canMove || u.canAttack) && !d.busy;
  if (!naval) {
    // owner base disc, flattened to the iso ground plane
    g.beginPath(); g.ellipse(bx, by, z * 0.16, z * 0.16 * KR, 0, 0, Math.PI * 2);
    g.fillStyle = rgba(Pp.color, spent ? 0.35 : 0.9); g.fill();
    g.lineWidth = Math.max(1.2, z * 0.012); g.strokeStyle = css(dk(Pp.color, 0.5)); g.stroke();
    if (ready) {
      const pulse = 0.55 + 0.35 * Math.sin(time * 3 + d.ph);
      g.beginPath(); g.ellipse(bx, by, z * 0.22, z * 0.22 * KR, 0, 0, Math.PI * 2);
      g.lineWidth = Math.max(2, z * 0.022); g.strokeStyle = 'rgba(255,255,255,' + pulse.toFixed(2) + ')'; g.stroke();
    }
  }
  // boats sit in the water: the hull is cut at the waterline (and sinks below it when dying)
  const cutWater = naval || d.sink;
  if (cutWater) {
    const waterY = by - (naval ? z * SPR * 4.5 * SPRY : -z * 0.035);
    if (naval && !d.sink) {
      const t = time * 2 + d.ph, rw = z * 0.27, rh = rw * KR * 0.75;
      g.beginPath(); g.ellipse(ax, waterY + 1, rw, rh, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(20,50,90,0.22)'; g.fill();
    }
    g.save(); g.beginPath(); g.rect(-50, -50, VW + 100, waterY + 50); g.clip();
    ay += (d.sink || 0) * z * SPR * 100 * 0.62 * SPRY;
  }
  const doomed = sweatSet && sweatSet.has(u.id) && !d.busy;
  if (doomed && !reduceMotion) { ax += Math.sin(time * 47 + d.ph) * z * 0.007; rot += Math.sin(time * 31) * 0.025; }
  blitAt(c, unitBox, ax, ay, { flip: d.face < 0, sy: sy * d.scale, scale: d.scale, alpha: d.alpha * (stealthy ? 0.62 + 0.12 * Math.sin(time * 2 + d.ph) : 1), rot });
  if (doomed) drawSweat(ax, ay - z * SPR * 100 * (u.naval ? 0.3 : 0.5) * SPRY, z, time, d);
  if (d.flash > 0.01) blitAt(sprite(key, unitBox, drawFn, 'flash'), unitBox, ax, ay, { flip: d.face < 0, sy: sy * d.scale, scale: d.scale, alpha: d.flash * d.alpha, rot });
  if (cutWater) {
    g.restore();
    if (naval && !d.sink) {
      // foam where the hull meets the water
      const waterY = by - z * SPR * 4.5 * SPRY, t = time * 2.2 + d.ph, rw = z * 0.24, rh = rw * KR * 0.55;
      g.beginPath(); g.ellipse(ax, waterY, rw * (1 + Math.sin(t) * 0.04), rh, 0, 0, Math.PI); g.lineWidth = Math.max(1.5, z * 0.016); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.stroke();
      g.beginPath(); g.ellipse(ax, waterY + rh * 0.5, rw * 1.25, rh * 1.4, 0, 0.15, Math.PI - 0.15); g.lineWidth = Math.max(1, z * 0.01); g.strokeStyle = 'rgba(255,255,255,' + (0.3 + 0.2 * Math.sin(t)).toFixed(2) + ')'; g.stroke();
    }
  }
}
function drawCloud(i, time) {
  const f = tileFog[i], x = i % W, y = (i / W) | 0;
  const v = (x * 7 + y * 13) % 6;
  const c = sprite('cloud|' + v, cloudBox, x2 => ART.cloud(x2, v + 1));
  const dx = reduceMotion ? 0 : Math.sin(time * 0.25 + i * 0.7) * 0.03;
  const [sx, sy] = P(x + 0.5 + dx, y + 0.5, FOG_H + 0.08 + (1 - f) * 0.3);
  blitAt(c, cloudBox, sx, sy, { alpha: f, scale: (1.05 + (1 - f) * 0.4), sy: 0.8 });
}

// ---------------------------------------------------------------- storm
function drawStorm(time, dt) {
  const s = st.storm;
  if (s) {
    if (!stormD) stormD = { x: s.x + 0.5, y: s.y + 0.5, a: 0 };
    stormD.x = lerp(stormD.x, s.x + 0.5, Math.min(1, dt * 1.5)); stormD.y = lerp(stormD.y, s.y + 0.5, Math.min(1, dt * 1.5));
    stormD.a = Math.min(1, stormD.a + dt);
  } else if (stormD) { stormD.a -= dt; if (stormD.a <= 0) { stormD = null; return; } }
  if (!stormD) return;
  const z = cam.z, a = stormD.a;
  const N = P(stormD.x - 1.5, stormD.y - 1.5, 0.15), E = P(stormD.x + 1.5, stormD.y - 1.5, 0.15), S = P(stormD.x + 1.5, stormD.y + 1.5, 0.15), Wc = P(stormD.x - 1.5, stormD.y + 1.5, 0.15);
  poly4(N, E, S, Wc); g.fillStyle = 'rgba(30,30,70,' + (0.2 * a).toFixed(3) + ')'; g.fill();
  g.strokeStyle = 'rgba(200,215,255,' + (0.6 * a).toFixed(3) + ')'; g.lineWidth = Math.max(1, z * 0.01);
  g.beginPath();
  for (let k = 0; k < 80; k++) {
    const hx = hash(k, 3, 1), hy = hash(k, 7, 2), fall = (hash(k, 9, 3) + time * (1.1 + hash(k, 1, 4))) % 1;
    const [px, py] = P(stormD.x - 1.5 + hx * 3, stormD.y - 1.5 + hy * 3, 1.1 - fall * 1.0);
    g.moveTo(px, py); g.lineTo(px - z * 0.02, py + z * 0.1);
  }
  g.stroke();
  const cc = sprite('stormcloud', cloudBox, x2 => { ART.cloud(x2, 9); x2.globalCompositeOperation = 'source-atop'; x2.fillStyle = 'rgba(70,72,110,.72)'; x2.fillRect(-80, -80, 160, 160); });
  for (const [ox, oy, s2] of [[-0.8, -0.6, 1.1], [0.6, -0.7, 1.25], [0, 0.4, 1.0], [-0.3, -0.1, 1.3]]) {
    const [px, py] = P(stormD.x + ox + Math.sin(time * 0.4 + ox) * 0.05, stormD.y + oy, 1.2);
    blitAt(cc, cloudBox, px, py, { scale: s2 * 1.2, alpha: a * 0.95, sy: 0.75 });
  }
  if (!reduceMotion && Math.random() < dt * 0.35) lightning = { x: stormD.x + (Math.random() - 0.5) * 2, y: stormD.y + (Math.random() - 0.5) * 2, t0: now() };
  if (lightning) {
    const p = (now() - lightning.t0) / 260;
    if (p >= 1) lightning = null;
    else {
      g.save(); g.globalAlpha = 1 - p; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, VW, VH);
      let [lx, ly] = P(lightning.x, lightning.y, 1.2); g.beginPath(); g.moveTo(lx, ly);
      for (let k = 0; k < 5; k++) { lx += (hash(k, lightning.t0 | 0, 1) - 0.5) * z * 0.25; ly += z * 0.22; g.lineTo(lx, ly); }
      g.lineWidth = Math.max(2, z * 0.03); g.strokeStyle = '#fffbe0'; g.stroke(); g.restore();
    }
  }
}

// ---------------------------------------------------------------- overlay
function diamond(x, y, ins, h) {
  const cx = x + 0.5, cy = y + 0.5, f = 0.5 - ins;
  const a = P(cx - f, cy - f, h), b = P(cx + f, cy - f, h), c = P(cx + f, cy + f, h), d = P(cx - f, cy + f, h);
  poly4(a, b, c, d);
}
function drawOverlay(time) {
  const z = cam.z;
  if (HL.moves) {
    for (const i of HL.moves) {
      const x = i % W, y = (i / W) | 0, [cx, cy] = P(x + 0.5, y + 0.5, tileH[i]);
      const r = Math.max(5, z * 0.075) * (0.92 + 0.08 * Math.sin(time * 3 + i));
      g.beginPath(); g.ellipse(cx, cy + 1.5, r + 2, (r + 2) * KR, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(20,16,40,0.35)'; g.fill();
      g.beginPath(); g.ellipse(cx, cy, r, r * KR, 0, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    }
  }
  if (pathPts) {
    g.fillStyle = css(C.gold);
    for (let k = 1; k < pathPts.length; k++) {
      const [ax, ay] = pathPts[k - 1], [bx, by] = pathPts[k];
      for (const t of [0.33, 0.66]) { const wx = lerp(ax, bx, t) + 0.5, wy = lerp(ay, by, t) + 0.5; const [px, py] = P(wx, wy, groundH(wx, wy)); g.beginPath(); g.ellipse(px, py, Math.max(3, z * 0.03), Math.max(2, z * 0.03 * KR), 0, 0, Math.PI * 2); g.fill(); }
    }
    const e = pathPts[pathPts.length - 1];
    const [ex, ey] = P(e[0] + 0.5, e[1] + 0.5, tileH[e[1] * W + e[0]]);
    g.beginPath(); g.ellipse(ex, ey, Math.max(8, z * 0.13), Math.max(4, z * 0.13 * KR), 0, 0, Math.PI * 2); g.lineWidth = Math.max(2, z * 0.025); g.strokeStyle = css(C.gold); g.stroke();
  }
  const outline = (i, color, w, ins) => {
    const x = i % W, y = (i / W) | 0;
    diamond(x, y, ins, tileH[i]);
    g.lineJoin = 'round';
    g.lineWidth = w + 3; g.strokeStyle = 'rgba(20,16,40,0.5)'; g.stroke();
    g.lineWidth = w; g.strokeStyle = color; g.stroke();
  };
  if (actionable && !HL.unit) {
    const burst = actionPulse ? Math.max(0, 1 - (now() - actionPulse) / 2400) : 0;
    for (const i of actionable) {
      const x = i % W, y = (i / W) | 0;
      if (tileFog[i] > 0.5) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + i * 0.7);
      diamond(x, y, 0.1 - burst * 0.06, tileH[i]);
      g.fillStyle = 'rgba(255,214,94,' + (0.12 + pulse * 0.12 + burst * 0.35).toFixed(3) + ')'; g.fill();
      g.lineWidth = Math.max(2, z * (0.022 + burst * 0.02)); g.setLineDash([z * 0.07, z * 0.05]); g.lineDashOffset = -time * z * 0.12;
      g.strokeStyle = 'rgba(255,214,94,' + (0.6 + pulse * 0.35).toFixed(2) + ')'; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
      // sparkle
      const [sx, sy] = P(x + 0.5, y + 0.5, tileH[i] + 0.32 + Math.sin(time * 2 + i) * 0.03);
      const r = Math.max(4, z * 0.045) * (0.8 + pulse * 0.4);
      g.beginPath(); g.moveTo(sx, sy - r * 1.6); g.quadraticCurveTo(sx, sy, sx + r * 1.6, sy); g.quadraticCurveTo(sx, sy, sx, sy + r * 1.6); g.quadraticCurveTo(sx, sy, sx - r * 1.6, sy); g.quadraticCurveTo(sx, sy, sx, sy - r * 1.6);
      g.fillStyle = '#fff3c4'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(122,84,16,0.8)'; g.stroke();
    }
  }
  if (HL.attacks) for (const i of HL.attacks) outline(i, '#ff5a48', Math.max(3, z * 0.035), 0.06 + 0.03 * Math.sin(time * 6));
  if (HL.sel != null && HL.sel >= 0) outline(HL.sel, css(C.gold), Math.max(3, z * 0.035), 0.03 + 0.02 * Math.sin(time * 4));
  if (hoverI >= 0 && hoverI !== HL.sel) { const x = hoverI % W, y = (hoverI / W) | 0; diamond(x, y, 0.03, tileH[hoverI]); g.lineWidth = Math.max(1.5, z * 0.018); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke(); }
}

// ---------------------------------------------------------------- labels (big and legible)
function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawLabels(time) {
  const z = cam.z;
  const lum = c => { const r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255; return (r * 0.3 + gg * 0.59 + b * 0.11) / 255; };
  if (z > 38) {
    const fz = Math.max(13, Math.min(20, z * 0.12));
    g.textBaseline = 'middle';
    for (const c of st.cities) {
      const i = c.y * W + c.x;
      if (tileFog[i] > 0.5) continue;
      const [cx, cy0] = P(c.x + 0.5, c.y + 0.5, tileH[i]);
      const cy = cy0 + z * 0.24;
      if (cx < -200 || cx > VW + 200 || cy < -60 || cy > VH + 60) continue;
      const own = c.owner >= 0, col = own ? st.players[c.owner].color : 0x2a2448;
      g.font = fz + 'px "Lilita One", "Arial Rounded MT Bold", sans-serif';
      const name = c.name, tw = g.measureText(name).width;
      const lvW = own ? fz * 1.5 : 0, starW = c.capital ? fz * 1.05 : 0;
      const ph = fz * 1.6, pw = tw + fz * 1.1 + lvW + starW;
      const x0 = cx - pw / 2, y0 = cy - ph / 2;
      rrect(x0, y0 + 3, pw, ph, ph * 0.3); g.fillStyle = 'rgba(20,16,40,0.45)'; g.fill();
      rrect(x0, y0, pw, ph, ph * 0.3); g.fillStyle = own ? css(col) : 'rgba(34,30,64,0.88)'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = own ? css(dk(col, 0.45)) : 'rgba(255,255,255,0.3)'; g.stroke();
      const ink = own ? '#16132e' : '#f4ead0';
      let tx = x0 + fz * 0.55;
      if (c.capital) {
        g.save(); g.translate(tx + fz * 0.4, cy); g.scale(fz / 22, fz / 22);
        g.beginPath(); for (let k = 0; k < 10; k++) { const rr2 = k % 2 ? 4 : 9, a = k / 10 * Math.PI * 2 - Math.PI / 2; k ? g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2) : g.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
        g.closePath(); g.fillStyle = '#ffd45e'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#6b4a10'; g.stroke(); g.restore();
        tx += starW;
      }
      g.textAlign = 'left'; g.fillStyle = lum(col) > 0.85 && own ? '#16132e' : ink; g.fillText(name, tx, cy + 1);
      if (own) {
        // level medallion
        const lx = x0 + pw - fz * 0.95;
        g.beginPath(); g.arc(lx, cy, fz * 0.62, 0, Math.PI * 2); g.fillStyle = '#16132e'; g.fill();
        g.font = fz * 0.9 + 'px "Lilita One", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.fillText(String(c.level), lx, cy + 1);
        // population bar under the label
        const n = c.level + 1, bw = Math.max(pw * 0.9, n * fz * 0.7), bh = Math.max(6, fz * 0.42);
        const bx = cx - bw / 2, by = y0 + ph + 4;
        rrect(bx - 2, by - 2, bw + 4, bh + 4, (bh + 4) / 2); g.fillStyle = 'rgba(20,16,40,0.75)'; g.fill();
        const seg = bw / n;
        for (let k = 0; k < n; k++) {
          rrect(bx + k * seg + 1, by, seg - 2, bh, bh / 2);
          g.fillStyle = k < c.pop ? '#ffd45e' : 'rgba(255,255,255,0.18)'; g.fill();
        }
      }
    }
  }
  // HP badges: big, high-contrast numbers
  if (z > 30) {
    const r = Math.max(10, Math.min(17, z * 0.085));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const u of st.units) {
      const d = disp.get(u.id);
      if (!d || d.alpha < 0.3) continue;
      if (!TT.visibleTo(st, u, viewer) && !d.busy) continue;
      const S = TT.stats(st, u), Pp = st.players[u.owner];
      const [ax, ay] = unitAnchor(u, d);
      const tall = u.type === 'balloon' && !u.naval ? 1.05 : TT.UNITS[u.type].super ? 0.9 : u.naval ? 0.58 : 0.66;
      const bx = ax + z * 0.2, by = ay - z * SPR * 100 * tall * 0.78 * SPRY;
      if (bx < -40 || bx > VW + 40 || by < -40 || by > VH + 40) continue;
      const spent = viewer === u.owner && st.current === u.owner && !Pp.isAI && !u.canMove && !u.canAttack;
      g.globalAlpha = spent ? 0.65 : 1;
      g.beginPath(); g.arc(bx, by + 2, r + 2, 0, Math.PI * 2); g.fillStyle = 'rgba(20,16,40,0.4)'; g.fill();
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fillStyle = u.frozen ? '#d6ecff' : '#151937'; g.fill();
      g.lineWidth = Math.max(2.5, r * 0.24); g.strokeStyle = css(Pp.color); g.stroke();
      g.font = '800 ' + Math.round(r * 1.12) + 'px Figtree, system-ui, sans-serif';
      g.fillStyle = u.frozen ? '#12304f' : u.hp <= S.maxHp * 0.35 ? '#ff8c80' : '#ffffff';
      g.fillText(String(u.hp), bx, by + 0.5);
      if (u.vet) {
        g.save(); g.translate(bx - r * 1.05, by - r * 0.75); g.scale(r / 9, r / 9);
        g.beginPath(); for (let k = 0; k < 10; k++) { const rr2 = k % 2 ? 2.6 : 6, a = k / 10 * Math.PI * 2 - Math.PI / 2; k ? g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2) : g.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
        g.closePath(); g.fillStyle = '#ffc94a'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#7a5410'; g.stroke(); g.restore();
      }
      g.globalAlpha = 1;
    }
  }
  drawClaimArrows(time);
  drawSiege(time);
}

// cities of the viewer with an enemy standing in them: red pulsing tile, alarm badge, sparks
let siegeSet = null;
R3.setSiege = function (set) { siegeSet = set && set.size ? set : null; };
function drawSiege(time) {
  if (!siegeSet || !st) return;
  const z = cam.z;
  for (const id of siegeSet) {
    const c = st.cities[id];
    if (!c) continue;
    const i = c.y * W + c.x;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    diamond(c.x, c.y, -0.02 - pulse * 0.04, tileH[i]);
    g.fillStyle = 'rgba(255,60,40,' + (0.12 + pulse * 0.12).toFixed(3) + ')'; g.fill();
    g.lineWidth = Math.max(3, z * 0.035); g.strokeStyle = 'rgba(255,80,60,' + (0.6 + pulse * 0.4).toFixed(2) + ')'; g.lineJoin = 'round'; g.stroke();
    // alarm badge above the city
    const [cx, cy] = P(c.x + 0.5, c.y + 0.5, tileH[i]);
    const r = Math.max(13, Math.min(24, z * 0.12)), shake = reduceMotion ? 0 : Math.sin(time * 22) * r * 0.08 * pulse;
    const bx = cx - z * 0.28 + shake, by = cy - z * 0.62;
    g.beginPath(); g.arc(bx, by, r * (1.5 + pulse * 0.5), 0, Math.PI * 2); g.fillStyle = 'rgba(255,60,40,' + (0.28 * (1 - pulse)).toFixed(3) + ')'; g.fill();
    g.beginPath(); for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * Math.PI / 3; const px = bx + Math.cos(a) * r, py = by + Math.sin(a) * r; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath();
    g.fillStyle = '#e8402c'; g.fill(); g.lineWidth = Math.max(2.5, r * 0.18); g.strokeStyle = '#ffffff'; g.stroke();
    g.font = Math.round(r * 1.25) + 'px "Lilita One", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
    g.fillText('!', bx, by + 1);
    if (!reduceMotion && Math.random() < 0.08) emit(c.x + 0.5 + (Math.random() - 0.5) * 0.4, c.y + 0.5 + (Math.random() - 0.5) * 0.4, { n: 1, color: [0xff6a2a, 0xffb02a], speed: 0.3, up: 1.4, gravity: -0.2, life: 0.8, size: 0.03, z: 0.15 });
  }
}

// bouncing "Claim" arrow over every unit of the viewer that can found or capture a city right now
let claimHits = [];
function drawClaimArrows(time) {
  claimHits = [];
  if (viewer < 0 || st.current !== viewer || st.players[viewer].isAI || st.over) return;
  const z = cam.z;
  for (const u of st.units) {
    if (u.owner !== viewer || !TT.canCapture(st, u)) continue;
    const d = disp.get(u.id);
    if (!d || d.busy) continue;
    const i = u.y * W + u.x;
    // pulsing gold outline on the city tile
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    diamond(u.x, u.y, 0.04 + pulse * 0.03, tileH[i]);
    g.lineWidth = Math.max(3, z * 0.03); g.strokeStyle = 'rgba(255,214,94,' + (0.55 + pulse * 0.4).toFixed(2) + ')'; g.lineJoin = 'round'; g.stroke();
    const [ax, ay] = unitAnchor(u, d);
    const tall = TT.UNITS[u.type].super ? 0.9 : 0.66;
    const s = Math.max(24, Math.min(42, z * 0.22));
    const bounce = reduceMotion ? 0 : Math.abs(Math.sin(time * 3.6)) * s * 0.45;
    const tipX = ax, tipY = ay - z * SPR * 100 * tall * SPRY - s * 0.55 - bounce;
    const headW = s * 0.62, headH = s * 0.6, shaftW = s * 0.38, shaftH = s * 0.62;
    g.save();
    // soft drop shadow on the ground, shrinking as the arrow rises
    g.beginPath(); g.ellipse(ax, ay - 2, s * (0.55 - bounce / s * 0.25), s * (0.55 - bounce / s * 0.25) * KR, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(40,30,0,0.18)'; g.fill();
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(tipX + headW, tipY - headH);
    g.lineTo(tipX + shaftW / 2, tipY - headH);
    g.lineTo(tipX + shaftW / 2, tipY - headH - shaftH + shaftW / 2);
    g.quadraticCurveTo(tipX + shaftW / 2, tipY - headH - shaftH, tipX, tipY - headH - shaftH);
    g.quadraticCurveTo(tipX - shaftW / 2, tipY - headH - shaftH, tipX - shaftW / 2, tipY - headH - shaftH + shaftW / 2);
    g.lineTo(tipX - shaftW / 2, tipY - headH);
    g.lineTo(tipX - headW, tipY - headH);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(5, s * 0.22); g.strokeStyle = '#5a3c08'; g.stroke();
    const grd = g.createLinearGradient(0, tipY - headH - shaftH, 0, tipY);
    grd.addColorStop(0, '#fff2b0'); grd.addColorStop(0.5, '#ffd45e'); grd.addColorStop(1, '#f2a91f');
    g.fillStyle = grd; g.fill();
    g.beginPath(); g.moveTo(tipX - shaftW * 0.18, tipY - headH - shaftH * 0.82); g.lineTo(tipX - shaftW * 0.18, tipY - headH - 2);
    g.lineWidth = Math.max(1.5, s * 0.07); g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.stroke();
    // "Claim" pill above the arrow
    const fz = Math.max(12, Math.min(17, s * 0.5));
    g.font = '800 ' + Math.round(fz) + 'px Figtree, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = 'Claim', tw = g.measureText(label).width, pw = tw + fz * 1.3, ph = fz * 1.75;
    const py = tipY - headH - shaftH - ph / 2 - 6;
    rrect(tipX - pw / 2, py - ph / 2 + 2, pw, ph, ph / 2); g.fillStyle = 'rgba(20,16,40,0.4)'; g.fill();
    rrect(tipX - pw / 2, py - ph / 2, pw, ph, ph / 2); g.fillStyle = '#1b1f45'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#ffd45e'; g.stroke();
    g.fillStyle = '#ffd45e'; g.fillText(label, tipX, py + 1);
    g.restore();
    // hit area covers the whole bounce so a tap always lands
    const restTip = tipY + bounce, maxB = s * 0.45;
    claimHits.push({ uid: u.id, x0: tipX - Math.max(pw / 2, headW) - 10, x1: tipX + Math.max(pw / 2, headW) + 10, y0: restTip - maxB - headH - shaftH - ph - 14, y1: restTip + 8 });
  }
}
// returns the unit id whose claim arrow is under the pointer
R3.pickClaim = function (clientX, clientY) {
  if (!cv) return null;
  const r = cv.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
  for (const h of claimHits) if (px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) return h.uid;
  return null;
};

// ---------------------------------------------------------------- fx
function drawFx(dt, time) {
  const z = cam.z;
  for (let k = beams.length - 1; k >= 0; k--) {
    const b = beams[k], p = (now() - b.t0) / b.d;
    if (p >= 1) { beams.splice(k, 1); continue; }
    const [cx, cy] = P(b.x, b.y, groundH(b.x, b.y));
    const a = Math.sin(p * Math.PI) * 0.55, w = z * 0.45 * (1 - p * 0.4), h = z * 2.2;
    const grd = g.createLinearGradient(0, cy - h, 0, cy);
    grd.addColorStop(0, rgba(b.c, 0)); grd.addColorStop(1, rgba(b.c, a));
    g.fillStyle = grd; g.fillRect(cx - w / 2, cy - h, w, h);
  }
  for (let k = rings.length - 1; k >= 0; k--) {
    const r = rings[k], p = (now() - r.t0) / r.d;
    if (p >= 1) { rings.splice(k, 1); continue; }
    const [cx, cy] = P(r.x, r.y, groundH(r.x, r.y));
    const rad = z * (0.18 + p * r.r * 0.5);
    g.beginPath(); g.ellipse(cx, cy, rad, rad * KR, 0, 0, Math.PI * 2);
    g.lineWidth = Math.max(1.5, z * r.w * (1 - p)); g.strokeStyle = r.c; g.globalAlpha = 1 - p; g.stroke(); g.globalAlpha = 1;
  }
  for (let k = projs.length - 1; k >= 0; k--) {
    const pr = projs[k], p = Math.min(1, (now() - pr.t0) / pr.d);
    const e = pr.kind === 'bomb' ? p * p : p;
    const wx = lerp(pr.ax, pr.bx, e), wy = lerp(pr.ay, pr.by, e), hh = lerp(pr.ah, pr.bh, e) + Math.sin(p * Math.PI) * pr.arc;
    const [px, py] = P(wx, wy, hh);
    if (pr.kind === 'arrow') {
      const e2 = Math.min(1, e + 0.03), p2 = Math.min(1, p + 0.03);
      const [qx, qy] = P(lerp(pr.ax, pr.bx, e2), lerp(pr.ay, pr.by, e2), lerp(pr.ah, pr.bh, e2) + Math.sin(p2 * Math.PI) * pr.arc);
      const a = Math.atan2(qy - py, qx - px);
      g.save(); g.translate(px, py); g.rotate(a); g.scale(z * SPR, z * SPR);
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(10, 0); g.lineWidth = 2; g.strokeStyle = '#5a3a20'; g.stroke();
      g.beginPath(); g.moveTo(10, -3); g.lineTo(16, 0); g.lineTo(10, 3); g.closePath(); g.fillStyle = '#c7cfd8'; g.fill();
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(-18, -3.5); g.lineTo(-11, 0); g.lineTo(-18, 3.5); g.closePath(); g.fillStyle = '#f3ecd8'; g.fill();
      g.restore();
    } else {
      const rr2 = (pr.kind === 'boulder' ? 0.075 : pr.kind === 'magic' ? 0.065 : 0.05) * z;
      if (pr.kind === 'magic') { g.beginPath(); g.arc(px, py, rr2 * 2.2, 0, Math.PI * 2); g.fillStyle = 'rgba(199,155,255,0.35)'; g.fill(); }
      g.beginPath(); g.arc(px, py, rr2, 0, Math.PI * 2);
      g.fillStyle = pr.kind === 'boulder' ? '#9a948a' : pr.kind === 'magic' ? '#e6d2ff' : '#2a2a36'; g.fill();
      g.lineWidth = 1.2; g.strokeStyle = '#2a2140'; g.stroke();
    }
    if (p >= 1) { projs.splice(k, 1); pr.res(); }
  }
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    p.life += dt;
    if (p.life >= p.max) { parts.splice(k, 1); continue; }
    p.vz -= p.g * dt;
    const dr = Math.pow(p.drag, dt);
    p.vx *= dr; p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(p.floor, p.z + p.vz * dt);
    const s = Math.max(0.6, p.s * z * (1 - Math.pow(p.life / p.max, 2)));
    const [px, py] = P(p.x, p.y, p.z);
    g.fillStyle = p.c; g.globalAlpha = Math.min(1, 1.4 - p.life / p.max);
    if (p.sq) g.fillRect(px - s, py - s, s * 2, s * 2);
    else { g.beginPath(); g.arc(px, py, s, 0, Math.PI * 2); g.fill(); }
  }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = floats.length - 1; k >= 0; k--) {
    const f = floats[k], p = (now() - f.t0) / 1200;
    if (p >= 1) { floats.splice(k, 1); continue; }
    const note = f.cls.indexOf('note') >= 0, big = /dmg|level/.test(f.cls);
    const fz = Math.max(15, Math.min(34, z * (big ? 0.2 : 0.12))) * (p < 0.15 ? 0.6 + p * 2.7 : 1);
    g.font = note ? '800 ' + Math.round(fz * 0.75) + 'px Figtree, sans-serif' : fz + 'px "Lilita One", sans-serif';
    const [x, y0] = P(f.x, f.y, f.h + 0.55 + p * 0.4);
    const y = y0 + (note ? fz * 1.3 : 0);
    g.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
    g.lineWidth = Math.max(3.5, fz * 0.24); g.strokeStyle = '#20123a'; g.lineJoin = 'round';
    const text = note ? f.text.toUpperCase() : f.text;
    g.strokeText(text, x, y);
    g.fillStyle = f.cls.indexOf('high') >= 0 ? '#ffb347' : f.cls.indexOf('dmg') >= 0 ? '#ff6a55' : f.cls.indexOf('heal') >= 0 ? '#7dffa0' : f.cls.indexOf('level') >= 0 ? '#ffc94a' : '#ffffff';
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- event animation
function D(id) { return disp.get(id); }
async function maybeFollow(x, y) {
  if (instant || !R3.follow || !R3.isVisible(x, y)) return;
  if (!R3.isOnScreen(x, y, 0.7)) { R3.focus(x, y); await wait(320); }
}
function projectile(ax, ay, bx, by, kind) {
  return new Promise(res => {
    if (instant || reduceMotion) { res(); return; }
    const dist = Math.hypot(bx - ax, by - ay);
    const arc = kind === 'boulder' ? 0.7 + dist * 0.18 : kind === 'bomb' ? 0.02 : kind === 'magic' ? 0.25 : 0.2 + dist * 0.08;
    const dur = (kind === 'boulder' ? 580 : kind === 'bomb' ? 360 : 330) * speed;
    projs.push({ ax, ay, bx, by, ah: groundH(ax, ay) + (kind === 'bomb' ? 0.7 : 0.35), bh: groundH(bx, by) + 0.25, arc, kind, t0: now(), d: dur, res });
  });
}
function projectileKind(ev) {
  if (ev.naval) return ev.naval === 'battleship' ? 'cannon' : 'arrow';
  if (ev.utype === 'catapult') return 'boulder';
  if (ev.utype === 'balloon') return 'bomb';
  if (ev.utype === 'archer') return 'arrow';
  return 'hit';
}
function impact(x, y, dmg, killed, high, kind) {
  const big = kind === 'boulder' || kind === 'cannon' || dmg >= 6;
  emit(x + 0.5, y + 0.5, { n: big ? 22 : 13, color: [0xffe08a, 0xff9a3d, 0xffffff], speed: big ? 2 : 1.5, up: 1.6, life: 0.5, size: 0.04, z: 0.3 });
  cam.shake = Math.min(0.5, cam.shake + (big ? 0.28 : 0.13) + (killed ? 0.1 : 0));
  floatText(x, y, '-' + dmg, 'dmg' + (high ? ' high' : ''));
  if (high) floatText(x, y, 'high ground', 'note');
}
function flash(d) { if (!d) return; tween(320, p => { d.flash = (1 - p) * 0.85; }, true); }
async function animMove(ev) {
  const d = D(ev.uid), u = TT.getUnit(st, ev.uid);
  if (!d || !u) return;
  const path = ev.path;
  if (instant || !path.some(p => R3.isVisible(p[0], p[1]))) return;
  if (!TT.visibleTo(st, u, viewer) && !path.some(p => viewer >= 0 && TT.visibleTo(st, Object.assign({}, u, { x: p[0], y: p[1] }), viewer))) return;
  d.busy = true;
  await maybeFollow(path[path.length - 1][0], path[path.length - 1][1]);
  d.form = ev.embark ? null : ev.disembark ? (ev.prevNaval || 'boat') : u.naval;
  const fly = u.type === 'balloon' && !u.naval;
  for (let k = 1; k < path.length; k++) {
    const [fx, fy] = path[k - 1], [tx, ty] = path[k];
    const sxDir = (tx - fx) - (ty - fy); // screen-x direction in iso
    if (sxDir) d.face = sxDir > 0 ? 1 : -1;
    const last = k === path.length - 1;
    if (last && ev.disembark) {
      // the boat settles and sinks away while the passenger leaps ashore
      emit(fx + 0.5, fy + 0.5, { n: 10, color: [0xffffff, 0xbfe9ff], speed: 0.9, up: 1, life: 0.5, size: 0.03 });
      await tween(240, p => { d.sink = easeOut(p) * 0.9; d.tilt = Math.sin(p * Math.PI * 2) * 0.08; }, true);
      d.sink = 0; d.tilt = 0; d.form = null; d.scale = 0.6;
      ring(fx, fy, 0xffffff, 600, 0.8, 0.04);
      await tween(300, p => {
        d.x = lerp(fx, tx, p) + 0.5; d.y = lerp(fy, ty, p) + 0.5;
        d.z = Math.sin(p * Math.PI) * 0.3; d.scale = lerp(0.6, 1, easeOutBack(Math.min(1, p * 1.4)));
      });
      d.scale = 1;
      if (R3.isVisible(tx, ty)) emit(tx + 0.5, ty + 0.5, { n: 8, color: [0xe0d0a8, 0xc8b88e], speed: 0.8, up: 0.6, life: 0.45, size: 0.03 });
      continue;
    }
    const naval = !!d.form;
    const hop = fly ? 0.02 : naval ? 0.01 : last && ev.embark ? 0.32 : 0.16;
    await tween(fly ? 210 : naval ? 230 : 195, p => {
      const e = fly || naval ? ease(p) : p;
      d.x = lerp(fx, tx, e) + 0.5; d.y = lerp(fy, ty, e) + 0.5;
      d.z = Math.sin(p * Math.PI) * hop;
      d.scale = naval || fly ? 1 : 1 + Math.sin(p * Math.PI) * 0.04;
    });
    d.scale = 1;
    if (!fly && !naval && R3.isVisible(tx, ty)) emit(tx + 0.5, ty + 0.5, { n: 5, color: [0xe0d0a8, 0xc8b88e], speed: 0.6, up: 0.5, life: 0.4, size: 0.025 });
    if (naval && R3.isVisible(tx, ty)) emit(tx + 0.5, ty + 0.5, { n: 3, color: [0xffffff, 0xbfe9ff], speed: 0.5, up: 0.6, life: 0.4, size: 0.025 });
  }
  if (ev.embark) {
    const e = path[path.length - 1];
    // splash, the walker slips under, then the boat bobs up in its place
    emit(e[0] + 0.5, e[1] + 0.5, { n: 18, color: [0xffffff, 0x9fe3ff, 0xd6f4ff], speed: 1.3, up: 1.5, life: 0.6, size: 0.035 });
    ring(e[0], e[1], 0xffffff, 700, 1, 0.045);
    await tween(200, p => { d.sink = easeOut(p); }, true);
    d.form = u.naval || 'boat';
    await tween(420, p => { d.sink = 1 - easeOutBack(p); d.tilt = Math.sin(p * Math.PI * 3) * 0.1 * (1 - p); }, true);
    d.sink = 0; d.tilt = 0;
    emit(e[0] + 0.5, e[1] + 0.5, { n: 8, color: [0xffffff, 0xbfe9ff], speed: 0.7, up: 0.8, life: 0.45, size: 0.03 });
  }
  d.z = 0; d.busy = false; d.form = undefined;
}
async function animAttack(ev, dieDef, dieAtk) {
  const a = D(ev.aid), d = D(ev.did);
  if (instant || !(R3.isVisible(ev.from[0], ev.from[1]) || R3.isVisible(ev.to[0], ev.to[1]))) return;
  const deaths = [];
  if (a) a.busy = true;
  await maybeFollow(ev.to[0], ev.to[1]);
  const [fx, fy] = ev.from, [tx, ty] = ev.to;
  const sxDir = (tx - fx) - (ty - fy);
  if (a && sxDir) a.face = sxDir > 0 ? 1 : -1;
  if (d && sxDir) d.face = sxDir > 0 ? -1 : 1;
  const kind = projectileKind(ev);
  if (ev.ranged || ev.naval) {
    if (a) await tween(120, p => { const e = -Math.sin(p * Math.PI) * 0.06; a.x = fx + 0.5 + (tx - fx) * e; a.y = fy + 0.5 + (ty - fy) * e; });
    await projectile(fx + 0.5, fy + 0.5, tx + 0.5, ty + 0.5, kind);
  } else if (a) {
    await tween(120, p => { const e = -0.08 * Math.sin(p * Math.PI / 2); a.x = fx + 0.5 + (tx - fx) * e; a.y = fy + 0.5 + (ty - fy) * e; });
    await tween(100, p => { const e = lerp(-0.08, 0.42, ease(p)); a.x = fx + 0.5 + (tx - fx) * e; a.y = fy + 0.5 + (ty - fy) * e; a.z = Math.sin(p * Math.PI) * 0.06; });
  }
  impact(tx, ty, ev.dmg, ev.killed, ev.high, kind);
  if (kind === 'boulder') ring(tx, ty, 0xffb347, 520, 1.2);
  flash(d);
  if (ev.killed && dieDef) { dieDef.started = true; deaths.push(animDie(dieDef, [tx - fx, ty - fy])); }
  if (!ev.ranged && a) await tween(190, p => { const e = lerp(0.42, 0, ease(p)); a.x = fx + 0.5 + (tx - fx) * e; a.y = fy + 0.5 + (ty - fy) * e; a.z = 0; });
  else await wait(140);
  if (ev.counter > 0 && d) {
    await wait(70);
    const far = Math.max(Math.abs(fx - tx), Math.abs(fy - ty)) > 1;
    if (far) await projectile(tx + 0.5, ty + 0.5, fx + 0.5, fy + 0.5, 'arrow');
    else { d.busy = true; await tween(110, p => { const e = 0.38 * Math.sin(p * Math.PI); d.x = tx + 0.5 + (fx - tx) * e; d.y = ty + 0.5 + (fy - ty) * e; }); d.busy = false; d.x = tx + 0.5; d.y = ty + 0.5; }
    impact(fx, fy, ev.counter, ev.attackerDied, false, 'hit');
    flash(a);
    if (ev.attackerDied && dieAtk) { dieAtk.started = true; deaths.push(animDie(dieAtk, [fx - tx, fy - ty])); }
    await wait(150);
  }
  if (a && !(ev.attackerDied && dieAtk)) a.busy = false;
  await Promise.all(deaths);
}
function ghostOf(ev) { return { id: ev.uid, type: ev.utype, naval: ev.naval, owner: ev.owner, x: ev.x, y: ev.y, hp: 0, canMove: true, canAttack: true, frozen: 0 }; }
// dir: world-space vector from the killer toward the victim (for knockback / listing direction)
async function animDie(ev, dir) {
  const d = D(ev.uid);
  if (!d) return;
  if (instant || !R3.isVisible(ev.x, ev.y)) { disp.delete(ev.uid); return; }
  d.dying = true; d.busy = true; d.ghost = d.ghost || ghostOf(ev);
  const col = st.players[ev.owner] ? st.players[ev.owner].color : 0xffffff;
  dir = dir || [d.face, 0];
  const len = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / len, uy = dir[1] / len;
  const screenSide = Math.sign((ux - uy) || d.face) || 1;
  const x0 = d.x, y0 = d.y;
  if (ev.naval) {
    // ship: lurch from the hit, list over, settle into the water, slip under; bubbles, splash and debris
    emit(x0, y0, { n: 16, color: [0xffffff, 0xbfe9ff], speed: 1.4, up: 1.6, life: 0.6, size: 0.035 });
    ring(Math.floor(x0), Math.floor(y0), 0xffffff, 700, 0.9, 0.04);
    let debris = false;
    await tween(1250, p => {
      const lurch = p < 0.12 ? Math.sin(p / 0.12 * Math.PI) * 0.06 : 0;
      d.x = x0 + ux * lurch; d.y = y0 + uy * lurch;
      d.tilt = screenSide * (0.08 * Math.sin(p * 18) * (1 - p) + 0.6 * ease(Math.min(1, p * 1.3)));
      d.sink = Math.pow(Math.max(0, (p - 0.12) / 0.88), 1.6);
      d.alpha = p > 0.88 ? (1 - p) / 0.12 : 1;
      if (Math.random() < 0.35) emit(x0 + (Math.random() - 0.5) * 0.3, y0 + (Math.random() - 0.5) * 0.3, { n: 1, color: [0xffffff, 0xd6f4ff], speed: 0.15, up: 0.9, gravity: -0.6, life: 0.7, size: 0.025 });
      if (!debris && p > 0.45) { debris = true; emit(x0, y0, { n: 6, color: [0x9a6436, 0x7a4f2a, 0xf3ecd8], speed: 0.6, up: 0.4, gravity: 0.8, life: 1.4, size: 0.035, square: true }); }
    }, true);
    ring(Math.floor(x0), Math.floor(y0), 0xe6f7ff, 800, 1.2, 0.035);
    emit(x0, y0, { n: 10, color: [0xffffff, 0xbfe9ff], speed: 0.6, up: 1.2, life: 0.5, size: 0.03 });
  } else {
    // land unit: knocked back away from the attacker, topples, fades in a puff of dust
    emit(x0, y0, { n: 18, color: [col, 0xffffff, 0x3a3048], speed: 1.6, up: 1.6, life: 0.8, size: 0.04, z: 0.25 });
    await tween(560, p => {
      const k = easeOut(Math.min(1, p * 1.6));
      d.x = x0 + ux * 0.16 * k; d.y = y0 + uy * 0.16 * k;
      d.z = Math.sin(Math.min(1, p * 1.6) * Math.PI) * 0.08;
      d.tilt = screenSide * 1.35 * ease(p);
      d.alpha = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
      d.scale = 1 - p * 0.15;
    }, true);
    emit(d.x, d.y, { n: 12, color: [0xe0d0a8, 0xc8b88e, 0xffffff], speed: 0.7, up: 0.6, life: 0.6, size: 0.04 });
  }
  disp.delete(ev.uid);
}
async function animShove(ev) {
  const d = D(ev.uid);
  if (!d || instant || !R3.isVisible(ev.to[0], ev.to[1])) return;
  d.busy = true;
  const [fx, fy] = ev.from, [tx, ty] = ev.to;
  await tween(240, p => { const e = easeOut(p); d.x = lerp(fx, tx, e) + 0.5; d.y = lerp(fy, ty, e) + 0.5; d.z = Math.sin(p * Math.PI) * 0.1; d.tilt = Math.sin(p * Math.PI) * 0.3; });
  d.tilt = 0; d.z = 0;
  emit(tx + 0.5, ty + 0.5, { n: 10, color: [0xe0d0a8, 0xc8b88e], speed: 1.1, up: 0.6, life: 0.5, size: 0.03 });
  floatText(tx, ty, 'shoved', 'note');
  d.busy = false;
}
async function animAdvance(ev) {
  const d = D(ev.uid);
  if (!d || instant || !R3.isVisible(ev.to[0], ev.to[1])) return;
  d.busy = true;
  const [fx, fy] = ev.from, [tx, ty] = ev.to;
  await tween(220, p => { const e = ease(p); d.x = lerp(fx, tx, e) + 0.5; d.y = lerp(fy, ty, e) + 0.5; d.z = Math.sin(p * Math.PI) * 0.12; });
  d.z = 0; d.busy = false;
}
R3.play = async function (evs) {
  if (!evs || !st) return;
  const mine = st;
  for (const ev of evs) if (ev.type === 'die') { const d = disp.get(ev.uid); if (d) { d.dying = true; d.ghost = ghostOf(ev); } }
  for (let k = 0; k < evs.length; k++) {
    if (st !== mine) return;
    const ev = evs[k];
    try {
      switch (ev.type) {
        case 'move': await animMove(ev); break;
        case 'attack': await animAttack(ev, evs.find(e => e.type === 'die' && e.uid === ev.did), evs.find(e => e.type === 'die' && e.uid === ev.aid)); break;
        case 'die': if (!ev.started) await animDie(ev); break;
        case 'shove': await animShove(ev); break;
        case 'slam': emit(ev.x + 0.5, ev.y + 0.5, { n: 14, color: [0xffffff, 0xe0d0a8], speed: 1.5, up: 1, life: 0.5, size: 0.035 }); cam.shake = 0.3; floatText(ev.x, ev.y, 'slam!', 'note'); break;
        case 'advance': await animAdvance(ev); break;
        case 'hurt': if (ev.kind !== 'hit' && R3.isVisible(ev.x, ev.y)) { floatText(ev.x, ev.y, '-' + ev.n, 'dmg'); emit(ev.x + 0.5, ev.y + 0.5, { n: 8, color: ev.kind === 'fire' ? [0xff6a2a, 0xffc04a] : ev.kind === 'storm' ? [0x9fc4ff, 0xffffff] : [0xffe08a, 0xff9a3d], speed: 1.1, up: 1.3, life: 0.5, size: 0.035, z: 0.3 }); flash(D(ev.uid)); } break;
        case 'splash': ring(ev.x, ev.y, 0xffb347, 520, 1.6, 0.07); cam.shake = Math.max(cam.shake, 0.32); break;
        case 'convert': {
          if (instant || !R3.isVisible(ev.to[0], ev.to[1])) break;
          await projectile(ev.from[0] + 0.5, ev.from[1] + 0.5, ev.to[0] + 0.5, ev.to[1] + 0.5, 'magic');
          ring(ev.to[0], ev.to[1], 0xb68cff, 650, 1.1);
          emit(ev.to[0] + 0.5, ev.to[1] + 0.5, { n: 18, color: [0xc79bff, 0xffffff], speed: 0.8, up: 1, gravity: 0.5, life: 0.8, size: 0.035, z: 0.3 });
          floatText(ev.to[0], ev.to[1], 'converted', 'note');
          const d = D(ev.did); if (d) await tween(300, p => { d.scale = Math.max(0.05, easeOutBack(p)); }, true);
          break;
        }
        case 'heal': if (R3.isVisible(ev.x, ev.y)) { floatText(ev.x, ev.y, '+' + ev.n, 'heal'); emit(ev.x + 0.5, ev.y + 0.5, { n: 8, color: [0x7dffa0, 0xffffff], speed: 0.35, up: 1.2, gravity: -0.3, life: 0.9, size: 0.03, square: true, z: 0.1 }); } break;
        case 'healwave': ring(ev.x, ev.y, 0x7dffa0, 650, 1.3); break;
        case 'spawn': {
          const u = TT.getUnit(st, ev.uid); if (!u) break;
          R3.sync();
          const d = D(u.id);
          if (d && R3.isVisible(u.x, u.y) && !instant) {
            ring(u.x, u.y, 0xffffff, 450, 0.8);
            emit(u.x + 0.5, u.y + 0.5, { n: 12, color: [st.players[u.owner].color, 0xffffff], speed: 0.9, up: 1.2, life: 0.6, size: 0.035 });
            d.busy = true; await tween(380, p => { d.scale = Math.max(0.05, easeOutBack(p)); }, true); d.busy = false;
          }
          break;
        }
        case 'capture': {
          await maybeFollow(ev.x, ev.y);
          const col = st.players[ev.pid].color;
          beam(ev.x, ev.y, col, 950); ring(ev.x, ev.y, col, 800, 1.8, 0.08);
          if (R3.isVisible(ev.x, ev.y) && !instant) { emit(ev.x + 0.5, ev.y + 0.5, { n: 44, color: [col, 0xffffff, C.gold], speed: 2.2, up: 2.8, life: 1.1, size: 0.035, square: true, z: 0.3 }); cam.shake = Math.max(cam.shake, 0.18); }
          cityPop.set(ev.cid, now()); R3.sync(); await wait(380);
          break;
        }
        case 'levelup': {
          if (!R3.isVisible(ev.x, ev.y)) break;
          ring(ev.x, ev.y, C.gold, 700, 1.4);
          emit(ev.x + 0.5, ev.y + 0.5, { n: 24, color: [C.gold, 0xfff2c0], speed: 1.1, up: 2.4, gravity: 2, life: 1, size: 0.03, square: true, z: 0.3 });
          floatText(ev.x, ev.y, 'Level ' + ev.level + '!', 'level');
          cityPop.set(ev.cid, now()); R3.sync(); await wait(200);
          break;
        }
        case 'build':
          if (R3.isVisible(ev.x, ev.y)) emit(ev.x + 0.5, ev.y + 0.5, { n: 14, color: [0xffffff, 0xf2e3c0, C.gold], speed: 1, up: 1.3, life: 0.6, size: 0.035, z: 0.1 });
          R3.sync();
          if (ev.kind !== 'walls') floatText(ev.x, ev.y, '+pop', 'heal'); else cityPop.set(ev.cid, now());
          break;
        case 'ruin': if (R3.isVisible(ev.x, ev.y)) { emit(ev.x + 0.5, ev.y + 0.5, { n: 30, color: [0x8ff0ff, 0xffffff, C.gold], speed: 1.3, up: 2.4, life: 1.1, size: 0.03, square: true, z: 0.2 }); beam(ev.x, ev.y, 0x8ff0ff, 900); } break;
        case 'veteran': if (R3.isVisible(ev.x, ev.y)) { floatText(ev.x, ev.y, 'Veteran!', 'level'); ring(ev.x, ev.y, C.gold, 500, 0.9); } break;
        case 'freeze': if (R3.isVisible(ev.x, ev.y)) { emit(ev.x + 0.5, ev.y + 0.5, { n: 10, color: [0xffffff, 0xcfe8ff], speed: 0.35, up: -0.3, gravity: 0.6, life: 1.1, size: 0.03, z: 0.9 }); floatText(ev.x, ev.y, 'frozen', 'note'); } break;
        case 'fire': if (R3.isVisible(ev.x, ev.y)) emit(ev.x + 0.5, ev.y + 0.5, { n: 18, color: [0xff4a1a, 0xffb02a, 0xffe08a], speed: 0.45, up: 2, gravity: -0.4, life: 0.8, size: 0.04, z: 0.05 }); break;
        case 'power': await animPower(ev); break;
        case 'bloom': if (R3.isVisible(ev.x, ev.y)) emit(ev.x + 0.5, ev.y + 0.5, { n: 10, color: [0x9dff8a, 0xffffff], speed: 0.45, up: 1.2, life: 0.8, size: 0.03 }); break;
        case 'reward': R3.sync(); if (ev.cid != null) cityPop.set(ev.cid, now()); break;
        case 'upgrade': { const d = D(ev.uid); if (d) await tween(320, p => { d.scale = Math.max(0.05, easeOutBack(p)); }, true); ring(ev.x, ev.y, 0xffffff, 450, 0.9); break; }
        case 'eliminated': cam.shake = Math.max(cam.shake, 0.25); break;
        case 'infiltrate': {
          if (!R3.isVisible(ev.x, ev.y) || instant) break;
          await maybeFollow(ev.x, ev.y);
          emit(ev.from[0] + 0.5, ev.from[1] + 0.5, { n: 24, color: [0x3a2a5a, 0x7a5ab0, 0x1c1830], speed: 1, up: 1.2, gravity: -0.2, life: 1, size: 0.05 });
          ring(ev.x, ev.y, 0xb68cff, 700, 1.3);
          floatText(ev.x, ev.y, '+' + ev.n + '★ stolen', 'level');
          cam.shake = Math.max(cam.shake, 0.2);
          await wait(350);
          break;
        }
      }
    } catch (e) { console.error('anim', ev.type, e); }
  }
  R3.sync();
};
async function animPower(ev) {
  if (instant) return;
  const Pp = st.players[ev.pid];
  R3.flashScreen && R3.flashScreen(Pp.color);
  for (const u of st.units) {
    if (u.owner !== ev.pid || !R3.isVisible(u.x, u.y)) continue;
    const x = u.x + 0.5, y = u.y + 0.5;
    if (ev.power === 'forge') emit(x, y, { n: 10, color: [0xffb02a, 0xffe08a, 0xff6a2a], speed: 1.3, up: 2, life: 0.6, size: 0.03, square: true, z: 0.2 });
    else if (ev.power === 'tailwind') emit(x, y, { n: 8, color: [0xffffff, 0xbff3ff], speed: 2.4, up: 0.2, gravity: 0, life: 0.5, size: 0.025, z: 0.3 });
    else if (ev.power === 'overgrowth') emit(x, y, { n: 8, color: [0x6fe06a, 0xc8ff9a], speed: 0.55, up: 1.5, gravity: -0.3, life: 1, size: 0.03 });
  }
  if (ev.power === 'blizzard') { const [cx, cy] = inv(VW / 2, VH / 2); for (let k = 0; k < 140; k++) emit(cx + (Math.random() - 0.5) * 12, cy + (Math.random() - 0.5) * 12, { n: 1, color: 0xffffff, speed: 0.3, up: -0.3, gravity: 0.4, life: 2, size: 0.025, z: 1.5, always: true }); }
  if (ev.power === 'goldenage') for (const c of st.cities) if (c.owner === ev.pid && R3.isVisible(c.x, c.y)) { emit(c.x + 0.5, c.y + 0.5, { n: 18, color: [C.gold, 0xfff2c0], speed: 1.3, up: 2.6, life: 1.2, size: 0.035, square: true, z: 0.3 }); ring(c.x, c.y, C.gold, 700, 1.3); }
  await wait(450);
}

})(typeof window !== 'undefined' ? window : globalThis);
