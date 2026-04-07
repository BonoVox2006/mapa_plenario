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

