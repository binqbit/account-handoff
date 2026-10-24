import {
  account,
  contractAddress,
  plain,
} from "@account-handoff/native-adapter";
import {
  ZERO_ADDRESS,
  encodeCreateGrant,
  encodeSubmission,
  encodeApproval,
  readGrant,
  verifyGrantConstants,
} from "@account-handoff/grant-adapter";
import type { ScenarioContext } from "./types.js";
import { UNIT, EVM_UNIT, ZERO4 } from "./config.js";
import { save } from "./journal.js";
import { requireCondition, valueHex } from "./guards.js";
import { throughP } from "./calls.js";
export async function seed(context: ScenarioContext): Promise<boolean> {
  const {
    action,
    session,
    sessionPath,
    connection,
    actors,
    m0,
    transact,
    multisig,
    proxySet,
    contractCall,
    event,
  } = context;
  let currentSeedBaseline = true;
  if (action === "seed" && session.baseline) {
    requireCondition(
      session.p && session.grantId,
      "Retained baseline has incomplete identities",
    );
    const actual = await connection.readAccount(session.p);
    const grant = await readGrant(
      connection,
      actors.F,
      session.contract,
      BigInt(session.grantId),
    );
    currentSeedBaseline =
      actual.mappedTo === session.p &&
      grant.grantee.toLowerCase() === contractAddress(session.p) &&
      actual.proxies.length === 1 &&
      actual.proxies[0]?.delegate === m0 &&
      actual.proxies[0]?.proxyType === "Any" &&
      actual.proxies[0]?.delay === 0 &&
      grant.milestones[0]?.state === 2 &&
      grant.milestones[1]?.state === 0;
  }
  if (action === "seed" && !session.baseline) {
    await transact(
      "fund-actor-D",
      { kind: "transfer", destination: actors.D, amount: 100n * UNIT },
      "A",
    );
    await transact(
      "fund-M0",
      { kind: "transfer", destination: m0, amount: 1_000n * UNIT },
      "A",
    );
    const pureReceipt = await multisig(
      "create-pure",
      m0,
      [actors.A, actors.B, actors.C],
      ["A", "B"],
      { kind: "create-pure", index: 0 },
    );
    if (!session.p) {
      const pureEvent = pureReceipt.events.find(
        (item) => item.pallet === "Proxy" && item.name === "PureCreated",
      );
      requireCondition(
        pureEvent,
        "PureCreated event missing from final M0 receipt",
      );
      session.p = account(valueHex(pureEvent.data["pure"]));
      save(sessionPath, session);
    }
    const p = session.p;
    requireCondition(
      !p.endsWith("ee".repeat(12)),
      "Unsupported EE-suffix Pure identity",
    );
    await proxySet(p, [m0]);
    await transact(
      "fund-P",
      { kind: "transfer", destination: p, amount: 1_000n * UNIT },
      "A",
    );
    await multisig(
      "map-P",
      m0,
      [actors.A, actors.B, actors.C],
      ["A", "B"],
      throughP(p, { kind: "map-account" }),
    );
    for (const role of ["F", "R1", "R2"] as const) {
      const current = await connection.readAccount(actors[role]);
      if (current.mappedTo !== actors[role])
        await transact(`map-${role}`, { kind: "map-account" }, role);
    }
    const mapped = await connection.readAccount(p);
    requireCondition(
      mapped.mappedTo === p,
      "Pure mapping is not persistent and reversible",
    );
    await verifyGrantConstants(connection, actors.F, session.contract);
    if (!session.fixture) {
      session.fixture = {
        deadline: (
          (await connection.currentBlockTime()) / 1000n +
          86_400n
        ).toString(),
      };
      save(sessionPath, session);
    }
    const deadline = BigInt(session.fixture.deadline);
    const inputs = [
      {
        amount: 18n * EVM_UNIT,
        deadline,
        vestingBlocks: 1800,
        metricTarget: ZERO_ADDRESS,
        metricSelector: ZERO4,
        metricMin: 0n,
      },
      {
        amount: 12n * EVM_UNIT,
        deadline,
        vestingBlocks: 0,
        metricTarget: ZERO_ADDRESS,
        metricSelector: ZERO4,
        metricMin: 0n,
      },
    ];
    const createReceipt = await transact(
      "create-grant",
      () =>
        contractCall(
          actors.F,
          encodeCreateGrant(
            contractAddress(p),
            [contractAddress(actors.R1), contractAddress(actors.R2)],
            inputs,
          ),
          30n * UNIT,
        ),
      "F",
    );
    if (!session.grantId) {
      const created = event(createReceipt, "GrantCreated");
      requireCondition(
        String(created["funder"]).toLowerCase() === contractAddress(actors.F) &&
          String(created["grantee"]).toLowerCase() === contractAddress(p) &&
          String(created["token"]).toLowerCase() === ZERO_ADDRESS &&
          BigInt(String(created["total"])) === 30n * EVM_UNIT &&
          Number(created["threshold"]) === 2,
        "GrantCreated does not match the reviewed native grant fixture",
      );
      requireCondition(
        Array.isArray(created["reviewers"]) &&
          JSON.stringify(
            created["reviewers"]
              .map(String)
              .map((a) => a.toLowerCase())
              .sort(),
          ) ===
            JSON.stringify(
              [contractAddress(actors.R1), contractAddress(actors.R2)].sort(),
            ),
        "Grant reviewer identities differ from the direct native actors",
      );
      session.grantId = String(created["grantId"]);
      save(sessionPath, session);
    }
    const grantId = BigInt(session.grantId);
    await multisig(
      "submit-m0",
      m0,
      [actors.A, actors.B, actors.C],
      ["A", "B"],
      async () =>
        throughP(
          p,
          await contractCall(
            p,
            encodeSubmission(
              grantId,
              0,
              "LOCAL initial milestone: independently verified work",
            ),
          ),
        ),
    );
    await transact(
      "approve-R1",
      () => contractCall(actors.R1, encodeApproval(grantId, 0)),
      "R1",
    );
    const released = await transact(
      "approve-R2",
      () => contractCall(actors.R2, encodeApproval(grantId, 0)),
      "R2",
    );
    event(released, "MilestoneReleased");
    const grant = await readGrant(
      connection,
      actors.F,
      session.contract,
      grantId,
    );
    const baseline = await proxySet(p, [m0]);
    requireCondition(
      grant.grantee.toLowerCase() === contractAddress(p) &&
        grant.funder.toLowerCase() === contractAddress(actors.F) &&
        grant.milestones[0]?.amount === 18n * EVM_UNIT &&
        grant.milestones[0]?.vestingBlocks === 1800 &&
        grant.milestones[1]?.amount === 12n * EVM_UNIT &&
        grant.milestones[1]?.vestingBlocks === 0 &&
        grant.milestones[0]?.state === 2 &&
        grant.milestones[1]?.state === 0,
      "Controlled grant baseline is invalid",
    );
    requireCondition(
      Array.isArray(baseline.vesting) && baseline.vesting.length > 0,
      "Native vesting schedule missing after first release",
    );
    requireCondition(
      (baseline.vesting as { locked: string; perBlock: string }[]).some(
        (schedule) =>
          BigInt(schedule.locked) === 18n * UNIT &&
          BigInt(schedule.perBlock) === (18n * UNIT) / 1800n,
      ),
      "The native schedule does not match the unchanged Vestry 18-token/1800-block tranche",
    );
    requireCondition(
      baseline.frozen > 0n,
      "The first tranche must remain actively locked at the baseline",
    );
    const holds = baseline.holds as { amount: string }[];
    requireCondition(
      Array.isArray(holds) && JSON.stringify(holds).includes("AddressMapping"),
      "The fresh beneficiary has no attributable mapping hold",
    );
    const held = holds.reduce((sum, hold) => sum + BigInt(hold.amount), 0n);
    requireCondition(
      held > 0n && held === baseline.reserved,
      "Unexpected reserved/hold provenance on the fresh beneficiary",
    );
    session.baseline = {
      fingerprint: await connection.fingerprint(),
      beneficiary: baseline,
      grant: plain(grant),
      releasedBy: released.txHash,
      controller: await connection.readAccount(m0),
    };
    save(sessionPath, session);
  }

  return currentSeedBaseline;
}
