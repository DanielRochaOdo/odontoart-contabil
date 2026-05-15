import JSZip from "jszip";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import {
  ContraprestacoesProcessInput,
  ContraprestacoesProcessOutput,
  ProcessedRecebidaRow,
  RecebidaRow,
} from "@/features/contraprestacoes/domain/types";
import { ContraprestacoesReportFactory } from "@/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { RecebidasWorkbookParser } from "@/features/contraprestacoes/services/RecebidasWorkbookParser";
import { competenciaToString, lastDayOfMonth, normalizeText } from "@/features/eventos/services/utils";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

function applyRecebidasRules(
  sourceRows: RecebidaRow[],
  canceladasParcelas: Set<string>,
  competenciaLastDay: Date,
): ProcessedRecebidaRow[] {
  const processed: ProcessedRecebidaRow[] = [];

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

export class ContraprestacoesProcessor {
  private readonly parser = new RecebidasWorkbookParser();

  private readonly reportFactory = new ContraprestacoesReportFactory();

  private async fetchCanceladasParcelas(): Promise<Set<string>> {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new ContraprestacoesError(
        "Supabase indisponivel para consulta de Canceladas.",
        "Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY validos para cruzar Recebidas com Canceladas.",
      );
    }

    const parcelas = new Set<string>();
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("contraprestacoes_canceladas_registros")
        .select("numero_parc")
        .range(from, from + pageSize - 1);

      if (error) {
        throw new ContraprestacoesError(
          `Falha ao consultar Canceladas: ${error.message}`,
          "Nao foi possivel consultar a base de Canceladas no Supabase.",
        );
      }

      const rows = (data ?? []) as Array<{ numero_parc?: string | null }>;
      rows.forEach((row) => {
        const key = exactText(row.numero_parc ?? "");
        if (key) parcelas.add(key);
      });

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return parcelas;
  }

  async process(input: ContraprestacoesProcessInput): Promise<ContraprestacoesProcessOutput> {
    const rows = await this.parser.parse(input.recebidasBuffer);
    const canceladasParcelas = await this.fetchCanceladasParcelas();
    const processedRows = applyRecebidasRules(
      rows,
      canceladasParcelas,
      lastDayOfMonth(input.competencia),
    );

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

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const recuperadas = processedRows.filter((row) => row.grupo === "RECUPERADA");
    const recebidas = processedRows.filter((row) => row.grupo === "RECEBIDA");
    const devolucoes = processedRows.filter((row) => normalizeText(row.loteNf) === "DEVOLUCAO");

    return {
      fileName: `${String(input.competencia.mes).padStart(2, "0")}.${input.competencia.ano} Contraprestacoes - Recebidas e Recuperadas.zip`,
      fileBuffer: zipBuffer,
      summary: {
        competencia: competenciaToString(input.competencia),
        entradaRecebidas: rows.length,
        registrosTratados: processedRows.length,
        recuperadas: recuperadas.length,
        recebidas: recebidas.length,
        devolucoes: devolucoes.length,
        arquivosGerados: reports.length,
        totalValorPagamento: processedRows.reduce((sum, row) => sum + row.valorPagamento, 0),
      },
    };
  }
}
