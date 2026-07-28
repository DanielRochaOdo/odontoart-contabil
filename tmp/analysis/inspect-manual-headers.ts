import path from "node:path";
import ExcelJS from "exceljs";
import { coerceString } from "../../src/features/eventos/services/utils";

const BASE_DIR =
  "\\\\10.85.1.1\\dados$\\Odontoart\\ANS\\Contabilidade\\Planos\\Contraprestações\\Contraprestações Recebidas\\2026\\03.2026";

const FILES = [
  "Recebidos 03.2026 - Boleto Bancário.xlsx",
  "Recebidos 03.2026 - Cartão de Crédito.xlsx",
  "Recebidos 03.2026 - Cartão de Débito.xlsx",
  "Recebidos 03.2026 - Débito em Conta.xlsx",
  "Recebidos 03.2026 - Devolução de Mensalidade.xlsx",
  "Recebidos 03.2026 - Dinheiro - Caixinha.xlsx",
  "Recebidos 03.2026 - Agente Recebedor.xlsx",
  "Recebidos 03.2026 - Enel.xlsx",
  "Recebidos 03.2026 - PIX Recorrente - NOVO.xlsx",
] as const;

async function main() {
  const output: Record<string, unknown> = {};

  for (const file of FILES) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(BASE_DIR, file));

    output[file] = workbook.worksheets.map((sheet) => {
      const header = Array.from({ length: Math.max(sheet.actualColumnCount, sheet.columnCount) }, (_, index) =>
        coerceString(sheet.getRow(1).getCell(index + 1).value),
      );
      const firstData = Array.from({ length: Math.max(sheet.actualColumnCount, sheet.columnCount) }, (_, index) =>
        coerceString(sheet.getRow(2).getCell(index + 1).value),
      );
      return {
        sheet: sheet.name,
        header,
        firstData,
      };
    });
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
