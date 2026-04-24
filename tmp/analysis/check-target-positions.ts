import ExcelJS from "exceljs";
import path from "node:path";
const fileM=path.join(process.cwd(),'tmp','analysis','manual','EVENTOS CONHECIDOS - 2026-03.xlsx');
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(fileM);
const sheet=wb.getWorksheet('Eventos Conhecidos - PJ')!;
const targets=['47770','47773','47774','47814','47826','47832','47838','47864','47893','47984'];
for(let r=4;r<=sheet.rowCount;r++){
  const a=String(sheet.getCell('A'+r).value??'').toUpperCase(); if(a.includes('TOTAL')) break;
  const lote=String(sheet.getCell('E'+r).value??'').trim();
  if(targets.includes(lote)) console.log(lote,'row',r,'modelo',sheet.getCell('I'+r).value);
}
