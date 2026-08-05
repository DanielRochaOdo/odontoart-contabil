import JSZip from "jszip";
import {
  ContraprestacoesGeneratedFile,
  ContraprestacoesScope,
} from "@/features/contraprestacoes/domain/types";
import {
  ContraprestacoesProcessLogRepository,
  ContraprestacoesProcessRecord,
} from "@/features/contraprestacoes/repositories/ContraprestacoesProcessLogRepository";
import { SupabaseContraprestacoesProcessLogRepository } from "@/features/contraprestacoes/repositories/SupabaseContraprestacoesProcessLogRepository";

export interface ConferenciaDivergencia {
  severity: "error" | "warning";
  escopo: ContraprestacoesScope | "geral";
  message: string;
}

export interface ConferenciaEscopoResumo {
  escopo: ContraprestacoesScope;
  status: "ok" | "warning" | "error";
  latest: ContraprestacoesProcessRecord | null;
  expectedArquivos: number;
  actualArquivos: number;
  expectedLinhasSaida: number;
  actualLinhasSaida: number;
  baseTratadaLinhas: number;
}

export interface ConferenciaCompetenciaResumo {
  competencia: string;
  rows: ContraprestacoesProcessRecord[];
  escopos: ConferenciaEscopoResumo[];
  divergencias: ConferenciaDivergencia[];
  canDownloadConsolidated: boolean;
}

function expectedFileCount(escopo: ContraprestacoesScope): number {
  return escopo === "recebidas" ? 10 : 6;
}

function expectedOutputRows(
  escopo: ContraprestacoesScope,
  latest: ContraprestacoesProcessRecord,
): number {
  return escopo === "recebidas" ? latest.recebidas : latest.recuperadas;
}

function sumRows(files: ContraprestacoesGeneratedFile[], excludeBase: boolean): number {
  return files
    .filter((item) => (excludeBase ? item.reportId !== "base-tratada" : item.reportId === "base-tratada"))
    .reduce((total, item) => total + item.rowCount, 0);
}

function statusForScope(divergencias: ConferenciaDivergencia[]): "ok" | "warning" | "error" {
  if (divergencias.some((item) => item.severity === "error")) return "error";
  if (divergencias.length > 0) return "warning";
  return "ok";
}

export class ContraprestacoesConferenciaService {
  constructor(
    private readonly repository: ContraprestacoesProcessLogRepository = new SupabaseContraprestacoesProcessLogRepository(),
  ) {}

  async getCompetenciaResumo(competencia: string): Promise<ConferenciaCompetenciaResumo> {
    const rows = await this.repository.listByCompetencia(competencia);
    const divergencias: ConferenciaDivergencia[] = [];

    const escopos = (["recebidas", "recuperadas"] as const).map((escopo) => {
      const latest = rows.find((item) => item.escopo === escopo) ?? null;
      const scopeIssues: ConferenciaDivergencia[] = [];

      if (!latest) {
        scopeIssues.push({
          severity: "warning",
          escopo,
          message: `Nenhum processamento salvo para ${escopo} na competencia ${competencia}.`,
        });
      } else {
        const expectedArquivos = expectedFileCount(escopo);
        const actualArquivos = latest.reportFiles.length;
        const expectedLinhas = expectedOutputRows(escopo, latest);
        const actualLinhas = sumRows(latest.reportFiles, true);
        const baseTratadaLinhas = sumRows(latest.reportFiles, false);

        if (!latest.storagePath) {
          scopeIssues.push({
            severity: "error",
            escopo,
            message: `O ZIP salvo de ${escopo} nao possui caminho de armazenamento valido.`,
          });
        }

        if (latest.arquivosGerados !== expectedArquivos || actualArquivos !== expectedArquivos) {
          scopeIssues.push({
            severity: "error",
            escopo,
            message: `${escopo} deveria ter ${expectedArquivos} arquivos de saida, mas ficou com ${actualArquivos}.`,
          });
        }

        if (baseTratadaLinhas !== latest.registrosTratados) {
          scopeIssues.push({
            severity: "error",
            escopo,
            message: `A base tratada de ${escopo} possui ${baseTratadaLinhas} linhas, diferente das ${latest.registrosTratados} linhas tratadas.`,
          });
        }

        if (actualLinhas !== expectedLinhas) {
          scopeIssues.push({
            severity: "error",
            escopo,
            message: `As planilhas finais de ${escopo} somam ${actualLinhas} linhas, diferente das ${expectedLinhas} linhas esperadas na base.`,
          });
        }

        if (rows.filter((item) => item.escopo === escopo).length > 1) {
          scopeIssues.push({
            severity: "warning",
            escopo,
            message: `Ha mais de um processamento salvo para ${escopo} nesta competencia. A conferencia usa o mais recente.`,
          });
        }
      }

      divergencias.push(...scopeIssues);

      return {
        escopo,
        status: statusForScope(scopeIssues),
        latest,
        expectedArquivos: latest ? expectedFileCount(escopo) : 0,
        actualArquivos: latest ? latest.reportFiles.length : 0,
        expectedLinhasSaida: latest ? expectedOutputRows(escopo, latest) : 0,
        actualLinhasSaida: latest ? sumRows(latest.reportFiles, true) : 0,
        baseTratadaLinhas: latest ? sumRows(latest.reportFiles, false) : 0,
      };
    });

    return {
      competencia,
      rows,
      escopos,
      divergencias,
      canDownloadConsolidated: escopos.every(
        (item) => item.latest?.storagePath && item.status !== "error",
      ),
    };
  }

  async buildConsolidatedArchive(competencia: string): Promise<{
    fileName: string;
    fileBuffer: Uint8Array;
  }> {
    const resumo = await this.getCompetenciaResumo(competencia);
    const zip = new JSZip();

    for (const escopo of resumo.escopos) {
      if (!escopo.latest?.storagePath) {
        throw new Error(`Nao existe ZIP salvo para ${escopo.escopo} na competencia ${competencia}.`);
      }

      const storedZip = await this.repository.downloadStoredZip(escopo.latest.storagePath);
      const opened = await JSZip.loadAsync(storedZip);
      const folderName = escopo.escopo === "recebidas" ? "Recebidas" : "Recuperadas";

      await Promise.all(
        Object.values(opened.files).map(async (file) => {
          if (file.dir) return;
          const content = await file.async("uint8array");
          zip.file(`${folderName}/${file.name}`, content);
        }),
      );
    }

    const [ano, mes] = competencia.split("-");
    return {
      fileName: `${mes}.${ano} Contraprestacoes - Conferencia.zip`,
      fileBuffer: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    };
  }
}
