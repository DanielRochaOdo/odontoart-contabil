import ExcelJS from "exceljs";

const out = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx";

function excelDateToDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + v * 86400000);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function show(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.formula === "string") return `FORMULA:${obj.formula}`;
    if (obj.result !== undefined) return String(obj.result ?? "");
  }
  return String(v);
}

async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Faturamento PJ")!;

  let aprCount = 0;
  let marCount = 0;
  for (let r = 3; r <= ws.rowCount; r += 1) {
    const code = String(ws.getCell(`B${r}`).value ?? "").trim();
    if (!code) continue;
    const d = excelDateToDate(ws.getCell(`E${r}`).value);
    if (!d) continue;
    const m = d.getMonth() + 1;
    if (m === 4) aprCount += 1;
    if (m === 3) marCount += 1;
  }
  console.log({ marCount, aprCount });

  let shown = 0;
  for (let r = 3; r <= ws.rowCount && shown < 25; r += 1) {
    const code = String(ws.getCell(`B${r}`).value ?? "").trim();
    if (!code) continue;
    const d = excelDateToDate(ws.getCell(`E${r}`).value);
    if (!d || d.getMonth() + 1 !== 4) continue;

    console.log(
      `r${r} E=${d.toISOString().slice(0, 10)} I=${show(ws.getCell(`I${r}`).value)} L=${show(ws.getCell(`L${r}`).value)} M=${show(ws.getCell(`M${r}`).value)} N=${show(ws.getCell(`N${r}`).value)}`,
    );
    shown += 1;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
