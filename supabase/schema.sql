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

alter table sites enable row level security;
alter table scans enable row level security;
alter table fix_states enable row level security;
