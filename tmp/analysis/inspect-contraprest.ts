import ExcelJS from "exceljs";

const files: Array<[string, string]> = [
  ["entrada", "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx"],
  ["saida", "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx"],
];

function val(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.formula === "string") return `FORMULA:${obj.formula}`;
    if (obj.result !== undefined) return String(obj.result ?? "");
    if (typeof obj.text === "string") return String(obj.text);
  }
  return String(v);
}

async function run() {
  for (const [label, file] of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    console.log(`\n## ${label} ${file}`);
    console.log(`sheets: ${wb.worksheets.map((w) => w.name).join(" | ")}`);

    for (const ws of wb.worksheets) {
      console.log(`\n#sheet ${ws.name} rows=${ws.rowCount} cols=${ws.columnCount}`);
      for (let r = 1; r <= Math.min(20, ws.rowCount); r += 1) {
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= ws.columnCount; c += 1) {
          const v = val(row.getCell(c).value);
          if (v !== "") {
            cells.push(`${ws.getColumn(c).letter}${r}=${v}`);
          }
        }
        if (cells.length) console.log(cells.join(" || "));
      }
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
