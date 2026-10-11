-- Tessera Tribes online backend: profiles, rooms, the shared move log, invites, matchmaking and game records.
--
-- Clients read through row-level security and change data only through the SECURITY DEFINER functions below.
-- Game records (game_results) are written only by the /api/finish function with the service-role key, after it
-- has replayed the whole game with the rules engine. Safe to run more than once.

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar_tribe text not null default 'verdant',
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'private' check (kind in ('private', 'match')),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished', 'abandoned')),
  settings jsonb not null,
  final jsonb,                       -- settings + seed + humans + tribes, fixed when the game starts
  seat_count int not null check (seat_count between 2 and 6),
  bot_seats int[] not null default '{}',
  move_count int not null default 0,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists rooms_status_idx on public.rooms (status, updated_at desc);

create table if not exists public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seat int not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tribe text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, user_id),
  unique (room_id, tribe)
);
create index if not exists room_players_user_idx on public.room_players (user_id);

create table if not exists public.moves (
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq int not null,
  author uuid not null,
  dev text not null default '',      -- which browser tab sent it (one account may be open on two devices)
  seat int not null,
  sys text check (sys in ('botify', 'human')),
  cmds jsonb not null default '[]'::jsonb,
  h text not null default '',
  created_at timestamptz not null default now(),
  primary key (room_id, seq)
);

create table if not exists public.invites (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (room_id, to_user)
);
create index if not exists invites_to_idx on public.invites (to_user, status);

create table if not exists public.match_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  size int not null check (size between 2 and 4),
  tribe text not null,
  room_id uuid references public.rooms (id) on delete set null,
  created_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists match_queue_size_idx on public.match_queue (size, created_at);

create table if not exists public.game_results (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('online', 'solo')),
  tribe text not null,
  won boolean not null,
  left_game boolean not null default false,
  place int not null,
  score int not null,
  turns int not null,
  seats int not null,
  humans int not null,
  difficulty text,
  map_type text,
  map_size text,
  mode text,
  reason text,
  opponents jsonb not null default '[]'::jsonb,
  ended_at timestamptz not null default now(),
  unique (game_id, user_id)
);
create index if not exists game_results_user_idx on public.game_results (user_id, ended_at desc);

-- ---------------------------------------------------------------- helpers
create or replace function public.tt_tribe_ok(t text) returns boolean
language sql immutable as $$
  select coalesce(t = any (array['verdant', 'ironpeak', 'tidecallers', 'emberfolk', 'frostkin', 'sunspire']), false)
$$;

create or replace function public.tt_clean_settings(s jsonb) returns jsonb
language plpgsql immutable as $$
declare
  opp int := case when coalesce(s ->> 'opponents', '') ~ '^[0-9]{1,2}$' then (s ->> 'opponents')::int else 3 end;
begin
  s := coalesce(s, '{}'::jsonb);
  return jsonb_build_object(
    'opponents', greatest(1, least(5, opp)),
    'size', case when s ->> 'size' in ('tiny', 'small', 'normal', 'large', 'huge') then s ->> 'size' else 'small' end,
    'mapType', case when s ->> 'mapType' in ('pangaea', 'continents', 'archipelago', 'lakes', 'highlands', 'waterworld') then s ->> 'mapType' else 'pangaea' end,
    'difficulty', case when s ->> 'difficulty' in ('easy', 'normal', 'hard', 'crazy') then s ->> 'difficulty' else 'normal' end,
    'mode', case when s ->> 'mode' = 'score' then 'score' else 'domination' end,
    'turnLimit', 30,
    'relief', case when s ->> 'relief' in ('flat', 'gentle', 'dramatic') then s ->> 'relief' else 'dramatic' end,
    'fog', coalesce((s -> 'fog') <> 'false'::jsonb, true),
    'events', coalesce((s -> 'events') <> 'false'::jsonb, true),
    'dayCycle', coalesce((s -> 'dayCycle') <> 'false'::jsonb, true));
end $$;

create or replace function public.tt_new_code() returns text
language plpgsql volatile as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    select string_agg(substr(a, 1 + floor(random() * length(a))::int, 1), '') into c from generate_series(1, 5);
    exit when not exists (select 1 from public.rooms where code = c);
  end loop;
  return c;
end $$;

create or replace function public.tt_seed() returns int
language sql volatile as $$ select (floor(random() * 2147483646) + 1)::int $$;

-- Membership checks used by row-level security. SECURITY DEFINER avoids recursive policy evaluation.
create or replace function public.tt_is_seated(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_players where room_id = p_room and user_id = auth.uid())
$$;
create or replace function public.tt_is_invited(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invites where room_id = p_room and to_user = auth.uid() and status = 'pending')
$$;

create or replace function public.tt_me() returns uuid
language plpgsql stable as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return auth.uid();
end $$;

-- ---------------------------------------------------------------- row-level security (reads only)
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.moves enable row level security;
alter table public.invites enable row level security;
alter table public.match_queue enable row level security;
alter table public.game_results enable row level security;

drop policy if exists "profiles are public to players" on public.profiles;
create policy "profiles are public to players" on public.profiles for select to authenticated using (true);
drop policy if exists "seated or invited see the room" on public.rooms;
create policy "seated or invited see the room" on public.rooms for select to authenticated using (public.tt_is_seated(id) or public.tt_is_invited(id));
drop policy if exists "seated or invited see the seats" on public.room_players;
create policy "seated or invited see the seats" on public.room_players for select to authenticated using (public.tt_is_seated(room_id) or public.tt_is_invited(room_id));
drop policy if exists "seated players see the moves" on public.moves;
create policy "seated players see the moves" on public.moves for select to authenticated using (public.tt_is_seated(room_id));
drop policy if exists "own invites" on public.invites;
create policy "own invites" on public.invites for select to authenticated using (to_user = auth.uid() or from_user = auth.uid());
drop policy if exists "own queue entry" on public.match_queue;
create policy "own queue entry" on public.match_queue for select to authenticated using (user_id = auth.uid());
drop policy if exists "records are public to players" on public.game_results;
create policy "records are public to players" on public.game_results for select to authenticated using (true);

-- ---------------------------------------------------------------- profiles
create or replace function public.claim_username(p_name text, p_tribe text default 'verdant') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); n text := btrim(coalesce(p_name, ''));
begin
  if n !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Use 3 to 16 letters, digits or underscores.'; end if;
  if not public.tt_tribe_ok(p_tribe) then p_tribe := 'verdant'; end if;
  begin
    insert into public.profiles (id, username, avatar_tribe) values (me, n, p_tribe)
    on conflict (id) do update set username = excluded.username, avatar_tribe = excluded.avatar_tribe;
  exception when unique_violation then
    raise exception 'That name is taken.';
  end;
  return (select to_jsonb(p) from public.profiles p where id = me);
end $$;

create or replace function public.set_avatar(p_tribe text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tt_tribe_ok(p_tribe) then raise exception 'Unknown tribe.'; end if;
  update public.profiles set avatar_tribe = p_tribe where id = public.tt_me();
end $$;

create or replace function public.search_players(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.tt_me(); q text := lower(btrim(coalesce(p_query, '')));
begin
  if length(q) < 1 then return '[]'::jsonb; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.exact desc, t.username)
    from (
      select p.id, p.username, p.avatar_tribe, lower(p.username) = lower(btrim(p_query)) as exact,
        (select count(*) from public.game_results g where g.user_id = p.id and g.kind = 'online') as games,
        (select count(*) from public.game_results g where g.user_id = p.id and g.kind = 'online' and g.won) as wins
      from public.profiles p
      where lower(p.username) like q || '%' and p.id <> me
      order by lower(p.username) = lower(btrim(p_query)) desc, p.username
      limit 15
    ) t), '[]'::jsonb);
end $$;

-- p_username null = your own profile
create or replace function public.get_profile(p_username text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.tt_me(); p public.profiles;
begin
  if p_username is null then select * into p from public.profiles where id = me;
  else select * into p from public.profiles where lower(username) = lower(btrim(p_username)); end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', p.id, 'username', p.username, 'avatar_tribe', p.avatar_tribe, 'created_at', p.created_at, 'me', p.id = me,
    'totals', (select coalesce(jsonb_object_agg(kind, x), '{}'::jsonb) from (
      select kind, jsonb_build_object('games', count(*), 'wins', count(*) filter (where won), 'best', max(score), 'left', count(*) filter (where left_game)) as x
      from public.game_results where user_id = p.id group by kind) k),
    'tribes', (select coalesce(jsonb_agg(jsonb_build_object('tribe', tribe, 'kind', kind, 'games', games, 'wins', wins)), '[]'::jsonb) from (
      select tribe, kind, count(*) as games, count(*) filter (where won) as wins from public.game_results where user_id = p.id group by tribe, kind) t),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' - 'id' order by r.ended_at desc), '[]'::jsonb) from (
      select * from public.game_results where user_id = p.id order by ended_at desc limit 12) r));
end $$;

create or replace function public.leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.tt_me();
  return jsonb_build_object(
    'online', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select p.username, p.avatar_tribe, count(*) filter (where g.won) as wins, count(*) as games
      from public.game_results g join public.profiles p on p.id = g.user_id
      where g.kind = 'online' group by p.id
      order by count(*) filter (where g.won) desc, count(*) asc, p.username limit 20) t),
    'solo', (select coalesce(jsonb_agg(row_to_json(t) order by t.best desc), '[]'::jsonb) from (
      select * from (
        select distinct on (p.id) p.username, p.avatar_tribe, g.score as best, g.tribe, g.difficulty, g.won
        from public.game_results g join public.profiles p on p.id = g.user_id
        where g.kind = 'solo' order by p.id, g.score desc) d
      order by best desc limit 20) t));
end $$;

-- ---------------------------------------------------------------- rooms
create or replace function public.room_info(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.rooms;
begin
  perform public.tt_me();
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'That room no longer exists.'; end if;
  if not (public.tt_is_seated(p_room) or public.tt_is_invited(p_room)) then raise exception 'You are not in this room.'; end if;
  return jsonb_build_object(
    'room', to_jsonb(r) || jsonb_build_object('host_name', (select username from public.profiles where id = r.host)),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('seat', rp.seat, 'user_id', rp.user_id, 'username', p.username, 'tribe', rp.tribe, 'avatar_tribe', p.avatar_tribe) order by rp.seat), '[]'::jsonb)
                from public.room_players rp join public.profiles p on p.id = rp.user_id where rp.room_id = p_room),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'user_id', i.to_user, 'username', p.username, 'status', i.status)), '[]'::jsonb)
                from public.invites i join public.profiles p on p.id = i.to_user where i.room_id = p_room and i.status = 'pending'));
end $$;

create or replace function public.tt_join(p_room uuid, p_tribe text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms; s int; t text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'That room no longer exists.'; end if;
  select seat into s from public.room_players where room_id = p_room and user_id = me;
  if s is not null then return jsonb_build_object('room_id', r.id, 'code', r.code, 'seat', s, 'rejoined', true); end if;
  if r.status <> 'lobby' then raise exception 'That game has already started.'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Choose a player name first.'; end if;
  select min(g) into s from generate_series(0, r.seat_count - 1) g where g not in (select seat from public.room_players where room_id = p_room);
  if s is null then raise exception 'That room is full.'; end if;
  t := case when public.tt_tribe_ok(p_tribe) and not exists (select 1 from public.room_players where room_id = p_room and tribe = p_tribe) then p_tribe
       else (select x from unnest(array['verdant', 'ironpeak', 'tidecallers', 'emberfolk', 'frostkin', 'sunspire']) x
             where x not in (select tribe from public.room_players where room_id = p_room) limit 1) end;
  insert into public.room_players (room_id, seat, user_id, tribe) values (p_room, s, me, t);
  update public.invites set status = 'accepted' where room_id = p_room and to_user = me and status = 'pending';
  update public.rooms set updated_at = now() where id = p_room;
  return jsonb_build_object('room_id', r.id, 'code', r.code, 'seat', s, 'rejoined', false);
end $$;

create or replace function public.create_room(p_settings jsonb, p_tribe text default 'verdant') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); s jsonb := public.tt_clean_settings(p_settings); rid uuid;
begin
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Choose a player name first.'; end if;
  if (select count(*) from public.rooms r where r.host = me and r.status = 'lobby' and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You already have several open rooms. Start or leave one first.';
  end if;
  insert into public.rooms (code, host, settings, seat_count) values (public.tt_new_code(), me, s, (s ->> 'opponents')::int + 1) returning id into rid;
  return public.tt_join(rid, p_tribe);
end $$;

create or replace function public.join_room(p_code text, p_tribe text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform public.tt_me();
  select id into rid from public.rooms where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if rid is null then raise exception 'No room with that code.'; end if;
  return public.tt_join(rid, p_tribe);
end $$;

create or replace function public.set_tribe(p_room uuid, p_tribe text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me();
begin
  if not public.tt_tribe_ok(p_tribe) then raise exception 'Unknown tribe.'; end if;
  if (select status from public.rooms where id = p_room) <> 'lobby' then raise exception 'The game has started.'; end if;
  if exists (select 1 from public.room_players where room_id = p_room and tribe = p_tribe and user_id <> me) then raise exception 'Another player has that tribe.'; end if;
  update public.room_players set tribe = p_tribe where room_id = p_room and user_id = me;
  update public.rooms set updated_at = now() where id = p_room;
end $$;

create or replace function public.update_room(p_room uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms; s jsonb := public.tt_clean_settings(p_settings); n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> me then raise exception 'Only the host can change the room.'; end if;
  if r.status <> 'lobby' then raise exception 'The game has started.'; end if;
  n := (s ->> 'opponents')::int + 1;
  if exists (select 1 from public.room_players where room_id = p_room and seat >= n) then raise exception 'Someone is sitting in a seat you are removing.'; end if;
  update public.rooms set settings = s, seat_count = n, updated_at = now() where id = p_room;
  return s;
end $$;

create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms; nh uuid;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then return; end if;
  if r.status <> 'lobby' then raise exception 'The game has started. Leave from the game menu instead.'; end if;
  delete from public.room_players where room_id = p_room and user_id = me;
  if r.host = me then
    select user_id into nh from public.room_players where room_id = p_room order by joined_at limit 1;
    if nh is null then
      update public.rooms set status = 'abandoned', updated_at = now() where id = p_room;
      update public.invites set status = 'cancelled' where room_id = p_room and status = 'pending';
    else
      update public.rooms set host = nh, updated_at = now() where id = p_room;
    end if;
  else
    update public.rooms set updated_at = now() where id = p_room;
  end if;
end $$;

create or replace function public.start_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms; humans int[]; tribes jsonb;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> me then raise exception 'Only the host can start.'; end if;
  if r.status <> 'lobby' then return; end if;
  select array_agg(seat order by seat) into humans from public.room_players where room_id = p_room;
  select jsonb_agg((select tribe from public.room_players where room_id = p_room and seat = g) order by g) into tribes
    from generate_series(0, r.seat_count - 1) g;
  update public.rooms set status = 'playing', started_at = now(), updated_at = now(),
    bot_seats = (select coalesce(array_agg(g order by g), '{}') from generate_series(0, r.seat_count - 1) g where not g = any (humans)),
    final = r.settings || jsonb_build_object('humans', to_jsonb(humans), 'tribes', tribes, 'spectate', false, 'seed', public.tt_seed())
  where id = p_room;
  update public.invites set status = 'cancelled' where room_id = p_room and status = 'pending';
end $$;

create or replace function public.my_rooms() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.tt_me();
begin
  return coalesce((select jsonb_agg(x order by x ->> 'updated_at' desc) from (
    select jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'kind', r.kind, 'updated_at', r.updated_at, 'seat', rp.seat,
      'players', (select jsonb_agg(jsonb_build_object('username', p.username, 'tribe', q.tribe) order by q.seat) from public.room_players q join public.profiles p on p.id = q.user_id where q.room_id = r.id),
      'seat_count', r.seat_count) as x
    from public.room_players rp join public.rooms r on r.id = rp.room_id
    where rp.user_id = me and r.status in ('lobby', 'playing') and r.updated_at > now() - interval '3 days'
    order by r.updated_at desc limit 10) s), '[]'::jsonb);
end $$;

-- Append moves if the log still has the length the client last saw (optimistic lock). A move entry must be for
-- your own seat or a bot seat (any player may run a bot's turn); 'human' takes back your own seat, 'botify' hands
-- a seat to a bot.
create or replace function public.push_moves(p_room uuid, p_base int, p_dev text, p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms; my_seat int; e jsonb; n int; s int; kind text; bots int[];
begin
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 50 or length(p_entries::text) > 300000 then
    raise exception 'Bad entries.';
  end if;
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'That room no longer exists.'; end if;
  if r.status <> 'playing' then raise exception 'The game is not running.'; end if;
  select seat into my_seat from public.room_players where room_id = p_room and user_id = me;
  if my_seat is null then raise exception 'You are not seated in this room.'; end if;
  if r.move_count <> p_base then return jsonb_build_object('conflict', true, 'len', r.move_count); end if;
  n := r.move_count; bots := r.bot_seats;
  for e in select value from jsonb_array_elements(p_entries) loop
    s := (e ->> 'seat')::int;
    kind := e ->> 'sys';
    if s is null or s < 0 or s >= r.seat_count then raise exception 'Bad seat.'; end if;
    if kind is null then
      if s <> my_seat and not s = any (bots) then raise exception 'That seat is not yours to move.'; end if;
      if jsonb_typeof(e -> 'cmds') is distinct from 'array' or jsonb_array_length(e -> 'cmds') > 400 then raise exception 'Bad commands.'; end if;
    elsif kind = 'human' then
      if s <> my_seat then raise exception 'You can only take back your own seat.'; end if;
      bots := array_remove(bots, s);
    elsif kind = 'botify' then
      if not exists (select 1 from public.room_players where room_id = p_room and seat = s) then raise exception 'That seat is already a bot.'; end if;
      if not s = any (bots) then bots := bots || s; end if;
    else
      raise exception 'Bad entry.';
    end if;
    insert into public.moves (room_id, seq, author, dev, seat, sys, cmds, h)
    values (p_room, n, me, left(coalesce(p_dev, ''), 16), s, kind, case when kind is null then e -> 'cmds' else '[]'::jsonb end, left(coalesce(e ->> 'h', ''), 16));
    n := n + 1;
  end loop;
  update public.rooms set move_count = n, bot_seats = bots, updated_at = now() where id = p_room;
  return jsonb_build_object('conflict', false, 'len', n);
end $$;

-- ---------------------------------------------------------------- invites
create or replace function public.invite_player(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found or not public.tt_is_seated(p_room) then raise exception 'You are not in this room.'; end if;
  if r.status <> 'lobby' then raise exception 'The game has started.'; end if;
  if p_user = me then raise exception 'That is you.'; end if;
  if exists (select 1 from public.room_players where room_id = p_room and user_id = p_user) then raise exception 'They are already in the room.'; end if;
  if (select count(*) from public.room_players where room_id = p_room) >= r.seat_count then raise exception 'The room is full.'; end if;
  insert into public.invites (room_id, from_user, to_user) values (p_room, me, p_user)
  on conflict (room_id, to_user) do update set status = 'pending', from_user = excluded.from_user, created_at = now();
end $$;

create or replace function public.my_invites() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.tt_me();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'room_id', i.room_id, 'code', r.code, 'from', p.username, 'from_tribe', p.avatar_tribe,
      'seats', r.seat_count, 'taken', (select count(*) from public.room_players q where q.room_id = r.id), 'settings', r.settings) order by i.created_at desc)
    from public.invites i join public.rooms r on r.id = i.room_id join public.profiles p on p.id = i.from_user
    where i.to_user = me and i.status = 'pending' and r.status = 'lobby' and i.created_at > now() - interval '1 day'), '[]'::jsonb);
end $$;

create or replace function public.respond_invite(p_invite bigint, p_accept boolean, p_tribe text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.tt_me(); i public.invites;
begin
  select * into i from public.invites where id = p_invite and to_user = me;
  if not found then raise exception 'That invite is gone.'; end if;
  if not p_accept then
    update public.invites set status = 'declined' where id = p_invite;
    return null;
  end if;
  return public.tt_join(i.room_id, p_tribe);
end $$;

-- ---------------------------------------------------------------- random matching
-- Call every few seconds while searching (it doubles as a heartbeat). When enough people are waiting for the
-- same size, it starts a game with random seats; with p_allow_bots it starts as soon as one other person waits.
create or replace function public.find_match(p_size int, p_tribe text, p_allow_bots boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.tt_me(); q public.match_queue; others uuid[]; n int; users uuid[]; perm int[]; humans int[];
  rid uuid; s jsonb; tribes text[]; want text; used text[] := '{}'; seat_tribe jsonb; i int;
begin
  if p_size not between 2 and 4 then raise exception 'Pick 2, 3 or 4 players.'; end if;
  if not public.tt_tribe_ok(p_tribe) then p_tribe := 'verdant'; end if;
  if not exists (select 1 from public.profiles where id = me) then raise exception 'Choose a player name first.'; end if;
  perform pg_advisory_xact_lock(hashtext('tessera-match'));
  select * into q from public.match_queue where user_id = me;
  if found and q.room_id is not null and exists (select 1 from public.rooms where id = q.room_id and status = 'playing') then
    return jsonb_build_object('room_id', q.room_id);
  end if;
  select array_agg(user_id order by created_at) into others from (
    select user_id, created_at from public.match_queue
    where size = p_size and room_id is null and user_id <> me and seen_at > now() - interval '15 seconds'
    order by created_at limit p_size - 1) w;
  n := coalesce(array_length(others, 1), 0);
  if n < p_size - 1 and not (p_allow_bots and n >= 1) then
    insert into public.match_queue (user_id, size, tribe) values (me, p_size, p_tribe)
    on conflict (user_id) do update set tribe = excluded.tribe, seen_at = now(), room_id = null,
      created_at = case when match_queue.size = excluded.size and match_queue.room_id is null then match_queue.created_at else now() end,
      size = excluded.size;
    return jsonb_build_object('waiting', n + 1, 'size', p_size);
  end if;

  -- start a game: earliest searchers keep their tribe when two want the same one; seats are shuffled
  users := others || me;
  select array_agg(g order by random()) into perm from generate_series(0, p_size - 1) g;
  tribes := array_fill(null::text, array[p_size]);
  for i in 1 .. array_length(users, 1) loop
    want := coalesce((select tribe from public.match_queue where user_id = users[i] and users[i] <> me), p_tribe);
    if want = any (used) then
      want := (select x from unnest(array['verdant', 'ironpeak', 'tidecallers', 'emberfolk', 'frostkin', 'sunspire']) x where not x = any (used) order by random() limit 1);
    end if;
    used := used || want;
    tribes[perm[i] + 1] := want;
  end loop;
  humans := (select array_agg(perm[k] order by perm[k]) from generate_series(1, array_length(users, 1)) k);
  select jsonb_agg(to_jsonb(tribes[g + 1]) order by g) into seat_tribe from generate_series(0, p_size - 1) g;
  s := jsonb_build_object('opponents', p_size - 1, 'size', case when p_size = 2 then 'small' else 'normal' end,
    'mapType', (array['pangaea', 'continents', 'lakes', 'highlands'])[1 + floor(random() * 4)::int],
    'difficulty', 'normal', 'mode', 'score', 'turnLimit', 30, 'relief', 'dramatic', 'fog', true, 'events', true, 'dayCycle', true);
  insert into public.rooms (code, host, kind, status, settings, seat_count, started_at, bot_seats, final)
  values (public.tt_new_code(), users[1], 'match', 'playing', s, p_size, now(),
    (select coalesce(array_agg(g order by g), '{}') from generate_series(0, p_size - 1) g where not g = any (humans)),
    s || jsonb_build_object('humans', to_jsonb(humans), 'tribes', seat_tribe, 'spectate', false, 'seed', public.tt_seed()))
  returning id into rid;
  for i in 1 .. array_length(users, 1) loop
    insert into public.room_players (room_id, seat, user_id, tribe) values (rid, perm[i], users[i], tribes[perm[i] + 1]);
  end loop;
  insert into public.match_queue (user_id, size, tribe, room_id) values (me, p_size, p_tribe, rid)
  on conflict (user_id) do update set room_id = rid, seen_at = now();
  update public.match_queue set room_id = rid where user_id = any (others);
  return jsonb_build_object('room_id', rid);
end $$;

create or replace function public.cancel_match() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.match_queue where user_id = public.tt_me() and room_id is null;
end $$;

-- ---------------------------------------------------------------- permissions
do $$
declare f text;
begin
  foreach f in array array[
    'claim_username(text,text)', 'set_avatar(text)', 'search_players(text)', 'get_profile(text)', 'leaderboard()',
    'room_info(uuid)', 'create_room(jsonb,text)', 'join_room(text,text)', 'set_tribe(uuid,text)', 'update_room(uuid,jsonb)',
    'leave_room(uuid)', 'start_room(uuid)', 'my_rooms()', 'push_moves(uuid,int,text,jsonb)', 'invite_player(uuid,uuid)',
    'my_invites()', 'respond_invite(bigint,boolean,text)', 'find_match(int,text,boolean)', 'cancel_match()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['tt_join(uuid,text)', 'tt_is_seated(uuid)', 'tt_is_invited(uuid)', 'tt_me()', 'tt_new_code()', 'tt_seed()', 'tt_clean_settings(jsonb)', 'tt_tribe_ok(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- policies call these as the signed-in user
  grant execute on function public.tt_is_seated(uuid), public.tt_is_invited(uuid) to authenticated;
end $$;

-- writes go through the functions above; direct table writes are refused for signed-in users and guests alike
revoke insert, update, delete, truncate on public.profiles, public.rooms, public.room_players, public.moves, public.invites, public.match_queue, public.game_results from anon, authenticated;
revoke select on public.profiles, public.rooms, public.room_players, public.moves, public.invites, public.match_queue, public.game_results from anon;

-- ---------------------------------------------------------------- realtime (devices are told about new moves, seats, invites and matches)
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['moves', 'room_players', 'rooms', 'invites', 'match_queue'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
