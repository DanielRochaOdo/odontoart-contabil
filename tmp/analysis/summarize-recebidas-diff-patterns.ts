import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { ContraprestacoesReportFactory } from "../../src/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

type FilePair = { system: string; manual: string };

function parseArgs() {
  const [anoArg, mesArg, baseFileArg, baseDirArg] = process.argv.slice(2);
  if (!anoArg || !mesArg || !baseFileArg || !baseDirArg) {
    throw new Error("Uso: tsx summarize-recebidas-diff-patterns.ts <ano> <mes> <baseFile> <baseDir>");
  }

  const ano = Number(anoArg);
  const mes = Number(mesArg);
  const token = `${String(mes).padStart(2, "0")}.${ano}`;

  const filePairs: FilePair[] = [
    {
      system: `Mensalidade Recebida ${token} - Boleto.xlsx`,
      manual: `Recebidos ${token} - Boleto Bancário.xlsx`,
    },
    {
      system: `Mensalidade Recebida ${token} - Cartao de credito.xlsx`,
      manual: `Recebidos ${token} - Cartão de Crédito.xlsx`,
    },
    {
      system: `Mensalidade Recebida ${token} - Devolucao de Mensalidade.xlsx`,
      manual: `Recebidos ${token} - Devolução de Mensalidade.xlsx`,
    },
  ];

  return { ano, mes, baseFile: baseFileArg, baseDir: baseDirArg, filePairs };
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

function rowKey(codigo: string, parcela: string, recebido: number): string {
  return `${codigo.trim()}|${parcela.trim()}|${recebido.toFixed(2)}`;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 5); rowNumber += 1) {
    const values = (sheet.getRow(rowNumber).values as unknown[])
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
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

function diffMultiset(left: Map<string, number>, right: Map<string, number>): string[] {
  const diff: string[] = [];
  for (const [key, leftCount] of left.entries()) {
    const rightCount = right.get(key) ?? 0;
    for (let index = 0; index < leftCount - rightCount; index += 1) diff.push(key);
  }
  return diff;
}

function bucketRows(keys: string[], processedByKey: Map<string, ProcessedRecebidaRow[]>): Record<string, { count: number; total: number }> {
  const buckets: Record<string, { count: number; total: number }> = {};

  for (const key of keys) {
    const row = (processedByKey.get(key) ?? [])[0];
    if (!row) {
      const current = buckets["NAO_ENCONTRADO"] ?? { count: 0, total: 0 };
      current.count += 1;
      buckets["NAO_ENCONTRADO"] = current;
      continue;
    }

    const bucketKey = [
      normalizeText(row.tipoRecebimento),
      normalizeText(row.tipoPagamento),
      normalizeText(row.tipoParcela),
      normalizeText(row.loteNf),
      row.devolucaoMensalidade ? "DEVOLUCAO" : "NORMAL",
      row.observacoes.join(" | "),
    ].join(" || ");

    const current = buckets[bucketKey] ?? { count: 0, total: 0 };
    current.count += 1;
    current.total = Number((current.total + row.valorPagamento).toFixed(2));
    buckets[bucketKey] = current;
  }

  return Object.fromEntries(
    Object.entries(buckets).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return b[1].total - a[1].total;
    }),
  );
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));
  const config = parseArgs();

  const parser = new RecebidasWorkbookParser();
  const reportFactory = new ContraprestacoesReportFactory();
  const parsed = await parser.parse(fs.readFileSync(config.baseFile));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano: config.ano, mes: config.mes });
  const reports = await reportFactory.buildReports(processed, { ano: config.ano, mes: config.mes });

  const processedByKey = new Map<string, ProcessedRecebidaRow[]>();
  for (const row of processed) {
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento);
    const list = processedByKey.get(key) ?? [];
    list.push(row);
    processedByKey.set(key, list);
  }

  const output: Record<string, unknown> = {};
  for (const file of config.filePairs) {
    const systemReport = reports.find((report) => report.fileName === file.system);
    const manualPath = path.join(config.baseDir, file.manual);
    if (!systemReport || !fs.existsSync(manualPath)) continue;

    const systemWorkbook = new ExcelJS.Workbook();
    await systemWorkbook.xlsx.load(systemReport.buffer as unknown as ExcelJS.Buffer);
    const manualWorkbook = new ExcelJS.Workbook();
    await manualWorkbook.xlsx.readFile(manualPath);

    const systemKeys = multiset(extractKeys(systemWorkbook));
    const manualKeys = multiset(extractKeys(manualWorkbook));
    const onlyInSystem = diffMultiset(systemKeys, manualKeys);
    const onlyInManual = diffMultiset(manualKeys, systemKeys);

    output[file.system] = {
      onlyInSystemCount: onlyInSystem.length,
      onlyInManualCount: onlyInManual.length,
      onlyInSystemBuckets: bucketRows(onlyInSystem, processedByKey),
      onlyInManualBuckets: bucketRows(onlyInManual, processedByKey),
    };
  }

  console.log(JSON.stringify({ competencia: `${String(config.mes).padStart(2, "0")}/${config.ano}`, output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
