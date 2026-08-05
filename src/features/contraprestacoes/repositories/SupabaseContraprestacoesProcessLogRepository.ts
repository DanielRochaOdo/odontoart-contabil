import {
  ContraprestacoesGeneratedFile,
  ContraprestacoesSummary,
} from "@/features/contraprestacoes/domain/types";
import {
  ContraprestacoesProcessLogRepository,
  ContraprestacoesProcessRecord,
  SaveContraprestacoesProcessInput,
} from "@/features/contraprestacoes/repositories/ContraprestacoesProcessLogRepository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const STORAGE_BUCKET = "contraprestacoes-relatorios";

interface DbRow {
  id: number;
  competencia: string;
  escopo: "recebidas" | "recuperadas";
  entrada_base: number;
  registros_tratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivos_gerados: number;
  total_valor_pagamento: number;
  arquivo_nome: string;
  storage_path: string | null;
  detalhes:
    | {
        reportFiles?: ContraprestacoesGeneratedFile[];
      }
    | null;
  criado_em: string;
}

function buildStoragePath(summary: ContraprestacoesSummary, fileName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${summary.competencia}/${summary.escopo}/${stamp}-${fileName}`;
}

function toRecord(row: DbRow): ContraprestacoesProcessRecord {
  return {
    id: row.id,
    competencia: row.competencia,
    escopo: row.escopo,
    entradaBase: row.entrada_base,
    registrosTratados: row.registros_tratados,
    recuperadas: row.recuperadas,
    recebidas: row.recebidas,
    devolucoes: row.devolucoes,
    arquivosGerados: row.arquivos_gerados,
    totalValorPagamento: row.total_valor_pagamento,
    arquivoNome: row.arquivo_nome,
    storagePath: row.storage_path,
    reportFiles: Array.isArray(row.detalhes?.reportFiles) ? row.detalhes!.reportFiles : [],
    criadoEm: row.criado_em,
  };
}

export class SupabaseContraprestacoesProcessLogRepository
  implements ContraprestacoesProcessLogRepository
{
  async save(input: SaveContraprestacoesProcessInput): Promise<void> {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new Error(
        "Supabase indisponivel para salvar relatorio de contraprestacoes. Configure SUPABASE_SERVICE_ROLE_KEY valida.",
      );
    }

    const storagePath = buildStoragePath(input.summary, input.fileName);
    const upload = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, input.fileBuffer, {
        contentType: "application/zip",
        upsert: true,
      });

    if (upload.error) {
      throw new Error(`Falha ao salvar ZIP de contraprestacoes: ${upload.error.message}`);
    }

    const { error } = await supabase.from("contraprestacoes_processamentos").insert({
      competencia: input.summary.competencia,
      escopo: input.summary.escopo,
      entrada_base: input.summary.entradaBase,
      registros_tratados: input.summary.registrosTratados,
      recuperadas: input.summary.recuperadas,
      recebidas: input.summary.recebidas,
      devolucoes: input.summary.devolucoes,
      arquivos_gerados: input.summary.arquivosGerados,
      total_valor_pagamento: input.summary.totalValorPagamento,
      arquivo_nome: input.fileName,
      storage_path: storagePath,
      detalhes: {
        reportFiles: input.generatedFiles,
      },
      criado_em: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Falha ao salvar relatorio de contraprestacoes: ${error.message}`);
    }
  }

  async listByCompetencia(competencia: string): Promise<ContraprestacoesProcessRecord[]> {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new Error(
        "Supabase indisponivel para consultar conferencia. Configure SUPABASE_SERVICE_ROLE_KEY valida.",
      );
    }

    const { data, error } = await supabase
      .from("contraprestacoes_processamentos")
      .select(
        "id, competencia, escopo, entrada_base, registros_tratados, recuperadas, recebidas, devolucoes, arquivos_gerados, total_valor_pagamento, arquivo_nome, storage_path, detalhes, criado_em",
      )
      .eq("competencia", competencia)
      .order("criado_em", { ascending: false });

    if (error) {
      throw new Error(`Falha ao consultar conferencia: ${error.message}`);
    }

    return ((data ?? []) as DbRow[]).map(toRecord);
  }

  async downloadStoredZip(storagePath: string): Promise<Uint8Array> {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new Error(
        "Supabase indisponivel para baixar relatorio consolidado. Configure SUPABASE_SERVICE_ROLE_KEY valida.",
      );
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) {
      throw new Error(
        `Falha ao baixar ZIP salvo de contraprestacoes: ${error?.message ?? "arquivo indisponivel"}`,
      );
    }

    return new Uint8Array(await data.arrayBuffer());
  }
}
