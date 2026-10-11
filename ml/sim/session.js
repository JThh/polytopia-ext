// A game in progress with some seats played by the model and the rest by the built-in bot.
// Used by the RL server (rollouts, branch evaluation) and by evaluation scripts.
'use strict';
const TT = require('./tt');
const A = require('./actions');
const { History } = require('./history');
const { observe, scoreRank } = require('./observe');
const targets = require('./targets');

const MAX_ACTIONS = 150; // per turn; anything longer is cut off

class Session {
  // settings: TT.newGame settings (tribes, opponents, size, mapType, mode, turnLimit, seed, events...)
  // opts: { modelSeats: [pid...], difficulties: [per seat], histTurns, histCap, maxTurns }
  constructor(settings, opts, _clone) {
    this.opts = { modelSeats: [0], histTurns: 2, histCap: 40, maxTurns: 60 };
    for (const k of Object.keys(opts || {})) if (opts[k] != null) this.opts[k] = opts[k]; // null from JSON = use the default
    this.modelSeats = new Set(this.opts.modelSeats);
    if (_clone) { this.st = _clone.st; this.hist = _clone.hist; }
    else {
      const humans = Array.from(this.modelSeats);
      this.st = TT.newGame(Object.assign({}, settings, { humans, spectate: false }));
      const d = this.opts.difficulties;
      if (d) this.st.players.forEach((P, i) => { if (P.isAI && d[i]) P.difficulty = d[i]; });
      this.hist = new History();
    }
    this.hist.attach(this.st);
  }

  clone() { return new Session(null, this.opts, { st: TT.ML.clone(this.st), hist: this.hist.clone() }); }

  get over() { return !!this.st.over || this.st.turn > this.opts.maxTurns; }
  status() {
    const st = this.st;
    return { over: this.over, turn: st.turn, current: st.current, modelTurn: !this.over && this.modelSeats.has(st.current) };
  }

  // bots play until it is a model seat's turn or the game ends
  advance() {
    let guard = 0;
    while (!this.over && !this.modelSeats.has(this.st.current) && guard++ < 500) this.botTurn();
    return this.status();
  }
  botTurn() {
    TT.ML.botTurn(this.st);
    if (!this.st.over) TT.endTurn(this.st);
  }

  goalFor(pid, boost) { return targets.goal(this.st, pid, boost); }
  observe(pid, goal) {
    pid = pid == null ? this.st.current : pid;
    return observe(this.st, pid, this.hist, { goal: goal === undefined ? this.goalFor(pid) : goal, histTurns: this.opts.histTurns, histCap: this.opts.histCap });
  }

  // Run the current player's turn from model text (or a parsed tuple list). Invalid tuples are skipped (no effect);
  // the turn always ends afterwards. Returns a report used for rewards and diagnostics.
  applyPlan(plan) {
    const st = this.st, pid = st.current;
    const p = typeof plan === 'string' ? A.parse(plan) : { actions: plan, error: null, complete: true, rest: '' };
    const rep = { pid, turn: st.turn, parsed: p.actions.length, complete: p.complete, parseError: p.error, trailingText: !!p.rest,
      valid: 0, invalid: 0, errors: {}, endedExplicitly: false, afterEnd: 0, truncated: false, verbs: {} };
    let k = 0;
    for (; k < p.actions.length; k++) {
      if (st.over) break;
      if (k >= MAX_ACTIONS) { rep.truncated = true; break; }
      const t = p.actions[k];
      const r = A.execute(st, pid, t);
      if (r.end) { rep.endedExplicitly = true; k++; break; }
      if (r.ok) { rep.valid++; rep.verbs[t[1]] = (rep.verbs[t[1]] || 0) + 1; }
      else { rep.invalid++; rep.errors[r.err] = (rep.errors[r.err] || 0) + 1; }
    }
    rep.afterEnd = Math.max(0, p.actions.length - k);
    if (!st.over && st.current === pid) TT.endTurn(st);
    return rep;
  }

  metrics(pid) {
    const st = this.st, P = st.players[pid], sr = scoreRank(st, pid);
    let maxOther = 0;
    for (const Q of st.players) if (Q.id !== pid && Q.alive) maxOther = Math.max(maxOther, TT.score(st, Q.id));
    return { score: P.alive ? sr.score : 0, rank: P.alive ? sr.rank : st.players.length, alive: P.alive, stars: P.stars, income: P.alive ? TT.income(st, pid) : 0,
      cities: st.cities.filter(c => c.owner === pid).length, units: st.units.filter(u => u.owner === pid).length,
      techs: Object.keys(P.techs).length, maxOther, turn: st.turn };
  }

  // Counterfactual evaluation of candidate plans for the current (model) player, each on its own copy of the game:
  // apply the plan, then let every seat (this one included, played by the bot) continue until this player has
  // started `horizon` more turns. Each branch uses the same bot random seed, so differences come from the plan.
  evaluate(plans, horizon, seed) {
    const pid = this.st.current, before = this.metrics(pid);
    horizon = Math.max(0, horizon | 0);
    return plans.map(plan => {
      const b = this.clone();
      TT.ML.seedRandom(seed);
      const report = b.applyPlan(plan);
      const after = b.metrics(pid); // right after my turn (scores refreshed by endTurn)
      let seen = 0, guard = 0;
      while (!b.over && seen < horizon && b.st.players[pid].alive && guard++ < 400) {
        if (b.st.current === pid) { seen++; if (seen >= horizon) break; }
        b.botTurn();
      }
      return { report, before, after, horizon: b.metrics(pid), over: b.over, winner: b.st.over ? b.st.over.winner : -1 };
    });
  }

  result() {
    const st = this.st, n = st.players.length;
    const scores = st.players.map(P => P.alive ? TT.score(st, P.id) : 0);
    let winner = st.over ? st.over.winner : scores.indexOf(Math.max.apply(null, scores));
    // the winner is 1st (in domination it may not have the top score); everyone else ranks by score behind it
    const ranks = scores.map((s, i) => i === winner ? 1 : 2 + scores.filter((o, j) => j !== winner && j !== i && o > s).length);
    return { over: !!st.over, reason: st.over ? st.over.reason : 'turn_cap', turn: st.turn, winner, scores, ranks, alive: st.players.map(P => P.alive), tribes: st.players.map(P => P.tribe), n };
  }
}

module.exports = { Session, MAX_ACTIONS };
