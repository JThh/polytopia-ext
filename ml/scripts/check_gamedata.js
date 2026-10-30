#!/usr/bin/env node
// Compares the polytopia_live ruleset's tables with the game's own rules data, value by value: unit and vessel stats,
// skills and techs; tech tiers and parents; building costs, population and techs; tribe start tech, unit, stars,
// map multipliers and capital resources; embassy cost. Exits 1 on any mismatch.
//
// The data file is GameLogicData (version 28 for 2.17.2 and 2.17.3), as extracted from a game build, e.g.
// re/data/GameLogicData28.json in github.com/AshtonCoates/PolyBot. It is not part of this repository.
//
// usage: node ml/scripts/check_gamedata.js <GameLogicData.json>
'use strict';
process.env.POLY_RULES = 'polytopia_live';
const fs = require('fs');
const TT = require('../sim/tt');

const G = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0, ok = 0;
const eq = (a, b, what) => {
  if (JSON.stringify(a) === JSON.stringify(b)) ok++;
  else { bad++; console.log('MISMATCH', what, 'ours', JSON.stringify(a), 'game', JSON.stringify(b)); }
};
// techs: tier = cost; parent = the tech that unlocks it; everyone starts with "basic". The data also holds the special
// tribes' alternative techs, so only the regular tree (ours, plus basic) is searched for what unlocks what.
const TECH_ID = { free_spirit: 'freespirit' }, gid = k => (k ? TECH_ID[k] || k : 'basic');
const REGULAR = new Set(['basic'].concat(TT.TECH_ORDER.map(gid)));
const unlocked = field => { // id -> the regular tech whose <field> lists it
  const out = {};
  for (const [k, v] of Object.entries(G.techData)) if (REGULAR.has(k)) for (const x of v[field] || []) out[x] = k;
  return out;
};
const parentOf = unlocked('techUnlocks');
for (const k of TT.TECH_ORDER) {
  const g = G.techData[gid(k)];
  if (!g) { bad++; console.log('MISSING tech', k); continue; }
  eq(TT.TECHS[k].tier, g.cost, 'tech tier ' + k);
  eq(gid(TT.TECHS[k].req), parentOf[gid(k)], 'tech parent ' + k);
}
for (const k of REGULAR) for (const c of (G.techData[k] || {}).techUnlocks || []) if (!REGULAR.has(c)) { bad++; console.log('MISSING tech', c, '(unlocked by ' + k + ')'); }

// units and vessels: stats are x10 in the data; hide = stealth; land/water/swim/carry are movement tags here
const UNIT_ID = { raft: 'transportship', scout: 'scoutship', rammer: 'rammership', bomber: 'bombership', dinghy: 'cloak_boat' };
const SKILL = { hide: 'stealth' }, TAGS = new Set(['land', 'water', 'swim', 'carry']);
const skills = a => a.map(s => SKILL[s] || s).filter(s => !TAGS.has(s)).sort();
const stats = g => [g.attack / 10, g.defence / 10, g.movement, g.range];
const unitTech = unlocked('unitUnlocks');
for (const k of Object.keys(TT.UNITS)) {
  const U = TT.UNITS[k], g = G.unitData[k];
  eq([U.cost, U.atk, U.def, U.move, U.range, U.hp], [g.cost].concat(stats(g), [g.health / 10]), 'unit stats ' + k);
  eq(skills(U.skills), skills(g.unitAbilities), 'unit skills ' + k);
  eq(gid(U.tech), unitTech[k] || 'basic', 'unit tech ' + k);
}
for (const k of Object.keys(TT.NAVAL)) {
  const N = TT.NAVAL[k], g = G.unitData[UNIT_ID[k] || k];
  eq([N.cost, N.atk, N.def, N.move, N.range], [g.cost].concat(stats(g)), 'vessel stats ' + k);
  eq(skills(N.skills), skills(g.unitAbilities), 'vessel skills ' + k);
}

// buildings: cost (stars gained count negative), population on build or per adjacent producer, tech
const IMP_ID = { fruit: 'harvestfruit', hunt: 'hunting', fish: 'fishing', starfish: 'starfishing', lumber: 'lumberhut', forest_temple: 'foresttemple',
  mountain_temple: 'mountaintemple', water_temple: 'watertemple', clear: 'clearforest', grow: 'growforest', burn: 'burnforest',
  altar_of_peace: 'monument1', tower_of_wisdom: 'monument2', grand_bazaar: 'monument3', emperors_tomb: 'monument4', gate_of_power: 'monument5',
  park_of_fortune: 'monument6', eye_of_god: 'monument7' };
const impTech = unlocked('improvementUnlocks');
const total = (list, key) => (list || []).reduce((s, r) => s + (r[key] || 0), 0);
for (const k of Object.keys(TT.BUILD)) {
  if (k === 'destroy') continue; // an ability in the game, not a building
  const B = TT.BUILD[k], id = IMP_ID[k] || k, g = G.improvementData[id];
  if (!g) { bad++; console.log('MISSING building', k); continue; }
  eq(B.cost, (g.cost || 0) - total(g.rewards, 'currency'), 'build cost ' + k);
  const pop = total(g.rewards, 'population'), grow = total(g.growthRewards, 'population');
  eq(B.bonus ? [0, B.bonus] : [B.pop, 0], g.growthRate == null && grow ? [pop, grow] : [pop, 0], 'build population ' + k);
  if (!B.monument) eq(gid(B.tech), impTech[id] || 'basic', 'build tech ' + k);
}

// tribes
for (const [id, , tech, unit, , stars, mult, res] of TT.RULESET.tables.TRIBES) {
  const g = G.tribeData[id];
  eq(['basic'].concat(tech ? [gid(tech)] : []), g.startingTech, 'tribe tech ' + id);
  eq(unit, g.startingUnit, 'tribe unit ' + id);
  eq(stars, g.startingStars == null ? 5 : g.startingStars, 'tribe stars ' + id);
  const want = {}, ours = {};
  for (const r of g.startingResource || []) want[r] = (want[r] || 0) + 1;
  for (const [k, n] of Object.entries(res)) ours[k === 'ore' ? 'metal' : k] = n;
  eq(Object.entries(ours).sort(), Object.entries(want).sort(), 'tribe capital resources ' + id);
  const gm = {}; // water multipliers are not applied (the map type sets the land/water split)
  for (const [k, v] of Object.entries(g.terrainModifier || {})) if (k !== 'water') gm[k] = v;
  for (const [k, v] of Object.entries(g.resourceModifier || {})) gm[k === 'metal' ? 'ore' : k] = v;
  eq(Object.entries(mult).sort(), Object.entries(gm).sort(), 'tribe map multipliers ' + id);
}
eq(TT.embassyCost(), G.diplomacyData.embassyCost, 'embassy cost');

console.log(ok + ' match, ' + bad + ' mismatch');
process.exit(bad ? 1 : 0);
