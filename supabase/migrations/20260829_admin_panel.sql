-- База для панели администратора VerbaIDE. Выполните в Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Создаём профиль для каждого нового пользователя. Сервисный код при этом
-- может безопасно менять только роль и флаг блокировки.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_profile_for_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

drop policy if exists "users view own profile" on public.profiles;
create policy "users view own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists "admins read audit" on public.admin_audit_log;
create policy "admins read audit" on public.admin_audit_log for select using (public.is_admin());

-- После первого входа назначьте себя вручную, подставив UUID из Authentication → Users:
-- insert into public.profiles (id, role) values ('ВАШ-UUID', 'admin')
-- on conflict (id) do update set role = 'admin';
