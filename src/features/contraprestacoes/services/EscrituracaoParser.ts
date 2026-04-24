import ExcelJS from "exceljs";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { EscrituracaoRow } from "@/features/contraprestacoes/domain/types";
import { coerceDate, coerceNumber, coerceString } from "@/features/eventos/services/utils";

function isValidRow(row: EscrituracaoRow): boolean {
  return Boolean(row.mensalidade || row.numeroNf || row.codigo || row.nome) && row.valor > 0;
}

export class EscrituracaoParser {
  async parse(fileBuffer: Buffer): Promise<EscrituracaoRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new ContraprestacoesError(
        "Planilha de escrituracao ausente.",
        "Nao foi possivel ler o arquivo de Escrituracao. Confirme o envio do arquivo correto.",
      );
    }

    const rows: EscrituracaoRow[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const parsed: EscrituracaoRow = {
        mensalidade: coerceString(row.getCell("A").value),
        numeroNf: coerceString(row.getCell("C").value),
        codigo: coerceString(row.getCell("D").value),
        nome: coerceString(row.getCell("E").value),
        vencimento: coerceDate(row.getCell("F").value),
        tipo: coerceString(row.getCell("G").value),
        valor: coerceNumber(row.getCell("H").value),
        issRetido: coerceNumber(row.getCell("R").value),
      };

      if (!isValidRow(parsed)) continue;
      rows.push(parsed);
    }

    if (rows.length === 0) {
      throw new ContraprestacoesError(
        "Escrituracao sem registros validos.",
        "Nenhum registro valido foi encontrado no arquivo de Escrituracao.",
      );
    }

    return rows;
  }
}
