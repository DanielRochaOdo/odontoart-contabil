import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchCanceladasParcelasFromSupabase(): Promise<Set<string>> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new ContraprestacoesError(
      "Supabase indisponivel para consulta de Canceladas.",
      "Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY validos para cruzar Recebidas com Canceladas.",
    );
  }

  const parcelas = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("contraprestacoes_canceladas_registros")
      .select("numero_parc")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new ContraprestacoesError(
        `Falha ao consultar Canceladas: ${error.message}`,
        "Nao foi possivel consultar a base de Canceladas no Supabase.",
      );
    }

    const rows = (data ?? []) as Array<{ numero_parc?: string | null }>;
    rows.forEach((row) => {
      const key = (row.numero_parc ?? "").trim();
      if (key) parcelas.add(key);
    });

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return parcelas;
}
