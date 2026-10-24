import { contractAddress, plain } from "@account-handoff/native-adapter";
import { encodeSubmission, readGrant } from "@account-handoff/grant-adapter";
import type { ScenarioContext } from "./types.js";
import { save } from "./journal.js";
import { requireCondition } from "./guards.js";
import { throughP } from "./calls.js";
export async function handoff(context: ScenarioContext): Promise<void> {
  const {
    session,
    sessionPath,
    connection,
    actors,
    m0,
    m1,
    multisig,
    proxySet,
    contractCall,
    event,
  } = context;

  requireCondition(
    session.p && session.grantId && session.baseline,
    "Seed the full vested grant baseline first",
  );
  const p = session.p;
  const grantId = BigInt(session.grantId);

  const baselineRecord = session.baseline as {
    beneficiary: {
      reserved: bigint | string;
      proxyDeposit: bigint | string;
      holds: unknown;
      vesting: unknown;
    };
    controller: { reserved: bigint | string };
  };
  await multisig(
    "add-M1",
    m0,
    [actors.A, actors.B, actors.C],
    ["A", "B"],
    throughP(p, { kind: "add-proxy", delegate: m1 }),
  );
  if (!session.steps["remove-M0-D"]) {
    const dual = await proxySet(p, [m0, m1]);
    const increment =
      dual.proxyDeposit - BigInt(baselineRecord.beneficiary.proxyDeposit);
    requireCondition(
      increment > 0n &&
        dual.reserved ===
          BigInt(baselineRecord.beneficiary.reserved) + increment,
      "DualControl reserve increment does not match the exact added proxy",
    );
    requireCondition(
      JSON.stringify(plain(dual.holds)) ===
        JSON.stringify(baselineRecord.beneficiary.holds),
      "Mapping hold changed while adding the new controller",
    );
    session.dualControl = {
      beneficiary: dual,
      increment,
      fingerprint: await connection.fingerprint(),
    };
    save(sessionPath, session);
  }
  const removal = await multisig(
    "remove-M0",
    m1,
    [actors.A, actors.B, actors.D],
    ["A", "D"],
    throughP(p, { kind: "remove-proxy", delegate: m0 }),
  );
  const rotated = await proxySet(p, [m1]);
  requireCondition(
    rotated.mappedTo === p,
    "Pure mapping changed during rotation",
  );
  requireCondition(
    rotated.reserved === BigInt(baselineRecord.beneficiary.reserved) &&
      rotated.proxyDeposit === BigInt(baselineRecord.beneficiary.proxyDeposit),
    "Exact old-controller removal did not restore the original reserve attribution",
  );
  requireCondition(
    JSON.stringify(plain(rotated.holds)) ===
      JSON.stringify(baselineRecord.beneficiary.holds),
    "Mapping hold changed during removal",
  );
  requireCondition(
    JSON.stringify(plain(rotated.vesting)) ===
      JSON.stringify(baselineRecord.beneficiary.vesting),
    "Native vesting tuple or multiplicity changed during rotation",
  );
  requireCondition(
    (await connection.readAccount(m0)).reserved ===
      BigInt(baselineRecord.controller.reserved),
    "Historical creator reserve changed during handoff",
  );
  if (!session.rotation) {
    session.rotation = {
      receipt: removal,
      beneficiary: await proxySet(p, [m1], removal.blockHash),
      fingerprint: await connection.fingerprint(removal.blockHash),
    };
    save(sessionPath, session);
  }
  const continuation = await multisig(
    "submit-m1",
    m1,
    [actors.A, actors.B, actors.D],
    ["A", "D"],
    async () =>
      throughP(
        p,
        await contractCall(
          p,
          encodeSubmission(
            grantId,
            1,
            "LOCAL continuation by replacement controller A+D",
          ),
        ),
      ),
  );
  const submitted = event(continuation, "MilestoneSubmitted");
  requireCondition(
    String(submitted["grantId"]) === session.grantId &&
      String(submitted["index"]) === "1",
    "Continuation event belongs to a different grant/milestone",
  );
  const grant = await readGrant(
    connection,
    actors.F,
    session.contract,
    grantId,
  );
  requireCondition(
    grant.grantee.toLowerCase() === contractAddress(p) &&
      grant.milestones[1]?.state === 1,
    "Same-grant continuation poststate missing",
  );
  if (!session.continuation) {
    session.continuation = {
      receipt: continuation,
      grant: plain(
        await readGrant(
          connection,
          actors.F,
          session.contract,
          grantId,
          continuation.blockHash,
        ),
      ),
      beneficiary: await proxySet(p, [m1], continuation.blockHash),
      fingerprint: await connection.fingerprint(continuation.blockHash),
    };
    save(sessionPath, session);
  }
}
