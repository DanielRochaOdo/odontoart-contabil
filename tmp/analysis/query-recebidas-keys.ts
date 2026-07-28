import fs from "node:fs";
import path from "node:path";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";

const BASE_FILE =
  "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\03.2026\\BASE RECEBIDAS 03.2026 - Copia.xlsx";

const QUERIES = [
  { codigo: "2570", parcela: "6395716", recebido: 38.71 },
  { codigo: "21360", parcela: "6346942", recebido: 15.9 },
  { codigo: "310790204", parcela: "6423844", recebido: 73.26 },
  { codigo: "311188751", parcela: "6367456", recebido: 69.86 },
  { codigo: "310562557", parcela: "6325735", recebido: 46.34 },
  { codigo: "310700152", parcela: "6316015", recebido: 82.68 },
  { codigo: "310716056", parcela: "6323187", recebido: 68.24 },
  { codigo: "310787941", parcela: "6299823", recebido: 62.85 },
  { codigo: "310832719", parcela: "6302244", recebido: 63.09 },
  { codigo: "310834860", parcela: "6323237", recebido: 50.57 },
  { codigo: "310693396", parcela: "2623076", recebido: 55.8 },
  { codigo: "310693396", parcela: "2580556", recebido: 55.8 },
  { codigo: "310693396", parcela: "2535919", recebido: 55.8 },
  { codigo: "3696400", parcela: "6348825", recebido: 5 },
  { codigo: "310965254", parcela: "6403238", recebido: 0.1 },
  { codigo: "310965254", parcela: "6403257", recebido: 0.1 },
  { codigo: "310965254", parcela: "6403273", recebido: 0.1 },
  { codigo: "310965254", parcela: "6403278", recebido: 0.1 },
  { codigo: "310709007", parcela: "2911173", recebido: 13.9 },
  { codigo: "310720801", parcela: "2970433", recebido: 20.9 },
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

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(BASE_FILE));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano: 2026, mes: 3 });

  const output = QUERIES.map((query) => {
    const raw = parsed.filter(
      (row) => row.codigo === query.codigo && row.parcela === query.parcela && Math.abs(row.valorPagamento - query.recebido) < 0.001,
    );
    const treated = processed.filter(
      (row) => row.codigo === query.codigo && row.parcela === query.parcela && Math.abs(row.valorPagamento - query.recebido) < 0.001,
    );
    return { query, raw, treated };
  });

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
