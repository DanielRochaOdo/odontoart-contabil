import ExcelJS from "exceljs";
import { ProcessedRecebidaRow } from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";

type CellKind = "string" | "number" | "currency" | "date";
type WorkbookMode = "split" | "single";

interface ColumnDefinition<T> {
  header: string;
  width: number;
  kind: CellKind;
  value: (row: T) => string | number | Date | null;
}

interface WorkbookDefinition {
  fileName: string;
  mode: WorkbookMode;
  rows: ProcessedRecebidaRow[];
  columns: ColumnDefinition<ProcessedRecebidaRow>[];
}

interface GeneratedWorkbook {
  fileName: string;
  buffer: Buffer;
}

const DATE_FORMAT = "dd/mm/yyyy";
const CURRENCY_FORMAT = '"R$" #,##0.00';
const NUMBER_FORMAT = "#,##0.00";
const CARD_CREDIT_FEE = 0.0115;
const CARD_DEBIT_FEE = 0.0069;
const AGENTE_RECEBEDOR_FEE = 3.28;
const PIX_RECORRENTE_FEE = 2;

const BOLETO_TYPES = new Set([
  "BANCO DO BRASIL CLINICO",
  "PIX ODONTOART - P4X",
  "ITAU PJ",
  "BANCO DO BRASIL CLINICO EMPRESA",
  "DEPOSITO BANCARIO BB",
  "PIX CLINICO",
  "DEPOSITO BANCARIO ITAU",
  "BRADESCO",
  "SANTANDER PMF",
]);

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

function normalizedLote(row: ProcessedRecebidaRow): string {
  return normalizeText(row.loteNf);
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
    createWorksheet(workbook, "Base", definition.rows, definition.columns);
  } else {
    const { pf, pj } = splitRows(definition.rows);
    createWorksheet(workbook, "PF", pf, definition.columns);
    createWorksheet(workbook, "PJ", pj, definition.columns);
  }

  const data = await workbook.xlsx.writeBuffer();
  return {
    fileName: definition.fileName,
    buffer: Buffer.from(data),
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
    { header: "AJUSTE", width: 16, kind: "currency", value: signedAdjustment },
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
    { header: "AJUSTE", width: 16, kind: "currency", value: signedAdjustment },
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
    destino === "Caixinha"
      ? { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento }
      : { header: "AJUSTE", width: 16, kind: "currency", value: signedAdjustment },
    destino === "Caixinha"
      ? { header: "DATA CREDITO", width: 16, kind: creditDateKind, value: (row) => row.dataPagamento }
      : { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    destino === "Caixinha"
      ? { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela }
      : {
          header: "DATA CREDITO",
          width: 16,
          kind: "date",
          value: () => endOfNextMonth(competencia),
        },
    destino === "Caixinha"
      ? { header: "DESTINO", width: 28, kind: "string", value: () => destino }
      : { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    ...(destino === "Caixinha"
      ? []
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
    { header: "AJUSTE", width: 16, kind: "currency", value: signedAdjustment },
    { header: "RECEBIDO", width: 16, kind: "currency", value: (row) => row.valorPagamento },
    { header: "DATA CREDITO", width: 16, kind: "date", value: (row) => row.dataPagamento },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
    { header: "TARIFA", width: 14, kind: "currency", value: (row) => row.tarifa },
    { header: "DESTINO", width: 28, kind: "string", value: () => "Entregue ao Dr. Tadeu" },
  ];
}

function columnsDebitoEmConta(): ColumnDefinition<ProcessedRecebidaRow>[] {
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
    { header: "TARIFA FIXA", width: 14, kind: "currency", value: () => AGENTE_RECEBEDOR_FEE },
    { header: "PARCELA", width: 18, kind: "string", value: (row) => row.parcela },
  ];
}

function columnsPixRecorrente(): ColumnDefinition<ProcessedRecebidaRow>[] {
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
    { header: "TARIFA FIXA", width: 14, kind: "currency", value: () => PIX_RECORRENTE_FEE },
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

function takeRowsUntilNearTarget(rows: ProcessedRecebidaRow[], target: number): ProcessedRecebidaRow[] {
  const selected: ProcessedRecebidaRow[] = [];
  let total = 0;

  for (const row of rows) {
    const nextTotal = total + row.valorPagamento;
    if (selected.length === 0) {
      selected.push(row);
      total = nextTotal;
      continue;
    }

    const currentDistance = Math.abs(target - total);
    const nextDistance = Math.abs(target - nextTotal);

    if (nextDistance <= currentDistance || total < target) {
      selected.push(row);
      total = nextTotal;
      continue;
    }

    break;
  }

  return selected;
}

export class ContraprestacoesReportFactory {
  async buildReports(
    rows: ProcessedRecebidaRow[],
    competencia: Competencia,
  ): Promise<GeneratedWorkbook[]> {
    const token = competenciaToken(competencia);
    const recuperadas = rows.filter((row) => row.grupo === "RECUPERADA");
    const recebidas = rows.filter((row) => row.grupo === "RECEBIDA");
    const dinheiroRecebidas = recebidas.filter(
      (row) => normalizedTipoRecebimento(row) === "DINHEIRO" && normalizedLote(row) !== "DEVOLUCAO",
    );
    const caixinha = takeRowsUntilNearTarget(dinheiroRecebidas, 1000);
    const caixinhaKeys = new Set(caixinha.map((row) => row.linhaOrigem));
    const agenteRecebedor = dinheiroRecebidas.filter((row) => !caixinhaKeys.has(row.linhaOrigem));

    const definitions: WorkbookDefinition[] = [
      {
        fileName: `BASE RECEBIDAS ${token} - Tratada.xlsx`,
        mode: "single",
        rows,
        columns: columnsBaseTratada(),
      },
      {
        fileName: `Mensalidade Recuperados ${token} - Boleto.xlsx`,
        mode: "split",
        rows: recuperadas.filter((row) => BOLETO_TYPES.has(normalizedTipoRecebimento(row))),
        columns: commonColumnsBoletoRecovered(),
      },
      {
        fileName: `Mensalidade Recuperados ${token} - Cartao de credito.xlsx`,
        mode: "split",
        rows: recuperadas.filter((row) => CARTAO_CREDITO_TYPES.has(normalizedTipoRecebimento(row))),
        columns: columnsCard(31, CARD_CREDIT_FEE),
      },
      {
        fileName: `Mensalidade Recuperados ${token} - Cartao de debito.xlsx`,
        mode: "split",
        rows: recuperadas.filter((row) => CARTAO_DEBITO_TYPES.has(normalizedTipoRecebimento(row))),
        columns: columnsCard(1, CARD_DEBIT_FEE),
      },
      {
        fileName: `Mensalidade Recuperados ${token} - Dinheiro - Caixinha.xlsx`,
        mode: "split",
        rows: recuperadas.filter((row) => normalizedTipoRecebimento(row) === "DINHEIRO"),
        columns: columnsRecoveredCash(),
      },
      {
        fileName: `Mensalidade Recuperados ${token} - Enel.xlsx`,
        mode: "single",
        rows: recuperadas.filter(
          (row) => ENEL_TYPES.has(normalizedTipoRecebimento(row)) && row.pessoaTipo === "PF",
        ),
        columns: columnsEnel(competencia),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Boleto.xlsx`,
        mode: "split",
        rows: recebidas.filter(
          (row) =>
            BOLETO_TYPES.has(normalizedTipoRecebimento(row)) && normalizedLote(row) !== "DEVOLUCAO",
        ),
        columns: commonColumnsBoletoReceived(),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Cartao de credito.xlsx`,
        mode: "split",
        rows: recebidas.filter((row) => CARTAO_CREDITO_TYPES.has(normalizedTipoRecebimento(row))),
        columns: columnsCard(31, CARD_CREDIT_FEE),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Cartao de debito.xlsx`,
        mode: "split",
        rows: recebidas.filter((row) => CARTAO_DEBITO_TYPES.has(normalizedTipoRecebimento(row))),
        columns: columnsCard(1, CARD_DEBIT_FEE),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Enel.xlsx`,
        mode: "single",
        rows: recebidas.filter(
          (row) => ENEL_TYPES.has(normalizedTipoRecebimento(row)) && row.pessoaTipo === "PF",
        ),
        columns: columnsEnel(competencia),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Dinheiro - Caixinha.xlsx`,
        mode: "split",
        rows: caixinha,
        columns: columnsReceivedCash(competencia, "Caixinha"),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Agente recebedor.xlsx`,
        mode: "split",
        rows: agenteRecebedor,
        columns: columnsReceivedCash(competencia, "Agente Recebedor - Banco do Brasil"),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Devolucao de Mensalidade.xlsx`,
        mode: "single",
        rows: recebidas.filter((row) => normalizedLote(row) === "DEVOLUCAO"),
        columns: columnsDevolucao(),
      },
      {
        fileName: `Mensalidade Recebida ${token} - Debito em Conta.xlsx`,
        mode: "single",
        rows: recebidas.filter((row) => normalizedTipoRecebimento(row) === "DEBITO EM CONTA BB"),
        columns: columnsDebitoEmConta(),
      },
      {
        fileName: `Mensalidade Recebida ${token} - PIX Recorrente.xlsx`,
        mode: "split",
        rows: recebidas.filter((row) => PIX_RECORRENTE_TYPES.has(normalizedTipoRecebimento(row))),
        columns: columnsPixRecorrente(),
      },
    ];

    const workbooks: GeneratedWorkbook[] = [];
    for (const definition of definitions) {
      workbooks.push(await buildWorkbook(definition));
    }

    return workbooks;
  }
}
