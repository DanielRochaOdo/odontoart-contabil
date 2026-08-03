import ExcelJS from "exceljs";
import {
  ContraprestacoesSettings,
  ContraprestacoesScope,
  ContraprestacoesReportId,
  ProcessedRecebidaRow,
} from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";
import { resolveContraprestacoesSettings } from "@/features/contraprestacoes/services/contraprestacoesSettings";

type CellKind = "string" | "number" | "currency" | "date";
export type WorkbookMode = "split" | "single";

export interface ColumnDefinition<T> {
  header: string;
  width: number;
  kind: CellKind;
  value: (row: T) => string | number | Date | null;
}

export interface WorkbookDefinition {
  reportId: ContraprestacoesReportId;
  fileName: string;
  mode: WorkbookMode;
  rows: ProcessedRecebidaRow[];
  columns: ColumnDefinition<ProcessedRecebidaRow>[];
}

export interface GeneratedWorkbook {
  reportId: ContraprestacoesReportId;
  fileName: string;
  buffer: Uint8Array;
}

const DATE_FORMAT = "dd/mm/yyyy";
const CURRENCY_FORMAT = '"R$" #,##0.00';
const NUMBER_FORMAT = "#,##0.00";

const BOLETO_TYPES = new Set(
  [
    "BANCO DO BRASIL CLINICO",
    "PIX ODONTOART - P4X",
    "ITAU PJ",
    "BANCO DO BRASIL CLINICO EMPRESA",
    "DEPOSITO BANCARIO BB",
    "PIX CLINICO",
    "PIX - CLINICO",
    "DEPOSITO BANCARIO ITAU",
    "DEPOSITO BANCARIO",
    "BRADESCO",
    "SANTANDER PMF",
  ].map((value) => normalizeText(value)),
);

const CARTAO_CREDITO_TYPES = new Set([
  "CARTAO DE CREDITO ODONTOART - P4X EXTERNO",
  "CARTAO DE CREDITO ODONTOART - P4X",
  "CARTAO DE CREDITO - REDE - PLANO",
  "CARTAO DE CREDITO - CENTERCOB - PLANO",
]);

const CARTAO_DEBITO_TYPES = new Set(["CARTAO DEBITO - PLANO"]);
const ENEL_TYPES = new Set(["ENEL CE"]);
const PIX_RECORRENTE_TYPES = new Set(["PIX RECORRENTE ODONTOART - P4X"]);

function competenciaToken(competencia: Competencia): string {
  return `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s/%.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function endOfNextMonth(competencia: Competencia): Date {
  return new Date(competencia.ano, competencia.mes + 1, 0);
}

function addDays(date: Date | null, days: number): Date | null {
  if (!date) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameOrPaymentDate(primary: Date | null, fallback: Date | null): Date | null {
  return primary ?? fallback;
}

function signedAdjustment(row: ProcessedRecebidaRow): number {
  return row.imposto + row.valorPagamento - row.titulo;
}

function desconto(row: ProcessedRecebidaRow): number {
  const adjustment = signedAdjustment(row);
  return adjustment < 0 ? Math.abs(adjustment) : 0;
}

function acrescimo(row: ProcessedRecebidaRow): number {
  const adjustment = signedAdjustment(row);
  return adjustment > 0 ? adjustment : 0;
}

function valorBruto(row: ProcessedRecebidaRow): number {
  return row.imposto + row.titulo;
}

function normalizedTipoRecebimento(row: ProcessedRecebidaRow): string {
  return normalizeText(row.tipoRecebimento);
}

function createWorksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: ProcessedRecebidaRow[],
  columns: ColumnDefinition<ProcessedRecebidaRow>[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));
  sheet.getRow(1).font = { name: "Calibri", size: 11, bold: true };

  rows.forEach((row) => {
    const values = columns.map((column) => column.value(row));
    sheet.addRow(values);
  });

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      if (column.kind === "date") {
        cell.numFmt = DATE_FORMAT;
      } else if (column.kind === "currency") {
        cell.numFmt = CURRENCY_FORMAT;
      } else if (column.kind === "number") {
        cell.numFmt = NUMBER_FORMAT;
      }
    });
  }
}

function splitRows(rows: ProcessedRecebidaRow[]): { pf: ProcessedRecebidaRow[]; pj: ProcessedRecebidaRow[] } {
  return {
    pf: rows.filter((row) => row.pessoaTipo === "PF"),
    pj: rows.filter((row) => row.pessoaTipo === "PJ"),
  };
}

async function buildWorkbook(definition: WorkbookDefinition): Promise<GeneratedWorkbook> {
  const workbook = new ExcelJS.Workbook();

  if (definition.mode === "single") {
    const normalizedFileName = normalizeText(definition.fileName);
    const sheetName = normalizedFileName.includes("DEVOLUCAO")
      ? "PF e PJ"
      : "Base";
    createWorksheet(
      workbook,
      sheetName,
      definition.rows,
      definition.columns,
    );
  } else {
    const { pf, pj } = splitRows(definition.rows);
    createWorksheet(workbook, "PF", pf, definition.columns);
    createWorksheet(workbook, "PJ", pj, definition.columns);
  }

  const data = await workbook.xlsx.writeBuffer();
  return {
    reportId: definition.reportId,
    fileName: definition.fileName,
    buffer: new Uint8Array(data),
  };
}

function commonColumnsBoletoRecovered(
): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "ISS", width: 14, kind: "currency", value: (row) => row.imposto },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    {
      header: "DATA CREDITO",
      width: 16,
      kind: "date",
      value: (row) => sameOrPaymentDate(row.dataCredito, row.dataPagamento),
    },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TARIFA", width: 14, kind: "currency", value: (row) => row.tarifa },
    { header: "TIPO RECEBIMENTO", width: 32, kind: "string", value: (row) => row.tipoRecebimento },
  ];
}

function commonColumnsBoletoReceived(
): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    {
      header: "DATA CREDITO",
      width: 16,
      kind: "date",
      value: (row) => sameOrPaymentDate(row.dataCredito, row.dataPagamento),
    },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TARIFA", width: 14, kind: "currency", value: (row) => row.tarifa },
    { header: "TIPO RECEBIMENTO", width: 32, kind: "string", value: (row) => row.tipoRecebimento },
  ];
}

function columnsCard(
  daysToCredit: number,
  feeRate: number,
): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    {
      header: "DATA CREDITO",
      width: 16,
      kind: "date",
      value: (row) => addDays(row.dataPagamento, daysToCredit),
    },
    {
      header: "TARIFA CALCULADA",
      width: 16,
      kind: "currency",
      value: (row) => row.valorPagamento * feeRate,
    },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TIPO RECEBIMENTO", width: 32, kind: "string", value: (row) => row.tipoRecebimento },
  ];
}

function columnsRecoveredCash(
): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "DATA CREDITO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
  ];
}

function columnsEnel(competencia: Competencia): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    {
      header: "DATA CREDITO",
      width: 16,
      kind: "date",
      value: () => endOfNextMonth(competencia),
    },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
  ];
}

function columnsReceivedCash(
  competencia: Competencia,
  destino: "Caixinha" | "Agente Recebedor - Banco do Brasil",
): ColumnDefinition<ProcessedRecebidaRow>[] {
  const creditDateKind = destino === "Caixinha" ? "date" : "date";
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    destino === "Caixinha"
      ? { header: "DATA CREDITO", width: 16, kind: creditDateKind, value: (row) => row.dataPagamento }
      : {
          header: "DATA CREDITO",
          width: 16,
          kind: "date",
          value: () => endOfNextMonth(competencia),
        },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    ...(destino === "Caixinha"
      ? [{ header: "DESTINO", width: 28, kind: "string" as const, value: () => destino }]
      : [
          {
            header: "DESTINO",
            width: 28,
            kind: "string" as const,
            value: () => destino,
          },
        ]),
  ];
}

function columnsDevolucao(): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "DATA CREDITO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TARIFA", width: 14, kind: "currency", value: (row) => row.tarifa },
    { header: "DESTINO", width: 28, kind: "string", value: () => "Entregue ao Dr. Tadeu" },
  ];
}

function columnsDebitoEmConta(fee: number): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "DATA CREDITO", width: 16, kind: "date", value: (row) => addDays(row.dataPagamento, 2) },
    { header: "TARIFA FIXA", width: 14, kind: "currency", value: () => fee },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
  ];
}

function columnsPixRecorrente(fee: number): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "DATA VENCIMENTO", width: 16, kind: "date", value: (row) => row.dataVencimento },
    { header: "DT. EMISSAO", width: 16, kind: "date", value: (row) => row.dtEmissao },
    { header: "NF", width: 16, kind: "string", value: (row) => row.nf },
    { header: "DATA PAGAMENTO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "VALOR BRUTO", width: 16, kind: "currency", value: valorBruto },
    { header: "DESCONTO", width: 16, kind: "currency", value: desconto },
    { header: "ACRESCIMO", width: 16, kind: "currency", value: acrescimo },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "DATA CREDITO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TARIFA FIXA", width: 14, kind: "currency", value: () => fee },
    {
      header: "TIPO RECEBIMENTO",
      width: 32,
      kind: "string",
      value: () => "PIX RECORRENTE ODONTOART - P4X",
    },
  ];
}

function columnsBaseTratada(): ColumnDefinition<ProcessedRecebidaRow>[] {
  return [
    { header: "CODIGO", width: 14, kind: "string", value: (row) => row.codigo },
    { header: "NOME", width: 42, kind: "string", value: (row) => row.nomeFantasia },
    { header: "CPF_CNPJ", width: 18, kind: "string", value: (row) => row.cpfCnpj },
    { header: "GRUPO EMPRESA", width: 22, kind: "string", value: (row) => row.grupoEmpresa },
    { header: "EMPRESA", width: 28, kind: "string", value: (row) => row.empresa },
    { header: "TIPO PARCELA", width: 20, kind: "string", value: (row) => row.tipoParcela },
    { header: "TIPO RECEBIMENTO", width: 28, kind: "string", value: (row) => row.tipoRecebimento },
    { header: "TIPO PAGAMENTO", width: 28, kind: "string", value: (row) => row.tipoPagamento },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "LOTE NF", width: 18, kind: "string", value: (row) => row.loteNf },
    { header: "NF", width: 18, kind: "string", value: (row) => row.nf },
    { header: "VALOR PAGAMENTO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "RECUPERADAS", width: 16, kind: "string", value: (row) => (row.recuperada ? "SIM" : "NAO") },
    { header: "GRUPO", width: 14, kind: "string", value: (row) => row.grupo },
    { header: "OBSERVACOES", width: 50, kind: "string", value: (row) => row.observacoes.join(" | ") },
  ];
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let current = seed || 1;
  return () => {
    current = (current + 0x6d2b79f5) | 0;
    let value = Math.imul(current ^ (current >>> 15), 1 | current);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRows(rows: ProcessedRecebidaRow[], seed: number): ProcessedRecebidaRow[] {
  const random = createSeededRandom(seed);
  const next = [...rows];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function takeRowsNearTargetDeterministic(
  rows: ProcessedRecebidaRow[],
  target: number,
  tolerance: number,
  seedKey: string,
): ProcessedRecebidaRow[] {
  if (rows.length === 0) return [];

  const minTarget = target * (1 - tolerance);
  const maxTarget = target * (1 + tolerance);
  let bestRows: ProcessedRecebidaRow[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTotal = 0;
  const baseSeed = hashText(seedKey);

  for (let attempt = 0; attempt < Math.min(64, rows.length * 2); attempt += 1) {
    const shuffled = shuffleRows(rows, baseSeed + attempt);
    const selected: ProcessedRecebidaRow[] = [];
    let total = 0;

    for (const row of shuffled) {
      const nextTotal = total + row.valorPagamento;
      if (nextTotal > maxTarget && total >= minTarget) continue;

      const currentDistance = Math.abs(target - total);
      const nextDistance = Math.abs(target - nextTotal);
      const improvesWithinCap = nextTotal <= maxTarget && nextDistance <= currentDistance;
      const needsMinimum = total < minTarget;

      if (selected.length === 0 || improvesWithinCap || needsMinimum) {
        selected.push(row);
        total = nextTotal;
      }
    }

    const inWindow = total >= minTarget && total <= maxTarget;
    const distance = Math.abs(target - total);
    const bestInWindow = bestTotal >= minTarget && bestTotal <= maxTarget;

    if (
      (inWindow && !bestInWindow) ||
      (inWindow === bestInWindow && distance < bestDistance)
    ) {
      bestRows = selected;
      bestDistance = distance;
      bestTotal = total;
    }
  }

  return bestRows.sort((left, right) => left.linhaOrigem - right.linhaOrigem);
}

export function buildWorkbookDefinitions(
  rows: ProcessedRecebidaRow[],
  competencia: Competencia,
  escopo: ContraprestacoesScope,
  settingsInput: ContraprestacoesSettings,
): WorkbookDefinition[] {
  const settings = resolveContraprestacoesSettings(settingsInput);
  const token = competenciaToken(competencia);
  const recuperadas = rows.filter((row) => row.grupo === "RECUPERADA");
  const recebidas = rows.filter((row) => row.grupo === "RECEBIDA");
  const devolucoes = recebidas.filter((row) => row.devolucaoMensalidade);
  const recebidasNormais = recebidas.filter((row) => !row.devolucaoMensalidade);
  const dinheiroRecebidas = recebidasNormais.filter((row) => normalizedTipoRecebimento(row) === "DINHEIRO");
  const caixinha = takeRowsNearTargetDeterministic(dinheiroRecebidas, 1000, 0.05, token);
  const caixinhaKeys = new Set(caixinha.map((row) => row.linhaOrigem));
  const agenteRecebedor = dinheiroRecebidas.filter((row) => !caixinhaKeys.has(row.linhaOrigem));
  const boletoRows = recebidasNormais.filter((row) => {
    if (caixinhaKeys.has(row.linhaOrigem)) return false;
    const tipo = normalizedTipoRecebimento(row);
    return BOLETO_TYPES.has(tipo);
  });

  const sharedDefinition: WorkbookDefinition = {
    reportId: "base-tratada",
    fileName: `BASE RECEBIDAS ${token} - Tratada.xlsx`,
    mode: "single",
    rows,
    columns: columnsBaseTratada(),
  };

  const recuperadasDefinitions: WorkbookDefinition[] = [
    {
      reportId: "recuperada-boleto",
      fileName: `Mensalidade Recuperados ${token} - Boleto.xlsx`,
      mode: "split",
      rows: recuperadas.filter((row) => BOLETO_TYPES.has(normalizedTipoRecebimento(row))),
      columns: commonColumnsBoletoRecovered(),
    },
    {
      reportId: "recuperada-cartao-credito",
      fileName: `Mensalidade Recuperados ${token} - Cartao de credito.xlsx`,
      mode: "split",
      rows: recuperadas.filter((row) => CARTAO_CREDITO_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsCard(31, settings.tarifaCartaoCredito),
    },
    {
      reportId: "recuperada-cartao-debito",
      fileName: `Mensalidade Recuperados ${token} - Cartao de debito.xlsx`,
      mode: "split",
      rows: recuperadas.filter((row) => CARTAO_DEBITO_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsCard(1, settings.tarifaCartaoDebito),
    },
    {
      reportId: "recuperada-dinheiro-caixinha",
      fileName: `Mensalidade Recuperados ${token} - Dinheiro - Caixinha.xlsx`,
      mode: "split",
      rows: recuperadas.filter((row) => normalizedTipoRecebimento(row) === "DINHEIRO"),
      columns: columnsRecoveredCash(),
    },
    {
      reportId: "recuperada-enel",
      fileName: `Mensalidade Recuperados ${token} - Enel.xlsx`,
      mode: "single",
      rows: recuperadas.filter((row) => ENEL_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsEnel(competencia),
    },
  ];

  const recebidasDefinitions: WorkbookDefinition[] = [
    {
      reportId: "recebida-boleto",
      fileName: `Mensalidade Recebida ${token} - Boleto.xlsx`,
      mode: "split",
      rows: boletoRows,
      columns: commonColumnsBoletoReceived(),
    },
    {
      reportId: "recebida-cartao-credito",
      fileName: `Mensalidade Recebida ${token} - Cartao de credito.xlsx`,
      mode: "split",
      rows: recebidasNormais.filter((row) => CARTAO_CREDITO_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsCard(31, settings.tarifaCartaoCredito),
    },
    {
      reportId: "recebida-cartao-debito",
      fileName: `Mensalidade Recebida ${token} - Cartao de debito.xlsx`,
      mode: "split",
      rows: recebidasNormais.filter((row) => CARTAO_DEBITO_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsCard(1, settings.tarifaCartaoDebito),
    },
    {
      reportId: "recebida-enel",
      fileName: `Mensalidade Recebida ${token} - Enel.xlsx`,
      mode: "single",
      rows: recebidasNormais.filter((row) => ENEL_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsEnel(competencia),
    },
    {
      reportId: "recebida-dinheiro-caixinha",
      fileName: `Mensalidade Recebida ${token} - Dinheiro - Caixinha.xlsx`,
      mode: "split",
      rows: caixinha,
      columns: columnsReceivedCash(competencia, "Caixinha"),
    },
    {
      reportId: "recebida-agente-recebedor",
      fileName: `Mensalidade Recebida ${token} - Agente recebedor.xlsx`,
      mode: "split",
      rows: agenteRecebedor,
      columns: columnsReceivedCash(competencia, "Agente Recebedor - Banco do Brasil"),
    },
    {
      reportId: "recebida-devolucao",
      fileName: `Mensalidade Recebida ${token} - Devolucao de Mensalidade.xlsx`,
      mode: "single",
      rows: devolucoes,
      columns: columnsDevolucao(),
    },
    {
      reportId: "recebida-debito-em-conta",
      fileName: `Mensalidade Recebida ${token} - Debito em Conta.xlsx`,
      mode: "single",
      rows: recebidasNormais.filter((row) => normalizedTipoRecebimento(row) === "DEBITO EM CONTA BB"),
      columns: columnsDebitoEmConta(settings.tarifaDebitoEmConta),
    },
    {
      reportId: "recebida-pix-recorrente",
      fileName: `Mensalidade Recebida ${token} - PIX Recorrente.xlsx`,
      mode: "split",
      rows: recebidasNormais.filter((row) => PIX_RECORRENTE_TYPES.has(normalizedTipoRecebimento(row))),
      columns: columnsPixRecorrente(settings.tarifaPixFixo),
    },
  ];

  return escopo === "recuperadas"
    ? [sharedDefinition, ...recuperadasDefinitions]
    : [sharedDefinition, ...recebidasDefinitions];
}

export class ContraprestacoesReportFactory {
  async buildReports(
    rows: ProcessedRecebidaRow[],
    competencia: Competencia,
    escopo: ContraprestacoesScope,
    settings: ContraprestacoesSettings,
  ): Promise<GeneratedWorkbook[]> {
    const definitions = buildWorkbookDefinitions(rows, competencia, escopo, settings);
    const workbooks: GeneratedWorkbook[] = [];
    for (const definition of definitions) {
      workbooks.push(await buildWorkbook(definition));
    }

    return workbooks;
  }
}
