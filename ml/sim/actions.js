// The model's action space: every rule-changing engine call as a typed tuple.
//
//   (actor, verb, *args)
//
//   actor  "<unit type>#<unit id>"  e.g. "giant#12"     one of my units
//          "city#<city id>"         e.g. "city#3"       one of my cities
//          "tribe"                                      the tribe as a whole
//   pos    (x, y)                   board coordinates, 0-based, x = column, y = row
//
// A turn is a list of tuples, executed in order, ending with ("tribe", "end_turn"):
//   [("giant#12", "move", (5, 7)),
//    ("archer#4", "attack", (6, 7)),
//    ("tribe", "build", "farm", (4, 5)),
//    ("tribe", "end_turn")]
//
// The verbs are exhaustive: each engine action in TT.ACTIONS maps to exactly one verb (attack splits into
// attack/convert), so anything a player can do in the game can be written down, and nothing else can.
'use strict';
const TT = require('./tt');

const VOCAB = {
  unit: TT.UNIT_ORDER.slice(),
  naval: ['ship', 'battleship'],
  reward: Object.keys(TT.REWARDS),
  build: Object.keys(TT.BUILD),
  tech: TT.TECH_ORDER.slice(),
};

// args: 'pos' = (x, y); otherwise a key of VOCAB
const VERBS = {
  move:       { actor: 'unit',  args: ['pos'],          engine: 'move',         desc: 'Move the unit to an empty tile it can reach this turn.' },
  attack:     { actor: 'unit',  args: ['pos'],          engine: 'attack',       desc: 'Attack the enemy unit standing at pos (in range, visible).' },
  convert:    { actor: 'unit',  args: ['pos'],          engine: 'attack',       desc: 'Mind Bender: take control of the enemy unit at pos.' },
  capture:    { actor: 'unit',  args: [],               engine: 'capture',      desc: 'Capture or found the city or village the unit stands on.' },
  examine:    { actor: 'unit',  args: [],               engine: 'examine',      desc: 'Examine the ruins the unit stands on (Polytopia rules).' },
  recover:    { actor: 'unit',  args: [],               engine: 'recover',      desc: 'Skip the unit\'s turn to heal (4 HP at home, 2 HP away).' },
  heal:       { actor: 'unit',  args: [],               engine: 'healOthers',   desc: 'Heal every adjacent injured ally by up to 4 HP.' },
  disband:    { actor: 'unit',  args: [],               engine: 'disband',      desc: 'Remove the unit and refund half its cost.' },
  upgrade:    { actor: 'unit',  args: ['naval'],        engine: 'upgrade',      desc: 'Upgrade an embarked unit\'s vessel to a ship or battleship.' },
  infiltrate: { actor: 'unit',  args: [],               engine: 'infiltrate',   desc: 'Cloak: sneak into an adjacent enemy city to steal stars.' },
  train:      { actor: 'city',  args: ['unit'],         engine: 'train',        desc: 'Train a unit in the city.' },
  reward:     { actor: 'city',  args: ['reward'],       engine: 'chooseReward', desc: 'Pick the city\'s pending level-up reward.' },
  walls:      { actor: 'city',  args: [],               engine: 'buildWalls',   desc: 'Build city walls.' },
  embassy:    { actor: 'city',  args: [],               engine: 'buildEmbassy', desc: 'Build an embassy in the capital.' },
  build:      { actor: 'tribe', args: ['build', 'pos'], engine: 'build',        desc: 'Build or harvest on a tile inside my borders.' },
  research:   { actor: 'tribe', args: ['tech'],         engine: 'research',     desc: 'Research a technology.' },
  power:      { actor: 'tribe', args: [],               engine: 'usePower',     desc: 'Unleash the tribe power.' },
  end_turn:   { actor: 'tribe', args: [],               engine: 'endTurn',      desc: 'End the turn. Always the last tuple.' },
};
// verbs the active ruleset allows (Polytopia has no tribe powers, walls for sale, embassies or cloaks)
const ENABLED = new Set(TT.RULESET.verbs || Object.keys(VERBS).filter(v => v !== 'examine'));
for (const v of Object.keys(VERBS)) if (!ENABLED.has(v)) delete VERBS[v];
const END = ['tribe', 'end_turn'];

const unitRef = u => u.type + '#' + u.id;
const cityRef = cid => 'city#' + cid;
const canConvert = (st, u) => TT.has(TT.stats(st, u), 'convert');

// ---------------------------------------------------------------- engine command -> tuple
// Must be called on the state *before* the command runs (attack targets may die, units move).
function fromCommand(st, name, a) {
  const U = id => TT.getUnit(st, id);
  switch (name) {
    case 'move': return [unitRef(U(a[0])), 'move', [a[1], a[2]]];
    case 'attack': { const u = U(a[0]), d = U(a[1]); return [unitRef(u), canConvert(st, u) ? 'convert' : 'attack', [d.x, d.y]]; }
    case 'capture': return [unitRef(U(a[0])), 'capture'];
    case 'examine': return [unitRef(U(a[0])), 'examine'];
    case 'recover': return [unitRef(U(a[0])), 'recover'];
    case 'healOthers': return [unitRef(U(a[0])), 'heal'];
    case 'disband': return [unitRef(U(a[0])), 'disband'];
    case 'upgrade': return [unitRef(U(a[0])), 'upgrade', a[1]];
    case 'infiltrate': return [unitRef(U(a[0])), 'infiltrate'];
    case 'train': return [cityRef(a[0]), 'train', a[1]];
    case 'chooseReward': return [cityRef(a[0]), 'reward', a[1]];
    case 'buildWalls': return [cityRef(a[0]), 'walls'];
    case 'buildEmbassy': return [cityRef(a[0]), 'embassy'];
    case 'build': return ['tribe', 'build', a[2], [a[0], a[1]]];
    case 'research': return ['tribe', 'research', a[0]];
    case 'usePower': return ['tribe', 'power'];
    case 'endTurn': return END.slice();
  }
  throw new Error('unknown engine action ' + name);
}

// ---------------------------------------------------------------- text
const q = s => '"' + s + '"';
function formatTuple(t, actorPrefix) {
  const parts = t.map((v, i) => Array.isArray(v) ? '(' + v[0] + ', ' + v[1] + ')' : typeof v === 'number' ? String(v) : q(i === 0 && actorPrefix ? actorPrefix + v : v));
  return '(' + parts.join(', ') + ')';
}
function formatList(ts, actorPrefix) {
  if (!ts.length) return '[]';
  return '[' + ts.map(t => formatTuple(t, actorPrefix)).join(',\n ') + ']';
}
// one line, for history entries
function formatInline(ts, actorPrefix) { return '[' + ts.map(t => formatTuple(t, actorPrefix)).join(', ') + ']'; }

// Strict parser for a list of tuples. Strings may use ' or ", ints may be signed, nesting is one level ((x, y)).
// Returns { actions, error, complete }: on a syntax error the tuples parsed so far are kept (error says where).
function parse(text) {
  let i = 0;
  const s = String(text);
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const err = m => { const e = new Error(m); e.at = i; throw e; };
  function value(nested) {
    ws();
    const c = s[i];
    if (c === '"' || c === "'") {
      const j = s.indexOf(c, i + 1);
      if (j < 0) err('unterminated string');
      const v = s.slice(i + 1, j);
      if (/[\n\\]/.test(v)) err('bad string');
      i = j + 1; return v;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?\d+/.exec(s.slice(i, i + 12));
      if (!m) err('bad number');
      i += m[0].length; return Number(m[0]);
    }
    if (c === '(' && !nested) return tuple(true);
    err('unexpected ' + (c === undefined ? 'end' : JSON.stringify(c)));
  }
  function tuple(nested) {
    ws();
    if (s[i] !== '(') err('expected (');
    i++;
    const out = [];
    ws();
    if (s[i] === ')') { i++; return out; }
    for (;;) {
      out.push(value(nested));
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === ')') { i++; return out; } continue; }
      if (s[i] === ')') { i++; return out; }
      err('expected , or )');
    }
  }
  const actions = [];
  try {
    ws();
    if (s[i] !== '[') err('expected [');
    i++;
    ws();
    if (s[i] === ']') { i++; return { actions, error: null, complete: true, rest: s.slice(i).trim() }; }
    for (;;) {
      actions.push(tuple(false));
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === ']') { i++; break; } continue; }
      if (s[i] === ']') { i++; break; }
      err('expected , or ]');
    }
    return { actions, error: null, complete: true, rest: s.slice(i).trim() };
  } catch (e) {
    if (e.at == null) throw e;
    return { actions, error: e.message + ' at char ' + e.at, complete: false, rest: '' };
  }
}

// ---------------------------------------------------------------- tuple -> engine
// Checks the tuple's shape and the actor's ownership, then runs the engine call, which enforces every game rule.
// Returns { ok, err, end, evs }. end = the tuple was end_turn (the caller ends the turn).
function validShape(t) {
  if (!Array.isArray(t) || t.length < 2 || typeof t[0] !== 'string' || typeof t[1] !== 'string') return 'shape';
  const V = VERBS[t[1]];
  if (!V) return 'unknown_verb';
  if (t.length - 2 !== V.args.length) return 'arity';
  for (let k = 0; k < V.args.length; k++) {
    const kind = V.args[k], v = t[2 + k];
    if (kind === 'pos') { if (!Array.isArray(v) || v.length !== 2 || !Number.isInteger(v[0]) || !Number.isInteger(v[1])) return 'bad_pos'; }
    else if (VOCAB[kind].indexOf(v) < 0) return 'bad_' + kind;
  }
  return null;
}

function execute(st, pid, t) {
  const fail = err => ({ ok: false, err, end: false, evs: null });
  const bad = validShape(t);
  if (bad) return fail(bad);
  if (st.over) return fail('game_over');
  if (st.current !== pid) return fail('not_your_turn');
  const verb = t[1], V = VERBS[verb], actor = t[0];
  let u = null, c = null;
  if (V.actor === 'unit') {
    const m = /^([a-z]+)#(\d+)$/.exec(actor);
    if (!m) return fail('bad_actor');
    u = TT.getUnit(st, Number(m[2]));
    if (!u) return fail('no_unit');
    if (u.owner !== pid) return fail('not_owner');
    if (u.type !== m[1]) return fail('wrong_unit_type');
  } else if (V.actor === 'city') {
    const m = /^city#(\d+)$/.exec(actor);
    if (!m) return fail('bad_actor');
    c = st.cities[Number(m[1])];
    if (!c) return fail('no_city');
    if (c.owner !== pid) return fail('not_owner');
  } else if (actor !== 'tribe') return fail('bad_actor');
  if (verb === 'end_turn') return { ok: true, err: null, end: true, evs: [] };
  const inB = p => TT.inB(st, p[0], p[1]);
  let evs = null;
  switch (verb) {
    case 'move': if (!inB(t[2])) return fail('off_board'); evs = TT.move(st, u.id, t[2][0], t[2][1]); break;
    case 'attack': case 'convert': {
      if (!inB(t[2])) return fail('off_board');
      const d = TT.unitAt(st, t[2][0], t[2][1]);
      if (!d) return fail('no_target');
      if (d.owner === pid) return fail('friendly_target');
      if ((verb === 'convert') !== canConvert(st, u)) return fail('wrong_verb');
      evs = TT.attack(st, u.id, d.id); break;
    }
    case 'capture': evs = TT.capture(st, u.id); break;
    case 'examine': evs = TT.examine(st, u.id); break;
    case 'recover': evs = TT.recover(st, u.id); break;
    case 'heal': evs = TT.healOthers(st, u.id); break;
    case 'disband': evs = TT.disband(st, u.id); break;
    case 'upgrade': evs = TT.upgrade(st, u.id, t[2]); break;
    case 'infiltrate': evs = TT.infiltrate(st, u.id); break;
    case 'train': evs = TT.train(st, c.id, t[2]); break;
    case 'reward': evs = TT.chooseReward(st, c.id, t[2]); break;
    case 'walls': evs = TT.buildWalls(st, c.id); break;
    case 'embassy': evs = TT.buildEmbassy(st, c.id); break;
    case 'build': if (!inB(t[3])) return fail('off_board'); evs = TT.build(st, t[3][0], t[3][1], t[2]); break;
    case 'research': evs = TT.research(st, t[2]); break;
    case 'power': evs = TT.usePower(st); break;
  }
  return evs ? { ok: true, err: null, end: false, evs } : fail('illegal');
}

// ---------------------------------------------------------------- tuple <-> PolyCommand
// PolyCommand: the same action as a JSON object, for whatever executes it in a real Polytopia client (ml/bridge).
//   {type:'move', unit, unit_type, to:[x,y]}   {type:'attack'|'convert', unit, unit_type, target:[x,y]}
//   {type:'capture'|'examine'|'recover'|'heal_others'|'disband'|'infiltrate', unit, unit_type}
//   {type:'upgrade', unit, unit_type, to:'ship'|'battleship'}   {type:'train', city, unit_type}
//   {type:'city_reward', city, reward}   {type:'walls'|'embassy', city}   {type:'build', at:[x,y], building}
//   {type:'research', tech}   {type:'power'}   {type:'end_turn'}
const CMD_TYPE = { heal: 'heal_others', reward: 'city_reward' };
const VERB_OF = { heal_others: 'heal', city_reward: 'reward' };
function toCommand(t) {
  const bad = validShape(t);
  if (bad) return { error: bad };
  const verb = t[1], V = VERBS[verb], c = { type: CMD_TYPE[verb] || verb };
  if (V.actor === 'unit') {
    const m = /^([a-z]+)#(\d+)$/.exec(t[0]);
    if (!m) return { error: 'bad_actor' };
    c.unit = Number(m[2]); c.unit_type = m[1];
  } else if (V.actor === 'city') {
    const m = /^city#(\d+)$/.exec(t[0]);
    if (!m) return { error: 'bad_actor' };
    c.city = Number(m[1]);
  } else if (t[0] !== 'tribe') return { error: 'bad_actor' };
  switch (verb) {
    case 'move': c.to = t[2]; break;
    case 'attack': case 'convert': c.target = t[2]; break;
    case 'upgrade': c.to = t[2]; break;
    case 'train': c.unit_type = t[2]; break;
    case 'reward': c.reward = t[2]; break;
    case 'build': c.building = t[2]; c.at = t[3]; break;
    case 'research': c.tech = t[2]; break;
  }
  return c;
}
function fromPolyCommand(c) {
  const verb = VERB_OF[c.type] || c.type, V = VERBS[verb];
  if (!V) return null;
  const actor = V.actor === 'unit' ? c.unit_type + '#' + c.unit : V.actor === 'city' ? cityRef(c.city) : 'tribe';
  switch (verb) {
    case 'move': case 'upgrade': return [actor, verb, c.to];
    case 'attack': case 'convert': return [actor, verb, c.target];
    case 'train': return [actor, verb, c.unit_type];
    case 'reward': return [actor, verb, c.reward];
    case 'build': return [actor, verb, c.building, c.at];
    case 'research': return [actor, verb, c.tech];
  }
  return [actor, verb];
}

// machine-readable spec (written next to datasets so the Python side and docs share one definition)
function spec() {
  return { rules: TT.RULESET.name, format: '(actor, verb, *args)', actors: { unit: '<unit type>#<id>', city: 'city#<id>', tribe: 'tribe' }, verbs: VERBS, vocab: VOCAB };
}

module.exports = { VERBS, VOCAB, END, unitRef, cityRef, fromCommand, formatTuple, formatList, formatInline, parse, validShape, execute, toCommand, fromPolyCommand, spec };
