import { NextResponse } from "next/server";
import { ContraprestacoesConferenciaService } from "@/features/contraprestacoes/services/ContraprestacoesConferenciaService";

export const runtime = "nodejs";

function isValidCompetencia(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function toFriendlyMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid api key")) {
    return "Chave do Supabase invalida para carregar a conferencia. Configure uma SERVICE_ROLE_KEY valida.";
  }
  if (
    normalized.includes("contraprestacoes_processamentos") ||
    normalized.includes("contraprestacoes-relatorios")
  ) {
    return "Estrutura da conferencia nao encontrada no Supabase. Rode as migrations do modulo.";
  }
  return "Nao foi possivel carregar a conferencia agora. Tente novamente em instantes.";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const competencia = url.searchParams.get("competencia");

  if (!isValidCompetencia(competencia)) {
    return NextResponse.json(
      { message: "Informe a competencia no formato AAAA-MM para consultar a conferencia." },
      { status: 400 },
    );
  }

  try {
    const service = new ContraprestacoesConferenciaService();
    const resumo = await service.getCompetenciaResumo(competencia);
    return NextResponse.json(resumo);
  } catch (error) {
    const message =
      error instanceof Error ? toFriendlyMessage(error.message) : toFriendlyMessage("");
    return NextResponse.json({ message }, { status: 500 });
  }
}
