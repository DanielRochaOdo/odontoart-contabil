import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { ContraprestacoesProcessor } from "../../src/features/contraprestacoes/services/ContraprestacoesProcessor";
import { parseCompetencia } from "../../src/features/eventos/services/utils";

const inFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx";
const manualOut = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx";

function norm(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "result" in v) {
    return num((v as { result?: unknown }).result);
  }
  const parsed = Number(String(v).replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countRows(ws: ExcelJS.Worksheet, startRow: number, keyCol: string): Promise<number> {
  let count = 0;
  for (let r = startRow; r <= ws.rowCount; r += 1) {
    if (norm(ws.getCell(`${keyCol}${r}`).value)) count += 1;
  }
  return count;
}

async function main() {
  const processor = new ContraprestacoesProcessor();
  const result = await processor.process({
    competencia: parseCompetencia("2026-03"),
    escrituracaoBuffer: await fs.readFile(inFile),
  });

  const outPath = path.join(process.cwd(), "tmp", "analysis", "contraprestacoes-equacao-system.xlsx");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, result.fileBuffer);

  const swb = new ExcelJS.Workbook();
  const mwb = new ExcelJS.Workbook();
  await swb.xlsx.readFile(outPath);
  await mwb.xlsx.readFile(manualOut);

  console.log("summary", result.summary);

  for (const sheetName of ["Faturamento PF CLINICO", "Faturamento PJ"]) {
    const ss = swb.getWorksheet(sheetName)!;
    const ms = mwb.getWorksheet(sheetName)!;

    const sRows = await countRows(ss, 3, "B");
    const mRows = await countRows(ms, 3, "B");

    let sTotal = 0;
    let mTotal = 0;

    const sEnd = ss.rowCount;
    const mEnd = ms.rowCount;

    const valueCol = sheetName === "Faturamento PF CLINICO" ? "F" : "G";

    for (let r = 3; r <= sEnd; r += 1) {
      if (!norm(ss.getCell(`B${r}`).value)) continue;
      sTotal += num(ss.getCell(`${valueCol}${r}`).value);
    }
    for (let r = 3; r <= mEnd; r += 1) {
      if (!norm(ms.getCell(`B${r}`).value)) continue;
      mTotal += num(ms.getCell(`${valueCol}${r}`).value);
    }

    console.log(sheetName, { sRows, mRows, sTotal: sTotal.toFixed(2), mTotal: mTotal.toFixed(2) });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
