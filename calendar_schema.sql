-- Calendar tables for Supabase. Run in SQL Editor (after schema.sql).

-- Stores the Google login (refresh token). One row only.
create table if not exists public.google_auth (
  id            int primary key default 1 check (id = 1),
  refresh_token text not null,
  scope         text,
  updated_at    timestamptz not null default now()
);

-- Remembers which calendars you turned off in the sidebar.
create table if not exists public.calendar_prefs (
  id          int primary key default 1 check (id = 1),
  hidden_ids  text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

-- Same protection as before: RLS on, no public policies.
-- Only the Netlify functions (secret key) can touch these.
alter table public.google_auth    enable row level security;
alter table public.calendar_prefs enable row level security;
