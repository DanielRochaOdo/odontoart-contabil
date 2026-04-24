export class ContraprestacoesError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "ContraprestacoesError";
  }
}
