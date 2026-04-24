import { NextResponse } from "next/server";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";

export const runtime = "nodejs";

function competenciaToValue(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("arquivo");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Envie uma base em .xlsx para identificar a competência." },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json(
        { message: "Use arquivo .xlsx para identificar a competência." },
        { status: 400 },
      );
    }

    const detector = new CompetenciaDetector();
    const competencia = await detector.detect(
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );

    if (!competencia) {
      return NextResponse.json({
        competencia: null,
        message:
          "Não conseguimos identificar a competência automaticamente. Informe manualmente no campo Competência.",
      });
    }

    return NextResponse.json({
      competencia: competenciaToValue(competencia.ano, competencia.mes),
    });
  } catch {
    return NextResponse.json(
      {
        competencia: null,
        message:
          "Não foi possível identificar a competência agora. Informe manualmente no campo Competência.",
      },
      { status: 200 },
    );
  }
}

