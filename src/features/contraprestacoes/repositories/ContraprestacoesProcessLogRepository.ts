import {
  ContraprestacoesGeneratedFile,
  ContraprestacoesSummary,
} from "@/features/contraprestacoes/domain/types";

export interface ContraprestacoesProcessRecord {
  id: number;
  competencia: string;
  escopo: "recebidas" | "recuperadas";
  entradaBase: number;
  registrosTratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivosGerados: number;
  totalValorPagamento: number;
  arquivoNome: string;
  storagePath: string | null;
  reportFiles: ContraprestacoesGeneratedFile[];
  criadoEm: string;
}

export interface SaveContraprestacoesProcessInput {
  summary: ContraprestacoesSummary;
  fileName: string;
  fileBuffer: Uint8Array;
  generatedFiles: ContraprestacoesGeneratedFile[];
}

export interface ContraprestacoesProcessLogRepository {
  save(input: SaveContraprestacoesProcessInput): Promise<void>;
  listByCompetencia(competencia: string): Promise<ContraprestacoesProcessRecord[]>;
  downloadStoredZip(storagePath: string): Promise<Uint8Array>;
}
