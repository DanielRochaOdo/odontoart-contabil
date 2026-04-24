import fs from "node:fs/promises";
import { CompetenciaDetector } from "../../src/features/eventos/services/CompetenciaDetector";

const detector = new CompetenciaDetector();
const files = [
  "C:/Users/daniel.rocha/Downloads/03.2026 Faturamento - Escrituração.xlsx",
  "C:/Users/daniel.rocha/Desktop/BASE EVENTOS CONHECIDOS 03.2026.xlsx",
  "C:/Users/daniel.rocha/Desktop/BASE EVENTOS LIQUIDADOS 03.2026.xlsx",
];

async function run() {
  for (const filePath of files) {
    const buffer = await fs.readFile(filePath);
    const name = filePath.split("/").at(-1) ?? filePath;
    const competencia = await detector.detect(buffer, name);
    console.log(name, competencia);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
