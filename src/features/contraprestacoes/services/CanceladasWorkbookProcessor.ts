import ExcelJS from "exceljs";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { Competencia } from "@/features/eventos/domain/types";
import {
  competenciaToString,
  coerceDate,
  coerceNumber,
  coerceString,
  lastDayOfMonth,
  normalizeText,
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

interface SourceLayout {
  headerRowNumber: number;
  codigoCol: number;
  nomeCol: number;
  cpfCnpjCol: number;
  dataVencimentoCol: number;
  tituloCol: number;
  dataPagamentoCol: number;
  parcelaCol: number;
  loteNfCol: number;
  nfCol: number;
  dtEmissaoCol: number;
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
const HEADER_SCAN_LIMIT = 10;
const XLSX_LOAD_OPTIONS = {
  ignoreNodes: [
    "sheetPr",
    "sheetViews",
    "sheetFormatPr",
    "autoFilter",
    "mergeCells",
    "rowBreaks",
    "hyperlinks",
    "pageMargins",
    "dataValidations",
    "pageSetup",
    "headerFooter",
    "printOptions",
    "picture",
    "drawing",
    "sheetProtection",
    "tableParts",
    "conditionalFormatting",
    "extLst",
  ],
} as const;

function competenciaToken(competencia: Competencia): string {
  return `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`;
}

function normalizeSheetName(value: string): string {
  return normalizeText(value).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string): string {
  return normalizeText(value).replace(/[^\w]/g, "");
}

function readHeaderMap(worksheet: ExcelJS.Worksheet, rowNumber: number): Map<string, number> {
  const headerMap = new Map<string, number>();
  const row = worksheet.getRow(rowNumber);

  for (let col = 1; col <= worksheet.columnCount; col += 1) {
    const header = normalizeHeader(coerceString(row.getCell(col).value));
    if (!header || headerMap.has(header)) continue;
    headerMap.set(header, col);
  }

  return headerMap;
}

function findColumn(headerMap: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const col = headerMap.get(normalizeHeader(alias));
    if (col) return col;
  }
  return -1;
}

function resolveSourceLayout(worksheet: ExcelJS.Worksheet): SourceLayout | null {
  for (let rowNumber = 1; rowNumber <= Math.min(HEADER_SCAN_LIMIT, worksheet.rowCount); rowNumber += 1) {
    const headerMap = readHeaderMap(worksheet, rowNumber);
    const codigoCol = findColumn(headerMap, ["Codigo", "Código"]);
    const nomeCol = findColumn(headerMap, ["Nome", "Nome Fantasia"]);
    const cpfCnpjCol = findColumn(headerMap, ["CPF_CNPJ", "CPF/CNPJ", "CNPJ/CPF"]);
    const dataVencimentoCol = findColumn(headerMap, ["Data Vencimento", "Vencimento"]);
    const tituloCol = findColumn(headerMap, ["Titulo", "Título"]);
    const dataPagamentoCol = findColumn(headerMap, ["Data Pagamento"]);
    const parcelaCol = findColumn(headerMap, ["Parcela"]);
    const loteNfCol = findColumn(headerMap, ["Lote NF"]);
    const nfCol = findColumn(headerMap, ["NF"]);
    const dtEmissaoCol = findColumn(headerMap, ["Dt Emissao", "Dt. Emissao", "Data Emissao"]);

    const requiredColumns = [
      codigoCol,
      nomeCol,
      cpfCnpjCol,
      dataVencimentoCol,
      tituloCol,
      dataPagamentoCol,
      parcelaCol,
      loteNfCol,
      nfCol,
      dtEmissaoCol,
    ];

    if (requiredColumns.every((col) => col > 0)) {
      return {
        headerRowNumber: rowNumber,
        codigoCol,
        nomeCol,
        cpfCnpjCol,
        dataVencimentoCol,
        tituloCol,
        dataPagamentoCol,
        parcelaCol,
        loteNfCol,
        nfCol,
        dtEmissaoCol,
      };
    }
  }

  return null;
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
  headerRowNumber: number,
  lineNumbers: Set<number>,
): void {
  copyColumnWidths(source, target);

  for (let rowNumber = 1; rowNumber <= headerRowNumber; rowNumber += 1) {
    const values = Array.from({ length: source.columnCount }, (_, index) =>
      source.getRow(rowNumber).getCell(index + 1).value,
    );
    target.addRow(values);
  }

  for (let rowNumber = headerRowNumber + 1; rowNumber <= source.rowCount; rowNumber += 1) {
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
  headerRowNumber: number,
  lineNumbers: Set<number>,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const treatedSheet = workbook.addWorksheet("tratada");
  createTreatedWorksheet(source, treatedSheet, headerRowNumber, lineNumbers);
  return workbook;
}

function buildSourceRows(
  worksheet: ExcelJS.Worksheet,
  layout: SourceLayout,
): CanceladaSourceRow[] {
  const rows: CanceladaSourceRow[] = [];

  for (let rowNumber = layout.headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const parsed: CanceladaSourceRow = {
      linhaOrigem: rowNumber,
      codigo: coerceString(row.getCell(layout.codigoCol).value),
      nome: coerceString(row.getCell(layout.nomeCol).value),
      cpfCnpj: coerceString(row.getCell(layout.cpfCnpjCol).value),
      dataVencimento: coerceDate(row.getCell(layout.dataVencimentoCol).value),
      titulo: coerceNumber(row.getCell(layout.tituloCol).value),
      dataPagamento: coerceDate(row.getCell(layout.dataPagamentoCol).value),
      parcela: coerceString(row.getCell(layout.parcelaCol).value),
      loteNf: coerceString(row.getCell(layout.loteNfCol).value),
      nf: coerceString(row.getCell(layout.nfCol).value),
      dtEmissao: coerceDate(row.getCell(layout.dtEmissaoCol).value),
    };

    if (!isValidRow(parsed)) continue;
    rows.push(parsed);
  }

  if (rows.length === 0) {
    throw new ContraprestacoesError(
      "Base mensal de canceladas sem registros validos.",
      "Nenhum registro valido foi encontrado na base de Canceladas.",
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
    await sourceWorkbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer, XLSX_LOAD_OPTIONS);

    onProgress?.({
      value: 24,
      label: "Localizando base",
      detail: "Buscando a aba e o cabecalho corretos para iniciar o tratamento mensal.",
    });

    const originalSheet =
      sourceWorkbook.worksheets.find((sheet) => {
        const normalized = normalizeSheetName(sheet.name);
        return normalized.includes("ORIGINAL") || normalized.includes("ORGINAL");
      }) ?? sourceWorkbook.worksheets[0];

    if (!originalSheet) {
      throw new ContraprestacoesError(
        "Base de canceladas ausente.",
        "Nao foi possivel localizar uma aba valida no arquivo de Canceladas.",
      );
    }

    const sourceLayout = resolveSourceLayout(originalSheet);
    if (!sourceLayout) {
      throw new ContraprestacoesError(
        "Cabecalho da base de canceladas nao reconhecido.",
        "Nao foi possivel identificar o cabecalho da base de Canceladas. Verifique se o arquivo segue o padrao exportado com colunas como Codigo, Nome Fantasia, CPF_CNPJ, Data Vencimento, Titulo, Data Pagamento, Parcela, Lote NF, NF e Dt. Emissao.",
      );
    }

    onProgress?.({
      value: 36,
      label: "Lendo linhas da base",
      detail: "Extraindo as colunas operacionais da base para montar a area de trabalho.",
    });

    const sourceRows = buildSourceRows(originalSheet, sourceLayout);
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
      detail: "Recriando a aba tratada com o topo original e as linhas mantidas da competencia.",
    });

    const treatedLineNumbers = new Set(treatedRows.map((row) => row.linhaOrigem));
    const treatedWorkbook = createTreatedWorkbook(
      originalSheet,
      sourceLayout.headerRowNumber,
      treatedLineNumbers,
    );

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
