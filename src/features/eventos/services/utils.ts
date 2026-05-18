import { Competencia, TipoPagamento } from "@/features/eventos/domain/types";

const ACCENT_REGEX = /[\u0300-\u036f]/g;

export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(ACCENT_REGEX, "")
    .replace(/[^\w\s/%.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseCompetencia(value: string | null | undefined): Competencia {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    const now = new Date();
    return {
      ano: now.getFullYear(),
      mes: now.getMonth() + 1,
    };
  }

  const [anoRaw, mesRaw] = value.split("-");
  return {
    ano: Number(anoRaw),
    mes: Number(mesRaw),
  };
}

export function competenciaToString(competencia: Competencia): string {
  return `${competencia.ano}-${String(competencia.mes).padStart(2, "0")}`;
}

export function firstDayOfMonth(competencia: Competencia): Date {
  return new Date(competencia.ano, competencia.mes - 1, 1);
}

export function lastDayOfMonth(competencia: Competencia): Date {
  return new Date(competencia.ano, competencia.mes, 0);
}

export function firstDayOfPreviousMonth(competencia: Competencia): Date {
  if (competencia.mes === 1) {
    return new Date(competencia.ano - 1, 11, 1);
  }
  return new Date(competencia.ano, competencia.mes - 2, 1);
}

export function inferTipoPagamento(modeloPagamento: string): TipoPagamento {
  const normalized = normalizeText(modeloPagamento);
  if (normalized.includes("EXTERNO")) return "EXTERNO";
  if (normalized.includes("INTERNO")) return "INTERNO";
  return "INDEFINIDO";
}

export function isSameYearMonth(date: Date, competencia: Competencia): boolean {
  return (
    date.getFullYear() === competencia.ano &&
    date.getMonth() + 1 === competencia.mes
  );
}

export function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 86400000);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;

    const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      const [, dd, mm, yyyy] = brMatch;
      const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, yyyy, mm, dd] = isoMatch;
      const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === "object" && value !== null) {
    if ("result" in value) {
      const formulaResult = (value as { result?: unknown }).result;
      return coerceDate(formulaResult);
    }
    if ("text" in value) {
      return coerceDate((value as { text?: unknown }).text);
    }
    if ("hyperlink" in value && "text" in value) {
      return coerceDate((value as { text?: unknown }).text);
    }
    if ("richText" in value) {
      const text = (value as { richText?: Array<{ text?: string }> }).richText
        ?.map((item) => item.text ?? "")
        .join("");
      return coerceDate(text);
    }
  }
  return null;
}

export function coerceNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && value !== null) {
    if ("result" in value) {
      return coerceNumber((value as { result?: unknown }).result);
    }
    if ("text" in value) {
      return coerceNumber((value as { text?: unknown }).text);
    }
    if ("richText" in value) {
      const text = (value as { richText?: Array<{ text?: string }> }).richText
        ?.map((item) => item.text ?? "")
        .join("");
      return coerceNumber(text);
    }
  }
  if (typeof value === "string") {
    const sanitized = value
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function coerceString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null) {
    if ("result" in value) {
      return coerceString((value as { result?: unknown }).result);
    }
    if ("text" in value) {
      return coerceString((value as { text?: unknown }).text);
    }
    if ("richText" in value) {
      return (
        (value as { richText?: Array<{ text?: string }> }).richText
          ?.map((item) => item.text ?? "")
          .join("")
          .trim() ?? ""
      );
    }
  }
  return String(value).trim();
}
