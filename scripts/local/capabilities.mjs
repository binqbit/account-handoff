import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  LOCK,
  sourcePath,
  runDirectory,
  readRun,
  saveRun,
  emitDescriptor,
  atomicJSON,
  hash,
  output,
  main,
} from "./shared.mjs";

await main(async (args) => {
  const run = readRun(args.run ?? "development");
  const directory = runDirectory(run.runId);
  const qualification = JSON.parse(
    readFileSync(join(directory, "qualification.json"), "utf8"),
  );
  const generated = JSON.parse(
    readFileSync(
      join(ROOT, "packages/native-adapter/generated-manifest.json"),
      "utf8",
    ),
  );
  if (
    generated.metadataSha256 !== qualification.metadataSha256 ||
    generated.runtimeCodeHash !== qualification.runtimeCodeHash
  )
    throw new Error("Generated native types do not belong to this runtime.");
  const seedPath = join(directory, "seed.json");
  const session = existsSync(seedPath)
    ? JSON.parse(readFileSync(seedPath, "utf8"))
    : null;
  if (
    session &&
    (session.runId !== run.runId ||
      session.generation !== run.generation ||
      session.genesis !== run.genesisHash)
  )
    throw new Error("Native probes belong to another run.");
  const source = (path) => ({
    kind: "source",
    sourceId: LOCK.source.commit,
    locator: `source:${LOCK.source.commit}:patch:${LOCK.patch.sha256}:${path}`,
    contentSha256: hash(readFileSync(join(sourcePath, path))),
  });
  const local = (name, contents) => {
    const path = join(directory, "probes", `${name}.json`);
    atomicJSON(path, {
      runId: run.runId,
      generation: run.generation,
      genesisHash: run.genesisHash,
      ...contents,
    });
    return {
      kind: "native_chain",
      sourceId: `${run.genesisHash}:${run.runId}:${run.generation}`,
      locator: `local:${run.runId}:${run.generation}:probe:${name}`,
      contentSha256: hash(readFileSync(path)),
    };
  };
  const receipt = (name) => {
    const step = session?.steps[name];
    if (
      !step ||
      step.status !== "finalized" ||
      !step.receipt ||
      !step.receipt.outerSuccess
    )
      return null;
    if (
      step.expectedFailure
        ? step.receipt.nestedSuccess
        : !step.receipt.nestedSuccess
    )
      return null;
    return local(name, {
      callHash: step.callHash,
      actor: step.actor,
      receipt: step.receipt,
      expectedFailure: step.expectedFailure,
      verification: {
        exactPayloadSignatureVerified: true,
        retainedPacketHash: step.txHash,
      },
    });
  };
  const runtimeSource = source("substrate/bin/node/runtime/src/lib.rs");
  const reviveSource = source("substrate/frame/revive/src/lib.rs");
  const capabilities = {
    format: "account-handoff-local-capabilities-v1",
    runId: run.runId,
    generation: run.generation,
    genesisHash: run.genesisHash,
    metadataSha256: qualification.metadataSha256,
    runtimeCodeHash: qualification.runtimeCodeHash,
    generatedNativeTypesSha256: generated.generatedNativeTypesSha256,
    apiSource: {
      trait: [reviveSource],
      implementation: [runtimeSource, reviveSource],
    },
    currency: {
      composition: "shared-balances-with-reason-holds",
      nativeToEthRatio: "10000",
      nativeDecimals: 14,
      evidence: [runtimeSource, source("substrate/frame/balances/src/lib.rs")],
    },
    mapping: {
      algorithm: "keccak256-last20",
      autoMap: false,
      originalAccount: "persisted-native-account",
      evidence: [
        runtimeSource,
        source("substrate/frame/revive/src/address.rs"),
      ],
    },
  };
  const release = receipt("approve-R2");
  if (release && session?.baseline) {
    capabilities.vesting = {
      clock: "native-block-number",
      precompile: "0x0000000000000000000000000000000009020000",
      sourceEvidence: [
        runtimeSource,
        source("substrate/frame/vesting/src/lib.rs"),
        source("substrate/frame/vesting/precompiles/src/lib.rs"),
      ],
      nativeReleaseEvidence: [
        release,
        local("vesting-baseline", { baseline: session.baseline }),
      ],
    };
  }
  const success = receipt("map-P-B");
  const failure =
    receipt("probe-unauthorized-M1-D") ?? receipt("old-route-negative-B");
  if (success) {
    const packageLockSha256 = hash(
      readFileSync(join(ROOT, "package-lock.json")),
    );
    capabilities.adapter = {
      dedot: "1.4.0",
      viem: "2.40.3",
      transport: "legacy",
      packageLockSha256,
      packageEvidence: [
        {
          kind: "local_artifact",
          sourceId: null,
          locator: "project:package-lock.json",
          contentSha256: packageLockSha256,
        },
      ],
      verificationEvidence: [success],
    };
  }
  if (success && failure)
    capabilities.receipts = {
      correlation: "finalized-block-extrinsic-index-and-whole-byte-hash",
      nestedFailures: "proxy-and-multisig-inspected",
      successEvidence: [success],
      failureEvidence: [failure],
    };
  atomicJSON(join(directory, "capabilities.json"), capabilities);
  run.capabilities = capabilities;
  saveRun(run);
  emitDescriptor(run);
  output({
    status: "CAPABILITIES_RECORDED",
    runId: run.runId,
    capabilities: Object.keys(capabilities).filter((name) =>
      [
        "apiSource",
        "currency",
        "mapping",
        "vesting",
        "adapter",
        "receipts",
      ].includes(name),
    ),
  });
});
