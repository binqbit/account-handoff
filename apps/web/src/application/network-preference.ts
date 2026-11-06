import { safeEndpoint } from "@account-handoff/native-adapter";
import { deployment } from "../config/deployment";
import type { RuntimeMode } from "../ui-contract";

export const NETWORK_PREFERENCE = "network-connection";
export interface NetworkPreference {
  version: 1;
  mode: RuntimeMode;
  endpoint: string;
}

/** Public connection configuration only; saved state never establishes readiness. */
export function readNetworkPreference(
  value: unknown,
  allowedModes: readonly RuntimeMode[] = deployment.allowedModes,
): NetworkPreference | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NetworkPreference>;
  if (
    record.version !== 1 ||
    !record.mode ||
    !allowedModes.includes(record.mode) ||
    typeof record.endpoint !== "string" ||
    record.endpoint.length > 2048
  )
    return null;
  try {
    const endpoint = safeEndpoint(record.endpoint, record.mode);
    // Query strings can contain access tokens; they remain session-only.
    if (new URL(endpoint).search) return null;
    return { version: 1, mode: record.mode, endpoint };
  } catch {
    return null;
  }
}
