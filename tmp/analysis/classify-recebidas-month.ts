import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

const BOLETO_TYPES = new Set(
  [
    "BANCO DO BRASIL CLINICO",
    "PIX ODONTOART - P4X",
    "ITAU PJ",
    "BANCO DO BRASIL CLINICO EMPRESA",
    "DEPOSITO BANCARIO BB",
    "PIX CLINICO",
    "PIX - CLINICO",
    "DEPOSITO BANCARIO ITAU",
    "DEPOSITO BANCARIO",
    "BRADESCO",
    "SANTANDER PMF",
  ].map((value) => normalizeText(value)),
);

const CARTAO_CREDITO_TYPES = new Set(
  [
    "CARTAO DE CRÉDITO ODONTOART - P4X EXTERNO",
    "CARTAO DE CRÉDITO ODONTOART - P4X",
    "CARTAO DE CREDITO - REDE - PLANO",
    "CARTAO DE CREDITO - CENTERCOB - PLANO",
  ].map((value) => normalizeText(value)),
);

const ENEL_TYPES = new Set(["ENEL CE"].map((value) => normalizeText(value)));

type CategoryKey =
  | "boleto"
  | "credito"
  | "devolucao"
  | "caixinha"
  | "enel"
  | "agente"
  | "pix"
  | "debito"
  | "cartao_debito";

function parseArgs() {
  const [anoArg, mesArg, baseFileArg, baseDirArg] = process.argv.slice(2);
  if (!anoArg || !mesArg || !baseFileArg || !baseDirArg) {
    throw new Error("Uso: tsx classify-recebidas-month.ts <ano> <mes> <baseFile> <baseDir>");
  }

  const ano = Number(anoArg);
  const mes = Number(mesArg);
  const token = `${String(mes).padStart(2, "0")}.${ano}`;

  const manualFiles: Record<CategoryKey, string> = {
    agente: `Recebidos ${token} - Agente Recebedor.xlsx`,
    boleto: `Recebidos ${token} - Boleto Bancário.xlsx`,
    credito: `Recebidos ${token} - Cartão de Crédito.xlsx`,
    cartao_debito: `Recebidos ${token} - Cartão de Débito.xlsx`,
    debito: `Recebidos ${token} - Débito em Conta.xlsx`,
    devolucao: `Recebidos ${token} - Devolução de Mensalidade.xlsx`,
    caixinha: `Recebidos ${token} - Dinheiro - Caixinha.xlsx`,
    enel: `Recebidos ${token} - Enel.xlsx`,
    pix: `Recebidos ${token} - PIX Recorrente - NOVO.xlsx`,
  };

  return {
    ano,
    mes,
    baseFile: baseFileArg,
    baseDir: baseDirArg,
    manualFiles,
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

function normalizeCategory(row: ProcessedRecebidaRow, caixinhaKeys: Set<number>): string {
  const tipo = normalizeText(row.tipoRecebimento);

  if (row.grupo !== "RECEBIDA") return "recuperada";
  if (row.devolucaoMensalidade) return "devolucao";
  if (tipo === "DINHEIRO") return caixinhaKeys.has(row.linhaOrigem) ? "caixinha" : "agente";
  if (BOLETO_TYPES.has(tipo)) return "boleto";
  if (CARTAO_CREDITO_TYPES.has(tipo)) return "credito";
  if (ENEL_TYPES.has(tipo)) return "enel";
  if (tipo === "PIX RECORRENTE ODONTOART - P4X") return "pix";
  if (tipo === "DEBITO EM CONTA BB") return "debito";
  if (tipo === "CARTAO DEBITO - PLANO") return "cartao_debito";
  return "sem_categoria";
}

function takeRowsNearestTarget(rows: ProcessedRecebidaRow[], target: number): ProcessedRecebidaRow[] {
  const targetCents = Math.round(target * 100);
  const amounts = rows.map((row) => Math.round(row.valorPagamento * 100));
  const totalCents = amounts.reduce((sum, amount) => sum + amount, 0);
  if (rows.length === 0 || totalCents === 0) return [];

  const reachable = new Uint8Array(totalCents + 1);
  const previousSum = new Int32Array(totalCents + 1);
  const previousIndex = new Int32Array(totalCents + 1);
  previousSum.fill(-1);
  previousIndex.fill(-1);
  reachable[0] = 1;

  for (let index = 0; index < amounts.length; index += 1) {
    const amount = amounts[index];
    for (let sum = totalCents - amount; sum >= 0; sum -= 1) {
      if (reachable[sum] !== 1 || reachable[sum + amount] === 1) continue;
      reachable[sum + amount] = 1;
      previousSum[sum + amount] = sum;
      previousIndex[sum + amount] = index;
    }
  }

  let bestSum = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let sum = 1; sum <= totalCents; sum += 1) {
    if (reachable[sum] !== 1) continue;
    const distance = Math.abs(targetCents - sum);
    if (distance < bestDistance || (distance === bestDistance && sum > bestSum)) {
      bestDistance = distance;
      bestSum = sum;
    }
  }

  const selectedIndexes = new Set<number>();
  let cursor = bestSum;
  while (cursor > 0) {
    const index = previousIndex[cursor];
    if (index < 0) break;
    selectedIndexes.add(index);
    cursor = previousSum[cursor];
  }

  return rows.filter((_, index) => selectedIndexes.has(index));
}

function rowKey(codigo: string, parcela: string, recebido: number): string {
  return `${codigo.trim()}|${parcela.trim()}|${recebido.toFixed(2)}`;
}

function extractRows(workbook: ExcelJS.Workbook, category: CategoryKey): string[] {
  const keys: string[] = [];

  const config = {
    boleto: { codigo: 1, parcela: 12, recebido: 10 },
    credito: { codigo: 1, parcela: 13, recebido: 10 },
    devolucao: { codigo: 1, parcela: 11, recebido: 9 },
    caixinha: { codigo: 1, parcela: 12, recebido: 10 },
    enel: { codigo: 1, parcela: 12, recebido: 10 },
    agente: { codigo: 1, parcela: 13, recebido: 11 },
    pix: { codigo: 1, parcela: 12, recebido: 10 },
    debito: { codigo: 1, parcela: 13, recebido: 10 },
    cartao_debito: { codigo: 1, parcela: 13, recebido: 10 },
  }[category];

  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const codigo = coerceString(row.getCell(config.codigo).value).trim();
      const parcela = coerceString(row.getCell(config.parcela).value).trim();
      const recebido = coerceNumber(row.getCell(config.recebido).value);
      if (!codigo || !parcela) return;
      keys.push(rowKey(codigo, parcela, recebido));
    });
  }

  return keys;
}

async function readManualKeys(filePath: string, category: CategoryKey): Promise<string[]> {
  if (!fs.existsSync(filePath)) return [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return extractRows(workbook, category);
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));
  const config = parseArgs();

  const parser = new RecebidasWorkbookParser();
  const recebidasBuffer = fs.readFileSync(config.baseFile);
  const parsed = await parser.parse(recebidasBuffer);
  const canceladasParcelas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladasParcelas, { ano: config.ano, mes: config.mes });

  const dinheiroRecebidas = processed.filter(
    (row) => row.grupo === "RECEBIDA" && !row.devolucaoMensalidade && normalizeText(row.tipoRecebimento) === "DINHEIRO",
  );
  const caixinha = takeRowsNearestTarget(dinheiroRecebidas, 1000);
  const caixinhaKeys = new Set(caixinha.map((row) => row.linhaOrigem));

  const processedByKey = new Map<string, ProcessedRecebidaRow[]>();
  for (const row of processed) {
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento);
    const list = processedByKey.get(key) ?? [];
    list.push(row);
    processedByKey.set(key, list);
  }

  const summary: Record<string, Record<string, { count: number; total: number }>> = {};
  const missing: Record<string, string[]> = {};

  for (const category of Object.keys(config.manualFiles) as CategoryKey[]) {
    const manualKeys = await readManualKeys(path.join(config.baseDir, config.manualFiles[category]), category);
    if (manualKeys.length === 0) continue;

    const buckets: Record<string, { count: number; total: number }> = {};
    const categoryMissing: string[] = [];
    for (const key of manualKeys) {
      const matches = processedByKey.get(key) ?? [];
      if (matches.length === 0) {
        const bucket = buckets.nao_encontrado ?? { count: 0, total: 0 };
        bucket.count += 1;
        buckets.nao_encontrado = bucket;
        categoryMissing.push(key);
        continue;
      }

      const categoryName = normalizeCategory(matches[0], caixinhaKeys);
      const bucket = buckets[categoryName] ?? { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total = Number((bucket.total + matches[0].valorPagamento).toFixed(2));
      buckets[categoryName] = bucket;
    }

    summary[category] = buckets;
    if (categoryMissing.length > 0) missing[category] = categoryMissing;
  }

  console.log(JSON.stringify({ competencia: `${String(config.mes).padStart(2, "0")}/${config.ano}`, summary, missing }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
