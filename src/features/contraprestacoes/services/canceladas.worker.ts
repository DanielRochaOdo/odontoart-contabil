import {
  processCanceladasInBrowser,
  type BrowserProcessInput,
} from "@/features/contraprestacoes/services/CanceladasBrowserProcessor";
import type { CanceladasProcessProgress } from "@/features/contraprestacoes/services/CanceladasWorkbookProcessor";

type WorkerRequestMessage = {
  type: "process";
  payload: BrowserProcessInput;
};

type WorkerResponseMessage =
  | { type: "progress"; payload: CanceladasProcessProgress }
  | {
      type: "result";
      payload: Awaited<ReturnType<typeof processCanceladasInBrowser>>;
    }
  | { type: "error"; message: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void | Promise<void>) | null;
  postMessage: (message: WorkerResponseMessage) => void;
};

workerScope.onmessage = async (event) => {
  if (event.data.type !== "process") return;

  try {
    const result = await processCanceladasInBrowser(event.data.payload, (progress) => {
      workerScope.postMessage({ type: "progress", payload: progress });
    });

    workerScope.postMessage({
      type: "result",
      payload: result,
    });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Nao foi possivel processar a base mensal de Canceladas.",
    });
  }
};

export {};
