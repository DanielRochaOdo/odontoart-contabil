import fs from "node:fs";
import path from "node:path";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { normalizeText } from "../../src/features/eventos/services/utils";

const BASE_FILE =
  "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\03.2026\\BASE RECEBIDAS 03.2026 - Copia.xlsx";

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

function total(rows: ProcessedRecebidaRow[]): number {
  return Number(rows.reduce((sum, row) => sum + row.valorPagamento, 0).toFixed(2));
}

function greedy(rows: ProcessedRecebidaRow[], target: number): ProcessedRecebidaRow[] {
  const selected: ProcessedRecebidaRow[] = [];
  let sum = 0;
  for (const row of rows) {
    const next = sum + row.valorPagamento;
    const currentDistance = Math.abs(target - sum);
    const nextDistance = Math.abs(target - next);
    if (selected.length === 0 || nextDistance <= currentDistance || sum < target) {
      selected.push(row);
      sum = next;
      continue;
    }
    break;
  }
  return selected;
}

function greedyUntilAbove(rows: ProcessedRecebidaRow[], target: number): ProcessedRecebidaRow[] {
  const selected: ProcessedRecebidaRow[] = [];
  let sum = 0;
  for (const row of rows) {
    selected.push(row);
    sum += row.valorPagamento;
    if (sum >= target) break;
  }
  return selected;
}

function nearest(rows: ProcessedRecebidaRow[], target: number): ProcessedRecebidaRow[] {
  const targetCents = Math.round(target * 100);
  const amounts = rows.map((row) => Math.round(row.valorPagamento * 100));
  const totalCents = amounts.reduce((sum, amount) => sum + amount, 0);
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
  const indexes = new Set<number>();
  let cursor = bestSum;
  while (cursor > 0) {
    const index = previousIndex[cursor];
    if (index < 0) break;
    indexes.add(index);
    cursor = previousSum[cursor];
  }
  return rows.filter((_, index) => indexes.has(index));
}

function summarize(name: string, rows: ProcessedRecebidaRow[]) {
  return {
    name,
    count: rows.length,
    total: total(rows),
    pf: rows.filter((row) => row.pessoaTipo === "PF").length,
    pj: rows.filter((row) => row.pessoaTipo === "PJ").length,
  };
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(BASE_FILE));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano: 2026, mes: 3 });
  const dinheiro = processed.filter(
    (row) => row.grupo === "RECEBIDA" && !row.devolucaoMensalidade && normalizeText(row.tipoRecebimento) === "DINHEIRO",
  );

  const byOriginal = [...dinheiro];
  const byValueAsc = [...dinheiro].sort((a, b) => a.valorPagamento - b.valorPagamento || a.linhaOrigem - b.linhaOrigem);
  const byValueDesc = [...dinheiro].sort((a, b) => b.valorPagamento - a.valorPagamento || a.linhaOrigem - b.linhaOrigem);
  const byOriginalDesc = [...dinheiro].sort((a, b) => b.linhaOrigem - a.linhaOrigem);
  const pfOnlyAsc = byValueAsc.filter((row) => row.pessoaTipo === "PF");
  const pfOnlyOriginal = byOriginal.filter((row) => row.pessoaTipo === "PF");
  const pfOnlyOriginalDesc = byOriginalDesc.filter((row) => row.pessoaTipo === "PF");

  console.log(
    JSON.stringify(
      [
        summarize("greedy-original", greedy(byOriginal, 1000)),
        summarize("greedy-above-original", greedyUntilAbove(byOriginal, 1000)),
        summarize("greedy-reverse-original", greedy(byOriginalDesc, 1000)),
        summarize("greedy-above-reverse-original", greedyUntilAbove(byOriginalDesc, 1000)),
        summarize("nearest-original", nearest(byOriginal, 1000)),
        summarize("greedy-asc", greedy(byValueAsc, 1000)),
        summarize("greedy-above-asc", greedyUntilAbove(byValueAsc, 1000)),
        summarize("nearest-asc", nearest(byValueAsc, 1000)),
        summarize("greedy-desc", greedy(byValueDesc, 1000)),
        summarize("greedy-above-desc", greedyUntilAbove(byValueDesc, 1000)),
        summarize("nearest-pf-1002.25", nearest(pfOnlyOriginal, 1002.25)),
        summarize("greedy-above-pf-original", greedyUntilAbove(pfOnlyOriginal, 1000)),
        summarize("greedy-above-pf-asc", greedyUntilAbove(pfOnlyAsc, 1000)),
        summarize("greedy-pf-reverse-original", greedy(pfOnlyOriginalDesc, 1000)),
        summarize("greedy-above-pf-reverse-original", greedyUntilAbove(pfOnlyOriginalDesc, 1000)),
      ],
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
