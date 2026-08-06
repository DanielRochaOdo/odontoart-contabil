import { Competencia } from "@/features/eventos/domain/types";

export interface AgingSummary {
  competencia: string;
  registrosEntrada: number;
  registrosTratados: number;
  registrosPf: number;
  registrosPj: number;
  excluidosSemLote: number;
  excluidosEmissao: number;
  excluidosPagamento: number;
}

export interface AgingProcessInput {
  contabilidadeBuffer: Uint8Array;
  baseBuffer: Uint8Array;
  competencia: Competencia;
}

export interface AgingProcessOutput {
  fileName: string;
  fileBuffer: Uint8Array;
  summary: AgingSummary;
}
