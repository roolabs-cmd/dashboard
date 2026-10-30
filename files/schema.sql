-- Weather schema for Supabase (Postgres)
-- Run in: Supabase dashboard > SQL Editor.

-- 1) One-row settings table: where you live and which units to use.
create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),  -- forces a single row
  location_name    text not null default 'Home',
  latitude         numeric(8,5) not null,
  longitude        numeric(8,5) not null,
  temperature_unit text not null default 'fahrenheit'
                   check (temperature_unit in ('fahrenheit', 'celsius')),
  updated_at       timestamptz not null default now()
);

-- 2) Weather cache: one row per kind and location, overwritten on refresh,
--    so the table never grows.
create table if not exists public.weather_cache (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('forecast', 'air_quality')),
  latitude    numeric(8,5) not null,
  longitude   numeric(8,5) not null,
  payload     jsonb not null,                -- raw Open-Meteo response
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  unique (kind, latitude, longitude)
);

create index if not exists weather_cache_expires_idx
  on public.weather_cache (expires_at);

-- Keep updated_at current on settings changes.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Security: turn on row level security with NO public policies.
-- The browser (anon key) can't read or write these tables.
-- Only your Netlify function, using the service_role key, can.
alter table public.app_settings enable row level security;
alter table public.weather_cache enable row level security;

-- Starting settings (placeholder location: change to yours).
insert into public.app_settings (id, location_name, latitude, longitude, temperature_unit)
values (1, 'Rancho Cucamonga', 34.1064, -117.5931, 'fahrenheit')
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- How the Netlify function will use the cache (reference only):
--
-- Read, and use it if still fresh:
--   select payload from public.weather_cache
--   where kind = 'forecast' and latitude = :lat and longitude = :lon
--     and expires_at > now();
--
-- If missing or expired, fetch Open-Meteo, then save (overwrites old row):
--   insert into public.weather_cache (kind, latitude, longitude, payload, fetched_at, expires_at)
--   values ('forecast', :lat, :lon, :payload, now(), now() + interval '15 minutes')
--   on conflict (kind, latitude, longitude)
--   do update set payload = excluded.payload,
--                 fetched_at = excluded.fetched_at,
--                 expires_at = excluded.expires_at;
-- ---------------------------------------------------------------
