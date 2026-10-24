export class ContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "ContractError";
  }
}
