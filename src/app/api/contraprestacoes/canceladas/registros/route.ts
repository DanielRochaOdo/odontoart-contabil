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

interface CreateCanceladaPayload {
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
  return "Nao foi possivel consultar a base de Canceladas agora.";
}

function parseNumericList(raw: string | null, min: number, max: number): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= min && item <= max);
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

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        rows: [],
        filtrosDisponiveis: { anos: [], meses: [] },
        paginacao: { pagina: 1, pageSize: 100, total: 0, totalPaginas: 0 },
        message:
          "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para consultar Canceladas.",
      },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const anos = parseNumericList(url.searchParams.get("anos"), 2000, 2100);
  const meses = parseNumericList(url.searchParams.get("meses"), 1, 12);
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "100");
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(Math.trunc(pageSizeRaw), 1), 500) : 100;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("contraprestacoes_canceladas_registros")
    .select(
      "id, competencia, ano, mes, cpt, codigo, nome, emissao, vencimento, valor_emitido, numero_parc, numero_nf, origem, criado_em",
      { count: "exact" },
    )
    .order("ano", { ascending: false })
    .order("mes", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (anos.length > 0) query = query.in("ano", anos);
  if (meses.length > 0) query = query.in("mes", meses);

  const [{ data, error, count }, { data: filterData, error: filterError }] = await Promise.all([
    query,
    supabase
      .from("contraprestacoes_canceladas_registros")
      .select("ano, mes")
      .order("ano", { ascending: false })
      .order("mes", { ascending: false })
      .limit(50000),
  ]);

  if (error) {
    return NextResponse.json(
      { message: toFriendlyQueryErrorMessage(error.message) },
      { status: 500 },
    );
  }

  if (filterError) {
    return NextResponse.json(
      { message: toFriendlyQueryErrorMessage(filterError.message) },
      { status: 500 },
    );
  }

  const anosDisponiveis = new Set<number>();
  const mesesDisponiveis = new Set<number>();

  (filterData ?? []).forEach((item) => {
    const row = item as { ano?: number; mes?: number };
    if (Number.isInteger(row.ano)) anosDisponiveis.add(Number(row.ano));
    if (Number.isInteger(row.mes)) mesesDisponiveis.add(Number(row.mes));
  });

  const resolvedTotal = Number.isFinite(count ?? NaN) ? Number(count) : 0;
  const totalPaginas = resolvedTotal > 0 ? Math.ceil(resolvedTotal / pageSize) : 0;

  return NextResponse.json({
    rows: ((data ?? []) as CanceladasDbRow[]).map(mapRow),
    filtrosDisponiveis: {
      anos: Array.from(anosDisponiveis).sort((a, b) => b - a),
      meses: Array.from(mesesDisponiveis).sort((a, b) => a - b),
    },
    paginacao: {
      pagina: page,
      pageSize,
      total: resolvedTotal,
      totalPaginas,
    },
  });
}

export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        message:
          "Configure SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY validos para registrar Canceladas.",
      },
      { status: 500 },
    );
  }

  const payload = (await request.json().catch(() => null)) as CreateCanceladaPayload | null;
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
      { message: "Campos Codigo e Nome sao obrigatorios para inclusao manual." },
      { status: 400 },
    );
  }

  const valorEmitido = Number(payload.valorEmitido ?? 0);
  const parsedValorEmitido = Number.isFinite(valorEmitido) ? valorEmitido : 0;

  const insertPayload = {
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
    origem: "MANUAL",
  };

  const { data, error } = await supabase
    .from("contraprestacoes_canceladas_registros")
    .insert(insertPayload)
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

  return NextResponse.json({ row: mapRow(data as CanceladasDbRow) }, { status: 201 });
}
