import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { ContraprestacoesReportFactory } from "../../src/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

type SheetSummary = {
  sheet: string;
  dataRows: number;
  totalRecebido: number | null;
};

type WorkbookSummary = {
  file: string;
  sheets: SheetSummary[];
  totalRows: number;
  totalRecebido: number | null;
};

type MonthConfig = {
  ano: number;
  mes: number;
  baseDir: string;
  baseFile: string;
  manualFiles: string[];
  systemToManual: Map<string, string>;
};

function parseArgs(): MonthConfig {
  const [anoArg, mesArg, baseFileArg, baseDirArg] = process.argv.slice(2);
  if (!anoArg || !mesArg || !baseFileArg || !baseDirArg) {
    throw new Error("Uso: tsx compare-recebidas-month.ts <ano> <mes> <baseFile> <baseDir>");
  }

  const ano = Number(anoArg);
  const mes = Number(mesArg);
  const token = `${String(mes).padStart(2, "0")}.${ano}`;

  const manualFiles = [
    `Recebidos ${token} - Agente Recebedor.xlsx`,
    `Recebidos ${token} - Boleto Bancário.xlsx`,
    `Recebidos ${token} - Cartão de Crédito.xlsx`,
    `Recebidos ${token} - Cartão de Débito.xlsx`,
    `Recebidos ${token} - Débito em Conta.xlsx`,
    `Recebidos ${token} - Devolução de Mensalidade.xlsx`,
    `Recebidos ${token} - Dinheiro - Caixinha.xlsx`,
    `Recebidos ${token} - Enel.xlsx`,
  ];

  const systemToManual = new Map<string, string>([
    [`Mensalidade Recebida ${token} - Agente recebedor.xlsx`, `Recebidos ${token} - Agente Recebedor.xlsx`],
    [`Mensalidade Recebida ${token} - Boleto.xlsx`, `Recebidos ${token} - Boleto Bancário.xlsx`],
    [`Mensalidade Recebida ${token} - Cartao de credito.xlsx`, `Recebidos ${token} - Cartão de Crédito.xlsx`],
    [`Mensalidade Recebida ${token} - Cartao de debito.xlsx`, `Recebidos ${token} - Cartão de Débito.xlsx`],
    [`Mensalidade Recebida ${token} - Debito em Conta.xlsx`, `Recebidos ${token} - Débito em Conta.xlsx`],
    [`Mensalidade Recebida ${token} - Devolucao de Mensalidade.xlsx`, `Recebidos ${token} - Devolução de Mensalidade.xlsx`],
    [`Mensalidade Recebida ${token} - Dinheiro - Caixinha.xlsx`, `Recebidos ${token} - Dinheiro - Caixinha.xlsx`],
    [`Mensalidade Recebida ${token} - Enel.xlsx`, `Recebidos ${token} - Enel.xlsx`],
  ]);

  return {
    ano,
    mes,
    baseDir: baseDirArg,
    baseFile: baseFileArg,
    manualFiles,
    systemToManual,
  };
}

function loadDotEnv(filePath: string): void {
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(5, worksheet.rowCount); rowNumber += 1) {
    const values = (worksheet.getRow(rowNumber).values as unknown[])
      .slice(1)
      .map((value) => normalizeText(coerceString(value)))
      .filter(Boolean);

    const hasCodigo = values.includes("CODIGO") || values.includes("COD");
    const hasRecebido = values.includes("RECEBIDO") || values.includes("VALOR PAGAMENTO");
    if (hasCodigo || hasRecebido) return rowNumber;
  }
  return null;
}

function findColumnByHeader(worksheet: ExcelJS.Worksheet, headerRow: number, aliases: string[]): number {
  const normalizedAliases = aliases.map((alias) => normalizeText(alias).replace(/[^\w]/g, ""));
  const row = worksheet.getRow(headerRow);
  for (let col = 1; col <= worksheet.actualColumnCount || col <= worksheet.columnCount; col += 1) {
    const current = normalizeText(coerceString(row.getCell(col).value)).replace(/[^\w]/g, "");
    if (normalizedAliases.includes(current)) return col;
  }
  return -1;
}

function summarizeWorksheet(worksheet: ExcelJS.Worksheet): SheetSummary {
  const headerRow = findHeaderRow(worksheet);
  if (!headerRow) {
    return { sheet: worksheet.name, dataRows: 0, totalRecebido: null };
  }

  const codigoCol = findColumnByHeader(worksheet, headerRow, ["CODIGO", "Código"]);
  const recebidoCol = findColumnByHeader(worksheet, headerRow, ["RECEBIDO", "VALOR PAGAMENTO"]);

  let dataRows = 0;
  let totalRecebido = 0;
  const hasRecebido = recebidoCol > 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    if (codigoCol > 0 && !coerceString(row.getCell(codigoCol).value)) return;
    dataRows += 1;
    if (recebidoCol > 0) {
      totalRecebido += coerceNumber(row.getCell(recebidoCol).value);
    }
  });

  return {
    sheet: worksheet.name,
    dataRows,
    totalRecebido: hasRecebido ? Number(totalRecebido.toFixed(2)) : null,
  };
}

async function summarizeWorkbookFromFile(filePath: string): Promise<WorkbookSummary> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets = workbook.worksheets.map(summarizeWorksheet);
  const totals = sheets
    .map((sheet) => sheet.totalRecebido)
    .filter((value): value is number => value !== null);
  return {
    file: path.basename(filePath),
    sheets,
    totalRows: sheets.reduce((sum, sheet) => sum + sheet.dataRows, 0),
    totalRecebido: totals.length > 0 ? Number(totals.reduce((a, b) => a + b, 0).toFixed(2)) : null,
  };
}

async function summarizeWorkbookFromBuffer(fileName: string, buffer: Uint8Array): Promise<WorkbookSummary> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets = workbook.worksheets.map(summarizeWorksheet);
  const totals = sheets
    .map((sheet) => sheet.totalRecebido)
    .filter((value): value is number => value !== null);
  return {
    file: fileName,
    sheets,
    totalRows: sheets.reduce((sum, sheet) => sum + sheet.dataRows, 0),
    totalRecebido: totals.length > 0 ? Number(totals.reduce((a, b) => a + b, 0).toFixed(2)) : null,
  };
}

function summarizeBySheet(summary: WorkbookSummary): Record<string, SheetSummary> {
  const map: Record<string, SheetSummary> = {};
  for (const sheet of summary.sheets) {
    map[normalizeText(sheet.sheet)] = sheet;
  }
  return map;
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));
  const config = parseArgs();

  const parser = new RecebidasWorkbookParser();
  const reportFactory = new ContraprestacoesReportFactory();
  const recebidasBuffer = fs.readFileSync(config.baseFile);
  const parsed = await parser.parse(recebidasBuffer);
  const canceladasParcelas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladasParcelas, { ano: config.ano, mes: config.mes });
  const reports = await reportFactory.buildReports(processed, { ano: config.ano, mes: config.mes });

  const manualSummaries = new Map<string, WorkbookSummary>();
  for (const file of config.manualFiles) {
    const manualPath = path.join(config.baseDir, file);
    if (!fs.existsSync(manualPath)) continue;
    manualSummaries.set(file, await summarizeWorkbookFromFile(manualPath));
  }

  const systemSummaries = new Map<string, WorkbookSummary>();
  for (const report of reports) {
    systemSummaries.set(report.fileName, await summarizeWorkbookFromBuffer(report.fileName, report.buffer));
  }

  const comparisons = [];
  for (const [systemFile, manualFile] of config.systemToManual.entries()) {
    const system = systemSummaries.get(systemFile);
    const manual = manualSummaries.get(manualFile);
    if (!system || !manual) continue;

    const systemSheets = summarizeBySheet(system);
    const manualSheets = summarizeBySheet(manual);
    const sheetKeys = Array.from(new Set([...Object.keys(systemSheets), ...Object.keys(manualSheets)]));

    comparisons.push({
      systemFile,
      manualFile,
      systemTotalRows: system.totalRows,
      manualTotalRows: manual.totalRows,
      rowDelta: system.totalRows - manual.totalRows,
      systemTotalRecebido: system.totalRecebido,
      manualTotalRecebido: manual.totalRecebido,
      recebidoDelta:
        system.totalRecebido !== null && manual.totalRecebido !== null
          ? Number((system.totalRecebido - manual.totalRecebido).toFixed(2))
          : null,
      bySheet: sheetKeys.map((key) => ({
        sheet: key,
        systemRows: systemSheets[key]?.dataRows ?? 0,
        manualRows: manualSheets[key]?.dataRows ?? 0,
        rowDelta: (systemSheets[key]?.dataRows ?? 0) - (manualSheets[key]?.dataRows ?? 0),
        systemRecebido: systemSheets[key]?.totalRecebido ?? null,
        manualRecebido: manualSheets[key]?.totalRecebido ?? null,
      })),
    });
  }

  const orphanSystemFiles = [...systemSummaries.keys()].filter((file) => !config.systemToManual.has(file));

  console.log(
    JSON.stringify(
      {
        competencia: `${String(config.mes).padStart(2, "0")}/${config.ano}`,
        parsedRows: parsed.length,
        processedRows: processed.length,
        recuperadas: processed.filter((row) => row.grupo === "RECUPERADA").length,
        recebidas: processed.filter((row) => row.grupo === "RECEBIDA").length,
        comparisons,
        orphanSystemFiles,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
