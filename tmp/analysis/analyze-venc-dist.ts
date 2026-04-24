import ExcelJS from "exceljs";

const inFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx";
const outFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx";

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    return toDate((v as { result?: unknown }).result);
  }
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function ymd(d: Date | null): string {
  if (!d) return "null";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function keyYm(d: Date | null): number {
  if (!d) return -1;
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

type In = { tipo: string; venc: Date | null };
type Out = { venc: Date | null };

async function main() {
  const inWb = new ExcelJS.Workbook();
  const outWb = new ExcelJS.Workbook();
  await inWb.xlsx.readFile(inFile);
  await outWb.xlsx.readFile(outFile);

  const inWs = inWb.worksheets[0];
  const outPfWs = outWb.getWorksheet("Faturamento PF CLINICO")!;
  const outPjWs = outWb.getWorksheet("Faturamento PJ")!;

  const inPf: In[] = [];
  const inPj: In[] = [];
  for (let r = 2; r <= inWs.rowCount; r++) {
    const tipo = String(inWs.getCell(`G${r}`).value ?? "").trim().toUpperCase();
    const code = String(inWs.getCell(`D${r}`).value ?? "").trim();
    if (!code) continue;
    const row: In = { tipo, venc: toDate(inWs.getCell(`F${r}`).value) };
    if (tipo === "COLETIVO EMPRESARIAL") inPj.push(row); else inPf.push(row);
  }

  const outPf: Out[] = [];
  for (let r = 3; r <= outPfWs.rowCount; r++) {
    const code = String(outPfWs.getCell(`B${r}`).value ?? "").trim();
    if (!code) continue;
    outPf.push({ venc: toDate(outPfWs.getCell(`E${r}`).value) });
  }

  const outPj: Out[] = [];
  for (let r = 3; r <= outPjWs.rowCount; r++) {
    const code = String(outPjWs.getCell(`B${r}`).value ?? "").trim();
    if (!code) continue;
    outPj.push({ venc: toDate(outPjWs.getCell(`E${r}`).value) });
  }

  const comp = 202603;
  const next = 202604;

  function detail(label: string, input: In[], output: Out[]) {
    const dist = {
      prev: new Map<string, number>(),
      curr: new Map<string, number>(),
      next: new Map<string, number>(),
      above: new Map<string, number>(),
    };

    for (let i = 0; i < Math.min(input.length, output.length); i++) {
      const ik = keyYm(input[i].venc);
      const out = ymd(output[i].venc);
      const bucket = ik < comp ? dist.prev : ik === comp ? dist.curr : ik === next ? dist.next : dist.above;
      bucket.set(out, (bucket.get(out) ?? 0) + 1);
    }

    const top = (m: Map<string, number>) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
    console.log(`\n${label}`);
    console.log('prev->', top(dist.prev));
    console.log('curr->', top(dist.curr));
    console.log('next->', top(dist.next));
    console.log('above->', top(dist.above));
  }

  detail('PF', inPf, outPf);
  detail('PJ', inPj, outPj);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
