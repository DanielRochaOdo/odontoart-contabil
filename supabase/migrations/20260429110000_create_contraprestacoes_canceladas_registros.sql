create table if not exists public.contraprestacoes_canceladas_registros (
  id bigserial primary key,
  competencia text not null,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  cpt text,
  codigo text not null,
  nome text not null,
  emissao date,
  vencimento date,
  valor_emitido numeric(14,2) not null default 0,
  numero_parc text not null default '',
  numero_nf text not null default '',
  origem text not null default 'MANUAL',
  criado_em timestamptz not null default now()
);

create index if not exists idx_canceladas_competencia
  on public.contraprestacoes_canceladas_registros (competencia);

create index if not exists idx_canceladas_ano_mes
  on public.contraprestacoes_canceladas_registros (ano desc, mes desc);

create index if not exists idx_canceladas_numero_parc
  on public.contraprestacoes_canceladas_registros (numero_parc);

create index if not exists idx_canceladas_criado_em
  on public.contraprestacoes_canceladas_registros (criado_em desc);
