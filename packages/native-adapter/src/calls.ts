import type { DedotClient } from "dedot";
import { u8aToHex } from "dedot/utils";
import type { KitchensinkRuntimeRuntimeCallLike as LocalRuntimeCallLike } from "../generated/account-handoff-local/index.js";
import type { NativeAction, NativeTx } from "./types";
import { account, hex } from "./values";

/** Every branch is an application-approved native call; no free-form pallet route is exported. */
function actionCall(action: NativeAction): LocalRuntimeCallLike {
  switch (action.kind) {
    case "transfer":
      if (action.amount <= 0n)
        throw new Error("Transfer amount must be positive");
      return {
        pallet: "Balances",
        palletCall: {
          name: "TransferKeepAlive",
          params: { dest: account(action.destination), value: action.amount },
        },
      };
    case "create-pure":
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index > 65535
      )
        throw new Error("Invalid Pure index");
      return {
        pallet: "Proxy",
        palletCall: {
          name: "CreatePure",
          params: { proxyType: "Any", delay: 0, index: action.index },
        },
      };
    case "map-account":
      return { pallet: "Revive", palletCall: { name: "MapAccount" } };
    case "add-proxy":
    case "remove-proxy":
      return {
        pallet: "Proxy",
        palletCall: {
          name: action.kind === "add-proxy" ? "AddProxy" : "RemoveProxy",
          params: {
            delegate: account(action.delegate),
            proxyType: "Any",
            delay: 0,
          },
        },
      };
    case "proxy":
      return {
        pallet: "Proxy",
        palletCall: {
          name: "Proxy",
          params: {
            real: account(action.beneficiary),
            forceProxyType: "Any",
            call: actionCall(action.inner),
          },
        },
      };
    case "revive-call":
      if (
        action.value < 0n ||
        action.storage < 0n ||
        action.weight.refTime <= 0n ||
        action.weight.proofSize <= 0n
      )
        throw new Error("Invalid contract resource limits");
      return {
        pallet: "Revive",
        palletCall: {
          name: "Call",
          params: {
            dest: hex(action.destination, 20),
            value: action.value,
            weightLimit: action.weight,
            storageDepositLimit: action.storage,
            data: hex(action.data),
          },
        },
      };
    case "multisig": {
      if (action.threshold < 2 || action.threshold > action.others.length + 1)
        throw new Error("Invalid multisig threshold");
      const others = action.others.map(account).sort();
      if (new Set(others).size !== others.length)
        throw new Error("Duplicate multisig members");
      return {
        pallet: "Multisig",
        palletCall: {
          name: "AsMulti",
          params: {
            threshold: action.threshold,
            otherSignatories: others,
            maybeTimepoint: action.timepoint,
            call: actionCall(action.inner),
            maxWeight: action.weight,
          },
        },
      };
    }
    case "cancel":
      return {
        pallet: "Multisig",
        palletCall: {
          name: "CancelAsMulti",
          params: {
            threshold: action.threshold,
            otherSignatories: action.others.map(account).sort(),
            timepoint: action.timepoint,
            callHash: hex(action.callHash, 32),
          },
        },
      };
    case "vest-other":
      return {
        pallet: "Vesting",
        palletCall: {
          name: "VestOther",
          params: { target: account(action.beneficiary) },
        },
      };
  }
}

/** Encode and re-decode the closed call tree through the qualified registry. */
export function createTransaction(
  api: DedotClient,
  action: NativeAction,
): NativeTx {
  const tx = api.toTx(actionCall(action));
  const codec = api.registry.findCodec(
    api.registry.metadata.extrinsic.callTypeId,
  );
  const decoded = codec.tryDecode(tx.callHex);
  if (u8aToHex(codec.tryEncode(decoded)) !== tx.callHex)
    throw new Error("Native call does not round-trip exactly");
  return tx;
}
