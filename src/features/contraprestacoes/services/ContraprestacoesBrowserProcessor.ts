import JSZip from "jszip";
import { ContraprestacoesError } from "@/features/contraprestacoes/domain/errors";
import { ContraprestacoesSummary } from "@/features/contraprestacoes/domain/types";
import { Competencia } from "@/features/eventos/domain/types";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { parseCompetencia } from "@/features/eventos/services/utils";
import { ContraprestacoesReportFactory } from "@/features/contraprestacoes/services/ContraprestacoesReportFactory";
import { RecebidasWorkbookParser } from "@/features/contraprestacoes/services/RecebidasWorkbookParser";
import {
  applyRecebidasRules,
  buildContraprestacoesSummary,
} from "@/features/contraprestacoes/services/contraprestacoesRules";

interface BrowserProcessInput {
  competenciaRaw: string | null | undefined;
  recebidasFile: File;
}

interface BrowserProcessOutput {
  fileName: string;
  fileBuffer: Uint8Array;
  summary: ContraprestacoesSummary;
  competenciaDetectada: string | null;
}

async function resolveCompetencia(
  competenciaRaw: string | null | undefined,
  fileBuffer: Uint8Array,
  fileName: string,
): Promise<{ competencia: Competencia; detectada: string | null }> {
  if (typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)) {
    return { competencia: parseCompetencia(competenciaRaw), detectada: competenciaRaw };
  }

  const detector = new CompetenciaDetector();
  const detectada = await detector.detect(fileBuffer, fileName);
  if (detectada) {
    const detectadaValue = `${detectada.ano}-${String(detectada.mes).padStart(2, "0")}`;
    return { competencia: detectada, detectada: detectadaValue };
  }

  return { competencia: parseCompetencia(undefined), detectada: null };
}

async function fetchCanceladasParcelas(): Promise<Set<string>> {
  const response = await fetch("/api/contraprestacoes/canceladas/parcelas", { method: "GET" });
  const payload = (await response.json().catch(() => null)) as
    | { parcelas?: string[]; message?: string }
    | null;

  if (!response.ok) {
    throw new ContraprestacoesError(
      payload?.message ?? "Falha ao consultar parcelas de Canceladas.",
      payload?.message ?? "Nao foi possivel consultar a base de Canceladas no Supabase.",
    );
  }

  return new Set((payload?.parcelas ?? []).map((item) => item.trim()).filter(Boolean));
}

export async function processContraprestacoesInBrowser(
  input: BrowserProcessInput,
): Promise<BrowserProcessOutput> {
  const recebidasBuffer = new Uint8Array(await input.recebidasFile.arrayBuffer());
  const { competencia, detectada } = await resolveCompetencia(
    input.competenciaRaw,
    recebidasBuffer,
    input.recebidasFile.name,
  );

  const parser = new RecebidasWorkbookParser();
  const reportFactory = new ContraprestacoesReportFactory();
  const rows = await parser.parse(recebidasBuffer);
  const canceladasParcelas = await fetchCanceladasParcelas();
  const processedRows = applyRecebidasRules(rows, canceladasParcelas, competencia);

  if (processedRows.length === 0) {
    throw new ContraprestacoesError(
      "Base de recebidas sem registros apos tratamento.",
      "Nenhum registro permaneceu apos aplicar as regras de tratamento de Recebidas.",
    );
  }

  const reports = await reportFactory.buildReports(processedRows, competencia);
  const zip = new JSZip();
  reports.forEach((report) => {
    zip.file(report.fileName, report.buffer);
  });

  const fileBuffer = await zip.generateAsync({ type: "uint8array" });
  const summary = {
    ...buildContraprestacoesSummary(processedRows, rows.length, competencia),
    arquivosGerados: reports.length,
  };

  return {
    fileName: `${String(competencia.mes).padStart(2, "0")}.${competencia.ano} Contraprestacoes - Recebidas e Recuperadas.zip`,
    fileBuffer,
    summary,
    competenciaDetectada: detectada,
  };
}
