import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  NativeConnection,
  type NativeMetadataBinding,
  type Hex,
} from "@account-handoff/native-adapter";
import { ROOT } from "./config.js";
import { createLocalActors } from "./actors.js";
import { acquireRunLock, save } from "./journal.js";
import { requireCondition } from "./guards.js";
import type {
  Session,
  LocalRun,
  LocalRuntime,
  LocalAction,
  ScenarioContext,
} from "./types.js";
import { createNativeExecution, reconcile } from "./execution.js";
import { createNativeQueries } from "./queries.js";
import { seed } from "./seed.js";
import { verifySeedProbes } from "./seed-probes.js";
import { handoff } from "./handoff.js";
import { verifyNegativeAndMaintenance } from "./negative.js";
import { reportEvidence } from "./evidence.js";
function options(args: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith("--") || !value)
      throw new Error("Arguments require --name value pairs");
    out[key.slice(2)] = value;
  }
  return out;
}

export async function runLocalOperator(argv: string[]): Promise<void> {
  const args = options(argv);
  const id = args["run"] ?? "development";
  const action = args["action"] ?? "seed";
  requireCondition(
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(id),
    "Invalid LOCAL run identifier",
  );
  requireCondition(
    ["seed", "handoff", "inspect", "negative", "reconcile"].includes(action),
    "Unknown LOCAL native action",
  );
  const directory = join(ROOT, ".local-state", id);
  const run = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as LocalRun;
  requireCondition(
    run.owner === "account-handoff" &&
      run.mode === "LOCAL" &&
      run.runId === id &&
      run.status === "running" &&
      run.qualification?.status === "IDENTITY_VERIFIED" &&
      run.qualification.generation === run.generation,
    "A running, independently qualified LOCAL environment is required",
  );
  const deployment = JSON.parse(
    readFileSync(join(directory, "deployment.json"), "utf8"),
  ) as { generation: number; status: string; contractAddress: Hex };
  requireCondition(
    deployment.generation === run.generation &&
      deployment.status === "VERIFIED",
    "An independently verified contract deployment is required",
  );
  const { pairs, actors, m0, m1 } = await createLocalActors();
  const sessionPath = join(directory, "seed.json");
  const metadataBinding = JSON.parse(
    readFileSync(join(directory, "native-metadata-binding.json"), "utf8"),
  ) as NativeMetadataBinding;
  requireCondition(
    metadataBinding.genesis === run.genesisHash &&
      metadataBinding.metadataSha256 === run.qualification?.metadataSha256 &&
      metadataBinding.runtimeCodeHash === run.qualification.runtimeCodeHash,
    "LOCAL decoder binding differs from the qualified runtime",
  );
  const releaseLock = acquireRunLock(directory, action);
  const connection = await NativeConnection.connect(
    run.nativeRpc,
    "LOCAL",
    metadataBinding,
  ).catch((error) => {
    releaseLock();
    throw error;
  });
  try {
    const fingerprint = await connection.fingerprint();
    requireCondition(
      fingerprint.specName === "account-handoff-local" &&
        fingerprint.genesis === run.genesisHash &&
        fingerprint.tokenDecimals === 14 &&
        fingerprint.genesis === run.qualification?.genesis &&
        fingerprint.runtimeCodeHash === run.qualification.runtimeCodeHash &&
        fingerprint.metadataSha256 === run.qualification.metadataSha256,
      "LOCAL runtime identity mismatch",
    );
    const session: Session = existsSync(sessionPath)
      ? (JSON.parse(readFileSync(sessionPath, "utf8")) as Session)
      : {
          formatVersion: 1,
          mode: "LOCAL",
          runId: id,
          generation: run.generation,
          genesis: fingerprint.genesis,
          contract: deployment.contractAddress,
          actors,
          m0,
          m1,
          steps: {},
          operations: {},
        };
    requireCondition(
      session.generation === run.generation &&
        session.genesis === fingerprint.genesis &&
        session.contract === deployment.contractAddress,
      "LOCAL seed belongs to a different environment generation/deployment",
    );
    requireCondition(
      !session.actors.X || session.actors.X === actors.X,
      "The retained direct-mapping probe identity changed",
    );
    session.actors.X = actors.X;
    save(sessionPath, session);

    const runtime: LocalRuntime = {
      id,
      action: action as LocalAction,
      directory,
      run,
      sessionPath,
      session,
      connection,
      fingerprint,
      pairs,
      actors,
      m0,
      m1,
    };
    const context: ScenarioContext = {
      ...runtime,
      ...createNativeExecution(runtime),
      ...createNativeQueries(runtime),
    };
    if (action === "reconcile") await reconcile(runtime);
    const currentSeedBaseline = await seed(context);
    await verifySeedProbes(context, currentSeedBaseline);
    if (action === "handoff") await handoff(context);
    if (action === "negative") await verifyNegativeAndMaintenance(context);
    reportEvidence(runtime, currentSeedBaseline);
  } finally {
    try {
      await connection.close();
    } finally {
      releaseLock();
    }
  }
}
