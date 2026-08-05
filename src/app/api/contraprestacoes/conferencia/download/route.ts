import { NextResponse } from "next/server";
import { ContraprestacoesConferenciaService } from "@/features/contraprestacoes/services/ContraprestacoesConferenciaService";

export const runtime = "nodejs";

function isValidCompetencia(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const competencia = url.searchParams.get("competencia");

  if (!isValidCompetencia(competencia)) {
    return NextResponse.json(
      { message: "Informe a competencia no formato AAAA-MM para baixar a conferencia consolidada." },
      { status: 400 },
    );
  }

  try {
    const service = new ContraprestacoesConferenciaService();
    const result = await service.buildConsolidatedArchive(competencia);

    return new NextResponse(new Uint8Array(result.fileBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel consolidar os arquivos salvos desta competencia.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
