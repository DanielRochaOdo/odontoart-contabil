import ExcelJS from "exceljs";

function columnLetter(columnNumber: number): string {
  let result = "";
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

async function main() {
  const filePath = process.argv[2];
  const rowArg = process.argv[3] ?? "2";
  if (!filePath) throw new Error("Uso: tsx inspect-header-row.ts <xlsx> [row]");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Aba nao encontrada");

  const rowNumber = Number(rowArg);
  const row = worksheet.getRow(rowNumber);
  const values = Array.from({ length: worksheet.actualColumnCount }, (_, index) => {
    const column = index + 1;
    return {
      column: columnLetter(column),
      value: String(row.getCell(column).value ?? ""),
    };
  });

  console.log(JSON.stringify(values, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
