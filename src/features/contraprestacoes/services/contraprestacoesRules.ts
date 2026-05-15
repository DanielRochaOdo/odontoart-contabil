import {
  ContraprestacoesSummary,
  ProcessedRecebidaRow,
  RecebidaRow,
} from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";
import { competenciaToString, lastDayOfMonth, normalizeText } from "@/features/eventos/services/utils";

function exactText(value: string): string {
  return value.trim();
}

function isOrtoText(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.includes("ORTO") ||
    normalized.includes("NEW ODONTO") ||
    normalized.includes("NEW ODONTOLOGIA")
  );
}

function isEmpty(value: string): boolean {
  return normalizeText(value) === "";
}

function hasContent(value: string): boolean {
  return !isEmpty(value);
}

function isPmFortaleza(value: string): boolean {
  return normalizeText(value) === "PREFEITURA MUNICIPAL DE FORTALEZA";
}

function isGovernoEstado(value: string): boolean {
  return normalizeText(value) === "GOVERNO DO ESTADO";
}

function isParticular(value: string): boolean {
  return normalizeText(value) === "PARTICULAR";
}

function isDinheiro(value: string): boolean {
  return normalizeText(value) === "DINHEIRO";
}

function isGrupoOdontoart(value: string): boolean {
  return normalizeText(value) === "ODONTOART";
}

function cloneRow(row: RecebidaRow): RecebidaRow {
  return {
    ...row,
    dataCredito: row.dataCredito ? new Date(row.dataCredito) : null,
    dataVencimento: row.dataVencimento ? new Date(row.dataVencimento) : null,
    dataPagamento: row.dataPagamento ? new Date(row.dataPagamento) : null,
    dtEmissao: row.dtEmissao ? new Date(row.dtEmissao) : null,
  };
}

function shouldDropByEmissionDate(row: RecebidaRow, competenciaLastDay: Date): boolean {
  if (!row.dtEmissao) return false;
  return row.dtEmissao.getTime() > competenciaLastDay.getTime();
}

function normalizeDinheiro(row: RecebidaRow, observations: string[]): void {
  row.tipoPagamento = "BANCO DO BRASIL CLINICO";
  row.tipoRecebimento = "DINHEIRO";
  observations.push("Tipo normalizado para DINHEIRO/BANCO DO BRASIL CLINICO");
}

function fillLoteAndNfFromParcela(row: RecebidaRow, observations: string[]): void {
  if (!hasContent(row.parcela)) return;
  row.loteNf = row.parcela;
  row.nf = row.parcela;
  observations.push("Lote NF e NF preenchidos com a Parcela");
}

export function applyRecebidasRules(
  sourceRows: RecebidaRow[],
  canceladasParcelas: Set<string>,
  competencia: Competencia,
): ProcessedRecebidaRow[] {
  const processed: ProcessedRecebidaRow[] = [];
  const competenciaLastDay = lastDayOfMonth(competencia);

  for (const sourceRow of sourceRows) {
    const row = cloneRow(sourceRow);
    const observations: string[] = [];

    if (shouldDropByEmissionDate(row, competenciaLastDay)) continue;

    if (isParticular(row.tipoParcela)) {
      if (isEmpty(row.loteNf)) continue;
      normalizeDinheiro(row, observations);
    }

    const tipoRecebimentoOrto = isOrtoText(row.tipoRecebimento);
    const tipoPagamentoOrto = isOrtoText(row.tipoPagamento);

    if (tipoRecebimentoOrto && tipoPagamentoOrto) {
      if (isEmpty(row.loteNf)) continue;
      normalizeDinheiro(row, observations);
    }

    if (tipoPagamentoOrto && isDinheiro(row.tipoRecebimento)) {
      if (isEmpty(row.loteNf)) continue;
      normalizeDinheiro(row, observations);
    }

    if (tipoPagamentoOrto && !tipoRecebimentoOrto) {
      if (isEmpty(row.loteNf)) {
        row.loteNf = "DEVOLUCAO";
        observations.push("Lote vazio convertido para DEVOLUCAO");
      } else {
        normalizeDinheiro(row, observations);
      }
    }

    if (tipoRecebimentoOrto && !tipoPagamentoOrto) {
      if (isEmpty(row.loteNf)) continue;
      row.tipoRecebimento = "DINHEIRO";
      observations.push("Tipo recebimento normalizado para DINHEIRO");
    }

    if (isEmpty(row.loteNf)) {
      row.loteNf = "DEVOLUCAO";
      observations.push("Lote vazio convertido para DEVOLUCAO");
    }

    if (isGrupoOdontoart(row.grupoEmpresa)) {
      row.tipoRecebimento = "BANCO DO BRASIL CLINICO EMPRESA";
      if (isEmpty(row.loteNf) && isEmpty(row.nf)) {
        fillLoteAndNfFromParcela(row, observations);
      }
      observations.push("Grupo empresa tratado como BANCO DO BRASIL CLINICO EMPRESA");
    }

    if (isPmFortaleza(row.empresa)) {
      row.tipoRecebimento = "SANTANDER PMF";
      observations.push("Empresa PMF mapeada para SANTANDER PMF");
    }

    if (isGovernoEstado(row.tipoPagamento)) {
      row.tipoRecebimento = "BRADESCO";
      observations.push("Tipo pagamento GOVERNO DO ESTADO mapeado para BRADESCO");
    }

    const parcelaKey = exactText(row.parcela);
    const recuperada = parcelaKey.length > 0 && canceladasParcelas.has(parcelaKey);

    processed.push({
      ...row,
      recuperada,
      grupo: recuperada ? "RECUPERADA" : "RECEBIDA",
      observacoes: observations,
    });
  }

  return processed;
}

export function buildContraprestacoesSummary(
  processedRows: ProcessedRecebidaRow[],
  entradaRecebidas: number,
  competencia: Competencia,
): ContraprestacoesSummary {
  const recuperadas = processedRows.filter((row) => row.grupo === "RECUPERADA");
  const recebidas = processedRows.filter((row) => row.grupo === "RECEBIDA");
  const devolucoes = processedRows.filter((row) => normalizeText(row.loteNf) === "DEVOLUCAO");

  return {
    competencia: competenciaToString(competencia),
    entradaRecebidas,
    registrosTratados: processedRows.length,
    recuperadas: recuperadas.length,
    recebidas: recebidas.length,
    devolucoes: devolucoes.length,
    arquivosGerados: 0,
    totalValorPagamento: processedRows.reduce((sum, row) => sum + row.valorPagamento, 0),
  };
}
