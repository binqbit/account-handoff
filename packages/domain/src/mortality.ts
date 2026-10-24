import { DomainError } from "./result.js";

export type NativeEraAssessment =
  | { kind: "immortal"; birth: 0n; death: null; state: "valid" }
  | {
      kind: "mortal";
      period: bigint;
      phase: bigint;
      birth: bigint;
      death: bigint;
      state: "not_yet_valid" | "valid" | "expired";
    };

/** SCALE Era and birth/death from sp_runtime::generic::Era, pinned SDK b76182d.
 * The original signing block selects the era incarnation. Using the current
 * block here would incorrectly revive the same bytes after every period wrap.
 */
export function assessNativeEra(
  eraHex: string,
  signingBlock: bigint,
  finalizedBlock: bigint,
): NativeEraAssessment {
  if (signingBlock < 0n || finalizedBlock < 0n)
    throw new DomainError(
      "InvalidMortality",
      "Native era block numbers must be nonnegative",
    );
  if (eraHex === "0x00")
    return { kind: "immortal", birth: 0n, death: null, state: "valid" };
  if (!/^0x[0-9a-f]{4}$/.test(eraHex))
    throw new DomainError(
      "InvalidMortality",
      "Mortal Era requires exactly two canonical SCALE bytes",
    );
  const low = BigInt(`0x${eraHex.slice(2, 4)}`),
    high = BigInt(`0x${eraHex.slice(4, 6)}`);
  if (low === 0n)
    throw new DomainError(
      "InvalidMortality",
      "Noncanonical immortal Era encoding",
    );
  const encoded = low | (high << 8n);
  const period = 2n << (encoded & 15n);
  const quantize = period >> 12n || 1n;
  const phase = (encoded >> 4n) * quantize;
  if (period < 4n || phase >= period)
    throw new DomainError(
      "InvalidMortality",
      "SCALE Era period or phase is invalid",
    );
  const birth =
    (((signingBlock > phase ? signingBlock : phase) - phase) / period) *
      period +
    phase;
  const death = birth + period;
  return {
    kind: "mortal",
    period,
    phase,
    birth,
    death,
    state:
      finalizedBlock < birth
        ? "not_yet_valid"
        : finalizedBlock >= death
          ? "expired"
          : "valid",
  };
}
