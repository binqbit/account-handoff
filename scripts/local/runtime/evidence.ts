import { join } from "node:path";
import { contractAddress } from "@account-handoff/native-adapter";
import type { LocalRuntime } from "./types.js";
import { save } from "./journal.js";
export function reportEvidence(
  runtime: LocalRuntime,
  currentSeedBaseline: boolean,
): void {
  const { id, action, run, directory, session, actors, m0, m1 } = runtime;
  const workspace =
    session.p && session.grantId
      ? {
          format: "account-handoff-local-workspace",
          version: 1,
          mode: "LOCAL",
          runId: id,
          generation: run.generation,
          genesisHash: session.genesis,
          endpoint: run.nativeRpc,
          input: {
            name: `LOCAL ${id}`,
            oldMembers: [actors.A, actors.B, actors.C],
            newMembers: [actors.A, actors.B, actors.D],
            threshold: 2,
            funder: actors.F,
            reviewers: [actors.R1, actors.R2],
            beneficiary: session.p,
            contract: session.contract,
            grantId: session.grantId,
          },
          creation: session.steps["create-pure-B"]?.receipt
            ? {
                transactionHash: session.steps["create-pure-B"].receipt.txHash,
                blockHash: session.steps["create-pure-B"].receipt.blockHash,
                blockNumber: session.steps["create-pure-B"].receipt.blockNumber,
                transactionIndex:
                  session.steps["create-pure-B"].receipt.txIndex,
              }
            : null,
        }
      : null;
  if (workspace) save(join(directory, "workspace.json"), workspace);
  console.log(
    JSON.stringify(
      {
        status:
          action === "seed"
            ? currentSeedBaseline
              ? "BASELINE_VERIFIED"
              : "HISTORICAL_BASELINE_RETAINED"
            : action === "handoff"
              ? "CONTINUED"
              : action === "negative"
                ? "OLD_ROUTE_REJECTED"
                : action === "reconcile"
                  ? "RECONCILED"
                  : "INSPECTED",
        runId: id,
        generation: run.generation,
        contract: session.contract,
        p: session.p,
        hP: session.p ? contractAddress(session.p) : null,
        m0,
        m1,
        grantId: session.grantId,
        completedSteps: Object.entries(session.steps)
          .filter(([, step]) => step.status === "finalized")
          .map(([name]) => name),
        evidence: `.local-state/${id}/seed.json`,
      },
      null,
      2,
    ),
  );
}
