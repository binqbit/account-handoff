import type { NativeAction, Hex } from "@account-handoff/native-adapter";
import { requireCondition, valueHex } from "./guards.js";
export function restoreAction(value: unknown): NativeAction {
  requireCondition(
    value && typeof value === "object" && "kind" in value,
    "Invalid retained native operation",
  );
  const action = value as Record<string, unknown>;
  switch (action["kind"]) {
    case "transfer":
      return {
        kind: "transfer",
        destination: String(action["destination"]),
        amount: BigInt(String(action["amount"])),
      };
    case "create-pure":
      return { kind: "create-pure", index: Number(action["index"]) };
    case "map-account":
      return { kind: "map-account" };
    case "add-proxy":
    case "remove-proxy":
      return { kind: action["kind"], delegate: String(action["delegate"]) };
    case "proxy":
      return {
        kind: "proxy",
        beneficiary: String(action["beneficiary"]),
        inner: restoreAction(action["inner"]),
      };
    case "revive-call": {
      const weight = action["weight"] as Record<string, string>;
      return {
        kind: "revive-call",
        destination: valueHex(action["destination"]),
        value: BigInt(String(action["value"])),
        storage: BigInt(String(action["storage"])),
        data: valueHex(action["data"]),
        weight: {
          refTime: BigInt(weight["refTime"]!),
          proofSize: BigInt(weight["proofSize"]!),
        },
      };
    }
    default:
      throw new Error("Unsupported retained inner operation");
  }
}

export const throughP = (p: Hex, inner: NativeAction): NativeAction => ({
  kind: "proxy",
  beneficiary: p,
  inner,
});
