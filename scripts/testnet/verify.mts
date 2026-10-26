/** Read-only verification of the shipped PortalDot integration. Never opens a wallet. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import {
  NativeConnection,
  account,
  type NativeAction,
} from "@account-handoff/native-adapter";
import { vestryAbi } from "@account-handoff/grant-adapter";
import { readTestnetDescriptor } from "../../apps/web/src/application/testnet-descriptor";
import { qualifiedProfile } from "../../apps/web/src/application/network-profile";
import { buildSigningContext } from "../../apps/web/src/application/record-builders";
import deployment from "../../infra/testnet/vestry-deployment.json";
import verification from "../../infra/testnet/runtime-verification.json";

const output = resolve(
  process.argv[2] ??
    ".agent-workspace/verification/testnet/current-readonly.json",
);
const report: Record<string, unknown> = {
  status: "running",
  checkedAt: new Date().toISOString(),
  scope:
    "Public RPC reads and unsigned encoding only; no wallet, secrets, signature or submission.",
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
let connection: NativeConnection | undefined;
try {
  const descriptor = await readTestnetDescriptor();
  connection = await NativeConnection.connect(
    descriptor.nativeRpc,
    "DEMO",
    descriptor.nativeMetadataBinding,
  );
  const lockHash = createHash("sha256")
    .update(await readFile("package-lock.json"))
    .digest("hex");
  assert.equal(
    lockHash,
    verification.packageLockSha256,
    "Dependency lock changed since runtime verification",
  );
  const fingerprint = await connection.fingerprint();
  const profile = await qualifiedProfile(
    "DEMO",
    new Map(),
    fingerprint,
    descriptor,
    connection,
  );
  report.anchor = fingerprint.anchor;
  report.runtimeCodeHash = fingerprint.runtimeCodeHash;
  report.profile = { status: profile.status, gates: profile.gateRecords };
  const origin = account(deployment.deployerPublicKey);
  const before = await connection.readAccount(origin);
  const constants: Record<string, unknown> = {};
  for (const functionName of [
    "grantCount",
    "WEI_PER_PLANCK",
    "VESTING",
  ] as const)
    constants[functionName] = decodeFunctionResult({
      abi: vestryAbi,
      functionName,
      data: await connection.readContract(
        origin,
        descriptor.contract.address,
        encodeFunctionData({ abi: vestryAbi, functionName }),
      ),
    });
  report.contract = { address: descriptor.contract.address, ...constants };
  const actions: NativeAction[] = [
    { kind: "transfer", destination: origin, amount: 1n },
    { kind: "create-pure", index: 0 },
    { kind: "map-account" },
    { kind: "add-proxy", delegate: origin },
    { kind: "remove-proxy", delegate: origin },
    { kind: "vest-other", beneficiary: origin },
  ];
  for (const action of actions) connection.transaction(action);
  const payload = await connection.prepareSigning(
    connection.transaction(actions[0]!),
    origin,
  );
  assert.equal(payload.payload.withSignedTransaction, false);
  assert.equal(payload.payload.genesisHash, fingerprint.genesis);
  await buildSigningContext(payload, "read-only-verification:1", "direct");
  const after = await connection.readAccount(origin);
  report.unsignedPayloadVerified = true;
  report.observedNonceUnchanged = before.nonce === after.nonce;
  report.observedBalanceUnchanged = before.free === after.free;
  assert.equal(
    profile.status,
    "accepted",
    "The shipped runtime qualification is incomplete",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await connection?.close().catch((error) => {
    report.closeError = String(error);
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      report,
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ status: report.status, output, error: report.error }),
  );
}
