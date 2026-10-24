import {
  hex,
  object,
  type Hex,
  type NativeReceipt,
} from "@account-handoff/native-adapter";

import { decodeGrantEvent } from "@account-handoff/grant-adapter";

export function findContractEvent(
  receipt: NativeReceipt,
  contract: Hex,
  name: string,
): Record<string, unknown> {
  for (const event of receipt.events) {
    if (
      event.pallet !== "Revive" ||
      event.name !== "ContractEmitted" ||
      String(event.data["contract"]).toLowerCase() !== contract.toLowerCase()
    )
      continue;
    const topics = event.data["topics"];
    if (!Array.isArray(topics)) continue;
    try {
      const value = object(
        decodeGrantEvent(
          hex(String(event.data["data"])),
          topics.map((t) => hex(String(t), 32)),
        ),
      );
      if (value["eventName"] === name) return object(value["args"]);
    } catch {
      /* Other events remain outside this exact ABI match. */
    }
  }
  throw new Error(
    `The exact ${name} event from the expected contract is missing`,
  );
}
