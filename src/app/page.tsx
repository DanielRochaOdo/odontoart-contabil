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
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Layers3,
  LoaderCircle,
  RefreshCcw,
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

type SubmitState = "idle" | "loading" | "success" | "error";
type Module = "eventos" | "relatorios" | "contraprestacoes";
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

export default function Home() {
  const [activeModule, setActiveModule] = useState<Module>("eventos");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [competencia, setCompetencia] = useState(currentMonth());
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

  const canSubmit = useMemo(
    () => Boolean(knownFile && liquidFile && competencia) && status !== "loading",
    [knownFile, liquidFile, competencia, status],
  );
  const canSubmitContraprestacoes = useMemo(
    () => Boolean(escrituracaoFile && competencia) && contrapStatus !== "loading",
    [escrituracaoFile, competencia, contrapStatus],
  );

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

      if (payload.competencia) {
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

  useEffect(() => {
    if (activeModule !== "relatorios") return;
    if (hasLoadedReportsRef.current) return;
    hasLoadedReportsRef.current = true;
    void loadReports();
  }, [activeModule, loadReports]);

  function renderEventos() {
    return (
      <>
        <header className={styles.header}>
          <h1>Modulo Eventos</h1>
          <p>
            Gere os 4 arquivos contabilidade em .xlsx: Conhecidos Clinico, Conhecidos
            Ortodontia, Liquidados Clinico e Liquidados Ortodontia.
          </p>
          <p className={styles.ruleNote}>
            Regra de conciliacao por lote: se nao constar no liquidado, adicionar o
            registro (linha) da planilha do evento conhecido.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Competencia</span>
                <input
                  type="month"
                  value={competencia}
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

  function renderContraprestacoes() {
    return (
      <>
        <header className={styles.header}>
          <h1>Modulo Contraprestacoes</h1>
          <p>
            Entrada: Odontoart Escrituracao. Saida: Odontoart Equacao com as abas
            Faturamento PF Clinico e Faturamento PJ.
          </p>
        </header>

        <section className={styles.card}>
          <form onSubmit={handleContraprestacoesSubmit} className={styles.form}>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>Competencia</span>
                <input
                  type="month"
                  value={competencia}
                  onChange={(event) => setCompetencia(event.target.value)}
                  required
                />
                {contrapCompetenciaHint && (
                  <small className={styles.helper}>{contrapCompetenciaHint}</small>
                )}
              </label>

              <label className={styles.field}>
                <span>Odontoart Escrituracao (.xlsx)</span>
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
                <span>Gerar Arquivo Equacao</span>
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
                Processamento concluido. O download do arquivo Equacao foi iniciado.
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
          <h1>Modulo Relatorios</h1>
          <p>Consulte o historico de processamentos do modulo Eventos por competencia.</p>
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
          <button
            type="button"
            className={`${styles.moduleItem} ${
              activeModule === "contraprestacoes" ? styles.active : ""
            }`}
            title="Contraprestacoes"
            onClick={() => setActiveModule("contraprestacoes")}
          >
            <FileSpreadsheet size={16} />
            {!sidebarCollapsed && <span className={styles.moduleLabel}>Contraprestacoes</span>}
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
        {activeModule === "eventos"
          ? renderEventos()
          : activeModule === "contraprestacoes"
            ? renderContraprestacoes()
            : renderRelatorios()}
      </main>
    </div>
  );
}
