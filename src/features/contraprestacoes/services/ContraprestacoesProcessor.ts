import JSZip from "jszip";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import {
  ContraprestacoesSettings,
  ContraprestacoesProcessInput,
  ContraprestacoesProcessOutput,
  ContraprestacoesScope,
} from "@/features/contraprestacoes/domain/types";
import { ContraprestacoesReportFactory } from "@/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { RecebidasWorkbookParser } from "@/features/contraprestacoes/services/RecebidasWorkbookParser";
import {
  applyRecebidasRules,
  buildContraprestacoesSummary,
} from "@/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "@/features/contraprestacoes/services/canceladasParcelas";
import { resolveContraprestacoesSettings } from "@/features/contraprestacoes/services/contraprestacoesSettings";

export class ContraprestacoesProcessor {
  private readonly parser = new RecebidasWorkbookParser();

  private readonly reportFactory = new ContraprestacoesReportFactory();

  private resolveSettings(settings: ContraprestacoesSettings): ContraprestacoesSettings {
    return resolveContraprestacoesSettings(settings);
  }

  private labelForScope(escopo: ContraprestacoesScope): string {
    return escopo === "recuperadas" ? "Recuperadas" : "Recebidas";
  }

  async process(input: ContraprestacoesProcessInput): Promise<ContraprestacoesProcessOutput> {
    const rows = await this.parser.parse(input.baseBuffer);
    const canceladasParcelas = await fetchCanceladasParcelasFromSupabase();
    const processedRows = applyRecebidasRules(rows, canceladasParcelas, input.competencia);
    const settings = this.resolveSettings(input.settings);

    if (processedRows.length === 0) {
      throw new ContraprestacoesError(
        `Base de ${this.labelForScope(input.escopo).toLowerCase()} sem registros apos tratamento.`,
        `Nenhum registro permaneceu apos aplicar as regras de tratamento de ${this.labelForScope(input.escopo)}.`,
      );
    }

    const reports = await this.reportFactory.buildReports(
      processedRows,
      input.competencia,
      input.escopo,
      settings,
    );
    const zip = new JSZip();
    reports.forEach((report) => {
      zip.file(report.fileName, report.buffer);
    });

    const zipBuffer = await zip.generateAsync({ type: "uint8array" });
    const summary = buildContraprestacoesSummary(
      input.escopo,
      processedRows,
      rows.length,
      input.competencia,
    );

    return {
      fileName: `${String(input.competencia.mes).padStart(2, "0")}.${input.competencia.ano} Contraprestacoes - ${this.labelForScope(input.escopo)}.zip`,
      fileBuffer: zipBuffer,
      summary: {
        ...summary,
        arquivosGerados: reports.length,
      },
    };
  }
}
