import ExcelJS from "exceljs";
import { EscrituracaoRow } from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";

const DATE_FORMAT = "yyyy-mm-dd";
const MONTH_YEAR_FORMAT = "mm/yyyy";
const FULL_DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = "#,##0.00";
const CURRENCY_FORMAT = '"R$" #,##0.00';

function competenciaToken(competencia: Competencia): string {
  return `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`;
}

function firstDayOfMonth(competencia: Competencia): Date {
  return new Date(competencia.ano, competencia.mes - 1, 1);
}

function normalizeDate(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function compareYearMonth(date: Date, ano: number, mes: number): number {
  const dateKey = date.getFullYear() * 100 + (date.getMonth() + 1);
  const targetKey = ano * 100 + mes;
  if (dateKey === targetKey) return 0;
  return dateKey < targetKey ? -1 : 1;
}

function shiftCompetencia(competencia: Competencia, months: number): Competencia {
  const base = new Date(competencia.ano, competencia.mes - 1 + months, 1);
  return { ano: base.getFullYear(), mes: base.getMonth() + 1 };
}

function dayInCompetencia(competencia: Competencia, day: number): Date {
  const lastDay = new Date(competencia.ano, competencia.mes, 0).getDate();
  return new Date(competencia.ano, competencia.mes - 1, Math.min(day, lastDay));
}

function lastDayOfCompetencia(competencia: Competencia): Date {
  const day = new Date(competencia.ano, competencia.mes, 0).getDate();
  return dayInCompetencia(competencia, day);
}

function resolvePfDueDate(value: Date | null, competencia: Competencia): Date {
  const firstCurrent = firstDayOfMonth(competencia);
  const previousCompetencia = shiftCompetencia(competencia, -1);
  if (!value) return firstCurrent;

  const date = normalizeDate(value);
  const monthCompare = compareYearMonth(date, competencia.ano, competencia.mes);
  if (monthCompare < 0) return lastDayOfCompetencia(previousCompetencia);
  if (monthCompare > 0) return dayInCompetencia(competencia, 29);
  if (date.getDate() === 31) return dayInCompetencia(competencia, 29);
  return date;
}

function resolvePjDueDate(value: Date | null, competencia: Competencia): Date {
  const firstCurrent = firstDayOfMonth(competencia);
  const previousCompetencia = shiftCompetencia(competencia, -1);
  const nextCompetencia = shiftCompetencia(competencia, 1);
  if (!value) return firstCurrent;

  const date = normalizeDate(value);
  const currentCompare = compareYearMonth(date, competencia.ano, competencia.mes);
  if (currentCompare < 0) return lastDayOfCompetencia(previousCompetencia);
  if (currentCompare === 0) return date;

  const nextCompare = compareYearMonth(date, nextCompetencia.ano, nextCompetencia.mes);
  if (nextCompare === 0) return date;
  return dayInCompetencia(nextCompetencia, date.getDate());
}

function monthNameUpper(date: Date): string {
  return date.toLocaleDateString("pt-BR", { month: "long" }).toUpperCase();
}

function splitRows(rows: EscrituracaoRow[]): {
  pf: EscrituracaoRow[];
  pj: EscrituracaoRow[];
} {
  const pj: EscrituracaoRow[] = [];
  const pf: EscrituracaoRow[] = [];

  for (const row of rows) {
    if (row.tipo.trim().toUpperCase() === "COLETIVO EMPRESARIAL") {
      pj.push(row);
      continue;
    }
    pf.push(row);
  }

  return { pf, pj };
}

function setHeaderStyle(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { name: "Calibri", size: 11, bold: true };
  sheet.getRow(2).font = { name: "Calibri", size: 10, bold: true };
}

export class EquacaoWorkbookFactory {
  async build(rows: EscrituracaoRow[], competencia: Competencia): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const { pf, pj } = splitRows(rows);

    this.fillPfSheet(workbook.addWorksheet("Faturamento PF CLINICO"), pf, competencia);
    this.fillPjSheet(workbook.addWorksheet("Faturamento PJ"), pj, competencia);

    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  buildFileName(competencia: Competencia): string {
    return `${competenciaToken(competencia)} Faturamento - Equacao.xlsx`;
  }

  private fillPfSheet(sheet: ExcelJS.Worksheet, rows: EscrituracaoRow[], competencia: Competencia): void {
    const cpt = firstDayOfMonth(competencia);

    const monthCurrent = monthNameUpper(cpt);
    const monthPrev = monthNameUpper(new Date(competencia.ano, competencia.mes - 2, 1));
    const monthNext = monthNameUpper(new Date(competencia.ano, competencia.mes, 1));

    sheet.getCell("A1").value = `ODONTOART PLANOS - FATURAMENTO - PF - ${monthCurrent}.${competencia.ano}`;
    sheet.mergeCells("J1:L1");
    sheet.getCell("J1").value = "RECEITA NÃO GANHA";
    sheet.getCell("J1").alignment = { horizontal: "center", vertical: "middle" };

    sheet.getRow(2).values = [
      "Cpt",
      "CODIGO",
      "NOME",
      "Nº NF",
      "VENCIMENTO",
      "VALOR_EMITIDO",
      "Nº Parcela",
      "DIA",
      "VALOR DIA",
      monthPrev,
      monthCurrent,
      monthNext,
    ];

    sheet.columns = [
      { width: 12 },
      { width: 12 },
      { width: 48 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
    ];

    setHeaderStyle(sheet);

    const baseRow = 3;
    rows.forEach((item, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const dueDate = resolvePfDueDate(item.vencimento, competencia);

      row.getCell("A").value = cpt;
      row.getCell("B").value = Number(item.codigo) || item.codigo;
      row.getCell("C").value = item.nome;
      row.getCell("D").value = Number(item.numeroNf) || item.numeroNf;
      row.getCell("E").value = dueDate;
      row.getCell("F").value = item.valor;
      row.getCell("G").value = Number(item.mensalidade) || item.mensalidade;
      row.getCell("H").value = {
        formula: `(VALUE(MID(TEXT(E${rowNumber},"dd/mm/aa"),1,2)))-1`,
        result: dueDate.getDate() - 1,
      };
      row.getCell("I").value = { formula: `F${rowNumber}/30` };
      row.getCell("K").value = { formula: `((I${rowNumber}*H${rowNumber})-F${rowNumber})*-1` };
      row.getCell("L").value = { formula: `F${rowNumber}-K${rowNumber}` };

      row.getCell("A").numFmt = MONTH_YEAR_FORMAT;
      row.getCell("E").numFmt = FULL_DATE_FORMAT;
      row.getCell("F").numFmt = CURRENCY_FORMAT;
      row.getCell("I").numFmt = CURRENCY_FORMAT;
      row.getCell("K").numFmt = CURRENCY_FORMAT;
      row.getCell("L").numFmt = CURRENCY_FORMAT;
    });
  }

  private fillPjSheet(sheet: ExcelJS.Worksheet, rows: EscrituracaoRow[], competencia: Competencia): void {
    const cpt = firstDayOfMonth(competencia);

    const monthCurrent = monthNameUpper(cpt);
    const monthPrev = monthNameUpper(new Date(competencia.ano, competencia.mes - 2, 1));
    const monthNext = monthNameUpper(new Date(competencia.ano, competencia.mes, 1));
    const monthNext2 = monthNameUpper(new Date(competencia.ano, competencia.mes + 1, 1));

    sheet.getCell("A1").value = `ODONTOART PLANOS - FATURAMENTO - PJ - ${monthCurrent}.${competencia.ano}`;
    sheet.getCell("L1").value = "RECEITA NÃO GANHA";

    sheet.getRow(2).values = [
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
      monthPrev,
      monthCurrent,
      monthNext,
      monthNext2,
    ];

    sheet.columns = [
      { width: 12 },
      { width: 12 },
      { width: 48 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
    ];

    setHeaderStyle(sheet);

    const baseRow = 3;
    rows.forEach((item, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const dueDate = resolvePjDueDate(item.vencimento, competencia);
      const dueMonth = dueDate.getMonth() + 1;
      const isCurrentMonth = dueMonth === competencia.mes;

      row.getCell("A").value = cpt;
      row.getCell("B").value = Number(item.codigo) || item.codigo;
      row.getCell("C").value = item.nome;
      row.getCell("D").value = Number(item.numeroNf) || item.numeroNf;
      row.getCell("E").value = dueDate;
      row.getCell("F").value = Number(item.mensalidade) || item.mensalidade;
      row.getCell("G").value = item.valor;
      row.getCell("H").value = item.issRetido;
      row.getCell("I").value = { formula: `(VALUE(MID(TEXT(E${rowNumber},"dd/mm/aa"),1,2)))-1` };
      row.getCell("J").value = { formula: `G${rowNumber}/30` };

      if (isCurrentMonth) {
        row.getCell("L").value = { formula: `((J${rowNumber}*I${rowNumber})-G${rowNumber})*-1` };
        row.getCell("M").value = { formula: `G${rowNumber}-L${rowNumber}` };
        row.getCell("N").value = 0;
      } else {
        row.getCell("L").value = 0;
        row.getCell("M").value = { formula: `((J${rowNumber}*I${rowNumber})-G${rowNumber})*-1` };
        row.getCell("N").value = { formula: `G${rowNumber}-M${rowNumber}` };
      }

      row.getCell("A").numFmt = DATE_FORMAT;
      row.getCell("E").numFmt = DATE_FORMAT;
      row.getCell("G").numFmt = MONEY_FORMAT;
      row.getCell("H").numFmt = MONEY_FORMAT;
      row.getCell("J").numFmt = MONEY_FORMAT;
      row.getCell("L").numFmt = MONEY_FORMAT;
      row.getCell("M").numFmt = MONEY_FORMAT;
      row.getCell("N").numFmt = MONEY_FORMAT;
    });
  }
}
