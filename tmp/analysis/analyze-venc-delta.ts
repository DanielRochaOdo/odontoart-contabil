import ExcelJS from "exceljs";

const inFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx";
const outFile = "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Equação.xlsx";

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (typeof v === "object" && v !== null && "result" in v) return toDate((v as any).result);
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function ym(d: Date | null): number { return d ? d.getFullYear()*100 + (d.getMonth()+1) : -1; }

async function main(){
  const inWb=new ExcelJS.Workbook(); const outWb=new ExcelJS.Workbook();
  await inWb.xlsx.readFile(inFile); await outWb.xlsx.readFile(outFile);
  const inWs=inWb.worksheets[0];
  const outPf=outWb.getWorksheet('Faturamento PF CLINICO')!;
  const outPj=outWb.getWorksheet('Faturamento PJ')!;
  const inPf:Date[]=[]; const inPj:Date[]=[];
  for(let r=2;r<=inWs.rowCount;r++){
    const code=String(inWs.getCell(`D${r}`).value??'').trim(); if(!code) continue;
    const tipo=String(inWs.getCell(`G${r}`).value??'').trim().toUpperCase();
    const d=toDate(inWs.getCell(`F${r}`).value); if(!d) continue;
    if(tipo==='COLETIVO EMPRESARIAL') inPj.push(d); else inPf.push(d);
  }
  const outPfDates:Date[]=[]; for(let r=3;r<=outPf.rowCount;r++){ const code=String(outPf.getCell(`B${r}`).value??'').trim(); if(!code) continue; const d=toDate(outPf.getCell(`E${r}`).value); if(d) outPfDates.push(d); }
  const outPjDates:Date[]=[]; for(let r=3;r<=outPj.rowCount;r++){ const code=String(outPj.getCell(`B${r}`).value??'').trim(); if(!code) continue; const d=toDate(outPj.getCell(`E${r}`).value); if(d) outPjDates.push(d); }

  function analyze(label:string,ins:Date[],outs:Date[]){
    const comp=202603, next=202604;
    const deltaCount=new Map<string,number>();
    let shown=0;
    for(let i=0;i<Math.min(ins.length,outs.length);i++){
      const a=ins[i], b=outs[i];
      const bucket = ym(a)<comp?'prev':ym(a)===comp?'curr':ym(a)===next?'next':'above';
      const key=`${bucket}:${a.getDate()}->${b.getDate()} @ ${ym(a)}=>${ym(b)}`;
      deltaCount.set(key,(deltaCount.get(key)||0)+1);
      if(shown<20 && (bucket==='next' || bucket==='above' || bucket==='prev')){ console.log(label,key); shown++; }
    }
    console.log('\n'+label+' top deltas');
    console.log([...deltaCount.entries()].sort((x,y)=>y[1]-x[1]).slice(0,20));
  }

  analyze('PF',inPf,outPfDates);
  analyze('PJ',inPj,outPjDates);
}

main().catch(e=>{console.error(e); process.exit(1);});
