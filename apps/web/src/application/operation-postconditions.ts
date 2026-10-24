import type {
  Postcondition,
  AccountingLedger,
} from "@account-handoff/contracts";
import {
  classifyAuthority,
  hasPreservedSchedule,
  vestingRemaining,
} from "@account-handoff/domain";
import {
  NativeConnection,
  account,
  hex,
  contractAddress,
  object,
  type NativeReceipt,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";

import { readGrant } from "@account-handoff/grant-adapter";

import type { ChainView, WorkspaceRecord, PendingOperation } from "./models";

import { buildReadAnchor, cancellationMatches } from "./record-builders";

import { schedules } from "./values";
export async function operationPostconditions(
  {
    workspace: w,
    chain: c,
    connection,
    accounting,
  }: {
    workspace: WorkspaceRecord;
    chain: ChainView;
    connection: NativeConnection;
    accounting: (
      f: NativeFingerprint,
      accounts: ChainView["accounts"],
    ) => Promise<AccountingLedger | undefined>;
  },
  p: PendingOperation,
  receipt: NativeReceipt,
): Promise<Postcondition[]> {
  const anchor = buildReadAnchor(
    c.profile,
    await connection.fingerprint(receipt.blockHash),
  );
  let ok = receipt.nestedSuccess;
  let explanation = receipt.failure ?? "Nested native calls executed";
  if (p.phase === "multisig_first") {
    const proposal =
      p.envelope.controller && p.envelope.innerRuntimeCallHash
        ? await connection.proposal(
            p.envelope.controller.account,
            hex(p.envelope.innerRuntimeCallHash, 32),
            receipt.blockHash,
          )
        : null;
    ok =
      ok &&
      !!proposal &&
      proposal.depositor === p.envelope.requiredSigners[0] &&
      proposal.approvals.includes(p.envelope.requiredSigners[0]!);
    return [
      {
        id: "approval-recorded",
        result: ok ? "passed" : "unknown",
        anchor,
        observations: [],
        explanation:
          "The first approval and its current proposal were reconciled; the inner action has not executed yet.",
      },
    ];
  }
  if (p.phase === "cancel") {
    const params = p.envelope.intent.parameters;
    const target = object(params.targetController);
    const remaining = await connection.proposal(
      String(target.account),
      hex(String(params.targetCallHash), 32),
      receipt.blockHash,
    );
    const eventMatched = cancellationMatches(p.envelope, receipt);
    const unreserved = receipt.events.some((event) => {
      if (event.pallet !== "Balances" || event.name !== "Unreserved")
        return false;
      try {
        return (
          account(String(event.data["who"])) === p.signer &&
          BigInt(String(event.data["amount"])) > 0n
        );
      } catch {
        return false;
      }
    });
    const cancelled =
      receipt.nestedSuccess && eventMatched && remaining === null && unreserved;
    return [
      {
        id: "cancel-target",
        result: cancelled
          ? "passed"
          : receipt.nestedSuccess
            ? "unknown"
            : "failed",
        anchor,
        observations: [],
        explanation: cancelled
          ? "The exact proposal was cancelled; its event, absence and depositor reserve refund are confirmed."
          : "The cancellation event, absence of the exact proposal or reserve refund is unconfirmed.",
      },
    ];
  }
  const pure = w.pure
    ? await connection.readAccount(w.pure, receipt.blockHash)
    : null;
  if (
    p.actionId === "GRC-ROTATION-ADD-M1" ||
    p.actionId === "GRC-ROTATION-REMOVE-M0"
  ) {
    const desired =
      p.actionId === "GRC-ROTATION-ADD-M1" ? "DualControl" : "M1Only";
    const actual = pure
      ? classifyAuthority(
          pure.proxies
            .filter((t) => t.proxyType === "Any" && t.delay === 0)
            .map((t) => ({
              delegate: t.delegate,
              proxyType: "Any" as const,
              delay: "0" as const,
            })),
          w.M0.account,
          w.M1.account,
        )
      : "Unknown";
    ok =
      ok &&
      actual === desired &&
      !!pure?.proxies.every((t) => t.proxyType === "Any" && t.delay === 0) &&
      pure.mappedTo === w.pure;
    explanation = ok
      ? "The exact controller set and mapping are confirmed."
      : "Final permissions or mapping differ from those expected.";
  }
  if (p.actionId === "GRC-SETUP-MAP-P")
    ok = ok && !!pure && pure.mappedTo === w.pure;
  if (p.actionId === "GRC-SETUP-MAP-ACTOR") {
    const who = String(p.envelope.intent.parameters["account"]);
    ok =
      ok &&
      (await connection.readAccount(who, receipt.blockHash)).mappedTo === who;
  }
  const result: Postcondition[] = [
    {
      id: "operation-poststate",
      result: ok ? "passed" : "failed",
      anchor,
      observations: [],
      explanation,
    },
  ];
  if (
    [
      "GRC-ROTATION-ADD-M1",
      "GRC-ROTATION-REMOVE-M0",
      "GRC-GRANT-SUBMIT-M1",
    ].includes(p.actionId)
  ) {
    if (!pure || !w.baseline || !w.contract || w.grantId === null) {
      result.push({
        id: "continuity-evidence",
        result: "unknown",
        anchor,
        observations: [],
        explanation: "Baseline evidence is incomplete.",
      });
      return result;
    }
    const f = await connection.fingerprint(receipt.blockHash);
    const creator = await connection.readAccount(
      w.M0.account,
      receipt.blockHash,
    );
    const ledger = await accounting(f, {
      [w.pure!]: pure,
      [w.M0.account]: creator,
    });
    const backing =
      ledger?.status === "reconciled" &&
      ledger.unexplainedReservedDeltaNative === "0";
    const vesting =
      hasPreservedSchedule(
        schedules(w.baseline.account.vesting),
        schedules(pure.vesting),
      ) &&
      schedules(w.baseline.account.vesting).some(
        (s) => vestingRemaining(s, BigInt(receipt.blockNumber)) > 0n,
      );
    const grant = await readGrant(
      connection,
      w.pure!,
      w.contract,
      BigInt(w.grantId),
      receipt.blockHash,
    );
    const binding =
      grant.grantee === contractAddress(w.pure!) &&
      grant.grantee === w.baseline.grant.grantee &&
      grant.funder === w.baseline.grant.funder;
    result.push(
      {
        id: "reserve-backing",
        result: backing ? "passed" : "failed",
        anchor,
        observations: [],
        explanation:
          "Reserves, the mapping hold and the creator reserve must reconcile.",
      },
      {
        id: "vesting-provenance",
        result: vesting ? "passed" : "failed",
        anchor,
        observations: [],
        explanation:
          "The original active vesting schedule and its multiplicity are preserved.",
      },
      {
        id: "grant-beneficiary",
        result: binding ? "passed" : "failed",
        anchor,
        observations: [],
        explanation: "The beneficiary, funder and same grant are preserved.",
      },
    );
  }
  return result;
}
