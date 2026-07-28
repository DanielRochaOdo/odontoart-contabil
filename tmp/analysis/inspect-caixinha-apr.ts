import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { RecebidasWorkbookParser } from "../../src/features/contraprestacoes/services/RecebidasWorkbookParser";
import { applyRecebidasRules } from "../../src/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "../../src/features/contraprestacoes/services/canceladasParcelas";
import { coerceNumber, coerceString, normalizeText } from "../../src/features/eventos/services/utils";

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

  const baseFile =
    "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\04.2026\\BASE RECEBIDAS 04.2026 - Contabil-ART.xlsx";

  const parser = new RecebidasWorkbookParser();
  const parsed = await parser.parse(fs.readFileSync(baseFile));
  const canceladas = await fetchCanceladasParcelasFromSupabase();
  const processed = applyRecebidasRules(parsed, canceladas, { ano: 2026, mes: 4 });

  const rows = processed
    .filter(
      (row) =>
        row.grupo === "RECEBIDA" &&
        !row.devolucaoMensalidade &&
        row.pessoaTipo === "PF" &&
        normalizeText(row.tipoRecebimento) === "DINHEIRO",
    )
    .sort((left, right) => left.linhaOrigem - right.linhaOrigem);

  function totalOf(selectedRows: typeof rows) {
    return Number(selectedRows.reduce((sum, row) => sum + row.valorPagamento, 0).toFixed(2));
  }

  function takeRowsFromStartUntilTarget(inputRows: typeof rows, target: number) {
    const selected = [];
    let total = 0;
    for (const row of inputRows) {
      selected.push(row);
      total += row.valorPagamento;
      if (total >= target) break;
    }
    return selected;
  }

  function takeRowsFromEndUntilNearTarget(inputRows: typeof rows, target: number) {
    const reversed = [...inputRows].sort((left, right) => right.linhaOrigem - left.linhaOrigem);
    const selected = [];
    let total = 0;

    for (const row of reversed) {
      const nextTotal = total + row.valorPagamento;
      const currentDistance = Math.abs(target - total);
      const nextDistance = Math.abs(target - nextTotal);

      if (selected.length === 0 || nextDistance <= currentDistance || total < target) {
        selected.push(row);
        total = nextTotal;
        continue;
      }

      break;
    }

    return selected.sort((left, right) => left.linhaOrigem - right.linhaOrigem);
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

  const manualWorkbook = new ExcelJS.Workbook();
  await manualWorkbook.xlsx.readFile(
    "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\04.2026\\Recebidos 04.2026 - Dinheiro - Caixinha.xlsx",
  );
  const manualKeys = new Set<string>();
  for (const sheet of manualWorkbook.worksheets) {
    const headerRow = findHeaderRow(sheet);
    const codigoColumn = findColumn(sheet, headerRow, ["Código", "Codigo"]);
    const parcelaColumn = findColumn(sheet, headerRow, ["Nº Parc", "Nº Parcela", "Parcela", "N Parc", "N Parcela"]);
    const recebidoColumn = findColumn(sheet, headerRow, ["Recebido"]);
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const codigo = coerceString(row.getCell(codigoColumn).value);
      const parcela = coerceString(row.getCell(parcelaColumn).value);
      const recebido = coerceNumber(row.getCell(recebidoColumn).value);
      if (!codigo || !parcela) continue;
      manualKeys.add(rowKey(codigo, parcela, recebido));
    }
  }

  const strategies = {
    start: takeRowsFromStartUntilTarget(rows, 1000),
    end: takeRowsFromEndUntilNearTarget(rows, 1000),
  };

  const candidateExtraRows = processed.filter(
    (row) =>
      row.grupo === "RECEBIDA" &&
      !row.devolucaoMensalidade &&
      normalizeText(row.tipoRecebimento) === "PIX ODONTOART - P4X" &&
      normalizeText(row.tipoPagamento) === "BANCO DO BRASIL CLINICO" &&
      normalizeText(row.tipoParcela) === "PLANO",
  );

  const output = Object.fromEntries(
    Object.entries(strategies).map(([name, selected]) => {
      const selectedKeys = new Set(selected.map((row) => rowKey(row.codigo, row.parcela, row.valorPagamento)));
      const overlap = selected.filter((row) => manualKeys.has(rowKey(row.codigo, row.parcela, row.valorPagamento)));
      const manualOnly = rows.filter(
        (row) => manualKeys.has(rowKey(row.codigo, row.parcela, row.valorPagamento)) && !selectedKeys.has(rowKey(row.codigo, row.parcela, row.valorPagamento)),
      );
      return [
        name,
        {
          count: selected.length,
          total: totalOf(selected),
          overlapCount: overlap.length,
          overlapTotal: totalOf(overlap),
          rows: selected.map((row) => ({
            linha: row.linhaOrigem,
            codigo: row.codigo,
            parcela: row.parcela,
            valor: row.valorPagamento,
            inManual: manualKeys.has(rowKey(row.codigo, row.parcela, row.valorPagamento)),
          })),
          manualOnlyCount: manualOnly.length,
          manualOnlyRows: manualOnly.map((row) => ({
            linha: row.linhaOrigem,
            codigo: row.codigo,
            parcela: row.parcela,
            valor: row.valorPagamento,
            tipoPagamento: row.tipoPagamento,
            loteNf: row.loteNf,
          })),
        },
      ];
    }),
  );

  console.log(
    JSON.stringify(
      {
        strategies: output,
        candidateExtraRows: candidateExtraRows.map((row) => ({
          linha: row.linhaOrigem,
          codigo: row.codigo,
          parcela: row.parcela,
          valor: row.valorPagamento,
          pessoaTipo: row.pessoaTipo,
          observacoes: row.observacoes,
        })),
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
