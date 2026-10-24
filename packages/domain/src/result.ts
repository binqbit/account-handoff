export interface Blocker {
  code: string;
  message: string;
  guardIds: string[];
}
export type Result<T> =
  { ok: true; value: T } | { ok: false; blockers: Blocker[] };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const blocked = <T = never>(
  code: string,
  message: string,
  guardIds: string[] = [],
): Result<T> => ({ ok: false, blockers: [{ code, message, guardIds }] });
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
