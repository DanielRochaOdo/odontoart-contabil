import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { ContraprestacoesReportFactory } from "../../src/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

const BASE_DIR =
  "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\03.2026";
const BASE_FILE = path.join(BASE_DIR, "BASE RECEBIDAS 03.2026 - Copia.xlsx");

const FILES = [
  {
    system: "Mensalidade Recebida 03.2026 - Boleto.xlsx",
    manual: "Recebidos 03.2026 - Boleto Bancário.xlsx",
  },
  {
    system: "Mensalidade Recebida 03.2026 - Cartao de credito.xlsx",
    manual: "Recebidos 03.2026 - Cartão de Crédito.xlsx",
  },
  {
    system: "Mensalidade Recebida 03.2026 - Devolucao de Mensalidade.xlsx",
    manual: "Recebidos 03.2026 - Devolução de Mensalidade.xlsx",
  },
  {
    system: "Mensalidade Recebida 03.2026 - Dinheiro - Caixinha.xlsx",
    manual: "Recebidos 03.2026 - Dinheiro - Caixinha.xlsx",
  },
  {
    system: "Mensalidade Recebida 03.2026 - Agente recebedor.xlsx",
    manual: "Recebidos 03.2026 - Agente Recebedor.xlsx",
  },
  {
    system: "Mensalidade Recebida 03.2026 - Enel.xlsx",
    manual: "Recebidos 03.2026 - Enel.xlsx",
  },
] as const;

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

function rowKey(codigo: string, parcela: string, recebido: number): string {
  return `${codigo.trim()}|${parcela.trim()}|${recebido.toFixed(2)}`;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 5); rowNumber += 1) {
    const values = sheet
      .getRow(rowNumber)
      .values
      .slice(1)
      .map((value) => normalizeText(coerceString(value)));
    if (values.includes("CODIGO")) return rowNumber;
  }
  return 1;
}

function findColumn(sheet: ExcelJS.Worksheet, headerRowNumber: number, aliases: string[]): number {
  const wanted = aliases.map((value) => normalizeText(value));
  const headerRow = sheet.getRow(headerRowNumber);
  const maxColumns = Math.max(sheet.actualColumnCount, sheet.columnCount);
  for (let column = 1; column <= maxColumns; column += 1) {
    const current = normalizeText(coerceString(headerRow.getCell(column).value));
    if (wanted.includes(current)) return column;
  }
  return -1;
}

function extractKeys(workbook: ExcelJS.Workbook): string[] {
  const keys: string[] = [];

  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet);
    const codigoColumn = findColumn(sheet, headerRow, ["Código", "Codigo"]);
    const parcelaColumn = findColumn(sheet, headerRow, ["Nº Parc", "Nº Parcela", "Parcela", "N Parc", "N Parcela"]);
    const recebidoColumn = findColumn(sheet, headerRow, ["Recebido"]);

    if (codigoColumn < 0 || parcelaColumn < 0 || recebidoColumn < 0) continue;

    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const codigo = coerceString(row.getCell(codigoColumn).value);
      const parcela = coerceString(row.getCell(parcelaColumn).value);
      const recebido = coerceNumber(row.getCell(recebidoColumn).value);
      if (!codigo || !parcela) continue;
      keys.push(rowKey(codigo, parcela, recebido));
    }
  }

  return keys;
}

function multiset(keys: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const key of keys) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function diffMultiset(left: Map<string, number>, right: Map<string, number>): string[] {
  const diff: string[] = [];
  for (const [key, leftCount] of left.entries()) {
    const rightCount = right.get(key) ?? 0;
    for (let index = 0; index < leftCount - rightCount; index += 1) {
      diff.push(key);
    }
  }
  return diff;
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const parser = new RecebidasWorkbookParser();
  const reportFactory = new ContraprestacoesReportFactory();
  const parsed = await parser.parse(fs.readFileSync(BASE_FILE));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano: 2026, mes: 3 });
  const reports = await reportFactory.buildReports(processed, { ano: 2026, mes: 3 });

  const processedByKey = new Map<string, ProcessedRecebidaRow[]>();
  for (const row of processed) {
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento);
    const list = processedByKey.get(key) ?? [];
    list.push(row);
    processedByKey.set(key, list);
  }

  const output: Record<string, unknown> = {};

  for (const file of FILES) {
    const systemReport = reports.find((report) => report.fileName === file.system);
    if (!systemReport) continue;

    const systemWorkbook = new ExcelJS.Workbook();
    await systemWorkbook.xlsx.load(systemReport.buffer as unknown as ExcelJS.Buffer);
    const manualWorkbook = new ExcelJS.Workbook();
    await manualWorkbook.xlsx.readFile(path.join(BASE_DIR, file.manual));

    const systemKeys = multiset(extractKeys(systemWorkbook));
    const manualKeys = multiset(extractKeys(manualWorkbook));

    const onlyInSystem = diffMultiset(systemKeys, manualKeys).map((key) => ({
      key,
      rows: (processedByKey.get(key) ?? []).map((row) => ({
        linha: row.linhaOrigem,
        codigo: row.codigo,
        parcela: row.parcela,
        recebido: row.valorPagamento,
        tipoRecebimento: row.tipoRecebimento,
        tipoPagamento: row.tipoPagamento,
        loteNf: row.loteNf,
        pessoaTipo: row.pessoaTipo,
        devolucaoMensalidade: row.devolucaoMensalidade,
      })),
    }));
    const onlyInManual = diffMultiset(manualKeys, systemKeys).map((key) => ({
      key,
      rows: (processedByKey.get(key) ?? []).map((row) => ({
        linha: row.linhaOrigem,
        codigo: row.codigo,
        parcela: row.parcela,
        recebido: row.valorPagamento,
        tipoRecebimento: row.tipoRecebimento,
        tipoPagamento: row.tipoPagamento,
        loteNf: row.loteNf,
        pessoaTipo: row.pessoaTipo,
        devolucaoMensalidade: row.devolucaoMensalidade,
      })),
    }));

    output[file.system] = {
      onlyInSystemCount: onlyInSystem.length,
      onlyInManualCount: onlyInManual.length,
      onlyInSystem,
      onlyInManual,
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
