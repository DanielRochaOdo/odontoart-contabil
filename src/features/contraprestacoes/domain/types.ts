import { Competencia } from "@/features/eventos/domain/types";

export type PessoaTipo = "PF" | "PJ";
export type ContraprestacaoGrupo = "RECEBIDA" | "RECUPERADA";

export interface RecebidaRow {
  linhaOrigem: number;
  codigo: string;
  nomeFantasia: string;
  cpfCnpj: string;
  grupoEmpresa: string;
  empresa: string;
  dataCredito: Date | null;
  dataVencimento: Date | null;
  imposto: number;
  titulo: number;
  dataPagamento: Date | null;
  valorPagamento: number;
  tarifa: number;
  tipoParcela: string;
  tipoRecebimento: string;
  tipoPagamento: string;
  parcela: string;
  loteNf: string;
  nf: string;
  dtEmissao: Date | null;
  pessoaTipo: PessoaTipo;
}

export interface ProcessedRecebidaRow extends RecebidaRow {
  recuperada: boolean;
  grupo: ContraprestacaoGrupo;
  observacoes: string[];
}

export interface ContraprestacoesSummary {
  competencia: string;
  entradaRecebidas: number;
  registrosTratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivosGerados: number;
  totalValorPagamento: number;
}

export interface ContraprestacoesProcessInput {
  competencia: Competencia;
  recebidasBuffer: Uint8Array;
}

export interface ContraprestacoesProcessOutput {
  fileName: string;
  fileBuffer: Uint8Array;
  summary: ContraprestacoesSummary;
}
