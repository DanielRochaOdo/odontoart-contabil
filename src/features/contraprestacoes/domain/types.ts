import { Competencia } from "@/features/eventos/domain/types";

export interface EscrituracaoRow {
  mensalidade: string;
  numeroNf: string;
  codigo: string;
  nome: string;
  vencimento: Date | null;
  tipo: string;
  valor: number;
  issRetido: number;
}

export interface ContraprestacoesSummary {
  competencia: string;
  entradaEscrituracao: number;
  saidaPf: number;
  saidaPj: number;
}

export interface ContraprestacoesProcessInput {
  competencia: Competencia;
  escrituracaoBuffer: Buffer;
}

export interface ContraprestacoesProcessOutput {
  fileName: string;
  fileBuffer: Buffer;
  summary: ContraprestacoesSummary;
}
