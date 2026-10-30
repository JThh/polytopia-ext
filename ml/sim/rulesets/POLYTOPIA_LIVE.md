# `polytopia_live`: The Battle of Polytopia 2.17.3 rules

Select it with `POLY_RULES=polytopia_live` (or `rules: polytopia_live` in a polyrl config). The classic
ruleset (`polytopia.js`) is unchanged, so older datasets and runs still reproduce. Seeded bot games under
`polytopia` and `tessera` produce byte-identical states and prompts before and after the engine hooks this
ruleset needs (`TT.HOOKS` in `src/engine.js`, all off by default).

Scope: the 12 regular tribes. Peace treaties, the AI opinion system, the four special tribes (Aquarion,
∑∫ỹriȱŋ, Polaris, Cymanti) and starving cities are not simulated.

## Sources

| tag | source | used for |
|---|---|---|
| G | the game's rules data, `GameLogicData` version 28 (identical in 2.17.2 and 2.17.3), as extracted by the PolyBot project | every unit, vessel, tech, building and tribe number |
| C | PolyBot's decompile-based engine (reproduces its 9 recorded real games exactly) | formulas the data does not hold |
| W | Polytopia Wiki, official patch notes | the rest |

`ml/scripts/check_gamedata.js <GameLogicData.json>` compares `polytopia_live.js` with **G** value by value: unit and
vessel cost, attack, defence, movement, range, HP, skills and tech; tech tier and parent; building cost, population
and tech; tribe start tech, unit, stars, map multipliers and capital resources; and embassy cost. On version 28 all
235 values match. Rerun it against a newer data file after a game update. `ml/test/rules_live.js` checks each rule
below as a small scenario, plus engine invariants over 30 bot games.

## Rules and where each value comes from

| rule | value | source |
|---|---|---|
| tech cost | tier × cities + 4; Literacy (Philosophy) ×2/3 rounded up | C |
| backwards research | a tier-2 tech may be researched when you own one of its tier-3 children | W (2.14) |
| tech tree | 25 techs; Shields shown as Strategy; Ramming; Diplomacy (Cloak, embassies, capital vision) | G |
| start stars | Xin-xi, Hoodrick, Quetzali, Yadakk 7; Oumaji 6; Luxidoor 2; others 5 | G |
| Luxidoor capital | **level 4** (set by the project owner) | owner. G only says `bonus: 1`. W and the starting score suggest level 3. |
| capital resources | per tribe, e.g. Xin-xi 2 metal, Luxidoor 2 game, 2 fruit, 2 fish, 1 crop, 1 metal | G `startingResource` |
| map multipliers | mountain/forest and resource rates per tribe region | G (the water multipliers are not applied; the map type sets the land/water split) |
| navy | a land unit entering its own port becomes a Raft (atk 0); in own territory it upgrades to Scout 5★, Rammer 5★ or Bomber 15★; Giant → Juggernaut, Cloak → Dinghy, Dagger → Pirate; ocean needs Sailing | G |
| Stiff / Surprise / Static | Stiff never retaliates; Surprise draws no retaliation; Static is never promoted | G skills |
| splash | each neighbour takes ⌊½ of what the attack would do to it⌋ | W (2.16.4) |
| stomp | same rule as splash | **assumed** |
| high ground, mountain range | none | C |
| roads | half movement on road tiles, not in another tribe's territory | C, W |
| Hide, Creep | Hide ignores zone of control; Creep is not stopped by forests | G, W |
| idle healing | end of own turn, units that neither moved nor attacked: +4 HP at home, +2 elsewhere | C |
| promotion | automatic at 3 kills, +5 max HP, full heal | C (the game makes it a free click) |
| disband | Free Spirit; refunds ⌊full cost / 2⌋, vessel included | C, G |
| city score | 50 × (level + 1) + 5 × population in the bar; parks +250 | C |
| other score | 20/tile, 5/explored tile, 100 × tier per tech, 5 × cost per unit (vessel included), temples 100 per level (+1 level every 2 turns, up to 500), monuments 400 | C, G |
| city income | level, +1 capital, +1 workshop, +1 per park; nothing while an enemy unit stands on the city | C |
| bot income | relative to a human: Easy −1, Normal 0, Hard +1, Crazy +3 | C (handicaps 0/1/2/4 against 1) |
| meeting a tribe | 2 × min(⌈its score / 1000⌉, 5) + 1 stars (3, 5, 7, 9, 11); since 2.17.3 the second player of a 1v1 gets +2 for meeting the first | C (PolyBot corrected its rounding to ceil from replays; W says "rounded up") |
| embassy | 5★ flat, in a met rival's capital; +2★ a turn to you and to the host; closed when either side attacks the other | G `diplomacyData` |
| Cloak | 8★, attack 2 (used only on cities), Hide, Creep, Scout, Dash; infiltrates an adjacent enemy city: you get that city's income, it makes nothing next turn, up to min(5, level) Daggers spawn, the unit in the city takes 2 damage, the Cloak is used up | G stats; W behaviour (the 2 damage is an **assumption**) |
| Daggers | spawned only; 2/2/1/1/10, Surprise, Independent, Static | G |
| Market | Trade, 5★, one per city, +1★ a turn per level of the adjacent windmills/forges/sawmills, up to 8 | G (how levels add up is **assumed**) |
| starfish | +8★, Navigation, needs your unit on the tile (any territory), uses that unit's turn; replace whales | G, C |
| bridges | Roads, 5★, one shallow tile between land straight across | G, W |
| Forge | also on forest | G |
| parks | +1★ a turn | C |
| tasks → monuments | Pacifist (Meditation, 5 turns without attacking) → Altar of Peace; Genius (Philosophy, all techs) → Tower of Wisdom; Network (5 cities connected) → Grand Bazaar; Wealth (Trade, 100★) → Emperor's Tomb; Killer (10 kills) → Gate of Power; Metropolis (a level-5 city) → Park of Fortune; Explorer (all 4 lighthouses) → Eye of God. Each is free, +3 pop, 400 points, once per tribe | G, W |
| lighthouses | the four map corners; exploring one gives the capital +1 pop | C |
| city connections | +1 pop in the city and in the capital. Links run between neighbouring roads, bridges, ports and city/village tiles, and port to port within 5 tiles by sailable water. Nothing links through another tribe's tiles. | C |
| ruins | uniformly among valid rewards: 10★; +3 pop in the capital; a veteran Swordsman (land) or a veteran Rammer (water, needs Sailing); an explorer walking 12 steps (needs unexplored tiles within 2); a free researchable tech. Examining uses the unit's turn | C |
| water ruins | 1 per 4 land ruins, on deep water | **assumed** rate |

## Verbs

The verbs are the classic set, minus walls and powers, plus:

- `("tribe", "embassy", (x, y))`: open an embassy in the rival capital at that position.
- `("<cloak>#id", "infiltrate")`
- `("<unit>#id", "upgrade", "scout" | "rammer" | "bomber")`

The prompt adds four things:
- `embassies=P…` on the `me:` line;
- a `monuments_ready:` line;
- a `bridges:` feature line;
- `linked` on cities connected to the capital.
