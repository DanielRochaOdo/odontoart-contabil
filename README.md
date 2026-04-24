# Odontoart Contábil

Sistema web para processamento de eventos e exportação dos **4 Arquivos Contabilidade** em `.xlsx`.

## Stack
- Next.js (App Router) + TypeScript
- CSS (layout e componentes personalizados)
- ExcelJS (leitura e geração de planilhas com fórmulas)
- JSZip (download único com os 4 arquivos)
- Supabase (log opcional de processamento)

## Módulo Implementado
- Sidebar lateral esquerda com módulos
- Primeiro módulo ativo: `Eventos`
- Upload de:
  - `Eventos Conhecidos (.xlsx)`
  - `Eventos Liquidados (.xlsx)`
- Botão compacto com ícone para exportação
- Mensagens de erro em linguagem de contabilidade

## Regras de Negócio Aplicadas
- Excluir modelos:
  - `KITS ORTODONTICOS - SEM ISS BB`
  - `KITS ORTODONTICOS - NF EXTERNO 3% -BB`
- Excluir linhas com `Valor Bruto = 0`
- Separação:
  - Clínico e Ortodontia
  - PF e PJ
- Conhecidos:
  - `DT. PAGTO` no último dia do mês da competência
  - `DT. OCORR` conforme regra (externo mês anterior / interno mês vigente para clínico)
  - `LIQUIDO = TOTAL PAGO`
  - Em ortodontia: `VL. BRUTO = ORTODONTIA`
- Liquidados:
  - Conciliação por `LOTE` com conhecidos
  - Regra: Se não constar, adicionar o registro (linha) da planilha do evento conhecido.
  - `DT. PAGTO` usa data real de pagamento
  - `BANCO` usa base principal
  - Fórmulas preservadas (`5952`, líquido aging, totalizadores)

## Saída
Ao processar, o sistema gera um `.zip` com:
- `EVENTOS CONHECIDOS - AAAA-MM.xlsx`
- `EVENTOS CONHECIDOS - AAAA-MM - Ortodontia.xlsx`
- `EVENTOS LIQUIDADOS - AAAA-MM.xlsx`
- `EVENTOS LIQUIDADOS - AAAA-MM - Ortodontia.xlsx`

## Rodar localmente
```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Supabase (opcional)
Para gravar log de processamento, configure:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Tabela esperada: `eventos_processamentos`.
