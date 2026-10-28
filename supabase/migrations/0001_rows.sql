-- GymTracker cloud sync: one generic table mirrors the app's Dexie tables row by row.
-- Run once in the project's SQL editor (Supabase dashboard › SQL). Then:
--   Authentication › Email: keep "Enable email provider" on; edit the "Magic Link" template so
--   its body contains {{ .Token }} (the 6-digit code the app asks for) — a bare link cannot
--   return to the Android WebView.
--   Project Settings › API: copy the URL and the anon key into the build's .env
--   (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and the GitHub Actions secrets.

create sequence if not exists public.rows_server_seq;

create table if not exists public.rows (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text    not null,                 -- Dexie table name (src/db/backup.ts TABLES minus tombstones)
  id         text    not null,                 -- String(primary key): UUID, legacy integer, date, weekKey…
  data       jsonb   not null,                 -- the row exactly as the app stores it (carries its own typed key)
  updated_at bigint  not null,                 -- the row's updatedAt (ms): last-write-wins clock
  deleted    boolean not null default false,   -- a tombstone; rows are never physically removed
  server_seq bigint  not null default nextval('public.rows_server_seq'),  -- pull cursor
  primary key (user_id, tbl, id)
);

create index if not exists rows_user_seq on public.rows (user_id, server_seq);

alter table public.rows enable row level security;

drop policy if exists own_rows on public.rows;
create policy own_rows on public.rows
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Upsert a batch; an older write never overwrites a newer one (ties: a delete beats a live row).
-- Every accepted row gets a fresh server_seq so other devices pull it. Returns the caller's
-- newest server_seq (the pull cursor after this push).
create or replace function public.push_rows(p jsonb)
returns bigint
language sql
security invoker
set search_path = public
as $$
  with incoming as (
    select r.tbl, r.id, r.data, r.updated_at, coalesce(r.deleted, false) as deleted
    from jsonb_to_recordset(p) as r(tbl text, id text, data jsonb, updated_at bigint, deleted boolean)
  ),
  upserted as (
    insert into public.rows (user_id, tbl, id, data, updated_at, deleted)
    select auth.uid(), tbl, id, data, updated_at, deleted from incoming
    on conflict (user_id, tbl, id) do update
      set data       = excluded.data,
          updated_at = excluded.updated_at,
          deleted    = excluded.deleted,
          server_seq = nextval('public.rows_server_seq')
      where public.rows.updated_at < excluded.updated_at
         or (public.rows.updated_at = excluded.updated_at and excluded.deleted and not public.rows.deleted)
    returning server_seq
  )
  select coalesce((select max(server_seq) from public.rows where user_id = auth.uid()), 0);
$$;

revoke all on function public.push_rows(jsonb) from public;
grant execute on function public.push_rows(jsonb) to authenticated;

-- Optional live updates between devices (the app polls on resume/write anyway):
-- alter publication supabase_realtime add table public.rows;
