import {
  ContraprestacoesScope,
  ContraprestacoesSummary,
  ProcessedRecebidaRow,
  RecebidaRow,
} from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";
import { competenciaToString, normalizeText } from "@/features/eventos/services/utils";

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
  return normalizeText(value).includes("PREFEITURA MUNICIPAL DE FORTALEZA");
}

function isGovernoEstado(value: string): boolean {
  return normalizeText(value).includes("GOVERNO DO ESTADO");
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

function normalizeDinheiro(row: RecebidaRow, observations: string[]): void {
  row.tipoPagamento = "BANCO DO BRASIL CLINICO";
  row.tipoRecebimento = "DINHEIRO";
  observations.push("Tipo normalizado para DINHEIRO/BANCO DO BRASIL CLINICO");
}

function normalizeTipoRecebimentoDinheiro(row: RecebidaRow, observations: string[]): void {
  row.tipoRecebimento = "DINHEIRO";
  observations.push("Tipo recebimento normalizado para DINHEIRO");
}

function markDevolucao(row: RecebidaRow, observations: string[]): void {
  row.loteNf = "DEVOLUCAO";
  observations.push("Lote vazio convertido para DEVOLUCAO");
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
  void competencia;

  const processed: ProcessedRecebidaRow[] = [];

  for (const sourceRow of sourceRows) {
    const row = cloneRow(sourceRow);
    const observations: string[] = [];
    const loteOriginalVazio = isEmpty(row.loteNf);
    const nfOriginalVazio = isEmpty(row.nf);
    let devolucaoMensalidade = false;

    const tipoRecebimentoOrto = isOrtoText(row.tipoRecebimento);
    const tipoPagamentoOrto = isOrtoText(row.tipoPagamento);

    if (isParticular(row.tipoParcela)) {
      if (loteOriginalVazio) continue;
      normalizeDinheiro(row, observations);
    } else if (tipoRecebimentoOrto && tipoPagamentoOrto) {
      if (loteOriginalVazio) continue;
      normalizeDinheiro(row, observations);
    } else if (tipoPagamentoOrto && isDinheiro(row.tipoRecebimento)) {
      if (loteOriginalVazio) continue;
      normalizeDinheiro(row, observations);
    } else if (tipoPagamentoOrto && !tipoRecebimentoOrto) {
      if (loteOriginalVazio) {
        markDevolucao(row, observations);
        devolucaoMensalidade = true;
      } else {
        normalizeDinheiro(row, observations);
      }
    } else if (tipoRecebimentoOrto && !tipoPagamentoOrto) {
      if (loteOriginalVazio) continue;
      normalizeTipoRecebimentoDinheiro(row, observations);
    }

    if (isEmpty(row.loteNf)) {
      markDevolucao(row, observations);
    }

    if (isGrupoOdontoart(row.grupoEmpresa)) {
      row.tipoRecebimento = "BANCO DO BRASIL CLINICO EMPRESA";
      if (loteOriginalVazio && nfOriginalVazio) {
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

    const parcelaKey = row.parcela.trim();
    const recuperada = parcelaKey.length > 0 && canceladasParcelas.has(parcelaKey);

    processed.push({
      ...row,
      recuperada,
      grupo: recuperada ? "RECUPERADA" : "RECEBIDA",
      devolucaoMensalidade,
      observacoes: observations,
    });
  }

  return processed;
}

export function buildContraprestacoesSummary(
  escopo: ContraprestacoesScope,
  processedRows: ProcessedRecebidaRow[],
  entradaBase: number,
  competencia: Competencia,
): ContraprestacoesSummary {
  const recuperadas = processedRows.filter((row) => row.grupo === "RECUPERADA");
  const recebidas = processedRows.filter((row) => row.grupo === "RECEBIDA");
  const devolucoes = processedRows.filter((row) => row.devolucaoMensalidade);

  return {
    escopo,
    competencia: competenciaToString(competencia),
    entradaBase,
    registrosTratados: processedRows.length,
    recuperadas: recuperadas.length,
    recebidas: recebidas.length,
    devolucoes: devolucoes.length,
    arquivosGerados: 0,
    totalValorPagamento: processedRows.reduce((sum, row) => sum + row.valorPagamento, 0),
  };
}
