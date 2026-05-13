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
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Layers3,
  LoaderCircle,
  RefreshCcw,
  X,
} from "lucide-react";
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
  competencia: string;
  entradaEscrituracao: number;
  saidaPf: number;
  saidaPj: number;
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

interface CanceladasManualForm {
  competencia: string;
  codigo: string;
  nome: string;
  emissao: string;
  vencimento: string;
  valorEmitido: string;
  numeroParc: string;
  numeroNf: string;
}

type SubmitState = "idle" | "loading" | "success" | "error";
type Module = "eventos" | "relatorios" | "contraprestacoes";
type ContraprestacoesModule = "canceladas" | "recebidasRecuperadas" | "conferencia";
type ReportsState = "idle" | "loading" | "ready" | "error";

const DEFAULT_ERROR =
  "Nao foi possivel processar os eventos agora. Confira os arquivos e tente novamente.";
const DEFAULT_CONTRAP_ERROR =
  "Nao foi possivel gerar o arquivo de contraprestacoes agora. Confira a base e tente novamente.";

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

function formatDateBr(value: string | null): string {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function isValidCompetencia(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

export default function Home() {
  const [activeModule, setActiveModule] = useState<Module>("eventos");
  const [activeContraprestacoesModule, setActiveContraprestacoesModule] =
    useState<ContraprestacoesModule>("recebidasRecuperadas");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contraprestacoesMenuOpen, setContraprestacoesMenuOpen] = useState(true);
  const [competencia, setCompetencia] = useState("");
  const [knownFile, setKnownFile] = useState<File | null>(null);
  const [liquidFile, setLiquidFile] = useState<File | null>(null);
  const [status, setStatus] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState<ProcessSummary | null>(null);
  const [competenciaHint, setCompetenciaHint] = useState("");
  const detectRequestRef = useRef(0);
  const [escrituracaoFile, setEscrituracaoFile] = useState<File | null>(null);
  const [contrapStatus, setContrapStatus] = useState<SubmitState>("idle");
  const [contrapErrorMessage, setContrapErrorMessage] = useState("");
  const [contrapSummary, setContrapSummary] = useState<ContraprestacoesSummary | null>(null);
  const [contrapCompetenciaHint, setContrapCompetenciaHint] = useState("");

  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportsState, setReportsState] = useState<ReportsState>("idle");
  const [reportsError, setReportsError] = useState("");
  const [reportCompetencia, setReportCompetencia] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const hasLoadedReportsRef = useRef(false);
  const hasLoadedCanceladasRef = useRef(false);

  const [canceladasRows, setCanceladasRows] = useState<CanceladaRow[]>([]);
  const [canceladasLoading, setCanceladasLoading] = useState(false);
  const [canceladasError, setCanceladasError] = useState("");
  const [canceladasSuccess, setCanceladasSuccess] = useState("");
  const [canceladasImportFile, setCanceladasImportFile] = useState<File | null>(null);
  const [canceladasAnosDisponiveis, setCanceladasAnosDisponiveis] = useState<number[]>([]);
  const [canceladasMesesDisponiveis, setCanceladasMesesDisponiveis] = useState<number[]>([]);
  const [canceladasAnoSelecionado, setCanceladasAnoSelecionado] = useState("");
  const [canceladasMesSelecionado, setCanceladasMesSelecionado] = useState("");
  const [canceladasPage, setCanceladasPage] = useState(1);
  const [canceladasPageSize] = useState(100);
  const [canceladasTotal, setCanceladasTotal] = useState(0);
  const [canceladasTotalPaginas, setCanceladasTotalPaginas] = useState(0);
  const [canceladasImportOpen, setCanceladasImportOpen] = useState(false);
  const [canceladasManualOpen, setCanceladasManualOpen] = useState(false);
  const [canceladasFiltersOpen, setCanceladasFiltersOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [canceladasManualForm, setCanceladasManualForm] = useState<CanceladasManualForm>({
    competencia: "",
    codigo: "",
    nome: "",
    emissao: "",
    vencimento: "",
    valorEmitido: "",
    numeroParc: "",
    numeroNf: "",
  });

  const canSubmit = useMemo(
    () => Boolean(knownFile && liquidFile && competencia) && status !== "loading",
    [knownFile, liquidFile, competencia, status],
  );
  const canSubmitContraprestacoes = useMemo(
    () => Boolean(escrituracaoFile && competencia) && contrapStatus !== "loading",
    [escrituracaoFile, competencia, contrapStatus],
  );

  useEffect(() => {
    const month = currentMonth();
    setCompetencia((current) => current || month);
    setCanceladasManualForm((current) => ({
      ...current,
      competencia: current.competencia || month,
    }));
  }, []);

  async function detectCompetenciaFromFile(
    file: File | null,
    origem: string,
    setHint: Dispatch<SetStateAction<string>>,
  ) {
    if (!file) return;

    detectRequestRef.current += 1;
    const requestId = detectRequestRef.current;

    const formData = new FormData();
    formData.append("arquivo", file);

    try {
      const response = await fetch("/api/eventos/competencia", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        competencia?: string | null;
        message?: string;
      };

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
    setEscrituracaoFile(file);
    void detectCompetenciaFromFile(file, "Escrituracao", setContrapCompetenciaHint);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!knownFile || !liquidFile) return;

    setStatus("loading");
    setErrorMessage("");
    setSummary(null);

    const formData = new FormData();
    formData.append("competencia", competencia);
    formData.append("conhecidos", knownFile);
    formData.append("liquidados", liquidFile);

    try {
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

      setStatus("success");
      if (activeModule === "relatorios") {
        void loadReports();
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : DEFAULT_ERROR);
    }
  }

  async function handleContraprestacoesSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!escrituracaoFile) return;

    setContrapStatus("loading");
    setContrapErrorMessage("");
    setContrapSummary(null);

    const formData = new FormData();
    formData.append("competencia", competencia);
    formData.append("escrituracao", escrituracaoFile);

    try {
      const response = await fetch("/api/contraprestacoes/processar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(payload?.message || DEFAULT_CONTRAP_ERROR);
      }

      const summaryHeader = response.headers.get("x-odonto-contrap-summary");
      if (summaryHeader) {
        const decoded = atob(summaryHeader);
        setContrapSummary(JSON.parse(decoded) as ContraprestacoesSummary);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename=\"(.+)\"/)?.[1] ?? "Faturamento-Equacao.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      setContrapStatus("success");
    } catch (error) {
      setContrapStatus("error");
      setContrapErrorMessage(error instanceof Error ? error.message : DEFAULT_CONTRAP_ERROR);
    }
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
    async (override?: { ano?: string; mes?: string; page?: number }) => {
    setCanceladasLoading(true);
    setCanceladasError("");
    setCanceladasSuccess("");

    try {
      const anoAtivo = override?.ano ?? canceladasAnoSelecionado;
      const mesAtivo = override?.mes ?? canceladasMesSelecionado;
      const pageAtiva = override?.page ?? canceladasPage;
      const params = new URLSearchParams();
      if (anoAtivo) {
        params.set("anos", anoAtivo);
      }
      if (mesAtivo) {
        params.set("meses", mesAtivo);
      }
      params.set("page", String(pageAtiva));
      params.set("pageSize", String(canceladasPageSize));

      const response = await fetch(
        `/api/contraprestacoes/canceladas/registros?${params.toString()}`,
        { method: "GET" },
      );

      const payload = (await response.json()) as {
        rows?: CanceladaRow[];
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
      setCanceladasTotal(payload.paginacao?.total ?? 0);
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
    [canceladasAnoSelecionado, canceladasMesSelecionado, canceladasPage, canceladasPageSize],
  );

  async function handleCanceladasImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canceladasImportFile) return;

    setCanceladasLoading(true);
    setCanceladasError("");
    setCanceladasSuccess("");

    try {
      const formData = new FormData();
      formData.append("arquivo", canceladasImportFile);

      const response = await fetch("/api/contraprestacoes/canceladas/importar", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        inserted?: number;
        competencias?: string[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "Nao foi possivel importar a base de Canceladas.");
      }

      const competenciasTexto =
        payload.competencias && payload.competencias.length > 0
          ? ` Competencias: ${payload.competencias.join(", ")}.`
          : "";
      setCanceladasSuccess(
        `Importacao concluida com ${payload.inserted ?? 0} registros.${competenciasTexto}`,
      );
      setCanceladasImportFile(null);
      setCanceladasPage(1);
      await loadCanceladas({ page: 1 });
    } catch (error) {
      setCanceladasError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel importar a base de Canceladas.",
      );
    } finally {
      setCanceladasLoading(false);
    }
  }

  async function handleCanceladasManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCanceladasLoading(true);
    setCanceladasError("");
    setCanceladasSuccess("");

    try {
      const response = await fetch("/api/contraprestacoes/canceladas/registros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: canceladasManualForm.competencia,
          codigo: canceladasManualForm.codigo,
          nome: canceladasManualForm.nome,
          emissao: canceladasManualForm.emissao || null,
          vencimento: canceladasManualForm.vencimento || null,
          valorEmitido: canceladasManualForm.valorEmitido
            ? Number(canceladasManualForm.valorEmitido)
            : 0,
          numeroParc: canceladasManualForm.numeroParc,
          numeroNf: canceladasManualForm.numeroNf,
        }),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "Nao foi possivel incluir registro manual.");
      }

      setCanceladasSuccess("Registro manual inserido com sucesso.");
      setCanceladasManualForm((current) => ({
        ...current,
        codigo: "",
        nome: "",
        emissao: "",
        vencimento: "",
        valorEmitido: "",
        numeroParc: "",
        numeroNf: "",
      }));
      setCanceladasPage(1);
      await loadCanceladas({ page: 1 });
    } catch (error) {
      setCanceladasError(
        error instanceof Error ? error.message : "Nao foi possivel incluir registro manual.",
      );
    } finally {
      setCanceladasLoading(false);
    }
  }

  function handleCanceladasPageChange(nextPage: number) {
    if (nextPage < 1) return;
    if (canceladasTotalPaginas > 0 && nextPage > canceladasTotalPaginas) return;
    setCanceladasPage(nextPage);
    void loadCanceladas({ page: nextPage });
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

  function renderContraprestacoesRecebidasRecuperadas() {
    return (
      <>
        <header className={styles.header}>
          <h1>Contraprestacoes Emitidas</h1>
          <p>
            Fluxo integrado para tratar a base de Recebidas, classificar Recuperadas por
            cruzamento de parcela e gerar os arquivos de saida por canal.
          </p>
          <p className={styles.ruleNote}>
            A base de entrada e unica (Recebidas). As Recuperadas sao derivadas no mesmo fluxo,
            com dependencia do historico de Canceladas para marcacao de parcelas.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={handleContraprestacoesSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Competencia</span>
                <input
                  type="month"
                  value={competencia ?? ""}
                  onChange={(event) => setCompetencia(event.target.value)}
                  required
                />
                {contrapCompetenciaHint && (
                  <small className={styles.helper}>{contrapCompetenciaHint}</small>
                )}
              </label>

              <label className={styles.field}>
                <span>Base Recebidas (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleEscrituracaoChange}
                  required
                />
              </label>
            </div>

            <div className={styles.actions}>
              <button
                type="submit"
                disabled={!canSubmitContraprestacoes}
                className={styles.primaryBtn}
              >
                {contrapStatus === "loading" ? (
                  <LoaderCircle size={15} className={styles.spin} />
                ) : (
                  <Download size={15} />
                )}
                <span>Executar Fluxo Emitidas</span>
              </button>
            </div>
          </form>
        </section>

        {(contrapStatus === "error" || contrapStatus === "success" || contrapSummary) && (
          <section className={styles.feedback}>
            {contrapStatus === "error" && (
              <p className={styles.errorMsg}>
                <AlertTriangle size={16} />
                {contrapErrorMessage}
              </p>
            )}

            {contrapStatus === "success" && (
              <p className={styles.successMsg}>
                <CheckCircle2 size={16} />
                Processamento concluido. O download da saida de Emitidas foi iniciado.
              </p>
            )}

            {contrapSummary && (
              <div className={styles.summary}>
                <h2>Resumo da Competencia {contrapSummary.competencia}</h2>
                <ul>
                  <li>Entradas Escrituracao: {contrapSummary.entradaEscrituracao}</li>
                  <li>Saida PF Clinico: {contrapSummary.saidaPf}</li>
                  <li>Saida PJ: {contrapSummary.saidaPj}</li>
                </ul>
              </div>
            )}
          </section>
        )}
      </>
    );
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
            Modulo dedicado para importar a base mensal de canceladas, aplicar tratativas e
            alimentar o consolidado historico.
          </p>
        </header>

        <section className={styles.card}>
          <button
            type="button"
            className={styles.collapseTrigger}
            onClick={() => setCanceladasImportOpen((value) => !value)}
          >
            <span>Importacao de Base (XLSX)</span>
            <ChevronDown
              size={14}
              className={`${styles.menuCaret} ${canceladasImportOpen ? styles.menuCaretOpen : ""}`}
            />
          </button>

          {canceladasImportOpen && (
            <form onSubmit={handleCanceladasImportSubmit} className={`${styles.form} ${styles.collapseContent}`}>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Base consolidada (XLSX)</span>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => setCanceladasImportFile(event.target.files?.[0] ?? null)}
                  />
                  <small className={styles.helper}>
                    Exemplo: Rel total mensalidades canc 2020 a 2026.
                  </small>
                </label>
              </div>

              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={!canceladasImportFile || canceladasLoading}
                >
                  {canceladasLoading ? (
                    <LoaderCircle size={15} className={styles.spin} />
                  ) : (
                    <Download size={15} />
                  )}
                  <span>Importar XLSX</span>
                </button>
              </div>
            </form>
          )}
        </section>

        <section className={styles.card}>
          <button
            type="button"
            className={styles.collapseTrigger}
            onClick={() => setCanceladasManualOpen((value) => !value)}
          >
            <span>Inclusao Manual</span>
            <ChevronDown
              size={14}
              className={`${styles.menuCaret} ${canceladasManualOpen ? styles.menuCaretOpen : ""}`}
            />
          </button>

          {canceladasManualOpen && (
            <form onSubmit={handleCanceladasManualSubmit} className={`${styles.form} ${styles.collapseContent}`}>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Competencia</span>
                  <input
                    type="month"
                    value={canceladasManualForm.competencia}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        competencia: event.target.value,
                      }))
                    }
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Codigo</span>
                  <input
                    type="text"
                    value={canceladasManualForm.codigo}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        codigo: event.target.value,
                      }))
                    }
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Nome</span>
                  <input
                    type="text"
                    value={canceladasManualForm.nome}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        nome: event.target.value,
                      }))
                    }
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Emissao</span>
                  <input
                    type="date"
                    value={canceladasManualForm.emissao}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        emissao: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Vencimento</span>
                  <input
                    type="date"
                    value={canceladasManualForm.vencimento}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        vencimento: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Valor Emitido</span>
                  <input
                    type="number"
                    step="0.01"
                    value={canceladasManualForm.valorEmitido}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        valorEmitido: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>No Parc</span>
                  <input
                    type="text"
                    value={canceladasManualForm.numeroParc}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        numeroParc: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>No NF</span>
                  <input
                    type="text"
                    value={canceladasManualForm.numeroNf}
                    onChange={(event) =>
                      setCanceladasManualForm((current) => ({
                        ...current,
                        numeroNf: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn} disabled={canceladasLoading}>
                  {canceladasLoading ? (
                    <LoaderCircle size={15} className={styles.spin} />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  <span>Adicionar Registro Manual</span>
                </button>
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
            <span>Filtros de Ano e Mes</span>
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
                  setCanceladasPage(1);
                  void loadCanceladas({ ano: "", mes: "", page: 1 });
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

          {!canceladasError && (
            <p className={styles.infoMsg}>
              Total registrado: {canceladasTotal.toLocaleString("pt-BR")} registros.
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
                      <th>Competencia</th>
                      <th>Codigo</th>
                      <th>Nome</th>
                      <th>Emissao</th>
                      <th>Vencimento</th>
                      <th>Valor Emitido</th>
                      <th>No Parc</th>
                      <th>No NF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {canceladasRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.competencia}</td>
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
    return (
      <>
        <header className={styles.header}>
          <h1>Conferencia</h1>
          <p>
            Painel para validacao final dos totais de Emitidas e Recuperadas antes do fechamento
            contabil.
          </p>
        </header>

        <section className={styles.feedback}>
          <p className={styles.infoMsg}>
            <FolderOpen size={16} />
            Este submenu consolida os arquivos de saida e destaca divergencias para revisao.
          </p>
        </section>
      </>
    );
  }

  function renderContraprestacoes() {
    if (activeContraprestacoesModule === "canceladas") return renderContraprestacoesCanceladas();
    if (activeContraprestacoesModule === "conferencia") return renderContraprestacoesConferencia();
    return renderContraprestacoesRecebidasRecuperadas();
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
              <li>Abra Importacao de Base e envie o arquivo consolidado em .xlsx.</li>
              <li>Use Inclusao Manual para ajustes pontuais de registros.</li>
              <li>Aplique filtros de Ano e Mes para consulta.</li>
              <li>Navegue pelos resultados com paginação de 100 registros por pagina.</li>
            </ul>

            <h3>3. Contraprestacoes Emitidas</h3>
            <p>
              Informe a competencia, envie a base de Recebidas e execute o fluxo integrado para
              gerar as saidas de Emitidas e Recuperadas.
            </p>

            <h3>4. Relatorios</h3>
            <p>
              Consulte o historico de processamentos por competencia e use Ver detalhes para
              auditoria e conferencia.
            </p>

            <h3>Boas praticas operacionais</h3>
            <ul>
              <li>Confirme a competencia antes de processar.</li>
              <li>Use arquivos em formato .xlsx.</li>
              <li>Após importacoes, valide total de registros e paginas no modulo Canceladas.</li>
              <li>Em caso de divergencia, ajuste via Inclusao Manual e recarregue os filtros.</li>
            </ul>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`${styles.app} ${sidebarCollapsed ? styles.appCollapsed : ""}`}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
        <div className={styles.brand}>
          <Building2 className={styles.brandIcon} />
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
          <div className={styles.menuGroup}>
            <button
              type="button"
              className={`${styles.moduleItem} ${styles.menuParent} ${
                activeModule === "contraprestacoes" ? styles.active : ""
              }`}
              title="Contraprestacoes"
              onClick={() => {
                if (sidebarCollapsed) {
                  setActiveModule("contraprestacoes");
                  return;
                }
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

            {!sidebarCollapsed && contraprestacoesMenuOpen && (
              <div className={styles.subMenu}>
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
                  }}
                >
                  Canceladas
                </button>
                <button
                  type="button"
                  className={`${styles.subMenuItem} ${
                    activeModule === "contraprestacoes" &&
                    activeContraprestacoesModule === "recebidasRecuperadas"
                      ? styles.activeSubMenuItem
                      : ""
                  }`}
                  onClick={() => {
                    setActiveModule("contraprestacoes");
                    setActiveContraprestacoesModule("recebidasRecuperadas");
                  }}
                >
                  Emitidas
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
          : activeModule === "contraprestacoes"
            ? renderContraprestacoes()
            : renderRelatorios()}
      </main>
      {renderGuideModal()}
    </div>
  );
}

