import ExcelJS from "exceljs";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { Competencia } from "@/features/eventos/domain/types";
import {
  competenciaToString,
  coerceDate,
  coerceNumber,
  coerceString,
  lastDayOfMonth,
} from "@/features/eventos/services/utils";

interface CanceladaSourceRow {
  linhaOrigem: number;
  codigo: string;
  nome: string;
  cpfCnpj: string;
  dataVencimento: Date | null;
  titulo: number;
  dataPagamento: Date | null;
  parcela: string;
  loteNf: string;
  nf: string;
  dtEmissao: Date | null;
}

export interface ImportedCanceladaRow {
  competencia: string;
  ano: number;
  mes: number;
  cpt: string;
  codigo: string;
  nome: string;
  emissao: string | null;
  vencimento: string | null;
  valor_emitido: number;
  numero_parc: string;
  numero_nf: string;
  origem: "PROCESSAMENTO_MENSAL";
}

interface GeneratedWorkbook {
  fileName: string;
  buffer: Uint8Array;
}

export interface CanceladasProcessProgress {
  value: number;
  label: string;
  detail: string;
}

export interface CanceladasProcessResult {
  competencia: string;
  registrosEntrada: number;
  registrosTratados: number;
  registrosPf: number;
  registrosPj: number;
  rowsToImport: ImportedCanceladaRow[];
  generatedFiles: GeneratedWorkbook[];
}

const DATE_FORMAT = "dd/mm/yyyy";
const CURRENCY_FORMAT = '"R$" #,##0.00';
const HEADER_FONT = { name: "Calibri", size: 11, bold: true };

function competenciaToken(competencia: Competencia): string {
  return `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`;
}

function normalizeSheetName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toIsoDate(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function hasDigits(value: string): boolean {
  return /\d/.test(value);
}

function isCpf(value: string): boolean {
  return value.replace(/\D/g, "").length === 11;
}

function isValidRow(row: CanceladaSourceRow): boolean {
  return Boolean(row.codigo || row.nome || row.parcela || row.nf || row.loteNf);
}

function shouldKeepRow(row: CanceladaSourceRow, competenciaLastDay: Date): boolean {
  if (row.dataPagamento && row.dataPagamento.getTime() <= competenciaLastDay.getTime()) {
    return false;
  }

  if (!hasDigits(row.loteNf)) return false;

  if (row.dtEmissao && row.dtEmissao.getTime() > competenciaLastDay.getTime()) {
    return false;
  }

  return true;
}

function copyColumnWidths(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet): void {
  for (let colNumber = 1; colNumber <= source.columnCount; colNumber += 1) {
    const sourceColumn = source.getColumn(colNumber);
    const targetColumn = target.getColumn(colNumber);
    if (sourceColumn.width) targetColumn.width = sourceColumn.width;
  }
}

function createTreatedWorksheet(
  source: ExcelJS.Worksheet,
  target: ExcelJS.Worksheet,
  lineNumbers: Set<number>,
): void {
  copyColumnWidths(source, target);

  const headerValues = Array.from({ length: source.columnCount }, (_, index) =>
    source.getRow(1).getCell(index + 1).value,
  );
  target.addRow(headerValues);

  for (let rowNumber = 2; rowNumber <= source.rowCount; rowNumber += 1) {
    if (!lineNumbers.has(rowNumber)) continue;
    const sourceRow = source.getRow(rowNumber);
    const values = Array.from({ length: source.columnCount }, (_, index) =>
      sourceRow.getCell(index + 1).value,
    );
    target.addRow(values);
  }
}

function createTreatedWorkbook(
  source: ExcelJS.Worksheet,
  lineNumbers: Set<number>,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const treatedSheet = workbook.addWorksheet("tratada");
  createTreatedWorksheet(source, treatedSheet, lineNumbers);
  return workbook;
}

function buildSourceRows(worksheet: ExcelJS.Worksheet): CanceladaSourceRow[] {
  const rows: CanceladaSourceRow[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const parsed: CanceladaSourceRow = {
      linhaOrigem: rowNumber,
      codigo: coerceString(row.getCell("A").value),
      nome: coerceString(row.getCell("B").value),
      cpfCnpj: coerceString(row.getCell("C").value),
      dataVencimento: coerceDate(row.getCell("M").value),
      titulo: coerceNumber(row.getCell("S").value),
      dataPagamento: coerceDate(row.getCell("U").value),
      parcela: coerceString(row.getCell("AE").value),
      loteNf: coerceString(row.getCell("AG").value),
      nf: coerceString(row.getCell("AH").value),
      dtEmissao: coerceDate(row.getCell("AI").value),
    };

    if (!isValidRow(parsed)) continue;
    rows.push(parsed);
  }

  if (rows.length === 0) {
    throw new ContraprestacoesError(
      "Base mensal de canceladas sem registros validos.",
      "Nenhum registro valido foi encontrado na aba original da base de Canceladas.",
    );
  }

  return rows;
}

function createFinalSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  competencia: Competencia,
  rows: CanceladaSourceRow[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [
    { header: "CPT", width: 12 },
    { header: "CODIGO", width: 14 },
    { header: "NOME", width: 42 },
    { header: "DT. EMISSAO", width: 16 },
    { header: "VENCIMENTO", width: 16 },
    { header: "VALOR_EMITIDO", width: 16 },
    { header: "N PARC", width: 18 },
    { header: "NF", width: 18 },
  ];
  sheet.getRow(1).font = HEADER_FONT;

  rows.forEach((row) => {
    sheet.addRow([
      competenciaToken(competencia),
      row.codigo,
      row.nome,
      row.dtEmissao,
      row.dataVencimento,
      row.titulo,
      row.parcela,
      row.nf,
    ]);
  });

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getCell(`D${rowNumber}`).numFmt = DATE_FORMAT;
    sheet.getCell(`E${rowNumber}`).numFmt = DATE_FORMAT;
    sheet.getCell(`F${rowNumber}`).numFmt = CURRENCY_FORMAT;
  }
}

async function serializeWorkbook(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  const data = await workbook.xlsx.writeBuffer();
  return new Uint8Array(data);
}

export class CanceladasWorkbookProcessor {
  async process(
    fileBuffer: Uint8Array,
    competencia: Competencia,
    onProgress?: (progress: CanceladasProcessProgress) => void,
  ): Promise<CanceladasProcessResult> {
    onProgress?.({
      value: 14,
      label: "Carregando workbook",
      detail: "Abrindo o XLSX de Canceladas e lendo as abas do arquivo.",
    });

    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    onProgress?.({
      value: 24,
      label: "Localizando aba original",
      detail: "Buscando a aba original para iniciar o tratamento mensal.",
    });

    const originalSheet =
      sourceWorkbook.worksheets.find((sheet) => {
        const normalized = normalizeSheetName(sheet.name);
        return normalized.includes("ORIGINAL") || normalized.includes("ORGINAL");
      }) ?? sourceWorkbook.worksheets[0];

    if (!originalSheet) {
      throw new ContraprestacoesError(
        "Aba original da base de canceladas ausente.",
        "Nao foi possivel localizar a aba original no arquivo de Canceladas.",
      );
    }

    onProgress?.({
      value: 36,
      label: "Lendo linhas da base",
      detail: "Extraindo as colunas operacionais da aba original para montar a base de trabalho.",
    });

    const sourceRows = buildSourceRows(originalSheet);
    const competenciaLastDay = lastDayOfMonth(competencia);

    onProgress?.({
      value: 48,
      label: "Aplicando regras",
      detail: "Filtrando registros por pagamento, emissao, lote e classificando PF/PJ.",
    });

    const treatedRows = sourceRows.filter((row) => shouldKeepRow(row, competenciaLastDay));
    const pfRows = treatedRows.filter((row) => isCpf(row.cpfCnpj));
    const pjRows = treatedRows.filter((row) => !isCpf(row.cpfCnpj));
    const competenciaValue = competenciaToString(competencia);
    const cpt = competenciaToken(competencia);

    if (normalizeSheetName(originalSheet.name) !== "ORIGINAL") {
      originalSheet.name = "original";
    }

    onProgress?.({
      value: 58,
      label: "Montando base tratada",
      detail: "Recriando a aba tratada com as linhas mantidas da competencia.",
    });

    const treatedLineNumbers = new Set(treatedRows.map((row) => row.linhaOrigem));
    const treatedWorkbook = createTreatedWorkbook(originalSheet, treatedLineNumbers);

    onProgress?.({
      value: 68,
      label: "Gerando planilhas finais",
      detail: "Criando as planilhas PF e PJ com os dados tratados.",
    });

    const finalWorkbook = new ExcelJS.Workbook();
    createFinalSheet(finalWorkbook, "PF", competencia, pfRows);
    createFinalSheet(finalWorkbook, "PJ", competencia, pjRows);

    onProgress?.({
      value: 76,
      label: "Preparando importacao",
      detail: "Montando os registros que serao enviados para o historico interno.",
    });

    const rowsToImport: ImportedCanceladaRow[] = treatedRows.map((row) => ({
      competencia: competenciaValue,
      ano: competencia.ano,
      mes: competencia.mes,
      cpt,
      codigo: row.codigo,
      nome: row.nome,
      emissao: toIsoDate(row.dtEmissao),
      vencimento: toIsoDate(row.dataVencimento),
      valor_emitido: row.titulo,
      numero_parc: row.parcela,
      numero_nf: row.nf,
      origem: "PROCESSAMENTO_MENSAL",
    }));

    onProgress?.({
      value: 84,
      label: "Serializando base tratada",
      detail: "Convertendo a base tratada novamente para XLSX.",
    });
    const treatedWorkbookBuffer = await serializeWorkbook(treatedWorkbook);

    onProgress?.({
      value: 92,
      label: "Serializando planilha final",
      detail: "Convertendo a planilha final PF/PJ para XLSX.",
    });
    const finalWorkbookBuffer = await serializeWorkbook(finalWorkbook);

    return {
      competencia: competenciaValue,
      registrosEntrada: sourceRows.length,
      registrosTratados: treatedRows.length,
      registrosPf: pfRows.length,
      registrosPj: pjRows.length,
      rowsToImport,
      generatedFiles: [
        {
          fileName: `BASE CANCELADAS ${cpt} - Tratada.xlsx`,
          buffer: treatedWorkbookBuffer,
        },
        {
          fileName: `Mensalidades Canceladas ${cpt}.xlsx`,
          buffer: finalWorkbookBuffer,
        },
      ],
    };
  }
}
