import ExcelJS from "exceljs";
import path from "node:path";

const root = process.cwd();
const manualDir = path.join(root, "tmp", "analysis", "manual");
const systemDir = path.join(root, "tmp", "analysis", "system", "extracted");

function normText(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function cellValueForCompare(value: ExcelJS.CellValue | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.formula === "string") return `FORMULA:${obj.formula}`;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.result === "number") return Number(obj.result).toFixed(2);
    if (obj.richText) return JSON.stringify(obj.richText);
  }
  return String(value);
}

function getHeaderMap(sheet: ExcelJS.Worksheet, rowNumber = 3): Map<string, string> {
  const row = sheet.getRow(rowNumber);
  const map = new Map<string, string>();
  for (let c = 1; c <= sheet.columnCount; c += 1) {
    const col = sheet.getColumn(c).letter;
    const header = normText(row.getCell(c).value);
    if (!header) continue;
    if (!map.has(header)) map.set(header, col);
  }
  return map;
}

function findTotalRow(sheet: ExcelJS.Worksheet): number | null {
  for (let r = 4; r <= sheet.rowCount; r += 1) {
    const a = normText(sheet.getCell(`A${r}`).value);
    if (a === "TOTAL") return r;
  }
  return null;
}

function getLoteMap(sheet: ExcelJS.Worksheet, loteCol: string, totalRow: number | null): Map<string, number> {
  const map = new Map<string, number>();
  const end = totalRow ? totalRow - 1 : sheet.rowCount;
  for (let r = 4; r <= end; r += 1) {
    const loteRaw = sheet.getCell(`${loteCol}${r}`).value;
    const lote = String(loteRaw ?? "").trim();
    if (!/^\d+$/.test(lote)) continue;
    map.set(lote, r);
  }
  return map;
}

async function compareWorkbook(fileName: string) {
  const manualPath = path.join(manualDir, fileName);
  const systemPath = path.join(systemDir, fileName);

  const manual = new ExcelJS.Workbook();
  const system = new ExcelJS.Workbook();
  await manual.xlsx.readFile(manualPath);
  await system.xlsx.readFile(systemPath);

  console.log(`\n=== ${fileName} ===`);
  const manualSheets = manual.worksheets.map((w) => w.name);
  const systemSheets = system.worksheets.map((w) => w.name);
  console.log(`Sheets manual: ${manualSheets.join(" | ")}`);
  console.log(`Sheets system: ${systemSheets.join(" | ")}`);

  for (const sheetName of manualSheets) {
    const m = manual.getWorksheet(sheetName);
    const s = system.getWorksheet(sheetName);
    if (!m || !s) {
      console.log(`- Aba ${sheetName}: ausente no sistema`);
      continue;
    }

    const mh = getHeaderMap(m);
    const sh = getHeaderMap(s);
    const loteColM = mh.get("LOTE");
    const loteColS = sh.get("LOTE");

    const totalM = findTotalRow(m);
    const totalS = findTotalRow(s);

    console.log(`\n[${sheetName}] totalRow manual=${totalM ?? "-"} system=${totalS ?? "-"}`);

    if (!loteColM || !loteColS) {
      console.log("  Sem coluna LOTE identificada em um dos arquivos.");
      continue;
    }

    const lotesM = getLoteMap(m, loteColM, totalM);
    const lotesS = getLoteMap(s, loteColS, totalS);
    const onlyM = [...lotesM.keys()].filter((x) => !lotesS.has(x));
    const onlyS = [...lotesS.keys()].filter((x) => !lotesM.has(x));

    console.log(`  Lotes manual=${lotesM.size} | sistema=${lotesS.size} | faltando no sistema=${onlyM.length} | extras no sistema=${onlyS.length}`);
    if (onlyM.length) console.log(`  Exemplo faltando no sistema: ${onlyM.slice(0, 12).join(", ")}`);
    if (onlyS.length) console.log(`  Exemplo extra no sistema: ${onlyS.slice(0, 12).join(", ")}`);

    const compareHeaders = ["VL. BRUTO", "TOTAL PAGO", "VL PAGO", "DT. PAGTO", "BANCO", "MODELO DE PAGAMENTO", "LIQUIDO", "LIQUIDO AGING", "5952"];
    const mismatchByField: Record<string, number> = {};
    const samples: string[] = [];
    for (const lote of lotesM.keys()) {
      if (!lotesS.has(lote)) continue;
      const rm = lotesM.get(lote)!;
      const rs = lotesS.get(lote)!;
      for (const h of compareHeaders) {
        const cm = mh.get(h);
        const cs = sh.get(h);
        if (!cm || !cs) continue;
        const vm = cellValueForCompare(m.getCell(`${cm}${rm}`).value);
        const vs = cellValueForCompare(s.getCell(`${cs}${rs}`).value);
        if (vm !== vs) {
          mismatchByField[h] = (mismatchByField[h] ?? 0) + 1;
          if (samples.length < 12) {
            samples.push(`lote ${lote} campo ${h}: manual='${vm}' sistema='${vs}'`);
          }
        }
      }
    }

    const fields = Object.entries(mismatchByField).sort((a, b) => b[1] - a[1]);
    if (fields.length === 0) {
      console.log("  Valores principais: OK (sem divergencia nas colunas-chave). ");
    } else {
      console.log("  Divergencias por campo:");
      for (const [f, n] of fields) {
        console.log(`   - ${f}: ${n}`);
      }
      for (const sample of samples) {
        console.log(`   * ${sample}`);
      }
    }

    if (totalM && totalS) {
      const totalCols = ["J","K","L","M","N","O","P","Q","R","S","U","Q","R","S","T","U","V","W","X","I","AA","AB","AC","Y","Z"];
      const uniqCols = [...new Set(totalCols)];
      const totalDiffs: string[] = [];
      for (const col of uniqCols) {
        const mv = cellValueForCompare(m.getCell(`${col}${totalM}`).value);
        const sv = cellValueForCompare(s.getCell(`${col}${totalS}`).value);
        if (!mv && !sv) continue;
        if (mv !== sv) totalDiffs.push(`${col}: manual='${mv}' sistema='${sv}'`);
      }
      if (totalDiffs.length) {
        console.log(`  TOTAL divergente em ${totalDiffs.length} colunas (amostra):`);
        for (const line of totalDiffs.slice(0, 10)) console.log(`   * ${line}`);
      }
    }
  }
}

async function main() {
  const files = [
    "EVENTOS CONHECIDOS - 2026-03.xlsx",
    "EVENTOS CONHECIDOS - 2026-03 - Ortodontia.xlsx",
    "EVENTOS LIQUIDADOS - 2026-03.xlsx",
    "EVENTOS LIQUIDADOS - 2026-03 - Ortodontia.xlsx",
  ];

  for (const file of files) {
    await compareWorkbook(file);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
