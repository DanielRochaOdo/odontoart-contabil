import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow, RecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { coerceDate, coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

const BASE_DIR =
  "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\03.2026";
const BASE_FILE = path.join(BASE_DIR, "BASE RECEBIDAS 03.2026 - Copia.xlsx");
const DEVOLUCAO_FILE = path.join(BASE_DIR, "Recebidos 03.2026 - Devolução de Mensalidade.xlsx");
const BOLETO_FILE = path.join(BASE_DIR, "Recebidos 03.2026 - Boleto Bancário.xlsx");

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

function dateKey(value: Date | null): string {
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rowKey(
  codigo: string,
  parcela: string,
  recebido: number,
  dataPagamento: Date | null,
): string {
  return `${codigo.trim()}|${parcela.trim()}|${recebido.toFixed(2)}|${dateKey(dataPagamento)}`;
}

function workbookKeys(
  workbook: ExcelJS.Workbook,
  config: { codigo: number; parcela: number; recebido: number; dataPagamento: number },
): string[] {
  const keys: string[] = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const codigo = coerceString(row.getCell(config.codigo).value);
      const parcela = coerceString(row.getCell(config.parcela).value);
      const recebido = coerceNumber(row.getCell(config.recebido).value);
      const dataPagamento = coerceDate(row.getCell(config.dataPagamento).value);
      if (!codigo || !parcela) return;
      keys.push(rowKey(codigo, parcela, recebido, dataPagamento));
    });
  }
  return keys;
}

function aggregate(rows: Array<{ original: RecebidaRow; processed: ProcessedRecebidaRow }>) {
  const groups = new Map<string, { count: number; total: number; examples: string[] }>();

  for (const item of rows) {
    const { original, processed } = item;
    const key = [
      `origTipoRec=${normalizeText(original.tipoRecebimento)}`,
      `origTipoPag=${normalizeText(original.tipoPagamento)}`,
      `origLoteVazio=${normalizeText(original.loteNf) === "" ? "SIM" : "NAO"}`,
      `procTipoRec=${normalizeText(processed.tipoRecebimento)}`,
      `procLote=${normalizeText(processed.loteNf)}`,
      `devolucao=${processed.devolucaoMensalidade ? "SIM" : "NAO"}`,
      `obs=${processed.observacoes.join(";")}`,
    ].join(" | ");

    const current = groups.get(key) ?? { count: 0, total: 0, examples: [] };
    current.count += 1;
    current.total = Number((current.total + processed.valorPagamento).toFixed(2));
    if (current.examples.length < 5) {
      current.examples.push(
        `${processed.codigo} | ${processed.parcela} | ${processed.valorPagamento.toFixed(2)} | ${dateKey(processed.dataPagamento)}`,
      );
    }
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([pattern, data]) => ({ pattern, ...data }))
    .sort((a, b) => b.count - a.count || b.total - a.total);
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(BASE_FILE));
  const originalByLine = new Map<number, RecebidaRow>(parsed.map((row) => [row.linhaOrigem, row]));
  const canceladasParcelas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladasParcelas, { ano: 2026, mes: 3 });

  const processedByKey = new Map<string, Array<{ original: RecebidaRow; processed: ProcessedRecebidaRow }>>();
  for (const row of processed) {
    const original = originalByLine.get(row.linhaOrigem);
    if (!original) continue;
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento, row.dataPagamento);
    const list = processedByKey.get(key) ?? [];
    list.push({ original, processed: row });
    processedByKey.set(key, list);
  }

  const devolucaoWorkbook = new ExcelJS.Workbook();
  await devolucaoWorkbook.xlsx.readFile(DEVOLUCAO_FILE);
  const manualDevolucaoKeys = new Set(
    workbookKeys(devolucaoWorkbook, { codigo: 1, parcela: 11, recebido: 9, dataPagamento: 4 }),
  );

  const boletoWorkbook = new ExcelJS.Workbook();
  await boletoWorkbook.xlsx.readFile(BOLETO_FILE);
  const manualBoletoKeys = new Set(
    workbookKeys(boletoWorkbook, { codigo: 1, parcela: 12, recebido: 10, dataPagamento: 6 }),
  );

  const currentDevolucao = processed.filter((row) => row.grupo === "RECEBIDA" && row.devolucaoMensalidade);

  const currentDevolucaoButManualBoleto: Array<{ original: RecebidaRow; processed: ProcessedRecebidaRow }> = [];
  for (const row of currentDevolucao) {
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento, row.dataPagamento);
    if (!manualBoletoKeys.has(key)) continue;
    const original = originalByLine.get(row.linhaOrigem);
    if (!original) continue;
    currentDevolucaoButManualBoleto.push({ original, processed: row });
  }

  const manualDevolucaoButNotCurrent: Array<{ original: RecebidaRow; processed: ProcessedRecebidaRow }> = [];
  for (const key of manualDevolucaoKeys) {
    const matches = processedByKey.get(key) ?? [];
    for (const match of matches) {
      if (!match.processed.devolucaoMensalidade) {
        manualDevolucaoButNotCurrent.push(match);
      }
    }
  }

  const currentLoteVazioNotManualDevolucao: Array<{ original: RecebidaRow; processed: ProcessedRecebidaRow }> = [];
  for (const row of processed) {
    if (row.grupo !== "RECEBIDA") continue;
    if (normalizeText(row.loteNf) !== "DEVOLUCAO") continue;
    const key = rowKey(row.codigo, row.parcela, row.valorPagamento, row.dataPagamento);
    if (manualDevolucaoKeys.has(key)) continue;
    const original = originalByLine.get(row.linhaOrigem);
    if (!original) continue;
    currentLoteVazioNotManualDevolucao.push({ original, processed: row });
  }

  console.log(
    JSON.stringify(
      {
        currentDevolucaoButManualBoleto: aggregate(currentDevolucaoButManualBoleto),
        manualDevolucaoButNotCurrent: aggregate(manualDevolucaoButNotCurrent),
        currentLoteVazioNotManualDevolucao: aggregate(currentLoteVazioNotManualDevolucao),
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
