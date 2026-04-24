import { ContraprestacoesProcessInput, ContraprestacoesProcessOutput } from "@/features/contraprestacoes/domain/types";
import { EscrituracaoParser } from "@/features/contraprestacoes/services/EscrituracaoParser";
import { EquacaoWorkbookFactory } from "@/features/contraprestacoes/services/EquacaoWorkbookFactory";
import { competenciaToString } from "@/features/eventos/services/utils";

export class ContraprestacoesProcessor {
  private readonly parser = new EscrituracaoParser();
  private readonly workbookFactory = new EquacaoWorkbookFactory();

  async process(input: ContraprestacoesProcessInput): Promise<ContraprestacoesProcessOutput> {
    const rows = await this.parser.parse(input.escrituracaoBuffer);
    const workbookBuffer = await this.workbookFactory.build(rows, input.competencia);

    const saidaPj = rows.filter((row) => row.tipo.trim().toUpperCase() === "COLETIVO EMPRESARIAL").length;
    const saidaPf = rows.length - saidaPj;

    return {
      fileName: this.workbookFactory.buildFileName(input.competencia),
      fileBuffer: workbookBuffer,
      summary: {
        competencia: competenciaToString(input.competencia),
        entradaEscrituracao: rows.length,
        saidaPf,
        saidaPj,
      },
    };
  }
}
