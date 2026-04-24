import ExcelJS from "exceljs";
import { Competencia } from "@/features/eventos/domain/types";
import { coerceDate, coerceString, normalizeText } from "@/features/eventos/services/utils";

const MONTHS_PT: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

function validCompetencia(ano: number, mes: number): boolean {
  return ano >= 2000 && ano <= 2100 && mes >= 1 && mes <= 12;
}

function toCompetencia(ano: number, mes: number): Competencia | null {
  if (!validCompetencia(ano, mes)) return null;
  return { ano, mes };
}

function readStringFromRows(workbook: ExcelJS.Workbook): string[] {
  const lines: string[] = [];
  for (const sheet of workbook.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r += 1) {
      for (let c = 1; c <= Math.min(sheet.columnCount, 8); c += 1) {
        const text = coerceString(sheet.getRow(r).getCell(c).value);
        if (text) lines.push(text);
      }
    }
  }
  return lines;
}

function detectFromText(lines: string[]): Competencia | null {
  for (const raw of lines) {
    const text = normalizeText(raw);

    const periodoMatch =
      text.match(
        /PERIODO[:\s]*(\d{2})[\/.-](\d{2})[\/.-](\d{4})\s*(A|ATE)\s*(\d{2})[\/.-](\d{2})[\/.-](\d{4})/,
      ) ??
      text.match(
        /(\d{2})[\/.-](\d{2})[\/.-](\d{4})\s*(A|ATE)\s*(\d{2})[\/.-](\d{2})[\/.-](\d{4})/,
      );
    if (periodoMatch) {
      const month = Number(periodoMatch[5]);
      const year = Number(periodoMatch[6]);
      const competencia = toCompetencia(year, month);
      if (competencia) return competencia;
    }

    const monthText = text.match(
      /(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)[\s./-]*(\d{4})/,
    );
    if (monthText) {
      const month = MONTHS_PT[monthText[1]];
      const year = Number(monthText[2]);
      const competencia = toCompetencia(year, month);
      if (competencia) return competencia;
    }

    const simpleMonthYear = text.match(/(?:^|\s)(0[1-9]|1[0-2])[./-](20\d{2})(?:\s|$)/);
    if (simpleMonthYear) {
      const month = Number(simpleMonthYear[1]);
      const year = Number(simpleMonthYear[2]);
      const competencia = toCompetencia(year, month);
      if (competencia) return competencia;
    }
  }

  return null;
}

function detectFromDates(workbook: ExcelJS.Workbook): Competencia | null {
  const frequency = new Map<string, number>();
  const targetHeaders = new Set([
    "DATAGERADO",
    "DATAPAGAMENTO",
    "DATACONHECIMENTO",
    "DTOCORR",
    "DTAVISO",
    "COMP",
    "VENCIMENTO",
  ]);

  for (const sheet of workbook.worksheets) {
    let headerRow = -1;
    let columns: number[] = [];

    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r += 1) {
      const row = sheet.getRow(r);
      const currentCols: number[] = [];
      for (let c = 1; c <= Math.min(sheet.columnCount, 60); c += 1) {
        const header = normalizeText(coerceString(row.getCell(c).value)).replace(/[^\w]/g, "");
        if (targetHeaders.has(header)) currentCols.push(c);
      }
      if (currentCols.length > 0) {
        headerRow = r;
        columns = currentCols;
        break;
      }
    }

    if (headerRow < 0 || columns.length === 0) continue;

    for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      for (const col of columns) {
        const date = coerceDate(row.getCell(col).value);
        if (!date) continue;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        frequency.set(key, (frequency.get(key) ?? 0) + 1);
      }
    }
  }

  if (frequency.size === 0) return null;
  const [bestKey] = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0];
  const [yearRaw, monthRaw] = bestKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  return toCompetencia(year, month);
}

function detectFromFilename(filename: string): Competencia | null {
  const normalized = normalizeText(filename);
  const mmYyyy = normalized.match(/(0[1-9]|1[0-2])[._-](20\d{2})/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    const year = Number(mmYyyy[2]);
    const competencia = toCompetencia(year, month);
    if (competencia) return competencia;
  }

  const yyyyMm = normalized.match(/(20\d{2})[._-](0[1-9]|1[0-2])/);
  if (yyyyMm) {
    const year = Number(yyyyMm[1]);
    const month = Number(yyyyMm[2]);
    const competencia = toCompetencia(year, month);
    if (competencia) return competencia;
  }

  const compact = normalized.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const competencia = toCompetencia(year, month);
    if (competencia) return competencia;
  }

  return null;
}

export class CompetenciaDetector {
  async detect(fileBuffer: Buffer, filename?: string): Promise<Competencia | null> {
    const fromName = filename ? detectFromFilename(filename) : null;
    if (fromName) return fromName;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    const lines = readStringFromRows(workbook);
    const fromText = detectFromText(lines);
    if (fromText) return fromText;

    const fromDates = detectFromDates(workbook);
    if (fromDates) return fromDates;

    return null;
  }
}
