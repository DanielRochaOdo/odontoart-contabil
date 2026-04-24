import ExcelJS from "exceljs";
import path from "node:path";

const root = process.cwd();
const manualDir = path.join(root, "tmp", "analysis", "manual");
const systemDir = path.join(root, "tmp", "analysis", "system", "extracted");

function normText(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function toNum(v: ExcelJS.CellValue | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) return null;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.result === "number") return obj.result;
  }
  return null;
}

function toDate(v: ExcelJS.CellValue | null | undefined): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (obj.result instanceof Date) return obj.result.toISOString().slice(0, 10);
    if (typeof obj.text === "string") return obj.text;
  }
  return String(v).trim();
}

function headerMap(sheet: ExcelJS.Worksheet): Map<string, string> {
  const map = new Map<string, string>();
  const row = sheet.getRow(3);
  for (let c = 1; c <= sheet.columnCount; c++) {
    const h = normText(row.getCell(c).value);
    if (h && !map.has(h)) map.set(h, sheet.getColumn(c).letter);
  }
  return map;
}

function totalRow(sheet: ExcelJS.Worksheet): number {
  for (let r = 4; r <= sheet.rowCount; r++) {
    if (normText(sheet.getCell(`A${r}`).value) === "TOTAL") return r;
  }
  return sheet.rowCount + 1;
}

function rowsByLote(sheet: ExcelJS.Worksheet, hm: Map<string, string>): Map<string, number> {
  const col = hm.get("LOTE");
  if (!col) return new Map();
  const end = totalRow(sheet) - 1;
  const map = new Map<string, number>();
  for (let r = 4; r <= end; r++) {
    const lote = String(sheet.getCell(`${col}${r}`).value ?? "").trim();
    if (/^\d+$/.test(lote)) map.set(lote, r);
  }
  return map;
}

function round2(n: number | null): string {
  if (n == null) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

async function compare(file: string) {
  const mwb = new ExcelJS.Workbook();
  const swb = new ExcelJS.Workbook();
  await mwb.xlsx.readFile(path.join(manualDir, file));
  await swb.xlsx.readFile(path.join(systemDir, file));
  console.log(`\n=== ${file} ===`);

  for (const ms of mwb.worksheets) {
    const ss = swb.getWorksheet(ms.name);
    if (!ss) {
      console.log(`[${ms.name}] aba ausente no sistema`);
      continue;
    }

    const mh = headerMap(ms);
    const sh = headerMap(ss);
    const mm = rowsByLote(ms, mh);
    const sm = rowsByLote(ss, sh);
    const onlyM = [...mm.keys()].filter((x) => !sm.has(x));
    const onlyS = [...sm.keys()].filter((x) => !mm.has(x));

    console.log(`[${ms.name}] manual=${mm.size} sistema=${sm.size} faltando=${onlyM.length} extras=${onlyS.length}`);
    if (onlyM.length) console.log(`  faltando: ${onlyM.slice(0, 10).join(", ")}`);
    if (onlyS.length) console.log(`  extras: ${onlyS.slice(0, 10).join(", ")}`);

    const fields = [
      "VL. BRUTO",
      "LIQUIDO",
      "VL PAGO",
      "INSS",
      "ISS",
      "IR",
      "PIS",
      "COFINS",
      "CSLL",
      "BANCO",
      "MODELO DE PAGAMENTO",
      "DT. PAGTO",
    ];

    const diffs: Record<string, number> = {};
    const samples: string[] = [];

    for (const lote of mm.keys()) {
      if (!sm.has(lote)) continue;
      const rm = mm.get(lote)!;
      const rs = sm.get(lote)!;

      for (const f of fields) {
        const cm = mh.get(f);
        const cs = sh.get(f);
        if (!cm || !cs) continue;

        let vm = "";
        let vs = "";

        if (f === "BANCO" || f === "MODELO DE PAGAMENTO") {
          vm = normText(ms.getCell(`${cm}${rm}`).value);
          vs = normText(ss.getCell(`${cs}${rs}`).value);
        } else if (f === "DT. PAGTO") {
          vm = toDate(ms.getCell(`${cm}${rm}`).value);
          vs = toDate(ss.getCell(`${cs}${rs}`).value);
        } else {
          vm = round2(toNum(ms.getCell(`${cm}${rm}`).value));
          vs = round2(toNum(ss.getCell(`${cs}${rs}`).value));
        }

        if (vm !== vs) {
          diffs[f] = (diffs[f] ?? 0) + 1;
          if (samples.length < 12) {
            samples.push(`lote ${lote} ${f}: manual='${vm}' sistema='${vs}'`);
          }
        }
      }
    }

    if (!Object.keys(diffs).length) {
      console.log("  Campos de negocio comparados: OK");
    } else {
      console.log("  Divergencias em campos de negocio:");
      for (const [k, v] of Object.entries(diffs).sort((a, b) => b[1] - a[1])) {
        console.log(`   - ${k}: ${v}`);
      }
      for (const s of samples) console.log(`   * ${s}`);
    }

    const firstManual = [...mm.keys()].slice(0, 6);
    const firstSystem = [...sm.keys()].slice(0, 6);
    const orderSame = firstManual.join(",") === firstSystem.join(",");
    console.log(`  Ordem inicial por lote igual: ${orderSame ? "sim" : "nao"}`);
  }
}

async function main() {
  for (const file of [
    "EVENTOS CONHECIDOS - 2026-03.xlsx",
    "EVENTOS CONHECIDOS - 2026-03 - Ortodontia.xlsx",
    "EVENTOS LIQUIDADOS - 2026-03.xlsx",
    "EVENTOS LIQUIDADOS - 2026-03 - Ortodontia.xlsx",
  ]) {
    await compare(file);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
