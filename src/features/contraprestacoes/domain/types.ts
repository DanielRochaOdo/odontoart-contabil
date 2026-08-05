import { Competencia } from "@/features/eventos/domain/types";

export type PessoaTipo = "PF" | "PJ";
export type ContraprestacaoGrupo = "RECEBIDA" | "RECUPERADA";
export type ContraprestacoesScope = "recebidas" | "recuperadas";
export type ContraprestacoesReportId =
  | "base-tratada"
  | "recuperada-boleto"
  | "recuperada-cartao-credito"
  | "recuperada-cartao-debito"
  | "recuperada-dinheiro-caixinha"
  | "recuperada-enel"
  | "recebida-boleto"
  | "recebida-cartao-credito"
  | "recebida-cartao-debito"
  | "recebida-enel"
  | "recebida-dinheiro-caixinha"
  | "recebida-agente-recebedor"
  | "recebida-devolucao"
  | "recebida-debito-em-conta"
  | "recebida-pix-recorrente";

export interface ContraprestacoesGeneratedFile {
  reportId: ContraprestacoesReportId;
  fileName: string;
  rowCount: number;
}

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
  devolucaoMensalidade: boolean;
  observacoes: string[];
}

export interface ContraprestacoesSummary {
  escopo: ContraprestacoesScope;
  competencia: string;
  entradaBase: number;
  registrosTratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivosGerados: number;
  totalValorPagamento: number;
}

export interface ContraprestacoesSettings {
  tarifaCartaoDebito: number;
  tarifaCartaoCredito: number;
  tarifaDebitoEmConta: number;
  tarifaPixFixo: number;
}

export interface ContraprestacoesProcessInput {
  escopo: ContraprestacoesScope;
  competencia: Competencia;
  baseBuffer: Uint8Array;
  settings: ContraprestacoesSettings;
}

export interface ContraprestacoesProcessOutput {
  fileName: string;
  fileBuffer: Uint8Array;
  summary: ContraprestacoesSummary;
  generatedFiles: ContraprestacoesGeneratedFile[];
}
