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
import { AgingProcessInput, AgingProcessOutput, AgingSummary } from "@/features/aging/domain/types";

const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = '"R$" #,##0.00';

interface AgingSourceRow {
  codigo: string;
  nome: string;
  cpfCnpj: string;
  dataVencimento: Date | null;
  imposto: number;
  titulo: number;
  dataPagamento: Date | null;
  parcela: string;
  loteNf: string;
  nf: string;
  dtEmissao: Date | null;
}

interface SourceColumns {
  codigo: number; nome: number; cpfCnpj: number; dataVencimento: number;
  imposto: number; titulo: number; dataPagamento: number; parcela: number;
  loteNf: number; nf: number; dtEmissao: number;
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
      dataVencimento: findColumn(map, ["Data Vencimento", "Vencimento"]),
      imposto: findColumn(map, ["Imposto"]),
      titulo: findColumn(map, ["Título", "Titulo"]),
      dataPagamento: findColumn(map, ["Data Pagamento"]),
      parcela: findColumn(map, ["Parcela"]),
      loteNf: findColumn(map, ["Lote NF"]),
      nf: findColumn(map, ["NF"]),
      dtEmissao: findColumn(map, ["Dt. Emissão", "Dt. Emissao", "Data Emissao"]),
    };
    if (Object.values(columns).every((value) => value > 0)) return { headerRow: rowNumber, columns };
  }

  return {
    headerRow: 1,
    columns: {
      codigo: 1, nome: 2, cpfCnpj: 3, dataVencimento: 13, imposto: 18,
      titulo: 19, dataPagamento: 21, parcela: 31, loteNf: 33, nf: 34, dtEmissao: 35,
    },
  };
}

function isCpf(value: string): boolean {
  return value.replace(/\D/g, "").length === 11;
}

function readSourceRows(sheet: ExcelJS.Worksheet, layout: { headerRow: number; columns: SourceColumns }): AgingSourceRow[] {
  const rows: AgingSourceRow[] = [];
  for (let rowNumber = layout.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const c = layout.columns;
    const parsed: AgingSourceRow = {
      codigo: coerceString(row.getCell(c.codigo).value),
      nome: coerceString(row.getCell(c.nome).value),
      cpfCnpj: coerceString(row.getCell(c.cpfCnpj).value),
      dataVencimento: coerceDate(row.getCell(c.dataVencimento).value),
      imposto: coerceNumber(row.getCell(c.imposto).value),
      titulo: coerceNumber(row.getCell(c.titulo).value),
      dataPagamento: coerceDate(row.getCell(c.dataPagamento).value),
      parcela: coerceString(row.getCell(c.parcela).value),
      loteNf: coerceString(row.getCell(c.loteNf).value),
      nf: coerceString(row.getCell(c.nf).value),
      dtEmissao: coerceDate(row.getCell(c.dtEmissao).value),
    };
    if (parsed.codigo || parsed.nome || parsed.nf || parsed.loteNf) rows.push(parsed);
  }
  return rows;
}

function daysBetween(left: Date, right: Date): number {
  return Math.floor((left.getTime() - right.getTime()) / 86400000);
}

function agingBucket(days: number): string {
  if (days <= 0) return "A vencer";
  if (days <= 30) return "01 a 30 dias";
  if (days <= 60) return "31 a 60 dias";
  if (days <= 90) return "61 a 90 dias";
  if (days <= 180) return "91 a 180 dias";
  return "Acima de 180 dias";
}

function clearCellRange(sheet: ExcelJS.Worksheet, from: number, to: number, maxColumn: number): void {
  for (let rowNumber = from; rowNumber <= to; rowNumber += 1) {
    for (let col = 1; col <= maxColumn; col += 1) sheet.getRow(rowNumber).getCell(col).value = null;
  }
}

function findOutputSections(sheet: ExcelJS.Worksheet): Array<{ type: "PF" | "PJ"; headerRow: number; endRow: number }> {
  const sections: Array<{ type: "PF" | "PJ"; headerRow: number; endRow: number }> = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const text = Array.from({ length: Math.max(sheet.columnCount, sheet.actualColumnCount) }, (_, i) => normalized(sheet.getRow(rowNumber).getCell(i + 1).value)).join(" ");
    const hasHeader = text.includes("CPT") && text.includes("CODIGO") && text.includes("VALOREMITIDO");
    if (!hasHeader) continue;
    const before = Array.from({ length: 3 }, (_, i) => rowNumber - i - 1)
      .filter((row) => row > 0)
      .map((row) => Array.from({ length: 8 }, (_, i) => normalized(sheet.getRow(row).getCell(i + 1).value)).join(" "))
      .join(" ");
    const type = /\bPJ\b|PESSOAJURIDICA/.test(before) ? "PJ" : "PF";
    sections.push({ type, headerRow: rowNumber, endRow: sheet.rowCount });
  }
  sections.forEach((section, index) => {
    section.endRow = sections[index + 1]?.headerRow ? sections[index + 1].headerRow - 1 : sheet.rowCount;
  });
  return sections;
}

function writeSection(sheet: ExcelJS.Worksheet, section: { type: "PF" | "PJ"; headerRow: number; endRow: number }, rows: AgingOutputRow[], competencia: Competencia): void {
  const summaryMarker = Array.from({ length: Math.max(sheet.columnCount, 14) }, (_, i) => normalized(sheet.getRow(section.endRow).getCell(i + 1).value)).join(" ");
  const dataStart = section.headerRow + 1;
  const existingEnd = Math.max(dataStart - 1, section.endRow - (summaryMarker.includes("DIASVENCIMENTO") ? 7 : 0));
  clearCellRange(sheet, dataStart, existingEnd, 11);

  rows.forEach((item, index) => {
    const row = sheet.getRow(dataStart + index);
    row.getCell("A").value = item.cpt;
    row.getCell("B").value = item.emissao;
    row.getCell("C").value = item.nf;
    row.getCell("D").value = item.codigo;
    row.getCell("E").value = item.nome;
    row.getCell("F").value = item.emissao;
    row.getCell("H").value = item.vencimento;
    row.getCell("I").value = item.parcela;
    row.getCell("K").value = item.valor;
    ["A", "B", "F", "H"].forEach((column) => { row.getCell(column).numFmt = DATE_FORMAT; });
    row.getCell("K").numFmt = MONEY_FORMAT;
  });

  const summaryStart = dataStart + rows.length + 1;
  const totals = new Map<string, number>();
  const reportDate = lastDayOfMonth(competencia);
  rows.forEach((row) => {
    const days = row.vencimento ? daysBetween(reportDate, row.vencimento) : 0;
    const bucket = agingBucket(days);
    totals.set(bucket, (totals.get(bucket) ?? 0) + row.valor);
  });
  const buckets = ["A vencer", "01 a 30 dias", "31 a 60 dias", "61 a 90 dias", "91 a 180 dias", "Acima de 180 dias"];
  const title = sheet.getRow(summaryStart);
  title.getCell("M").value = `Dias Vencimento - ${section.type}`;
  title.getCell("N").value = "Valor";
  title.font = { bold: true };
  buckets.forEach((bucket, index) => {
    const row = sheet.getRow(summaryStart + index + 1);
    row.getCell("M").value = bucket;
    row.getCell("N").value = totals.get(bucket) ?? 0;
    row.getCell("N").numFmt = MONEY_FORMAT;
  });
}

export async function processAging(input: AgingProcessInput): Promise<AgingProcessOutput> {
  const baseWorkbook = new ExcelJS.Workbook();
  await baseWorkbook.xlsx.load(input.contabilidadeBuffer as unknown as ExcelJS.Buffer);
  const outputSheet = baseWorkbook.worksheets.find((sheet) => normalized(sheet.name) === "RECEBIMENTOPENDENTES");
  if (!outputSheet) throw new Error('Aba "Recebimento Pendentes" nao encontrada no arquivo base Contabilidade.');

  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(input.baseBuffer as unknown as ExcelJS.Buffer);
  const sourceSheet = sourceWorkbook.worksheets.find((sheet) => normalized(sheet.name).includes("AGING") || normalized(sheet.name).includes("ORIGINAL")) ?? sourceWorkbook.worksheets[0];
  if (!sourceSheet) throw new Error("Arquivo da base Contabilidade sem planilha.");

  const sourceRows = readSourceRows(sourceSheet, resolveSourceColumns(sourceSheet));
  const lastDay = lastDayOfMonth(input.competencia);
  let excluidosSemLote = 0;
  let excluidosEmissao = 0;
  let excluidosPagamento = 0;
  const kept = sourceRows.filter((row) => {
    if (!row.loteNf.trim()) { excluidosSemLote += 1; return false; }
    if (row.dtEmissao && row.dtEmissao.getTime() > lastDay.getTime()) { excluidosEmissao += 1; return false; }
    if (row.dataPagamento && row.dataPagamento.getTime() <= lastDay.getTime()) { excluidosPagamento += 1; return false; }
    return true;
  });

  const sections = findOutputSections(outputSheet);
  if (sections.length === 0) throw new Error("Quadros PF/PJ da aba Recebimento Pendentes nao foram reconhecidos.");
  const pfRows = kept.filter((row) => isCpf(row.cpfCnpj)).map((row) => ({ cpt: row.dtEmissao, emissao: row.dtEmissao, nf: row.nf, codigo: row.codigo, nome: row.nome, vencimento: row.dataVencimento, parcela: row.parcela, valor: row.imposto + row.titulo }));
  const pjRows = kept.filter((row) => !isCpf(row.cpfCnpj)).map((row) => ({ cpt: row.dtEmissao, emissao: row.dtEmissao, nf: row.nf, codigo: row.codigo, nome: row.nome, vencimento: row.dataVencimento, parcela: row.parcela, valor: row.imposto + row.titulo }));
  sections.forEach((section) => writeSection(outputSheet, section, section.type === "PF" ? pfRows : pjRows, input.competencia));

  const data = await baseWorkbook.xlsx.writeBuffer();
  const summary: AgingSummary = {
    competencia: competenciaToString(input.competencia), registrosEntrada: sourceRows.length, registrosTratados: kept.length,
    registrosPf: pfRows.length, registrosPj: pjRows.length, excluidosSemLote, excluidosEmissao, excluidosPagamento,
  };
  return { fileName: `BASE CONTABILIDADE AGING ${String(input.competencia.mes).padStart(2, "0")}.${input.competencia.ano}.xlsx`, fileBuffer: new Uint8Array(data), summary };
}
