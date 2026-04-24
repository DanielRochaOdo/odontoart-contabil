export type Segmento = "CLINICO" | "ORTO";
export type TipoPessoa = "PF" | "PJ";
export type TipoPagamento = "INTERNO" | "EXTERNO" | "INDEFINIDO";

export interface RawEvento {
  lote: string;
  codigo: string;
  nomePrestador: string;
  cpfCnpj: string;
  modeloPagamento: string;
  banco: string;
  dataPagamento: Date | null;
  dataConhecimento: Date | null;
  dataGerado: Date | null;
  valorBruto: number;
  inss: number;
  iss: number;
  ir: number;
  pis: number;
  cofins: number;
  csll: number;
  liquido: number;
  totalPago: number;
  empresarial: number;
  individual: number;
  ortodontia: number;
}

export interface EventoClassificado extends RawEvento {
  segmento: Segmento;
  tipoPessoa: TipoPessoa;
  tipoPagamento: TipoPagamento;
}

export interface Competencia {
  ano: number;
  mes: number;
}

export interface ProcessSummary {
  competencia: string;
  entradaConhecidos: number;
  entradaLiquidados: number;
  excluidosKits: number;
  excluidosValorZero: number;
  conhecidosClassificados: number;
  liquidadosClassificados: number;
  lotesAdicionadosNoConhecido: number;
  avisos: string[];
  auditoria: AuditoriaDetalhes;
}

export interface AuditoriaGrupoResumo {
  origem: "CONHECIDOS" | "LIQUIDADOS";
  segmento: Segmento;
  tipoPessoa: TipoPessoa;
  quantidade: number;
  totalVlBruto: number;
  totalLiquido: number;
  totalPago: number;
  totalInss: number;
  totalIss: number;
  totalIr: number;
}

export interface AuditoriaDetalhes {
  porGrupo: AuditoriaGrupoResumo[];
  lotesAdicionados: string[];
  lotesSomenteConhecidos: string[];
  lotesSomenteLiquidados: string[];
}

export interface ProcessResult {
  arquivos: Array<{
    nome: string;
    conteudo: Buffer;
  }>;
  summary: ProcessSummary;
}
