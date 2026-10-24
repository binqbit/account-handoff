import { blake2AsHex } from "dedot/utils";
import type { ScenarioContext } from "./types.js";
import { save } from "./journal.js";
import { requireCondition } from "./guards.js";
import { throughP } from "./calls.js";
export async function verifySeedProbes(
  context: ScenarioContext,
  currentSeedBaseline: boolean,
): Promise<void> {
  const {
    action,
    session,
    sessionPath,
    connection,
    actors,
    m0,
    m1,
    transact,
    multisig,
    proxySet,
  } = context;
  const failureProbe = session.steps["probe-unauthorized-M1-D"]?.receipt;
  if (
    action === "seed" &&
    currentSeedBaseline &&
    !(failureProbe?.outerSuccess && !failureProbe.nestedSuccess)
  ) {
    requireCondition(
      session.p && session.baseline,
      "A complete baseline is required before the failure probe",
    );
    // A real rejected nested route qualifies failure interpretation without changing the baseline.
    await multisig(
      "probe-unauthorized-M1",
      m1,
      [actors.A, actors.B, actors.D],
      ["A", "D"],
      throughP(session.p, { kind: "remove-proxy", delegate: m0 }),
      true,
    );
    await proxySet(session.p, [m0]);
  }
  if (
    action === "seed" &&
    currentSeedBaseline &&
    !session.steps["cancel-probe-cancel"]?.receipt
  ) {
    requireCondition(
      session.p && session.baseline,
      "Seed baseline is required before cancellation probe",
    );
    const inner = throughP(session.p, { kind: "map-account" });
    const innerTx = connection.transaction(inner);
    const callHash = blake2AsHex(innerTx.callHex);
    const weight = await connection.dispatchWeight(innerTx);
    if (!session.cancellationProbe) {
      session.cancellationProbe = {
        reservedBefore: (
          await connection.readAccount(actors.A)
        ).reserved.toString(),
        callHash,
      };
      save(sessionPath, session);
    }
    requireCondition(
      session.cancellationProbe.callHash === callHash,
      "Cancellation probe preimage changed",
    );
    if (!session.steps["cancel-probe-open"])
      requireCondition(
        (await connection.proposal(m0, callHash)) === null,
        "An unrelated mapping proposal already exists; cancellation probe will not adopt it",
      );
    const first = await transact(
      "cancel-probe-open",
      {
        kind: "multisig",
        threshold: 2,
        others: [actors.B, actors.C].sort(),
        timepoint: undefined,
        inner,
        weight,
      },
      "A",
    );
    requireCondition(
      !first.businessExecuted,
      "A first approval unexpectedly executed the cancellation probe",
    );
    const proposal = await connection.proposal(m0, callHash);
    requireCondition(
      proposal &&
        proposal.depositor === actors.A &&
        proposal.when.height === first.blockNumber &&
        proposal.when.index === first.txIndex,
      "Cancellation must use the actual original depositor",
    );
    const reserved = (await connection.readAccount(actors.A)).reserved;
    requireCondition(
      reserved ===
        BigInt(session.cancellationProbe.reservedBefore) + proposal.deposit,
      "First approval deposit was not attributed to its depositor",
    );
    const cancelled = await transact(
      "cancel-probe-cancel",
      {
        kind: "cancel",
        threshold: 2,
        others: [actors.B, actors.C].sort(),
        timepoint: proposal.when,
        callHash,
      },
      "A",
    );
    requireCondition(
      (await connection.proposal(m0, callHash, cancelled.blockHash)) === null,
      "Cancelled proposal still exists at finality",
    );
    requireCondition(
      (await connection.readAccount(actors.A)).reserved ===
        BigInt(session.cancellationProbe.reservedBefore),
      "Cancellation did not return the exact proposal deposit",
    );
    await proxySet(session.p, [m0]);
  }
}
