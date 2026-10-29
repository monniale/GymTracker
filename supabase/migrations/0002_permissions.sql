-- GymTracker permissions: actions only some accounts may take (e.g. ending a season early).
-- Run once in the project's SQL editor after 0001_rows.sql.
--
-- A role is granted to an email address (the account's verified sign-in email), so it can be
-- given before that person first signs in. Both tables are closed to the API: manage them here,
-- in the SQL editor, e.g.
--   insert into public.user_roles (email, role) values ('someone@example.com', 'admin');
--   delete from public.user_roles where email = 'someone@example.com' and role = 'admin';
--   insert into public.role_permissions (role, permission) values ('admin', 'another_permission');
-- The app asks `my_permissions()` on every sync and keeps the answer on the device, so a change
-- reaches a device on its next sync. Permission names the app knows: `end_season`.

create table if not exists public.role_permissions (
  role       text not null,
  permission text not null,
  primary key (role, permission)
);

create table if not exists public.user_roles (
  email text not null,
  role  text not null,
  primary key (email, role),
  constraint user_roles_email_lower check (email = lower(email))
);

-- RLS on and no policies: the anon and signed-in API roles can neither read nor change either
-- table. Only the SQL editor can, and `my_permissions()` reads them for the caller.
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
revoke all on public.role_permissions, public.user_roles from anon, authenticated;

-- The signed-in caller's permissions, through every role granted to their email.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rp.permission order by rp.permission), '{}')
  from auth.users u
  join public.user_roles ur on ur.email = lower(u.email)
  join public.role_permissions rp on rp.role = ur.role
  where u.id = auth.uid()
$$;

revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- The admin role ends seasons; the owner holds it.
insert into public.role_permissions (role, permission) values ('admin', 'end_season')
  on conflict do nothing;
insert into public.user_roles (email, role) values ('monnialessandro05@gmail.com', 'admin')
  on conflict do nothing;
