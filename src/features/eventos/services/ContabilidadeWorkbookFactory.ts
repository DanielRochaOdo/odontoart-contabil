import ExcelJS from "exceljs";
import { ALIQ_5952, CODIGO_5952 } from "@/features/eventos/domain/constants";
import { Competencia, EventoClassificado, ProcessResult } from "@/features/eventos/domain/types";
import {
  competenciaToString,
  firstDayOfMonth,
  firstDayOfPreviousMonth,
  isSameYearMonth,
  lastDayOfMonth,
} from "@/features/eventos/services/utils";

interface BuildInput {
  conhecidos: EventoClassificado[];
  liquidados: EventoClassificado[];
  competencia: Competencia;
}

const DATE_FORMAT = "dd/mm/yyyy";
const MONEY_FORMAT = "#,##0.00";
const MONTH_YEAR_FORMAT = "mm/yyyy";
const FINANCIAL_FORMAT = '"R$" #,##0.00';
const PERCENT_FORMAT = "0.00%";

function sortByLote(data: EventoClassificado[]): EventoClassificado[] {
  return [...data].sort((a, b) => Number(a.lote) - Number(b.lote));
}

function getValorBaseProcedimento(evento: EventoClassificado): number {
  return evento.valorBruto;
}

function splitBySegmentoTipo(data: EventoClassificado[]) {
  return {
    clinicoPf: data.filter((x) => x.segmento === "CLINICO" && x.tipoPessoa === "PF"),
    clinicoPj: data.filter((x) => x.segmento === "CLINICO" && x.tipoPessoa === "PJ"),
    ortoPf: data.filter((x) => x.segmento === "ORTO" && x.tipoPessoa === "PF"),
    ortoPj: data.filter((x) => x.segmento === "ORTO" && x.tipoPessoa === "PJ"),
  };
}

function setSheetBaseStyle(sheet: ExcelJS.Worksheet): void {
  sheet.getRow(1).font = { name: "Calibri", bold: true, size: 12 };
  sheet.getRow(2).font = { name: "Calibri", size: 10 };
  sheet.getRow(3).font = { name: "Calibri", bold: true, size: 10 };

  for (let c = 1; c <= sheet.columnCount; c += 1) {
    sheet.getRow(3).getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF2F2F2" },
    };
  }
}

function formatDataRow(
  row: ExcelJS.Row,
  dateCols: number[],
  moneyCols: number[],
  monthYearCols: number[] = [],
) {
  dateCols.forEach((col) => {
    row.getCell(col).numFmt = DATE_FORMAT;
  });
  moneyCols.forEach((col) => {
    row.getCell(col).numFmt = MONEY_FORMAT;
  });
  monthYearCols.forEach((col) => {
    row.getCell(col).numFmt = MONTH_YEAR_FORMAT;
  });
}

function applyFinancialFormat(row: ExcelJS.Row, columns: string[]): void {
  columns.forEach((column) => {
    row.getCell(column).numFmt = FINANCIAL_FORMAT;
  });
}

function displayMonthYearPtBr(competencia: Competencia): string {
  const date = new Date(competencia.ano, competencia.mes - 1, 1);
  return date
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace("/", " ")
    .toUpperCase();
}

export class ContabilidadeWorkbookFactory {
  async build(input: BuildInput): Promise<ProcessResult["arquivos"]> {
    const groupsConhecidos = splitBySegmentoTipo(input.conhecidos);
    const groupsLiquidados = splitBySegmentoTipo(input.liquidados);

    const conhecidoClinico = await this.buildConhecidoClinicoWorkbook(
      groupsConhecidos.clinicoPf,
      groupsConhecidos.clinicoPj,
      input.competencia,
    );
    const conhecidoOrto = await this.buildConhecidoOrtoWorkbook(
      groupsConhecidos.ortoPf,
      groupsConhecidos.ortoPj,
      input.competencia,
    );
    const liquidadoClinico = await this.buildLiquidadoClinicoWorkbook(
      [...groupsLiquidados.clinicoPf, ...groupsLiquidados.clinicoPj],
      input.competencia,
    );
    const liquidadoOrto = await this.buildLiquidadoOrtoWorkbook(
      [...groupsLiquidados.ortoPf, ...groupsLiquidados.ortoPj],
      input.competencia,
    );

    const competenciaToken = competenciaToString(input.competencia);
    return [
      {
        nome: `EVENTOS CONHECIDOS - ${competenciaToken}.xlsx`,
        conteudo: conhecidoClinico,
      },
      {
        nome: `EVENTOS CONHECIDOS - ${competenciaToken} - Ortodontia.xlsx`,
        conteudo: conhecidoOrto,
      },
      {
        nome: `EVENTOS LIQUIDADOS - ${competenciaToken}.xlsx`,
        conteudo: liquidadoClinico,
      },
      {
        nome: `EVENTOS LIQUIDADOS - ${competenciaToken} - Ortodontia.xlsx`,
        conteudo: liquidadoOrto,
      },
    ];
  }

  private async buildConhecidoClinicoWorkbook(
    pfRows: EventoClassificado[],
    pjRows: EventoClassificado[],
    competencia: Competencia,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    this.fillConhecidoClinicoSheet(workbook.addWorksheet("Eventos Conhecidos - PF"), pfRows, competencia);
    this.fillConhecidoClinicoSheet(workbook.addWorksheet("Eventos Conhecidos - PJ"), pjRows, competencia);
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  private fillConhecidoClinicoSheet(
    sheet: ExcelJS.Worksheet,
    rows: EventoClassificado[],
    competencia: Competencia,
  ) {
    const monthLabel = displayMonthYearPtBr(competencia).replace(" DE ", ".");
    sheet.getCell("A1").value = `ODONTOART - EVENTOS CONHECIDOS - ${monthLabel}`;
    sheet.getCell("A2").value =
      "CRUZAR COM CONHECIDOS DO MÊS ANTERIOR/EXTERNO: MÊS EVENTO, MÊS ANTERIOR EVENTO, MÊS EVENTO  / INTERNO: MÊS EVENTO,MÊS EVENTO,MÊS EVENTO (ODONTOMOVEL É INTERNO)";

    const headers = [
      "COMP",
      "DT. OCORR",
      "DT. AVISO",
      "CODIGO",
      "LOTE",
      "NOME-PRESTADOR",
      "Tipo",
      "CNPJ/CPF",
      "Modelo de Pagamento",
      "Empresarial",
      "Individual",
      "Ortodontia",
      "VL. BRUTO",
      "INSS",
      "ISS",
      "IR",
      "LIQUIDO",
      "LIQUIDO AGING",
      "TOTAL PAGO",
      "DT. PAGTO",
      "",
      "Aliq.",
      "",
    ];
    sheet.getRow(3).values = headers;

    sheet.columns = [
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 10 },
      { width: 10 },
      { width: 52 },
      { width: 8 },
      { width: 20 },
      { width: 42 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 10 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 11 },
      { width: 14 },
      { width: 8 },
      { width: 8 },
    ];
    sheet.getColumn("L").hidden = true;

    setSheetBaseStyle(sheet);

    const compDate = firstDayOfMonth(competencia);
    const prevMonth = firstDayOfPreviousMonth(competencia);
    const pagtoDate = lastDayOfMonth(competencia);

    const baseRow = 4;
    rows.forEach((evento, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const dtOcorr =
        evento.segmento === "ORTO"
          ? prevMonth
          : evento.tipoPagamento === "EXTERNO"
            ? prevMonth
            : compDate;
      const totalPago = evento.totalPago || evento.liquido;
      const vlBruto = getValorBaseProcedimento(evento);

      row.getCell("A").value = compDate;
      row.getCell("B").value = dtOcorr;
      row.getCell("C").value = compDate;
      row.getCell("D").value = Number(evento.codigo) || evento.codigo;
      row.getCell("E").value = Number(evento.lote);
      row.getCell("F").value = evento.nomePrestador;
      row.getCell("G").value = evento.tipoPessoa;
      row.getCell("H").value = evento.cpfCnpj;
      row.getCell("I").value = evento.modeloPagamento;
      row.getCell("J").value = evento.empresarial;
      row.getCell("K").value = evento.individual;
      row.getCell("L").value = evento.ortodontia;
      row.getCell("M").value = vlBruto;
      row.getCell("N").value = evento.inss;
      row.getCell("O").value = evento.iss;
      row.getCell("P").value = evento.ir;
      row.getCell("Q").value = totalPago;
      row.getCell("R").value = { formula: `M${rowNumber}-N${rowNumber}-O${rowNumber}` };
      row.getCell("S").value = { formula: `Q${rowNumber}` };
      row.getCell("T").value = pagtoDate;
      row.getCell("U").value = {
        formula: `M${rowNumber}-N${rowNumber}-O${rowNumber}-P${rowNumber}-Q${rowNumber}`,
      };
      if (evento.tipoPessoa === "PF") {
        row.getCell("V").value = CODIGO_5952;
        row.getCell("W").value = ALIQ_5952;
      }

      formatDataRow(
        row,
        [1, 2, 3, 20],
        [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21],
        [1, 2, 3],
      );
      row.getCell("J").numFmt = FINANCIAL_FORMAT;
      row.getCell("K").numFmt = FINANCIAL_FORMAT;
      row.getCell("L").numFmt = FINANCIAL_FORMAT;
      row.getCell("M").numFmt = FINANCIAL_FORMAT;
      row.getCell("N").numFmt = FINANCIAL_FORMAT;
      row.getCell("O").numFmt = FINANCIAL_FORMAT;
      row.getCell("P").numFmt = FINANCIAL_FORMAT;
      row.getCell("Q").numFmt = FINANCIAL_FORMAT;
      row.getCell("R").numFmt = FINANCIAL_FORMAT;
      row.getCell("S").numFmt = FINANCIAL_FORMAT;
      row.getCell("U").numFmt = FINANCIAL_FORMAT;
      row.getCell("W").numFmt = PERCENT_FORMAT;
    });

    const totalRowNumber = baseRow + rows.length;
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.getCell("A").value = "TOTAL";
    totalRow.getCell("J").value = { formula: `SUM(J4:J${totalRowNumber - 1})` };
    totalRow.getCell("K").value = { formula: `SUM(K4:K${totalRowNumber - 1})` };
    totalRow.getCell("L").value = { formula: `SUM(L4:L${totalRowNumber - 1})` };
    totalRow.getCell("M").value = { formula: `SUM(M4:M${totalRowNumber - 1})` };
    totalRow.getCell("N").value = { formula: `SUM(N4:N${totalRowNumber - 1})` };
    totalRow.getCell("O").value = { formula: `SUM(O4:O${totalRowNumber - 1})` };
    totalRow.getCell("P").value = { formula: `SUM(P4:P${totalRowNumber - 1})` };
    totalRow.getCell("Q").value = { formula: `SUM(Q4:Q${totalRowNumber - 1})` };
    totalRow.getCell("R").value = { formula: `SUM(R4:R${totalRowNumber - 1})` };
    totalRow.getCell("S").value = { formula: `SUM(S4:S${totalRowNumber - 1})` };
    applyFinancialFormat(totalRow, ["J", "K", "L", "M", "N", "O", "P", "Q", "R", "S"]);
    totalRow.font = { name: "Calibri", bold: true };
  }

  private async buildConhecidoOrtoWorkbook(
    pfRows: EventoClassificado[],
    pjRows: EventoClassificado[],
    competencia: Competencia,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    this.fillConhecidoOrtoSheet(workbook.addWorksheet("Eventos Conhecidos - PF"), pfRows, competencia);
    this.fillConhecidoOrtoSheet(workbook.addWorksheet("Eventos Conhecidos - PJ"), pjRows, competencia);
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  private fillConhecidoOrtoSheet(
    sheet: ExcelJS.Worksheet,
    rows: EventoClassificado[],
    competencia: Competencia,
  ) {
    const monthLabel = displayMonthYearPtBr(competencia).replace(" DE ", ".");
    sheet.getCell("A1").value = `ODONTOART - EVENTOS CONHECIDOS ORTODONTIA - ${monthLabel}`;
    sheet.getCell("A2").value =
      "CRUZAR COM CONHECIDOS DO MÊS ANTERIOR/ORTO: MÊS EVENTO, MÊS ANTERIOR EVENTO, MÊS EVENTO";
    sheet.getRow(3).values = [
      "COMP",
      "DT. OCORR",
      "DT. AVISO",
      "CODIGO",
      "LOTE",
      "NOME-PRESTADOR",
      "Tipo",
      "CNPJ/CPF",
      "DOCUMENTO",
      "N. DOC",
      "EMISSÃO",
      "VENCIMENTO",
      "REGISTRO",
      "Modelo de Pagamento",
      "Empresarial",
      "Individual",
      "Ortodontia",
      "VL. BRUTO",
      "INSS",
      "ISS",
      "IR",
      "LIQUIDO",
      "LIQUIDO AGING",
      "TOTAL PAGO",
      "DT. PAGTO",
      "",
      "Aliq",
      "",
    ];

    sheet.columns = [
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 10 },
      { width: 10 },
      { width: 55 },
      { width: 8 },
      { width: 20 },
      { width: 14 },
      { width: 10 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 42 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 10 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 11 },
      { width: 14 },
      { width: 8 },
      { width: 8 },
    ];
    ["I", "J", "K", "L", "M", "O", "P"].forEach((column) => {
      sheet.getColumn(column).hidden = true;
    });
    setSheetBaseStyle(sheet);

    const compDate = firstDayOfMonth(competencia);
    const prevMonth = firstDayOfPreviousMonth(competencia);
    const pagtoDate = lastDayOfMonth(competencia);

    const baseRow = 4;
    rows.forEach((evento, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const totalPago = evento.totalPago || evento.liquido;
      const vlBruto = getValorBaseProcedimento(evento);

      row.getCell("A").value = compDate;
      row.getCell("B").value = prevMonth;
      row.getCell("C").value = compDate;
      row.getCell("D").value = Number(evento.codigo) || evento.codigo;
      row.getCell("E").value = Number(evento.lote);
      row.getCell("F").value = evento.nomePrestador;
      row.getCell("G").value = evento.tipoPessoa;
      row.getCell("H").value = evento.cpfCnpj;
      row.getCell("N").value = evento.modeloPagamento;
      row.getCell("O").value = evento.empresarial;
      row.getCell("P").value = evento.individual;
      row.getCell("Q").value = vlBruto;
      row.getCell("R").value = vlBruto;
      row.getCell("S").value = evento.inss;
      row.getCell("T").value = evento.iss;
      row.getCell("U").value = evento.ir;
      row.getCell("V").value = totalPago;
      row.getCell("W").value = { formula: `R${rowNumber}-S${rowNumber}-T${rowNumber}` };
      row.getCell("X").value = { formula: `V${rowNumber}` };
      row.getCell("Y").value = pagtoDate;
      row.getCell("Z").value = {
        formula: `R${rowNumber}-S${rowNumber}-T${rowNumber}-U${rowNumber}-V${rowNumber}`,
      };
      if (evento.tipoPessoa === "PF") {
        row.getCell("AA").value = CODIGO_5952;
        row.getCell("AB").value = ALIQ_5952;
      }

      formatDataRow(
        row,
        [1, 2, 3, 25],
        [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28],
        [1, 2, 3],
      );
      applyFinancialFormat(row, ["Q", "R", "S", "T", "U", "V", "W", "X"]);
    });

    const totalRowNumber = baseRow + rows.length;
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.getCell("A").value = "TOTAL";
    totalRow.getCell("Q").value = { formula: `SUM(Q4:Q${totalRowNumber - 1})` };
    totalRow.getCell("R").value = { formula: `SUM(R4:R${totalRowNumber - 1})` };
    totalRow.getCell("S").value = { formula: `SUM(S4:S${totalRowNumber - 1})` };
    totalRow.getCell("T").value = { formula: `SUM(T4:T${totalRowNumber - 1})` };
    totalRow.getCell("U").value = { formula: `SUM(U4:U${totalRowNumber - 1})` };
    totalRow.getCell("V").value = { formula: `SUM(V4:V${totalRowNumber - 1})` };
    totalRow.getCell("W").value = { formula: `SUM(W4:W${totalRowNumber - 1})` };
    totalRow.getCell("X").value = { formula: `SUM(X4:X${totalRowNumber - 1})` };
    applyFinancialFormat(totalRow, ["Q", "R", "S", "T", "U", "V", "W", "X"]);
    totalRow.font = { name: "Calibri", bold: true };
  }

  private async buildLiquidadoClinicoWorkbook(
    rows: EventoClassificado[],
    competencia: Competencia,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Eventos Liquidados");
    this.fillLiquidadoClinicoSheet(sheet, rows, competencia);
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  private fillLiquidadoClinicoSheet(
    sheet: ExcelJS.Worksheet,
    rows: EventoClassificado[],
    competencia: Competencia,
  ) {
    const monthLabel = displayMonthYearPtBr(competencia);
    sheet.getCell("A1").value = `ODONTOART - EVENTOS LIQUIDADOS  -  ${monthLabel}`;
    sheet.getCell("A2").value = "Cruzar com os Eventos Cancelados";
    sheet.getRow(3).values = [
      "COMP",
      "DT. AVISO",
      "CODIGO",
      "LOTE",
      "NOME-PRESTADOR                                         (TITULAR)",
      "Modelo de Pagamento",
      "PF/PJ",
      "CNPJ/CPF",
      "EMPRESARIAL",
      "INDIVIDUAL",
      "ORTODONTIA",
      "CNPJ/CPF",
      "DOCUMENTO",
      "N. DOC",
      "EMISSÃO",
      "VENCIMENTO",
      "REGISTRO",
      "VL. BRUTO",
      "DESCONTO",
      "ACRESCIMO",
      "PIS",
      "COFINS",
      "CSLL",
      "INSS",
      "ISS",
      "IR",
      "VL PAGO",
      "LIQUIDO AGING",
      "5952",
      "DT. PAGTO",
      "BANCO",
      "",
    ];
    sheet.columns = new Array(32).fill({ width: 12 });
    sheet.getColumn("E").width = 58;
    sheet.getColumn("F").width = 42;
    sheet.getColumn("H").width = 20;
    sheet.getColumn("AE").width = 34;
    ["K", "L", "M", "N", "O", "P", "Q", "S", "T"].forEach((col) => {
      sheet.getColumn(col).hidden = true;
    });
    setSheetBaseStyle(sheet);

    const defaultComp = firstDayOfMonth(competencia);
    const defaultPay = lastDayOfMonth(competencia);

    const baseRow = 4;
    rows.forEach((evento, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const compDate =
        evento.dataConhecimento && isSameYearMonth(evento.dataConhecimento, competencia)
          ? evento.dataConhecimento
          : defaultComp;
      const dataPagamento = evento.dataPagamento ?? defaultPay;
      const vlPago = evento.totalPago || evento.liquido;

      row.getCell("A").value = compDate;
      row.getCell("B").value = compDate;
      row.getCell("C").value = Number(evento.codigo) || evento.codigo;
      row.getCell("D").value = Number(evento.lote);
      row.getCell("E").value = evento.nomePrestador;
      row.getCell("F").value = evento.modeloPagamento;
      row.getCell("G").value = evento.tipoPessoa;
      row.getCell("H").value = evento.cpfCnpj;
      row.getCell("I").value = evento.empresarial;
      row.getCell("J").value = evento.individual;
      row.getCell("K").value = evento.ortodontia;
      row.getCell("R").value = getValorBaseProcedimento(evento);
      row.getCell("S").value = 0;
      row.getCell("T").value = 0;
      row.getCell("U").value = evento.pis;
      row.getCell("V").value = evento.cofins;
      row.getCell("W").value = evento.csll;
      row.getCell("X").value = evento.inss;
      row.getCell("Y").value = evento.iss;
      row.getCell("Z").value = evento.ir;
      row.getCell("AA").value = vlPago;
      row.getCell("AB").value = { formula: `R${rowNumber}-X${rowNumber}-Y${rowNumber}` };
      row.getCell("AC").value = { formula: `U${rowNumber}+V${rowNumber}+W${rowNumber}` };
      row.getCell("AD").value = dataPagamento;
      row.getCell("AE").value = evento.banco;
      row.getCell("AF").value = {
        formula: `R${rowNumber}-S${rowNumber}+T${rowNumber}-U${rowNumber}-V${rowNumber}-W${rowNumber}-X${rowNumber}-Y${rowNumber}-Z${rowNumber}-AA${rowNumber}`,
      };

      formatDataRow(
        row,
        [1, 2, 30],
        [9, 10, 11, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32],
        [1, 2],
      );
      row.getCell("C").numFmt = MONTH_YEAR_FORMAT;
      applyFinancialFormat(row, [
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
        "AA",
        "AB",
        "AC",
      ]);
    });

    const totalRowNumber = baseRow + rows.length;
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.getCell("A").value = "TOTAL";
    for (const column of [
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      "AA",
      "AB",
      "AC",
    ]) {
      totalRow.getCell(column).value = {
        formula: `SUM(${column}4:${column}${totalRowNumber - 1})`,
      };
    }
    applyFinancialFormat(totalRow, [
      "I",
      "J",
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      "AA",
      "AB",
      "AC",
    ]);
    totalRow.font = { name: "Calibri", bold: true };
  }

  private async buildLiquidadoOrtoWorkbook(
    rows: EventoClassificado[],
    competencia: Competencia,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Eventos Liquidados");
    this.fillLiquidadoOrtoSheet(sheet, rows, competencia);
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  private fillLiquidadoOrtoSheet(
    sheet: ExcelJS.Worksheet,
    rows: EventoClassificado[],
    competencia: Competencia,
  ) {
    const monthLabel = displayMonthYearPtBr(competencia);
    sheet.getCell("A1").value = `ODONTOART - EVENTOS LIQUIDADOS ORTODONTIA  -  ${monthLabel}`;
    sheet.getCell("A2").value = "Cruzar com os Eventos Cancelados";
    sheet.getRow(3).values = [
      "COMP",
      "DT. AVISO",
      "CODIGO",
      "LOTE",
      "NOME-PRESTADOR                                              (TITULAR)",
      "Modelo de Pagamento",
      "PF/PJ",
      "CNPJ/CPF",
      "EMPRESARIAL",
      "INDIVIDUAL",
      "ORTODONTIA",
      "CNPJ/CPF",
      "DOCUMENTO",
      "N. DOC",
      "EMISSÃO",
      "VENCIMENTO",
      "REGISTRO",
      "VL. BRUTO",
      "PIS",
      "COFINS",
      "CSLL",
      "INSS",
      "ISS",
      "IR",
      "VL PAGO",
      "LIQUIDO AGING",
      "5952",
      "DT. PAGTO",
      "BANCO",
      "",
    ];
    sheet.columns = new Array(30).fill({ width: 12 });
    sheet.getColumn("E").width = 58;
    sheet.getColumn("F").width = 42;
    sheet.getColumn("H").width = 20;
    sheet.getColumn("AC").width = 34;
    ["I", "J", "L", "M", "N", "O", "P"].forEach((col) => {
      sheet.getColumn(col).hidden = true;
    });
    setSheetBaseStyle(sheet);

    const defaultComp = firstDayOfMonth(competencia);
    const defaultPay = lastDayOfMonth(competencia);
    const baseRow = 4;

    rows.forEach((evento, index) => {
      const rowNumber = baseRow + index;
      const row = sheet.getRow(rowNumber);
      const compDate =
        evento.dataConhecimento && isSameYearMonth(evento.dataConhecimento, competencia)
          ? evento.dataConhecimento
          : defaultComp;
      const dataPagamento = evento.dataPagamento ?? defaultPay;
      const vlBruto = getValorBaseProcedimento(evento);
      const vlPago = evento.totalPago || evento.liquido;

      row.getCell("A").value = compDate;
      row.getCell("B").value = compDate;
      row.getCell("C").value = Number(evento.codigo) || evento.codigo;
      row.getCell("D").value = Number(evento.lote);
      row.getCell("E").value = evento.nomePrestador;
      row.getCell("F").value = evento.modeloPagamento;
      row.getCell("G").value = evento.tipoPessoa;
      row.getCell("H").value = evento.cpfCnpj;
      row.getCell("K").value = vlBruto;
      row.getCell("R").value = vlBruto;
      row.getCell("S").value = evento.pis;
      row.getCell("T").value = evento.cofins;
      row.getCell("U").value = evento.csll;
      row.getCell("V").value = evento.inss;
      row.getCell("W").value = evento.iss;
      row.getCell("X").value = evento.ir;
      row.getCell("Y").value = vlPago;
      row.getCell("Z").value = { formula: `R${rowNumber}-V${rowNumber}-W${rowNumber}` };
      row.getCell("AA").value = { formula: `S${rowNumber}+T${rowNumber}+U${rowNumber}` };
      row.getCell("AB").value = dataPagamento;
      row.getCell("AC").value = evento.banco;
      row.getCell("AD").value = {
        formula: `R${rowNumber}-S${rowNumber}-T${rowNumber}-U${rowNumber}-V${rowNumber}-W${rowNumber}-X${rowNumber}-Y${rowNumber}`,
      };

      formatDataRow(
        row,
        [1, 2, 28],
        [11, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30],
        [1, 2],
      );
      row.getCell("C").numFmt = MONTH_YEAR_FORMAT;
      applyFinancialFormat(row, [
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
        "AA",
      ]);
    });

    const totalRowNumber = baseRow + rows.length;
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.getCell("A").value = "TOTAL";
    totalRow.getCell("K").value = { formula: `SUM(K4:Q${totalRowNumber - 1})` };
    for (const column of ["R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA"]) {
      totalRow.getCell(column).value = {
        formula: `SUM(${column}4:${column}${totalRowNumber - 1})`,
      };
    }
    applyFinancialFormat(totalRow, [
      "K",
      "L",
      "M",
      "N",
      "O",
      "P",
      "Q",
      "R",
      "S",
      "T",
      "U",
      "V",
      "W",
      "X",
      "Y",
      "Z",
      "AA",
    ]);
    totalRow.font = { name: "Calibri", bold: true };
  }
}
