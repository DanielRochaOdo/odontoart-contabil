import ExcelJS from "exceljs";
import { EventosError } from "@/features/eventos/domain/errors";
import { RawEvento } from "@/features/eventos/domain/types";
import {
  coerceDate,
  coerceNumber,
  coerceString,
  normalizeText,
} from "@/features/eventos/services/utils";

type HeaderMap = Record<string, number>;

function normalizeHeader(value: string): string {
  return normalizeText(value).replace(/[^\w]/g, "");
}

function findColumn(headers: HeaderMap, aliases: string[]): number {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (headers[key] !== undefined) return headers[key];
  }
  return -1;
}

function isValidLote(value: string): boolean {
  return /^\d+$/.test(value);
}

function readHeaders(worksheet: ExcelJS.Worksheet, rowNumber: number): HeaderMap {
  const row = worksheet.getRow(rowNumber);
  const headers: HeaderMap = {};
  for (let col = 1; col <= worksheet.columnCount; col += 1) {
    const raw = coerceString(row.getCell(col).value);
    if (!raw) continue;
    headers[normalizeHeader(raw)] = col;
  }
  return headers;
}

function resolveWorksheet(workbook: ExcelJS.Workbook): {
  worksheet: ExcelJS.Worksheet;
  headerRow: number;
  headers: HeaderMap;
} {
  const requiredAliases = [
    ["Lote"],
    ["Modelo", "Modelo de Pagamento"],
    ["Valor Bruto (=)", "VL. BRUTO", "Valor Bruto"],
  ];

  for (const worksheet of workbook.worksheets) {
    for (let row = 1; row <= Math.min(20, worksheet.rowCount); row += 1) {
      const headers = readHeaders(worksheet, row);
      const ok = requiredAliases.every((aliases) => findColumn(headers, aliases) > 0);
      if (ok) {
        return { worksheet, headerRow: row, headers };
      }
    }
  }

  throw new EventosError(
    "Nao foi possivel identificar cabecalho da planilha base.",
    'Não conseguimos ler o arquivo. Verifique se ele contém as colunas "Lote", "Modelo" e "Valor Bruto".',
  );
}

export class RawWorkbookParser {
  async parse(buffer: Buffer): Promise<RawEvento[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const { worksheet, headerRow, headers } = resolveWorksheet(workbook);

    const loteCol = findColumn(headers, ["Lote"]);
    const codigoCol = findColumn(headers, ["Código", "Codigo"]);
    const nomeCol = findColumn(headers, [
      "Prestador",
      "Nome Titular",
      "NOME-PRESTADOR",
      "Nome",
    ]);
    const cpfCol = findColumn(headers, ["CPF/CNPJ", "CNPJ/CPF"]);
    const modeloCol = findColumn(headers, ["Modelo", "Modelo de Pagamento"]);
    const bancoCol = findColumn(headers, ["Banco"]);
    const dataPagamentoCol = findColumn(headers, ["Data Pagamento", "DT. PAGTO"]);
    const dataConhecimentoCol = findColumn(headers, [
      "Data Conhecimento",
      "DT. OCORR",
      "DT. AVISO",
    ]);
    const dataGeradoCol = findColumn(headers, ["Data Gerado"]);
    const valorBrutoCol = findColumn(headers, ["Valor Bruto (=)", "VL. BRUTO"]);
    const inssCol = findColumn(headers, ["INSS (-)", "INSS"]);
    const issCol = findColumn(headers, ["ISS (-)", "ISS"]);
    const irCol = findColumn(headers, ["IR (-)", "IR"]);
    const pisCol = findColumn(headers, ["PIS (-)", "PIS"]);
    const cofinsCol = findColumn(headers, ["COFINS (-)", "COFINS"]);
    const csllCol = findColumn(headers, ["CSLL (-)", "CSLL"]);
    const liquidoCol = findColumn(headers, ["Líquido (=)", "LIQUIDO"]);
    const valorPagoCol = findColumn(headers, ["Valor Pago", "TOTAL PAGO", "VL PAGO"]);
    const empresarialCol = findColumn(headers, ["Empresarial"]);
    const individualCol = findColumn(headers, ["Individual"]);
    const ortodontiaCol = findColumn(headers, ["Ortodontia", "ORTODONTIA"]);

    const eventos: RawEvento[] = [];

    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const lote = coerceString(row.getCell(loteCol).value);
      if (!isValidLote(lote)) continue;

      eventos.push({
        lote,
        codigo: codigoCol > 0 ? coerceString(row.getCell(codigoCol).value) : "",
        nomePrestador: nomeCol > 0 ? coerceString(row.getCell(nomeCol).value) : "",
        cpfCnpj: cpfCol > 0 ? coerceString(row.getCell(cpfCol).value) : "",
        modeloPagamento: modeloCol > 0 ? coerceString(row.getCell(modeloCol).value) : "",
        banco: bancoCol > 0 ? coerceString(row.getCell(bancoCol).value) : "",
        dataPagamento:
          dataPagamentoCol > 0 ? coerceDate(row.getCell(dataPagamentoCol).value) : null,
        dataConhecimento:
          dataConhecimentoCol > 0 ? coerceDate(row.getCell(dataConhecimentoCol).value) : null,
        dataGerado: dataGeradoCol > 0 ? coerceDate(row.getCell(dataGeradoCol).value) : null,
        valorBruto: valorBrutoCol > 0 ? coerceNumber(row.getCell(valorBrutoCol).value) : 0,
        inss: inssCol > 0 ? coerceNumber(row.getCell(inssCol).value) : 0,
        iss: issCol > 0 ? coerceNumber(row.getCell(issCol).value) : 0,
        ir: irCol > 0 ? coerceNumber(row.getCell(irCol).value) : 0,
        pis: pisCol > 0 ? coerceNumber(row.getCell(pisCol).value) : 0,
        cofins: cofinsCol > 0 ? coerceNumber(row.getCell(cofinsCol).value) : 0,
        csll: csllCol > 0 ? coerceNumber(row.getCell(csllCol).value) : 0,
        liquido: liquidoCol > 0 ? coerceNumber(row.getCell(liquidoCol).value) : 0,
        totalPago: valorPagoCol > 0 ? coerceNumber(row.getCell(valorPagoCol).value) : 0,
        empresarial:
          empresarialCol > 0 ? coerceNumber(row.getCell(empresarialCol).value) : 0,
        individual: individualCol > 0 ? coerceNumber(row.getCell(individualCol).value) : 0,
        ortodontia: ortodontiaCol > 0 ? coerceNumber(row.getCell(ortodontiaCol).value) : 0,
      });
    }

    if (eventos.length === 0) {
      throw new EventosError(
        "Planilha sem registros validos.",
        "Não encontramos registros de eventos para processar nesse arquivo.",
      );
    }

    return eventos;
  }
}
