-- The tables behind a client's page for their website. Run this once in Supabase: SQL Editor, New query, paste, Run.
--
-- Only the server reads and writes these, with the service role key (SUPABASE_SERVICE_ROLE_KEY on Vercel). Row level
-- security is switched on with no policies, so the public anon key can read nothing here.

create extension if not exists pgcrypto;

create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,           -- sha256 of the private link; the link itself is never stored
  url         text not null,                  -- the origin that is scanned, e.g. https://example.com
  host        text not null,
  platform    text not null default '',       -- shopify | wordpress | woocommerce | wix | squarespace | empty if unknown
  name        text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists scans (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  scanned_at  timestamptz not null default now(),
  score       numeric,
  label       text not null default '',
  result      jsonb not null                  -- the whole audit: checks, evidence, fixes, prepared drafts
);
create index if not exists scans_site_time on scans (site_id, scanned_at);

create table if not exists fix_states (
  site_id     uuid not null references sites(id) on delete cascade,
  check_id    text not null,
  state       text not null check (state in ('open', 'self', 'asked_fixer')),
  updated_at  timestamptz not null default now(),
  primary key (site_id, check_id)
);

-- The Asker: what the client told us about their business, and every time we asked AI assistants about it.
create table if not exists profiles (
  site_id     uuid primary key references sites(id) on delete cascade,
  name        text not null,
  aliases     text[] not null default '{}',
  city        text not null default '',
  country     text not null default '',
  areas       text[] not null default '{}',
  categories  text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

create table if not exists asker_runs (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  ran_at      timestamptz not null default now(),
  status      text not null default 'done',   -- running while the questions are being asked, then done or failed
  model       text not null default '',
  asked       int not null,
  answered    int not null,
  named       int not null,                   -- answers that named the business
  result      jsonb not null                  -- the questions, the answers, the other shops named
);
-- for a table made by an earlier version of this file
alter table asker_runs add column if not exists status text not null default 'done';
create index if not exists asker_runs_site_time on asker_runs (site_id, ran_at);
create index if not exists asker_runs_time on asker_runs (ran_at);

-- A run is asked a question at a time, each in its own request, so each answer is kept as it arrives.
create table if not exists asker_answers (
  run_id      uuid not null references asker_runs(id) on delete cascade,
  idx         int not null,
  answer      text not null default '',
  named       boolean not null default false,
  failed      boolean not null default false,
  error       text not null default '',
  primary key (run_id, idx)
);

alter table sites enable row level security;
alter table scans enable row level security;
alter table fix_states enable row level security;
alter table profiles enable row level security;
alter table asker_runs enable row level security;
alter table asker_answers enable row level security;

-- Newer Supabase projects do not give the API roles access to new tables by themselves. The server uses the service
-- role, so that is the only role given access; the public anon and authenticated roles still see nothing.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

notify pgrst, 'reload schema';
