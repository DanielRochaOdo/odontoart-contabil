import { EventosError } from "@/features/eventos/domain/errors";
import {
  AuditoriaGrupoResumo,
  Competencia,
  EventoClassificado,
  ProcessResult,
  ProcessSummary,
} from "@/features/eventos/domain/types";
import { ProcessLogRepository } from "@/features/eventos/repositories/ProcessLogRepository";
import { SupabaseProcessLogRepository } from "@/features/eventos/repositories/SupabaseProcessLogRepository";
import { ArchiveService } from "@/features/eventos/services/ArchiveService";
import { ContabilidadeWorkbookFactory } from "@/features/eventos/services/ContabilidadeWorkbookFactory";
import { EventClassifier } from "@/features/eventos/services/EventClassifier";
import { RawWorkbookParser } from "@/features/eventos/services/RawWorkbookParser";
import { ReconciliationService } from "@/features/eventos/services/ReconciliationService";
import { competenciaToString } from "@/features/eventos/services/utils";

export interface ProcessInput {
  conhecidosFileBuffer: Buffer;
  liquidadosFileBuffer: Buffer;
  competencia: Competencia;
}

export interface ProcessOutput {
  zipBuffer: Buffer;
  summary: ProcessSummary;
}

export class EventosProcessor {
  private readonly parser = new RawWorkbookParser();
  private readonly classifier = new EventClassifier();
  private readonly reconciler = new ReconciliationService();
  private readonly workbookFactory = new ContabilidadeWorkbookFactory();
  private readonly archiveService = new ArchiveService();

  constructor(private readonly repository: ProcessLogRepository = new SupabaseProcessLogRepository()) {}

  private buildGrupoResumo(
    origem: "CONHECIDOS" | "LIQUIDADOS",
    eventos: EventoClassificado[],
  ): AuditoriaGrupoResumo[] {
    const groups = new Map<string, AuditoriaGrupoResumo>();

    for (const evento of eventos) {
      const key = `${origem}:${evento.segmento}:${evento.tipoPessoa}`;
      if (!groups.has(key)) {
        groups.set(key, {
          origem,
          segmento: evento.segmento,
          tipoPessoa: evento.tipoPessoa,
          quantidade: 0,
          totalVlBruto: 0,
          totalLiquido: 0,
          totalPago: 0,
          totalInss: 0,
          totalIss: 0,
          totalIr: 0,
        });
      }

      const group = groups.get(key)!;
      group.quantidade += 1;
      group.totalVlBruto += evento.valorBruto;
      group.totalLiquido += evento.liquido;
      group.totalPago += evento.totalPago || evento.liquido;
      group.totalInss += evento.inss;
      group.totalIss += evento.iss;
      group.totalIr += evento.ir;
    }

    return [...groups.values()].sort((a, b) => {
      if (a.origem !== b.origem) return a.origem.localeCompare(b.origem);
      if (a.segmento !== b.segmento) return a.segmento.localeCompare(b.segmento);
      return a.tipoPessoa.localeCompare(b.tipoPessoa);
    });
  }

  async process(input: ProcessInput): Promise<ProcessOutput> {
    const conhecidosRaw = await this.parser.parse(input.conhecidosFileBuffer);
    const liquidadosRaw = await this.parser.parse(input.liquidadosFileBuffer);

    const conhecidosClassification = this.classifier.classify(conhecidosRaw);
    const liquidadosClassification = this.classifier.classify(liquidadosRaw);

    if (conhecidosClassification.eventos.length === 0) {
      throw new EventosError(
        "Sem dados conhecidos apos filtros.",
        "Nenhum evento conhecido ficou apto para exportação. Verifique os filtros da competência.",
      );
    }
    if (liquidadosClassification.eventos.length === 0) {
      throw new EventosError(
        "Sem dados liquidados apos filtros.",
        "Nenhum evento liquidado ficou apto para exportação. Verifique os arquivos enviados.",
      );
    }

    const reconciliation = this.reconciler.reconcile(
      conhecidosClassification.eventos,
      liquidadosClassification.eventos,
    );

    const arquivos = await this.workbookFactory.build({
      conhecidos: reconciliation.conhecidosConsolidados,
      liquidados: liquidadosClassification.eventos,
      competencia: input.competencia,
    });

    const zipBuffer = await this.archiveService.zipXlsxFiles(arquivos);

    const summary: ProcessResult["summary"] = {
      competencia: competenciaToString(input.competencia),
      entradaConhecidos: conhecidosRaw.length,
      entradaLiquidados: liquidadosRaw.length,
      excluidosKits:
        conhecidosClassification.excluidosKits + liquidadosClassification.excluidosKits,
      excluidosValorZero:
        conhecidosClassification.excluidosValorZero +
        liquidadosClassification.excluidosValorZero,
      conhecidosClassificados: reconciliation.conhecidosConsolidados.length,
      liquidadosClassificados: liquidadosClassification.eventos.length,
      lotesAdicionadosNoConhecido: reconciliation.lotesAdicionados,
      avisos: [...conhecidosClassification.avisos, ...liquidadosClassification.avisos],
      auditoria: {
        porGrupo: [
          ...this.buildGrupoResumo("CONHECIDOS", reconciliation.conhecidosConsolidados),
          ...this.buildGrupoResumo("LIQUIDADOS", liquidadosClassification.eventos),
        ],
        lotesAdicionados: reconciliation.lotesAdicionadosIds,
        lotesSomenteConhecidos: reconciliation.lotesSomenteConhecidosIds,
        lotesSomenteLiquidados: reconciliation.lotesSomenteLiquidadosIds,
      },
    };

    try {
      await this.repository.save(summary);
    } catch {
      summary.avisos.push(
        "Arquivo gerado, mas nao foi possivel registrar este processamento no modulo Relatorios.",
      );
    }

    return { zipBuffer, summary };
  }
}
