import JSZip from "jszip";
import { NextResponse } from "next/server";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import {
  CanceladasWorkbookProcessor,
  ImportedCanceladaRow,
} from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";
import { parseCompetencia } from "@/features/eventos/services/utils";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

async function replaceRows(
  rowsToImport: ImportedCanceladaRow[],
  competencia: string,
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        message:
          "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para processar Canceladas.",
      },
      { status: 500 },
    );
  }

  const { error: deleteError } = await supabase
    .from("contraprestacoes_canceladas_registros")
    .delete()
    .eq("competencia", competencia)
    .eq("origem", "PROCESSAMENTO_MENSAL");

  if (deleteError) {
    throw deleteError;
  }

  const chunkSize = 1000;
  for (let start = 0; start < rowsToImport.length; start += chunkSize) {
    const chunk = rowsToImport.slice(start, start + chunkSize);
    if (chunk.length === 0) continue;

    const { error: insertError } = await supabase
      .from("contraprestacoes_canceladas_registros")
      .insert(chunk);

    if (insertError) {
      throw insertError;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await request.json()) as {
        competencia?: string;
        rowsToImport?: ImportedCanceladaRow[];
      };

      const competencia = typeof payload.competencia === "string" ? payload.competencia : "";
      const rowsToImport = Array.isArray(payload.rowsToImport) ? payload.rowsToImport : [];

      if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return NextResponse.json(
          { message: "Competencia invalida para persistir Canceladas." },
          { status: 400 },
        );
      }

      const persistError = await replaceRows(rowsToImport, competencia);
      if (persistError) return persistError;

      return NextResponse.json({
        competencia,
        registrosImportados: rowsToImport.length,
      });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        {
          message:
            "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para processar Canceladas.",
        },
        { status: 500 },
      );
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
    const persistError = await replaceRows(result.rowsToImport, result.competencia);
    if (persistError) return persistError;

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
        registrosImportados: result.rowsToImport.length,
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
