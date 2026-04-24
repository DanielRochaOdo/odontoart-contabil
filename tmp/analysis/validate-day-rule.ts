import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { ContraprestacoesProcessor } from "../../src/features/contraprestacoes/services/ContraprestacoesProcessor";
import { parseCompetencia } from "../../src/features/eventos/services/utils";

function ymd(d: Date | null): string {
  if (!d) return "null";
  return d.toISOString().slice(0, 10);
}

async function main() {
  const buffer = await fs.readFile("C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx");
  const processor = new ContraprestacoesProcessor();
  const out = await processor.process({
    competencia: parseCompetencia("2026-03"),
    escrituracaoBuffer: buffer,
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.fileBuffer as unknown as ExcelJS.Buffer);
  const pf = wb.getWorksheet("Faturamento PF CLINICO")!;
  const pj = wb.getWorksheet("Faturamento PJ")!;

  console.log("PF samples (dia 2..29 preservado apos ajuste de mes)");
  for (const r of [3, 4, 5, 6, 7, 8]) {
    const d = pf.getCell(`E${r}`).value;
    console.log(`row ${r}:`, ymd(d instanceof Date ? d : null));
  }

  let pjMayMovedToApr30 = 0;
  for (let r = 3; r <= pj.rowCount; r += 1) {
    const d = pj.getCell(`E${r}`).value;
    if (!(d instanceof Date)) continue;
    if (d.getFullYear() === 2026 && d.getMonth() === 3 && d.getDate() === 30) {
      pjMayMovedToApr30 += 1;
    }
  }
  console.log("PJ com data 30/04/2026 (caso > mes+1):", pjMayMovedToApr30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
