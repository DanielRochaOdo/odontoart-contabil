create table if not exists public.eventos_processamentos (
  id bigserial primary key,
  competencia text not null,
  entrada_conhecidos integer not null default 0,
  entrada_liquidados integer not null default 0,
  conhecidos_classificados integer not null default 0,
  liquidados_classificados integer not null default 0,
  excluidos_kits integer not null default 0,
  excluidos_valor_zero integer not null default 0,
  lotes_adicionados_liquidado integer not null default 0,
  avisos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_eventos_processamentos_competencia
  on public.eventos_processamentos (competencia);

create index if not exists idx_eventos_processamentos_criado_em
  on public.eventos_processamentos (criado_em desc);
