import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { EventosProcessor } from "../../src/features/eventos/services/EventosProcessor";
import { parseCompetencia } from "../../src/features/eventos/services/utils";
import type { ProcessLogRepository } from "../../src/features/eventos/repositories/ProcessLogRepository";
import type { ProcessSummary } from "../../src/features/eventos/domain/types";

class NoopRepo implements ProcessLogRepository {
  async save(_summary: ProcessSummary): Promise<void> {}
}

async function main() {
  const root = path.resolve(process.cwd());
  const knownPath = "C:/Users/daniel.rocha/Desktop/BASE EVENTOS CONHECIDOS 03.2026.xlsx";
  const liquidPath = "C:/Users/daniel.rocha/Desktop/BASE EVENTOS LIQUIDADOS 03.2026.xlsx";
  const outDir = path.join(root, "tmp", "analysis", "system");
  const extractedDir = path.join(outDir, "extracted");

  await fs.mkdir(extractedDir, { recursive: true });

  const conhecidosFileBuffer = await fs.readFile(knownPath);
  const liquidadosFileBuffer = await fs.readFile(liquidPath);

  const processor = new EventosProcessor(new NoopRepo());
  const result = await processor.process({
    conhecidosFileBuffer,
    liquidadosFileBuffer,
    competencia: parseCompetencia("2026-03"),
  });

  await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(result.summary, null, 2));

  const zip = new JSZip();
  for (const file of result.summary ? [] : []) {
    // noop
  }

  const contentZip = await JSZip.loadAsync(result.zipBuffer);
  const writes: Promise<void>[] = [];
  contentZip.forEach((relativePath, file) => {
    writes.push(
      file.async("nodebuffer").then((data) =>
        fs.writeFile(path.join(extractedDir, relativePath), data),
      ),
    );
  });
  await Promise.all(writes);

  const files = await fs.readdir(extractedDir);
  console.log("Arquivos gerados:");
  for (const name of files) {
    console.log(name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

