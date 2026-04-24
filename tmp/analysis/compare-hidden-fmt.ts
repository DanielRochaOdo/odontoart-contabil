import ExcelJS from "exceljs";
import path from "node:path";
const root=process.cwd();
const manualDir=path.join(root,'tmp','analysis','manual');
const systemDir=path.join(root,'tmp','analysis','system','extracted');

async function run(file:string){
  const m=new ExcelJS.Workbook(); const s=new ExcelJS.Workbook();
  await m.xlsx.readFile(path.join(manualDir,file));
  await s.xlsx.readFile(path.join(systemDir,file));
  console.log('\n=== '+file+' ===');
  for(const ms of m.worksheets){
    const ss=s.getWorksheet(ms.name); if(!ss) continue;
    const max=Math.max(ms.columnCount, ss.columnCount);
    const hiddenDiffs:string[]=[];
    const fmtDiffs:string[]=[];
    for(let c=1;c<=max;c++){
      const l=(ms.getColumn(c).letter || ss.getColumn(c).letter);
      if((ms.getColumn(c).hidden??false)!==(ss.getColumn(c).hidden??false)) hiddenDiffs.push(`${l} m=${ms.getColumn(c).hidden} s=${ss.getColumn(c).hidden}`);
    }
    const checkRows=[4,5];
    for(const r of checkRows){
      for(let c=1;c<=max;c++){
        const l=(ms.getColumn(c).letter || ss.getColumn(c).letter);
        const mf=ms.getCell(`${l}${r}`).numFmt||'';
        const sf=ss.getCell(`${l}${r}`).numFmt||'';
        if(mf!==sf) fmtDiffs.push(`${l}${r} m='${mf}' s='${sf}'`);
      }
    }
    console.log(`[${ms.name}] hiddenDiffs=${hiddenDiffs.length} numFmtDiffs=${fmtDiffs.length}`);
    if(hiddenDiffs.length) console.log(' hidden ex: '+hiddenDiffs.slice(0,8).join(' | '));
    if(fmtDiffs.length) console.log(' fmt ex: '+fmtDiffs.slice(0,8).join(' | '));
  }
}

(async()=>{
  for(const file of [
    'EVENTOS CONHECIDOS - 2026-03.xlsx',
    'EVENTOS CONHECIDOS - 2026-03 - Ortodontia.xlsx',
    'EVENTOS LIQUIDADOS - 2026-03.xlsx',
    'EVENTOS LIQUIDADOS - 2026-03 - Ortodontia.xlsx',
  ]) await run(file);
})();
