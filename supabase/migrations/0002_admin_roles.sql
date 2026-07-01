-- Role admina: tabela app_admins + funkcja is_admin() (bez danych/haseł).
create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

alter table app_admins enable row level security;

-- każdy zalogowany widzi TYLKO swój wiersz (klient sprawdza czy jest adminem)
do $$ begin
  create policy "read own admin row" on app_admins for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- czy bieżący użytkownik jest adminem
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to authenticated;

-- Nadanie roli admina konkretnemu użytkownikowi (ustawiane ręcznie po utworzeniu konta):
--   insert into app_admins (user_id)
--   select id from auth.users where email = 'ADMIN@EXAMPLE.COM'
--   on conflict do nothing;
