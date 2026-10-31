-- Saved morning briefs, one per day. Run in Supabase SQL Editor.
create table if not exists public.daily_brief (
  day        date primary key,
  text       text not null,
  sources    jsonb not null default '[]',
  created_at timestamptz not null default now()
);
-- Same protection as the other tables: RLS on, no public policies.
alter table public.daily_brief enable row level security;
