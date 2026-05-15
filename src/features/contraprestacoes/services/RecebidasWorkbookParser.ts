import ExcelJS from "exceljs";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { PessoaTipo, RecebidaRow } from "@/features/contraprestacoes/domain/types";
import { coerceDate, coerceNumber, coerceString } from "@/features/eventos/services/utils";

function isCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 11;
}

function resolvePessoaTipo(value: string): PessoaTipo {
  return isCpf(value) ? "PF" : "PJ";
}

function isValidRow(row: RecebidaRow): boolean {
  return Boolean(row.codigo || row.nomeFantasia || row.parcela || row.nf) && row.valorPagamento > 0;
}

export class RecebidasWorkbookParser {
  async parse(fileBuffer: Buffer): Promise<RecebidaRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new ContraprestacoesError(
        "Planilha base de recebidas ausente.",
        "Nao foi possivel ler a base de Recebidas. Confirme o envio do arquivo correto.",
      );
    }

    const rows: RecebidaRow[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const parsed: RecebidaRow = {
        linhaOrigem: rowNumber,
        codigo: coerceString(row.getCell("A").value),
        nomeFantasia: coerceString(row.getCell("B").value),
        cpfCnpj: coerceString(row.getCell("C").value),
        grupoEmpresa: coerceString(row.getCell("D").value),
        empresa: coerceString(row.getCell("E").value),
        dataCredito: coerceDate(row.getCell("K").value),
        dataVencimento: coerceDate(row.getCell("M").value),
        imposto: coerceNumber(row.getCell("R").value),
        titulo: coerceNumber(row.getCell("S").value),
        dataPagamento: coerceDate(row.getCell("U").value),
        valorPagamento: coerceNumber(row.getCell("Y").value),
        tarifa: coerceNumber(row.getCell("Z").value),
        tipoParcela: coerceString(row.getCell("AA").value),
        tipoRecebimento: coerceString(row.getCell("AB").value),
        tipoPagamento: coerceString(row.getCell("AC").value),
        parcela: coerceString(row.getCell("AE").value),
        loteNf: coerceString(row.getCell("AG").value),
        nf: coerceString(row.getCell("AH").value),
        dtEmissao: coerceDate(row.getCell("AI").value),
        pessoaTipo: resolvePessoaTipo(coerceString(row.getCell("C").value)),
      };

      if (!isValidRow(parsed)) continue;
      rows.push(parsed);
    }

    if (rows.length === 0) {
      throw new ContraprestacoesError(
        "Base de recebidas sem registros validos.",
        "Nenhum registro valido foi encontrado no arquivo de Recebidas.",
      );
    }

    return rows;
  }
}
