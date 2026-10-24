import { OPERATION_REQUIREMENTS } from "@account-handoff/contracts";
import type {
  ChainProfile,
  FrozenEnvelope,
  ReviewedSigningContext,
} from "@account-handoff/contracts";
import type { Blocker, FreshOperationInput } from "@account-handoff/domain";
import type { PreparationSnapshotInput } from "./types";

/** Pure current-session checks; they neither create a checkpoint nor claim a signature occurred. */
export function assessCurrentWallet(input: {
  profile: ChainProfile;
  envelope: FrozenEnvelope;
  signer: string;
  phase: FreshOperationInput["phase"];
  signingContext: ReviewedSigningContext;
  wallet: PreparationSnapshotInput["wallet"];
}): {
  walletAccepted: boolean;
  readinessAccepted: boolean;
  blockers: Blocker[];
} {
  const {
    profile,
    envelope,
    signer,
    phase,
    signingContext: context,
    wallet,
  } = input;
  const selected = wallet?.accounts.find((entry) => entry.address === signer);
  const supported = (type: string | undefined) =>
    ["ed25519", "sr25519", "ecdsa"].includes(type ?? "");
  const walletAccepted =
    !!wallet?.source &&
    !!wallet.version &&
    wallet.version !== "unknown" &&
    !!selected &&
    supported(selected.type) &&
    context.walletBuildId === `${wallet.source}:${wallet.version}` &&
    context.signer === signer &&
    context.operationPhase === phase &&
    context.genesis === profile.genesis &&
    context.metadataSha256 === profile.metadataSha256 &&
    context.runtimeCodeHash === profile.runtimeCodeHash;
  const roles = envelope.participants;
  const readinessAccepted =
    walletAccepted &&
    [roles.A, roles.B, roles.C, roles.D].every(
      (address, index, all) => all.indexOf(address) === index,
    ) &&
    [roles.A, roles.D].every((address) =>
      wallet?.accounts.some(
        (entry) => entry.address === address && supported(entry.type),
      ),
    );
  const blockers: Blocker[] = [];
  if (!walletAccepted)
    blockers.push({
      code: "WalletChanged",
      message:
        "The selected supported account and exact signature-only wallet session must remain available.",
      guardIds: ["Q-WALLET"],
    });
  if (
    OPERATION_REQUIREMENTS[
      envelope.intent.operationId
    ].requiredGateIds.includes("Q-READINESS") &&
    !readinessAccepted
  )
    blockers.push({
      code: "ReadinessChanged",
      message:
        "The required distinct A and D signer capabilities are no longer available in the reviewed wallet session.",
      guardIds: ["Q-READINESS"],
    });
  return { walletAccepted, readinessAccepted, blockers };
}
