import ExcelJS from "exceljs";
import path from "node:path";
async function lots(file:string,sheetName:string,col:string){
 const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const s=wb.getWorksheet(sheetName)!; const arr:string[]=[];
 for(let r=4;r<=s.rowCount;r++){ const a=String(s.getCell('A'+r).value??'').toUpperCase(); if(a.includes('TOTAL')) break; arr.push(String(s.getCell(col+r).value??'')); }
 return arr;
}
const root=process.cwd();
const manual=path.join(root,'tmp','analysis','manual','EVENTOS CONHECIDOS - 2026-03.xlsx');
const system=path.join(root,'tmp','analysis','system','extracted','EVENTOS CONHECIDOS - 2026-03.xlsx');
const m=await lots(manual,'Eventos Conhecidos - PJ','E');
const s=await lots(system,'Eventos Conhecidos - PJ','E');
console.log('manual first 20',m.slice(0,20).join(','));
console.log('system first 20',s.slice(0,20).join(','));
