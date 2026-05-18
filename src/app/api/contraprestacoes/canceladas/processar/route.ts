import JSZip from "jszip";
import { NextResponse } from "next/server";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { CanceladasWorkbookProcessor } from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";
import { parseCompetencia } from "@/features/eventos/services/utils";

export const runtime = "nodejs";

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function toFriendlyMessage(error: unknown): string {
  if (error instanceof ContraprestacoesError) return error.userMessage;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("invalid api key")) {
      return "Chave do Supabase invalida para o modulo Canceladas. Configure uma SERVICE_ROLE_KEY valida.";
    }
    if (message.includes("relation") && message.includes("contraprestacoes_canceladas_registros")) {
      return "Tabela de Canceladas nao encontrada. Rode as migrations do Supabase.";
    }
  }
  return "Nao foi possivel concluir o processamento mensal de Canceladas agora.";
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return NextResponse.json({
        message:
          "O processamento mensal de Canceladas nao alimenta mais a base historica. Use apenas a importacao de base historica nesse modulo.",
      }, { status: 410 });
    }

    const formData = await request.formData();
    const file = formData.get("arquivo");
    const competenciaRaw = formData.get("competencia");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "Envie a base mensal de Canceladas (.xlsx)." },
        { status: 400 },
      );
    }

    if (!isXlsx(file)) {
      return NextResponse.json(
        { message: "Use arquivo no formato .xlsx para o processamento de Canceladas." },
        { status: 400 },
      );
    }

    const processor = new CanceladasWorkbookProcessor();
    const fileBuffer = new Uint8Array(await file.arrayBuffer());
    const competencia = parseCompetencia(
      typeof competenciaRaw === "string" ? competenciaRaw : undefined,
    );
    const result = await processor.process(fileBuffer, competencia);

    const zip = new JSZip();
    result.generatedFiles.forEach((fileItem) => {
      zip.file(fileItem.fileName, fileItem.buffer);
    });

    const zipBuffer = await zip.generateAsync({ type: "uint8array" });
    const responseBody = Uint8Array.from(zipBuffer);
    const summaryHeader = Buffer.from(
      JSON.stringify({
        competencia: result.competencia,
        registrosEntrada: result.registrosEntrada,
        registrosTratados: result.registrosTratados,
        registrosPf: result.registrosPf,
        registrosPj: result.registrosPj,
        registrosImportados: 0,
        arquivosGerados: result.generatedFiles.length,
      }),
      "utf8",
    ).toString("base64");

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="Canceladas ${String(competencia.mes).padStart(2, "0")}.${competencia.ano}.zip"`,
        "x-odonto-canceladas-summary": summaryHeader,
      },
    });
  } catch (error) {
    return NextResponse.json({ message: toFriendlyMessage(error) }, { status: 500 });
  }
}
