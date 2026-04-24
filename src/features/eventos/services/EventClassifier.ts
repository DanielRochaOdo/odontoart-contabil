import { KIT_MODELOS_EXCLUIDOS } from "@/features/eventos/domain/constants";
import {
  EventoClassificado,
  RawEvento,
  Segmento,
  TipoPessoa,
} from "@/features/eventos/domain/types";
import { inferTipoPagamento, normalizeText } from "@/features/eventos/services/utils";

export interface ClassificationResult {
  eventos: EventoClassificado[];
  excluidosKits: number;
  excluidosValorZero: number;
  avisos: string[];
}

function resolveSegmento(modeloPagamento: string): Segmento {
  return normalizeText(modeloPagamento).includes("ORTODONTIA") ? "ORTO" : "CLINICO";
}

function resolveTipoPessoa(modeloPagamento: string): TipoPessoa | null {
  const model = normalizeText(modeloPagamento);
  if (model.includes("NF")) return "PJ";
  if (model.includes("RPA")) return "PF";
  return null;
}

function normalizeModeloPagamento(modeloPagamento: string): string {
  const model = normalizeText(modeloPagamento);
  if (model === "RPA ODONTOMOVEL") {
    return "RPA ODONTOMOVEL INTERNO";
  }
  return modeloPagamento;
}

function adjustEmpresarialValue(evento: RawEvento): number {
  const current = evento.empresarial;
  const expectedTotal = evento.valorBruto;
  const individual = evento.individual;

  const delta = Math.abs(current + individual - expectedTotal);
  if (delta <= 0.01) return current;

  const recomputed = expectedTotal - individual;
  if (recomputed < 0) return current;
  return recomputed;
}

export class EventClassifier {
  classify(base: RawEvento[]): ClassificationResult {
    const avisos: string[] = [];
    const classificados: EventoClassificado[] = [];

    let excluidosKits = 0;
    let excluidosValorZero = 0;
    let semTipo = 0;

    for (const evento of base) {
      const modelo = normalizeText(evento.modeloPagamento);
      if (KIT_MODELOS_EXCLUIDOS.has(modelo)) {
        excluidosKits += 1;
        continue;
      }
      if (evento.valorBruto === 0) {
        excluidosValorZero += 1;
        continue;
      }
      if (normalizeText(evento.nomePrestador).includes("TESTE")) {
        continue;
      }

      const modeloPagamentoNormalizado = normalizeModeloPagamento(evento.modeloPagamento);
      const tipoPessoa = resolveTipoPessoa(modeloPagamentoNormalizado);
      if (!tipoPessoa) {
        semTipo += 1;
        continue;
      }

      classificados.push({
        ...evento,
        empresarial: adjustEmpresarialValue(evento),
        modeloPagamento: modeloPagamentoNormalizado,
        segmento: resolveSegmento(evento.modeloPagamento),
        tipoPessoa,
        tipoPagamento: inferTipoPagamento(modeloPagamentoNormalizado),
      });
    }

    if (semTipo > 0) {
      avisos.push(
        `${semTipo} registro(s) não foram enviados para contabilidade por ausência de identificação PF/PJ no modelo de pagamento.`,
      );
    }

    return {
      eventos: classificados,
      excluidosKits,
      excluidosValorZero,
      avisos,
    };
  }
}
