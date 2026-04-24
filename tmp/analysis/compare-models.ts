import ExcelJS from "exceljs";
import path from "node:path";

const root=process.cwd();
const manual=path.join(root,'tmp','analysis','manual','EVENTOS CONHECIDOS - 2026-03.xlsx');
const system=path.join(root,'tmp','analysis','system','extracted','EVENTOS CONHECIDOS - 2026-03.xlsx');

function norm(v:any){ return String(v??'').trim(); }
async function load(p:string){const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(p); return wb;}

const mw=await load(manual); const sw=await load(system);
for(const name of ['Eventos Conhecidos - PF','Eventos Conhecidos - PJ']){
  const ms=mw.getWorksheet(name)!; const ss=sw.getWorksheet(name)!;
  const modelsM=new Set<string>(); const modelsS=new Set<string>();
  const end=(sheet:ExcelJS.Worksheet)=>{for(let r=4;r<=sheet.rowCount;r++){if(String(sheet.getCell('A'+r).value).toUpperCase().includes('TOTAL'))return r-1;} return sheet.rowCount;};
  for(let r=4;r<=end(ms);r++) modelsM.add(norm(ms.getCell('I'+r).value));
  for(let r=4;r<=end(ss);r++) modelsS.add(norm(ss.getCell('I'+r).value));
  const onlyM=[...modelsM].filter(x=>!modelsS.has(x));
  const onlyS=[...modelsS].filter(x=>!modelsM.has(x));
  console.log(name,'onlyM',onlyM,'onlyS',onlyS);
}
