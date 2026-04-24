import JSZip from "jszip";

export class ArchiveService {
  async zipXlsxFiles(
    files: Array<{
      nome: string;
      conteudo: Buffer;
    }>,
  ): Promise<Buffer> {
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.nome, file.conteudo);
    }
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
}

