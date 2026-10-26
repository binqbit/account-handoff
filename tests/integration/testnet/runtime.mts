import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  account,
  contractAddress,
  plain,
} from "@account-handoff/native-adapter";
import {
  encodeCreateGrant,
  encodeSubmission,
  encodeApproval,
  readGrant,
  ZERO_ADDRESS,
} from "@account-handoff/grant-adapter";
import { setupRuntimeTest } from "./runtime-support";
const {
  c,
  pairs,
  A,
  B,
  C,
  D,
  F,
  unit,
  M0,
  M1,
  report,
  save,
  tx,
  multi,
  call,
  event,
  proxy,
  build,
  network,
} = await setupRuntimeTest();

try {
  const entries = [];
  for (const p of pairs) {
    const i = await c.api.query.system.account(p.address);
    entries.push([
      [p.address],
      {
        ...(plain(i) as Record<string, unknown>),
        providers: 1,
        consumers: 0,
        data: {
          ...(plain(i.data) as Record<string, unknown>),
          free: String(1000n * unit),
          reserved: "0",
          frozen: "0",
        },
      },
    ]);
  }
  const mappings = pairs.map((p) => [
    [contractAddress(p.address)],
    account(p.address),
  ]);
  await c.api.provider.send("dev_setStorage", [
    { System: { Account: entries }, Revive: { OriginalAccount: mappings } },
  ]);
  await tx("fund-controller", 4, {
    kind: "transfer",
    destination: M0,
    amount: 3n * unit,
  });
  const created = await multi(
    "create-pure",
    M0,
    [A!, B!, C!],
    { kind: "create-pure", index: 7 },
    1,
  );
  const pure = account(
    String(
      created.events.find(
        (e) => e.pallet === "Proxy" && e.name === "PureCreated",
      )!.data.pure,
    ),
  );
  report.pure = pure;
  save();
  await tx("fund-pure", 4, {
    kind: "transfer",
    destination: pure,
    amount: 6n * unit,
  });
  let state = await c.readAccount(pure);
  assert.equal(state.mappedTo, pure);
  assert.equal(state.holds instanceof Array, true);
  const deadline = (await c.currentBlockTime()) / 1000n + 86400n;
  const data = encodeCreateGrant(
    contractAddress(pure),
    [contractAddress(B!), contractAddress(F!)],
    [10n * unit, unit / 10n].map((amount, i) => ({
      amount: amount * 10000n,
      deadline,
      vestingBlocks: i === 0 ? 200 : 0,
      metricTarget: ZERO_ADDRESS,
      metricSelector: "0x00000000",
      metricMin: 0n,
    })),
  );
  const grantReceipt = await tx(
    "create-grant",
    4,
    await call(F!, data, 10n * unit + unit / 10n),
  );
  const grantId = BigInt(String(event(grantReceipt, "GrantCreated").grantId));
  report.grantId = String(grantId);
  save();
  await multi(
    "submit-first",
    M0,
    [A!, B!, C!],
    proxy(
      pure,
      await call(pure, encodeSubmission(grantId, 0, "First delivery")),
    ),
    1,
  );
  await tx("review-first-B", 1, await call(B!, encodeApproval(grantId, 0)));
  await tx("release-first-F", 4, await call(F!, encodeApproval(grantId, 0)));
  state = await c.readAccount(pure);
  assert.equal((state.vesting as any[]).length, 1);
  const original = JSON.stringify(plain(state.vesting));
  await multi(
    "add-M1",
    M0,
    [A!, B!, C!],
    proxy(pure, { kind: "add-proxy", delegate: M1 }),
    1,
  );
  await multi(
    "remove-M0",
    M1,
    [A!, B!, D!],
    proxy(pure, { kind: "remove-proxy", delegate: M0 }),
    3,
  );
  await multi(
    "old-controller-denied",
    M0,
    [A!, B!, C!],
    proxy(pure, { kind: "add-proxy", delegate: M0 }),
    1,
    true,
  );
  await multi(
    "submit-second",
    M1,
    [A!, B!, D!],
    proxy(
      pure,
      await call(pure, encodeSubmission(grantId, 1, "Replacement delivery")),
    ),
    3,
  );
  state = await c.readAccount(pure);
  assert.equal(JSON.stringify(plain(state.vesting)), original);
  assert.deepEqual(
    state.proxies.map((p) => p.delegate),
    [M1],
  );
  const schedule = (
    state.vesting as {
      locked: string;
      perBlock: string;
      startingBlock: number;
    }[]
  )[0]!;
  const end =
    BigInt(schedule.startingBlock) +
    (BigInt(schedule.locked) + BigInt(schedule.perBlock) - 1n) /
      BigInt(schedule.perBlock);
  const height = BigInt((await c.fingerprint()).anchor.number);
  await build({ count: Number(end > height ? end - height : 1n) });
  await tx("vest-other", 4, { kind: "vest-other", beneficiary: pure });
  state = await c.readAccount(pure);
  assert.equal((state.vesting as any[]).length, 0);
  assert.equal(state.frozen, 0n);
  await multi(
    "return-add-M0",
    M1,
    [A!, B!, D!],
    proxy(pure, { kind: "add-proxy", delegate: M0 }),
    1,
  );
  await multi(
    "return-remove-M1",
    M0,
    [A!, B!, C!],
    proxy(pure, { kind: "remove-proxy", delegate: M1 }),
    2,
  );
  await tx("review-second-B", 1, await call(B!, encodeApproval(grantId, 1)));
  await tx("release-second-F", 4, await call(F!, encodeApproval(grantId, 1)));
  const grant = await readGrant(c, pure, network.contractAddress, grantId);
  assert(grant.milestones.every((m) => m.state === 2));
  state = await c.readAccount(pure);
  assert.deepEqual(
    state.proxies.map((p) => p.delegate),
    [M0],
  );
  assert.equal(state.frozen, 0n);
  report.status = "passed";
  report.finalAccount = state;
  report.finalGrant = grant;
  report.packageLockSha256 = createHash("sha256")
    .update(readFileSync("package-lock.json"))
    .digest("hex");
  save();
  console.log("FORK_CYCLE_PASSED", report.steps.length);
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  save();
  throw error;
} finally {
  await c.close();
}
