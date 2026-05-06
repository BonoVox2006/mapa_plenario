-- Executar no SQL Editor do Supabase (projeto novo para este app).

create table if not exists public.plenario_state (
  layout_id text primary key,
  allocations jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Opcional: índice para depuração de atualizações
create index if not exists idx_plenario_state_updated_at
  on public.plenario_state (updated_at desc);

-- Snapshot de lideranças (scraping da página da Câmara via Netlify Function + service_role)
create table if not exists public.liderancas_snapshot (
  row_key text primary key,
  scope_type text not null,
  scope_name text not null,
  role_type text not null check (role_type in ('lider', 'vice_lider', 'representante')),
  deputado_id_camara integer,
  deputado_nome text not null,
  sigla_partido text,
  uf text,
  scope_label text,
  source_url text not null,
  source_hash text,
  active boolean not null default true,
  captured_at timestamptz not null default now()
);

create index if not exists idx_liderancas_snapshot_active_deputado
  on public.liderancas_snapshot (active, deputado_id_camara);

create index if not exists idx_liderancas_snapshot_active_nome
  on public.liderancas_snapshot (active, lower(deputado_nome));

create table if not exists public.liderancas_meta (
  id integer primary key default 1 check (id = 1),
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_source_hash text,
  last_item_count integer not null default 0
);

insert into public.liderancas_meta (id) values (1)
  on conflict (id) do nothing;

alter table public.liderancas_snapshot enable row level security;
alter table public.liderancas_meta enable row level security;

revoke all on table public.liderancas_snapshot from anon, authenticated;
revoke all on table public.liderancas_meta from anon, authenticated;

grant all on table public.liderancas_snapshot to service_role;
grant all on table public.liderancas_meta to service_role;

