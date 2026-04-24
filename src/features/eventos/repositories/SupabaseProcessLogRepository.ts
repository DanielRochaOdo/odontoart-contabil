import { ProcessSummary } from "@/features/eventos/domain/types";
import { ProcessLogRepository } from "@/features/eventos/repositories/ProcessLogRepository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export class SupabaseProcessLogRepository implements ProcessLogRepository {
  async save(summary: ProcessSummary): Promise<void> {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new Error(
        "Supabase indisponivel para salvar relatorio. Configure SUPABASE_SERVICE_ROLE_KEY valida.",
      );
    }

    const { error } = await supabase.from("eventos_processamentos").insert({
      competencia: summary.competencia,
      entrada_conhecidos: summary.entradaConhecidos,
      entrada_liquidados: summary.entradaLiquidados,
      conhecidos_classificados: summary.conhecidosClassificados,
      liquidados_classificados: summary.liquidadosClassificados,
      excluidos_kits: summary.excluidosKits,
      excluidos_valor_zero: summary.excluidosValorZero,
      lotes_adicionados_liquidado: summary.lotesAdicionadosNoConhecido,
      avisos: summary.avisos,
      detalhes: summary.auditoria,
      criado_em: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Falha ao salvar relatorio no Supabase: ${error.message}`);
    }
  }
}
