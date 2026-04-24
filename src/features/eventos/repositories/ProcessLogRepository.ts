import { ProcessSummary } from "@/features/eventos/domain/types";

export interface ProcessLogRepository {
  save(summary: ProcessSummary): Promise<void>;
}

export class NoopProcessLogRepository implements ProcessLogRepository {
  async save(): Promise<void> {
    return Promise.resolve();
  }
}

