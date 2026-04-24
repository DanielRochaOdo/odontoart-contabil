import { NextResponse } from "next/server";
import { EventosError } from "@/features/eventos/domain/errors";
import { Competencia } from "@/features/eventos/domain/types";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { EventosProcessor } from "@/features/eventos/services/EventosProcessor";
import { parseCompetencia } from "@/features/eventos/services/utils";

export const runtime = "nodejs";

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function toFriendlyMessage(error: unknown): string {
  if (error instanceof EventosError) return error.userMessage;
  return "Não foi possível concluir a exportação contábil agora. Revise os arquivos e tente novamente.";
}

async function resolveCompetencia(
  competenciaRaw: FormDataEntryValue | null,
  conhecidosFileBuffer: Buffer,
  conhecidosFileName: string,
): Promise<Competencia> {
  if (typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)) {
    return parseCompetencia(competenciaRaw);
  }

  const detector = new CompetenciaDetector();
  const detectada = await detector.detect(conhecidosFileBuffer, conhecidosFileName);
  if (detectada) return detectada;

  return parseCompetencia(undefined);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const conhecidosFile = formData.get("conhecidos");
    const liquidadosFile = formData.get("liquidados");
    const competenciaRaw = formData.get("competencia");

    if (!(conhecidosFile instanceof File) || !(liquidadosFile instanceof File)) {
      return NextResponse.json(
        { message: "Envie os dois arquivos: Eventos Conhecidos e Eventos Liquidados." },
        { status: 400 },
      );
    }

    if (!isXlsx(conhecidosFile) || !isXlsx(liquidadosFile)) {
      return NextResponse.json(
        { message: "Use arquivos no formato .xlsx para o processamento contábil." },
        { status: 400 },
      );
    }

    const conhecidosFileBuffer = Buffer.from(await conhecidosFile.arrayBuffer());
    const liquidadosFileBuffer = Buffer.from(await liquidadosFile.arrayBuffer());

    const competencia = await resolveCompetencia(
      competenciaRaw,
      conhecidosFileBuffer,
      conhecidosFile.name,
    );

    const processor = new EventosProcessor();
    const result = await processor.process({
      conhecidosFileBuffer,
      liquidadosFileBuffer,
      competencia,
    });

    const summaryHeader = Buffer.from(JSON.stringify(result.summary), "utf8").toString(
      "base64",
    );
    const zipName = `ARQUIVOS CONTABILIDADE - ${result.summary.competencia}.zip`;

    return new NextResponse(new Uint8Array(result.zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
        "x-odonto-summary": summaryHeader,
      },
    });
  } catch (error) {
    const message = toFriendlyMessage(error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
