import { NextResponse } from "next/server";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { ContraprestacoesProcessor } from "@/features/contraprestacoes/services/ContraprestacoesProcessor";
import { Competencia } from "@/features/eventos/domain/types";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { parseCompetencia } from "@/features/eventos/services/utils";

export const runtime = "nodejs";

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function toFriendlyMessage(error: unknown): string {
  if (error instanceof ContraprestacoesError) return error.userMessage;
  return "Nao foi possivel concluir a exportacao de contraprestacoes agora. Revise o arquivo e tente novamente.";
}

async function resolveCompetencia(
  competenciaRaw: FormDataEntryValue | null,
  fileBuffer: Buffer,
  fileName: string,
): Promise<Competencia> {
  if (typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)) {
    return parseCompetencia(competenciaRaw);
  }

  const detector = new CompetenciaDetector();
  const detectada = await detector.detect(fileBuffer, fileName);
  if (detectada) return detectada;

  return parseCompetencia(undefined);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const escrituracaoFile = formData.get("escrituracao");
    const competenciaRaw = formData.get("competencia");

    if (!(escrituracaoFile instanceof File)) {
      return NextResponse.json(
        { message: "Envie o arquivo de Escrituracao para gerar a Equacao." },
        { status: 400 },
      );
    }

    if (!isXlsx(escrituracaoFile)) {
      return NextResponse.json(
        { message: "Use arquivo no formato .xlsx para processamento de contraprestacoes." },
        { status: 400 },
      );
    }

    const escrituracaoBuffer = Buffer.from(await escrituracaoFile.arrayBuffer());
    const competencia = await resolveCompetencia(
      competenciaRaw,
      escrituracaoBuffer,
      escrituracaoFile.name,
    );

    const processor = new ContraprestacoesProcessor();
    const result = await processor.process({
      competencia,
      escrituracaoBuffer,
    });

    const summaryHeader = Buffer.from(JSON.stringify(result.summary), "utf8").toString("base64");

    return new NextResponse(new Uint8Array(result.fileBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "x-odonto-contrap-summary": summaryHeader,
      },
    });
  } catch (error) {
    const message = toFriendlyMessage(error);
    return NextResponse.json({ message }, { status: 500 });
  }
}
