alter table public.eventos_processamentos
  add column if not exists detalhes jsonb not null default '{}'::jsonb;
