import ExcelJS from "exceljs";

const inFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx";
const outFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx";

type InRow = {
  tipo: string;
  venc: Date | null;
  codigo: string;
  nome: string;
  nf: string;
  mensalidade: string;
};

type OutRow = {
  venc: Date | null;
  codigo: string;
  nome: string;
  nf: string;
  mensalidade: string;
};

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

function monthKey(d: Date | null): number {
  if (!d) return -1;
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

async function main() {
  const inWb = new ExcelJS.Workbook();
  const outWb = new ExcelJS.Workbook();
  await inWb.xlsx.readFile(inFile);
  await outWb.xlsx.readFile(outFile);

  const inWs = inWb.worksheets[0];
  const outPf = outWb.getWorksheet("Faturamento PF CLINICO")!;
  const outPj = outWb.getWorksheet("Faturamento PJ")!;

  const inPf: InRow[] = [];
  const inPj: InRow[] = [];

  for (let r = 2; r <= inWs.rowCount; r += 1) {
    const tipo = String(inWs.getCell(`G${r}`).value ?? "").trim().toUpperCase();
    const row: InRow = {
      tipo,
      venc: toDate(inWs.getCell(`F${r}`).value),
      codigo: String(inWs.getCell(`D${r}`).value ?? "").trim(),
      nome: String(inWs.getCell(`E${r}`).value ?? "").trim(),
      nf: String(inWs.getCell(`C${r}`).value ?? "").trim(),
      mensalidade: String(inWs.getCell(`A${r}`).value ?? "").trim(),
    };
    if (!row.codigo && !row.nf) continue;
    if (tipo === "COLETIVO EMPRESARIAL") inPj.push(row);
    else inPf.push(row);
  }

  const pfOut: OutRow[] = [];
  for (let r = 3; r <= outPf.rowCount; r += 1) {
    const codigo = String(outPf.getCell(`B${r}`).value ?? "").trim();
    if (!codigo) continue;
    pfOut.push({
      venc: toDate(outPf.getCell(`E${r}`).value),
      codigo,
      nome: String(outPf.getCell(`C${r}`).value ?? "").trim(),
      nf: String(outPf.getCell(`D${r}`).value ?? "").trim(),
      mensalidade: String(outPf.getCell(`G${r}`).value ?? "").trim(),
    });
  }

  const pjOut: OutRow[] = [];
  for (let r = 3; r <= outPj.rowCount; r += 1) {
    const codigo = String(outPj.getCell(`B${r}`).value ?? "").trim();
    if (!codigo) continue;
    pjOut.push({
      venc: toDate(outPj.getCell(`E${r}`).value),
      codigo,
      nome: String(outPj.getCell(`C${r}`).value ?? "").trim(),
      nf: String(outPj.getCell(`D${r}`).value ?? "").trim(),
      mensalidade: String(outPj.getCell(`F${r}`).value ?? "").trim(),
    });
  }

  console.log("Counts", { inPf: inPf.length, outPf: pfOut.length, inPj: inPj.length, outPj: pjOut.length });

  const compKey = 202603;
  const compNextKey = 202604;

  function analyze(label: string, input: InRow[], output: OutRow[]) {
    const size = Math.min(input.length, output.length);
    const stats = {
      prev_to_01: 0,
      prev_to_other: 0,
      curr_keep: 0,
      curr_changed: 0,
      next_keep: 0,
      next_changed: 0,
      above_next_to_30next: 0,
      above_next_other: 0,
    };
    const samples: string[] = [];

    for (let i = 0; i < size; i += 1) {
      const inR = input[i];
      const outR = output[i];
      const inKey = monthKey(inR.venc);
      const outKey = monthKey(outR.venc);
      const inDay = inR.venc?.getDate() ?? -1;
      const outDay = outR.venc?.getDate() ?? -1;

      if (inKey < compKey) {
        if (outKey === compKey && outDay === 1) stats.prev_to_01 += 1;
        else {
          stats.prev_to_other += 1;
          if (samples.length < 8) samples.push(`prev ${ymd(inR.venc)} -> ${ymd(outR.venc)}`);
        }
      } else if (inKey === compKey) {
        if (inDay === outDay) stats.curr_keep += 1;
        else {
          stats.curr_changed += 1;
          if (samples.length < 8) samples.push(`curr ${ymd(inR.venc)} -> ${ymd(outR.venc)}`);
        }
      } else if (inKey === compNextKey) {
        if (inDay === outDay && outKey === compNextKey) stats.next_keep += 1;
        else {
          stats.next_changed += 1;
          if (samples.length < 8) samples.push(`next ${ymd(inR.venc)} -> ${ymd(outR.venc)}`);
        }
      } else if (inKey > compNextKey) {
        if (outKey === compNextKey && outDay === 30) stats.above_next_to_30next += 1;
        else {
          stats.above_next_other += 1;
          if (samples.length < 8) samples.push(`>next ${ymd(inR.venc)} -> ${ymd(outR.venc)}`);
        }
      }
    }

    console.log(`\n${label}`, stats);
    if (samples.length) console.log("samples", samples);
  }

  analyze("PF", inPf, pfOut);
  analyze("PJ", inPj, pjOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
