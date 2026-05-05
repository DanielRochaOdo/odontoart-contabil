import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface ImportedCanceladaRow {
  competencia: string;
  ano: number;
  mes: number;
  cpt: string;
  codigo: string;
  nome: string;
  emissao: string | null;
  vencimento: string | null;
  valor_emitido: number;
  numero_parc: string;
  numero_nf: string;
  origem: "IMPORTACAO";
}

export const runtime = "nodejs";

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null && "result" in value) {
    return asString((value as { result?: unknown }).result);
  }
  return String(value).trim();
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value !== null && "result" in value) {
    return asNumber((value as { result?: unknown }).result);
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + value * 86400000);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value !== null && "result" in value) {
    return asDate((value as { result?: unknown }).result);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const [, dd, mm, yyyy] = brMatch;
      return `${yyyy}-${mm}-${dd}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function parseCompetencia(value: string): { competencia: string; ano: number; mes: number } | null {
  const normalized = value.trim();
  const yyyyMm = normalized.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMm) {
    const ano = Number(yyyyMm[1]);
    const mes = Number(yyyyMm[2]);
    if (mes >= 1 && mes <= 12) {
      return { competencia: `${ano}-${String(mes).padStart(2, "0")}`, ano, mes };
    }
  }

  const mmYyyy = normalized.match(/^(\d{2})\.(\d{4})$/);
  if (mmYyyy) {
    const mes = Number(mmYyyy[1]);
    const ano = Number(mmYyyy[2]);
    if (mes >= 1 && mes <= 12) {
      return { competencia: `${ano}-${String(mes).padStart(2, "0")}`, ano, mes };
    }
  }

  return null;
}

function parseCompetenciaFromDate(value: string | null): { competencia: string; ano: number; mes: number } | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { competencia: `${ano}-${String(mes).padStart(2, "0")}`, ano, mes };
}

function resolveHeaderRow(worksheet: ExcelJS.Worksheet): number {
  const tokens = ["CPT", "CODIGO", "NOME", "EMISSAO", "VENCIMENTO", "VALOR EMITIDO", "PARC", "NF"];
  let bestRow = 1;
  let bestScore = -1;

  for (let rowNumber = 1; rowNumber <= Math.min(15, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = row.values as Array<string | number | null | undefined>;
    const normalizedHeaders = headers.map((item) => normalize(asString(item))).filter(Boolean);

    let score = normalizedHeaders.length;
    tokens.forEach((token) => {
      if (normalizedHeaders.some((header) => header.includes(token))) score += 3;
    });

    if (score > bestScore) {
      bestScore = score;
      bestRow = rowNumber;
    }
  }

  return bestRow;
}

function resolveColumnIndexMap(worksheet: ExcelJS.Worksheet, headerRow: number) {
  const row = worksheet.getRow(headerRow);
  const map = {
    cpt: 1,
    codigo: 2,
    nome: 3,
    emissao: 4,
    vencimento: 5,
    valorEmitido: 6,
    numeroParc: 7,
    numeroNf: 8,
  };

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const normalized = normalize(asString(cell.value));
    if (!normalized) return;

    if (normalized.includes("CPT") || normalized === "COMP") map.cpt = colNumber;
    else if (normalized.includes("CODIGO")) map.codigo = colNumber;
    else if (normalized === "NOME") map.nome = colNumber;
    else if (normalized.includes("EMISSAO")) map.emissao = colNumber;
    else if (normalized.includes("VENCIMENTO")) map.vencimento = colNumber;
    else if (normalized.includes("VALOR") && normalized.includes("EMITIDO")) map.valorEmitido = colNumber;
    else if (normalized.includes("PARC")) map.numeroParc = colNumber;
    else if (normalized.includes("NF")) map.numeroNf = colNumber;
  });

  return map;
}

function buildFriendlyErrorMessage(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes("invalid api key")) {
    return "Chave do Supabase invalida para o modulo Canceladas. Configure uma SERVICE_ROLE_KEY valida.";
  }
  if (message.includes("relation") && message.includes("contraprestacoes_canceladas_registros")) {
    return "Tabela de Canceladas nao encontrada. Rode as migrations do Supabase.";
  }
  return "Nao foi possivel importar a base de Canceladas agora.";
}

function parseRowsFromWorksheet(
  worksheet: ExcelJS.Worksheet,
  defaultCompetencia: { competencia: string; ano: number; mes: number } | null,
): ImportedCanceladaRow[] {
  const headerRow = resolveHeaderRow(worksheet);
  const columns = resolveColumnIndexMap(worksheet, headerRow);
  const rows: ImportedCanceladaRow[] = [];

  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const codigo = asString(row.getCell(columns.codigo).value);
    const nome = asString(row.getCell(columns.nome).value);
    const cpt = asString(row.getCell(columns.cpt).value);

    if (!codigo || !nome) continue;

    const emissao = asDate(row.getCell(columns.emissao).value);
    const vencimento = asDate(row.getCell(columns.vencimento).value);
    const competencia =
      parseCompetencia(cpt) ??
      parseCompetenciaFromDate(emissao) ??
      parseCompetenciaFromDate(vencimento) ??
      defaultCompetencia;

    if (!competencia) continue;

    rows.push({
      competencia: competencia.competencia,
      ano: competencia.ano,
      mes: competencia.mes,
      cpt: cpt || `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`,
      codigo,
      nome,
      emissao,
      vencimento,
      valor_emitido: asNumber(row.getCell(columns.valorEmitido).value),
      numero_parc: asString(row.getCell(columns.numeroParc).value),
      numero_nf: asString(row.getCell(columns.numeroNf).value),
      origem: "IMPORTACAO",
    });
  }

  return rows;
}

export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        message:
          "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY validos para importar Canceladas.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("arquivo");
  const competenciaRaw = asString(formData.get("competencia"));
  const defaultCompetencia = parseCompetencia(competenciaRaw);

  if (!(file instanceof File)) {
    return NextResponse.json(
      { message: "Envie o arquivo base de Canceladas (.xlsx)." },
      { status: 400 },
    );
  }

  if (!isXlsx(file)) {
    return NextResponse.json(
      { message: "Use arquivo no formato .xlsx para importacao de Canceladas." },
      { status: 400 },
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const targetSheet =
    workbook.worksheets.find((sheet) => normalize(sheet.name).includes("CANCELAMENTO")) ??
    workbook.worksheets[0];

  if (!targetSheet) {
    return NextResponse.json(
      { message: "Nao foi possivel localizar uma aba valida no arquivo informado." },
      { status: 400 },
    );
  }

  const parsedRows = parseRowsFromWorksheet(targetSheet, defaultCompetencia);
  if (parsedRows.length === 0) {
    return NextResponse.json(
      {
        message:
          "Nenhuma linha valida foi encontrada para importacao. Confira colunas Cpt, Codigo, Nome e Valor Emitido.",
      },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("contraprestacoes_canceladas_registros").insert(parsedRows);
  if (error) {
    return NextResponse.json(
      { message: buildFriendlyErrorMessage(error.message) },
      { status: 500 },
    );
  }

  const competencias = new Set(parsedRows.map((row) => row.competencia));

  return NextResponse.json({
    inserted: parsedRows.length,
    competencias: Array.from(competencias).sort(),
  });
}
