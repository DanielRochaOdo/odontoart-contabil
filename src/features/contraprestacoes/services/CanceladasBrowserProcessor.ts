import JSZip from "jszip";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { competenciaToString, parseCompetencia } from "@/features/eventos/services/utils";
import {
  CanceladasProcessProgress,
  CanceladasProcessResult,
  CanceladasWorkbookProcessor,
} from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";

export interface BrowserProcessInput {
  competenciaRaw: string | null | undefined;
  file: File;
}

export interface BrowserProcessOutput {
  fileName: string;
  fileBuffer: Uint8Array;
  competenciaDetectada: string | null;
  result: CanceladasProcessResult;
}

async function resolveCompetencia(
  competenciaRaw: string | null | undefined,
  fileBuffer: Uint8Array,
  fileName: string,
) {
  if (typeof competenciaRaw === "string" && /^\d{4}-\d{2}$/.test(competenciaRaw)) {
    return {
      competencia: parseCompetencia(competenciaRaw),
      detectada: competenciaRaw,
    };
  }

  const detector = new CompetenciaDetector();
  const detectada = await detector.detect(fileBuffer, fileName);

  if (detectada) {
    return {
      competencia: detectada,
      detectada: competenciaToString(detectada),
    };
  }

  return {
    competencia: parseCompetencia(undefined),
    detectada: null,
  };
}

export async function processCanceladasInBrowser(
  input: BrowserProcessInput,
  onProgress?: (progress: CanceladasProcessProgress) => void,
): Promise<BrowserProcessOutput> {
  onProgress?.({
    value: 6,
    label: "Lendo arquivo",
    detail: `Abrindo ${input.file.name} para iniciar o processamento mensal.`,
  });
  const fileBuffer = new Uint8Array(await input.file.arrayBuffer());

  onProgress?.({
    value: 10,
    label: "Resolvendo competencia",
    detail: "Confirmando a competencia a partir do arquivo e do valor informado na tela.",
  });
  const { competencia, detectada } = await resolveCompetencia(
    input.competenciaRaw,
    fileBuffer,
    input.file.name,
  );

  const processor = new CanceladasWorkbookProcessor();
  const result = await processor.process(fileBuffer, competencia, onProgress);

  onProgress?.({
    value: 96,
    label: "Compactando pacote",
    detail: "Empacotando os arquivos finais de Canceladas em um ZIP unico.",
  });
  const zip = new JSZip();
  result.generatedFiles.forEach((fileItem) => {
    zip.file(fileItem.fileName, fileItem.buffer);
  });

  const zipBuffer = await zip.generateAsync({ type: "uint8array" });
  const competenciaLabel = `${String(competencia.mes).padStart(2, "0")}.${competencia.ano}`;

  return {
    fileName: `Canceladas ${competenciaLabel}.zip`,
    fileBuffer: zipBuffer,
    competenciaDetectada: detectada,
    result,
  };
}
