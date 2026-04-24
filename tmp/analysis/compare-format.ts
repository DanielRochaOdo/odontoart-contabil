import ExcelJS from "exceljs";
import path from "node:path";

const root=process.cwd();
const manualDir=path.join(root,'tmp','analysis','manual');
const systemDir=path.join(root,'tmp','analysis','system','extracted');

function norm(v:unknown){ return String(v??'').trim().toUpperCase(); }

async function cmp(file:string){
  const m=new ExcelJS.Workbook(); const s=new ExcelJS.Workbook();
  await m.xlsx.readFile(path.join(manualDir,file));
  await s.xlsx.readFile(path.join(systemDir,file));
  console.log('\n=== '+file+' ===');
  for(const ms of m.worksheets){
    const ss=s.getWorksheet(ms.name); if(!ss){console.log('sem aba '+ms.name); continue;}
    const diffs:string[]=[];
    const max=Math.max(ms.columnCount, ss.columnCount);
    for(let c=1;c<=max;c++){
      const mc=ms.getColumn(c); const sc=ss.getColumn(c);
      const letter=mc.letter || sc.letter;
      if((mc.hidden??false)!==(sc.hidden??false)) diffs.push(`${letter} hidden m=${mc.hidden} s=${sc.hidden}`);
      if((mc.width??0)!==(sc.width??0)) diffs.push(`${letter} width m=${mc.width} s=${sc.width}`);
    }
    const rowCheck=[3,4];
    for(const r of rowCheck){
      for(let c=1;c<=max;c++){
        const letter=ms.getColumn(c).letter || ss.getColumn(c).letter;
        const mn=ms.getCell(`${letter}${r}`).numFmt||'';
        const sn=ss.getCell(`${letter}${r}`).numFmt||'';
        if(mn!==sn){
          const h=norm(ms.getCell(`${letter}3`).value) || letter;
          diffs.push(`numFmt ${letter}${r}(${h}) m='${mn}' s='${sn}'`);
        }
      }
    }
    console.log(`[${ms.name}] diffs=${diffs.length}`);
    for(const d of diffs.slice(0,12)) console.log(' - '+d);
  }
}

(async()=>{
  for(const f of [
    'EVENTOS CONHECIDOS - 2026-03.xlsx',
    'EVENTOS CONHECIDOS - 2026-03 - Ortodontia.xlsx',
    'EVENTOS LIQUIDADOS - 2026-03.xlsx',
    'EVENTOS LIQUIDADOS - 2026-03 - Ortodontia.xlsx',
  ]) await cmp(f);
})();
