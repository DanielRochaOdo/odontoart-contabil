import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface CanceladasDbRow {
  id: number;
  competencia: string;
  ano: number;
  mes: number;
  cpt: string | null;
  codigo: string;
  nome: string;
  emissao: string | null;
  vencimento: string | null;
  valor_emitido: number | string;
  numero_parc: string;
  numero_nf: string;
  origem: string;
  criado_em: string;
}

interface UpdateCanceladaPayload {
  competencia?: string;
  codigo?: string;
  nome?: string;
  emissao?: string | null;
  vencimento?: string | null;
  valorEmitido?: number;
  numeroParc?: string;
  numeroNf?: string;
  cpt?: string | null;
}

export const runtime = "nodejs";

function toFriendlyQueryErrorMessage(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes("invalid api key")) {
    return "Chave do Supabase invalida para o modulo Canceladas. Configure uma SERVICE_ROLE_KEY valida.";
  }
  if (message.includes("relation") && message.includes("contraprestacoes_canceladas_registros")) {
    return "Tabela de Canceladas nao encontrada. Rode as migrations do Supabase.";
  }
  return "Nao foi possivel atualizar a base de Canceladas agora.";
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseCompetencia(value: string | undefined): { competencia: string; ano: number; mes: number } | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;

  return { competencia: `${ano}-${String(mes).padStart(2, "0")}`, ano, mes };
}

function mapRow(row: CanceladasDbRow) {
  const valorEmitido =
    typeof row.valor_emitido === "number" ? row.valor_emitido : Number(row.valor_emitido ?? 0);

  return {
    id: row.id,
    competencia: row.competencia,
    ano: row.ano,
    mes: row.mes,
    cpt: row.cpt,
    codigo: row.codigo,
    nome: row.nome,
    emissao: row.emissao,
    vencimento: row.vencimento,
    valorEmitido: Number.isFinite(valorEmitido) ? valorEmitido : 0,
    numeroParc: row.numero_parc,
    numeroNf: row.numero_nf,
    origem: row.origem,
    criadoEm: row.criado_em,
  };
}

function resolveId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        message:
          "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para atualizar Canceladas.",
      },
      { status: 500 },
    );
  }

  const { id: rawId } = await context.params;
  const id = resolveId(rawId);
  if (!id) {
    return NextResponse.json({ message: "Identificador de registro invalido." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as UpdateCanceladaPayload | null;
  if (!payload) {
    return NextResponse.json({ message: "Corpo da requisicao invalido." }, { status: 400 });
  }

  const competenciaParsed = parseCompetencia(payload.competencia);
  if (!competenciaParsed) {
    return NextResponse.json(
      { message: "Informe a competencia no formato AAAA-MM." },
      { status: 400 },
    );
  }

  const codigo = normalizeText(payload.codigo);
  const nome = normalizeText(payload.nome);
  if (!codigo || !nome) {
    return NextResponse.json(
      { message: "Campos Codigo e Nome sao obrigatorios para atualizar o registro." },
      { status: 400 },
    );
  }

  const valorEmitido = Number(payload.valorEmitido ?? 0);
  const parsedValorEmitido = Number.isFinite(valorEmitido) ? valorEmitido : 0;

  const updatePayload = {
    competencia: competenciaParsed.competencia,
    ano: competenciaParsed.ano,
    mes: competenciaParsed.mes,
    cpt: normalizeText(payload.cpt) || `${String(competenciaParsed.mes).padStart(2, "0")}.${competenciaParsed.ano}`,
    codigo,
    nome,
    emissao: normalizeDate(payload.emissao),
    vencimento: normalizeDate(payload.vencimento),
    valor_emitido: parsedValorEmitido,
    numero_parc: normalizeText(payload.numeroParc),
    numero_nf: normalizeText(payload.numeroNf),
  };

  const { data, error } = await supabase
    .from("contraprestacoes_canceladas_registros")
    .update(updatePayload)
    .eq("id", id)
    .select(
      "id, competencia, ano, mes, cpt, codigo, nome, emissao, vencimento, valor_emitido, numero_parc, numero_nf, origem, criado_em",
    )
    .single();

  if (error) {
    return NextResponse.json(
      { message: toFriendlyQueryErrorMessage(error.message) },
      { status: 500 },
    );
  }

  return NextResponse.json({ row: mapRow(data as CanceladasDbRow) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        message:
          "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para excluir Canceladas.",
      },
      { status: 500 },
    );
  }

  const { id: rawId } = await context.params;
  const id = resolveId(rawId);
  if (!id) {
    return NextResponse.json({ message: "Identificador de registro invalido." }, { status: 400 });
  }

  const { error } = await supabase
    .from("contraprestacoes_canceladas_registros")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { message: toFriendlyQueryErrorMessage(error.message) },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
