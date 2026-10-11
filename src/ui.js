/* Tessera Tribes — UI, input, turn loop. */
(function (G) {
'use strict';
const TT = G.TT, R3 = TT.R3, AI = TT.AI;
const $ = (s, el) => (el || document).querySelector(s);
function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function add(el, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(x => add(el, x)); return; }
  el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
}
const hex = n => '#' + n.toString(16).padStart(6, '0');
const store = {
  get(k, d) { try { const v = localStorage.getItem('tessera.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tessera.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('tessera.' + k); } catch (e) { /* ignore */ } },
};

// ---------------------------------------------------------------- icons (24px stroke set)
const ICON = {
  warrior: '<path d="M7 19l9-11m1-3l2 2-3 3-2-2z"/><circle cx="7" cy="6" r="2.2"/><path d="M4 21c.5-4 2-6 3-6s2.5 2 3 6"/>',
  rider: '<path d="M5 20l2-6 4-1 3-5 4-1-1 3 2 2-2 2-3-1-3 4v3"/><circle cx="12" cy="4.5" r="1.7"/>',
  archer: '<path d="M7 3c7 3 7 15 0 18"/><path d="M7 3v18"/><path d="M5 12h14m-3-3 3 3-3 3"/>',
  defender: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 7v10M8 11h8"/>',
  shaman: '<path d="M8 21V6"/><circle cx="8" cy="4" r="2"/><path d="M13 21l2-9h3l2 9"/><circle cx="16.5" cy="9" r="2"/>',
  balloon: '<path d="M12 2c4 0 6.5 3 6.5 6.5S15 15 12 15s-6.5-3-6.5-6.5S8 2 12 2z"/><path d="M9.5 14.5L10 18h4l.5-3.5M10 18h4v3h-4z"/>',
  swordsman: '<path d="M14 4l6-1-1 6-9 9-3-3z"/><path d="M5 15l4 4M4 20l2-2"/>',
  mindbender: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>',
  knight: '<path d="M4 21l2-7 5-2 3-6 3-1 2 4-2 2h-3l-3 4v6"/><path d="M14 6L21 2"/>',
  catapult: '<path d="M3 18h18"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/><path d="M8 17l9-12"/><circle cx="18" cy="4" r="2"/>',
  giant: '<circle cx="12" cy="5" r="3"/><path d="M5 21l2-10h10l2 10M7 11l-3 4M17 11l3 4"/>',
  boat: '<path d="M3 15h18l-3 5H6z"/><path d="M12 3v12M12 4l6 9h-6"/>',
  ship: '<path d="M3 15h18l-3 5H6z"/><path d="M9 3v12M9 4l5 9H9M15 6v9M15 7l4 6h-4"/>',
  battleship: '<path d="M2 15h20l-3 5H5z"/><path d="M6 15v-4h12v4M9 11V7h6v4M18 12h4M2 12h4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  star: '<path class="f" d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.5 6.6L12 17.1l-6 3.4 1.5-6.6-5-4.5 6.6-.7z"/>',
  sword: '<path d="M19 5L9.5 14.5M19 5v4.5M19 5h-4.5M7 12.5l4.5 4.5M4 20l3.5-3.5"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  move: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  recover: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/><path d="M12 9v6M9 12h6"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  rotl: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 3v5h5"/>',
  rotr: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 0 9.5z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  topview: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
  next: '<path d="M5 12h12M13 6l6 6-6 6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  fruit: '<circle cx="12" cy="14" r="6.5"/><path d="M12 7.5c0-2 1-3.5 3-4.5M12 7.5c-1.5-1.5-3.5-1.5-5 0 1.5 1.5 3.5 1.5 5 0"/>',
  hunt: '<path d="M12 21v-5M12 16l-5-5V6M7 9L4 6M12 16l5-5V6M17 9l3-3"/>',
  fish: '<path d="M3 12c3-5 9-6 14-2l4-3v10l-4-3c-5 4-11 3-14-2z"/><circle cx="8" cy="11" r="1"/>',
  farm: '<path d="M12 21V8M12 12l-3-3M12 12l3-3M12 16l-3-3M12 16l3-3M12 8l-2.5-2.5L12 3l2.5 2.5z"/>',
  mine: '<path d="M3 9c4-4.5 12-4.5 16 0"/><path d="M11 6.5L6 21"/>',
  lumber: '<path d="M14 3L5 21"/><path d="M12 7c3-2 6-1.5 8 1-2 3-5 4-9 3"/>',
  port: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13a7 7 0 0 0 14 0M8 10h8"/>',
  clear: '<path d="M7 21v-8h10v8M7 13c0-2 2-3 5-3s5 1 5 3M4 21h16"/>',
  tower: '<path d="M5 21V8h3V5h3v3h2V5h3v3h3v13zM10 21v-5h4v5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 2 5 5"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  tree: '<path d="M12 3l6 9h-3l4 6H5l4-6H6z"/><path d="M12 18v3"/>',
  mountain: '<path d="M2 20l7-12 4 6 2-3 7 9z"/>',
  wave: '<path d="M2 10c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1M2 16c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.5 5-1"/>',
  field: '<path d="M3 18h18M5 18c1-4 3-6 7-6s6 2 7 6M8 12V8M12 12V6M16 12V8"/>',
  hammer: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7l-8 8 3 3 8-8"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ruin: '<path d="M4 21V9M10 21V9M3 9h8M15 21v-6M21 21v-9M14 15h4M3 21h18"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 3 5v3h8v-3c1.8-1 3-2.5 3-5a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.3"/><circle cx="14.5" cy="10.5" r="1.3"/>',
};
const POWER_ICON = { overgrowth: 'tree', forge: 'hammer', tailwind: 'wave', wildfire: 'bolt', blizzard: 'mountain', goldenage: 'star' };
const BUILD_ICON = { fruit: 'fruit', hunt: 'hunt', fish: 'fish', farm: 'farm', mine: 'mine', lumber: 'lumber', port: 'port', clear: 'clear', road: 'move', whale: 'fish', temple: 'tower', grow: 'tree', market: 'star' };
const REWARD_ICON = { workshop: 'hammer', explorer: 'map', walls: 'tower', resources: 'star', growth: 'users', borders: 'expand', park: 'tree', giant: 'giant' };
const TERRAIN_ICON = ['wave', 'wave', 'field', 'tree', 'mountain'];
const TERRAIN_SWATCH = ['#2a68ab', '#4ab5c9', '#8fcb5c', '#5f9f45', '#9b9886'];
function icon(k, cls) {
  const wrap = document.createElement('span');
  const filled = k === 'star';
  wrap.innerHTML = '<svg class="ico' + (filled ? ' fill' : '') + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[k] || ICON.warrior) + '</svg>';
  return wrap.firstChild;
}
function art(spec, size, cls) { const c = document.createElement('canvas'); c.className = 'art' + (cls ? ' ' + cls : ''); c.setAttribute('aria-hidden', 'true'); TT.ART.thumb(c, spec, size); return c; }
function unitArt(type, naval, pid, size) { const P = st.players[pid]; return art({ kind: 'unit', type, naval, color: P.color, tribe: P.tribe }, size); }
function setIcon(sel, k) { const el = $(sel); el.innerHTML = ''; el.appendChild(icon(k)); }

// ---------------------------------------------------------------- state
let st = null, human = -1, sel = null, busy = false, token = 0, attract = false, lastLog = 0, paused = false, armed = null;
let mode = 'solo', localSeats = new Set(), net = null;
const netStats = { applied: 0, pushed: 0, resyncs: 0, conflicts: 0 };
const prefs = Object.assign({ speed: 'normal', grid: true, follow: true, hints: true, seen: {}, setup: null }, store.get('prefs', {}));
const SPEED = { normal: 1, fast: 0.5, instant: 0.5 };
const RELIEF = { flat: 0.3, gentle: 0.65, dramatic: 1 };
const touchy = matchMedia('(pointer: coarse)').matches;
function savePrefs() { store.set('prefs', prefs); }

// ---------------------------------------------------------------- boot
function boot(hot) {
  try {
    if (!document.createElement('canvas').getContext('2d')) throw new Error('canvas drawing is unavailable');
    R3.init($('#stage'), $('#overlay'));
  } catch (e) {
    $('#app').append(h('div', { class: 'nogl' }, h('h2', null, 'The map could not start'),
      h('p', null, 'Tessera Tribes draws its map on a canvas, and this browser did not allow it (' + e.message + '). Open the page in a current version of Chrome, Edge, Firefox or Safari.')));
    return;
  }
  R3.flashScreen = color => { const f = $('#flash'); f.style.background = hex(color); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); };
  setIcon('#icoTech', 'flask'); setIcon('#icoMenu', 'menu'); setIcon('#icoMap', 'map'); setIcon('#icoNext', 'next'); setIcon('#rbStarIco', 'star'); setIcon('#rbTrophy', 'trophy');
  setIcon('#camIn', 'plus'); setIcon('#camOut', 'minus'); setIcon('#camHome', 'home'); setIcon('#camFit', 'expand');
  document.querySelectorAll('.mapctl button').forEach(b => { b.appendChild(icon({ in: 'plus', out: 'minus', home: 'home', fit: 'expand' }[b.dataset.cam])); b.addEventListener('click', () => ({ in: () => R3.zoom(0.8), out: () => R3.zoom(1.25), home: centerHome, fit: () => R3.fit() })[b.dataset.cam]()); });
  bindInput();
  bindUI();
  R3.setOptions({ grid: prefs.grid !== false });
  requestAnimationFrame(uiFrame);
  if (hot && hot.save) {
    try { startWith(TT.deserialize(hot.save)); return; } catch (e) { /* fall through to the title screen */ }
  }
  showMenu();
  onlineBoot();
}
G.addEventListener('DOMContentLoaded', () => {
  const hot = G.claude && G.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => (st && !attract ? { save: TT.serialize(st) } : {}));
  if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data);
});

// ---------------------------------------------------------------- title menu
let setup = Object.assign(TT.defaultSettings(), { tribe: 'verdant', opponents: 3, difficulty: 'hard', size: 'normal', mapType: 'pangaea', relief: 'dramatic', dayCycle: true }, prefs.setup || {});
function inGameChrome(on) {
  ['#top', '#bottom', '#camctl', '#rail'].forEach(s => { $(s).hidden = !on; });
}
function showMenu() {
  if (net) leaveOnline();   // e.g. "New game" after an online game: stop following that room
  mode = 'solo'; localSeats = new Set(); soloRec = null;
  $('#menu').hidden = false;
  inGameChrome(false);
  $('#aiStrip').hidden = true;
  renderMenu();
  startAttract();
}
// ---------------------------------------------------------------- title screen: every option on one page, updated in place
const DIFF_INFO = { easy: 'Relaxed', normal: 'Balanced', hard: 'Sharp', crazy: 'Ruthless' };
const tribeArt = (t, type, size) => art({ kind: 'unit', type, color: t.color, tribe: t.id, pad: 1 }, size);
const menuRefs = {};
function saveSetup() { prefs.setup = setup; savePrefs(); }
function renderMenu() {
  const body = $('#menuBody'), acts = $('#menuActions');
  body.innerHTML = ''; acts.innerHTML = '';
  body.className = 'glass setup1';
  $('.menu-card').classList.remove('in-steps');
  // who plays: solo against bots, or online against people on other devices
  menuRefs.play = h('div', { class: 'modeseg', role: 'radiogroup', 'aria-label': 'Players' },
    [['solo', 'users', 'Solo vs bots'], ['online', 'globe', 'Online']].map(([k, ic, nm]) => h('button', { type: 'button', role: 'radio', class: 'mseg', 'data-v': k, id: 'play-' + k, onclick: () => { setup.playMode = k; syncMenu(); } }, icon(ic), nm)));
  menuRefs.online = h('div', { class: 'onpanel', id: 'onPanel' });
  body.append(h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Players'), menuRefs.playLine = h('span', { class: 'rowval' })), menuRefs.play), menuRefs.online);
  // tribe strip
  menuRefs.tribeLine = h('span', { class: 'rowval' });
  menuRefs.tribes = h('div', { class: 'strip', role: 'radiogroup', 'aria-label': 'Tribe' }, TT.TRIBES.map(t =>
    h('button', { type: 'button', role: 'radio', class: 'opt av-opt', 'data-v': t.id, id: 'tribe-' + t.id, style: '--tc:' + hex(t.color), 'aria-label': t.name, onclick: () => { setup.tribe = t.id; syncMenu(); } },
      h('span', { class: 'av-c' }, tribeArt(t, 'warrior', 52)), h('span', { class: 'opt-n' }, t.name))));
  body.append(h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Tribe'), menuRefs.tribeLine), menuRefs.tribes));
  // map strip
  menuRefs.mapLine = h('span', { class: 'rowval' });
  menuRefs.maps = h('div', { class: 'strip', role: 'radiogroup', 'aria-label': 'Map' }, Object.keys(TT.MAP_TYPES).map(k => {
    const prev = mapPreview(k).cloneNode(false); prev.getContext('2d').drawImage(mapPreview(k), 0, 0);
    return h('button', { type: 'button', role: 'radio', class: 'opt map-opt', 'data-v': k, id: 'map-' + k, 'aria-label': TT.MAP_TYPES[k].name, onclick: () => { setup.mapType = k; syncMenu(); } }, prev, h('span', { class: 'opt-n' }, TT.MAP_TYPES[k].name));
  }));
  const worldRow = h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'World'), menuRefs.mapLine), menuRefs.maps);
  body.append(worldRow);
  // sliders
  const sizes = Object.keys(TT.MAP_SIZES);
  const sliderRow = h('div', { class: 'sliders' },
    slider('opt-size', 'Size', sizes, () => setup.size, v => { setup.size = v; }, v => cap(v) + ' ' + TT.MAP_SIZES[v] + '²'),
    slider('opt-opp', 'Rivals', [1, 2, 3, 4, 5], () => setup.opponents, v => { setup.opponents = v; }, v => v + (v === 1 ? ' tribe' : ' tribes')),
    slider('opt-diff', 'Bots', Object.keys(TT.DIFFICULTY), () => setup.difficulty, v => { setup.difficulty = v; }, v => TT.DIFFICULTY[v].name));
  body.append(sliderRow);
  // victory + world toggles as one row of chips
  const chip = (id, ic, label, get, flip) => {
    const b = h('button', { type: 'button', id, class: 'mchip', role: 'switch', 'aria-label': label, title: label, onclick: () => { flip(!get()); syncMenu(); } }, icon(ic), h('span', null, label));
    b._get = get; return b;
  };
  menuRefs.mode = h('div', { class: 'modeseg', role: 'radiogroup', 'aria-label': 'Victory' },
    [['domination', 'sword', 'Domination'], ['score', 'trophy', '30-turn score']].map(([k, ic, nm]) => h('button', { type: 'button', role: 'radio', class: 'mseg', 'data-v': k, onclick: () => { setup.mode = k; setup.turnLimit = 30; syncMenu(); } }, icon(ic), nm)));
  menuRefs.chips = [
    chip('opt-fog', 'cloud', 'Fog', () => setup.fog, v => { setup.fog = v; }),
    chip('opt-events', 'bolt', 'Storms', () => setup.events, v => { setup.events = v; }),
    chip('opt-day', 'moon', 'Night', () => setup.dayCycle, v => { setup.dayCycle = v; R3.setOptions({ dayCycle: v }); }),
    chip('opt-relief', 'mountain', 'Tall land', () => setup.relief !== 'gentle' && setup.relief !== 'flat', v => { setup.relief = v ? 'dramatic' : 'gentle'; if (attract) R3.setOptions({ relief: RELIEF[setup.relief] }); }),
    chip('opt-grid', 'topview', 'Grid', () => prefs.grid !== false, v => { prefs.grid = v; R3.setOptions({ grid: v }); }),
  ];
  const rulesRow = h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Rules')), menuRefs.mode, h('div', { class: 'chiprow' }, menuRefs.chips));
  body.append(rulesRow);
  menuRefs.soloRows = [worldRow, sliderRow, rulesRow];
  const saved = store.get('save', null);
  menuRefs.soloActs = [h('button', { class: 'btn primary big', id: 'btnStart', type: 'button', onclick: () => newGame(false) }, 'Play'),
    saved ? h('button', { class: 'btn', id: 'btnContinue', type: 'button', onclick: continueGame }, 'Continue turn ' + saved.turn) : null,
    h('button', { class: 'btn ghost', id: 'btnWatch', type: 'button', onclick: () => newGame(true) }, 'Watch the bots')].filter(Boolean);
  menuRefs.onActs = [h('button', { class: 'btn primary big', id: 'btnMatch', type: 'button', onclick: () => (search ? stopSearch() : startSearch()) }, 'Find match'),
    h('button', { class: 'btn', id: 'btnRoom', type: 'button', onclick: () => createRoom() }, 'Create room')];
  add(acts, menuRefs.soloActs.concat(menuRefs.onActs));
  syncMenu();
}
function slider(id, label, values, get, set, fmt, tick) {
  const out = h('span', { class: 'rowval' });
  const inp = h('input', { type: 'range', id, min: 0, max: values.length - 1, step: 1, value: Math.max(0, values.indexOf(get())), 'aria-label': label });
  const apply = () => {
    const v = values[+inp.value]; set(v);
    out.textContent = fmt(v);
    inp.style.setProperty('--p', (+inp.value / (values.length - 1) * 100) + '%');
    inp.setAttribute('aria-valuetext', fmt(v));
    saveSetup();
  };
  inp.addEventListener('input', apply);
  const row = h('div', { class: 'srow' }, h('label', { class: 'lbl', for: id }, label), inp, out);
  apply();
  return row;
}
function syncMenu() {
  const T0 = TT.tribe(setup.tribe);
  menuRefs.tribes.querySelectorAll('.opt').forEach(b => { const on = b.dataset.v === setup.tribe; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  menuRefs.tribeLine.textContent = T0.name + ' · ' + cap(T0.passive.split(': ')[1].replace(/\.$/, ''));
  menuRefs.tribeLine.title = T0.passive + ' Power, ' + T0.powerName + ': ' + T0.powerDesc;
  menuRefs.maps.querySelectorAll('.opt').forEach(b => { const on = b.dataset.v === setup.mapType; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  menuRefs.mapLine.textContent = TT.MAP_TYPES[setup.mapType].name + ' · ' + TT.MAP_TYPES[setup.mapType].desc;
  menuRefs.mode.querySelectorAll('.mseg').forEach(b => { const on = b.dataset.v === setup.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  menuRefs.chips.forEach(b => { const on = !!b._get(); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const pm = setup.playMode === 'online' && onlineOK ? 'online' : 'solo';
  menuRefs.play.querySelectorAll('.mseg').forEach(b => { const on = b.dataset.v === pm; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); if (b.dataset.v === 'online') { b.disabled = !onlineOK; b.title = onlineOK ? 'Play people on other devices' : 'Online play needs the deployed site with Supabase (see the README)'; } });
  menuRefs.online.hidden = pm !== 'online';
  if (pm === 'online') renderOnlinePanel(menuRefs.online);
  menuRefs.soloRows.forEach(r => { r.hidden = pm === 'online'; });
  menuRefs.soloActs.forEach(b => { b.hidden = pm === 'online'; });
  menuRefs.onActs.forEach(b => { b.hidden = pm !== 'online' || !ON.profile; });
  menuRefs.onActs[0].textContent = search ? 'Cancel search' : 'Find match';
  menuRefs.onActs[0].classList.toggle('primary', !search);
  menuRefs.playLine.textContent = pm === 'solo' ? 'You against ' + setup.opponents + (setup.opponents === 1 ? ' bot' : ' bots') : ON.profile ? 'Signed in as ' + ON.profile.username : 'People on other devices';
  saveSetup();
}
const mapPreviews = {};
function mapPreview(type) {
  if (mapPreviews[type]) return mapPreviews[type];
  const s = TT.newGame({ spectate: true, opponents: 3, size: 'small', mapType: type, seed: 4100 + Object.keys(TT.MAP_TYPES).indexOf(type) * 7, fog: false });
  const cvs = document.createElement('canvas'), N = s.W, px = 6;
  cvs.width = N * px; cvs.height = N * px; cvs.className = 'mapprev';
  const g2 = cvs.getContext('2d');
  const col = ['#2f72b6', '#5ec8dc', '#8fcb5c', '#4f9a3f', '#a8a493'];
  for (let i = 0; i < s.tiles.length; i++) { g2.fillStyle = col[s.tiles[i].t]; g2.fillRect((i % N) * px, ((i / N) | 0) * px, px, px); }
  for (const c of s.cities) { g2.fillStyle = c.owner >= 0 ? hex(s.players[c.owner].color) : '#f3e3b8'; g2.fillRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2); }
  return (mapPreviews[type] = cvs);
}

function startAttract() {
  attract = true;
  const my = ++token;
  const types = Object.keys(TT.MAP_TYPES);
  st = TT.newGame({ spectate: true, opponents: 3, size: 'small', mapType: types[(Math.random() * 4) | 0], fog: false, events: true, difficulty: 'hard' });
  human = -1; sel = null; lastLog = st.log.length;
  R3.setOptions({ relief: RELIEF[setup.relief], dayCycle: setup.dayCycle, instant: false, speed: 0.6 });
  R3.setState(st, -1);
  if (innerWidth > 820) { R3.fit(Math.min(620, innerWidth * 0.45)); R3.cam.x = R3.cam.tx; R3.cam.z = R3.cam.tz; }
  R3.follow = false;
  R3.setHighlights(null);
  (async function loop() {
    while (attract && my === token && !st.over) {
      for (const evs of AI.turn(st)) { if (my !== token) return; await R3.play(evs); await frameWait(); }
      if (my !== token) return;
      await R3.play(TT.endTurn(st));
      if (st.turn > 60) break;
    }
    if (attract && my === token) setTimeout(() => { if (attract && my === token) startAttract(); }, 1500);
  })();
}
const frameWait = () => new Promise(r => requestAnimationFrame(() => r()));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// a solo game keeps its starting settings and every move, so a signed-in player's result can be verified by replay
const SOLO_KEYS = ['tribe', 'opponents', 'difficulty', 'size', 'mapType', 'mode', 'turnLimit', 'relief', 'events', 'fog', 'dayCycle', 'seed'];
let soloRec = null;
function newGame(spectate) {
  prefs.setup = setup; savePrefs();
  const init = Object.assign({}, setup, { spectate, seed: ((Math.random() * 2147483646) | 0) + 1, tribes: null, humans: null });
  const rec = spectate ? null : { init: {}, log: [] };
  if (rec) SOLO_KEYS.forEach(k => { if (init[k] !== undefined) rec.init[k] = init[k]; });
  startWith(TT.newGame(init), { mode: spectate ? 'spectate' : 'solo', solo: rec });
}
function continueGame() {
  const saved = store.get('save', null);
  if (!saved) return;
  try { startWith(TT.deserialize(saved.data), { solo: saved.solo || null }); } catch (e) { toast('That save could not be loaded. Start a new game instead.'); store.del('save'); renderMenu(); }
}
function startWith(s, opts) {
  opts = opts || {};
  attract = false; token++;
  st = s; sel = null; busy = false; paused = false; armed = null; lastLog = st.log.length; hintDismissed = {}; hintShownTurn = {}; siegeSeen = {}; $('#siege').hidden = true; justLearned = null; preview = null; techSel = null; lastInteract = performance.now(); hideHint();
  const people = st.players.filter(p => !p.isAI).map(p => p.id);
  mode = opts.mode || (!people.length ? 'spectate' : 'solo');
  soloRec = mode === 'solo' ? opts.solo || null : null;
  localSeats = opts.localSeats || new Set(people);
  net = opts.net || null;
  const n0 = net;   // bound to this connection, so a stale bot turn can never leak moves into a rebuilt game
  const rec = soloRec;
  TT.setRecorder(st, n0 ? (cmd => { if (net === n0 && !n0.applying) n0.outbox.push(cmd); }) : rec ? (cmd => { rec.log.push(JSON.parse(JSON.stringify(cmd))); }) : null);
  human = localSeats.size ? (localSeats.has(st.current) ? st.current : localSeats.values().next().value) : -1;
  $('#menu').hidden = true; $('#gameover').hidden = true; $('#pause').hidden = true; $('#lobby').hidden = true;
  inGameChrome(true);
  $('#rail').classList.remove('open');
  R3.setOptions({ relief: RELIEF[st.settings.relief] || 1, dayCycle: st.settings.dayCycle !== false, speed: SPEED[prefs.speed], instant: false });
  R3.setState(st, human);
  R3.follow = prefs.follow;
  miniSig = '';
  document.body.classList.toggle('spectating', human < 0);
  document.body.classList.toggle('online', mode === 'online');
  refresh();
  if (seatKind(st.current) === 'local') localTurnStart(true); else drive();
}

// ---------------------------------------------------------------- turn driver: local people, bots, remote friends
function seatKind(pid) {
  const P = st.players[pid];
  if (P.isAI) return 'bot';
  return localSeats.has(pid) ? 'local' : 'remote';
}
// in online games the nearest living person seated before a bot runs its turn, so every client agrees who does it
function botRunner(pid) {
  const n = st.players.length;
  for (let k = 1; k <= n; k++) { const q = (pid - k + n) % n, Q = st.players[q]; if (Q.alive && !Q.isAI) return q; }
  return 0;
}
function iRunBots() { return mode !== 'online' || localSeats.has(botRunner(st.current)); }
function seatLabel(pid) {
  if (mode === 'online' && net && net.players) { const p = net.players.find(x => x.seat === pid); return p && !st.players[pid].isAI ? p.username : ''; }
  return '';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function drive() {
  const my = token;
  busy = true; refresh();
  while (my === token && !st.over) {
    if (paused) { await sleep(200); continue; }
    const kind = seatKind(st.current);
    if (kind === 'local') break;
    if (kind === 'bot' && (iRunBots() || (net && net.forceBots))) { await runBotTurn(my); continue; }
    showAIStrip(kind);
    await netWait(my);
  }
  $('#aiStrip').hidden = true;
  if (my !== token) return;
  busy = false;
  if (st.over) { refresh(); showGameOver(); return; }
  await localTurnStart(false);
}
async function runBotTurn(my) {
  showAIStrip('bot');
  const inst = prefs.speed === 'instant' && human >= 0;
  R3.setOptions({ instant: inst, speed: SPEED[prefs.speed] * (human < 0 ? 0.8 : 1) });
  const seat = st.current;
  let n = 0;
  for (const evs of AI.turn(st)) {
    if (my !== token) return;
    await R3.play(evs);
    noteLosses(evs);
    if (!inst) refreshLight(); else if (++n % 12 === 0) await frameWait();
  }
  if (my !== token) return;
  await R3.play(TT.endTurn(st));
  if (net) await netFlush(seat);
  R3.setOptions({ instant: false });
  refresh();
  await frameWait();
}
function noteLosses(evs) {
  for (const e of evs) {
    if (e.type === 'capture' && e.prev === human && human >= 0) { delete siegeSeen[e.cid]; showSiege(st.cities[e.cid], 'lost'); }
    if (e.type === 'eliminated' && mode !== 'solo' && !st.over && !st.players[e.pid].isAI) toast(localSeats.has(e.pid) ? (seatLabel(e.pid) ? seatLabel(e.pid) + ', your' : 'Your') + ' tribe has fallen. You can keep watching.' : (seatLabel(e.pid) || st.players[e.pid].name) + ' is out of the game.');
  }
}
async function localTurnStart(first) {
  const seat = st.current;
  if (human !== seat) { human = seat; R3.setViewer(seat); miniSig = ''; }
  beginHumanTurn(first);
}
function beginHumanTurn(first) {
  R3.setOptions({ speed: SPEED[prefs.speed], instant: false });
  lastInteract = performance.now(); hideHint();
  sel = null; armed = null;
  refresh();
  save();
  const P = st.players[human];
  const cap = st.cities.find(c => c.owner === human && c.capital) || st.cities.find(c => c.owner === human);
  if (!first && cap && !R3.isOnScreen(cap.x, cap.y, 1)) R3.focus(cap.x, cap.y);
  const who = first ? 'Your tribe awaits' : 'Your turn';
  showTurnBanner(who, (seatLabel(human) ? seatLabel(human) + ' · ' : '') + 'Turn ' + st.turn + ' · ' + P.stars + ' stars (+' + TT.income(st, human) + ')');
  promptRewards();
}
function onLearned(k) {
  const P = st.players[human];
  const builds = Object.keys(TT.BUILD).filter(b => TT.BUILD[b].tech === k && b !== 'clear');
  const tiles = [];
  for (let i = 0; i < st.tiles.length; i++) {
    if (st.tiles[i].owner !== human) continue;
    if (TT.buildOptions(st, human, i % st.W, (i / st.W) | 0).some(b => builds.indexOf(b) >= 0)) tiles.push(i);
  }
  const units = TT.UNIT_ORDER.filter(u => TT.UNITS[u].tech === k).map(u => TT.UNITS[u].name);
  const naval = Object.keys(TT.NAVAL).filter(n => TT.NAVAL[n].tech === k && TT.NAVAL[n].cost).map(n => TT.NAVAL[n].name);
  const bits = [];
  if (tiles.length) bits.push(tiles.length + (tiles.length === 1 ? ' tile glows' : ' tiles glow'));
  if (units.length) bits.push('new: ' + units.join(', '));
  if (naval.length) bits.push('new: ' + naval.join(', '));
  toast(TT.TECHS[k].name + (bits.length ? ' · ' + bits.join(' · ') : ''), P.color);
  if (tiles.length) { justLearned = { tech: k, tiles, build: builds[0], turn: st.turn }; burstNext = true; }
  $('#tech').hidden = true;
}
function save() { if (human >= 0 && !st.over && mode === 'solo') store.set('save', { turn: st.turn, data: TT.serialize(st), solo: soloRec }); }

async function act(evs) {
  if (!evs) return false;
  armed = null; preview = null;
  for (const e of evs) {
    if (e.type === 'move') satisfy('move', true);
    if (e.type === 'build') { satisfy('harvest', true); if (justLearned) satisfy('tech:' + justLearned.tech, true); }
    if (e.type === 'capture') satisfy('cap');
    if (e.type === 'spawn') satisfy('train', true);
    if (e.type === 'tech' && e.pid === human) { satisfy('techbtn', true); onLearned(e.tech); }
  }
  busy = true; refresh();
  await R3.play(evs);
  busy = false;
  if (net && net.outbox.length) netFlush(human);
  if (sel && sel.kind === 'unit') {
    const u = TT.getUnit(st, sel.uid);
    if (!u) sel = null;
    else if (u.owner === human && !u.canMove && !u.canAttack) sel = { kind: 'unit', uid: u.id, spent: true };
  }
  refresh();
  promptRewards();
  if (st.over) { save(); showGameOver(); }
  return true;
}

async function endTurn() {
  if (!canAct()) return;
  if (pendingReward()) { promptRewards(); return; }
  sel = null; armed = null;
  busy = true;
  R3.setHighlights(null);
  const seat = st.current;
  await R3.play(TT.endTurn(st));
  if (net) await netFlush(seat);
  busy = false;
  refresh();
  if (st.over) { showGameOver(); return; }
  drive();
}

// ---------------------------------------------------------------- selection & clicks
function canAct() { return human >= 0 && !busy && !!st && !st.over && st.current === human && localSeats.has(human); }
function onTileClick(i) {
  if (!st || attract || i < 0) return;
  const x = i % st.W, y = (i / st.W) | 0;
  const P = human >= 0 ? st.players[human] : null;
  const explored = !P || P.explored[i];
  if (canAct() && sel && sel.kind === 'unit' && !sel.spent) {
    const u = TT.getUnit(st, sel.uid);
    if (u && u.owner === human) {
      const tgt = TT.unitAt(st, x, y);
      if (tgt && tgt.owner !== human && TT.attackTargets(st, u).indexOf(tgt) >= 0) { hideForecast(); act(TT.attack(st, u.id, tgt.id)); return; }
      if (TT.moveTargets(st, u).indexOf(i) >= 0) { act(TT.move(st, u.id, x, y)); return; }
    }
  }
  armed = null;
  if (!explored) { sel = null; refresh(); return; }
  const opts = [];
  const u = TT.unitAt(st, x, y);
  if (u && TT.visibleTo(st, u, human)) opts.push({ kind: 'unit', uid: u.id });
  const tl = st.tiles[i];
  if (tl.site >= 0) opts.push({ kind: 'city', cid: tl.site });
  opts.push({ kind: 'tile', i });
  let k = 0;
  if (sel) {
    const cur = opts.findIndex(o => o.kind === sel.kind && ((o.kind === 'unit' && o.uid === sel.uid) || (o.kind === 'city' && o.cid === sel.cid) || (o.kind === 'tile' && o.i === sel.i)));
    if (cur >= 0) k = (cur + 1) % opts.length;
  }
  sel = opts[k];
  refresh();
}
function readyUnits() { return human >= 0 ? st.units.filter(u => u.owner === human && (u.canMove || u.canAttack)) : []; }
function selectNextUnit() {
  if (!canAct()) return;
  const mine = readyUnits();
  if (!mine.length) { toast('Every unit has acted. End the turn when you are ready.'); return; }
  const cur = sel && sel.kind === 'unit' ? mine.findIndex(u => u.id === sel.uid) : -1;
  const u = mine[(cur + 1) % mine.length];
  sel = { kind: 'unit', uid: u.id };
  R3.focus(u.x, u.y);
  refresh();
}

// ---------------------------------------------------------------- refresh
function refresh() {
  if (!st) return;
  renderTop();
  renderRail();
  renderInfo();
  renderDock();
  keepSelInView();
  updateHighlights();
  actionSet = actionableTiles();
  R3.setActionable(actionSet, burstNext); burstNext = false;
  flushLog();
  checkSiege();
  updateHint();
}
let actionSet = new Set(), burstNext = false, justLearned = null;
// tiles inside the viewer's borders where a harvest or building is possible and affordable right now
function actionableTiles() {
  const set = new Set();
  if (!st || human < 0 || !canAct()) return set;
  const P = st.players[human];
  for (let i = 0; i < st.tiles.length; i++) {
    if (st.tiles[i].owner !== human) continue;
    for (const k of TT.buildOptions(st, human, i % st.W, (i / st.W) | 0)) {
      if (k === 'clear') continue;
      const B = TT.BUILD[k];
      if (P.techs[B.tech] && P.stars >= B.cost) { set.add(i); break; }
    }
  }
  return set;
}
function nearestTo(list, x, y) { let best = list[0], bd = 1e9; for (const i of list) { const d = Math.max(Math.abs(i % st.W - x), Math.abs(((i / st.W) | 0) - y)); if (d < bd) { bd = d; best = i; } } return best; }

// ---------------------------------------------------------------- coach hints: minimal, idle-triggered, fading out over time
let hintDismissed = {}, curHint = null, lastInteract = performance.now(), hintShownTurn = {};
const TUTORIAL = { move: 1, techbtn: 1, harvest: 1, train: 1 };
const HINT_LIMIT = { move: 1, techbtn: 1, harvest: 1, train: 1, tech: 2, cap: 2, end: 3, spend: 1 }; // lifetime shows
const hintBase = key => key.startsWith('tech:') ? 'tech' : key;
// the longer you play, the longer the game waits before offering help
const hintDelay = () => Math.min(15000, 2500 + (st ? st.turn : 1) * 700);
function hintOk(key) {
  const base = hintBase(key), counts = prefs.hintCounts || {};
  if (st.turn > 12 && base !== 'end') return false;
  if (hintShownTurn[key] !== st.turn && (counts[base] || 0) >= (HINT_LIMIT[base] || 1)) return false;
  const d = hintDismissed[key];
  return d == null || (d !== 'forever' && d !== st.turn);
}
function satisfy(key, forever) {
  const base = hintBase(key);
  if (TUTORIAL[base] || forever) { prefs.hintCounts = prefs.hintCounts || {}; prefs.hintCounts[base] = Math.max(prefs.hintCounts[base] || 0, TUTORIAL[base] ? 99 : (prefs.hintCounts[base] || 0)); savePrefs(); }
  hintDismissed[key] = forever ? 'forever' : st.turn;
  if (curHint && curHint.key === key) hideHint();
}
function computeHint() {
  if (!prefs.hints || !st || attract || human < 0 || !canAct()) return null;
  if (!$('#reward').hidden || !$('#tech').hidden || !$('#menu').hidden || !$('#pause').hidden || !$('#scores').hidden || !$('#gameover').hidden) return null;
  const cap = st.cities.find(c => c.owner === human && c.capital) || st.cities.find(c => c.owner === human) || { x: 0, y: 0 };
  if (justLearned && justLearned.turn === st.turn && hintOk('tech:' + justLearned.tech)) {
    const live = justLearned.tiles.filter(i => actionSet.has(i));
    if (live.length) return { key: 'tech:' + justLearned.tech, text: 'Tap to ' + TT.BUILD[justLearned.build].name.toLowerCase(), tile: nearestTo(live, cap.x, cap.y) };
  }
  const ready = readyUnits();
  if (st.turn <= 3 && !sel && ready.length && ready[0].canMove && hintOk('move')) return { key: 'move', text: 'Tap to move', unit: ready[0].id };
  const affordTech = TT.TECH_ORDER.some(k => TT.canResearch(st, human, k));
  if (affordTech && Object.keys(st.players[human].techs).length <= 2 && hintOk('techbtn')) return { key: 'techbtn', text: 'New tech', el: '#btnTech', place: 'below' };
  if (actionSet.size && hintOk('harvest')) return { key: 'harvest', text: 'Tap to harvest', tile: nearestTo([...actionSet], cap.x, cap.y) };
  if (!ready.length) {
    const canTrain = st.cities.some(c => c.owner === human && TT.UNIT_ORDER.some(k => TT.canTrain(st, c.id, k)));
    if (!actionSet.size && !affordTech && !canTrain && hintOk('end')) return { key: 'end', text: 'End turn', el: '#btnEnd', place: 'above' };
    if (hintOk('spend')) return { key: 'spend', text: st.players[human].stars + '★ to spend', el: '#rbStarsWrap', place: 'below' };
  }
  return null;
}
function showHint(hnt) {
  const base = hintBase(hnt.key);
  if (hintShownTurn[hnt.key] !== st.turn) { prefs.hintCounts = prefs.hintCounts || {}; prefs.hintCounts[base] = (prefs.hintCounts[base] || 0) + 1; hintShownTurn[hnt.key] = st.turn; savePrefs(); }
  curHint = hnt;
  $('#hintText').textContent = hnt.text;
  const b = $('#hint'); b.hidden = false; b.classList.remove('in'); void b.offsetWidth; b.classList.add('in');
  positionHint();
}
function hideHint() { curHint = null; $('#hint').hidden = true; }
function noteInteraction() { lastInteract = performance.now(); if (curHint) hideHint(); }
// called after state changes: drop a hint that no longer applies
function updateHint() { if (curHint) { const n = computeHint(); if (!n || n.key !== curHint.key) hideHint(); } }
function tickHint() {
  if (curHint || !st || attract || !prefs.hints) return;
  if (performance.now() - lastInteract < hintDelay()) return;
  const hnt = computeHint();
  if (hnt) showHint(hnt);
}
function positionHint() {
  const b = $('#hint');
  if (!curHint || b.hidden) return;
  let tx, ty, place = curHint.place || 'above';
  if (curHint.el) { const r = $(curHint.el).getBoundingClientRect(); if (!r.width) { b.style.visibility = 'hidden'; return; } tx = r.left + r.width / 2; ty = place === 'below' ? r.bottom : r.top; }
  else {
    const p = curHint.unit ? R3.unitScreenPos(curHint.unit) : R3.tileScreenPos(curHint.tile % st.W, (curHint.tile / st.W) | 0);
    if (!p) { b.style.visibility = 'hidden'; return; }
    tx = p.x; ty = p.y - (curHint.unit ? p.z * 0.58 : p.z * 0.1);
  }
  const bw = b.offsetWidth, bh = b.offsetHeight, m = 10;
  const left = Math.max(m, Math.min(innerWidth - bw - m, tx - bw / 2));
  const top = place === 'below' ? ty + 10 : ty - bh - 10;
  b.style.visibility = top < 4 || top > innerHeight ? 'hidden' : 'visible';
  b.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  b.classList.toggle('below', place === 'below');
  b.style.setProperty('--ax', Math.round(Math.max(12, Math.min(bw - 12, tx - left))) + 'px');
}
function refreshLight() { renderTop(); renderRail(); flushLog(); checkSiege(); }

function updateHighlights() {
  R3.setPath(null);
  if (!st || attract) { R3.setHighlights(null); return; }
  const hl = {};
  if (sel && sel.kind === 'unit') {
    const u = TT.getUnit(st, sel.uid);
    if (u) {
      hl.sel = u.y * st.W + u.x; hl.unit = u.id;
      if (canAct() && u.owner === human && !sel.spent) {
        hl.moves = TT.moveTargets(st, u);
        const tg = TT.attackTargets(st, u);
        hl.attacks = tg.map(e => e.y * st.W + e.x);
        if (!TT.has(TT.stats(st, u), 'convert')) hl.doomed = tg.filter(e => TT.combat(st, u, e).killed).map(e => e.id);
      }
    }
  } else if (sel && sel.kind === 'city') { const c = st.cities[sel.cid]; hl.sel = c.y * st.W + c.x; }
  else if (sel && sel.kind === 'tile') {
    hl.sel = sel.i;
  }
  R3.setHighlights(hl);
  R3.setSweat(new Set(hl.doomed || []));
}

const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
function renderTop() {
  const viewP = human >= 0 ? st.players[human] : st.players[st.current];
  const tribe = TT.tribe(viewP.tribe);
  const top = $('#top');
  top.style.setProperty('--tc', hex(viewP.color));
  const crestKey = human >= 0 ? viewP.tribe : 'spectate';
  if ($('#rbCrest').dataset.k !== crestKey) { const cr = $('#rbCrest'); cr.dataset.k = crestKey; cr.innerHTML = ''; if (human >= 0) cr.append(art({ kind: 'unit', type: 'warrior', color: viewP.color, tribe: viewP.tribe, pad: 1 }, 38)); else cr.append(icon('map')); }
  $('#rbTribe').textContent = human >= 0 ? viewP.name : 'Spectating';
  $('#rbTurn').textContent = 'Turn ' + st.turn + (st.settings.mode === 'score' ? ' of ' + st.settings.turnLimit : '');
  $('#rbStarsWrap').hidden = human < 0; $('#rbScoreWrap').hidden = human < 0;
  if (human >= 0) {
    $('#rbStars').textContent = viewP.stars;
    $('#rbIncome').textContent = '+' + TT.income(st, human);
    const sc = TT.score(st, human);
    $('#rbScore').textContent = sc.toLocaleString();
    const alive = st.players.filter(q => q.alive);
    const rank = alive.filter(q => TT.score(st, q.id) > sc).length + 1;
    $('#rbRank').textContent = ordinal(rank) + '/' + alive.length;
    const hist = viewP.scoreHist, prev = hist.length ? hist[hist.length - 1] : sc, dl = sc - prev;
    const de = $('#rbDelta'); de.textContent = dl ? (dl > 0 ? '▲ ' : '▼ ') + Math.abs(dl) : ''; de.className = dl < 0 ? 'down' : '';
  }
  const pw = $('#btnPower');
  pw.hidden = human < 0; $('#btnTech').hidden = human < 0;
  if (human >= 0) {
    pw.style.setProperty('--pct', Math.min(1, viewP.power / TT.POWER_COST));
    pw.style.setProperty('--tc', hex(viewP.color));
    pw.classList.toggle('ready', viewP.power >= TT.POWER_COST);
    pw.disabled = !canAct() || viewP.power < TT.POWER_COST;
    $('#powerName').textContent = tribe.powerName;
    $('#powerCharge').textContent = viewP.power >= TT.POWER_COST ? 'Ready' : viewP.power + ' / ' + TT.POWER_COST;
    pw.title = tribe.powerName + ': ' + tribe.powerDesc + ' Charges 1 per turn and 1 per kill. (P)';
    const icoKey = POWER_ICON[tribe.power];
    if ($('#icoPower').dataset.k !== icoKey) { setIcon('#icoPower', icoKey); $('#icoPower').dataset.k = icoKey; }
    const n = TT.TECH_ORDER.filter(k => TT.canResearch(st, human, k)).length;
    const b = $('#techBadge'); b.hidden = !n || !canAct(); b.textContent = n;
  }
  $('#btnPause').hidden = human >= 0;
  $('#btnPause').textContent = paused ? 'Resume' : 'Pause';
  const end = $('#btnEnd');
  end.disabled = !canAct();
  const ready = readyUnits().length;
  end.classList.toggle('alldone', canAct() && ready === 0);
  const claims = human >= 0 && st.current === human ? st.units.filter(u => u.owner === human && TT.canCapture(st, u)).length : 0;
  $('#endHint').textContent = human < 0 ? '' : st.current !== human ? 'Rivals are moving' : claims ? claims + (claims === 1 ? ' city' : ' cities') + ' to claim' : ready ? ready + (ready === 1 ? ' unit' : ' units') + ' can still act' : 'All units have acted';
  $('#endHint').classList.toggle('warn', claims > 0);
  $('#btnNext').disabled = !canAct() || !ready;
}

// ---------------------------------------------------------------- rail: minimap + standings
function renderRail() {
  const box = $('#standings');
  box.innerHTML = '';
  const rows = TT.standings(st).map(r => ({ P: r.P, s: r.alive ? r.score : -1 }));
  const top = Math.max(1, rows[0].s);
  rows.forEach(({ P, s }, k) => {
    const nC = st.cities.filter(c => c.owner === P.id).length;
    const known = human < 0 || P.id === human || st.cities.some(c => c.owner === P.id && st.players[human].explored[c.y * st.W + c.x]) || st.units.some(u => u.owner === P.id && st.players[human].explored[u.y * st.W + u.x]);
    box.appendChild(h('li', { class: (P.id === st.current && !st.over ? 'cur ' : '') + (P.alive ? '' : 'dead ') + (P.id === human ? 'me' : ''), style: '--tc:' + hex(known ? P.color : 0x7d7f9f) },
      h('span', { class: 'rk' }, P.alive ? String(k + 1) : '–'),
      h('span', { class: 'av' }, known ? art({ kind: 'unit', type: 'warrior', color: P.color, tribe: P.tribe, pad: 0 }, 30) : icon('map')),
      h('span', { class: 'nm', title: P.alive ? nC + (nC === 1 ? ' city' : ' cities') : 'Fallen' }, known ? (seatLabel(P.id) ? seatLabel(P.id) + ' · ' + P.name : P.name) : 'Unknown'),
      h('span', { class: 'sc' }, P.alive ? s.toLocaleString() : '—'),
      h('span', { class: 'bar' }, h('i', { style: 'width:' + (P.alive ? Math.max(3, s / top * 100) : 0) + '%' }))));
  });
  $('#railTurn').textContent = 'Turn ' + st.turn;
  drawMiniBase();
}
let miniSig = '', miniBase = null, miniLast = 0;
const mixHex = (a, b, k) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return 'rgb(' + Math.round(ar + (br - ar) * k) + ',' + Math.round(ag + (bg - ag) * k) + ',' + Math.round(ab + (bb - ab) * k) + ')';
};
const MINI_T = [0x2a68ab, 0x4ab5c9, 0x8fcb5c, 0x5a9a42, 0x9b9886];
function drawMiniBase() {
  if (!st || $('#rail').hidden) return;
  const P = human >= 0 ? st.players[human] : null;
  let sig = '';
  for (let i = 0; i < st.tiles.length; i++) { const t = st.tiles[i]; sig += (P && !P.explored[i] ? 'u' : t.t + '' + t.owner) + ','; }
  for (const c of st.cities) sig += c.owner + ':' + c.level + ';';
  if (sig === miniSig && miniBase) return;
  miniSig = sig;
  const S = $('#mini').width, W = st.W, c = S / W;
  miniBase = miniBase || document.createElement('canvas');
  miniBase.width = S; miniBase.height = S;
  const g = miniBase.getContext('2d');
  g.fillStyle = '#20244f'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < st.tiles.length; i++) {
    const t = st.tiles[i], x = i % W, y = (i / W) | 0;
    if (P && !P.explored[i]) { g.fillStyle = '#2b3063'; }
    else {
      const base = MINI_T[t.t];
      g.fillStyle = t.owner >= 0 && !TT.isWater(t.t) ? mixHex(base, st.players[t.owner].color, 0.55) : t.owner >= 0 ? mixHex(base, st.players[t.owner].color, 0.3) : mixHex(base, 0, 0);
    }
    g.fillRect(x * c + 0.6, y * c + 0.6, c - 1.2, c - 1.2);
  }
  for (const city of st.cities) {
    const i = city.y * W + city.x;
    if (P && !P.explored[i]) continue;
    const s = c * (city.owner >= 0 ? 0.62 + Math.min(4, city.level) * 0.04 : 0.5);
    g.fillStyle = '#12152f';
    g.fillRect(city.x * c + (c - s) / 2 - 2, city.y * c + (c - s) / 2 - 2, s + 4, s + 4);
    g.fillStyle = city.owner >= 0 ? hex(st.players[city.owner].color) : '#e9dcc0';
    g.fillRect(city.x * c + (c - s) / 2, city.y * c + (c - s) / 2, s, s);
  }
}
function drawMini() {
  if (!st || !miniBase || $('#rail').hidden || ($('#rail').offsetParent === null)) return;
  const cv = $('#mini'), g = cv.getContext('2d'), S = cv.width, W = st.W, c = S / W;
  g.drawImage(miniBase, 0, 0);
  const P = human >= 0 ? st.players[human] : null;
  for (const u of st.units) {
    if (P && !P.explored[u.y * W + u.x]) continue;
    g.beginPath(); g.arc((u.x + 0.5) * c, (u.y + 0.5) * c, Math.max(2.5, c * 0.2), 0, Math.PI * 2);
    g.fillStyle = hex(st.players[u.owner].color); g.fill();
    g.lineWidth = 2; g.strokeStyle = '#12152f'; g.stroke();
  }
  const fp = R3.viewFootprint && R3.viewFootprint();
  if (fp) {
    g.beginPath();
    fp.forEach((p, k) => { const px = (p[0] + 0.5) * c, py = (p[1] + 0.5) * c; if (k) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  }
}
// On narrow screens the card can cover what was just tapped: ease the camera so it sits above the card.
let selSeen = '';
function keepSelInView() {
  const key = sel ? sel.kind + ':' + (sel.uid != null ? sel.uid : sel.cid != null ? sel.cid : sel.i) : '';
  if (key === selSeen) return;
  selSeen = key;
  if (!sel || !st || attract || (innerWidth > 820 && innerHeight > 520)) return;
  requestAnimationFrame(() => {
    if (!sel) return;
    const pos = sel.kind === 'unit' ? R3.unitScreenPos(sel.uid) : sel.kind === 'city' ? R3.tileScreenPos(st.cities[sel.cid].x, st.cities[sel.cid].y) : R3.tileScreenPos(sel.i % st.W, (sel.i / st.W) | 0);
    if (!pos) return;
    const top = ($('#top').hidden ? 0 : $('#top').getBoundingClientRect().bottom) + pos.z * 0.6, bottom = $('#bottom').getBoundingClientRect().top - pos.z * 0.35;
    if (bottom - top < 60) return;
    const mid = top + (bottom - top) * 0.45;
    if (pos.y > bottom || pos.y < top) R3.nudge(0, mid - pos.y);
  });
}
function uiFrame(t) {
  requestAnimationFrame(uiFrame);
  if (t - miniLast > 160) {
    miniLast = t; drawMini(); tickHint();
    if (st && !attract) {
      const topB = $('#top').hidden ? 0 : $('#top').getBoundingClientRect().bottom;
      const narrow = innerWidth <= 820 || innerHeight <= 520, bot = $('#bottom');
      R3.setInsets(topB, narrow && !bot.hidden ? innerHeight - bot.getBoundingClientRect().top : 0);
    } else R3.setInsets(0, 0);
  }
  positionHint();
}

// ---------------------------------------------------------------- info card
function ownerTag(pid) {
  if (pid < 0) return h('span', { class: 'owner', style: '--tc:#7d7f9f' }, 'Unclaimed');
  const P = st.players[pid];
  return h('span', { class: 'owner', style: '--tc:' + hex(P.color) }, P.name + (pid === human ? ' (you)' : ''));
}
function closeBtn() { return h('button', { class: 'x', type: 'button', 'aria-label': 'Clear selection', onclick: () => { sel = null; armed = null; refresh(); } }, icon('x')); }
const SKILL_ICON = { dash: 'move', escape: 'next', persist: 'sword', fortify: 'shield', charge: 'bolt', shove: 'expand', splash: 'target', heal: 'heal', convert: 'mindbender', aura: 'shield', fly: 'balloon', scout: 'map', carry: 'boat', stomp: 'giant' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
let skillOpen = null;
// big skill badges; the one-line description shows on hover or tap
function skillBadges(skills) {
  const row = h('div', { class: 'skrow' }), detail = h('div', { class: 'skdetail', hidden: true });
  const show = k => { detail.textContent = k ? TT.SKILLS[k] : ''; detail.hidden = !k; row.querySelectorAll('.sk').forEach(b => b.classList.toggle('on', b.dataset.k === k)); };
  skills.forEach(k => {
    const b = h('button', { type: 'button', class: 'sk', 'data-k': k, title: cap(k) + ': ' + TT.SKILLS[k], 'aria-label': cap(k) + ': ' + TT.SKILLS[k] }, h('span', { class: 'sk-i' }, icon(SKILL_ICON[k] || 'star')), h('span', { class: 'sk-n' }, cap(k)));
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(k); });
    b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') show(skillOpen); });
    b.addEventListener('click', () => { skillOpen = skillOpen === k ? null : k; show(skillOpen); });
    row.append(b);
  });
  const wrap = h('div', { class: 'skills2' }, row, detail);
  show(skills.indexOf(skillOpen) >= 0 ? skillOpen : null);
  return wrap;
}
function statTiles(items) {
  return h('div', { class: 'stats3' }, items.map(([ic, label, v, up]) => h('div', { class: 'st3' + (up ? ' up' : ''), title: label, 'aria-label': label + ' ' + v }, icon(ic), h('b', null, String(v)))));
}
const pill = (text, kind) => h('span', { class: 'pill ' + (kind || '') }, text);
let preview = null; // unit type previewed while hovering a train button
function renderInfo() {
  const p = $('#info');
  p.innerHTML = '';
  p.className = 'glass';
  if (preview && canAct()) { infoUnitType(p, preview); return; }
  if (!sel) {
    p.classList.add('hint');
    p.textContent = human < 0 ? 'Tap anything to inspect it' : st.current !== human ? 'Rivals are moving…' : 'Tap a unit, city or tile';
    return;
  }
  p.append(closeBtn());
  if (sel.kind === 'unit') infoUnit(p); else if (sel.kind === 'city') infoCity(p); else infoTile(p);
}
function head(portrait, title, sub) { return h('div', { class: 'ihead' }, portrait, h('div', { class: 'ih-t' }, h('h3', null, title), h('div', { class: 'ih-sub' }, sub))); }
function infoUnit(p) {
  const u = TT.getUnit(st, sel.uid);
  if (!u) { sel = null; renderInfo(); return; }
  const S = TT.stats(st, u), B = TT.UNITS[u.type];
  const portrait = h('span', { class: 'portrait art-p', style: '--tc:' + hex(st.players[u.owner].color) }, unitArt(u.type, u.naval, u.owner, 70));
  if (u.vet) portrait.append(h('span', { class: 'vet', title: 'Veteran: +5 max HP' }, icon('star')));
  let state = null;
  if (u.owner === human && st.current === human) state = u.frozen ? pill('Frozen', 'ice') : u.canMove || u.canAttack ? pill(u.canMove && u.canAttack ? 'Ready' : u.canMove ? 'Can move' : 'Can attack', 'ok') : pill('Done', 'done');
  else if (u.owner !== human) state = pill('×' + TT.defBonus(st, u).toFixed(1) + ' def', 'info');
  p.append(head(portrait, TT.unitName(u), [ownerTag(u.owner), state, u.kills ? h('span', { class: 'pill kills', title: 'Kills' }, icon('skull'), String(u.kills)) : null]));
  if (u.owner === human && canAct()) {
    const refund = Math.floor(TT.UNITS[u.type].cost / 2), isArmed = armed === 'disband:' + u.id;
    p.append(h('button', { type: 'button', class: 'ibtn' + (isArmed ? ' armed' : ''), title: isArmed ? 'Tap again to disband' : 'Disband this unit (refund ' + refund + '★)', 'aria-label': isArmed ? 'Confirm disband' : 'Disband unit',
      onclick: () => { if (armed === 'disband:' + u.id) { sel = null; act(TT.disband(st, u.id)); } else { armed = 'disband:' + u.id; renderInfo(); } } }, icon('trash'), isArmed ? h('span', null, 'Disband +' + refund + '★') : null));
  }
  const low = u.hp <= S.maxHp * 0.35;
  p.append(h('div', { class: 'hp' + (low ? ' low' : ''), role: 'meter', 'aria-label': 'Health', 'aria-valuenow': u.hp, 'aria-valuemin': 0, 'aria-valuemax': S.maxHp }, icon('heart'), h('span', { class: 'bar' }, h('i', { style: 'width:' + Math.max(0, u.hp / S.maxHp * 100) + '%' })), h('b', null, u.hp + '/' + S.maxHp)));
  const rng = TT.effRange(st, u, u.x, u.y, S);
  const baseAtk = u.naval ? TT.NAVAL[u.naval].atk : B.atk;
  p.append(statTiles([['sword', 'Attack', +S.atk.toFixed(1), S.atk > baseAtk], ['shield', 'Defense', S.def], ['move', 'Movement', S.move], ['target', rng > S.range ? 'Range (+1 from mountain)' : 'Range', rng, rng > S.range]]));
  p.append(skillBadges(S.skills));
  if (u.owner === human && canAct() && !sel.spent) {
    const tg = TT.attackTargets(st, u);
    if (tg.length) {
      const list = h('div', { class: 'forecast' });
      for (const e of tg) {
        let res;
        if (TT.has(S, 'convert')) res = h('span', { class: 'res' }, h('b', { class: 'kill' }, 'Convert'));
        else {
          const r = TT.combat(st, u, e);
          res = h('span', { class: 'res' }, r.killed ? h('b', { class: 'kill' }, icon('skull'), 'KO') : h('b', null, icon('sword'), '−' + r.dmg), !r.killed && r.counter ? h('span', { class: 'ctr' + (r.counterKills ? ' fatal' : ''), title: 'Damage you take back' }, icon('heart'), '−' + r.counter) : null);
        }
        list.append(h('button', { class: 'fc', type: 'button', title: 'Attack ' + TT.unitName(e), onclick: () => act(TT.attack(st, u.id, e.id)) }, unitArt(e.type, e.naval, e.owner, 38), h('span', { class: 'fchp' }, String(e.hp)), res));
      }
      p.append(list);
    }
  }
}
function infoUnitType(p, k) {
  const B = TT.UNITS[k], P = st.players[human];
  const locked = B.tech && !P.techs[B.tech];
  p.append(head(h('span', { class: 'portrait art-p', style: '--tc:' + hex(P.color) }, unitArt(k, null, human, 70)), B.name, [locked ? pill('Needs ' + TT.TECHS[B.tech].name, 'done') : pill(B.cost + '★', 'gold'), pill(B.hp + ' HP', 'info')]));
  p.append(statTiles([['sword', 'Attack', B.atk], ['shield', 'Defense', B.def], ['move', 'Movement', B.move], ['target', 'Range', B.range]]));
  p.append(skillBadges(B.skills));
}
function infoCity(p) {
  const c = st.cities[sel.cid];
  const col = c.owner >= 0 ? hex(st.players[c.owner].color) : '#b9a98a';
  const portrait = h('span', { class: 'portrait art-p', style: '--tc:' + col }, c.owner >= 0 ? art({ kind: 'city', city: c, tribe: st.players[c.owner].tribe, color: st.players[c.owner].color }, 70) : art({ kind: 'village' }, 70));
  if (c.owner >= 0) portrait.append(h('span', { class: 'lvb' }, String(c.level)));
  if (c.capital) portrait.append(h('span', { class: 'vet', title: 'Capital' }, icon('star')));
  p.append(head(portrait, c.name, [ownerTag(c.owner), c.owner < 0 ? pill('Village', 'info') : null]));
  if (c.owner < 0) { p.append(h('p', { class: 'note' }, 'Move a unit here, capture next turn.')); return; }
  const need = c.level + 1;
  p.append(h('div', { class: 'growth', title: 'Population ' + c.pop + ' of ' + need + ' to reach level ' + (c.level + 1) }, icon('users'), h('div', { class: 'pips', 'aria-hidden': 'true' }, Array.from({ length: need }, (_, k) => h('i', { class: k < c.pop ? 'on' : '' }))), h('b', null, c.pop + '/' + need)));
  const inc = c.level + c.workshop + c.parks + (c.capital ? 1 : 0) + (c.capital && st.players[c.owner].tribe === 'sunspire' ? 1 : 0);
  p.append(statTiles([['star', 'Stars per turn', '+' + inc], ['users', 'Units supported', TT.cityUnits(st, c) + '/' + TT.cityCap(c)], ['tower', 'City wall', c.walls ? '✓' : '–'], ['hammer', 'Workshop', c.workshop ? '✓' : '–']]));
}
function infoTile(p) {
  const i = sel.i, tl = st.tiles[i];
  const sk = R3.SKIN[tl.owner >= 0 ? st.players[tl.owner].tribe : 'neutral'];
  const tArt = tl.site >= 0 ? null : tl.t === TT.T.FOREST ? art({ kind: 'forest', sk }, 70) : tl.t === TT.T.MOUNTAIN ? art({ kind: 'mountain', sk }, 70) : tl.res ? art({ kind: 'resource', res: tl.res }, 70) : tl.imp ? art({ kind: 'improvement', imp: tl.imp, sk, color: tl.owner >= 0 ? st.players[tl.owner].color : null }, 70) : tl.ruin ? art({ kind: 'ruin' }, 70) : icon(TERRAIN_ICON[tl.t]);
  const swatch = TT.isWater(tl.t) ? TERRAIN_SWATCH[tl.t] : hex(tl.t === TT.T.FOREST ? sk.forest : sk.field);
  const chips = [];
  if (tl.res) chips.push(pill(TT.RES[tl.res].name, 'gold'));
  if (tl.imp) chips.push(pill({ farm: 'Farm', mine: 'Mine', lumber: 'Lumber hut', port: 'Port', temple: 'Temple', market: 'Market +' + TT.marketYield(st, i) + '★' }[tl.imp], tl.imp === 'market' ? 'gold' : 'info'));
  if (tl.road) chips.push(pill('Road', 'info'));
  if (tl.ruin) chips.push(pill('Ruins', 'gold'));
  if (tl.e >= 2) chips.push(h('span', { class: 'pill info', title: 'Attacking downhill from here gives +25% attack' }, icon('mountain'), 'High'));
  p.append(head(h('span', { class: 'portrait' + (tArt && tArt.tagName === 'CANVAS' ? ' art-p' : ''), style: '--tc:' + swatch }, tArt), TT.TERRAIN_NAMES[tl.t], [ownerTag(tl.owner)].concat(chips)));
  const note = tl.ruin ? 'Move a unit here to explore.' : (human >= 0 && tl.owner !== human && !TT.isWater(tl.t)) ? 'Build only inside your borders.' : null;
  if (note) p.append(h('p', { class: 'note' }, note));
}

// ---------------------------------------------------------------- action dock
function actBtn(o) {
  const b = h('button', { type: 'button', class: 'act ' + (o.cls || ''), disabled: !!o.disabled, title: o.title || null, style: o.tc ? '--tc:' + o.tc : null, onclick: o.onclick },
    h('span', { class: 'disc' + (o.art ? ' has-art' : '') }, o.art || icon(o.icon)), h('span', { class: 'nm' }, o.name));
  if (o.cost != null) b.append(h('span', { class: 'cost' + (o.cost < 0 ? ' gain' : '') }, (o.cost < 0 ? '+' + -o.cost : o.cost) + '★'));
  if (o.why) b.append(h('span', { class: 'why' }, o.why));
  if (o.locked) b.append(h('span', { class: 'lockb' }, icon('lock')));
  if (o.preview) {
    const on = () => { preview = o.preview; renderInfo(); }, off = () => { if (preview === o.preview) { preview = null; renderInfo(); } };
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') on(); }); b.addEventListener('pointerleave', off);
    b.addEventListener('focus', on); b.addEventListener('blur', off);
  }
  return b;
}
function renderDock() {
  const d = $('#dockInner');
  d.innerHTML = '';
  const items = [];
  if (sel && canAct()) {
    if (sel.kind === 'unit') dockUnit(items);
    else if (sel.kind === 'city') dockCity(items);
    else dockTile(items);
  }
  d.hidden = !items.length;
  items.forEach(x => d.append(x));
}
function dockUnit(items) {
  const u = TT.getUnit(st, sel.uid);
  if (!u || u.owner !== human) return;
  const S = TT.stats(st, u), P = st.players[human];
  const tl = st.tiles[u.y * st.W + u.x];
  if (tl.site >= 0 && st.cities[tl.site].owner !== human && !u.naval && !TT.has(S, 'fly')) {
    const c = st.cities[tl.site], ok = TT.canCapture(st, u);
    items.push(actBtn({ icon: 'flag', cls: 'primary', name: c.owner < 0 ? 'Found city' : 'Capture', disabled: !ok, why: ok ? null : 'Next turn', title: ok ? (c.owner < 0 ? 'Found the city of ' : 'Capture ') + c.name : 'A unit must start its turn here to capture', onclick: () => act(TT.capture(st, u.id)) }));
  }
  if (u.hp < S.maxHp) {
    const amt = tl.owner === u.owner ? 4 : 2, ok = u.canMove && u.canAttack;
    items.push(actBtn({ icon: 'recover', name: 'Recover', why: ok ? '+' + Math.min(amt, S.maxHp - u.hp) + ' HP' : 'Already acted', disabled: !ok, title: 'Heal instead of acting this turn', onclick: () => act(TT.recover(st, u.id)) }));
  }
  if (TT.has(S, 'heal')) {
    const n = TT.healTargets(st, u).length, ok = n && u.canMove && u.canAttack;
    items.push(actBtn({ icon: 'heal', name: 'Heal allies', why: n ? n + (n > 1 ? ' allies' : ' ally') : 'None hurt nearby', disabled: !ok, title: 'Heal adjacent allies by 4 HP', onclick: () => act(TT.healOthers(st, u.id)) }));
  }
  if (TT.has(S, 'infiltrate')) {
    const c = TT.canInfiltrate(st, u);
    items.push(actBtn({ icon: 'mindbender', art: unitArt('cloak', null, human, 46), cls: c ? 'primary' : '', name: 'Infiltrate', disabled: !c, why: c ? c.name : 'Next to a rival city', title: 'Steal stars from a rival city next to you and scatter its people (the Cloak is used up)', onclick: () => { sel = null; act(TT.infiltrate(st, u.id)); } }));
  }
  for (const k of TT.upgradeOptions(st, u)) {
    const N = TT.NAVAL[k];
    items.push(actBtn({ icon: k, art: unitArt(u.type, k, human, 46), cls: 'own', tc: hex(P.color), name: N.name, cost: N.cost, disabled: P.stars < N.cost, why: P.stars < N.cost ? 'Need ' + N.cost + '★' : null, title: 'Upgrade to ' + N.name + ': attack ' + N.atk + ', defense ' + N.def + ', move ' + N.move, onclick: () => act(TT.upgrade(st, u.id, k)) }));
  }
}
function dockCity(items) {
  const c = st.cities[sel.cid];
  if (c.owner !== human) return;
  const P = st.players[human];
  const occupied = !!TT.unitAt(st, c.x, c.y), full = TT.cityUnits(st, c) >= TT.cityCap(c);
  for (const k of TT.UNIT_ORDER) {
    const B = TT.UNITS[k];
    const locked = B.tech && !P.techs[B.tech];
    let why = null;
    if (locked) why = TT.TECHS[B.tech].name;
    else if (occupied) why = 'Tile busy';
    else if (full) why = 'City full';
    else if (P.stars < B.cost) why = 'Need ' + B.cost + '★';
    items.push(actBtn({ icon: k, art: unitArt(k, null, human, 50), preview: k, cls: why ? '' : 'own', tc: hex(P.color), name: B.name, cost: B.cost, disabled: !!why, why, locked,
      title: B.name + ' · attack ' + B.atk + ', defense ' + B.def + ', move ' + B.move + (B.range > 1 ? ', range ' + B.range : '') + ', ' + B.hp + ' HP · ' + B.skills.join(', ') + (locked ? ' · needs ' + TT.TECHS[B.tech].name : ''),
      onclick: () => act(TT.train(st, c.id, k)) }));
  }
  if (P.techs.diplomacy && c.capital && !P.embassy) {
    const met = TT.metRivals(st, human).length;
    items.push(h('span', { class: 'dock-sep' }));
    items.push(actBtn({ icon: 'flag', art: art({ kind: 'market', color: P.color }, 46), name: 'Embassy', cost: 5, disabled: P.stars < 5, why: P.stars < 5 ? 'Need 5★' : '+' + met + '★/turn', title: 'Embassy: +1 star per turn for each tribe you have met (' + met + ' so far)', onclick: () => act(TT.buildEmbassy(st, c.id)) }));
  }
  if (P.techs.construction && !c.walls) {
    items.push(h('span', { class: 'dock-sep' }));
    items.push(actBtn({ icon: 'tower', name: 'City wall', cost: 5, disabled: P.stars < 5, why: P.stars < 5 ? 'Need 5★' : null, title: 'Fortified units in this city get ×4 defense', onclick: () => act(TT.buildWalls(st, c.id)) }));
  }
}
function dockTile(items) {
  const i = sel.i, x = i % st.W, y = (i / st.W) | 0;
  const P = st.players[human];
  for (const k of TT.buildOptions(st, human, x, y)) {
    const B = TT.BUILD[k];
    const locked = !P.techs[B.tech];
    const why = locked ? TT.TECHS[B.tech].name : P.stars < Math.max(0, B.cost) ? 'Need ' + B.cost + '★' : k === 'market' ? '+' + TT.marketYield(st, i) + '★/turn' : B.pop ? '+' + B.pop + ' pop' : k === 'road' ? 'Faster moves' : k === 'grow' ? 'Forest' : 'Gain stars';
    const tl2 = st.tiles[i], sk2 = R3.SKIN[st.players[human].tribe];
    const col2 = st.players[human].color;
    const bArt = k === 'farm' || k === 'mine' || k === 'lumber' || k === 'port' ? art({ kind: 'improvement', imp: k, sk: sk2, color: col2 }, 46)
      : k === 'clear' || k === 'grow' ? art({ kind: 'forest', sk: sk2 }, 46) : k === 'road' ? art({ kind: 'milestone' }, 46) : k === 'temple' ? art({ kind: 'temple', color: col2 }, 46) : k === 'market' ? art({ kind: 'market', color: col2 }, 46) : art({ kind: 'resource', res: tl2.res }, 46);
    items.push(actBtn({ icon: BUILD_ICON[k], art: bArt, cls: locked || P.stars < Math.max(0, B.cost) ? '' : 'primary', name: B.name, cost: B.cost, disabled: locked || P.stars < Math.max(0, B.cost), why, locked,
      title: B.name + (B.pop ? ': +' + B.pop + ' population for ' + st.cities[st.tiles[i].city].name : ': turn this forest into a field') + (locked ? ' · needs ' + TT.TECHS[B.tech].name : ''),
      onclick: () => act(TT.build(st, x, y, k)) }));
  }
}

// ---------------------------------------------------------------- tech tree
// tree layout: one row per leaf, roots span their children; columns are tiers
const TECH_LAYOUT = [
  ['riding', 'ballooning', 'chivalry'],
  ['organization', 'farming', 'construction'],
  [null, 'shields', 'philosophy'],
  ['climbing', 'mining', 'smithery'],
  [null, 'meditation', null],
  ['fishing', 'sailing', 'navigation'],
  ['hunting', 'archery', null],
  [null, 'forestry', 'mathematics'],
];
const TECH_BRANCH = { riding: 0, ballooning: 0, chivalry: 0, organization: 1, farming: 1, construction: 1, shields: 1, philosophy: 1, climbing: 2, mining: 2, smithery: 2, meditation: 2, fishing: 3, sailing: 3, navigation: 3, hunting: 4, archery: 4, forestry: 4, mathematics: 4 };
const BRANCH_COL = ['#ff8f66', '#ffc94a', '#b9a2ff', '#4fd1e0', '#7fdc6c'];
let techSel = null;
function showTech() {
  if (human < 0 || attract) return;
  $('#tech').hidden = false;
  $('#tech .sheet').classList.add('techsheet');
  // on small screens the tree is larger than the view: open it centred, pannable by drag or scroll
  requestAnimationFrame(() => { const w = $('#techWrap'); if (w.scrollWidth > w.clientWidth) { w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2; w.scrollTop = (w.scrollHeight - w.clientHeight) / 2; } });
  const P = st.players[human];
  if (!techSel || P.techs[techSel]) techSel = TT.TECH_ORDER.find(k => TT.canResearch(st, human, k)) || TT.TECH_ORDER.find(k => TT.canResearch(st, human, k, true)) || null;
  renderTech();
  $('#techClose').focus();
}
// what each technology unlocks, drawn instead of described
const TECH_ART = {
  riding: { kind: 'unit', type: 'rider' }, organization: { kind: 'resource', res: 'fruit' }, climbing: { kind: 'mountain' }, fishing: { kind: 'resource', res: 'fish' }, hunting: { kind: 'resource', res: 'game' },
  ballooning: { kind: 'unit', type: 'balloon' }, farming: { kind: 'improvement', imp: 'farm' }, shields: { kind: 'unit', type: 'defender' }, mining: { kind: 'improvement', imp: 'mine' }, meditation: { kind: 'unit', type: 'shaman' },
  sailing: { kind: 'unit', type: 'warrior', naval: 'ship' }, archery: { kind: 'unit', type: 'archer' }, forestry: { kind: 'improvement', imp: 'lumber' }, chivalry: { kind: 'unit', type: 'knight' },
  construction: { kind: 'city', walls: true }, philosophy: { kind: 'unit', type: 'mindbender' }, smithery: { kind: 'unit', type: 'swordsman' }, navigation: { kind: 'unit', type: 'warrior', naval: 'battleship' }, mathematics: { kind: 'unit', type: 'catapult' },
  roads: { kind: 'milestone' }, trade: { kind: 'market' }, diplomacy: { kind: 'unit', type: 'cloak' }, whaling: { kind: 'resource', res: 'whale' }, aquatism: { kind: 'trident' }, spiritualism: { kind: 'temple' },
};
function techArt(k, size) {
  const P = st.players[human], sk = R3.SKIN[P.tribe], a = TECH_ART[k], s = size || 50;
  if (a.kind === 'unit') return art({ kind: 'unit', type: a.type, naval: a.naval, color: P.color, tribe: P.tribe }, s);
  if (a.kind === 'city') return art({ kind: 'city', city: { level: 2, walls: true, capital: false, workshop: 0, parks: 0 }, tribe: P.tribe, color: P.color }, s);
  return art(Object.assign({ sk, color: P.color }, a), s);
}
function techState(k) {
  const P = st.players[human];
  if (P.techs[k]) return 'owned';
  if (!TT.canResearch(st, human, k, true)) return 'locked';
  return P.stars >= TT.techCost(st, human, k) ? 'avail' : 'poor';
}
// radial tree: your tribe at the hub, basic techs on the inner ring, advanced ones further out
const BRANCH_ROOTS = ['riding', 'organization', 'climbing', 'fishing', 'hunting'];
const RING = [0, 0.165, 0.3, 0.435];
let radialPos = null;
function radialLayout() {
  if (radialPos) return radialPos;
  const pos = {};
  BRANCH_ROOTS.forEach((root, b) => {
    const th = -Math.PI / 2 + b * 2 * Math.PI / 5;
    pos[root] = { a: th, r: RING[1] };
    const kids = TT.TECH_ORDER.filter(k => TT.TECHS[k].req === root);
    kids.forEach((k, i) => {
      const a = th + (kids.length === 1 ? 0 : (i - (kids.length - 1) / 2) * 0.64);
      pos[k] = { a, r: RING[2] };
      TT.TECH_ORDER.filter(q => TT.TECHS[q].req === k).forEach(q => { pos[q] = { a, r: RING[3] }; });
    });
  });
  BRANCH_ROOTS.forEach(root => {
    const kids = TT.TECH_ORDER.filter(k => TT.TECHS[k].req === root);
    pos[root].la = kids.length === 1 ? pos[root].a + Math.PI / 2 : Math.PI / 2;
    kids.forEach((k, i) => {
      pos[k].la = pos[k].a + (kids.length === 1 ? Math.PI / 2 : i === 0 ? -Math.PI / 2 : Math.PI / 2);
      TT.TECH_ORDER.filter(q => TT.TECHS[q].req === k).forEach(q => { pos[q].la = pos[q].a; });
    });
  });
  for (const k in pos) { pos[k].x = 50 + Math.cos(pos[k].a) * pos[k].r * 100; pos[k].y = 50 + Math.sin(pos[k].a) * pos[k].r * 100; }
  return (radialPos = pos);
}
function renderTech() {
  const P = st.players[human], L = radialLayout();
  const g = $('#techGrid');
  g.innerHTML = '';
  g.className = 'techradial';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'techlinks'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('aria-hidden', 'true');
  const add2 = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); e.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(e); return e; };
  // a soft wedge per branch so each family reads as one region
  BRANCH_ROOTS.forEach((root, b) => {
    const th = -Math.PI / 2 + b * 2 * Math.PI / 5, h0 = th - 0.6, h1 = th + 0.6, r0 = 9, r1 = 48;
    const pt = (a, r) => (50 + Math.cos(a) * r).toFixed(2) + ' ' + (50 + Math.sin(a) * r).toFixed(2);
    const e = document.createElementNS(SVGNS, 'path');
    e.setAttribute('d', 'M' + pt(h0, r0) + ' L' + pt(h0, r1) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + pt(h1, r1) + ' L' + pt(h1, r0) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + pt(h0, r0) + ' Z');
    e.setAttribute('fill', BRANCH_COL[b]); e.setAttribute('fill-opacity', '0.07');
    svg.append(e);
  });
  // tier rings
  [1, 2, 3].forEach(t => add2('circle', { cx: 50, cy: 50, r: RING[t] * 100, fill: 'none', stroke: 'rgba(214,220,255,0.08)', 'stroke-width': 2, 'stroke-dasharray': '3 6' }));
  const polar = (a, r) => [50 + Math.cos(a) * r * 100, 50 + Math.sin(a) * r * 100];
  const link = (k, d) => {
    const st8 = techState(k), req = TT.TECHS[k].req, parentOwned = !req || P.techs[req];
    add2('path', { d, fill: 'none', 'stroke-linecap': 'round',
      stroke: st8 === 'owned' ? BRANCH_COL[TECH_BRANCH[k]] : parentOwned ? '#ffe7a3' : 'rgba(214,220,255,0.2)',
      'stroke-width': st8 === 'owned' ? 4.5 : 3, 'stroke-dasharray': parentOwned && st8 !== 'owned' ? '6 6' : 'none' });
  };
  for (const k of TT.TECH_ORDER) {
    const p = L[k], req = TT.TECHS[k].req;
    if (!req) { const [hx, hy] = polar(p.a, 0.075); link(k, 'M' + hx + ' ' + hy + ' L' + p.x + ' ' + p.y); continue; }
    const q = L[req];
    if (Math.abs(q.a - p.a) < 1e-6) link(k, 'M' + q.x + ' ' + q.y + ' L' + p.x + ' ' + p.y);
    else { const [cx, cy] = polar(p.a, (q.r + p.r) / 2 - 0.01); const [sx, sy] = polar(q.a, q.r + 0.03); link(k, 'M' + q.x + ' ' + q.y + ' L' + sx + ' ' + sy + ' Q' + cx + ' ' + cy + ' ' + p.x + ' ' + p.y); }
  }
  g.append(svg);
  // hub: your tribe
  const T0 = TT.tribe(P.tribe);
  g.append(h('div', { class: 'thub', style: '--tc:' + hex(P.color) }, art({ kind: 'unit', type: 'warrior', color: P.color, tribe: P.tribe, pad: 1 }, 62), h('span', null, Object.keys(P.techs).length + '/' + TT.TECH_ORDER.length)));
  for (const k of TT.TECH_ORDER) {
    const p = L[k], Tk = TT.TECHS[k], state = techState(k), cost = TT.techCost(st, human, k), tier = Tk.tier;
    const badge = state === 'owned' ? h('span', { class: 'tbadge ok' }, icon('check')) : state === 'locked' ? h('span', { class: 'tbadge lock' }, icon('lock')) : h('span', { class: 'tbadge' + (state === 'poor' ? ' poor' : '') }, String(cost), icon('star'));
    g.append(h('button', { type: 'button', class: 'tnode t' + tier + ' ' + state + (techSel === k ? ' sel' : ''), 'data-k': k, 'aria-pressed': String(techSel === k),
      style: 'left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%;--bc:' + BRANCH_COL[TECH_BRANCH[k]], title: Tk.name + ': ' + Tk.desc, onclick: () => { techSel = k; renderTech(); } },
      h('span', { class: 'tcirc' }, techArt(k, tier === 1 ? 50 : 40), badge)));
  }
  placeTechLabels(g, L);
  renderTechDetail();
  const st2 = $('#techStars'); st2.innerHTML = ''; st2.append(icon('star'), P.stars + ' to spend');
}
function labelAt(a, text) {
  const c = Math.cos(a), s = Math.sin(a);
  const tx = c > 0.35 ? '0%' : c < -0.35 ? '-100%' : '-50%', ty = s > 0.35 ? '0%' : s < -0.35 ? '-100%' : '-50%';
  return h('span', { class: 'tname', style: 'left:calc(50% + ' + (c * 0.5).toFixed(3) + ' * (var(--n) + 14px));top:calc(50% + ' + (s * 0.5).toFixed(3) + ' * (var(--n) + 14px));transform:translate(' + tx + ',' + ty + ')' }, text);
}
// label layout in container percent units: try spots around each node, keep the one with least overlap
function placeTechLabels(g, L) {
  const NODE_R = { 1: 5.5, 2: 4.3, 3: 4.3 }, FS = { 1: 2.5, 2: 2.1, 3: 2.1 };
  const obst = [{ x0: 43, y0: 43, x1: 57, y1: 57 }];
  for (const k of TT.TECH_ORDER) { const p = L[k], r = NODE_R[TT.TECHS[k].tier] + 0.6; obst.push({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r }); }
  const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const order = TT.TECH_ORDER.slice().sort((a, b) => TT.TECHS[a].tier - TT.TECHS[b].tier);
  for (const k of order) {
    const Tk = TT.TECHS[k], p = L[k], tier = Tk.tier, r = NODE_R[tier], fs = FS[tier];
    const w = Tk.name.length * fs * 0.6 + 1.6, hgt = fs * 1.35, gap = 0.7;
    const cands = [
      [p.x - w / 2, p.y + r + gap], [p.x - w / 2, p.y - r - gap - hgt], [p.x + r + gap, p.y - hgt / 2], [p.x - r - gap - w, p.y - hgt / 2],
      [p.x + r * 0.6, p.y + r * 0.6 + gap], [p.x - r * 0.6 - w, p.y + r * 0.6 + gap], [p.x + r * 0.6, p.y - r * 0.6 - gap - hgt], [p.x - r * 0.6 - w, p.y - r * 0.6 - gap - hgt],
    ];
    let best = null;
    cands.forEach(([x0, y0], ci) => {
      const box = { x0, y0, x1: x0 + w, y1: y0 + hgt };
      let cost = ci * 0.05;
      for (const o of obst) cost += overlap(box, o);
      cost += Math.max(0, -x0) * 10 + Math.max(0, x0 + w - 100) * 10 + Math.max(0, -y0) * 10 + Math.max(0, y0 + hgt - 100) * 10;
      // a label must read as belonging to its own node: penalise spots closer to another node
      const cx = x0 + w / 2, cy = y0 + hgt / 2, own = Math.hypot(cx - p.x, cy - p.y);
      for (const q of TT.TECH_ORDER) { if (q === k) continue; const o = L[q]; if (Math.hypot(cx - o.x, cy - o.y) < own) cost += 6; }
      if (Math.hypot(cx - 50, cy - 50) < own) cost += 6;
      if (!best || cost < best.cost) best = { box, cost };
    });
    obst.push(best.box);
    const state = techState(k);
    g.append(h('span', { class: 'tlabel ' + state + (techSel === k ? ' sel' : '') + (tier === 1 ? ' t1' : ''), style: 'left:' + best.box.x0.toFixed(2) + '%;top:' + best.box.y0.toFixed(2) + '%;font-size:' + fs + 'cqh', onclick: () => { techSel = k; renderTech(); } }, Tk.name));
  }
}
function renderTechDetail() {
  const d = $('#techDetail');
  d.innerHTML = '';
  if (!techSel) { d.append(h('span', { class: 'note' }, 'Tap a technology')); return; }
  const k = techSel, Tk = TT.TECHS[k], state = techState(k), cost = TT.techCost(st, human, k);
  let btn;
  if (state === 'owned') btn = h('span', { class: 'pill ok' }, icon('check'), 'Learned');
  else if (state === 'locked') btn = h('span', { class: 'pill done' }, icon('lock'), 'After ' + TT.TECHS[Tk.req].name);
  else btn = h('button', { class: 'btn primary', type: 'button', disabled: state === 'poor' || !canAct(), onclick: () => act(TT.research(st, k)) }, 'Research · ' + cost + '★');
  d.append(h('span', { class: 'td-art', style: '--bc:' + BRANCH_COL[TECH_BRANCH[k]] }, techArt(k, 52)), h('span', { class: 'td-t' }, h('b', null, Tk.name), h('span', null, Tk.desc)), btn);
}
function drawTechLinks() { /* radial links are drawn in viewBox space; nothing to re-measure */ }

// ---------------------------------------------------------------- siege alerts
let siegeSeen = {}, siegeTimer = 0, siegeCity = null;
function besiegedCities() {
  if (!st || human < 0) return [];
  return st.cities.filter(c => c.owner === human && (() => { const o = TT.unitAt(st, c.x, c.y); return o && o.owner !== human; })());
}
function checkSiege() {
  if (!st || attract || human < 0) { R3.setSiege && R3.setSiege(null); document.body.classList.remove('besieged'); return; }
  const list = besiegedCities();
  R3.setSiege(new Set(list.map(c => c.id)));
  document.body.classList.toggle('besieged', list.length > 0);
  const live = new Set(list.map(c => c.id));
  for (const id in siegeSeen) if (!live.has(+id)) delete siegeSeen[id];
  const fresh = list.find(c => siegeSeen[c.id] !== st.turn && siegeSeen[c.id] == null);
  if (fresh) { siegeSeen[fresh.id] = st.turn; showSiege(fresh, 'siege'); }
}
function showSiege(c, kind) {
  const box = $('#siege');
  const enemy = TT.unitAt(st, c.x, c.y);
  const E = enemy ? st.players[enemy.owner] : null;
  siegeCity = c.id;
  box.className = 'siege ' + kind;
  $('#siegeKicker').textContent = kind === 'lost' ? 'City lost' : 'Under siege';
  $('#siegeCity').textContent = c.name;
  $('#siegeSub').textContent = kind === 'lost' ? 'Retake it before it grows stronger.' : (E ? E.name + ' will capture it next turn' : 'It will be captured next turn') + '. Drive them out!';
  const ic = $('#siegeIcon'); ic.innerHTML = ''; ic.append(enemy ? unitArt(enemy.type, enemy.naval, enemy.owner, 64) : icon('tower'));
  box.hidden = false; box.classList.remove('go'); void box.offsetWidth; box.classList.add('go');
  if (R3.cam) R3.cam.shake = Math.max(R3.cam.shake || 0, 0.35);
  clearTimeout(siegeTimer);
  siegeTimer = setTimeout(hideSiege, kind === 'lost' ? 4200 : (st.current === human ? 6500 : 3600));
}
function hideSiege() { const b = $('#siege'); if (b.hidden) return; b.classList.add('out'); setTimeout(() => { b.hidden = true; b.classList.remove('out'); }, 320); }
function siegeShow() {
  const c = st.cities[siegeCity]; if (!c) return;
  hideSiege(); R3.focus(c.x, c.y);
  const o = TT.unitAt(st, c.x, c.y);
  sel = o ? { kind: 'unit', uid: o.id } : { kind: 'city', cid: c.id };
  refresh();
}

// ---------------------------------------------------------------- rewards
function pendingReward() { return human >= 0 && st.cities.find(c => c.owner === human && c.pending.length); }
function promptRewards() {
  if (human < 0 || st.current !== human || busy) return;
  const c = pendingReward();
  const m = $('#reward');
  if (!c) { m.hidden = true; return; }
  const lvl = c.pending[0];
  m.hidden = false;
  $('#rewardTitle').textContent = c.name + ' reached level ' + lvl;
  const box = $('#rewardOpts');
  box.innerHTML = '';
  TT.rewardOptions(lvl).forEach(k => {
    const R = TT.REWARDS[k];
    box.append(h('button', { type: 'button', class: 'ropt', id: 'reward-' + k, onclick: async () => { m.hidden = true; R3.focus(c.x, c.y); await act(TT.chooseReward(st, c.id, k)); } },
      h('span', { class: 'disc' }, icon(REWARD_ICON[k])), h('b', null, R.name), h('span', null, R.desc)));
  });
  setTimeout(() => { const b = $('#rewardOpts button'); if (b) b.focus(); }, 30);
}

// ---------------------------------------------------------------- game over + score chart
function showGameOver() {
  const m = $('#gameover');
  m.hidden = false;
  const W = st.players[st.over.winner];
  const many = mode === 'online' && !!net;
  const won = many ? st.over.winner === net.seat : localSeats.has(st.over.winner);
  const wl = seatLabel(st.over.winner);
  $('#goCrest').style.setProperty('--tc', hex(W.color));
  $('#goCrest').innerHTML = ''; $('#goCrest').append(art({ kind: 'unit', type: 'swordsman', color: W.color, tribe: W.tribe, pad: 1 }, 64));
  $('#goTitle').textContent = won ? 'Victory' : many || human < 0 ? (wl || W.name) + ' wins' : 'Defeat';
  const wn = wl ? wl + ' (' + W.name + ')' : W.name;
  $('#goSub').textContent = st.over.reason === 'domination' ? wn + ' conquered every rival by turn ' + st.turn + '.' : st.over.reason === 'score' ? wn + ' had the highest score after ' + st.settings.turnLimit + ' turns.' : (many ? 'Every player has fallen. ' : 'Your tribe has fallen. ') + W.name + ' leads the world.';
  scoreChart();
  store.del('save');
  recordResult();
}
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs) { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
function scoreChart() {
  const series = st.players.map(P => ({ P, data: P.scoreHist.slice() }));
  series.forEach(s => s.data.push(TT.score(st, s.P.id)));
  const n = Math.max(...series.map(s => s.data.length));
  const box = $('#goChart'), leg = $('#goLegend'), tbl = $('#goTable');
  box.innerHTML = ''; leg.innerHTML = ''; tbl.innerHTML = '';
  const order = series.slice().sort((a, b) => b.data[b.data.length - 1] - a.data[a.data.length - 1]);
  order.forEach(s => leg.append(h('span', { style: '--tc:' + hex(s.P.color) }, h('i'), s.P.name + (s.P.id === human ? ' (you)' : ''))));
  if (n < 2) { box.append(h('p', { class: 'note' }, 'The game ended before a score history could build up.')); return; }
  const Wd = 720, Ht = 250, ml = 46, mr = 104, mt = 10, mb = 28;
  const maxV = Math.max(10, ...series.flatMap(s => s.data));
  const step = niceStep(maxV / 4), top = Math.ceil(maxV / step) * step;
  const X = i => ml + (n === 1 ? 0 : i / (n - 1) * (Wd - ml - mr));
  const Y = v => mt + (1 - v / top) * (Ht - mt - mb);
  const svg = sv('svg', { viewBox: '0 0 ' + Wd + ' ' + Ht, role: 'img', 'aria-label': 'Score by turn for each tribe. ' + order.map(s => s.P.name + ' ' + s.data[s.data.length - 1]).join(', ') });
  for (let v = 0; v <= top + 1e-6; v += step) {
    svg.append(sv('line', { x1: ml, x2: Wd - mr, y1: Y(v), y2: Y(v), stroke: 'rgba(214,220,255,0.10)', 'stroke-width': 1 }));
    const t = sv('text', { x: ml - 8, y: Y(v) + 4, 'text-anchor': 'end', fill: '#a9abd3', 'font-size': 11, 'font-family': 'Figtree, sans-serif', 'font-weight': 700 }); t.textContent = v.toLocaleString(); svg.append(t);
  }
  const xStep = Math.max(1, Math.ceil(n / 8));
  for (let i = 0; i < n; i += xStep) { const t = sv('text', { x: X(i), y: Ht - 8, 'text-anchor': 'middle', fill: '#a9abd3', 'font-size': 11, 'font-family': 'Figtree, sans-serif', 'font-weight': 700 }); t.textContent = 'T' + (i + 1); svg.append(t); }
  for (const s of series) {
    const d = s.data.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    svg.append(sv('path', { d, fill: 'none', stroke: hex(s.P.color), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const li = s.data.length - 1;
    svg.append(sv('circle', { cx: X(li), cy: Y(s.data[li]), r: 4, fill: hex(s.P.color), stroke: '#191d42', 'stroke-width': 2 }));
  }
  // direct end labels, nudged apart
  const labs = order.map(s => ({ s, y: Y(s.data[s.data.length - 1]), x: X(s.data.length - 1) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < labs.length; k++) if (labs[k].y - labs[k - 1].y < 14) labs[k].y = labs[k - 1].y + 14;
  for (const l of labs) {
    svg.append(sv('line', { x1: l.x + 8, x2: l.x + 18, y1: l.y, y2: l.y, stroke: hex(l.s.P.color), 'stroke-width': 2, 'stroke-linecap': 'round' }));
    const t = sv('text', { x: l.x + 22, y: l.y + 4, fill: '#f4f2ff', 'font-size': 12, 'font-family': 'Figtree, sans-serif', 'font-weight': 800 }); t.textContent = l.s.P.name; svg.append(t);
  }
  const cross = sv('line', { y1: mt, y2: Ht - mb, stroke: 'rgba(244,242,255,0.5)', 'stroke-width': 1, visibility: 'hidden' });
  svg.append(cross);
  const dots = series.map(s => { const c = sv('circle', { r: 5, fill: hex(s.P.color), stroke: '#191d42', 'stroke-width': 2, visibility: 'hidden' }); svg.append(c); return c; });
  const hit = sv('rect', { x: ml, y: 0, width: Wd - ml - mr, height: Ht, fill: 'transparent', tabindex: 0 });
  svg.append(hit);
  box.append(svg);
  const tip = h('div', { class: 'tip', hidden: true });
  box.append(tip);
  const showAt = i => {
    i = Math.max(0, Math.min(n - 1, i));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => { const v = s.data[Math.min(i, s.data.length - 1)]; dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(v)); dots[k].setAttribute('visibility', 'visible'); });
    tip.innerHTML = '';
    tip.append(h('span', { class: 't' }, 'Turn ' + (i + 1)));
    series.map(s => ({ s, v: s.data[Math.min(i, s.data.length - 1)] })).sort((a, b) => b.v - a.v)
      .forEach(({ s, v }) => tip.append(h('span', { class: 'r', style: '--tc:' + hex(s.P.color) }, h('i'), h('b', null, v.toLocaleString()), h('span', null, s.P.name))));
    tip.hidden = false;
    const r = box.getBoundingClientRect(), px = X(i) / Wd * r.width;
    tip.style.transform = 'translate(' + Math.min(r.width - 150, px + 12) + 'px, 8px)';
    hit.dataset.i = i;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); };
  hit.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(); const vx = (e.clientX - r.left) / r.width * Wd; showAt(Math.round((vx - ml) / (Wd - ml - mr) * (n - 1))); });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => showAt(n - 1));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', e => { const i = +(hit.dataset.i || n - 1); if (e.key === 'ArrowLeft') { e.preventDefault(); showAt(i - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); showAt(i + 1); } });
  // table view
  const t = h('table', { class: 'ctable' }, h('thead', null, h('tr', null, h('th', null, 'Turn'), order.map(s => h('th', null, s.P.name)))),
    h('tbody', null, Array.from({ length: n }, (_, i) => h('tr', null, h('td', null, String(i + 1)), order.map(s => h('td', null, (s.data[Math.min(i, s.data.length - 1)]).toLocaleString()))))));
  tbl.append(t);
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------- banners, toasts, log
function showAIStrip(kind) {
  const strip = $('#aiStrip');
  const P = st.players[st.current];
  strip.hidden = false;
  strip.classList.toggle('remote', kind === 'remote');
  const order = $('#aiOrder');
  order.innerHTML = '';
  st.players.forEach(Q => { if (!Q.alive) return; order.append(h('i', { class: Q.id === st.current ? 'now' : Q.id < st.current ? 'done' : '', style: '--tc:' + hex(Q.color), title: Q.name })); });
  const lbl = seatLabel(st.current);
  $('#aiName').textContent = lbl ? lbl + ' · ' + P.name : P.name;
  $('#aiVerb').textContent = kind === 'remote' ? 'is playing' : 'is moving';
}
function showTurnBanner(title, sub) {
  const b = $('#turnBanner');
  $('#tbTitle').textContent = title; $('#tbSub').textContent = sub;
  b.hidden = false; b.classList.remove('go'); void b.offsetWidth; b.classList.add('go');
  clearTimeout(showTurnBanner.t);
  showTurnBanner.t = setTimeout(() => { b.hidden = true; }, 2000);
}
function toast(msg, color) {
  const box = $('#toasts');
  const t = h('div', { class: 'toast glass', style: color != null ? '--tc:' + hex(color) : null }, h('span', { class: 'chip' }), h('span', null, msg));
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 4200);
}
function flushLog() {
  if (!st) return;
  if (lastLog > st.log.length) lastLog = 0;
  for (; lastLog < st.log.length; lastLog++) {
    const L = st.log[lastLog];
    if (attract) continue;
    if (human >= 0 && L.pid >= 0 && L.pid !== human && !/captured|fallen|unleashed|storm|Wild growth/.test(L.msg)) continue;
    toast(L.msg, L.pid >= 0 ? st.players[L.pid].color : null);
  }
}

// ---------------------------------------------------------------- input
function bindInput() {
  const cv = $('#stage');
  const pts = new Map();
  let drag = null, pinch = null, hoverI = -1;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, moved: false, rot: e.button === 2 || e.button === 1 || e.shiftKey };
    else if (pts.size === 2) {
      const [a, b] = Array.from(pts.values());
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2 };
      if (drag) drag.moved = true;
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const i = R3.pick(e.clientX, e.clientY); if (i !== hoverI) { hoverI = i; R3.setHover(attract ? -1 : i); previewPath(i); } showForecast(i, e.clientX, e.clientY); }
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2 && pinch) {
      const [a, b] = Array.from(pts.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
      R3.zoom(pinch.d / Math.max(1, d), (a.x + b.x) / 2, my);
      R3.pan((a.x + b.x) / 2 - (pinch.mx == null ? (a.x + b.x) / 2 : pinch.mx), my - pinch.my);
      pinch = { d, ang, my, mx: (a.x + b.x) / 2 };
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (drag.moved) R3.pan(dx, dy);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  cv.addEventListener('pointerup', e => {
    const was = drag;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (was && !was.moved && was.btn === 0) {
        const cu = canAct() ? R3.pickClaim(e.clientX, e.clientY) : null;
        const u = cu != null ? TT.getUnit(st, cu) : null;
        if (u && TT.canCapture(st, u)) { sel = { kind: 'unit', uid: u.id }; act(TT.capture(st, u.id)); }
        else onTileClick(R3.pick(e.clientX, e.clientY));
      }
      drag = null;
    }
  });
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); drag = null; pinch = null; });
  cv.addEventListener('pointerleave', () => { if (!pts.size) { R3.setHover(-1); hideForecast(); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); R3.zoom(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  // minimap
  const mini = $('#mini');
  let miniDown = false;
  const miniGo = e => { if (!st) return; const r = mini.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) / r.width * st.W), y = Math.floor((e.clientY - r.top) / r.height * st.H); if (x >= 0 && y >= 0 && x < st.W && y < st.H) R3.focus(x, y); };
  mini.addEventListener('pointerdown', e => { miniDown = true; mini.setPointerCapture(e.pointerId); miniGo(e); });
  mini.addEventListener('pointermove', e => { if (miniDown) miniGo(e); });
  mini.addEventListener('pointerup', () => { miniDown = false; });
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    if (k === 'Escape') {
      for (const id of ['#tech', '#codex', '#pause', '#scores']) if (!$(id).hidden) { $(id).hidden = true; updateHint(); return; }
      if (sel) { sel = null; armed = null; refresh(); return; }
      if (st && !attract && $('#menu').hidden) openPause();
      return;
    }
    if (!st || attract || !$('#menu').hidden || !$('#reward').hidden) return;
    const step = 40;
    if (k === 'Enter' && e.target === document.body) { e.preventDefault(); endTurn(); }
    else if (k === 't' || k === 'T') { if ($('#tech').hidden) showTech(); else $('#tech').hidden = true; }
    else if (k === 'n' || k === 'N') selectNextUnit();
    else if (k === 'c' || k === 'C') centerHome();
    else if (k === 'f' || k === 'F') R3.fit();
    else if (k === 'w' || k === 'W' || k === 'ArrowUp') R3.pan(0, step);
    else if (k === 's' || k === 'S' || k === 'ArrowDown') R3.pan(0, -step);
    else if (k === 'a' || k === 'A' || k === 'ArrowLeft') R3.pan(step, 0);
    else if (k === 'd' || k === 'D' || k === 'ArrowRight') R3.pan(-step, 0);
    else if (k === '+' || k === '=') R3.zoom(0.85);
    else if (k === '-' || k === '_') R3.zoom(1.18);
    else if (k === 'p' || k === 'P') usePower();
    else if (k === '?' || k === 'h' || k === 'H') openCodex();
  });
}
function showForecast(i, cx, cy) {
  const f = $('#forecast');
  if (!st || attract || i < 0 || !sel || sel.kind !== 'unit' || !canAct()) { f.hidden = true; return; }
  const u = TT.getUnit(st, sel.uid);
  if (!u || u.owner !== human) { f.hidden = true; return; }
  const e = TT.unitAt(st, i % st.W, (i / st.W) | 0);
  if (!e || e.owner === human || TT.attackTargets(st, u).indexOf(e) < 0) { f.hidden = true; return; }
  const S = TT.stats(st, u);
  f.innerHTML = '';
  if (TT.has(S, 'convert')) f.append(h('div', { class: 'row' }, h('span', { class: 'big kill' }, 'Convert'), h('small', null, TT.unitName(e))));
  else {
    const r = TT.combat(st, u, e);
    f.append(h('div', { class: 'row' }, h('span', { class: 'big' + (r.killed ? ' kill' : '') }, r.killed ? 'Destroy' : '−' + r.dmg), h('small', null, TT.unitName(e) + ' · ' + e.hp + ' HP')));
    if (!r.killed) f.append(h('small', null, r.counter ? 'Counterattack −' + r.counter + (r.counterKills ? ' (fatal)' : '') : 'No counterattack'));
    if (r.high) f.append(h('small', { class: 'hg' }, 'High ground +25%'));
  }
  f.hidden = false;
  f.style.transform = 'translate(' + (cx + 16) + 'px,' + (cy + 12) + 'px)';
}
function hideForecast() { $('#forecast').hidden = true; }
function previewPath(i) {
  if (!st || attract || i < 0 || !sel || sel.kind !== 'unit' || sel.spent || !canAct()) { R3.setPath(null); return; }
  const u = TT.getUnit(st, sel.uid);
  if (!u || u.owner !== human || !u.canMove) { R3.setPath(null); return; }
  const R = TT.reach(st, u), n = R.get(i);
  if (!n || n.occ || i === u.y * st.W + u.x) { R3.setPath(null); return; }
  R3.setPath(TT.pathTo(st, R, i));
}

// ---------------------------------------------------------------- buttons
function centerHome() {
  if (!st) return;
  const pid = human >= 0 ? human : st.current;
  const c = st.cities.find(k => k.owner === pid && k.capital) || st.cities.find(k => k.owner === pid);
  if (c) { R3.focus(c.x, c.y); R3.setZoom(Math.max(R3.cam.tz, 64)); }
}
function usePower() { if (!canAct()) return; const ev = TT.usePower(st); if (ev) act(ev); }
function openPause() { $('#pause').hidden = false; $('#speedSel').value = prefs.speed; $('#followChk').checked = prefs.follow; $('#hintsChk').checked = prefs.hints; $('#pauseResume').focus(); updateHint(); }
function openScores() {
  if (!st || attract) return;
  $('#scores').hidden = false;
  const known = P => human < 0 || P.id === human || st.cities.some(c => c.owner === P.id && st.players[human].explored[c.y * st.W + c.x]) || st.units.some(u => u.owner === P.id && st.players[human].explored[u.y * st.W + u.x]);
  const cols = st.players.map(P => ({ P, b: TT.scoreBreakdown(st, P.id), k: known(P) })).sort((a, b) => b.b.total - a.b.total);
  const head = h('tr', null, h('th', null, 'Points from'), cols.map(c => h('th', { class: c.P.id === human ? 'me' : '', style: '--tc:' + hex(c.k ? c.P.color : 0x7d7f9f) }, h('span', { class: 'th-t' }, h('i'), c.k ? c.P.name : 'Unknown'))));
  const rows = TT.SCORE_PARTS.map(part => h('tr', null, h('td', null, h('b', null, part.name), h('small', null, part.rule)), cols.map(c => h('td', { class: 'num' + (c.P.id === human ? ' me' : '') }, c.k ? c.b[part.key].toLocaleString() : '?'))));
  const total = h('tr', { class: 'total' }, h('td', null, h('b', null, 'Total')), cols.map((c, k) => h('td', { class: 'num' + (c.P.id === human ? ' me' : '') }, c.P.alive ? c.b.total.toLocaleString() : 'Fallen', h('small', null, c.P.alive ? ordinal(k + 1) : ''))));
  const tb = $('#scoresTable'); tb.innerHTML = '';
  tb.append(h('table', { class: 'ctable scoretable' }, h('thead', null, head), h('tbody', null, rows, total)));
  const me = cols.findIndex(c => c.P.id === human);
  $('#scoresSub').textContent = human >= 0 ? 'You are ' + ordinal(me + 1) + ' of ' + cols.filter(c => c.P.alive).length + ' on turn ' + st.turn + '.' : 'Turn ' + st.turn;
  $('#scoresClose').focus();
}
function openCodex() { $('#codex').hidden = false; renderCodex(); $('#codexClose').focus(); }
function bindUI() {
  $('#btnEnd').addEventListener('click', endTurn);
  $('#rbScoreWrap').addEventListener('click', openScores);
  $('#scoresClose').addEventListener('click', () => { $('#scores').hidden = true; updateHint(); });
  $('#hint').addEventListener('click', () => { if (curHint) satisfy(curHint.key, true); });
  $('#siegeShow').addEventListener('click', siegeShow);
  $('#siegeX').addEventListener('click', hideSiege);
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, noteInteraction, { capture: true, passive: true }));
  window.addEventListener('resize', () => { if (!$('#tech').hidden) drawTechLinks(); });
  $('#hintsChk').addEventListener('change', e => { prefs.hints = e.target.checked; if (prefs.hints) prefs.hintCounts = {}; savePrefs(); if (!prefs.hints) hideHint(); });
  $('#btnNext').addEventListener('click', selectNextUnit);
  $('#btnTech').addEventListener('click', showTech);
  $('#techClose').addEventListener('click', () => { $('#tech').hidden = true; updateHint(); });
  $('#btnPower').addEventListener('click', usePower);
  $('#btnMenu').addEventListener('click', openPause);
  $('#btnRail').addEventListener('click', () => { $('#rail').classList.toggle('open'); miniSig = ''; drawMiniBase(); });
  $('#btnPause').addEventListener('click', () => { paused = !paused; refreshLight(); });
  $('#pauseResume').addEventListener('click', () => { $('#pause').hidden = true; updateHint(); });
  $('#pauseCodex').addEventListener('click', () => { $('#pause').hidden = true; openCodex(); });
  $('#pauseQuit').addEventListener('click', () => { $('#pause').hidden = true; save(); token++; busy = false; leaveOnline(); showMenu(); });
  $('#lbCopy').addEventListener('click', () => { const v = $('#lbLink').value; navigator.clipboard.writeText(v).then(() => toast('Invite link copied.'), () => { $('#lbLink').select(); toast('Select and copy the link.'); }); });
  $('#lbLeave').addEventListener('click', () => { const L = lobby; closeLobby(); if (L) ON.leaveRoom(L.id).catch(() => {}); clearRoomUrl(); showMenu(); });
  $('#lbStart').addEventListener('click', async () => { const L = lobby; if (!L) return; try { await ON.startRoom(L.id); refreshLobby(L); } catch (e) { toast(e.message); } });
  bindSearch($('#lbFind'), $('#lbFound'), lobbyInviteBtn);
  $('#pfClose').addEventListener('click', () => { $('#profile').hidden = true; });
  $('#speedSel').addEventListener('change', e => { prefs.speed = e.target.value; savePrefs(); R3.setOptions({ speed: SPEED[prefs.speed] }); });
  $('#followChk').addEventListener('change', e => { prefs.follow = e.target.checked; R3.follow = prefs.follow; savePrefs(); });
  $('#codexClose').addEventListener('click', () => { $('#codex').hidden = true; });
  $('#btnHelpMenu').addEventListener('click', openCodex);
  $('#goNew').addEventListener('click', () => { $('#gameover').hidden = true; token++; showMenu(); });
  $('#goWatch').addEventListener('click', () => { $('#gameover').hidden = true; R3.setViewer(-1); });
  $('#camIn').addEventListener('click', () => R3.zoom(0.8));
  $('#camOut').addEventListener('click', () => R3.zoom(1.25));
  $('#camHome').addEventListener('click', centerHome);
  $('#camFit').addEventListener('click', () => R3.fit());
  document.addEventListener('click', e => { if (e.target.classList && e.target.classList.contains('modal') && !e.target.classList.contains('locked')) e.target.hidden = true; });
}

// debug / automation hook
G.__tessera = { get state() { return st; }, get R3() { return R3; }, get human() { return human; }, get busy() { return busy; }, get canAct() { return !!st && canAct(); }, get mode() { return mode; }, get netBase() { return net ? net.base : -1; }, get pending() { return net ? net.outbox.length : 0; }, get room() { return net ? net.id : null; }, get lobby() { return lobby ? lobby.id : null; }, get searching() { return !!search; }, get lastRecord() { return lastRecord; }, get onlineOK() { return onlineOK; }, netStats, online: TT.Online, click: onTileClick, endTurn, showTech, selectNextUnit, newGame, prefs, act, setup: () => setup, select: s => { sel = s; refresh(); }, openProfile, startSearch, stopSearch, createRoom, joinByCode, enterOnline };

// ---------------------------------------------------------------- online play (Supabase): Google accounts, matching, invites, rooms
// Every device replays the same move log from the same seed, so the server only stores and orders moves.
const ON = TT.Online;
let onlineOK = false, lobby = null, search = null, lastRecord = null, myRooms = [], invites = [];
const clearRoomUrl = () => { try { history.replaceState(null, '', location.pathname); } catch (e) { /* sandboxed */ } };
const roomUrl = code => { try { history.replaceState(null, '', location.pathname + '?room=' + code); } catch (e) { /* sandboxed */ } };

async function onlineBoot() {
  if (!ON.available()) return;
  try { await ON.init(); onlineOK = true; } catch (e) { console.error(e); return; }
  ON.on('auth', () => { refreshOnlineHome(); loadInvites(); });
  ON.on('presence', () => { document.querySelectorAll('[data-uid]').forEach(markOnline); const c = $('#onCount'); if (c) c.textContent = ON.online.size > 1 ? ON.online.size + ' players online' : ''; });
  ON.on('invite', () => loadInvites());
  ON.on('match', roomId => { if (search) matchFound(roomId); });
  setInterval(() => { if (search) updateMatchStatus(); }, 1000);
  setInterval(() => { if (ON.profile && !(mode === 'online' && net && st && !st.over)) loadInvites(); }, 20000);   // in case realtime is down
  refreshOnlineHome();
  loadInvites();
  const code = new URLSearchParams(location.search).get('room');
  if (code) {
    setup.playMode = 'online';
    if (ON.profile) joinByCode(code);
    else { store.set('pendingRoom', code.toUpperCase()); refreshOnlineHome(); toast((ON.user ? 'Pick a player name' : 'Sign in') + ' to join room ' + code.toUpperCase() + '.'); }
  }
}
async function refreshOnlineHome() {
  myRooms = [];
  if (ON.profile) { try { myRooms = await ON.myRooms(); } catch (e) { myRooms = []; } }
  if (!$('#menu').hidden) { if (menuRefs.online) menuRefs.online._sig = ''; syncMenu(); }
}
function avatarOf(tribe, size) {
  const T0 = TT.tribe(tribe) || TT.TRIBES[0];
  return h('span', { class: 'pav', style: '--tc:' + hex(T0.color) + ';width:' + size + 'px;height:' + size + 'px' }, art({ kind: 'unit', type: 'warrior', color: T0.color, tribe: T0.id, pad: 1 }, size));
}
function googleMark() {
  const w = document.createElement('span');
  w.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l8-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';
  return w.firstChild;
}

// title-screen online panel; redrawn only when the account, rooms or search state change (keeps typing intact)
function renderOnlinePanel(el) {
  const sig = [onlineOK, ON.user && ON.user.id, ON.profile && ON.profile.username + ON.profile.avatar_tribe, myRooms.map(r => r.id + r.status).join(','), !!search, setup.matchSize].join('|');
  if (el._sig === sig) { updateMatchStatus(); return; }
  el._sig = sig;
  el.innerHTML = '';
  menuRefs.matchStatus = null;
  if (!ON.user) {
    el.append(h('div', { class: 'oncard' }, h('p', null, 'Play people on other devices, keep a record of every game, and find friends by name.'),
      h('button', { class: 'gbtn', id: 'btnGoogle', type: 'button', onclick: () => ON.signInGoogle(store.get('pendingRoom', '')).catch(e => toast(e.message)) }, googleMark(), 'Sign in with Google')));
    return;
  }
  if (!ON.profile) {
    const meta = ON.user.user_metadata || {};
    const guess = String(meta.name || meta.full_name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
    const inp = h('input', { id: 'onName', maxlength: '16', placeholder: 'Player name', autocomplete: 'nickname', value: guess.length >= 3 ? guess : '' });
    const save = async () => {
      try {
        await ON.claimUsername(inp.value.trim(), setup.tribe);
        toast('Welcome, ' + ON.profile.username + '!');
        const pend = store.get('pendingRoom', '');
        if (pend) { store.del('pendingRoom'); joinByCode(pend); }
      } catch (e) { toast(e.message); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    el.append(h('div', { class: 'oncard' }, h('label', { class: 'lbl', for: 'onName' }, 'Pick a player name'),
      h('div', { class: 'onrow' }, inp, h('button', { class: 'btn primary', id: 'btnClaim', type: 'button', onclick: save }, 'Save')),
      h('p', { class: 'note' }, '3 to 16 letters, digits or _. Friends find you by this name.'),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => ON.signOut() }, 'Use another Google account')));
    return;
  }
  const P = ON.profile, on = (P.totals && P.totals.online) || { games: 0, wins: 0 };
  el.append(h('div', { class: 'merow' },
    h('button', { class: 'mechip', id: 'btnProfile', type: 'button', onclick: () => openProfile(null) }, avatarOf(P.avatar_tribe, 40), h('span', { class: 'mc-t' }, h('b', null, P.username), h('small', null, on.wins + (on.wins === 1 ? ' win · ' : ' wins · ') + on.games + ' online games'))),
    h('span', { class: 'onlinecount', id: 'onCount' }, ON.online.size > 1 ? ON.online.size + ' players online' : '')));
  const size = setup.matchSize || 2;
  menuRefs.matchStatus = h('div', { class: 'matchst', id: 'matchStatus', hidden: true });
  el.append(h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Quick match'), h('span', { class: 'rowval' }, 'Random opponents · 30 turns')),
    h('div', { class: 'modeseg three', role: 'radiogroup', 'aria-label': 'Players in the match' }, [[2, '1 v 1'], [3, '3 players'], [4, '4 players']].map(([k, nm]) =>
      h('button', { type: 'button', role: 'radio', class: 'mseg' + (k === size ? ' on' : ''), 'aria-checked': String(k === size), id: 'msize-' + k, disabled: !!search, onclick: () => { setup.matchSize = k; saveSetup(); syncMenu(); } }, nm))),
    menuRefs.matchStatus));
  const found = h('ul', { class: 'plist', id: 'onResults' });
  const q = h('input', { id: 'onSearch', type: 'search', placeholder: 'Find a player by name', autocomplete: 'off', maxlength: '16', 'aria-label': 'Find a player by name' });
  bindSearch(q, found, p => h('button', { class: 'btn', type: 'button', onclick: () => inviteToNewRoom(p) }, icon('mail'), 'Invite'));
  const code = h('input', { id: 'onCode', maxlength: '8', placeholder: 'Room code', autocomplete: 'off', class: 'code', 'aria-label': 'Room code' });
  code.addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(code.value); });
  el.append(h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Play with friends')), q, found,
    h('div', { class: 'onrow' }, code, h('button', { class: 'btn', id: 'btnJoin', type: 'button', onclick: () => joinByCode(code.value) }, 'Join'))));
  if (myRooms.length) el.append(h('div', { class: 'row' }, h('div', { class: 'rowh' }, h('span', { class: 'lbl' }, 'Your games')),
    h('ul', { class: 'plist', id: 'myRooms' }, myRooms.map(r => h('li', null,
      h('span', { class: 'pl-t' }, h('b', null, r.status === 'playing' ? (r.kind === 'match' ? 'Match in progress' : 'Game in progress') : 'Room ' + r.code), h('small', null, (r.players || []).map(p => p.username).join(', '))),
      h('span'), h('button', { class: 'btn', type: 'button', onclick: () => (r.status === 'playing' ? enterOnline(r.id) : openLobby(r.id)) }, r.status === 'playing' ? 'Rejoin' : 'Open'))))));
  updateMatchStatus();
}
function playerRow(p, action) {
  const li = h('li', { 'data-uid': p.id },
    h('button', { class: 'pl-who', type: 'button', onclick: () => openProfile(p.username) }, avatarOf(p.avatar_tribe, 34), h('span', { class: 'pl-t' }, h('b', null, p.username), h('small', null, (p.wins || 0) + ' wins · ' + (p.games || 0) + ' games'))),
    h('span', { class: 'dot' }), action || h('span'));
  markOnline(li);
  return li;
}
function markOnline(li) {
  const d = li.querySelector('.dot');
  if (!d) return;
  const s = ON.online.get(li.dataset.uid);
  d.classList.toggle('on', !!s);
  d.textContent = s ? (s.status === 'playing' ? 'In a game' : s.status === 'searching' ? 'Searching' : 'Online') : '';
  d.title = s ? d.textContent : 'Offline';
}
function bindSearch(input, list, actionFor) {
  let t = 0, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) { seq++; list.innerHTML = ''; return; }
    t = setTimeout(async () => {
      const my = ++seq;
      try {
        const rows = await ON.searchPlayers(q);
        if (my !== seq) return;
        list.innerHTML = '';
        if (!rows.length) list.append(h('li', { class: 'empty' }, 'Nobody called “' + q + '” yet.'));
        rows.forEach(p => list.append(playerRow(p, actionFor(p))));
      } catch (e) { if (my === seq) { list.innerHTML = ''; list.append(h('li', { class: 'empty' }, e.message)); } }
    }, 250);
  });
}

// ---- quick match
function startSearch() {
  if (!ON.profile || search) return;
  search = { size: setup.matchSize || 2, since: Date.now(), timer: 0, allowBots: false, busy: false, waiting: 1 };
  ON.setStatus('searching');
  syncMenu();
  pollMatch();
}
async function pollMatch() {
  const s = search;
  if (!s) return;
  clearTimeout(s.timer);
  if (!s.busy) {
    s.busy = true;
    try {
      const r = await ON.findMatch(s.size, setup.tribe, s.allowBots);
      if (r && r.room_id) { if (search === s) matchFound(r.room_id); else { toast('A match was found just as you cancelled.'); enterOnline(r.room_id); } return; }
      s.waiting = (r && r.waiting) || 1;
    } catch (e) { s.busy = false; toast(e.message); stopSearch(); return; }
    s.busy = false;
  }
  if (search !== s) return;
  updateMatchStatus();
  s.timer = setTimeout(pollMatch, 4000);   // also a heartbeat: the server only matches people who checked in recently
}
function matchFound(roomId) {
  const s = search;
  if (s) { clearTimeout(s.timer); search = null; }
  toast('Match found!');
  enterOnline(roomId);
}
async function stopSearch() {
  const s = search;
  if (!s) return;
  search = null;
  clearTimeout(s.timer);
  ON.setStatus('menu');
  if (!$('#menu').hidden) syncMenu();
  try { await ON.cancelMatch(); } catch (e) { /* offline: the server forgets searchers after 15 seconds */ }
}
function updateMatchStatus() {
  const el = menuRefs.matchStatus;
  if (!el) return;
  el.hidden = !search;
  if (!search) return;
  const s = search, secs = Math.floor((Date.now() - s.since) / 1000), need = s.size - (s.waiting || 1);
  el.innerHTML = '';
  el.append(h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, (need > 0 ? 'Looking for ' + need + ' more player' + (need > 1 ? 's' : '') : 'Starting…') + ' · ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')));
  if (s.size > 2 && (s.waiting || 1) >= 2 && secs >= 20 && !s.allowBots) el.append(h('button', { class: 'btn', type: 'button', id: 'btnBotsNow', onclick: () => { s.allowBots = true; pollMatch(); } }, 'Start now with bots'));
}

// ---- private rooms
const roomSettings = () => ({ opponents: setup.opponents, size: setup.size, mapType: setup.mapType, difficulty: setup.difficulty, mode: setup.mode, relief: setup.relief, fog: setup.fog, events: setup.events, dayCycle: setup.dayCycle });
async function createRoom(invitee) {
  if (!ON.profile) return;
  if (search) await stopSearch();
  try {
    const r = await ON.createRoom(roomSettings(), setup.tribe);
    if (invitee) { try { await ON.invite(r.room_id, invitee.id); toast('Invited ' + invitee.username + '.'); } catch (e) { toast(e.message); } }
    openLobby(r.room_id);
  } catch (e) { toast(e.message); }
}
function inviteToNewRoom(p) {
  if (lobby) { ON.invite(lobby.id, p.id).then(() => { toast('Invited ' + p.username + '.'); refreshLobby(lobby); }, e => toast(e.message)); return; }
  createRoom(p);
}
async function joinByCode(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) { toast('Enter the room code from your invite.'); return; }
  if (!ON.profile) { store.set('pendingRoom', code); setup.playMode = 'online'; if (!$('#menu').hidden) syncMenu(); toast((ON.user ? 'Pick a player name' : 'Sign in') + ' to join room ' + code + '.'); return; }
  try { const r = await ON.joinRoom(code, setup.tribe); if (r.rejoined) enterOnline(r.room_id); else openLobby(r.room_id); }
  catch (e) { toast(e.message); clearRoomUrl(); }
}
function openLobby(roomId) {
  closeLobby();
  $('#menu').hidden = true;
  $('#lobby').hidden = false;
  $('#lbFind').value = ''; $('#lbFound').innerHTML = ''; $('#lbMsg').textContent = '';
  const L = lobby = { id: roomId, info: null, unwatch: null, timer: 0 };
  L.unwatch = ON.watchRoom(roomId, { seats: () => refreshLobby(L), room: () => refreshLobby(L) });
  ON.setStatus('menu');
  refreshLobby(L);
}
async function refreshLobby(L) {
  if (!L || lobby !== L) return;
  clearTimeout(L.timer);
  try {
    const info = await ON.roomInfo(L.id);
    if (lobby !== L) return;
    L.info = info;
    if (info.room.status === 'playing') { closeLobby(); enterOnline(L.id); return; }
    if (info.room.status !== 'lobby') { closeLobby(); clearRoomUrl(); toast('That room was closed.'); showMenu(); return; }
    if (!info.players.some(p => p.user_id === ON.user.id)) { closeLobby(); clearRoomUrl(); toast('You are no longer in that room.'); showMenu(); return; }
    renderLobby(L);
  } catch (e) { $('#lbMsg').textContent = e.message; }
  L.timer = setTimeout(() => refreshLobby(L), 5000);   // realtime usually gets here first
}
function closeLobby() {
  const L = lobby;
  if (!L) return;
  lobby = null;
  clearTimeout(L.timer);
  if (L.unwatch) L.unwatch();
  $('#lobby').hidden = true;
}
function renderLobby(L) {
  const room = L.info.room, players = L.info.players, pend = L.info.invites || [];
  const me = players.find(p => p.user_id === ON.user.id), host = room.host === ON.user.id;
  $('#lbCode').textContent = room.code;
  $('#lbLink').value = location.origin + location.pathname + '?room=' + room.code;
  roomUrl(room.code);
  const seats = $('#lbSeats');
  seats.innerHTML = '';
  for (let s = 0; s < room.seat_count; s++) {
    const p = players.find(x => x.seat === s), T0 = p ? TT.tribe(p.tribe) : null;
    seats.append(h('li', { class: (p ? 'on' : 'open') + (p && p.user_id === ON.user.id ? ' me' : ''), style: '--tc:' + hex(T0 ? T0.color : 0x5a5d8a), 'data-uid': p ? p.user_id : null },
      h('span', { class: 'sav' }, T0 ? art({ kind: 'unit', type: 'warrior', color: T0.color, tribe: T0.id, pad: 1 }, 40) : icon('plus')),
      h('span', { class: 'snm' }, p ? p.username : 'Open seat', h('small', null, p ? T0.name + (p.user_id === room.host ? ' · host' : '') + (p.user_id === ON.user.id ? ' · you' : '') : 'A bot plays this seat unless someone joins')),
      p ? h('span', { class: 'dot' }) : h('span')));
  }
  seats.querySelectorAll('[data-uid]').forEach(markOnline);
  if (pend.length) seats.append(h('li', { class: 'pend' }, h('span', { class: 'sav' }, icon('mail')), h('span', { class: 'snm' }, 'Invited', h('small', null, pend.map(i => i.username).join(', '))), h('span')));
  const taken = new Set(players.filter(p => p.user_id !== ON.user.id).map(p => p.tribe));
  const pick = $('#lbTribes');
  pick.innerHTML = '';
  TT.TRIBES.forEach(t => pick.append(h('button', { type: 'button', class: 'opt av-opt' + (me && me.tribe === t.id ? ' on' : ''), disabled: taken.has(t.id), style: '--tc:' + hex(t.color), 'aria-label': t.name,
    onclick: async () => { try { await ON.setTribe(room.id, t.id); setup.tribe = t.id; saveSetup(); refreshLobby(L); } catch (e) { toast(e.message); } } },
    h('span', { class: 'av-c' }, art({ kind: 'unit', type: 'warrior', color: t.color, tribe: t.id, pad: 1 }, 40)), h('span', { class: 'opt-n' }, t.name))));
  renderLobbySettings(L, host);
  const people = players.length, open = room.seat_count - people;
  $('#lbSub').textContent = people + (people === 1 ? ' player' : ' players') + (open ? ' · ' + open + ' open seat' + (open > 1 ? 's' : '') : '');
  $('#lbStart').hidden = !host;
  $('#lbStart').textContent = open ? 'Start (' + open + ' bot' + (open > 1 ? 's' : '') + ')' : 'Start game';
  $('#lbMsg').textContent = host ? 'Invite players by name or share the link. Start when everyone is in.' : 'Waiting for ' + (room.host_name || 'the host') + ' to start…';
}
function renderLobbySettings(L, host) {
  const s = L.info.room.settings, box = $('#lbSettings');
  box.innerHTML = '';
  if (!host) { box.append(h('div', { class: 'lbl' }, 'World'), h('p', { class: 'note' }, TT.MAP_TYPES[s.mapType].name + ' · ' + cap(s.size) + ' · ' + (s.mode === 'score' ? '30-turn score' : 'Domination') + ' · ' + TT.DIFFICULTY[s.difficulty].name + ' bots')); return; }
  const upd = async patch => { try { await ON.updateRoom(L.id, Object.assign({}, s, patch)); } catch (e) { toast(e.message); } refreshLobby(L); };
  const sel = (id, label, opts, val, apply) => h('label', { class: 'lbsel' }, h('span', { class: 'lbl' }, label), h('select', { id, onchange: e => apply(e.target.value) }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(val) }, t))));
  const minSeats = Math.max(2, ...L.info.players.map(p => p.seat + 1));
  box.append(h('div', { class: 'lbl' }, 'World'), h('div', { class: 'lbsets' },
    sel('lbMap', 'Map', Object.keys(TT.MAP_TYPES).map(k => [k, TT.MAP_TYPES[k].name]), s.mapType, v => upd({ mapType: v })),
    sel('lbSize', 'Size', Object.keys(TT.MAP_SIZES).map(k => [k, cap(k)]), s.size, v => upd({ size: v })),
    sel('lbSeatsN', 'Seats', [2, 3, 4, 5, 6].filter(n => n >= minSeats).map(n => [n - 1, n + ' seats']), s.opponents, v => upd({ opponents: +v })),
    sel('lbBots', 'Bots', Object.keys(TT.DIFFICULTY).map(k => [k, TT.DIFFICULTY[k].name]), s.difficulty, v => upd({ difficulty: v })),
    sel('lbMode', 'Victory', [['domination', 'Domination'], ['score', '30-turn score']], s.mode, v => upd({ mode: v }))));
}
function lobbyInviteBtn(p) {
  const b = h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (!lobby) return;
    b.disabled = true;
    try { await ON.invite(lobby.id, p.id); b.textContent = 'Invited'; refreshLobby(lobby); } catch (e) { b.disabled = false; toast(e.message); }
  } }, icon('mail'), 'Invite');
  return b;
}

// ---- invitations (arrive in real time, shown wherever you are)
async function loadInvites() {
  invites = [];
  if (ON.profile) { try { invites = await ON.myInvites(); } catch (e) { invites = []; } }
  renderInviteBar();
}
function renderInviteBar() {
  const bar = $('#inviteBar'), inv = invites.find(i => !lobby || i.room_id !== lobby.id);
  if (!inv) { bar.hidden = true; return; }
  bar.innerHTML = '';
  bar.append(avatarOf(inv.from_tribe, 40), h('span', { class: 'ib-t' }, h('b', null, inv.from + ' invited you'), h('small', null, inv.taken + ' of ' + inv.seats + ' seats taken · ' + ((TT.MAP_TYPES[inv.settings.mapType] || {}).name || ''))),
    h('button', { class: 'btn primary', id: 'ibJoin', type: 'button', onclick: () => acceptInvite(inv) }, 'Join'),
    h('button', { class: 'btn ghost', id: 'ibNo', type: 'button', onclick: () => declineInvite(inv) }, 'Decline'));
  bar.hidden = false;
}
async function acceptInvite(inv) {
  if (mode === 'online' && net && st && !st.over) { toast('Finish or leave this game first.'); return; }
  try {
    const r = await ON.respondInvite(inv.id, true, setup.tribe);
    invites = invites.filter(i => i.id !== inv.id);
    renderInviteBar();
    if (search) await stopSearch();
    if (st && !attract && mode === 'solo') save();
    token++; busy = false;
    openLobby(r.room_id);
  } catch (e) { toast(e.message); loadInvites(); }
}
function declineInvite(inv) {
  invites = invites.filter(i => i.id !== inv.id);
  renderInviteBar();
  ON.respondInvite(inv.id, false).catch(() => {});
}

// ---- profiles and the leaderboard
async function openProfile(username) {
  const b = $('#pfBody');
  $('#profile').hidden = false;
  b.innerHTML = '';
  b.append(h('p', { class: 'note' }, 'Loading…'));
  let P = null;
  try { P = username ? await ON.profileOf(username) : await ON.reloadProfile(); }
  catch (e) { b.innerHTML = ''; b.append(h('p', { class: 'note' }, e.message)); return; }
  if (!P) { b.innerHTML = ''; b.append(h('p', { class: 'note' }, 'No player with that name.')); return; }
  renderProfile(P);
}
function renderProfile(P) {
  const b = $('#pfBody');
  b.innerHTML = '';
  const tot = k => Object.assign({ games: 0, wins: 0, best: 0, left: 0 }, P.totals && P.totals[k]);
  const on = tot('online'), so = tot('solo');
  const pct = (w, g) => (g ? Math.round(w / g * 100) + '% won' : 'no games yet');
  const tile = (label, big, small) => h('div', { class: 'pf-tile' }, h('span', { class: 'lbl' }, label), h('b', null, String(big)), h('small', null, small));
  b.append(h('div', { class: 'pf-head' }, avatarOf(P.avatar_tribe, 64), h('div', null, h('h2', { id: 'pfTitle' }, P.username), h('span', { class: 'note' }, 'Playing since ' + new Date(P.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })))));
  b.append(h('div', { class: 'pf-tiles' },
    tile('Online wins', on.wins, on.games + ' games · ' + pct(on.wins, on.games)),
    tile('Wins vs bots', so.wins, so.games + ' games · ' + pct(so.wins, so.games)),
    tile('Best score', Math.max(on.best || 0, so.best || 0) || '–', on.left ? on.left + ' online games left early' : 'any game')));
  const grid = h('div', { class: 'pf-tribes' });
  TT.TRIBES.forEach(t => {
    const rows = (P.tribes || []).filter(x => x.tribe === t.id), g = rows.reduce((a, x) => a + x.games, 0), w = rows.reduce((a, x) => a + x.wins, 0);
    const onl = rows.find(x => x.kind === 'online') || { games: 0, wins: 0 };
    grid.append(h('div', { class: 'pf-tribe' + (g ? '' : ' none'), style: '--tc:' + hex(t.color), title: t.name + ': ' + w + ' wins in ' + g + ' games, ' + onl.wins + ' of ' + onl.games + ' online' },
      avatarOf(t.id, 38), h('b', null, t.name), h('span', null, g ? w + (w === 1 ? ' win' : ' wins') + ' / ' + g : 'Not played'), h('i', { class: 'bar' }, h('i', { style: 'width:' + (g ? w / g * 100 : 0) + '%' }))));
  });
  b.append(h('div', { class: 'lbl' }, 'Victories by tribe'), grid);
  const list = h('ul', { class: 'pf-recent' });
  if (!(P.recent || []).length) list.append(h('li', { class: 'empty' }, 'No games recorded yet.'));
  (P.recent || []).forEach(r => {
    const opp = (r.opponents || []).map(o => o.username || ((TT.tribe(o.tribe) || {}).name || 'A') + ' bot');
    list.append(h('li', null, h('span', { class: 'res ' + (r.left_game ? 'left' : r.won ? 'win' : 'loss') }, r.left_game ? 'Left' : r.won ? 'Win' : '#' + r.place),
      avatarOf(r.tribe, 30),
      h('span', { class: 'pf-g' }, h('b', null, (r.kind === 'online' ? 'Online' : 'Vs bots') + ' · ' + r.seats + ' tribes' + (r.kind === 'solo' && TT.DIFFICULTY[r.difficulty] ? ' · ' + TT.DIFFICULTY[r.difficulty].name : '')), h('small', null, 'vs ' + opp.join(', '))),
      h('span', { class: 'pf-s' }, h('b', null, String(r.score)), h('small', null, 'turn ' + r.turns + ' · ' + new Date(r.ended_at).toLocaleDateString()))));
  });
  b.append(h('div', { class: 'lbl' }, 'Recent games'), list);
  if (P.me) {
    b.append(h('div', { class: 'lbl' }, 'Avatar'), h('div', { class: 'strip' }, TT.TRIBES.map(t => h('button', { type: 'button', class: 'opt av-opt' + (t.id === P.avatar_tribe ? ' on' : ''), style: '--tc:' + hex(t.color), 'aria-label': 'Avatar: ' + t.name,
      onclick: async () => { try { renderProfile(await ON.setAvatar(t.id)); refreshOnlineHome(); } catch (e) { toast(e.message); } } }, h('span', { class: 'av-c' }, art({ kind: 'unit', type: 'warrior', color: t.color, tribe: t.id, pad: 1 }, 40)), h('span', { class: 'opt-n' }, t.name)))));
    b.append(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'pfBoard', onclick: openBoard }, icon('trophy'), 'Leaderboard'),
      h('button', { class: 'btn ghost', type: 'button', id: 'pfOut', onclick: async () => { $('#profile').hidden = true; if (search) await stopSearch(); await ON.signOut(); toast('Signed out.'); } }, icon('logout'), 'Sign out')));
  } else {
    b.append(h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', id: 'pfInvite', onclick: () => { $('#profile').hidden = true; inviteToNewRoom({ id: P.id, username: P.username }); } }, icon('mail'), 'Invite to a game'),
      h('button', { class: 'btn', type: 'button', onclick: openBoard }, icon('trophy'), 'Leaderboard')));
  }
}
async function openBoard() {
  const b = $('#pfBody');
  b.innerHTML = '';
  b.append(h('p', { class: 'note' }, 'Loading…'));
  try {
    const L = await ON.leaderboard();
    b.innerHTML = '';
    const row = (i, u, big, small) => h('li', null, h('span', { class: 'rk' }, String(i + 1)), avatarOf(u.avatar_tribe, 30), h('button', { class: 'pl-name', type: 'button', onclick: () => openProfile(u.username) }, u.username), h('span', { class: 'pf-s' }, h('b', null, String(big)), h('small', null, small)));
    b.append(h('h2', { id: 'pfTitle' }, 'Leaderboard'),
      h('div', { class: 'lbl' }, 'Most online wins'), h('ol', { class: 'pf-board' }, L.online.length ? L.online.map((u, i) => row(i, u, u.wins, u.games + ' games')) : h('li', { class: 'empty' }, 'No online games yet.')),
      h('div', { class: 'lbl' }, 'Best scores vs bots'), h('ol', { class: 'pf-board' }, L.solo.length ? L.solo.map((u, i) => row(i, u, u.best, ((TT.tribe(u.tribe) || {}).name || '') + ' · ' + ((TT.DIFFICULTY[u.difficulty] || {}).name || ''))) : h('li', { class: 'empty' }, 'No games against bots yet.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => openProfile(null) }, 'My profile')));
  } catch (e) { b.innerHTML = ''; b.append(h('p', { class: 'note' }, e.message)); }
}

// ---- the game itself: replay the shared log, then follow it live
function makeNet(room, seat, players) { return { id: room.id, code: room.code, seat, players, final: room.final, base: 0, outbox: [], applying: false, chain: Promise.resolve(), sysq: [], forceBots: false, lastProgress: performance.now(), wake: null, dirty: false, unwatch: null, ff: false }; }
const wakeNet = n => { if (!n) return; n.dirty = true; if (n.wake) { const w = n.wake; n.wake = null; w(); } };
async function pushEntries(n, base, entries) {
  const r = await ON.pushMoves(n.id, base, entries);
  if (r.conflict) { const e = new Error('Another move arrived first.'); e.status = 409; e.len = r.len; throw e; }
  return r.len;
}
async function enterOnline(roomId) {
  closeLobby();
  if (search) { clearTimeout(search.timer); search = null; }
  try {
    const info = await ON.roomInfo(roomId);
    const R = info.room, me = info.players.find(p => p.user_id === ON.user.id);
    if (!me) { toast('You are not in that game.'); return; }
    if (R.status === 'lobby') { openLobby(roomId); return; }
    const moves = await ON.getMoves(roomId, 0);
    const s0 = TT.newGame(R.final);
    for (const e of moves) applyEntryInstant(s0, e);
    const n = makeNet(R, me.seat, info.players);
    n.base = moves.length;
    startOnline(s0, n);
  } catch (e) { toast(e.message); clearRoomUrl(); if ($('#menu').hidden && !st) showMenu(); }
}
function startOnline(s0, n) {
  if (net && net.unwatch) net.unwatch();
  const seats = new Set(!s0.players[n.seat].isAI ? [n.seat] : []);
  roomUrl(n.code);
  $('#inviteBar').hidden = true;
  startWith(s0, { mode: 'online', localSeats: seats, net: n });
  n.unwatch = ON.watchRoom(n.id, { move: () => wakeNet(n) });
  ON.setStatus('playing');
}
function applyEntryInstant(s, e) {
  if (e.sys) { s.players[e.seat].isAI = e.sys === 'botify'; return; }
  for (const c of e.cmds) if (!TT.exec(s, c)) throw new Error('log replay failed');
}
async function applyEntryLive(e) {
  const s0 = st, n = net;
  if (e.sys) {
    const P = s0.players[e.seat], bot = e.sys === 'botify', pl = n && n.players.find(p => p.seat === e.seat), who = (pl && pl.username) || P.name;
    if (P.isAI === bot) return;
    P.isAI = bot;
    if (n && e.seat === n.seat) {
      if (bot) { localSeats.delete(e.seat); toast('A bot took over your tribe while you were away. Tap “Take back my tribe” to return.'); }
      else { localSeats.add(e.seat); human = e.seat; R3.setViewer(e.seat); miniSig = ''; document.body.classList.remove('spectating'); toast('Welcome back. Your tribe is yours again.'); }
    } else toast(who + (bot ? ' left. A bot plays their tribe now.' : ' is back.'));
    renderRail();
    return;
  }
  n.applying = true;
  try {
    for (const c of e.cmds) {
      if (st !== s0) return;   // a resync replaced the game mid-entry; the rebuilt state already has this move
      const evs = TT.exec(s0, c);
      if (!evs) throw new Error('a move from another player could not be applied');
      await R3.play(evs);
      if (st !== s0) return;
      noteLosses(evs);
      refreshLight();
    }
  } finally { n.applying = false; }
  netStats.applied++;
  if (e.h && TT.hash(s0) !== e.h) throw new Error('game state drifted');
}
// Wait for other players' moves. This loop is the only place that applies remote entries or sends seat changes
// (take back my tribe, hand a stalled seat to a bot), so those never race the replay.
async function netWait(my) {
  if (!net) { await sleep(300); return; }
  const n = net, take = $('#aiTake');
  const live = () => my === token && net === n;
  for (;;) {
    if (!live()) return;
    if (n.forceBots && st.players[st.current].isAI) return;   // drive() runs this bot turn
    let got = 0;
    n.dirty = false;
    try {
      const from = n.base, log = await ON.getMoves(n.id, from);
      if (!live()) return;
      const len = from + log.length;
      // a requested seat change goes in right after what we just fetched (one round trip of race window, so it
      // can't starve while others keep moving); a stalled player who moved meanwhile keeps their seat
      let mine = null;
      while (n.sysq.length && !mine) {
        const q = n.sysq[0], P = st.players[q.seat];
        if (P.isAI === (q.sys === 'botify') || !P.alive || (q.sys === 'botify' && log.some(e => !e.sys && e.seat === q.seat))) { n.sysq.shift(); continue; }
        try {
          const nl = await pushEntries(n, len, [{ seat: q.seat, sys: q.sys, cmds: [], h: '' }]);
          if (!live()) return;
          n.sysq.shift(); mine = { e: q, len: nl };
        } catch (er) { if (!live()) return; if (er.status !== 409) { n.sysq.shift(); toast(er.message); } break; }   // 409: retry after the next fetch
      }
      for (let i = 0; i < log.length; i++) {
        const e = log[i];
        if (from + i < n.base) continue;
        if (e.dev !== ON.dev) {
          // more than a couple of entries behind (bots ran fast, or the tab was asleep): skip animations to catch up
          const ff = log.length - i - 1 > 1;
          if (ff !== !!n.ff) { n.ff = ff; R3.setOptions({ instant: ff }); }
          await applyEntryLive(e);
          if (!live()) return;
          if (!e.sys) n.forceBots = false;
        }
        n.base = from + i + 1; got++;
      }
      if (mine) { await applyEntryLive(mine.e); if (!live()) return; n.base = mine.len; got++; }
    } catch (e) {
      if (!live()) return;
      if (n.ff) { n.ff = false; R3.setOptions({ instant: false }); }
      if (/drifted|could not be applied/.test(e.message)) { await netResync('Out of sync (' + e.message + ').'); return; }
      // network hiccup: keep waiting
    }
    if (n.ff) { n.ff = false; R3.setOptions({ instant: false }); }
    if (got) { n.lastProgress = performance.now(); take.hidden = true; renderRail(); return; }
    const idle = performance.now() - n.lastProgress, P = st.players[st.current], M = st.players[n.seat];
    if (n.sysq.length || n.forceBots) take.hidden = true;
    else if (M.isAI && M.alive) { take.hidden = false; take.textContent = 'Take back my tribe'; take.onclick = () => { take.hidden = true; n.sysq.push({ seat: n.seat, sys: 'human' }); wakeNet(n); }; }
    else if (P.isAI && idle > 25000) { take.hidden = false; take.textContent = 'Run the bots'; take.onclick = () => { take.hidden = true; n.forceBots = true; wakeNet(n); }; }
    else if (!P.isAI && idle > (n.seat === 0 ? 60000 : 90000)) { const seat = st.current; take.hidden = false; take.textContent = 'Give this turn to a bot'; take.onclick = () => { take.hidden = true; n.sysq.push({ seat, sys: 'botify' }); wakeNet(n); }; }
    // realtime wakes us the moment a move lands; the timeout is the fallback when the socket is down
    if (!n.dirty && !n.sysq.length && !n.forceBots) await Promise.race([new Promise(r => { n.wake = r; }), sleep(4000)]);
    n.wake = null;
  }
}
// After a conflict while pushing our own moves: 'done' if our entry had in fact landed, 'retry' if only seat changes
// slipped in first, false for a real conflict (someone else moved) that needs a resync.
async function catchUp(n, seat, entry) {
  const from = n.base, log = await ON.getMoves(n.id, from);
  if (net !== n) return null;
  const own = log.filter(e => !e.sys && e.dev === ON.dev);
  if (own.length && log.every(e => e.sys || e.dev === ON.dev) && entry && JSON.stringify(own[own.length - 1].cmds) === JSON.stringify(entry.cmds)) {
    for (const e of log) if (e.sys) await applyEntryLive(e);
    n.base = from + log.length;
    return 'done';
  }
  if (log.some(e => !e.sys || e.seat === seat)) return false;
  for (const e of log) await applyEntryLive(e);
  n.base = from + log.length;
  // someone took their seat back and now runs this bot turn: let them
  if (st.players[seat].isAI && !n.forceBots && !localSeats.has(botRunner(seat))) return false;
  return 'retry';
}
// send our recorded moves; on a conflict, rebuild from the shared log
function netFlush(seat) {
  if (!net || !net.outbox.length) return net ? net.chain : Promise.resolve();
  const entry = { seat, cmds: net.outbox.splice(0), h: TT.hash(st) };
  const n = net;
  n.chain = n.chain.then(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (net !== n) return;
      try { n.base = await pushEntries(n, n.base, [entry]); n.lastProgress = performance.now(); netStats.pushed++; return; }
      catch (e) {
        if (net !== n) return;
        if (e.status === 409) {
          netStats.conflicts++;
          const c = await catchUp(n, seat, entry).catch(() => null);
          if (c === 'done') { netStats.pushed++; return; }
          if (c === 'retry') continue;
          if (c === false) { await netResync('Another move arrived first.'); return; }
        }
        await sleep(800 * (attempt + 1));   // network trouble: if the push landed anyway, the retry sees a conflict and catches up
      }
    }
    toast('Could not reach the game. Reconnecting…');
    await netResync('Connection lost.');
  });
  return n.chain;
}
async function netResync(reason) {
  if (!net) return;
  const n = net;
  token++; netStats.resyncs++;
  toast(reason + ' Resyncing…');
  try {
    const info = await ON.roomInfo(n.id);
    const moves = await ON.getMoves(n.id, 0);
    if (net !== n) return;
    const s0 = TT.newGame(info.room.final);
    for (const e of moves) applyEntryInstant(s0, e);
    const n2 = makeNet(info.room, n.seat, info.players);
    n2.base = moves.length;
    startOnline(s0, n2);
  } catch (e) { toast('Resync failed: ' + e.message); setTimeout(() => { if (net === n) netResync('Retrying.'); }, 4000); }
}
// leaving on purpose hands your tribe to a bot right away, so the others don't wait
function leaveOnline() {
  const n = net;
  if (n) {
    if (st && !st.over && localSeats.has(n.seat) && st.players[n.seat].alive) {
      const send = base => ON.pushMoves(n.id, base, [{ seat: n.seat, sys: 'botify', cmds: [], h: '' }]).then(r => { if (r.conflict && r.len > base) return send(r.len); }).catch(() => {});
      n.chain.then(() => send(n.base));
    }
    if (n.unwatch) n.unwatch();
  }
  net = null;
  closeLobby();
  if (onlineOK) { ON.setStatus('menu'); refreshOnlineHome(); }
  clearRoomUrl();
}
// game over: the server replays the game and writes everyone's record; solo games too, when signed in
async function recordResult() {
  const box = $('#goRecord');
  box.hidden = true; box.innerHTML = ''; lastRecord = null;
  if (!onlineOK || human < 0 && mode !== 'online') return;
  let job = null;
  if (mode === 'online' && net) job = () => ON.finishOnline(net.id);
  else if (mode === 'solo' && soloRec) {
    if (!ON.profile) { box.hidden = false; box.append(h('span', null, h('b', null, 'Keep a record of your games'), h('small', null, 'Sign in from the title screen (Online) before your next game.'))); return; }
    const rec = soloRec;
    job = () => ON.recordSolo(rec.init, rec.log);
  }
  if (!job) return;
  box.hidden = false; box.textContent = 'Recording the result…';
  try { showRecord(await job()); }
  catch (e) { box.textContent = 'The result could not be recorded: ' + e.message; }
}
function showRecord(r) {
  lastRecord = r;
  const box = $('#goRecord'), rows = r.results || [];
  const mine = rows.find(x => x.user_id === (ON.user && ON.user.id)) || (mode === 'solo' ? rows[0] : null);
  box.innerHTML = '';
  if (!mine) { box.hidden = true; return; }
  box.append(avatarOf(mine.tribe, 34), h('span', null, h('b', null, (mine.won ? 'Win' : mine.left_game ? 'Left early' : 'Place ' + mine.place) + ' recorded to your profile'), h('small', null, (TT.tribe(mine.tribe) || {}).name + ' · score ' + mine.score)),
    h('button', { class: 'btn', type: 'button', id: 'goProfile', onclick: () => openProfile(null) }, 'Profile'));
  box.hidden = false;
  ON.reloadProfile().then(() => refreshOnlineHome()).catch(() => {});
}

// ---------------------------------------------------------------- codex
function renderCodex() {
  const b = $('#codexBody');
  if (b.dataset.done) return;
  b.dataset.done = '1';
  const units = h('table', { class: 'ctable' }, h('thead', null, h('tr', null, ['Unit', 'Cost', 'Atk', 'Def', 'Move', 'Range', 'HP', 'Skills', 'Unlocked by'].map(t => h('th', null, t)))),
    h('tbody', null, Object.keys(TT.UNITS).map(k => { const U = TT.UNITS[k]; return h('tr', null, h('td', null, h('span', { class: 'cu' }, art({ kind: 'unit', type: k, color: 0x4fb84a, tribe: 'verdant' }, 30), U.name)), h('td', null, U.super ? 'Reward' : U.cost + '★'), h('td', null, String(U.atk)), h('td', null, String(U.def)), h('td', null, String(U.move)), h('td', null, String(U.range)), h('td', null, String(U.hp)), h('td', null, U.skills.join(', ')), h('td', null, U.tech ? TT.TECHS[U.tech].name : U.super ? 'City level 5' : 'Start')); }),
      Object.keys(TT.NAVAL).map(k => { const U = TT.NAVAL[k]; return h('tr', { class: 'naval' }, h('td', null, h('span', { class: 'cu' }, art({ kind: 'unit', type: 'warrior', naval: k, color: 0x22b3c9, tribe: 'tidecallers' }, 30), U.name)), h('td', null, U.cost ? U.cost + '★' : 'Port'), h('td', null, String(U.atk)), h('td', null, String(U.def)), h('td', null, String(U.move)), h('td', null, String(U.range)), h('td', null, 'carried'), h('td', null, U.skills.join(', ')), h('td', null, TT.TECHS[U.tech].name)); })));
  const skills = h('dl', { class: 'glossary' }, Object.keys(TT.SKILLS).map(k => [h('dt', null, k), h('dd', null, TT.SKILLS[k])]));
  const tribes = h('dl', { class: 'glossary' }, TT.TRIBES.map(t => [h('dt', { style: '--tc:' + hex(t.color) }, h('i'), t.name), h('dd', null, t.passive + ' Power, ' + t.powerName + ': ' + t.powerDesc)]));
  const kb = (keys, what) => h('span', null, keys.map(k => h('kbd', null, k)), what);
  b.append(
    h('h3', null, 'How a turn works'),
    h('p', null, 'Each turn your cities pay stars. Spend them on technology, on harvesting resources inside your borders (which grows your cities), and on training units. Each unit can move once and attack once per turn. Move a unit onto a village or enemy city, then capture it at the start of your next turn.'),
    h('h3', null, 'Combat'),
    h('p', null, 'Damage depends on attack versus defense, scaled by remaining health. Defenders in forests (with Archery), on mountains (with Climbing) or fortified in their own cities get defense bonuses. Attacking downhill adds 25% attack, and ranged units on mountains reach one tile further. Survivors in range strike back. Hover a target to see the forecast before you commit.'),
    h('h3', null, 'Units'), h('div', { class: 'tablewrap' }, units),
    h('h3', null, 'Skills'), skills,
    h('h3', null, 'Tribes'), tribes,
    h('h3', null, 'World events'),
    h('p', null, 'With weather on, storms drift across the map: units under a storm lose a tile of movement and boats take damage. Wild growth spawns fresh resources. Night falls every few turns.'),
    h('h3', null, 'Controls'),
    h('p', null, 'Drag to pan. Scroll or pinch to zoom. Click the minimap to jump. Units that have used up their turn turn grey; units that can still act stand on a pulsing ring.'),
    h('div', { class: 'keys' }, kb(['Enter'], 'End turn'), kb(['N'], 'Next unit'), kb(['T'], 'Technology'), kb(['P'], 'Tribe power'), kb(['W', 'A', 'S', 'D'], 'Pan'), kb(['C'], 'Center on capital'), kb(['F'], 'Fit map'), kb(['Esc'], 'Close or menu')));
}

})(window);
