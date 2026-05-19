import JSZip from "jszip";
import { NextResponse } from "next/server";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { CanceladasWorkbookProcessor } from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { competenciaToString, parseCompetencia } from "@/features/eventos/services/utils";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

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

interface PersistCanceladasPayload {
  competencia?: string;
  rowsToImport?: Array<{
    competencia?: string;
    ano?: number;
    mes?: number;
    cpt?: string;
    codigo?: string;
    nome?: string;
    emissao?: string | null;
    vencimento?: string | null;
    valor_emitido?: number;
    numero_parc?: string;
    numero_nf?: string;
    origem?: "PROCESSAMENTO_MENSAL";
  }>;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

async function fetchExistingParcelas(parcelas: string[]): Promise<Set<string>> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase indisponivel para gravacao de Canceladas.");
  }

  const existing = new Set<string>();
  const chunkSize = 500;

  for (let index = 0; index < parcelas.length; index += chunkSize) {
    const chunk = parcelas.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("contraprestacoes_canceladas_registros")
      .select("numero_parc")
      .in("numero_parc", chunk);

    if (error) {
      throw new Error(error.message);
    }

    ((data ?? []) as Array<{ numero_parc?: string | null }>).forEach((row) => {
      const numeroParc = normalizeText(row.numero_parc);
      if (numeroParc) existing.add(numeroParc);
    });
  }

  return existing;
}

async function persistProcessedRows(payload: PersistCanceladasPayload): Promise<{
  inserted: number;
  skippedDuplicated: number;
}> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase indisponivel para gravacao de Canceladas.");
  }

  const rows = Array.isArray(payload.rowsToImport) ? payload.rowsToImport : [];
  if (rows.length === 0) {
    return { inserted: 0, skippedDuplicated: 0 };
  }

  const seenInBatch = new Set<string>();
  const normalizedRows = rows
    .map((row) => ({
      ...row,
      numero_parc: normalizeText(row.numero_parc),
      numero_nf: normalizeText(row.numero_nf),
      codigo: normalizeText(row.codigo),
      nome: normalizeText(row.nome),
      cpt: normalizeText(row.cpt),
    }))
    .filter((row) => row.numero_parc.length > 0);

  const numeroParcList = Array.from(new Set(normalizedRows.map((row) => row.numero_parc)));
  const existing = await fetchExistingParcelas(numeroParcList);

  const rowsToInsert = normalizedRows.filter((row) => {
    if (existing.has(row.numero_parc)) return false;
    if (seenInBatch.has(row.numero_parc)) return false;
    seenInBatch.add(row.numero_parc);
    return true;
  });

  if (rowsToInsert.length > 0) {
    const { error } = await supabase
      .from("contraprestacoes_canceladas_registros")
      .insert(rowsToInsert);

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    inserted: rowsToInsert.length,
    skippedDuplicated: normalizedRows.length - rowsToInsert.length,
  };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await request.json().catch(() => null)) as PersistCanceladasPayload | null;
      if (!payload) {
        return NextResponse.json(
          { message: "Corpo da requisicao invalido para importacao do historico mensal." },
          { status: 400 },
        );
      }

      const result = await persistProcessedRows(payload);
      return NextResponse.json({
        inserted: result.inserted,
        skippedDuplicated: result.skippedDuplicated,
      });
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
    const competencia =
      typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)
        ? parseCompetencia(competenciaRaw)
        : ((await new CompetenciaDetector().detect(fileBuffer, file.name)) ??
          parseCompetencia(undefined));
    const result = await processor.process(fileBuffer, competencia);
    const persistResult = await persistProcessedRows({
      competencia: result.competencia,
      rowsToImport: result.rowsToImport,
    });

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
        registrosImportados: persistResult.inserted,
        registrosDuplicadosNoParc: persistResult.skippedDuplicated,
        arquivosGerados: result.generatedFiles.length,
        competenciaDetectada: competenciaToString(competencia),
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
