import ExcelJS from "exceljs";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { PessoaTipo, RecebidaRow } from "@/features/contraprestacoes/domain/types";
import { coerceDate, coerceNumber, coerceString, normalizeText } from "@/features/eventos/services/utils";

function isCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11;
}

function resolvePessoaTipo(value: string): PessoaTipo {
  return isCpf(value) ? "PF" : "PJ";
}

function isValidRow(row: RecebidaRow): boolean {
  return Boolean(row.codigo || row.nomeFantasia || row.parcela || row.nf) && row.valorPagamento > 0;
}

type ParsedColumns = {
  codigo: number;
  nomeFantasia: number;
  cpfCnpj: number;
  grupoEmpresa: number;
  empresa: number;
  dataCredito: number;
  dataVencimento: number;
  imposto: number;
  titulo: number;
  dataPagamento: number;
  valorPagamento: number;
  tarifa: number;
  tipoParcela: number;
  tipoRecebimento: number;
  tipoPagamento: number;
  parcela: number;
  loteNf: number;
  nf: number;
  dtEmissao: number;
};

function isDecorativeReportRow(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  const firstCell = normalizeText(coerceString(worksheet.getRow(rowNumber).getCell(1).value));
  return firstCell.startsWith("RELATORIO FATURADO") && firstCell.includes("PERIODO");
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): number {
  for (let rowNumber = 1; rowNumber <= Math.min(10, worksheet.rowCount); rowNumber += 1) {
    if (isDecorativeReportRow(worksheet, rowNumber)) continue;

    const row = worksheet.getRow(rowNumber);
    const values = Array.from({ length: Math.max(worksheet.actualColumnCount, worksheet.columnCount) }, (_, index) =>
      normalizeText(coerceString(row.getCell(index + 1).value)),
    );
    if (values.includes("CODIGO") && values.includes("VALOR PAGAMENTO")) {
      return rowNumber;
    }
  }

  throw new ContraprestacoesError(
    "Cabecalho da base de recebidas nao encontrado.",
    "Nao foi possivel identificar as colunas da base de Recebidas.",
  );
}

function findColumnIndex(worksheet: ExcelJS.Worksheet, headerRowNumber: number, aliases: string[]): number {
  const wanted = aliases.map((alias) => normalizeText(alias));
  const headerRow = worksheet.getRow(headerRowNumber);
  const maxColumns = Math.max(worksheet.actualColumnCount, worksheet.columnCount);

  for (let column = 1; column <= maxColumns; column += 1) {
    const current = normalizeText(coerceString(headerRow.getCell(column).value));
    if (wanted.includes(current)) return column;
  }

  throw new ContraprestacoesError(
    `Coluna obrigatoria nao encontrada: ${aliases[0]}.`,
    "A base de Recebidas possui um layout diferente do esperado.",
  );
}

function resolveColumns(worksheet: ExcelJS.Worksheet, headerRowNumber: number): ParsedColumns {
  return {
    codigo: findColumnIndex(worksheet, headerRowNumber, ["Código", "Codigo"]),
    nomeFantasia: findColumnIndex(worksheet, headerRowNumber, ["Nome Fantasia"]),
    cpfCnpj: findColumnIndex(worksheet, headerRowNumber, ["CPF_CNPJ", "CPF/CNPJ"]),
    grupoEmpresa: findColumnIndex(worksheet, headerRowNumber, ["Grupo Empresa"]),
    empresa: findColumnIndex(worksheet, headerRowNumber, ["Empresa"]),
    dataCredito: findColumnIndex(worksheet, headerRowNumber, ["Data Credito", "Data Crédito"]),
    dataVencimento: findColumnIndex(worksheet, headerRowNumber, ["Data Vencimento"]),
    imposto: findColumnIndex(worksheet, headerRowNumber, ["Imposto"]),
    titulo: findColumnIndex(worksheet, headerRowNumber, ["Título", "Titulo"]),
    dataPagamento: findColumnIndex(worksheet, headerRowNumber, ["Data Pagamento"]),
    valorPagamento: findColumnIndex(worksheet, headerRowNumber, ["Valor Pagamento"]),
    tarifa: findColumnIndex(worksheet, headerRowNumber, ["Tarifa"]),
    tipoParcela: findColumnIndex(worksheet, headerRowNumber, ["Tipo Parcela"]),
    tipoRecebimento: findColumnIndex(worksheet, headerRowNumber, ["Tipo Recebimento"]),
    tipoPagamento: findColumnIndex(worksheet, headerRowNumber, ["Tipo Pagamento"]),
    parcela: findColumnIndex(worksheet, headerRowNumber, ["Parcela"]),
    loteNf: findColumnIndex(worksheet, headerRowNumber, ["Lote NF"]),
    nf: findColumnIndex(worksheet, headerRowNumber, ["NF"]),
    dtEmissao: findColumnIndex(worksheet, headerRowNumber, ["Dt. Emissão", "Dt. Emissao"]),
  };
}

export class RecebidasWorkbookParser {
  async parse(fileBuffer: Uint8Array): Promise<RecebidaRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new ContraprestacoesError(
        "Planilha base de recebidas ausente.",
        "Nao foi possivel ler a base de Recebidas. Confirme o envio do arquivo correto.",
      );
    }

    const headerRowNumber = findHeaderRow(worksheet);
    const columns = resolveColumns(worksheet, headerRowNumber);

    const rows: RecebidaRow[] = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const parsed: RecebidaRow = {
        linhaOrigem: rowNumber,
        codigo: coerceString(row.getCell(columns.codigo).value),
        nomeFantasia: coerceString(row.getCell(columns.nomeFantasia).value),
        cpfCnpj: coerceString(row.getCell(columns.cpfCnpj).value),
        grupoEmpresa: coerceString(row.getCell(columns.grupoEmpresa).value),
        empresa: coerceString(row.getCell(columns.empresa).value),
        dataCredito: coerceDate(row.getCell(columns.dataCredito).value),
        dataVencimento: coerceDate(row.getCell(columns.dataVencimento).value),
        imposto: coerceNumber(row.getCell(columns.imposto).value),
        titulo: coerceNumber(row.getCell(columns.titulo).value),
        dataPagamento: coerceDate(row.getCell(columns.dataPagamento).value),
        valorPagamento: coerceNumber(row.getCell(columns.valorPagamento).value),
        tarifa: coerceNumber(row.getCell(columns.tarifa).value),
        tipoParcela: coerceString(row.getCell(columns.tipoParcela).value),
        tipoRecebimento: coerceString(row.getCell(columns.tipoRecebimento).value),
        tipoPagamento: coerceString(row.getCell(columns.tipoPagamento).value),
        parcela: coerceString(row.getCell(columns.parcela).value),
        loteNf: coerceString(row.getCell(columns.loteNf).value),
        nf: coerceString(row.getCell(columns.nf).value),
        dtEmissao: coerceDate(row.getCell(columns.dtEmissao).value),
        pessoaTipo: resolvePessoaTipo(coerceString(row.getCell(columns.cpfCnpj).value)),
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
