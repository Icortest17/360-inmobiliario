create extension if not exists pgcrypto;

create table if not exists public.projects (
  id text primary key,
  name text not null,
  status text not null default 'draft',
  address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  kind text not null,
  bucket text not null,
  path text not null,
  content_type text,
  size_bytes bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  type text not null,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  cost_estimate numeric(10, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  level text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  node_index integer not null,
  label text,
  position jsonb not null default '{}'::jsonb,
  rotation jsonb not null default '{}'::jsonb,
  source_frame_asset_id text references public.assets(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, node_index)
);

create index if not exists assets_project_id_idx on public.assets(project_id);
create index if not exists jobs_project_id_idx on public.jobs(project_id);
create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists job_events_job_id_idx on public.job_events(job_id);
create index if not exists tour_nodes_project_id_idx on public.tour_nodes(project_id);
