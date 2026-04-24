import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface DbRow {
  id: number;
  competencia: string;
  entrada_conhecidos: number;
  entrada_liquidados: number;
  conhecidos_classificados: number;
  liquidados_classificados: number;
  excluidos_kits: number;
  excluidos_valor_zero: number;
  lotes_adicionados_liquidado: number;
  avisos: string[] | null;
  detalhes:
    | {
        porGrupo?: unknown[];
        lotesAdicionados?: string[];
        lotesSomenteConhecidos?: string[];
        lotesSomenteLiquidados?: string[];
      }
    | null;
  criado_em: string;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export const runtime = "nodejs";

function toFriendlyQueryErrorMessage(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes("invalid api key")) {
    return "Chave do Supabase invalida para o modulo Relatorios. Configure uma SERVICE_ROLE_KEY valida.";
  }
  if (message.includes("relation") && message.includes("eventos_processamentos")) {
    return "Tabela de relatorios de Eventos nao encontrada. Rode as migrations do Supabase.";
  }
  return "Nao foi possivel carregar os relatorios agora. Tente novamente em instantes.";
}

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({
      rows: [],
      message:
        "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY validos para consultar o historico de Relatorios.",
    });
  }

  const url = new URL(request.url);
  const competencia = url.searchParams.get("competencia");
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  let query = supabase
    .from("eventos_processamentos")
    .select(
      "id, competencia, entrada_conhecidos, entrada_liquidados, conhecidos_classificados, liquidados_classificados, excluidos_kits, excluidos_valor_zero, lotes_adicionados_liquidado, avisos, detalhes, criado_em",
    )
    .order("criado_em", { ascending: false })
    .limit(limit);

  if (competencia && /^\d{4}-\d{2}$/.test(competencia)) {
    query = query.eq("competencia", competencia);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        message: toFriendlyQueryErrorMessage(error.message),
      },
      { status: 500 },
    );
  }

  const rows = ((data ?? []) as DbRow[]).map((item) => ({
    id: item.id,
    competencia: item.competencia,
    entradaConhecidos: item.entrada_conhecidos,
    entradaLiquidados: item.entrada_liquidados,
    conhecidosClassificados: item.conhecidos_classificados,
    liquidadosClassificados: item.liquidados_classificados,
    excluidosKits: item.excluidos_kits,
    excluidosValorZero: item.excluidos_valor_zero,
    lotesAdicionadosNoConhecido: item.lotes_adicionados_liquidado,
    avisos: toStringArray(item.avisos),
    auditoria: {
      porGrupo: toArray(item.detalhes?.porGrupo),
      lotesAdicionados: toStringArray(item.detalhes?.lotesAdicionados),
      lotesSomenteConhecidos: toStringArray(item.detalhes?.lotesSomenteConhecidos),
      lotesSomenteLiquidados: toStringArray(item.detalhes?.lotesSomenteLiquidados),
    },
    criadoEm: item.criado_em,
  }));

  return NextResponse.json({ rows });
}
