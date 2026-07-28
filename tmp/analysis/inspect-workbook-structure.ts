import ExcelJS from "exceljs";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Uso: tsx inspect-workbook-structure.ts <xlsx>");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const output = workbook.worksheets.map((worksheet) => {
    const preview: string[][] = [];
    for (let rowNumber = 1; rowNumber <= Math.min(5, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      preview.push(
        Array.from({ length: Math.min(12, worksheet.columnCount || 12) }, (_, index) => {
          const value = row.getCell(index + 1).value;
          if (value === null || value === undefined) return "";
          if (typeof value === "object" && "result" in value) return String(value.result ?? "");
          return String(value);
        }),
      );
    }

    return {
      name: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      actualRowCount: worksheet.actualRowCount,
      actualColumnCount: worksheet.actualColumnCount,
      preview,
    };
  });

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
