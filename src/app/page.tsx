"use client";

import {
  ChangeEvent,
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Settings,
  Layers3,
  LoaderCircle,
  RefreshCcw,
  X,
} from "lucide-react";
import { ContraprestacoesSettings } from "@/features/contraprestacoes/domain/types";
import { AgingSummary } from "@/features/aging/domain/types";
import {
  CONTRAPRESTACOES_SETTINGS_STORAGE_KEY,
  DEFAULT_CONTRAPRESTACOES_SETTINGS,
  resolveContraprestacoesSettings,
} from "@/features/contraprestacoes/services/contraprestacoesSettings";
import styles from "./page.module.css";

interface ProcessSummary {
  competencia: string;
  entradaConhecidos: number;
  entradaLiquidados: number;
  excluidosKits: number;
  excluidosValorZero: number;
  conhecidosClassificados: number;
  liquidadosClassificados: number;
  lotesAdicionadosNoConhecido: number;
  avisos: string[];
}

interface ContraprestacoesSummary {
  escopo: "recebidas" | "recuperadas";
  competencia: string;
  entradaBase: number;
  registrosTratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivosGerados: number;
  totalValorPagamento: number;
}

interface ReportRow {
  id: number;
  competencia: string;
  entradaConhecidos: number;
  entradaLiquidados: number;
  conhecidosClassificados: number;
  liquidadosClassificados: number;
  excluidosKits: number;
  excluidosValorZero: number;
  lotesAdicionadosNoConhecido: number;
  avisos: string[];
  auditoria: {
    porGrupo: AuditoriaGrupoResumo[];
    lotesAdicionados: string[];
    lotesSomenteConhecidos: string[];
    lotesSomenteLiquidados: string[];
  };
  criadoEm: string;
}

interface AuditoriaGrupoResumo {
  origem: "CONHECIDOS" | "LIQUIDADOS";
  segmento: "CLINICO" | "ORTO";
  tipoPessoa: "PF" | "PJ";
  quantidade: number;
  totalVlBruto: number;
  totalLiquido: number;
  totalPago: number;
  totalInss: number;
  totalIss: number;
  totalIr: number;
}

interface CanceladaRow {
  id: number;
  competencia: string;
  ano: number;
  mes: number;
  cpt: string | null;
  codigo: string;
  nome: string;
  emissao: string | null;
  vencimento: string | null;
  valorEmitido: number;
  numeroParc: string;
  numeroNf: string;
  origem: string;
  criadoEm: string;
}

interface CanceladasProcessSummary {
  competencia: string;
  registrosEntrada: number;
  registrosTratados: number;
  registrosPf: number;
  registrosPj: number;
  registrosImportados: number;
  registrosDuplicadosNoParc: number;
  arquivosGerados: number;
}

interface ConferenceProcessRow {
  id: number;
  competencia: string;
  escopo: "recebidas" | "recuperadas";
  entradaBase: number;
  registrosTratados: number;
  recuperadas: number;
  recebidas: number;
  devolucoes: number;
  arquivosGerados: number;
  totalValorPagamento: number;
  arquivoNome: string;
  storagePath: string | null;
  reportFiles: Array<{
    reportId: string;
    fileName: string;
    rowCount: number;
  }>;
  criadoEm: string;
}

interface ConferenceDivergence {
  severity: "error" | "warning";
  escopo: "recebidas" | "recuperadas" | "geral";
  message: string;
}

interface ConferenceScopeSummary {
  escopo: "recebidas" | "recuperadas";
  status: "ok" | "warning" | "error";
  latest: ConferenceProcessRow | null;
  expectedArquivos: number;
  actualArquivos: number;
  expectedLinhasSaida: number;
  actualLinhasSaida: number;
  baseTratadaLinhas: number;
}

interface ConferenceSummary {
  competencia: string;
  rows: ConferenceProcessRow[];
  escopos: ConferenceScopeSummary[];
  divergencias: ConferenceDivergence[];
  canDownloadConsolidated: boolean;
}

type SubmitState = "idle" | "loading" | "success" | "error";
type Module = "eventos" | "aging" | "relatorios" | "contraprestacoes" | "configuracoes";
type ContraprestacoesModule =
  | "canceladas"
  | "recebidas"
  | "recuperadas"
  | "conferencia";
type ReportsState = "idle" | "loading" | "ready" | "error";
type ConferenceState = "idle" | "loading" | "ready" | "error";
type CanceladasSortField =
  | "competencia"
  | "codigo"
  | "nome"
  | "emissao"
  | "vencimento"
  | "valorEmitido"
  | "numeroParc"
  | "numeroNf";
type CanceladasSortDirection = "asc" | "desc";

interface ActionProgress {
  active: boolean;
  value: number;
  label: string;
  detail: string;
}

const DEFAULT_ERROR =
  "Nao foi possivel processar os eventos agora. Confira os arquivos e tente novamente.";
const DEFAULT_CONTRAP_ERROR =
  "Nao foi possivel gerar o arquivo de contraprestacoes agora. Confira a base e tente novamente.";
const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function monthLabel(month: number): string {
  const baseDate = new Date(2000, month - 1, 1);
  if (Number.isNaN(baseDate.getTime())) return String(month);
  return baseDate.toLocaleString("pt-BR", { month: "long" });
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`;
}

function parseNonNegativeNumber(value: string, fallback: number): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function formatDateBr(value: string | null): string {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function formatCompetenciaBr(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;
  return `${match[2]}/${match[1]}`;
}

function nextSortDirection(
  currentField: CanceladasSortField,
  currentDirection: CanceladasSortDirection,
  nextField: CanceladasSortField,
): CanceladasSortDirection {
  if (currentField !== nextField) return "asc";
  return currentDirection === "asc" ? "desc" : "asc";
}

function sortIndicator(
  currentField: CanceladasSortField,
  currentDirection: CanceladasSortDirection,
  field: CanceladasSortField,
): string {
  if (currentField !== field) return "↕";
  return currentDirection === "asc" ? "↑" : "↓";
}

function isValidCompetencia(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function createIdleProgress(): ActionProgress {
  return {
    active: false,
    value: 0,
    label: "",
    detail: "",
  };
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function flushProgressFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function detectCompetenciaLocally(
  file: File,
): Promise<{ competencia: string | null; message?: string }> {
  const [{ CompetenciaDetector }, { competenciaToString }] = await Promise.all([
    import("@/features/eventos/services/CompetenciaDetector"),
    import("@/features/eventos/services/utils"),
  ]);

  const detector = new CompetenciaDetector();
  const detected = await detector.detect(new Uint8Array(await file.arrayBuffer()), file.name);

  if (!detected) {
    return {
      competencia: null,
      message:
        "Nao foi possivel identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
    };
  }

  return {
    competencia: competenciaToString(detected),
  };
}

export default function Home() {
  const [activeModule, setActiveModule] = useState<Module>("eventos");
  const [activeContraprestacoesModule, setActiveContraprestacoesModule] =
    useState<ContraprestacoesModule>("recebidas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contraprestacoesMenuOpen, setContraprestacoesMenuOpen] = useState(true);
  const [competencia, setCompetencia] = useState(() => currentMonth());
  const [knownFile, setKnownFile] = useState<File | null>(null);
  const [liquidFile, setLiquidFile] = useState<File | null>(null);
  const [status, setStatus] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState<ProcessSummary | null>(null);
  const [competenciaHint, setCompetenciaHint] = useState("");
  const detectRequestRef = useRef(0);
  const [recebidasFile, setRecebidasFile] = useState<File | null>(null);
  const [recebidasStatus, setRecebidasStatus] = useState<SubmitState>("idle");
  const [recebidasErrorMessage, setRecebidasErrorMessage] = useState("");
  const [recebidasSummary, setRecebidasSummary] = useState<ContraprestacoesSummary | null>(null);
  const [recebidasCompetenciaHint, setRecebidasCompetenciaHint] = useState("");
  const [recebidasProgress, setRecebidasProgress] = useState<ActionProgress>(createIdleProgress);
  const [recuperadasFile, setRecuperadasFile] = useState<File | null>(null);
  const [recuperadasStatus, setRecuperadasStatus] = useState<SubmitState>("idle");
  const [recuperadasErrorMessage, setRecuperadasErrorMessage] = useState("");
  const [recuperadasSummary, setRecuperadasSummary] = useState<ContraprestacoesSummary | null>(null);
  const [recuperadasCompetenciaHint, setRecuperadasCompetenciaHint] = useState("");
  const [recuperadasProgress, setRecuperadasProgress] = useState<ActionProgress>(createIdleProgress);
  const [settingsValues, setSettingsValues] = useState<ContraprestacoesSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_CONTRAPRESTACOES_SETTINGS;

    try {
      const raw = window.localStorage.getItem(CONTRAPRESTACOES_SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_CONTRAPRESTACOES_SETTINGS;
      return resolveContraprestacoesSettings(
        JSON.parse(raw) as Partial<ContraprestacoesSettings>,
      );
    } catch {
      return DEFAULT_CONTRAPRESTACOES_SETTINGS;
    }
  });
  const [settingsStatus, setSettingsStatus] = useState<SubmitState>("idle");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [agingContabilidadeFile, setAgingContabilidadeFile] = useState<File | null>(null);
  const [agingBaseFile, setAgingBaseFile] = useState<File | null>(null);
  const [agingStatus, setAgingStatus] = useState<SubmitState>("idle");
  const [agingError, setAgingError] = useState("");
  const [agingSummary, setAgingSummary] = useState<AgingSummary | null>(null);
  const [agingHint, setAgingHint] = useState("");
  const [agingProgress, setAgingProgress] = useState<ActionProgress>(createIdleProgress);

  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportsState, setReportsState] = useState<ReportsState>("idle");
  const [reportsError, setReportsError] = useState("");
  const [reportCompetencia, setReportCompetencia] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const hasLoadedReportsRef = useRef(false);
  const hasLoadedCanceladasRef = useRef(false);
  const hasLoadedConferenciaRef = useRef(false);

  const [canceladasRows, setCanceladasRows] = useState<CanceladaRow[]>([]);
  const [canceladasLoading, setCanceladasLoading] = useState(false);
  const [canceladasError, setCanceladasError] = useState("");
  const [canceladasSuccess, setCanceladasSuccess] = useState("");
  const [canceladasProcessFile, setCanceladasProcessFile] = useState<File | null>(null);
  const [canceladasCompetenciaHint, setCanceladasCompetenciaHint] = useState("");
  const [canceladasAnosDisponiveis, setCanceladasAnosDisponiveis] = useState<number[]>([]);
  const [canceladasMesesDisponiveis, setCanceladasMesesDisponiveis] = useState<number[]>([]);
  const [canceladasAnoSelecionado, setCanceladasAnoSelecionado] = useState("");
  const [canceladasMesSelecionado, setCanceladasMesSelecionado] = useState("");
  const [canceladasPage, setCanceladasPage] = useState(1);
  const [canceladasPageSize] = useState(100);
  const [canceladasTotal, setCanceladasTotal] = useState(0);
  const [canceladasTotalValorEmitido, setCanceladasTotalValorEmitido] = useState(0);
  const [canceladasTotalPaginas, setCanceladasTotalPaginas] = useState(0);
  const [canceladasNumeroParcBusca, setCanceladasNumeroParcBusca] = useState("");
  const [canceladasSortBy, setCanceladasSortBy] = useState<CanceladasSortField>("vencimento");
  const [canceladasSortDir, setCanceladasSortDir] = useState<CanceladasSortDirection>("desc");
  const [canceladasProcessOpen, setCanceladasProcessOpen] = useState(true);
  const [canceladasFiltersOpen, setCanceladasFiltersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [canceladasProcessSummary, setCanceladasProcessSummary] =
    useState<CanceladasProcessSummary | null>(null);
  const [eventosProgress, setEventosProgress] = useState<ActionProgress>(createIdleProgress);
  const [canceladasProcessProgress, setCanceladasProcessProgress] =
    useState<ActionProgress>(createIdleProgress);
  const [conferenceCompetencia, setConferenceCompetencia] = useState(() => currentMonth());
  const [conferenceState, setConferenceState] = useState<ConferenceState>("idle");
  const [conferenceError, setConferenceError] = useState("");
  const [conferenceSummary, setConferenceSummary] = useState<ConferenceSummary | null>(null);
  const [conferenceDownloadState, setConferenceDownloadState] = useState<SubmitState>("idle");

  const canSubmit = useMemo(
    () => Boolean(knownFile && liquidFile && competencia) && status !== "loading",
    [knownFile, liquidFile, competencia, status],
  );
  const canSubmitRecebidas = useMemo(
    () => Boolean(recebidasFile && competencia) && recebidasStatus !== "loading",
    [recebidasFile, competencia, recebidasStatus],
  );
  const canSubmitRecuperadas = useMemo(
    () => Boolean(recuperadasFile && competencia) && recuperadasStatus !== "loading",
    [recuperadasFile, competencia, recuperadasStatus],
  );

  async function detectCompetenciaFromFile(
    file: File | null,
    origem: string,
    setHint: Dispatch<SetStateAction<string>>,
  ) {
    if (!file) return;

    detectRequestRef.current += 1;
    const requestId = detectRequestRef.current;

    try {
      const payload = await detectCompetenciaLocally(file);

      if (requestId !== detectRequestRef.current) return;

      if (isValidCompetencia(payload.competencia)) {
        setCompetencia(payload.competencia);
        setHint(
          `Competencia identificada automaticamente em ${origem}: ${payload.competencia}.`,
        );
      } else if (payload.message) {
        setHint(payload.message);
      }
    } catch {
      if (requestId !== detectRequestRef.current) return;
      setHint(
        "Nao foi possivel identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
      );
    }
  }

  function handleKnownChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setKnownFile(file);
    void detectCompetenciaFromFile(file, "Eventos Conhecidos", setCompetenciaHint);
  }

  function handleLiquidChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setLiquidFile(file);
    void detectCompetenciaFromFile(file, "Eventos Liquidados", setCompetenciaHint);
  }

  function handleEscrituracaoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setRecebidasFile(file);
    if (!file) {
      setRecebidasCompetenciaHint("");
      return;
    }

    void (async () => {
      try {
        const [{ parseCompetencia }] = await Promise.all([
          import("@/features/eventos/services/utils"),
        ]);
        const detected = await detectCompetenciaLocally(file);

        if (detected.competencia) {
          setCompetencia(detected.competencia);
          setRecebidasCompetenciaHint(
            `Competencia identificada localmente em Base Recebidas: ${detected.competencia}.`,
          );
          return;
        }

        const fallback = parseCompetencia(undefined);
        const fallbackValue = `${fallback.ano}-${String(fallback.mes).padStart(2, "0")}`;
        setCompetencia(fallbackValue);
        setRecebidasCompetenciaHint(
          detected.message ??
            "Nao conseguimos identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
        );
      } catch {
        setRecebidasCompetenciaHint(
          "Nao foi possivel identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
        );
      }
    })();
  }

  function handleRecuperadasChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setRecuperadasFile(file);
    if (!file) {
      setRecuperadasCompetenciaHint("");
      return;
    }

    void (async () => {
      try {
        const [{ parseCompetencia }] = await Promise.all([
          import("@/features/eventos/services/utils"),
        ]);
        const detected = await detectCompetenciaLocally(file);

        if (detected.competencia) {
          setCompetencia(detected.competencia);
          setRecuperadasCompetenciaHint(
            `Competencia identificada localmente em Base Recuperadas: ${detected.competencia}.`,
          );
          return;
        }

        const fallback = parseCompetencia(undefined);
        const fallbackValue = `${fallback.ano}-${String(fallback.mes).padStart(2, "0")}`;
        setCompetencia(fallbackValue);
        setRecuperadasCompetenciaHint(
          detected.message ??
            "Nao conseguimos identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
        );
      } catch {
        setRecuperadasCompetenciaHint(
          "Nao foi possivel identificar a competencia automaticamente. Informe manualmente no campo Competencia.",
        );
      }
    })();
  }

  function handleCanceladasProcessChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCanceladasProcessFile(file);
    if (!file) {
      setCanceladasCompetenciaHint("");
      return;
    }
    void detectCompetenciaFromFile(file, "Canceladas", setCanceladasCompetenciaHint);
  }

  function updateSettingsValue(
    field: keyof ContraprestacoesSettings,
    rawValue: string,
  ) {
    setSettingsStatus("idle");
    setSettingsMessage("");
    setSettingsValues((current) => ({
      ...current,
      [field]: parseNonNegativeNumber(rawValue, current[field]),
    }));
  }

  function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const sanitized = resolveContraprestacoesSettings(settingsValues);
      window.localStorage.setItem(
        CONTRAPRESTACOES_SETTINGS_STORAGE_KEY,
        JSON.stringify(sanitized),
      );
      setSettingsValues(sanitized);
      setSettingsStatus("success");
      setSettingsMessage("Configuracoes salvas e prontas para os proximos processamentos.");
    } catch {
      setSettingsStatus("error");
      setSettingsMessage("Nao foi possivel salvar as configuracoes neste navegador.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!knownFile || !liquidFile) return;

    setStatus("loading");
    setEventosProgress({
      active: true,
      value: 8,
      label: "Preparando envio",
      detail: `Validando ${knownFile.name} e ${liquidFile.name} antes do processamento.`,
    });
    setErrorMessage("");
    setSummary(null);
    await flushProgressFrame();

    const formData = new FormData();
    formData.append("competencia", competencia);
    formData.append("conhecidos", knownFile);
    formData.append("liquidados", liquidFile);

    try {
      setEventosProgress({
        active: true,
        value: 28,
        label: "Enviando arquivos",
        detail: "Transmitindo as bases de Conhecidos e Liquidados para o processamento.",
      });
      await flushProgressFrame();

      const response = await fetch("/api/eventos/processar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(payload?.message || DEFAULT_ERROR);
      }

      setEventosProgress({
        active: true,
        value: 72,
        label: "Lendo resultado",
        detail: "Recebendo o pacote consolidado e o resumo da competencia processada.",
      });
      await flushProgressFrame();

      const summaryHeader = response.headers.get("x-odonto-summary");
      if (summaryHeader) {
        const decoded = atob(summaryHeader);
        setSummary(JSON.parse(decoded) as ProcessSummary);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename=\"(.+)\"/)?.[1] ?? "ARQUIVOS-CONTABILIDADE.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      setEventosProgress({
        active: true,
        value: 100,
        label: "Concluido",
        detail: "Pacote de arquivos da contabilidade pronto para download.",
      });
      setStatus("success");
      if (activeModule === "relatorios") {
        void loadReports();
      }
    } catch (error) {
      setStatus("error");
      setEventosProgress(createIdleProgress());
      setErrorMessage(error instanceof Error ? error.message : DEFAULT_ERROR);
      return;
    }

    window.setTimeout(() => setEventosProgress(createIdleProgress()), 1800);
  }

  async function runContraprestacoesFlow(params: {
    escopo: "recebidas" | "recuperadas";
    file: File;
    origemLabel: string;
    setStatus: Dispatch<SetStateAction<SubmitState>>;
    setError: Dispatch<SetStateAction<string>>;
    setSummary: Dispatch<SetStateAction<ContraprestacoesSummary | null>>;
    setHint: Dispatch<SetStateAction<string>>;
    setProgress: Dispatch<SetStateAction<ActionProgress>>;
  }) {
    const {
      escopo,
      file,
      origemLabel,
      setStatus,
      setError,
      setSummary,
      setHint,
      setProgress,
    } = params;

    setStatus("loading");
    setProgress({
      active: true,
      value: 10,
      label: "Abrindo planilha",
      detail: `Lendo ${file.name} para identificar competencia e preparar o fluxo.`,
    });
    setError("");
    setSummary(null);
    await flushProgressFrame();

    try {
      setProgress({
        active: true,
        value: 24,
        label: "Carregando motor local",
        detail: `Preparando o processamento local de ${origemLabel}.`,
      });
      await flushProgressFrame();

      const { processContraprestacoesInBrowser } = await import(
        "@/features/contraprestacoes/services/ContraprestacoesBrowserProcessor"
      );

      setProgress({
        active: true,
        value: 48,
        label: "Processando base",
        detail: "Tratando linhas da base, cruzando parcelas com Canceladas e montando os relatorios.",
      });
      await flushProgressFrame();

      const result = await processContraprestacoesInBrowser({
        escopo,
        competenciaRaw: competencia,
        baseFile: file,
        settings: settingsValues,
      });

      if (result.competenciaDetectada && result.competenciaDetectada !== competencia) {
        setCompetencia(result.competenciaDetectada);
        setHint(
          `Competencia confirmada localmente em ${origemLabel}: ${result.competenciaDetectada}.`,
        );
      }

      setSummary(result.summary);

      setProgress({
        active: true,
        value: 82,
        label: "Gerando pacote",
        detail: "Compactando a base tratada e os relatorios finais para download.",
      });
      await flushProgressFrame();

      downloadBlob(
        new Blob([toArrayBuffer(result.fileBuffer)], { type: "application/zip" }),
        result.fileName,
      );

      setProgress({
        active: true,
        value: 100,
        label: "Concluido",
        detail: `Pacote de ${origemLabel} pronto para download.`,
      });
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setProgress(createIdleProgress());
      setError(error instanceof Error ? error.message : DEFAULT_CONTRAP_ERROR);
      return;
    }

    window.setTimeout(() => setProgress(createIdleProgress()), 1800);
  }

  async function handleRecebidasSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recebidasFile) return;

    await runContraprestacoesFlow({
      escopo: "recebidas",
      file: recebidasFile,
      origemLabel: "Base Recebidas",
      setStatus: setRecebidasStatus,
      setError: setRecebidasErrorMessage,
      setSummary: setRecebidasSummary,
      setHint: setRecebidasCompetenciaHint,
      setProgress: setRecebidasProgress,
    });
  }

  async function handleRecuperadasSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recuperadasFile) return;

    await runContraprestacoesFlow({
      escopo: "recuperadas",
      file: recuperadasFile,
      origemLabel: "Base Recuperadas",
      setStatus: setRecuperadasStatus,
      setError: setRecuperadasErrorMessage,
      setSummary: setRecuperadasSummary,
      setHint: setRecuperadasCompetenciaHint,
      setProgress: setRecuperadasProgress,
    });
  }

  const loadReports = useCallback(async () => {
    setReportsState("loading");
    setReportsError("");
    try {
      const params = new URLSearchParams();
      if (reportCompetencia) params.set("competencia", reportCompetencia);
      params.set("limit", "100");
      const response = await fetch(`/api/eventos/relatorios?${params.toString()}`, {
        method: "GET",
      });
      const payload = (await response.json()) as {
        rows?: ReportRow[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.message ??
            "Nao foi possivel carregar os relatorios agora. Tente novamente.",
        );
      }

      setReportRows(payload.rows ?? []);
      setSelectedReportId((current) => {
        if ((payload.rows ?? []).length === 0) return null;
        if (current && (payload.rows ?? []).some((row) => row.id === current)) return current;
        return (payload.rows ?? [])[0].id;
      });
      setReportsState("ready");
      if (payload.message) {
        setReportsError(payload.message);
      }
    } catch (error) {
      setReportsState("error");
      setReportsError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar os relatorios agora.",
      );
    }
  }, [reportCompetencia]);

  const loadCanceladas = useCallback(
    async (override?: {
      ano?: string;
      mes?: string;
      page?: number;
      numeroParc?: string;
      sortBy?: CanceladasSortField;
      sortDir?: CanceladasSortDirection;
    }) => {
    setCanceladasLoading(true);
    setCanceladasError("");
    setCanceladasSuccess("");

    try {
      const anoAtivo = override?.ano ?? canceladasAnoSelecionado;
      const mesAtivo = override?.mes ?? canceladasMesSelecionado;
      const pageAtiva = override?.page ?? canceladasPage;
      const numeroParcAtivo = override?.numeroParc ?? canceladasNumeroParcBusca;
      const sortByAtivo = override?.sortBy ?? canceladasSortBy;
      const sortDirAtivo = override?.sortDir ?? canceladasSortDir;
      const params = new URLSearchParams();
      if (anoAtivo) {
        params.set("anos", anoAtivo);
      }
      if (mesAtivo) {
        params.set("meses", mesAtivo);
      }
      if (numeroParcAtivo) {
        params.set("numeroParc", numeroParcAtivo);
      }
      params.set("page", String(pageAtiva));
      params.set("pageSize", String(canceladasPageSize));
      params.set("sortBy", sortByAtivo);
      params.set("sortDir", sortDirAtivo);

      const response = await fetch(
        `/api/contraprestacoes/canceladas/registros?${params.toString()}`,
        { method: "GET" },
      );

      const payload = (await response.json()) as {
        rows?: CanceladaRow[];
        resumo?: { totalRegistros?: number; totalValorEmitido?: number };
        filtrosDisponiveis?: { anos?: number[]; meses?: number[] };
        paginacao?: { pagina?: number; pageSize?: number; total?: number; totalPaginas?: number };
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.message ?? "Nao foi possivel consultar os registros de Canceladas.",
        );
      }

      setCanceladasRows(payload.rows ?? []);
      setCanceladasAnosDisponiveis(payload.filtrosDisponiveis?.anos ?? []);
      setCanceladasMesesDisponiveis(payload.filtrosDisponiveis?.meses ?? []);
      setCanceladasTotal(payload.resumo?.totalRegistros ?? 0);
      setCanceladasTotalValorEmitido(payload.resumo?.totalValorEmitido ?? 0);
      setCanceladasTotalPaginas(payload.paginacao?.totalPaginas ?? 0);
      if (payload.paginacao?.pagina && payload.paginacao.pagina !== canceladasPage) {
        setCanceladasPage(payload.paginacao.pagina);
      }
      if (payload.message) {
        setCanceladasError(payload.message);
      }
    } catch (error) {
      setCanceladasRows([]);
      setCanceladasAnosDisponiveis([]);
      setCanceladasMesesDisponiveis([]);
      setCanceladasTotal(0);
      setCanceladasTotalValorEmitido(0);
      setCanceladasTotalPaginas(0);
      setCanceladasError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel consultar os registros de Canceladas.",
      );
    } finally {
      setCanceladasLoading(false);
    }
    },
    [
      canceladasAnoSelecionado,
      canceladasMesSelecionado,
      canceladasNumeroParcBusca,
      canceladasPage,
      canceladasPageSize,
      canceladasSortBy,
      canceladasSortDir,
    ],
  );

  const loadConference = useCallback(async () => {
    if (!conferenceCompetencia) return;

    setConferenceState("loading");
    setConferenceError("");

    try {
      const params = new URLSearchParams();
      params.set("competencia", conferenceCompetencia);

      const response = await fetch(`/api/contraprestacoes/conferencia?${params.toString()}`, {
        method: "GET",
      });

      const payload = (await response.json()) as ConferenceSummary & { message?: string };
      if (!response.ok) {
        throw new Error(
          payload.message ?? "Nao foi possivel carregar a conferencia desta competencia.",
        );
      }

      setConferenceSummary(payload);
      setConferenceState("ready");
    } catch (error) {
      setConferenceSummary(null);
      setConferenceState("error");
      setConferenceError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar a conferencia desta competencia.",
      );
    }
  }, [conferenceCompetencia]);

  async function handleDownloadConference() {
    if (!conferenceCompetencia) return;

    setConferenceDownloadState("loading");
    setConferenceError("");

    try {
      const params = new URLSearchParams();
      params.set("competencia", conferenceCompetencia);

      const response = await fetch(
        `/api/contraprestacoes/conferencia/download?${params.toString()}`,
        { method: "GET" },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(
          payload?.message ?? "Nao foi possivel baixar o ZIP consolidado da conferencia.",
        );
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename=\"([^\"]+)\"/i);
      const fileName =
        match?.[1] ?? `${conferenceCompetencia.replace("-", ".")} Contraprestacoes - Conferencia.zip`;
      downloadBlob(blob, fileName);
      setConferenceDownloadState("success");
    } catch (error) {
      setConferenceDownloadState("error");
      setConferenceError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel baixar o ZIP consolidado da conferencia.",
      );
    }
  }

  function handleAgingBaseChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAgingBaseFile(file);
    if (!file) return;
    void detectCompetenciaFromFile(file, "Base Aging Mensalidades", setAgingHint);
  }

  async function handleAgingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agingContabilidadeFile || !agingBaseFile) return;
    setAgingStatus("loading");
    setAgingError("");
    setAgingSummary(null);
    setAgingProgress({ active: true, value: 12, label: "Abrindo planilhas", detail: "Lendo a base Contabilidade e a base Aging Mensalidades." });
    await flushProgressFrame();
    try {
      const { processAging } = await import("@/features/aging/services/AgingWorkbookProcessor");
      setAgingProgress({ active: true, value: 45, label: "Aplicando tratativas", detail: "Filtrando lote, emissão, pagamento e separando PF/PJ." });
      await flushProgressFrame();
      const result = await processAging({
        contabilidadeBuffer: new Uint8Array(await agingContabilidadeFile.arrayBuffer()),
        baseBuffer: new Uint8Array(await agingBaseFile.arrayBuffer()),
        competencia: (await import("@/features/eventos/services/utils")).parseCompetencia(competencia),
      });
      setAgingSummary(result.summary);
      setAgingProgress({ active: true, value: 85, label: "Gerando arquivo", detail: "Preenchendo Recebimento Pendentes e preparando o download." });
      await flushProgressFrame();
      downloadBlob(new Blob([toArrayBuffer(result.fileBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), result.fileName);
      setAgingProgress({ active: true, value: 100, label: "Concluido", detail: "Arquivo Aging pronto para download." });
      setAgingStatus("success");
    } catch (error) {
      setAgingStatus("error");
      setAgingProgress(createIdleProgress());
      setAgingError(error instanceof Error ? error.message : "Nao foi possivel processar o Aging.");
      return;
    }
    window.setTimeout(() => setAgingProgress(createIdleProgress()), 1800);
  }

  async function handleCanceladasProcessSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canceladasProcessFile) return;

    setCanceladasLoading(true);
    setCanceladasProcessProgress({
      active: true,
      value: 8,
      label: "Abrindo planilha",
      detail: `Lendo ${canceladasProcessFile.name} para validar competencia e localizar a aba original.`,
    });
    setCanceladasError("");
    setCanceladasSuccess("");
    setCanceladasProcessSummary(null);
    await flushProgressFrame();

    try {
      const persistHistorico = async (
        payload: { competencia: string; rowsToImport: unknown[] },
      ): Promise<{ inserted: number; skippedDuplicated: number }> => {
        const persistResponse = await fetch("/api/contraprestacoes/canceladas/processar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const persistPayload = (await persistResponse.json().catch(() => null)) as
          | { inserted?: number; skippedDuplicated?: number; message?: string }
          | null;

        if (!persistResponse.ok) {
          throw new Error(
            persistPayload?.message ??
              "Nao foi possivel atualizar o historico mensal de Canceladas.",
          );
        }

        return {
          inserted: persistPayload?.inserted ?? 0,
          skippedDuplicated: persistPayload?.skippedDuplicated ?? 0,
        };
      };

      const shouldProcessLocally = canceladasProcessFile.size > VERCEL_SAFE_UPLOAD_BYTES;

      if (shouldProcessLocally) {
        const { processCanceladasInWorker } = await import(
          "@/features/contraprestacoes/services/CanceladasWorkerClient"
        );

        setCanceladasProcessProgress({
          active: true,
          value: 16,
          label: "Processando localmente",
          detail:
            "O arquivo excede o limite de upload da Vercel. Processando no navegador e enviando apenas o historico final.",
        });
        await flushProgressFrame();

        const result = await processCanceladasInWorker(
          {
            competenciaRaw: competencia,
            file: canceladasProcessFile,
          },
          (progress) => {
            setCanceladasProcessProgress({
              active: true,
              value: progress.value,
              label: progress.label,
              detail: progress.detail,
            });
          },
        );

        if (result.competenciaDetectada && result.competenciaDetectada !== competencia) {
          setCompetencia(result.competenciaDetectada);
          setCanceladasCompetenciaHint(
            `Competencia confirmada em Canceladas: ${result.competenciaDetectada}.`,
          );
        }

        setCanceladasProcessProgress({
          active: true,
          value: 78,
          label: "Atualizando historico",
          detail: "Gravando o historico mensal sem duplicar registros por No Parc.",
        });
        await flushProgressFrame();

        const persisted = await persistHistorico({
          competencia: result.result.competencia,
          rowsToImport: result.result.rowsToImport,
        });

        setCanceladasProcessSummary({
          competencia: result.result.competencia,
          registrosEntrada: result.result.registrosEntrada,
          registrosTratados: result.result.registrosTratados,
          registrosPf: result.result.registrosPf,
          registrosPj: result.result.registrosPj,
          registrosImportados: persisted.inserted,
          registrosDuplicadosNoParc: persisted.skippedDuplicated,
          arquivosGerados: result.result.generatedFiles.length,
        });

        setCanceladasProcessProgress({
          active: true,
          value: 88,
          label: "Gerando download",
          detail: "Compactando a base tratada e a planilha final para baixar o pacote mensal.",
        });
        await flushProgressFrame();

        downloadBlob(
          new Blob([toArrayBuffer(result.fileBuffer)], { type: "application/zip" }),
          result.fileName,
        );
        setCanceladasSuccess(
          `Processamento mensal concluido. ${persisted.inserted} registro(s) incluído(s) no historico e ${persisted.skippedDuplicated} duplicado(s) por No Parc ignorado(s).`,
        );
      } else {
        setCanceladasProcessProgress({
          active: true,
          value: 16,
          label: "Enviando base",
          detail: "Transferindo a base de Canceladas para processamento no servidor.",
        });
        await flushProgressFrame();

        const formData = new FormData();
        formData.append("arquivo", canceladasProcessFile);
        if (competencia) {
          formData.append("competencia", competencia);
        }

        const response = await fetch("/api/contraprestacoes/canceladas/processar", {
          method: "POST",
          body: formData,
        });

        if (response.status === 413) {
          throw new Error(
            "A Vercel rejeitou o upload direto por tamanho. Tente novamente: o arquivo sera processado localmente se continuar acima do limite.",
          );
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(
            payload?.message ?? "Nao foi possivel processar a base mensal de Canceladas.",
          );
        }

        setCanceladasProcessProgress({
          active: true,
          value: 76,
          label: "Lendo resultado",
          detail: "Recebendo o pacote mensal e o resumo final do processamento.",
        });
        await flushProgressFrame();

        const summaryHeader = response.headers.get("x-odonto-canceladas-summary");
        const summary = summaryHeader
          ? (JSON.parse(atob(summaryHeader)) as CanceladasProcessSummary & {
              competenciaDetectada?: string;
            })
          : null;

        if (summary?.competenciaDetectada && summary.competenciaDetectada !== competencia) {
          setCompetencia(summary.competenciaDetectada);
          setCanceladasCompetenciaHint(
            `Competencia confirmada em Canceladas: ${summary.competenciaDetectada}.`,
          );
        }

        if (summary) {
          setCanceladasProcessSummary({
            competencia: summary.competencia,
            registrosEntrada: summary.registrosEntrada,
            registrosTratados: summary.registrosTratados,
            registrosPf: summary.registrosPf,
            registrosPj: summary.registrosPj,
            registrosImportados: summary.registrosImportados,
            registrosDuplicadosNoParc: summary.registrosDuplicadosNoParc,
            arquivosGerados: summary.arquivosGerados,
          });
        }

        setCanceladasProcessProgress({
          active: true,
          value: 88,
          label: "Gerando download",
          detail: "Compactando a base tratada e a planilha final para baixar o pacote mensal.",
        });
        await flushProgressFrame();

        const blob = await response.blob();
        const fileName =
          response.headers
            .get("Content-Disposition")
            ?.match(/filename=\"(.+)\"/)?.[1] ?? "Canceladas.zip";
        downloadBlob(blob, fileName);
        setCanceladasSuccess(
          `Processamento mensal concluido. ${summary?.registrosImportados ?? 0} registro(s) incluído(s) no historico e ${summary?.registrosDuplicadosNoParc ?? 0} duplicado(s) por No Parc ignorado(s).`,
        );
      }

      setCanceladasProcessFile(null);
      setCanceladasPage(1);
      await loadCanceladas({ page: 1 });
      setCanceladasProcessProgress({
        active: true,
        value: 100,
        label: "Concluido",
        detail: "Processamento mensal finalizado e pacote mensal baixado.",
      });
    } catch (error) {
      setCanceladasProcessProgress(createIdleProgress());
      setCanceladasError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel processar a base mensal de Canceladas.",
      );
    } finally {
      setCanceladasLoading(false);
    }

    window.setTimeout(() => setCanceladasProcessProgress(createIdleProgress()), 1800);
  }

  function renderActionProgress(progress: ActionProgress) {
    if (!progress.active) return null;

    return (
      <div className={styles.progressCard} aria-live="polite">
        <div className={styles.progressHeader}>
          <strong>{progress.label}</strong>
          <span>{clampProgress(progress.value)}%</span>
        </div>
        <div className={styles.progressBarTrack} role="progressbar" aria-valuenow={clampProgress(progress.value)} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={styles.progressBarFill}
            style={{ width: `${clampProgress(progress.value)}%` }}
          />
        </div>
        <p className={styles.progressDetail}>{progress.detail}</p>
      </div>
    );
  }

  function handleCanceladasPageChange(nextPage: number) {
    if (nextPage < 1) return;
    if (canceladasTotalPaginas > 0 && nextPage > canceladasTotalPaginas) return;
    setCanceladasPage(nextPage);
    void loadCanceladas({ page: nextPage });
  }

  function handleCanceladasSort(field: CanceladasSortField) {
    const nextDirection = nextSortDirection(canceladasSortBy, canceladasSortDir, field);
    setCanceladasSortBy(field);
    setCanceladasSortDir(nextDirection);
    setCanceladasPage(1);
    void loadCanceladas({ page: 1, sortBy: field, sortDir: nextDirection });
  }

  useEffect(() => {
    if (activeModule !== "relatorios") return;
    if (hasLoadedReportsRef.current) return;
    hasLoadedReportsRef.current = true;
    void loadReports();
  }, [activeModule, loadReports]);

  useEffect(() => {
    const isCanceladasActive =
      activeModule === "contraprestacoes" && activeContraprestacoesModule === "canceladas";
    if (!isCanceladasActive) return;
    if (hasLoadedCanceladasRef.current) return;
    hasLoadedCanceladasRef.current = true;
    void loadCanceladas();
  }, [activeModule, activeContraprestacoesModule, loadCanceladas]);

  useEffect(() => {
    const isConferenciaActive =
      activeModule === "contraprestacoes" && activeContraprestacoesModule === "conferencia";
    if (!isConferenciaActive) return;
    if (hasLoadedConferenciaRef.current) return;
    hasLoadedConferenciaRef.current = true;
    void loadConference();
  }, [activeModule, activeContraprestacoesModule, loadConference]);

  useEffect(() => {
    if (!guideOpen) return;
    function onEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setGuideOpen(false);
      }
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [guideOpen]);

  function renderEventos() {
    return (
      <>
        <header className={styles.header}>
          <h1>Conhecidos e Liquidados</h1>
          <p>
            Gere os arquivos para a contabilidade em .xlsx: Conhecidos Clinico, Conhecidos
            Ortodontia, Liquidados Clinico e Liquidados Ortodontia.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Competencia</span>
                <input
                  type="month"
                  value={competencia ?? ""}
                  onChange={(event) => setCompetencia(event.target.value)}
                  required
                />
                {competenciaHint && <small className={styles.helper}>{competenciaHint}</small>}
              </label>

              <label className={styles.field}>
                <span>Eventos Conhecidos (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleKnownChange}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Eventos Liquidados (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleLiquidChange}
                  required
                />
              </label>
            </div>

            <div className={styles.actions}>
              <button type="submit" disabled={!canSubmit} className={styles.primaryBtn}>
                {status === "loading" ? (
                  <LoaderCircle size={15} className={styles.spin} />
                ) : (
                  <Download size={15} />
                )}
                <span>Exportar Arquivos Contabilidade</span>
              </button>
              {renderActionProgress(eventosProgress)}
            </div>
          </form>
        </section>

        {(status === "error" || status === "success" || summary) && (
          <section className={styles.feedback}>
            {status === "error" && (
              <p className={styles.errorMsg}>
                <AlertTriangle size={16} />
                {errorMessage}
              </p>
            )}

            {status === "success" && (
              <p className={styles.successMsg}>
                <CheckCircle2 size={16} />
                Processamento concluido. O download do pacote com os 4 arquivos contabilidade foi
                iniciado.
              </p>
            )}

            {summary && (
              <div className={styles.summary}>
                <h2>Resumo da Competencia {summary.competencia}</h2>
                <ul>
                  <li>Entradas Conhecidos: {summary.entradaConhecidos}</li>
                  <li>Entradas Liquidados: {summary.entradaLiquidados}</li>
                  <li>Conhecidos validos: {summary.conhecidosClassificados}</li>
                  <li>Liquidados finais: {summary.liquidadosClassificados}</li>
                  <li>Excluidos por KITS: {summary.excluidosKits}</li>
                  <li>Excluidos por Valor Bruto = 0: {summary.excluidosValorZero}</li>
                  <li>Lotes adicionados em conhecidos: {summary.lotesAdicionadosNoConhecido}</li>
                </ul>

                {summary.avisos.length > 0 && (
                  <div className={styles.warnings}>
                    <h3>Avisos para conferencia contabil</h3>
                    <ul>
                      {summary.avisos.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </>
    );
  }

  function renderContraprestacoesBase(params: {
    titulo: string;
    descricao: string;
    nota: string;
    origemLabel: string;
    hint: string;
    status: SubmitState;
    errorMessage: string;
    summary: ContraprestacoesSummary | null;
    canSubmit: boolean;
    onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
    progress: ActionProgress;
    successLabel: string;
  }) {
    const {
      titulo,
      descricao,
      nota,
      origemLabel,
      hint,
      status,
      errorMessage,
      summary,
      canSubmit,
      onSubmit,
      onFileChange,
      progress,
      successLabel,
    } = params;

    return (
      <>
        <header className={styles.header}>
          <h1>{titulo}</h1>
          <p>{descricao}</p>
          <p className={styles.ruleNote}>{nota}</p>
          <p className={styles.helper}>
            Tarifas ativas: crédito {formatPercent(settingsValues.tarifaCartaoCredito)}, débito{" "}
            {formatPercent(settingsValues.tarifaCartaoDebito)}, débito em conta{" "}
            {formatCurrency(settingsValues.tarifaDebitoEmConta)} e PIX{" "}
            {formatCurrency(settingsValues.tarifaPixFixo)}.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={onSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Competencia</span>
                <input
                  type="month"
                  value={competencia ?? ""}
                  onChange={(event) => setCompetencia(event.target.value)}
                  required
                />
                {hint && <small className={styles.helper}>{hint}</small>}
              </label>

              <label className={styles.field}>
                <span>{origemLabel} (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFileChange}
                  required
                />
              </label>
            </div>

            <div className={styles.actions}>
              <button
                type="submit"
                disabled={!canSubmit}
                className={styles.primaryBtn}
              >
                {status === "loading" ? (
                  <LoaderCircle size={15} className={styles.spin} />
                ) : (
                  <Download size={15} />
                )}
                <span>{successLabel}</span>
              </button>
              {renderActionProgress(progress)}
            </div>
          </form>
        </section>

        {(status === "error" || status === "success" || summary) && (
          <section className={styles.feedback}>
            {status === "error" && (
              <p className={styles.errorMsg}>
                <AlertTriangle size={16} />
                {errorMessage}
              </p>
            )}

            {status === "success" && (
              <p className={styles.successMsg}>
                <CheckCircle2 size={16} />
                Processamento concluido. O download do pacote de relatorios foi iniciado.
              </p>
            )}

            {summary && (
              <div className={styles.summary}>
                <h2>Resumo da Competencia {summary.competencia}</h2>
                <ul>
                  <li>Entradas na base: {summary.entradaBase}</li>
                  <li>Registros tratados: {summary.registrosTratados}</li>
                  <li>Parcelas Recuperadas: {summary.recuperadas}</li>
                  <li>Parcelas Recebidas: {summary.recebidas}</li>
                  <li>Devolucoes marcadas: {summary.devolucoes}</li>
                  <li>Arquivos gerados: {summary.arquivosGerados}</li>
                  <li>Total recebido na base: {formatCurrency(summary.totalValorPagamento)}</li>
                </ul>
              </div>
            )}
          </section>
        )}
      </>
    );
  }

  function renderContraprestacoesRecebidas() {
    return renderContraprestacoesBase({
      titulo: "Contraprestacoes Recebidas",
      descricao:
        "Modulo dedicado ao tratamento da base de Recebidas e geracao exclusiva dos relatorios mensais de recebidas.",
      nota:
        "O processamento aplica as tratativas operacionais da base, cruza parcelas com Canceladas para manter a mesma regra de comunicacao e exporta apenas os arquivos do escopo de Recebidas.",
      origemLabel: "Base Recebidas",
      hint: recebidasCompetenciaHint,
      status: recebidasStatus,
      errorMessage: recebidasErrorMessage,
      summary: recebidasSummary,
      canSubmit: canSubmitRecebidas,
      onSubmit: handleRecebidasSubmit,
      onFileChange: handleEscrituracaoChange,
      progress: recebidasProgress,
      successLabel: "Executar Fluxo Recebidas",
    });
  }

  function renderContraprestacoesRecuperadas() {
    return renderContraprestacoesBase({
      titulo: "Contraprestacoes Recuperadas",
      descricao:
        "Modulo dedicado ao tratamento da base de Recuperadas e geracao exclusiva dos relatorios mensais de recuperadas.",
      nota:
        "O processamento preserva o cruzamento com Canceladas e exporta apenas a base tratada e os arquivos finais do escopo de Recuperadas.",
      origemLabel: "Base Recuperadas",
      hint: recuperadasCompetenciaHint,
      status: recuperadasStatus,
      errorMessage: recuperadasErrorMessage,
      summary: recuperadasSummary,
      canSubmit: canSubmitRecuperadas,
      onSubmit: handleRecuperadasSubmit,
      onFileChange: handleRecuperadasChange,
      progress: recuperadasProgress,
      successLabel: "Executar Fluxo Recuperadas",
    });
  }

  function renderContraprestacoesCanceladas() {
    const pageStart =
      canceladasRows.length === 0 ? 0 : (canceladasPage - 1) * canceladasPageSize + 1;
    const pageEnd = (canceladasPage - 1) * canceladasPageSize + canceladasRows.length;

    return (
      <>
        <header className={styles.header}>
          <h1>Contraprestacoes Canceladas</h1>
          <p>
            Modulo dedicado ao processamento mensal da base operacional, com atualizacao
            automatica da base historica interna sem duplicidades por No Parc.
          </p>
        </header>

        <section className={styles.card}>
          <button
            type="button"
            className={styles.collapseTrigger}
            onClick={() => setCanceladasProcessOpen((value) => !value)}
          >
            <span>Processamento Mensal da Base (XLSX)</span>
            <ChevronDown
              size={14}
              className={`${styles.menuCaret} ${canceladasProcessOpen ? styles.menuCaretOpen : ""}`}
            />
          </button>

          {canceladasProcessOpen && (
            <form onSubmit={handleCanceladasProcessSubmit} className={`${styles.form} ${styles.collapseContent}`}>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Competencia</span>
                  <input
                    type="month"
                    value={competencia ?? ""}
                    onChange={(event) => setCompetencia(event.target.value)}
                    required
                  />
                  {canceladasCompetenciaHint && (
                    <small className={styles.helper}>{canceladasCompetenciaHint}</small>
                  )}
                </label>

                <label className={styles.field}>
                  <span>Base Canceladas mensal (.xlsx)</span>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleCanceladasProcessChange}
                  />
                  <small className={styles.helper}>
                    Exemplo: BASE CANCELADAS 03.2026 com a aba `original`. O pacote gerado inclui
                    a base tratada e o arquivo final `Mensalidades Canceladas`.
                  </small>
                </label>
              </div>

              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={!canceladasProcessFile || canceladasLoading}
                >
                  {canceladasLoading ? (
                    <LoaderCircle size={15} className={styles.spin} />
                  ) : (
                    <Download size={15} />
                  )}
                  <span>Processar Base Mensal</span>
                </button>
                {renderActionProgress(canceladasProcessProgress)}
              </div>
            </form>
          )}
        </section>

        <section className={styles.card}>
          <button
            type="button"
            className={styles.collapseTrigger}
            onClick={() => setCanceladasFiltersOpen((value) => !value)}
          >
            <span>Filtros de Ano e Mes por Competencia</span>
            <ChevronDown
              size={14}
              className={`${styles.menuCaret} ${canceladasFiltersOpen ? styles.menuCaretOpen : ""}`}
            />
          </button>

          {canceladasFiltersOpen && (
            <div className={`${styles.reportControls} ${styles.collapseContent}`}>
              <label className={styles.fieldInline}>
                <span>Ano</span>
                <select
                  value={canceladasAnoSelecionado}
                  onChange={(event) => setCanceladasAnoSelecionado(event.target.value)}
                  className={styles.filterSelect}
                >
                  <option value="">Todos</option>
                  {canceladasAnosDisponiveis.map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldInline}>
                <span>Mes</span>
                <select
                  value={canceladasMesSelecionado}
                  onChange={(event) => setCanceladasMesSelecionado(event.target.value)}
                  className={styles.filterSelect}
                >
                  <option value="">Todos</option>
                  {canceladasMesesDisponiveis.map((mes) => (
                    <option key={mes} value={mes}>
                      {String(mes).padStart(2, "0")} - {monthLabel(mes)}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.fieldInline}>
                <span>No Parc</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={canceladasNumeroParcBusca}
                  onChange={(event) => setCanceladasNumeroParcBusca(event.target.value)}
                  placeholder="Busca exata"
                />
              </label>

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  setCanceladasPage(1);
                  void loadCanceladas({ page: 1 });
                }}
                disabled={canceladasLoading}
              >
                {canceladasLoading ? (
                  <LoaderCircle size={14} className={styles.spin} />
                ) : (
                  <RefreshCcw size={14} />
                )}
                <span>Aplicar Filtros</span>
              </button>

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  setCanceladasAnoSelecionado("");
                  setCanceladasMesSelecionado("");
                  setCanceladasNumeroParcBusca("");
                  setCanceladasPage(1);
                  void loadCanceladas({ ano: "", mes: "", numeroParc: "", page: 1 });
                }}
                disabled={canceladasLoading}
              >
                <span>Limpar Filtros</span>
              </button>
            </div>
          )}
        </section>

        <section className={styles.feedback}>
          {canceladasError && (
            <p className={styles.errorMsg}>
              <AlertTriangle size={16} />
              {canceladasError}
            </p>
          )}

          {canceladasSuccess && (
            <p className={styles.successMsg}>
              <CheckCircle2 size={16} />
              {canceladasSuccess}
            </p>
          )}

          {canceladasProcessSummary && (
            <div className={styles.summary}>
              <h2>Resumo da Competencia {canceladasProcessSummary.competencia}</h2>
              <ul>
                <li>Registros na base original: {canceladasProcessSummary.registrosEntrada}</li>
                <li>Registros apos tratativa: {canceladasProcessSummary.registrosTratados}</li>
                <li>Registros PF: {canceladasProcessSummary.registrosPf}</li>
                <li>Registros PJ: {canceladasProcessSummary.registrosPj}</li>
                <li>Registros enviados para a base historica: {canceladasProcessSummary.registrosImportados}</li>
                <li className={styles.summaryWarning}>
                  Registros repetidos (No Parc) ignorados: {canceladasProcessSummary.registrosDuplicadosNoParc}
                </li>
                <li>Arquivos gerados no pacote: {canceladasProcessSummary.arquivosGerados}</li>
              </ul>
            </div>
          )}

          {!canceladasError && (
            <p className={styles.infoMsg}>
              Total registrado: {canceladasTotal.toLocaleString("pt-BR")} registros. Valor Emitido:
              {" "}
              {formatCurrency(canceladasTotalValorEmitido)}.
            </p>
          )}

          {!canceladasError && canceladasRows.length === 0 && !canceladasLoading && (
            <p className={styles.infoMsg}>Nenhum registro de Canceladas encontrado.</p>
          )}

          {canceladasRows.length > 0 && (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("competencia")}
                        >
                          <span>Competencia</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "competencia")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("codigo")}
                        >
                          <span>Codigo</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "codigo")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("nome")}
                        >
                          <span>Nome</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "nome")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("emissao")}
                        >
                          <span>Emissao</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "emissao")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("vencimento")}
                        >
                          <span>Vencimento</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "vencimento")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("valorEmitido")}
                        >
                          <span>Valor Emitido</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "valorEmitido")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("numeroParc")}
                        >
                          <span>No Parc</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "numeroParc")}</span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className={styles.sortHeader}
                          onClick={() => handleCanceladasSort("numeroNf")}
                        >
                          <span>No NF</span>
                          <span>{sortIndicator(canceladasSortBy, canceladasSortDir, "numeroNf")}</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {canceladasRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatCompetenciaBr(row.competencia)}</td>
                        <td>{row.codigo}</td>
                        <td>{row.nome}</td>
                        <td>{formatDateBr(row.emissao)}</td>
                        <td>{formatDateBr(row.vencimento)}</td>
                        <td>{formatCurrency(row.valorEmitido)}</td>
                        <td>{row.numeroParc || "-"}</td>
                        <td>{row.numeroNf || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.paginationBar}>
                <span className={styles.pageStats}>
                  Exibindo {pageStart} - {pageEnd} de {canceladasTotal.toLocaleString("pt-BR")}
                </span>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => handleCanceladasPageChange(canceladasPage - 1)}
                  disabled={canceladasLoading || canceladasPage <= 1}
                >
                  <span>Pagina Anterior</span>
                </button>
                <span className={styles.pageStats}>
                  Pagina {canceladasPage} de {Math.max(canceladasTotalPaginas, 1)}
                </span>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => handleCanceladasPageChange(canceladasPage + 1)}
                  disabled={
                    canceladasLoading ||
                    canceladasTotalPaginas === 0 ||
                    canceladasPage >= canceladasTotalPaginas
                  }
                >
                  <span>Proxima Pagina</span>
                </button>
              </div>
            </>
          )}
        </section>
      </>
    );
  }

  function renderContraprestacoesConferencia() {
    const escopos = conferenceSummary?.escopos ?? [];
    const rows = conferenceSummary?.rows ?? [];
    const divergencias = conferenceSummary?.divergencias ?? [];

    return (
      <>
        <header className={styles.header}>
          <h1>Conferencia</h1>
          <p>
            Painel para validacao final dos totais de Recebidas, Recuperadas e saida consolidada
            antes do fechamento contabil.
          </p>
        </header>

        <section className={styles.card}>
          <div className={styles.reportControls}>
            <label className={styles.fieldInline}>
              <span>Competencia</span>
              <input
                type="month"
                value={conferenceCompetencia}
                onChange={(event) => setConferenceCompetencia(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void loadConference()}
            >
              {conferenceState === "loading" ? (
                <LoaderCircle size={14} className={styles.spin} />
              ) : (
                <RefreshCcw size={14} />
              )}
              <span>Atualizar</span>
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void handleDownloadConference()}
              disabled={
                conferenceDownloadState === "loading" ||
                !conferenceSummary?.canDownloadConsolidated
              }
            >
              {conferenceDownloadState === "loading" ? (
                <LoaderCircle size={14} className={styles.spin} />
              ) : (
                <Download size={14} />
              )}
              <span>Baixar Consolidado</span>
            </button>
          </div>
        </section>

        <section className={styles.feedback}>
          {conferenceError && (
            <p className={styles.errorMsg}>
              <AlertTriangle size={16} />
              {conferenceError}
            </p>
          )}

          {!conferenceError && conferenceState === "loading" && (
            <p className={styles.infoMsg}>
              <LoaderCircle size={16} className={styles.spin} />
              Carregando conferencia da competencia {formatCompetenciaBr(conferenceCompetencia)}...
            </p>
          )}

          {!conferenceError && conferenceDownloadState === "success" && (
            <p className={styles.successMsg}>
              <CheckCircle2 size={16} />
              O download do ZIP consolidado desta competencia foi iniciado.
            </p>
          )}

          {!conferenceError && conferenceState === "ready" && conferenceSummary && (
            <div className={styles.summary}>
              <h2>Conferencia da Competencia {conferenceSummary.competencia}</h2>
              <ul>
                <li>Processamentos salvos: {rows.length}</li>
                <li>Escopos prontos para consolidacao: {escopos.filter((item) => item.latest).length}/2</li>
                <li>Divergencias identificadas: {divergencias.length}</li>
              </ul>

              {escopos.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Escopo</th>
                        <th>Status</th>
                        <th>Arquivos</th>
                        <th>Linhas Esperadas</th>
                        <th>Linhas Consolidadas</th>
                        <th>Base Tratada</th>
                        <th>Total Pagamento</th>
                        <th>Processado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {escopos.map((item) => (
                        <tr key={item.escopo}>
                          <td>{item.escopo}</td>
                          <td>{item.status.toUpperCase()}</td>
                          <td>
                            {item.actualArquivos}/{item.expectedArquivos}
                          </td>
                          <td>{item.expectedLinhasSaida}</td>
                          <td>{item.actualLinhasSaida}</td>
                          <td>{item.baseTratadaLinhas}</td>
                          <td>
                            {item.latest
                              ? formatCurrency(item.latest.totalValorPagamento)
                              : "-"}
                          </td>
                          <td>{item.latest ? formatDate(item.latest.criadoEm) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {divergencias.length > 0 ? (
                <div className={styles.warnings}>
                  <h3>Divergencias encontradas</h3>
                  <ul>
                    {divergencias.map((item, index) => (
                      <li key={`${item.escopo}-${index}`}>
                        [{item.severity.toUpperCase()}] {item.escopo}: {item.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className={styles.warnings}>
                  <h3>Resultado da conferencia</h3>
                  <p className={styles.successMsg}>
                    <CheckCircle2 size={16} />
                    Nenhuma divergencia foi encontrada entre as bases tratadas e os arquivos finais
                    salvos.
                  </p>
                </div>
              )}
            </div>
          )}

          {!conferenceError && conferenceState === "ready" && conferenceSummary && rows.length > 0 && (
            <div className={styles.auditPanel}>
              <h3>Historico salvo na competencia</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Escopo</th>
                      <th>ZIP Salvo</th>
                      <th>Arquivos</th>
                      <th>Tratados</th>
                      <th>Recebidas</th>
                      <th>Recuperadas</th>
                      <th>Devolucoes</th>
                      <th>Processado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.escopo}</td>
                        <td>{row.arquivoNome}</td>
                        <td>{row.reportFiles.length}</td>
                        <td>{row.registrosTratados}</td>
                        <td>{row.recebidas}</td>
                        <td>{row.recuperadas}</td>
                        <td>{row.devolucoes}</td>
                        <td>{formatDate(row.criadoEm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderConfiguracoes() {
    return (
      <>
        <header className={styles.header}>
          <h1>Configuracoes</h1>
          <p>
            Defina as tarifas usadas nos relatorios de contraprestacoes. Os valores salvos passam
            a valer nos proximos processamentos de Recebidas e Recuperadas.
          </p>
          <p className={styles.ruleNote}>
            As configuracoes ficam gravadas neste navegador. Se acessar em outra maquina, sera
            preciso informar novamente.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={handleSettingsSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Tarifa do cartao de debito</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={settingsValues.tarifaCartaoDebito}
                  onChange={(event) =>
                    updateSettingsValue("tarifaCartaoDebito", event.target.value)
                  }
                  required
                />
                <small className={styles.helper}>
                  Informe em decimal. Exemplo: 0.0069 = 0,69%.
                </small>
              </label>

              <label className={styles.field}>
                <span>Tarifa do cartao de credito</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={settingsValues.tarifaCartaoCredito}
                  onChange={(event) =>
                    updateSettingsValue("tarifaCartaoCredito", event.target.value)
                  }
                  required
                />
                <small className={styles.helper}>
                  Informe em decimal. Exemplo: 0.0115 = 1,15%.
                </small>
              </label>

              <label className={styles.field}>
                <span>Tarifa em debito em conta</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsValues.tarifaDebitoEmConta}
                  onChange={(event) =>
                    updateSettingsValue("tarifaDebitoEmConta", event.target.value)
                  }
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Tarifa valor fixo do PIX</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={settingsValues.tarifaPixFixo}
                  onChange={(event) =>
                    updateSettingsValue("tarifaPixFixo", event.target.value)
                  }
                  required
                />
              </label>
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn}>
                <CheckCircle2 size={15} />
                <span>Salvar Configuracoes</span>
              </button>
            </div>
          </form>
        </section>

        {(settingsStatus === "success" || settingsStatus === "error") && settingsMessage && (
          <section className={styles.feedback}>
            {settingsStatus === "success" ? (
              <p className={styles.successMsg}>
                <CheckCircle2 size={16} />
                {settingsMessage}
              </p>
            ) : (
              <p className={styles.errorMsg}>
                <AlertTriangle size={16} />
                {settingsMessage}
              </p>
            )}
          </section>
        )}
      </>
    );
  }

  function renderContraprestacoes() {
    if (activeContraprestacoesModule === "canceladas") return renderContraprestacoesCanceladas();
    if (activeContraprestacoesModule === "recebidas") return renderContraprestacoesRecebidas();
    if (activeContraprestacoesModule === "recuperadas") return renderContraprestacoesRecuperadas();
    return renderContraprestacoesConferencia();
  }

  function renderAging() {
    return (
      <>
        <header className={styles.header}>
          <h1>Aging</h1>
          <p>Tratamento de Aging de mensalidades e preenchimento da base Contabilidade.</p>
          <p className={styles.ruleNote}>Exclui parcelas sem Lote NF, NFs emitidas após a competência e pagamentos realizados até o fim da competência. O valor lançado é Imposto + Título.</p>
        </header>
        <section className={styles.card}>
          <form onSubmit={handleAgingSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}><span>Competencia</span><input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} required />{agingHint && <small className={styles.helper}>{agingHint}</small>}</label>
              <label className={styles.field}><span>Arquivo base Contabilidade (.xlsx)</span><input type="file" accept=".xlsx" onChange={(event) => setAgingContabilidadeFile(event.target.files?.[0] ?? null)} required /></label>
              <label className={styles.field}><span>Base Aging Mensalidades (.xlsx)</span><input type="file" accept=".xlsx" onChange={handleAgingBaseChange} required /></label>
            </div>
            <div className={styles.actions}><button type="submit" disabled={!agingContabilidadeFile || !agingBaseFile || agingStatus === "loading"} className={styles.primaryBtn}>{agingStatus === "loading" ? <LoaderCircle size={15} className={styles.spin} /> : <Download size={15} />}<span>Executar Aging</span></button>{renderActionProgress(agingProgress)}</div>
          </form>
        </section>
        {(agingStatus === "error" || agingStatus === "success" || agingSummary) && <section className={styles.feedback}>{agingStatus === "error" && <p className={styles.errorMsg}><AlertTriangle size={16} />{agingError}</p>}{agingStatus === "success" && <p className={styles.successMsg}><CheckCircle2 size={16} />Arquivo Aging processado e baixado.</p>}{agingSummary && <div className={styles.summary}><h2>Resumo da Competencia {agingSummary.competencia}</h2><ul><li>Entradas: {agingSummary.registrosEntrada}</li><li>Tratados: {agingSummary.registrosTratados}</li><li>PF: {agingSummary.registrosPf}</li><li>PJ: {agingSummary.registrosPj}</li><li>Excluidos sem lote: {agingSummary.excluidosSemLote}</li><li>Excluidos por emissão: {agingSummary.excluidosEmissao}</li><li>Excluidos por pagamento: {agingSummary.excluidosPagamento}</li></ul></div>}</section>}
      </>
    );
  }

  function renderRelatorios() {
    const selectedRow =
      selectedReportId !== null
        ? reportRows.find((row) => row.id === selectedReportId) ?? null
        : null;
    const auditoriaRows = Array.isArray(selectedRow?.auditoria?.porGrupo)
      ? selectedRow.auditoria.porGrupo
      : [];

    return (
      <>
        <header className={styles.header}>
          <h1>Relatorios</h1>
          <p>Consulte o historico de processamentos de Eventos por competencia.</p>
        </header>

        <section className={styles.card}>
          <div className={styles.reportControls}>
            <label className={styles.fieldInline}>
              <span>Competencia</span>
              <input
                type="month"
                value={reportCompetencia}
                onChange={(event) => setReportCompetencia(event.target.value)}
              />
            </label>
            <button type="button" className={styles.secondaryBtn} onClick={() => void loadReports()}>
              {reportsState === "loading" ? (
                <LoaderCircle size={14} className={styles.spin} />
              ) : (
                <RefreshCcw size={14} />
              )}
              <span>Atualizar</span>
            </button>
          </div>
        </section>

        <section className={styles.feedback}>
          {reportsError && (
            <p className={styles.errorMsg}>
              <AlertTriangle size={16} />
              {reportsError}
            </p>
          )}

          {reportsState === "loading" && (
            <p className={styles.infoMsg}>
              <LoaderCircle size={16} className={styles.spin} />
              Carregando relatorios...
            </p>
          )}

          {reportsState === "ready" && reportRows.length === 0 && (
            <p className={styles.infoMsg}>Nenhum relatorio encontrado para o filtro informado.</p>
          )}

          {reportRows.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Competencia</th>
                    <th>Conhecidos Entrada</th>
                    <th>Liquidados Entrada</th>
                    <th>Conhecidos Validos</th>
                    <th>Liquidados Finais</th>
                    <th>Excluidos KITS</th>
                    <th>Lotes Adicionados</th>
                    <th>Processado em</th>
                    <th>Auditoria</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.competencia}</td>
                      <td>{row.entradaConhecidos}</td>
                      <td>{row.entradaLiquidados}</td>
                      <td>{row.conhecidosClassificados}</td>
                      <td>{row.liquidadosClassificados}</td>
                      <td>{row.excluidosKits + row.excluidosValorZero}</td>
                      <td>{row.lotesAdicionadosNoConhecido}</td>
                      <td>{formatDate(row.criadoEm)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => setSelectedReportId(row.id)}
                        >
                          Ver detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedRow && (
            <div className={styles.auditPanel}>
              <h3>Auditoria da competencia {selectedRow.competencia}</h3>
              <div className={styles.auditChips}>
                <span>
                  Lotes adicionados em conhecidos: {selectedRow.auditoria.lotesAdicionados.length}
                </span>
                <span>
                  Lotes somente em conhecidos:{" "}
                  {selectedRow.auditoria.lotesSomenteConhecidos.length}
                </span>
                <span>
                  Lotes somente no liquidado:{" "}
                  {selectedRow.auditoria.lotesSomenteLiquidados.length}
                </span>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Segmento</th>
                      <th>Tipo</th>
                      <th>Qtd</th>
                      <th>VL. BRUTO</th>
                      <th>LIQUIDO</th>
                      <th>TOTAL PAGO</th>
                      <th>INSS</th>
                      <th>ISS</th>
                      <th>IR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditoriaRows.map((item) => (
                      <tr
                        key={`${item.origem}-${item.segmento}-${item.tipoPessoa}`}
                      >
                        <td>{item.origem}</td>
                        <td>{item.segmento}</td>
                        <td>{item.tipoPessoa}</td>
                        <td>{item.quantidade}</td>
                        <td>{formatCurrency(item.totalVlBruto)}</td>
                        <td>{formatCurrency(item.totalLiquido)}</td>
                        <td>{formatCurrency(item.totalPago)}</td>
                        <td>{formatCurrency(item.totalInss)}</td>
                        <td>{formatCurrency(item.totalIss)}</td>
                        <td>{formatCurrency(item.totalIr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderGuideModal() {
    if (!guideOpen) return null;

    return (
      <div className={styles.guideOverlay} onClick={() => setGuideOpen(false)}>
        <section className={styles.guideModal} onClick={(event) => event.stopPropagation()}>
          <header className={styles.guideHeader}>
            <h2>Guia de Uso - Contabilidade</h2>
            <button
              type="button"
              className={styles.guideClose}
              onClick={() => setGuideOpen(false)}
              aria-label="Fechar guia"
            >
              <X size={16} />
            </button>
          </header>

          <div className={styles.guideBody}>
            <p>
              Este sistema organiza os processamentos contabeis em modulos. Use o menu lateral para
              navegar entre Eventos, Contraprestacoes e Relatorios.
            </p>

            <h3>1. Eventos</h3>
            <p>
              Para gerar os arquivos de conhecidos e liquidados, informe a competencia, anexe os
              dois arquivos de entrada e clique em exportar.
            </p>

            <h3>2. Contraprestacoes Canceladas</h3>
            <p>Fluxo recomendado:</p>
            <ul>
              <li>Use Processamento Mensal para tratar a base operacional, gerar o arquivo final PF/PJ e alimentar o historico.</li>
              <li>O historico evita duplicidades com base no No Parc.</li>
              <li>Aplique filtros de Ano e Mes por Vencimento para consulta.</li>
              <li>Navegue pelos resultados com paginação de 100 registros por pagina.</li>
            </ul>

            <h3>3. Contraprestacoes Recebidas</h3>
            <p>
              Informe a competencia, envie a base de Recebidas e execute o fluxo dedicado para
              gerar apenas os relatorios de recebidas.
            </p>

            <h3>4. Contraprestacoes Recuperadas</h3>
            <p>
              Informe a competencia, envie a base de Recuperadas e execute o fluxo dedicado para
              gerar apenas os relatorios de recuperadas.
            </p>

            <h3>5. Configuracoes</h3>
            <p>
              Antes de processar contraprestacoes, revise as tarifas de cartao, debito em conta e
              PIX para garantir que os calculos usem os valores vigentes.
            </p>

            <h3>6. Relatorios</h3>
            <p>
              Consulte o historico de processamentos por competencia e use Ver detalhes para
              auditoria e conferencia.
            </p>

            <h3>Boas praticas operacionais</h3>
            <ul>
              <li>Confirme a competencia antes de processar.</li>
              <li>Use arquivos em formato .xlsx.</li>
              <li>Após cada processamento mensal, valide total de registros e paginas no modulo Canceladas.</li>
              <li>Use No Parc para auditoria de duplicidades no historico.</li>
            </ul>
          </div>
        </section>
      </div>
    );
  }

  const showContraprestacoesSubmenu = contraprestacoesMenuOpen;

  return (
    <div className={`${styles.app} ${sidebarCollapsed ? styles.appCollapsed : ""}`}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
        <div className={styles.brand}>
          <Calculator className={styles.brandIcon} />
          {!sidebarCollapsed && <span className={styles.brandLabel}>Odontoart Contabil</span>}
          <button
            type="button"
            className={styles.sidebarToggle}
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Contrair menu lateral"}
            title={sidebarCollapsed ? "Expandir sidebar" : "Contrair sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        <nav className={styles.modules}>
          <button
            type="button"
            className={`${styles.moduleItem} ${
              activeModule === "eventos" ? styles.active : ""
            }`}
            title="Eventos"
            onClick={() => setActiveModule("eventos")}
          >
            <Layers3 size={16} />
            {!sidebarCollapsed && <span className={styles.moduleLabel}>Eventos</span>}
          </button>
          <button type="button" className={`${styles.moduleItem} ${activeModule === "aging" ? styles.active : ""}`} title="Aging" onClick={() => setActiveModule("aging")}>
            <FileSpreadsheet size={16} />
            {!sidebarCollapsed && <span className={styles.moduleLabel}>Aging</span>}
          </button>
          <div className={styles.menuGroup}>
            <button
              type="button"
              className={`${styles.moduleItem} ${styles.menuParent} ${
                activeModule === "contraprestacoes" ? styles.active : ""
              }`}
              title="Contraprestacoes"
              onClick={() => {
                setActiveModule("contraprestacoes");
                setContraprestacoesMenuOpen((value) => !value);
              }}
            >
              <span className={styles.menuParentMain}>
                <FileSpreadsheet size={16} />
                {!sidebarCollapsed && (
                  <span className={styles.moduleLabel}>Contraprestacoes</span>
                )}
              </span>
              {!sidebarCollapsed && (
                <ChevronDown
                  size={14}
                  className={`${styles.menuCaret} ${
                    contraprestacoesMenuOpen ? styles.menuCaretOpen : ""
                  }`}
                />
              )}
            </button>

            {showContraprestacoesSubmenu && (
              <div
                className={`${styles.subMenu} ${
                  sidebarCollapsed ? styles.subMenuCollapsed : ""
                }`}
              >
                <button
                  type="button"
                  className={`${styles.subMenuItem} ${
                    activeModule === "contraprestacoes" &&
                    activeContraprestacoesModule === "canceladas"
                      ? styles.activeSubMenuItem
                      : ""
                  }`}
                  onClick={() => {
                    setActiveModule("contraprestacoes");
                    setActiveContraprestacoesModule("canceladas");
                    if (sidebarCollapsed) setContraprestacoesMenuOpen(false);
                  }}
                >
                  Canceladas
                </button>
                <button
                  type="button"
                  className={`${styles.subMenuItem} ${
                    activeModule === "contraprestacoes" &&
                    activeContraprestacoesModule === "recebidas"
                      ? styles.activeSubMenuItem
                      : ""
                  }`}
                  onClick={() => {
                    setActiveModule("contraprestacoes");
                    setActiveContraprestacoesModule("recebidas");
                    if (sidebarCollapsed) setContraprestacoesMenuOpen(false);
                  }}
                >
                  Recebidas
                </button>
                <button
                  type="button"
                  className={`${styles.subMenuItem} ${
                    activeModule === "contraprestacoes" &&
                    activeContraprestacoesModule === "recuperadas"
                      ? styles.activeSubMenuItem
                      : ""
                  }`}
                  onClick={() => {
                    setActiveModule("contraprestacoes");
                    setActiveContraprestacoesModule("recuperadas");
                    if (sidebarCollapsed) setContraprestacoesMenuOpen(false);
                  }}
                >
                  Recuperadas
                </button>
                <button
                  type="button"
                  className={`${styles.subMenuItem} ${
                    activeModule === "contraprestacoes" &&
                    activeContraprestacoesModule === "conferencia"
                      ? styles.activeSubMenuItem
                      : ""
                  }`}
                  onClick={() => {
                    setActiveModule("contraprestacoes");
                    setActiveContraprestacoesModule("conferencia");
                    if (sidebarCollapsed) setContraprestacoesMenuOpen(false);
                  }}
                >
                  Conferencia
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`${styles.moduleItem} ${
              activeModule === "configuracoes" ? styles.active : ""
            }`}
            title="Configuracoes"
            onClick={() => setActiveModule("configuracoes")}
          >
            <Settings size={16} />
            {!sidebarCollapsed && <span className={styles.moduleLabel}>Configuracoes</span>}
          </button>
          <button
            type="button"
            className={`${styles.moduleItem} ${
              activeModule === "relatorios" ? styles.active : ""
            }`}
            title="Relatorios"
            onClick={() => setActiveModule("relatorios")}
          >
            <FolderOpen size={16} />
            {!sidebarCollapsed && <span className={styles.moduleLabel}>Relatorios</span>}
          </button>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainToolbar}>
          <button type="button" className={styles.guideTrigger} onClick={() => setGuideOpen(true)}>
            <CircleHelp size={15} />
            <span>Como usar</span>
          </button>
        </div>
        {activeModule === "eventos"
          ? renderEventos()
          : activeModule === "aging"
            ? renderAging()
          : activeModule === "contraprestacoes"
            ? renderContraprestacoes()
            : activeModule === "configuracoes"
              ? renderConfiguracoes()
              : renderRelatorios()}
      </main>
      {renderGuideModal()}
    </div>
  );
}

