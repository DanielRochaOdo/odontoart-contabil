import ExcelJS from "exceljs";
import { Competencia } from "@/features/eventos/domain/types";
import {
  competenciaToString,
  coerceDate,
  coerceNumber,
  coerceString,
  lastDayOfMonth,
  normalizeText,
} from "@/features/eventos/services/utils";
import {
  AgingProcessInput,
  AgingProcessOutput,
  AgingSummary,
} from "@/features/aging/domain/types";

const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = '"R$" #,##0.00';
const HEADER_FILL = "FFFFFF00";

const RECEIVING_HEADERS = [
  "Cpt",
  "Dt_emissão NF",
  "Nº NF",
  "CÓDIGO",
  "NOME",
  "EMISSAO",
  "Per.Cob.",
  "VENCIMENTO",
  "Nº Parc",
  "RPS",
  "VALOR_EMITIDO",
];

const EVENT_HEADERS = [
  "COMP",
  "DT AVISO",
  "CÓDIGO",
  "LOTE",
  "NOME - PRESTADOR",
  "PF/PJ",
  "Modelo de Pgto",
  "CNPJ/CPF",
  "DOCUMENTO",
  "N. DOC",
  "EMISSÃO",
  "VENCIMENTO",
  "REGISTRO",
  "VL. PROVISÃO LIQUIDO",
];

const AGING_BUCKETS = [
  { key: "aVencer", label: "a vencer" },
  { key: "ate30", label: "Até 30 dias" },
  { key: "de31a60", label: "de 31 a 60 dias " },
  { key: "de61a90", label: "de 61 a 90 dias " },
  { key: "de91a120", label: "de 91 a 120 dias " },
  { key: "de121a365", label: "de 121 a 365 dias" },
  { key: "acima365", label: "ACIMA 365 DIAS" },
] as const;

type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

interface AgingSourceRow {
  codigo: string;
  nome: string;
  cpfCnpj: string;
  tipoPessoa: string;
  dataVencimento: Date | null;
  imposto: number;
  titulo: number;
  parcela: string;
  nf: string;
  dtEmissao: Date | null;
}

interface SourceColumns {
  codigo: number;
  nome: number;
  cpfCnpj: number;
  tipoPessoa: number;
  dataVencimento: number;
  imposto: number;
  titulo: number;
  parcela: number;
  nf: number;
  dtEmissao: number;
}

interface AgingOutputRow {
  cpt: Date | null;
  emissao: Date | null;
  nf: string;
  codigo: string;
  nome: string;
  vencimento: Date | null;
  parcela: string;
  valor: number;
}

interface AgingTotals {
  aVencer: number;
  ate30: number;
  de31a60: number;
  de61a90: number;
  de91a120: number;
  de121a365: number;
  acima365: number;
}

interface ReceivingSectionResult {
  totalRow: number;
  summaryRows: Partial<Record<AgingBucketKey, number>>;
  summaryTotalRow: number;
}

function normalized(value: unknown): string {
  return normalizeText(coerceString(value)).replace(/[^\w]/g, "");
}

function headerMap(sheet: ExcelJS.Worksheet, rowNumber: number): Map<string, number> {
  const result = new Map<string, number>();
  const row = sheet.getRow(rowNumber);
  for (let col = 1; col <= Math.max(sheet.columnCount, sheet.actualColumnCount); col += 1) {
    const value = normalized(row.getCell(col).value);
    if (value && !result.has(value)) result.set(value, col);
  }
  return result;
}

function findColumn(map: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const value = map.get(normalized(alias));
    if (value) return value;
  }
  return -1;
}

function resolveSourceColumns(sheet: ExcelJS.Worksheet): { headerRow: number; columns: SourceColumns } {
  for (let rowNumber = 1; rowNumber <= Math.min(15, sheet.rowCount); rowNumber += 1) {
    const map = headerMap(sheet, rowNumber);
    const columns: SourceColumns = {
      codigo: findColumn(map, ["Código", "Codigo"]),
      nome: findColumn(map, ["Nome Fantasia", "Nome"]),
      cpfCnpj: findColumn(map, ["CPF_CNPJ", "CPF/CNPJ", "CNPJ/CPF"]),
      tipoPessoa: findColumn(map, ["TIPO", "Tipo Pessoa", "PF/PJ"]),
      dataVencimento: findColumn(map, ["Data Vencimento", "Vencimento"]),
      imposto: findColumn(map, ["Imposto"]),
      titulo: findColumn(map, ["Título", "Titulo"]),
      parcela: findColumn(map, ["Parcela"]),
      nf: findColumn(map, ["NF"]),
      dtEmissao: findColumn(map, ["Dt. Emissão", "Dt. Emissao", "Data Emissao"]),
    };
    const required = [
      columns.codigo,
      columns.nome,
      columns.cpfCnpj,
      columns.dataVencimento,
      columns.imposto,
      columns.titulo,
      columns.parcela,
      columns.nf,
      columns.dtEmissao,
    ];
    if (required.every((value) => value > 0)) return { headerRow: rowNumber, columns };
  }

  throw new Error(
    'A aba "Planilha1" da Base Aging Mensalidades nao possui o layout esperado. ' +
      "Verifique as colunas Código, CPF_CNPJ, TIPO, Data Vencimento, Imposto, Título, Parcela, NF e Dt. Emissão.",
  );
}

function resolveSourceSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  const planilha1 = workbook.worksheets.find((sheet) => normalized(sheet.name) === "PLANILHA1");
  if (planilha1) return planilha1;

  const candidate = workbook.worksheets.find((sheet) => {
    try {
      resolveSourceColumns(sheet);
      return true;
    } catch {
      return false;
    }
  });
  if (candidate) return candidate;

  throw new Error('Aba "Planilha1" nao encontrada na Base Aging Mensalidades.');
}

function readSourceRows(
  sheet: ExcelJS.Worksheet,
  layout: { headerRow: number; columns: SourceColumns },
): AgingSourceRow[] {
  const rows: AgingSourceRow[] = [];
  for (let rowNumber = layout.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const c = layout.columns;
    const parsed: AgingSourceRow = {
      codigo: coerceString(row.getCell(c.codigo).value),
      nome: coerceString(row.getCell(c.nome).value),
      cpfCnpj: coerceString(row.getCell(c.cpfCnpj).value),
      tipoPessoa: c.tipoPessoa > 0 ? coerceString(row.getCell(c.tipoPessoa).value) : "",
      dataVencimento: coerceDate(row.getCell(c.dataVencimento).value),
      imposto: coerceNumber(row.getCell(c.imposto).value),
      titulo: coerceNumber(row.getCell(c.titulo).value),
      parcela: coerceString(row.getCell(c.parcela).value),
      nf: coerceString(row.getCell(c.nf).value),
      dtEmissao: coerceDate(row.getCell(c.dtEmissao).value),
    };
    if (parsed.codigo || parsed.nome || parsed.nf) rows.push(parsed);
  }
  return rows;
}

function isPessoaFisica(row: AgingSourceRow): boolean {
  const tipo = normalized(row.tipoPessoa);
  if (tipo.includes("PJ") || tipo.includes("JURIDICA")) return false;
  if (tipo.includes("PF") || tipo.includes("FISICA")) return true;
  return row.cpfCnpj.replace(/\D/g, "").length === 11;
}

function daysBetween(left: Date, right: Date): number {
  const leftUtc = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const rightUtc = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.floor((leftUtc - rightUtc) / 86400000);
}

function agingBucket(days: number): AgingBucketKey {
  if (days <= 0) return "aVencer";
  if (days <= 30) return "ate30";
  if (days <= 60) return "de31a60";
  if (days <= 90) return "de61a90";
  if (days <= 120) return "de91a120";
  if (days <= 365) return "de121a365";
  return "acima365";
}

function emptyTotals(): AgingTotals {
  return {
    aVencer: 0,
    ate30: 0,
    de31a60: 0,
    de61a90: 0,
    de91a120: 0,
    de121a365: 0,
    acima365: 0,
  };
}

function calculateTotals(rows: AgingOutputRow[], competencia: Competencia): AgingTotals {
  const totals = emptyTotals();
  const reportDate = lastDayOfMonth(competencia);
  rows.forEach((row) => {
    const bucket = row.vencimento ? agingBucket(daysBetween(reportDate, row.vencimento)) : "aVencer";
    totals[bucket] += row.valor;
  });
  return totals;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number): void {
  cell.value = { formula, result };
  cell.numFmt = MONEY_FORMAT;
}

function writeReceivingRow(sheet: ExcelJS.Worksheet, rowNumber: number, item: AgingOutputRow): void {
  const row = sheet.getRow(rowNumber);
  row.getCell("A").value = item.cpt;
  row.getCell("B").value = item.emissao;
  row.getCell("C").value = item.nf;
  row.getCell("D").value = item.codigo;
  row.getCell("E").value = item.nome;
  row.getCell("F").value = item.emissao;
  row.getCell("H").value = item.vencimento;
  row.getCell("I").value = item.parcela;
  row.getCell("K").value = item.valor;
  ["A", "B", "F", "H"].forEach((column) => {
    row.getCell(column).numFmt = DATE_FORMAT;
  });
  row.getCell("K").numFmt = MONEY_FORMAT;
}

function writeSummary(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  type: "PF" | "PJ",
  totals: AgingTotals,
): { summaryRows: Partial<Record<AgingBucketKey, number>>; summaryTotalRow: number } {
  const pjKeys: AgingBucketKey[] = ["de31a60", "ate30", "aVencer"];
  const pfKeys: AgingBucketKey[] = ["acima365", "de121a365", "de91a120", "de61a90", "de31a60", "ate30", "aVencer"];
  const keys = type === "PJ" ? pjKeys : pfKeys;

  const title = sheet.getRow(startRow);
  title.getCell("G").value = type === "PJ" ? "Dias (Vencimento)" : "Dias";
  title.getCell(type === "PJ" ? "I" : "H").value = "R$";
  title.font = { bold: true };

  const summaryRows: Partial<Record<AgingBucketKey, number>> = {};
  keys.forEach((key, index) => {
    const rowNumber = startRow + index + 1;
    const bucket = AGING_BUCKETS.find((item) => item.key === key);
    if (!bucket) return;
    const row = sheet.getRow(rowNumber);
    row.getCell("G").value = bucket.label;
    row.getCell(type === "PJ" ? "I" : "H").value = totals[key];
    row.getCell(type === "PJ" ? "I" : "H").numFmt = MONEY_FORMAT;
    summaryRows[key] = rowNumber;
  });

  const summaryTotalRow = startRow + keys.length + 1;
  const total = sheet.getRow(summaryTotalRow);
  total.getCell("G").value = "TOTAL";
  const valueColumn = type === "PJ" ? "I" : "H";
  const firstValueRow = startRow + 1;
  const lastValueRow = summaryTotalRow - 1;
  const totalValue = keys.reduce((sum, key) => sum + totals[key], 0);
  setFormula(total.getCell(valueColumn), `SUBTOTAL(9,${valueColumn}${firstValueRow}:${valueColumn}${lastValueRow})`, totalValue);
  total.font = { bold: true };
  return { summaryRows, summaryTotalRow };
}

function writeReceivingSection(
  sheet: ExcelJS.Worksheet,
  titleRow: number,
  type: "PF" | "PJ",
  rows: AgingOutputRow[],
  competencia: Competencia,
): ReceivingSectionResult {
  const headerRow = titleRow + 1;
  const dataStart = headerRow + 1;
  const dataEnd = dataStart + rows.length - 1;
  const totalRow = dataStart + rows.length;

  sheet.getRow(titleRow).getCell("A").value = `RECEBIMENTO - ${type}`;
  sheet.getRow(titleRow).font = { bold: true };
  RECEIVING_HEADERS.forEach((header, index) => { sheet.getRow(headerRow).getCell(index + 1).value = header; });
  styleHeader(sheet.getRow(headerRow));
  rows.forEach((row, index) => writeReceivingRow(sheet, dataStart + index, row));

  const total = sheet.getRow(totalRow);
  total.getCell("J").value = "TOTAL";
  const totalValue = rows.reduce((sum, row) => sum + row.valor, 0);
  if (rows.length > 0) {
    setFormula(total.getCell("K"), `SUBTOTAL(9,K${dataStart}:K${dataEnd})`, totalValue);
  } else {
    total.getCell("K").value = 0;
    total.getCell("K").numFmt = MONEY_FORMAT;
  }
  total.font = { bold: true };

  const summaryStart = totalRow + 3;
  const summary = writeSummary(sheet, summaryStart, type, calculateTotals(rows, competencia));
  return { totalRow, ...summary };
}

function writeEventSheet(sheet: ExcelJS.Worksheet, title: string, extraHeaders: string[] = []): void {
  const headers = [...EVENT_HEADERS, ...extraHeaders];
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  headers.forEach((header, index) => { sheet.getRow(3).getCell(index + 1).value = header; });
  styleHeader(sheet.getRow(3));
}

function writeAgingSheet(
  sheet: ExcelJS.Worksheet,
  competencia: Competencia,
  pf: ReceivingSectionResult,
  pj: ReceivingSectionResult,
): void {
  const reportDate = lastDayOfMonth(competencia);
  const dateText = `${String(reportDate.getDate()).padStart(2, "0")}/${String(reportDate.getMonth() + 1).padStart(2, "0")}/${reportDate.getFullYear()}`;
  sheet.mergeCells("B1:H1");
  sheet.mergeCells("B2:H2");
  sheet.getCell("B1").value = "ODONTOART";
  sheet.getCell("B2").value = `IDADE DO SALDO - DISTRIBUIÇÃO EM ${dateText}`;
  sheet.getCell("B1").font = { bold: true, size: 14 };
  sheet.getCell("B2").font = { bold: true };

  const headers = ["CONTAS DE ATIVO", "A vencer", "Até 30 dias", "de 31 a 60 dias", "de 61 a 90 dias", "de 91 a 120 dias", "de 121 a 365 dias", "mais de 365 dias", "TOTAL"];
  headers.forEach((header, index) => { sheet.getRow(4).getCell(index + 1).value = header; });
  styleHeader(sheet.getRow(4));
  const passivoHeaderRow = 8;
  headers.forEach((header, index) => { sheet.getRow(passivoHeaderRow).getCell(index + 1).value = index === 0 ? "CONTAS DE PASSIVO" : header; });
  styleHeader(sheet.getRow(passivoHeaderRow));

  const bucketKeys = ["aVencer", "ate30", "de31a60", "de61a90", "de91a120", "de121a365", "acima365"] as AgingBucketKey[];
  const writeAgingValues = (rowNumber: number, label: string, source: ReceivingSectionResult, sourceColumn: "H" | "I"): void => {
    sheet.getRow(rowNumber).getCell("A").value = label;
    bucketKeys.forEach((key, index) => {
      const target = sheet.getRow(rowNumber).getCell(index + 2);
      const sourceRow = source.summaryRows[key];
      if (sourceRow) {
        const result = coerceNumber(sheet.getRow(sourceRow).getCell(sourceColumn).value);
        setFormula(target, `'Recebimento Pendentes'!${sourceColumn}${sourceRow}`, result);
      } else {
        target.value = 0;
        target.numFmt = MONEY_FORMAT;
      }
    });
    const totalValue = bucketKeys.reduce((sum, key) => {
      const sourceRow = source.summaryRows[key];
      return sourceRow ? sum + coerceNumber(sheet.getRow(sourceRow).getCell(sourceColumn).value) : sum;
    }, 0);
    setFormula(sheet.getRow(rowNumber).getCell("I"), `SUM(B${rowNumber}:H${rowNumber})`, totalValue);
  };

  writeAgingValues(5, "Planos Individuais Familiares", pf, "H");
  writeAgingValues(6, "Planos Coletivos - pré pagamento", pj, "I");
  setFormula(sheet.getCell("I7"), "SUM(I5:I6)", coerceNumber(sheet.getCell("I5").value) + coerceNumber(sheet.getCell("I6").value));
  sheet.getCell("A9").value = "Eventos a Liquidar";
  for (let col = 2; col <= 9; col += 1) {
    sheet.getRow(9).getCell(col).value = 0;
    sheet.getRow(9).getCell(col).numFmt = MONEY_FORMAT;
  }
  sheet.getCell("J9").value = "NÃO POSSUI*";
}

function configureColumns(sheet: ExcelJS.Worksheet): void {
  const widths = [14, 15, 13, 13, 34, 14, 13, 15, 11, 11, 18];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function buildOutputWorkbook(
  competencia: Competencia,
  pfRows: AgingOutputRow[],
  pjRows: AgingOutputRow[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const agingSheet = workbook.addWorksheet("AGING");
  const receivingSheet = workbook.addWorksheet("Recebimento Pendentes");
  const eventsConsolidated = workbook.addWorksheet("EVENTOS PENDENTES CONSOLIDADO  ");
  const eventsPf = workbook.addWorksheet("EVENTOS PENDENTES PF");
  const eventsPj = workbook.addWorksheet("EVENTOS PENDENTES PJ");

  configureColumns(receivingSheet);
  const pjSection = writeReceivingSection(receivingSheet, 3, "PJ", pjRows, competencia);
  const pfTitleRow = pjSection.summaryTotalRow + 3;
  const pfSection = writeReceivingSection(receivingSheet, pfTitleRow, "PF", pfRows, competencia);
  writeAgingSheet(agingSheet, competencia, pfSection, pjSection);
  writeEventSheet(eventsConsolidated, "EVENTOS PENDENTES CONSOLIDADO");
  writeEventSheet(eventsPf, "EVENTOS PENDENTES PF", ["Valor Bruto", "INSS", "ISS"]);
  writeEventSheet(eventsPj, "EVENTOS PENDENTES PJ", ["Valor Bruto", "ISS", "IR"]);

  agingSheet.getColumn("A").width = 34;
  for (let col = 2; col <= 9; col += 1) agingSheet.getColumn(col).width = 17;
  [eventsConsolidated, eventsPf, eventsPj].forEach((sheet) => {
    sheet.columns.forEach((column) => { column.width = 18; });
    sheet.getColumn("E").width = 30;
    sheet.getColumn("N").width = 22;
  });
  return workbook;
}

function toOutputRows(rows: AgingSourceRow[]): AgingOutputRow[] {
  return rows.map((row) => ({
    cpt: row.dtEmissao,
    emissao: row.dtEmissao,
    nf: row.nf,
    codigo: row.codigo,
    nome: row.nome,
    vencimento: row.dataVencimento,
    parcela: row.parcela,
    valor: row.imposto + row.titulo,
  }));
}

function outputFileName(competencia: Competencia): string {
  const months = [
    "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
    "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
  ];
  return `${String(competencia.mes).padStart(2, "0")}.${months[competencia.mes - 1] ?? "COMPETENCIA"}.${competencia.ano} (eventos a pagar e mensalidades a receber).xlsx`;
}

export async function processAging(input: AgingProcessInput): Promise<AgingProcessOutput> {
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(input.baseBuffer as unknown as ExcelJS.Buffer);
  const sourceSheet = resolveSourceSheet(sourceWorkbook);
  const sourceRows = readSourceRows(sourceSheet, resolveSourceColumns(sourceSheet));
  if (sourceRows.length === 0) throw new Error('A aba "Planilha1" nao possui registros para importar.');

  const pfRows = toOutputRows(sourceRows.filter(isPessoaFisica));
  const pjRows = toOutputRows(sourceRows.filter((row) => !isPessoaFisica(row)));
  const outputWorkbook = buildOutputWorkbook(input.competencia, pfRows, pjRows);
  const data = await outputWorkbook.xlsx.writeBuffer();
  const summary: AgingSummary = {
    competencia: competenciaToString(input.competencia),
    registrosEntrada: sourceRows.length,
    registrosTratados: sourceRows.length,
    registrosPf: pfRows.length,
    registrosPj: pjRows.length,
  };
  return {
    fileName: outputFileName(input.competencia),
    fileBuffer: new Uint8Array(data),
    summary,
  };
}
