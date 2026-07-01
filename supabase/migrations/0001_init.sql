-- Race Telemetry Analyzer — schema
-- Postgres = tylko indeks i podsumowania. Surowa telemetria NIE trafia tu jako wiersze.

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  length_m numeric,
  sat_offset_lat double precision default 0,
  sat_offset_lon double precision default 0,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) default auth.uid(),
  track_id uuid references tracks(id),
  vehicle text,
  racer text,
  championship text,
  session_date date,
  sample_rate_hz int,
  duration_s numeric,
  raw_path text,
  processed_path text,
  best_lap_ms int,
  created_at timestamptz default now()
);

create table if not exists laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  lap_number int,
  lap_time_ms int,
  is_best boolean default false,
  is_valid boolean default true,
  beacon_start_s numeric,
  beacon_end_s numeric
);

create table if not exists sectors (
  id uuid primary key default gen_random_uuid(),
  lap_id uuid references laps(id) on delete cascade,
  sector_number int,
  sector_time_ms int
);

create index if not exists laps_session_id_idx on laps(session_id);
create index if not exists sessions_user_date_idx on sessions(user_id, session_date);

-- RLS
alter table sessions enable row level security;
alter table laps enable row level security;

do $$ begin
  create policy "own sessions" on sessions
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "own laps" on laps
    using (exists (
      select 1 from sessions s
      where s.id = laps.session_id and s.user_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;

-- sectors: dziedziczą własność po lap -> session
alter table sectors enable row level security;
do $$ begin
  create policy "own sectors" on sectors
    using (exists (
      select 1 from laps l join sessions s on s.id = l.session_id
      where l.id = sectors.lap_id and s.user_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;

-- tracks: współdzielone do odczytu (obrys/offset toru wspólny), zapis dla zalogowanych.
alter table tracks enable row level security;
do $$ begin
  create policy "read tracks" on tracks for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "write tracks" on tracks for insert with check (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "update tracks" on tracks for update using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- Storage buckety (prywatne) — utwórz w Dashboard lub tu:
insert into storage.buckets (id, name, public)
  values ('raw', 'raw', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('processed', 'processed', false) on conflict (id) do nothing;

-- Storage RLS: użytkownik widzi tylko własny prefix {user_id}/...
do $$ begin
  create policy "raw own files" on storage.objects for all
    using (bucket_id in ('raw','processed') and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id in ('raw','processed') and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
