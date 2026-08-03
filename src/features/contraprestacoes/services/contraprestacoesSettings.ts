import { ContraprestacoesSettings } from "@/features/contraprestacoes/domain/types";

export const CONTRAPRESTACOES_SETTINGS_STORAGE_KEY = "contraprestacoes-settings";

export const DEFAULT_CONTRAPRESTACOES_SETTINGS: ContraprestacoesSettings = {
  tarifaCartaoDebito: 0.0069,
  tarifaCartaoCredito: 0.0115,
  tarifaDebitoEmConta: 3.28,
  tarifaPixFixo: 2,
};

function sanitizeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function resolveContraprestacoesSettings(
  value: Partial<ContraprestacoesSettings> | null | undefined,
): ContraprestacoesSettings {
  return {
    tarifaCartaoDebito: sanitizeNumber(
      value?.tarifaCartaoDebito,
      DEFAULT_CONTRAPRESTACOES_SETTINGS.tarifaCartaoDebito,
    ),
    tarifaCartaoCredito: sanitizeNumber(
      value?.tarifaCartaoCredito,
      DEFAULT_CONTRAPRESTACOES_SETTINGS.tarifaCartaoCredito,
    ),
    tarifaDebitoEmConta: sanitizeNumber(
      value?.tarifaDebitoEmConta,
      DEFAULT_CONTRAPRESTACOES_SETTINGS.tarifaDebitoEmConta,
    ),
    tarifaPixFixo: sanitizeNumber(
      value?.tarifaPixFixo,
      DEFAULT_CONTRAPRESTACOES_SETTINGS.tarifaPixFixo,
    ),
  };
}
