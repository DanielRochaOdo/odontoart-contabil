import type { BrowserProcessInput, BrowserProcessOutput } from "@/features/contraprestacoes/services/CanceladasBrowserProcessor";
import type { CanceladasProcessProgress } from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";

type WorkerResponseMessage =
  | { type: "progress"; payload: CanceladasProcessProgress }
  | { type: "result"; payload: BrowserProcessOutput }
  | { type: "error"; message: string };

export async function processCanceladasInWorker(
  input: BrowserProcessInput,
  onProgress?: (progress: CanceladasProcessProgress) => void,
): Promise<BrowserProcessOutput> {
  return await new Promise<BrowserProcessOutput>((resolve, reject) => {
    const worker = new Worker(new URL("./canceladas.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const message = event.data;

      if (message.type === "progress") {
        onProgress?.(message.payload);
        return;
      }

      if (message.type === "result") {
        worker.terminate();
        resolve(message.payload);
        return;
      }

      worker.terminate();
      reject(new Error(message.message));
    };

    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Falha ao iniciar o processamento em segundo plano de Canceladas."));
    };

    worker.postMessage({
      type: "process",
      payload: input,
    });
  });
}
