-- GymTracker: the admin sets any account's season points (Settings › Danger zone › Users' points).
-- Run once in the project's SQL editor after 0003_social.sql (running it again is harmless).
--
-- An edit is a score event worth the difference, written into that account's synced rows: its
-- devices pull it and recompute their points like any other score (lib/merge.ts `rankPointsFor`),
-- and the event shows in their Recent scores as "Points adjustment". Needs `adjust_points` (0002).

insert into public.role_permissions (role, permission) values ('admin', 'adjust_points')
  on conflict do nothing;

-- The season points an account's synced rows add up to, as lib/merge.ts `rankPointsFor` counts
-- them: carry-over (20%) of the latest season that started earlier + this season's score events
-- − idle decay. Null when the account has never synced its rank.
create or replace function public.synced_season_points(uid uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with rs as (
    select r.data from public.rows r
    where r.user_id = uid and r.tbl = 'rankState' and r.id = '1' and not r.deleted
  ),
  prev as (
    select (s.data ->> 'finalPoints')::numeric as final_points
    from public.rows s, rs
    where s.user_id = uid and s.tbl = 'seasons' and not s.deleted
      and s.data ->> 'startDate' < rs.data ->> 'seasonStart'
    order by s.data ->> 'startDate' desc
    limit 1
  )
  select greatest(0, round(
      coalesce((select round(prev.final_points * 0.2) from prev), 0)
    + coalesce((select sum((e.data ->> 'total')::numeric) from public.rows e
                where e.user_id = uid and e.tbl = 'scoreEvents' and not e.deleted
                  and e.data ->> 'date' >= rs.data ->> 'seasonStart'), 0)
    - coalesce((rs.data ->> 'idleDecayTaken')::numeric, 0)))::integer
  from rs
$$;

-- Every account with its synced season points, for the admin's list.
create or replace function public.admin_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not ('adjust_points' = any (public.my_permissions())) then
    raise exception 'not allowed to adjust points' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', u.id,
      'email', u.email,
      'displayName', p.display_name,
      'points', public.synced_season_points(u.id),
      'seasonId', (rs.data ->> 'seasonId')::integer,
      'lastChange', (select max(r.updated_at) from public.rows r where r.user_id = u.id)
    ) order by lower(coalesce(p.display_name, u.email))), '[]'::jsonb)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.rows rs on rs.user_id = u.id and rs.tbl = 'rankState' and rs.id = '1' and not rs.deleted
  );
end;
$$;

-- Sets `target_user`'s season points to `new_points`; returns {points, delta}. Takes push_rows'
-- per-user lock, so the event's server_seq never lands behind a puller's cursor.
create or replace function public.admin_set_points(target_user uuid, new_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur integer;
  delta integer;
  season_start text;
  ev_id text := gen_random_uuid()::text;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not ('adjust_points' = any (public.my_permissions())) then
    raise exception 'not allowed to adjust points' using errcode = '42501';
  end if;
  if new_points is null or new_points < 0 or new_points > 1000000 then
    raise exception 'points must be between 0 and 1000000' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('rows:' || target_user::text));

  cur := public.synced_season_points(target_user);
  if cur is null then
    raise exception 'that user has not synced yet' using errcode = 'P0001';
  end if;
  delta := new_points - cur;
  if delta = 0 then
    return jsonb_build_object('points', cur, 'delta', 0);
  end if;

  select r.data ->> 'seasonStart' into season_start from public.rows r
    where r.user_id = target_user and r.tbl = 'rankState' and r.id = '1' and not r.deleted;
  -- The row exactly as the app stores a score event (src/types.ts ScoreEvent), dated inside the season.
  insert into public.rows (user_id, tbl, id, data, updated_at)
  values (target_user, 'scoreEvents', ev_id, jsonb_build_object(
    'id', ev_id,
    'label', 'Points adjustment',
    'date', greatest(public.season_today()::text, season_start),
    'basePoints', 0, 'prBonus', 0, 'streakMult', 1, 'dayFactor', 1,
    'total', delta,
    'breakdown', '[]'::jsonb,
    'updatedAt', now_ms
  ), now_ms);

  -- Friends see the new total now; the account's devices publish the same one on their next sync.
  update public.public_stats st set points = new_points, updated_at = now()
    where st.user_id = target_user;
  return jsonb_build_object('points', new_points, 'delta', delta);
end;
$$;

revoke all on function public.synced_season_points(uuid) from public, anon, authenticated;
revoke all on function public.admin_users() from public, anon;
revoke all on function public.admin_set_points(uuid, integer) from public, anon;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_set_points(uuid, integer) to authenticated;
