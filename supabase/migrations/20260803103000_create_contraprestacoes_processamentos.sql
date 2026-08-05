create table if not exists public.contraprestacoes_processamentos (
  id bigserial primary key,
  competencia text not null,
  escopo text not null check (escopo in ('recebidas', 'recuperadas')),
  entrada_base integer not null default 0,
  registros_tratados integer not null default 0,
  recuperadas integer not null default 0,
  recebidas integer not null default 0,
  devolucoes integer not null default 0,
  arquivos_gerados integer not null default 0,
  total_valor_pagamento numeric(14, 2) not null default 0,
  arquivo_nome text not null,
  storage_path text,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_contraprestacoes_processamentos_competencia
  on public.contraprestacoes_processamentos (competencia);

create index if not exists idx_contraprestacoes_processamentos_escopo
  on public.contraprestacoes_processamentos (escopo);

create index if not exists idx_contraprestacoes_processamentos_criado_em
  on public.contraprestacoes_processamentos (criado_em desc);

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'contraprestacoes-relatorios'
  ) then
    insert into storage.buckets (id, name, public)
    values ('contraprestacoes-relatorios', 'contraprestacoes-relatorios', false);
  end if;
end $$;
