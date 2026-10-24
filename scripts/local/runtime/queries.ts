import { decodeGrantEvent } from "@account-handoff/grant-adapter";
import type {
  Hex,
  NativeAction,
  NativeReceipt,
} from "@account-handoff/native-adapter";
import { UNIT } from "./config.js";
import { requireCondition, valueHex } from "./guards.js";
import type { LocalRuntime, NativeQueries } from "./types.js";
export function createNativeQueries(runtime: LocalRuntime): NativeQueries {
  const { connection, session } = runtime;
  const proxySet = async (p: Hex, expected: Hex[], blockHash?: Hex) => {
    const current = await connection.readAccount(p, blockHash);
    const actual = current.proxies
      .map((proxy) => `${proxy.delegate}:${proxy.proxyType}:${proxy.delay}`)
      .sort();
    requireCondition(
      JSON.stringify(actual) ===
        JSON.stringify(expected.map((delegate) => `${delegate}:Any:0`).sort()),
      `Unexpected native authority inventory: ${JSON.stringify(actual)}`,
    );
    return current;
  };
  async function contractCall(
    origin: Hex,
    data: Hex,
    value = 0n,
  ): Promise<NativeAction> {
    const estimated = await connection.estimateContract(
      origin,
      session.contract,
      value,
      data,
    );
    return {
      kind: "revive-call",
      destination: session.contract,
      value,
      data,
      weight: estimated.weight,
      storage: estimated.storage + 10n * UNIT,
    };
  }
  function event(
    receipt: NativeReceipt,
    name: string,
  ): Record<string, unknown> {
    for (const item of receipt.events) {
      if (item.pallet !== "Revive" || item.name !== "ContractEmitted") continue;
      if (
        String(item.data["contract"]).toLowerCase() !==
        session.contract.toLowerCase()
      )
        continue;
      try {
        const decoded = decodeGrantEvent(
          valueHex(item.data["data"]),
          (item.data["topics"] as unknown[]).map(valueHex),
        ) as { eventName: string; args: Record<string, unknown> };
        if (decoded.eventName === name) return decoded.args;
      } catch {
        /* Other source-valid contract events remain separate. */
      }
    }
    throw new Error(
      `Finalized native receipt did not contain attributed ${name}`,
    );
  }

  return { proxySet, contractCall, event };
}
