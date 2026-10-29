-- GymTracker social: one season shared by every user, friends, and the workout stats friends see.
-- Run once in the project's SQL editor after 0002_permissions.sql.
--
-- Every table here is closed to the API (RLS on, no policies, privileges revoked): the app only
-- calls the security-definer functions below, which act for `auth.uid()` and nobody else.
-- Authentication › Sign In / Providers: keep "Allow new users to sign up" ON, or friends who
-- open an invite link cannot create an account.

/* ------------------------------ the shared season ------------------------------ */

-- Seasons last 84 days (12 weeks, the app's SEASON_DAYS) and roll over by themselves; an account
-- with the `end_season` permission (0002) can end one early. Dates are Europe/Rome days.
create table if not exists public.global_seasons (
  id         integer primary key,
  started_on date not null,
  ended_on   date             -- set when the next season starts
);

alter table public.global_seasons enable row level security;
revoke all on public.global_seasons from anon, authenticated;

create or replace function public.season_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- The running season as {id, startedOn, endsOn}; creates season 1 on first use and rolls over
-- every 84 days. Serialised by an advisory lock, so two callers never add the same season.
create or replace function public.current_season()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.season_today();
  cur public.global_seasons;
begin
  select * into cur from public.global_seasons s order by s.id desc limit 1;
  if cur.id is null or cur.started_on + 84 <= today then
    perform pg_advisory_xact_lock(hashtext('global_seasons'));
    select * into cur from public.global_seasons s order by s.id desc limit 1;
    if cur.id is null then
      insert into public.global_seasons (id, started_on) values (1, today) returning * into cur;
    end if;
    while cur.started_on + 84 <= today loop
      update public.global_seasons s set ended_on = cur.started_on + 83 where s.id = cur.id;
      insert into public.global_seasons (id, started_on) values (cur.id + 1, cur.started_on + 84)
        returning * into cur;
    end loop;
  end if;
  return jsonb_build_object('id', cur.id, 'startedOn', cur.started_on, 'endsOn', cur.started_on + 83);
end;
$$;

-- Ends the running season today for everyone and starts the next one. Needs `end_season`.
create or replace function public.end_season()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.season_today();
  cur public.global_seasons;
begin
  if not ('end_season' = any (public.my_permissions())) then
    raise exception 'not allowed to end the season' using errcode = '42501';
  end if;
  perform public.current_season();
  perform pg_advisory_xact_lock(hashtext('global_seasons'));
  select * into cur from public.global_seasons s order by s.id desc limit 1;
  if cur.started_on >= today then
    raise exception 'the season started today' using errcode = 'P0001';
  end if;
  update public.global_seasons s set ended_on = today - 1 where s.id = cur.id;
  insert into public.global_seasons (id, started_on) values (cur.id + 1, today);
  return public.current_season();
end;
$$;

-- Supabase also grants EXECUTE on new functions to anon and authenticated directly, not only
-- through PUBLIC: revoke from each.
revoke all on function public.season_today() from public, anon, authenticated;
revoke all on function public.current_season() from public, anon;
revoke all on function public.end_season() from public, anon;
grant execute on function public.current_season() to authenticated;
grant execute on function public.end_season() to authenticated;

/* ------------------------------ profiles and friends ------------------------------ */

-- The name friends see (the email stays private) and the code an invite link carries.
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  friend_code  text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at   timestamptz not null default now(),
  constraint profiles_name_length check (char_length(display_name) between 1 and 30)
);

-- One row per pair, from who asked to who was asked; `accepted` once the other side says yes.
create table if not exists public.friendships (
  requester  uuid not null references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  accepted   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  constraint friendships_not_self check (requester <> addressee)
);
create index if not exists friendships_addressee on public.friendships (addressee);

-- Workout stats only (no food, no body weight), published by the app after each sync.
create table if not exists public.public_stats (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  season_id        integer not null,
  points           integer not null,
  streak_weeks     integer not null,
  week_start       date    not null,   -- the Monday the week counters belong to
  sessions_week    integer not null,
  sessions_season  integer not null,
  volume_week_kg   integer not null,
  volume_season_kg integer not null,
  best_lifts       jsonb   not null default '[]',  -- [{key, name, e1rm}], at most 60
  updated_at       timestamptz not null default now(),
  constraint public_stats_lifts check (
    jsonb_typeof(best_lifts) = 'array' and jsonb_array_length(best_lifts) <= 60 and octet_length(best_lifts::text) <= 8000)
);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.public_stats enable row level security;
revoke all on public.profiles, public.friendships, public.public_stats from anon, authenticated;

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('displayName', p.display_name, 'friendCode', p.friend_code)
  from public.profiles p where p.user_id = auth.uid()
$$;

-- Creates the caller's profile on first use, renames it afterwards.
create or replace function public.set_display_name(name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'));
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 30 then
    raise exception 'name must be 1-30 characters' using errcode = 'P0001';
  end if;
  insert into public.profiles (user_id, display_name) values (uid, clean)
    on conflict (user_id) do update set display_name = excluded.display_name;
  return public.my_profile();
end;
$$;

-- 'requested' (waits for the other side), 'accepted' (they had already asked us) or 'already'.
create or replace function public.send_friend_request(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  other uuid;
  reverse_accepted boolean;
begin
  if uid is null or not exists (select 1 from public.profiles p where p.user_id = uid) then
    raise exception 'set a display name first' using errcode = 'P0001';
  end if;
  select p.user_id into other from public.profiles p where p.friend_code = upper(btrim(code));
  if other is null then
    raise exception 'unknown friend code' using errcode = 'P0001';
  end if;
  if other = uid then
    raise exception 'that is your own code' using errcode = 'P0001';
  end if;
  select f.accepted into reverse_accepted from public.friendships f
    where f.requester = other and f.addressee = uid;
  if reverse_accepted is not null then
    if reverse_accepted then
      return 'already';
    end if;
    update public.friendships f set accepted = true where f.requester = other and f.addressee = uid;
    return 'accepted';
  end if;
  insert into public.friendships (requester, addressee) values (uid, other)
    on conflict do nothing;
  return case when found then 'requested' else 'already' end;
end;
$$;

create or replace function public.answer_friend_request(requester_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if accept then
    update public.friendships f set accepted = true
      where f.requester = requester_id and f.addressee = auth.uid();
  else
    delete from public.friendships f
      where f.requester = requester_id and f.addressee = auth.uid() and not f.accepted;
  end if;
end;
$$;

-- Unfriends, or withdraws a request, in either direction.
create or replace function public.remove_friend(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships f
  where (f.requester = auth.uid() and f.addressee = other)
     or (f.requester = other and f.addressee = auth.uid())
$$;

create or replace function public.publish_stats(s jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lifts jsonb := coalesce(s -> 'bestLifts', '[]'::jsonb);
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(lifts) <> 'array' then
    lifts := '[]'::jsonb;
  end if;
  insert into public.public_stats as ps (
    user_id, season_id, points, streak_weeks, week_start, sessions_week, sessions_season,
    volume_week_kg, volume_season_kg, best_lifts, updated_at)
  values (
    uid,
    greatest(0, (s ->> 'seasonId')::integer),
    greatest(0, round((s ->> 'points')::numeric)::integer),
    greatest(0, (s ->> 'streakWeeks')::integer),
    (s ->> 'weekStart')::date,
    greatest(0, (s ->> 'sessionsWeek')::integer),
    greatest(0, (s ->> 'sessionsSeason')::integer),
    greatest(0, round((s ->> 'volumeWeekKg')::numeric)::integer),
    greatest(0, round((s ->> 'volumeSeasonKg')::numeric)::integer),
    lifts,
    now())
  on conflict (user_id) do update set
    season_id = excluded.season_id, points = excluded.points, streak_weeks = excluded.streak_weeks,
    week_start = excluded.week_start, sessions_week = excluded.sessions_week,
    sessions_season = excluded.sessions_season, volume_week_kg = excluded.volume_week_kg,
    volume_season_kg = excluded.volume_season_kg, best_lifts = excluded.best_lifts,
    updated_at = excluded.updated_at;
end;
$$;

-- The caller, their friends and their open requests. Stats only for the caller and accepted friends.
create or replace function public.friends_board()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  links as (
    select case when f.requester = me.uid then f.addressee else f.requester end as other,
           case when f.accepted then 'friend'
                when f.requester = me.uid then 'outgoing'
                else 'incoming' end as status
    from public.friendships f, me
    where f.requester = me.uid or f.addressee = me.uid
    union all
    select me.uid, 'me' from me
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', l.other,
    'displayName', p.display_name,
    'status', l.status,
    'stats', case when l.status in ('me', 'friend') and st.user_id is not null then jsonb_build_object(
      'seasonId', st.season_id, 'points', st.points, 'streakWeeks', st.streak_weeks,
      'weekStart', st.week_start, 'sessionsWeek', st.sessions_week, 'sessionsSeason', st.sessions_season,
      'volumeWeekKg', st.volume_week_kg, 'volumeSeasonKg', st.volume_season_kg,
      'bestLifts', st.best_lifts, 'updatedAt', st.updated_at) end
  )), '[]'::jsonb)
  from links l
  join public.profiles p on p.user_id = l.other
  left join public.public_stats st on st.user_id = l.other
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'my_profile()', 'set_display_name(text)', 'send_friend_request(text)',
    'answer_friend_request(uuid, boolean)', 'remove_friend(uuid)', 'publish_stats(jsonb)', 'friends_board()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;
