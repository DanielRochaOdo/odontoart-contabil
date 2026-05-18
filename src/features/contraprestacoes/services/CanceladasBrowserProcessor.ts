import JSZip from "jszip";
import { CompetenciaDetector } from "@/features/eventos/services/CompetenciaDetector";
import { competenciaToString, parseCompetencia } from "@/features/eventos/services/utils";
import {
  CanceladasProcessResult,
  CanceladasWorkbookProcessor,
} from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";

interface BrowserProcessInput {
  competenciaRaw: string | null | undefined;
  file: File;
}

interface BrowserProcessOutput {
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
): Promise<BrowserProcessOutput> {
  const fileBuffer = new Uint8Array(await input.file.arrayBuffer());
  const { competencia, detectada } = await resolveCompetencia(
    input.competenciaRaw,
    fileBuffer,
    input.file.name,
  );

  const processor = new CanceladasWorkbookProcessor();
  const result = await processor.process(fileBuffer, competencia);

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
