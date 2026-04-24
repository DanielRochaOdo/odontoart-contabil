import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { EscrituracaoParser } from "../../src/features/contraprestacoes/services/EscrituracaoParser";
import { ContraprestacoesProcessor } from "../../src/features/contraprestacoes/services/ContraprestacoesProcessor";
import { parseCompetencia } from "../../src/features/eventos/services/utils";

function keyYm(d: Date): number {
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function ymd(d: Date | null): string {
  if (!d) return "null";
  return d.toISOString().slice(0, 10);
}

async function main() {
  const competencia = parseCompetencia("2026-03");
  const ymCurrent = competencia.ano * 100 + competencia.mes;
  const next = new Date(competencia.ano, competencia.mes, 1);
  const ymNext = next.getFullYear() * 100 + (next.getMonth() + 1);

  const file = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx";
  const buffer = await fs.readFile(file);

  const parser = new EscrituracaoParser();
  const allRows = await parser.parse(buffer);
  const pfRows = allRows.filter((r) => r.tipo.trim().toUpperCase() !== "COLETIVO EMPRESARIAL");
  const pjRows = allRows.filter((r) => r.tipo.trim().toUpperCase() === "COLETIVO EMPRESARIAL");

  const processor = new ContraprestacoesProcessor();
  const result = await processor.process({ competencia, escrituracaoBuffer: buffer });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.fileBuffer as unknown as ExcelJS.Buffer);
  const pfSheet = wb.getWorksheet("Faturamento PF CLINICO")!;
  const pjSheet = wb.getWorksheet("Faturamento PJ")!;

  let pfBefore = 0;
  let pfAfter = 0;
  let pfSamples = 0;

  pfRows.forEach((item, idx) => {
    const inDate = item.vencimento;
    if (!inDate) return;
    if (keyYm(inDate) !== ymCurrent) pfBefore += 1;
    const outCell = pfSheet.getCell(`E${idx + 3}`).value;
    const outDate = outCell instanceof Date ? outCell : null;
    if (outDate && keyYm(outDate) !== ymCurrent) pfAfter += 1;
    if (outDate && inDate && keyYm(inDate) !== ymCurrent && pfSamples < 5) {
      console.log("PF ajuste", ymd(inDate), "=>", ymd(outDate));
      pfSamples += 1;
    }
  });

  let pjBeyondNext = 0;
  let pjStillBeyondNext = 0;
  let pjSamples = 0;

  pjRows.forEach((item, idx) => {
    const inDate = item.vencimento;
    if (!inDate) return;
    const inYm = keyYm(inDate);
    const outCell = pjSheet.getCell(`E${idx + 3}`).value;
    const outDate = outCell instanceof Date ? outCell : null;
    const outYm = outDate ? keyYm(outDate) : -1;

    if (inYm > ymNext) {
      pjBeyondNext += 1;
      if (outYm > ymNext) pjStillBeyondNext += 1;
      if (outDate && pjSamples < 5) {
        console.log("PJ ajuste", ymd(inDate), "=>", ymd(outDate));
        pjSamples += 1;
      }
    }
  });

  console.log({ pfBefore, pfAfter, pjBeyondNext, pjStillBeyondNext });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
