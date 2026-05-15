import JSZip from "jszip";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import {
  ContraprestacoesProcessInput,
  ContraprestacoesProcessOutput,
} from "@/features/contraprestacoes/domain/types";
import { ContraprestacoesReportFactory } from "@/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { RecebidasWorkbookParser } from "@/features/contraprestacoes/services/RecebidasWorkbookParser";
import {
  applyRecebidasRules,
  buildContraprestacoesSummary,
} from "@/features/contraprestacoes/services/contraprestacoesRules";
import { fetchCanceladasParcelasFromSupabase } from "@/features/contraprestacoes/services/canceladasParcelas";

export class ContraprestacoesProcessor {
  private readonly parser = new RecebidasWorkbookParser();

  private readonly reportFactory = new ContraprestacoesReportFactory();

  async process(input: ContraprestacoesProcessInput): Promise<ContraprestacoesProcessOutput> {
    const rows = await this.parser.parse(input.recebidasBuffer);
    const canceladasParcelas = await fetchCanceladasParcelasFromSupabase();
    const processedRows = applyRecebidasRules(rows, canceladasParcelas, input.competencia);

    if (processedRows.length === 0) {
      throw new ContraprestacoesError(
        "Base de recebidas sem registros apos tratamento.",
        "Nenhum registro permaneceu apos aplicar as regras de tratamento de Recebidas.",
      );
    }

    const reports = await this.reportFactory.buildReports(processedRows, input.competencia);
    const zip = new JSZip();
    reports.forEach((report) => {
      zip.file(report.fileName, report.buffer);
    });

    const zipBuffer = await zip.generateAsync({ type: "uint8array" });
    const summary = buildContraprestacoesSummary(processedRows, rows.length, input.competencia);

    return {
      fileName: `${String(input.competencia.mes).padStart(2, "0")}.${input.competencia.ano} Contraprestacoes - Recebidas e Recuperadas.zip`,
      fileBuffer: zipBuffer,
      summary: {
        ...summary,
        arquivosGerados: reports.length,
      },
    };
  }
}
