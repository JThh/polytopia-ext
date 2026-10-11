/* Tessera Tribes — online client: Google sign-in, profiles, rooms, matchmaking, invites, presence and the shared
   move log, on Supabase. No DOM here; ui.js draws everything. Off unless the build was given Supabase settings. */
(function (G) {
'use strict';
const TT = G.TT;
const cfg = G.TESSERA_CONFIG || {};
const O = TT.Online = { user: null, profile: null, dev: Math.random().toString(36).slice(2, 10), online: new Map() };
let sb = null, presence = null, status = 'menu', meChannel = null;
const listeners = { auth: [], presence: [], invite: [], match: [] };
const emit = (k, v) => listeners[k].forEach(f => { try { f(v); } catch (e) { console.error(e); } });
O.on = (k, f) => { listeners[k].push(f); };

O.available = () => !!(cfg.supabaseUrl && cfg.supabaseKey && G.supabase && typeof G.supabase.createClient === 'function' && /^https?:$/.test(location.protocol));

function friendly(error) {
  const msg = (error && (error.message || error.error_description)) || 'Network error';
  const e = new Error(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? 'Could not reach the server. Check your connection.' : msg);
  e.code = error && error.code;
  return e;
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) throw friendly(error);
  return data;
}

// ---------------------------------------------------------------- session
O.init = async function () {
  sb = G.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  await setSession(data.session);
  // Supabase advises against awaiting its own calls inside this callback, so the work is deferred
  sb.auth.onAuthStateChange((event, session) => {
    const id = session && session.user ? session.user.id : null;
    if (id !== (O.user && O.user.id)) setTimeout(() => setSession(session), 0);
  });
  // tidy the address bar after the Google redirect (keeps ?room=)
  try {
    const u = new URL(location.href);
    if (['code', 'error', 'error_description'].some(k => u.searchParams.has(k))) {
      ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => u.searchParams.delete(k));
      history.replaceState(null, '', u.pathname + u.search);
    }
  } catch (e) { /* sandboxed */ }
};
async function setSession(session) {
  O.user = session ? session.user : null;
  O.profile = null;
  if (O.user) { try { O.profile = await rpc('get_profile', { p_username: null }); } catch (e) { O.profile = null; } }
  watchMe();
  joinPresence();
  emit('auth', O.user);
}
O.reloadProfile = async () => { O.profile = O.user ? await rpc('get_profile', { p_username: null }) : null; return O.profile; };
O.signInGoogle = async room => {
  const back = location.origin + location.pathname + (room ? '?room=' + encodeURIComponent(room) : '');
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
  if (error) throw friendly(error);
};
O.signOut = async () => { await sb.auth.signOut(); await setSession(null); };
// automated tests sign in throwaway accounts this way; the page itself only offers Google
O._testSignIn = async (email, password) => {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw friendly(error);
  await setSession(data.session);
};
O.token = async () => { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : ''; };

// ---------------------------------------------------------------- profiles
O.claimUsername = async (name, tribe) => {
  await rpc('claim_username', { p_name: name, p_tribe: tribe });
  await O.reloadProfile();
  joinPresence();
  emit('auth', O.user);
  return O.profile;
};
O.setAvatar = async tribe => { await rpc('set_avatar', { p_tribe: tribe }); await O.reloadProfile(); O.setStatus(status); return O.profile; };
O.searchPlayers = q => rpc('search_players', { p_query: q });
O.profileOf = username => rpc('get_profile', { p_username: username });
O.leaderboard = () => rpc('leaderboard');

// ---------------------------------------------------------------- rooms, invites, matching
O.createRoom = (settings, tribe) => rpc('create_room', { p_settings: settings, p_tribe: tribe });
O.joinRoom = (code, tribe) => rpc('join_room', { p_code: code, p_tribe: tribe || null });
O.setTribe = (room, tribe) => rpc('set_tribe', { p_room: room, p_tribe: tribe });
O.updateRoom = (room, settings) => rpc('update_room', { p_room: room, p_settings: settings });
O.leaveRoom = room => rpc('leave_room', { p_room: room });
O.startRoom = room => rpc('start_room', { p_room: room });
O.roomInfo = room => rpc('room_info', { p_room: room });
O.myRooms = () => rpc('my_rooms');
O.invite = (room, userId) => rpc('invite_player', { p_room: room, p_user: userId });
O.myInvites = () => rpc('my_invites');
O.respondInvite = (id, accept, tribe) => rpc('respond_invite', { p_invite: id, p_accept: accept, p_tribe: tribe || null });
O.findMatch = (size, tribe, allowBots) => rpc('find_match', { p_size: size, p_tribe: tribe, p_allow_bots: !!allowBots });
O.cancelMatch = () => rpc('cancel_match');

// ---------------------------------------------------------------- the shared move log
O.getMoves = async (room, from) => {
  const out = [];
  for (;;) {
    const { data, error } = await sb.from('moves').select('seq,author,dev,seat,sys,cmds,h').eq('room_id', room).gte('seq', from + out.length).order('seq').limit(1000);
    if (error) throw friendly(error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
};
O.pushMoves = (room, base, entries) => rpc('push_moves', { p_room: room, p_base: base, p_dev: O.dev, p_entries: entries });
// realtime nudges: a new move, a seat change, a room status change. The log itself is always read in order.
O.watchRoom = (room, on) => {
  const ch = sb.channel('room:' + room + ':' + O.dev + ':' + Math.random().toString(36).slice(2, 6))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'moves', filter: 'room_id=eq.' + room }, p => on.move && on.move(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: 'room_id=eq.' + room }, () => on.seats && on.seats())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: 'id=eq.' + room }, p => on.room && on.room(p.new))
    .subscribe(s => on.status && on.status(s));
  return () => { sb.removeChannel(ch); };
};
function watchMe() {
  if (meChannel) { sb.removeChannel(meChannel); meChannel = null; }
  if (!O.user) return;
  const uid = O.user.id;
  meChannel = sb.channel('me:' + uid + ':' + O.dev)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invites', filter: 'to_user=eq.' + uid }, p => emit('invite', p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_queue', filter: 'user_id=eq.' + uid }, p => { if (p.new && p.new.room_id) emit('match', p.new.room_id); })
    .subscribe();
}

// ---------------------------------------------------------------- who is online (shown next to names)
function joinPresence() {
  if (presence) { sb.removeChannel(presence); presence = null; O.online.clear(); emit('presence', O.online); }
  if (!O.user || !O.profile) return;
  const ch = presence = sb.channel('players-online', { config: { presence: { key: O.user.id } } });
  ch.on('presence', { event: 'sync' }, () => {
    O.online.clear();
    const s = ch.presenceState();
    for (const k in s) if (s[k] && s[k][0]) O.online.set(k, s[k][0]);
    emit('presence', O.online);
  }).subscribe(st => { if (st === 'SUBSCRIBED') track(); });
}
function track() { if (presence && O.profile) presence.track({ username: O.profile.username, tribe: O.profile.avatar_tribe, status }).catch(() => {}); }
O.setStatus = s => { status = s; track(); };

// ---------------------------------------------------------------- records (verified by /api/finish)
async function finish(body) {
  const r = await fetch('/api/finish', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await O.token() }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Could not record the game (' + r.status + ').'); e.status = r.status; throw e; }
  return j;
}
O.finishOnline = room => finish({ room_id: room });
O.recordSolo = (settings, log) => finish({ solo: { settings, log } });
})(window);
