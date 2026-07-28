import fs from "node:fs";
import path from "node:path";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { coerceString, normalizeText } from "../../src/features/eventos/services/utils";

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

async function main() {
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(BASE_FILE));
  const cutoff = new Date(2026, 3, 0).getTime();

  const dropped = parsed.filter((row) => row.dtEmissao && row.dtEmissao.getTime() > cutoff);
  const byType = dropped.reduce<Record<string, { count: number; total: number }>>((acc, row) => {
    const key = `${normalizeText(row.tipoRecebimento)} | ${normalizeText(row.tipoPagamento)}`;
    const bucket = acc[key] ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total = Number((bucket.total + row.valorPagamento).toFixed(2));
    acc[key] = bucket;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        count: dropped.length,
        total: Number(dropped.reduce((sum, row) => sum + row.valorPagamento, 0).toFixed(2)),
        first: dropped.slice(0, 20).map((row) => ({
          linhaOrigem: row.linhaOrigem,
          codigo: row.codigo,
          parcela: row.parcela,
          valorPagamento: row.valorPagamento,
          tipoRecebimento: row.tipoRecebimento,
          tipoPagamento: row.tipoPagamento,
          dtEmissao: row.dtEmissao?.toISOString().slice(0, 10),
        })),
        byType,
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
