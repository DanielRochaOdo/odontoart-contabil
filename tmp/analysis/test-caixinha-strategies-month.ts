import fs from "node:fs";
import path from "node:path";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { ProcessedRecebidaRow } from "../../src/features/contraprestacoes/domain/types";
import { normalizeText } from "../../src/features/eventos/services/utils";

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

function summarize(name: string, rows: ProcessedRecebidaRow[]) {
  return {
    name,
    count: rows.length,
    total: total(rows),
    first: rows[0]?.linhaOrigem ?? null,
    last: rows.at(-1)?.linhaOrigem ?? null,
  };
}

async function analyzeMonth(ano: number, mes: number, baseFile: string) {
  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(baseFile));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano, mes });
  const dinheiro = processed.filter(
    (row) => row.grupo === "RECEBIDA" && !row.devolucaoMensalidade && normalizeText(row.tipoRecebimento) === "DINHEIRO",
  );

  const byOriginal = [...dinheiro];
  const byOriginalDesc = [...dinheiro].sort((a, b) => b.linhaOrigem - a.linhaOrigem);
  const pfOriginal = byOriginal.filter((row) => row.pessoaTipo === "PF");
  const pfOriginalDesc = byOriginalDesc.filter((row) => row.pessoaTipo === "PF");

  return {
    competencia: `${String(mes).padStart(2, "0")}/${ano}`,
    strategies: [
      summarize("greedy-original-1000", greedy(byOriginal, 1000)),
      summarize("greedy-reverse-1000", greedy(byOriginalDesc, 1000)),
      summarize("greedy-above-original-1000", greedyUntilAbove(byOriginal, 1000)),
      summarize("greedy-above-reverse-1000", greedyUntilAbove(byOriginalDesc, 1000)),
      summarize("greedy-pf-original-1000", greedy(pfOriginal, 1000)),
      summarize("greedy-pf-reverse-1000", greedy(pfOriginalDesc, 1000)),
      summarize("greedy-above-pf-original-1000", greedyUntilAbove(pfOriginal, 1000)),
      summarize("greedy-above-pf-reverse-1000", greedyUntilAbove(pfOriginalDesc, 1000)),
    ],
  };
}

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const results = await Promise.all([
    analyzeMonth(2026, 1, "c:\\Users\\daniel.rocha\\Desktop\\contabilart_bases\\recebidas\\BASE RECEBIDAS 01.2026 - Copia.xlsx"),
    analyzeMonth(2026, 2, "c:\\Users\\daniel.rocha\\Desktop\\contabilart_bases\\recebidas\\BASE RECEBIDAS 02.2026 - Copia.xlsx"),
    analyzeMonth(2026, 3, "c:\\Users\\daniel.rocha\\Desktop\\contabilart_bases\\recebidas\\BASE RECEBIDAS 03.2026 - Copia.xlsx"),
    analyzeMonth(
      2026,
      4,
      "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\04.2026\\BASE RECEBIDAS 04.2026 - Contabil-ART.xlsx",
    ),
  ]);

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
