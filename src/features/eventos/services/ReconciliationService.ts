import { EventoClassificado } from "@/features/eventos/domain/types";

export interface ReconciliationResult {
  conhecidosConsolidados: EventoClassificado[];
  liquidadosConsolidados: EventoClassificado[];
  lotesAdicionados: number;
  lotesAdicionadosIds: string[];
  lotesSomenteConhecidosIds: string[];
  lotesSomenteLiquidadosIds: string[];
}

export class ReconciliationService {
  reconcile(
    conhecidos: EventoClassificado[],
    liquidados: EventoClassificado[],
  ): ReconciliationResult {
    const conhecidosSet = new Set<string>(conhecidos.map((item) => item.lote));
    const liquidadosSet = new Set<string>(liquidados.map((item) => item.lote));
    const conhecidosMap = new Map<string, EventoClassificado>();
    const liquidadosMap = new Map<string, EventoClassificado>();
    for (const item of conhecidos) {
      conhecidosMap.set(item.lote, item);
    }
    for (const item of liquidados) {
      liquidadosMap.set(item.lote, item);
    }

    let lotesAdicionados = 0;
    const lotesAdicionadosIds: string[] = [];
    for (const liquidado of liquidados) {
      if (!conhecidosMap.has(liquidado.lote)) {
        conhecidosMap.set(liquidado.lote, liquidado);
        lotesAdicionados += 1;
        lotesAdicionadosIds.push(liquidado.lote);
      }
    }
    for (const conhecido of conhecidos) {
      if (!liquidadosMap.has(conhecido.lote)) {
        liquidadosMap.set(conhecido.lote, conhecido);
      }
    }

    const lotesSomenteConhecidosIds = conhecidos
      .filter((item) => !liquidadosSet.has(item.lote))
      .map((item) => item.lote)
      .sort((a, b) => Number(a) - Number(b));

    const lotesSomenteLiquidadosIds = liquidados
      .filter((item) => !conhecidosSet.has(item.lote))
      .map((item) => item.lote)
      .sort((a, b) => Number(a) - Number(b));

    const conhecidosConsolidados = [...conhecidosMap.values()].sort((a, b) =>
      Number(a.lote) - Number(b.lote),
    );
    const liquidadosConsolidados = [...liquidadosMap.values()].sort((a, b) =>
      Number(a.lote) - Number(b.lote),
    );

    return {
      conhecidosConsolidados,
      liquidadosConsolidados,
      lotesAdicionados,
      lotesAdicionadosIds: lotesAdicionadosIds.sort((a, b) => Number(a) - Number(b)),
      lotesSomenteConhecidosIds,
      lotesSomenteLiquidadosIds,
    };
  }
}
