import { NextResponse } from "next/server";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { parseCompetencia } from "@/features/eventos/services/utils";
import { processAging } from "@/features/aging/services/AgingWorkbookProcessor";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const contabilidade = formData.get("contabilidade");
    const base = formData.get("base");
    if (!(contabilidade instanceof File) || !(base instanceof File)) {
      return NextResponse.json({ message: "Envie os dois arquivos Excel do Aging." }, { status: 400 });
    }
    if (!contabilidade.name.toLowerCase().endsWith(".xlsx") || !base.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ message: "Use arquivos no formato .xlsx." }, { status: 400 });
    }
    const competenciaRaw = formData.get("competencia");
    const baseBuffer = new Uint8Array(await base.arrayBuffer());
    const detected = new CompetenciaDetector();
    const competencia = typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)
      ? parseCompetencia(competenciaRaw)
      : await detected.detect(baseBuffer, base.name) ?? parseCompetencia(undefined);
    const result = await processAging({ contabilidadeBuffer: new Uint8Array(await contabilidade.arrayBuffer()), baseBuffer, competencia });
    return new NextResponse(result.fileBuffer as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${result.fileName}"`, "x-odonto-aging-summary": Buffer.from(JSON.stringify(result.summary)).toString("base64") } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Nao foi possivel processar o Aging." }, { status: 500 });
  }
}
