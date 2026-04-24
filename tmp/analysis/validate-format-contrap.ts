import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { ContraprestacoesProcessor } from "../../src/features/contraprestacoes/services/ContraprestacoesProcessor";
import { parseCompetencia } from "../../src/features/eventos/services/utils";

async function run() {
  const p = new ContraprestacoesProcessor();
  const res = await p.process({
    competencia: parseCompetencia("2026-03"),
    escrituracaoBuffer: await fs.readFile("C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx"),
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.fileBuffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("Faturamento PF CLINICO")!;

  console.log("A3 fmt", ws.getCell("A3").numFmt);
  console.log("E3 fmt", ws.getCell("E3").numFmt);
  console.log("F3 fmt", ws.getCell("F3").numFmt);
  console.log("H3", ws.getCell("H3").value);
  console.log("I3 fmt", ws.getCell("I3").numFmt);
  console.log("K3 fmt", ws.getCell("K3").numFmt);
  console.log("L3 fmt", ws.getCell("L3").numFmt);
  console.log("J1 value", ws.getCell("J1").value);
  console.log("J1 align", ws.getCell("J1").alignment);
  console.log("J1:L1 merged", ws.getCell("J1").isMerged);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
