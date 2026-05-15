import { NextResponse } from "next/server";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { fetchCanceladasParcelasFromSupabase } from "@/features/contraprestacoes/services/canceladasParcelas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const parcelas = await fetchCanceladasParcelasFromSupabase();
    return NextResponse.json({
      parcelas: Array.from(parcelas).sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    const message =
      error instanceof ContraprestacoesError
        ? error.userMessage
        : "Nao foi possivel consultar a base de Canceladas agora.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
