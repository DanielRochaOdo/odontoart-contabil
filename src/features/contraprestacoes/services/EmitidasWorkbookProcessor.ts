import ExcelJS from "exceljs";
import { Competencia } from "@/features/eventos/domain/types";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import {
  coerceDate,
  coerceNumber,
  coerceString,
  normalizeText,
  parseCompetencia,
} from "@/features/eventos/services/utils";
import {
  EmitidasProcessInput,
  EmitidasProcessOutput,
  EmitidasSummary,
} from "@/features/contraprestacoes/domain/types";

const DATE_FORMAT = "dd/mm/yyyy";
const CURRENCY_FORMAT = '"R$" #,##0.00';
const MONTHS_PT = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

const PF_TYPES = new Set([
  "INDIVIDUAL OU FAMILIAR",
  "SERVIDOR PUBLICO ESTADUAL",
  "SERVIDOR PUBLICO MUNICIPAL",
]);
const PJ_TYPES = new Set(["COLETIVO EMPRESARIAL"]);

type PessoaEmitida = "PF" | "PJ";
type IdentityValue = string | number;

interface SourceColumns {
  mensalidade: number;
  nf: number;
  codigo: number;
  nome: number;
  vencimento: number;
  tipo: number;
  valor: number;
  issRetido: number;
}

interface SourceRow {
  linha: number;
  mensalidade: IdentityValue;
  nf: IdentityValue;
  codigo: IdentityValue;
  nome: string;
  vencimento: Date | null;
  tipo: string;
  valor: number;
  issRetido: number;
}

interface ClassifiedRow extends SourceRow {
  pessoa: PessoaEmitida;
}

interface CalendarMonth {
  ano: number;
  mes: number;
}

function headerKey(value: unknown): string {
  return normalizeText(coerceString(value)).replace(/[^\w]/g, "");
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  const required = new Set(["MENSALIDADE", "NF", "COD", "CLIENTE", "VENCIMENTO", "TIPO", "VALOR"]);

  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const keys = new Set<string>();
    const row = sheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= Math.min(sheet.columnCount, 60); columnNumber += 1) {
      keys.add(headerKey(row.getCell(columnNumber).value));
    }

    if ([...required].every((key) => keys.has(key))) return rowNumber;
  }

  throw new Error(
    "Arquivo de Emitidas invalido: a aba de Escrituracao precisa conter as colunas Mensalidade, NF, COD, Cliente, Vencimento, Tipo e Valor.",
  );
}

function findColumn(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  aliases: string[],
  required = true,
): number {
  const wanted = new Set(aliases.map((alias) => headerKey(alias)));
  const row = sheet.getRow(headerRow);

  for (let columnNumber = 1; columnNumber <= Math.min(sheet.columnCount, 60); columnNumber += 1) {
    if (wanted.has(headerKey(row.getCell(columnNumber).value))) return columnNumber;
  }

  if (required) {
    throw new Error(`Arquivo de Emitidas invalido: coluna ${aliases[0]} nao encontrada.`);
  }

  return -1;
}

function resolveColumns(sheet: ExcelJS.Worksheet, headerRow: number): SourceColumns {
  return {
    mensalidade: findColumn(sheet, headerRow, ["MENSALIDADE"]),
    nf: findColumn(sheet, headerRow, ["NF"]),
    codigo: findColumn(sheet, headerRow, ["COD", "CODIGO"]),
    nome: findColumn(sheet, headerRow, ["CLIENTE", "NOME"]),
    vencimento: findColumn(sheet, headerRow, ["VENCIMENTO"]),
    tipo: findColumn(sheet, headerRow, ["TIPO"]),
    valor: findColumn(sheet, headerRow, ["VALOR"]),
    issRetido: findColumn(sheet, headerRow, ["ISS RET", "ISS RETIDO"], false),
  };
}

function identityValue(value: unknown): IdentityValue {
  if (typeof value === "number") return value;
  return coerceString(value);
}

function parseSourceRows(sheet: ExcelJS.Worksheet, columns: SourceColumns, headerRow: number): SourceRow[] {
  const rows: SourceRow[] = [];

  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = [
      row.getCell(columns.mensalidade).value,
      row.getCell(columns.nf).value,
      row.getCell(columns.codigo).value,
      row.getCell(columns.nome).value,
      row.getCell(columns.tipo).value,
      row.getCell(columns.valor).value,
    ];

    if (values.every((value) => coerceString(value) === "")) continue;

    rows.push({
      linha: rowNumber,
      mensalidade: identityValue(row.getCell(columns.mensalidade).value),
      nf: identityValue(row.getCell(columns.nf).value),
      codigo: identityValue(row.getCell(columns.codigo).value),
      nome: coerceString(row.getCell(columns.nome).value),
      vencimento: coerceDate(row.getCell(columns.vencimento).value),
      tipo: coerceString(row.getCell(columns.tipo).value),
      valor: coerceNumber(row.getCell(columns.valor).value),
      issRetido:
        columns.issRetido > 0 ? coerceNumber(row.getCell(columns.issRetido).value) : 0,
    });
  }

  return rows;
}

function classifyType(tipo: string): PessoaEmitida | null {
  const normalized = normalizeText(tipo);
  if (PF_TYPES.has(normalized)) return "PF";
  if (PJ_TYPES.has(normalized)) return "PJ";
  return null;
}

function calendarParts(date: Date | null): CalendarMonth & { dia: number } | null {
  if (!date || Number.isNaN(date.getTime())) return null;

  return {
    ano: date.getUTCFullYear(),
    mes: date.getUTCMonth() + 1,
    dia: date.getUTCDate(),
  };
}

function utcDate(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function monthAt(competencia: Competencia, offset: number): CalendarMonth {
  const date = new Date(Date.UTC(competencia.ano, competencia.mes - 1 + offset, 1));
  return { ano: date.getUTCFullYear(), mes: date.getUTCMonth() + 1 };
}

function isMonth(date: CalendarMonth & { dia: number } | null, month: CalendarMonth): boolean {
  return Boolean(date && date.ano === month.ano && date.mes === month.mes);
}

function monthOrdinal(month: CalendarMonth): number {
  return month.ano * 12 + month.mes;
}

function adjustedDueDate(
  original: Date | null,
  competencia: Competencia,
  pessoa: PessoaEmitida,
): { date: Date; position: 0 | 1 } {
  const parts = calendarParts(original);
  const current = monthAt(competencia, 0);
  const next = monthAt(competencia, 1);
  const isCurrent = isMonth(parts, current);
  const isNext = isMonth(parts, next);
  const preserve = isCurrent || (pessoa === "PJ" && isNext);

  if (preserve && parts) {
    return {
      date: utcDate(parts.ano, parts.mes, Math.min(parts.dia, 30)),
      position: pessoa === "PJ" && isNext ? 1 : 0,
    };
  }

  if (parts && monthOrdinal(parts) < monthOrdinal(current)) {
    return { date: utcDate(competencia.ano, competencia.mes, 1), position: 0 };
  }

  if (pessoa === "PJ") {
    return { date: utcDate(next.ano, next.mes, 30), position: 1 };
  }

  return { date: utcDate(competencia.ano, competencia.mes, 30), position: 0 };
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number): void {
  cell.value = { formula, result };
}

function styleTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  lastColumn: string,
  revenueStart: string,
): void {
  sheet.mergeCells(`A1:${String.fromCharCode(revenueStart.charCodeAt(0) - 1)}1`);
  sheet.mergeCells(`${revenueStart}1:${lastColumn}1`);
  sheet.getCell("A1").value = title;
  sheet.getCell(`${revenueStart}1`).value = "RECEITA NÃO GANHA";

  [sheet.getCell("A1"), sheet.getCell(`${revenueStart}1`)].forEach((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  });
  sheet.getRow(1).height = 24;
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FF7F7F7F" } },
      left: { style: "thin", color: { argb: "FF7F7F7F" } },
      bottom: { style: "thin", color: { argb: "FF7F7F7F" } },
      right: { style: "thin", color: { argb: "FF7F7F7F" } },
    };
  });
}

function prepareSheet(sheet: ExcelJS.Worksheet, lastColumn: string): void {
  sheet.views = [{ state: "frozen", ySplit: 2, topLeftCell: "A3", showGridLines: true, zoomScale: 85 }];
  sheet.autoFilter = { from: "A2", to: `${lastColumn}2` };
  sheet.properties.defaultRowHeight = 18;
}

function writePfSheet(sheet: ExcelJS.Worksheet, rows: ClassifiedRow[], competencia: Competencia): void {
  const previous = monthAt(competencia, -1);
  const current = monthAt(competencia, 0);
  const next = monthAt(competencia, 1);
  const headers = [
    "Cpt",
    "CODIGO",
    "NOME",
    "Nº NF",
    "VENCIMENTO",
    "VALOR_EMITIDO",
    "Nº Parcela",
    "DIA",
    "VALOR DIA",
    MONTHS_PT[previous.mes - 1],
    MONTHS_PT[current.mes - 1],
    MONTHS_PT[next.mes - 1],
  ];

  styleTitle(
    sheet,
    `ODONTOART PLANOS - FATURAMENTO - PF - ${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`,
    "L",
    "J",
  );
  sheet.addRow(headers);
  styleHeader(sheet.getRow(2));
  prepareSheet(sheet, "L");

  [12, 14, 48, 14, 15, 16, 16, 12, 14, 14, 14, 14].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  rows.forEach((source) => {
    const row = sheet.addRow([]);
    const rowNumber = row.number;
    const due = adjustedDueDate(source.vencimento, competencia, "PF");
    const day = Math.max(0, due.date.getUTCDate() - 1);
    const valuePerDay = source.valor / 30;
    const currentValue = source.valor - valuePerDay * day;
    const nextValue = source.valor - currentValue;

    row.getCell(1).value = utcDate(competencia.ano, competencia.mes, 1);
    row.getCell(2).value = source.codigo;
    row.getCell(3).value = source.nome;
    row.getCell(4).value = source.nf;
    row.getCell(5).value = due.date;
    row.getCell(6).value = source.valor;
    row.getCell(7).value = source.mensalidade;
    setFormula(row.getCell(8), `(VALUE(MID(TEXT(E${rowNumber},"dd/mm/aa"),1,2)))-1`, day);
    setFormula(row.getCell(9), `F${rowNumber}/30`, valuePerDay);
    row.getCell(10).value = null;
    setFormula(row.getCell(11), `((I${rowNumber}*H${rowNumber})-F${rowNumber})*-1`, currentValue);
    setFormula(row.getCell(12), `F${rowNumber}-K${rowNumber}`, nextValue);

    row.getCell(1).numFmt = "mmm-yy";
    row.getCell(5).numFmt = DATE_FORMAT;
    row.getCell(6).numFmt = CURRENCY_FORMAT;
    row.getCell(9).numFmt = CURRENCY_FORMAT;
    row.getCell(11).numFmt = CURRENCY_FORMAT;
    row.getCell(12).numFmt = CURRENCY_FORMAT;
  });
}

function writePjSheet(sheet: ExcelJS.Worksheet, rows: ClassifiedRow[], competencia: Competencia): void {
  const previous = monthAt(competencia, -1);
  const current = monthAt(competencia, 0);
  const next = monthAt(competencia, 1);
  const nextTwo = monthAt(competencia, 2);
  const headers = [
    "Cpt",
    "CODIGO",
    "NOME",
    "Nº NF",
    "VENCIMENTO",
    "Nº Parcela",
    "VALOR_EMITIDO",
    "ISS RETIDO",
    "DIA",
    "VALOR DIA",
    MONTHS_PT[previous.mes - 1],
    MONTHS_PT[current.mes - 1],
    MONTHS_PT[next.mes - 1],
    MONTHS_PT[nextTwo.mes - 1],
  ];

  styleTitle(
    sheet,
    `ODONTOART PLANOS - FATURAMENTO - PJ - ${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`,
    "N",
    "K",
  );
  sheet.addRow(headers);
  styleHeader(sheet.getRow(2));
  prepareSheet(sheet, "N");

  [12, 14, 68, 14, 15, 16, 16, 14, 12, 14, 14, 14, 14, 14].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  rows.forEach((source) => {
    const row = sheet.addRow([]);
    const rowNumber = row.number;
    const due = adjustedDueDate(source.vencimento, competencia, "PJ");
    const day = Math.max(0, due.date.getUTCDate() - 1);
    const valuePerDay = source.valor / 30;
    const beforeCurrent = source.valor - valuePerDay * day;
    const currentValue = due.position === 0 ? beforeCurrent : 0;
    const nextValue = due.position === 0 ? valuePerDay * day : beforeCurrent;
    const nextTwoValue = due.position === 0 ? 0 : source.valor - nextValue;

    row.getCell(1).value = utcDate(competencia.ano, competencia.mes, 1);
    row.getCell(2).value = source.codigo;
    row.getCell(3).value = source.nome;
    row.getCell(4).value = source.nf;
    row.getCell(5).value = due.date;
    row.getCell(6).value = source.mensalidade;
    row.getCell(7).value = source.valor;
    row.getCell(8).value = source.issRetido;
    setFormula(row.getCell(9), `(VALUE(MID(TEXT(E${rowNumber},"dd/mm/aa"),1,2)))-1`, day);
    setFormula(row.getCell(10), `G${rowNumber}/30`, valuePerDay);
    row.getCell(11).value = null;
    if (due.position === 0) {
      setFormula(row.getCell(12), `((J${rowNumber}*I${rowNumber})-G${rowNumber})*-1`, currentValue);
      setFormula(row.getCell(13), `G${rowNumber}-L${rowNumber}`, nextValue);
      row.getCell(14).value = 0;
    } else {
      row.getCell(12).value = 0;
      setFormula(row.getCell(13), `((J${rowNumber}*I${rowNumber})-G${rowNumber})*-1`, nextValue);
      setFormula(row.getCell(14), `G${rowNumber}-M${rowNumber}`, nextTwoValue);
    }

    row.getCell(1).numFmt = "mmm-yy";
    row.getCell(5).numFmt = DATE_FORMAT;
    row.getCell(7).numFmt = CURRENCY_FORMAT;
    row.getCell(8).numFmt = CURRENCY_FORMAT;
    row.getCell(10).numFmt = CURRENCY_FORMAT;
    row.getCell(12).numFmt = CURRENCY_FORMAT;
    row.getCell(13).numFmt = CURRENCY_FORMAT;
    row.getCell(14).numFmt = CURRENCY_FORMAT;
  });
}

function outputFileName(competencia: Competencia): string {
  return `${String(competencia.mes).padStart(2, "0")}.${competencia.ano} Faturamento - Equação.xlsx`;
}

async function resolveCompetencia(
  competenciaRaw: string | null | undefined,
  fileBuffer: Uint8Array,
  fileName: string,
): Promise<{ competencia: Competencia; detectada: string | null }> {
  if (typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)) {
    return { competencia: parseCompetencia(competenciaRaw), detectada: competenciaRaw };
  }

  const detector = new CompetenciaDetector();
  const detected = await detector.detect(fileBuffer, fileName);
  if (detected) {
    return {
      competencia: detected,
      detectada: `${detected.ano}-${String(detected.mes).padStart(2, "0")}`,
    };
  }

  return { competencia: parseCompetencia(undefined), detectada: null };
}

function sumValues(rows: ClassifiedRow[], pessoa: PessoaEmitida): number {
  return rows
    .filter((row) => row.pessoa === pessoa)
    .reduce((total, row) => total + row.valor, 0);
}

export async function processEmitidasInBrowser(
  input: EmitidasProcessInput,
): Promise<EmitidasProcessOutput> {
  const fileBuffer = new Uint8Array(await input.baseFile.arrayBuffer());
  const { competencia, detectada } = await resolveCompetencia(
    input.competenciaRaw,
    fileBuffer,
    input.baseFile.name,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

  const sourceSheet = workbook.worksheets[0];
  if (!sourceSheet) {
    throw new Error("Arquivo de Emitidas invalido: nenhuma aba foi encontrada.");
  }

  const headerRow = findHeaderRow(sourceSheet);
  const columns = resolveColumns(sourceSheet, headerRow);
  const sourceRows = parseSourceRows(sourceSheet, columns, headerRow);
  if (sourceRows.length === 0) {
    throw new Error("A base de Emitidas nao possui registros para processar.");
  }

  const unknownTypes = new Map<string, number>();
  const classifiedRows: ClassifiedRow[] = [];
  sourceRows.forEach((row) => {
    const pessoa = classifyType(row.tipo);
    if (!pessoa) {
      const type = normalizeText(row.tipo) || "NAO INFORMADO";
      unknownTypes.set(type, (unknownTypes.get(type) ?? 0) + 1);
      return;
    }
    classifiedRows.push({ ...row, pessoa });
  });

  if (unknownTypes.size > 0) {
    const details = [...unknownTypes.entries()]
      .map(([type, count]) => `${type} (${count})`)
      .join(", ");
    throw new Error(
      `Tipos de Emitidas nao reconhecidos na coluna Tipo: ${details}. Esperados: Individual ou Familiar, Servidor Publico Estadual, Servidor Publico Municipal ou Coletivo Empresarial.`,
    );
  }

  const pfRows = classifiedRows.filter((row) => row.pessoa === "PF");
  const pjRows = classifiedRows.filter((row) => row.pessoa === "PJ");
  const outputWorkbook = new ExcelJS.Workbook();
  writePfSheet(outputWorkbook.addWorksheet("Faturamento PF CLINICO"), pfRows, competencia);
  writePjSheet(outputWorkbook.addWorksheet("Faturamento PJ"), pjRows, competencia);
  const outputBuffer = new Uint8Array(await outputWorkbook.xlsx.writeBuffer());
  const summary: EmitidasSummary = {
    competencia: `${competencia.ano}-${String(competencia.mes).padStart(2, "0")}`,
    registrosEntrada: sourceRows.length,
    registrosPf: pfRows.length,
    registrosPj: pjRows.length,
    totalPf: sumValues(pfRows, "PF"),
    totalPj: sumValues(pjRows, "PJ"),
  };

  return {
    fileName: outputFileName(competencia),
    fileBuffer: outputBuffer,
    summary,
    competenciaDetectada: detectada,
  };
}
