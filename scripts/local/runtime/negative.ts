import { plain } from "@account-handoff/native-adapter";
import type { ScenarioContext } from "./types.js";
import { UNIT } from "./config.js";
import { save } from "./journal.js";
import { requireCondition } from "./guards.js";
import { throughP } from "./calls.js";
export async function verifyNegativeAndMaintenance(
  context: ScenarioContext,
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

  requireCondition(
    session.p && session.grantId && session.baseline,
    "Seed the full vested grant baseline first",
  );
  const p = session.p;
  // Preserve identifier validation before running the negative scenario.
  BigInt(session.grantId);

  requireCondition(
    session.continuation,
    "Complete the distinct continuation proof before old-route negative testing",
  );
  const result = await multisig(
    "old-route-negative",
    m0,
    [actors.A, actors.B, actors.C],
    ["A", "B"],
    throughP(p, { kind: "remove-proxy", delegate: m1 }),
    true,
  );
  await proxySet(p, [m1]);
  requireCondition(
    result.outerSuccess && !result.nestedSuccess,
    "Old controller route was not rejected at the nested layer",
  );
  if (!session.maintenance) {
    const original = session.baseline as {
      beneficiary: { vesting: unknown };
    };
    const before = await connection.readAccount(p);
    requireCondition(
      JSON.stringify(plain(before.vesting)) ===
        JSON.stringify(original.beneficiary.vesting),
      "Original vesting tuple changed before the optional post-proof refresh",
    );
    const historicalContinuation = JSON.stringify(plain(session.continuation));
    const maintenance = await transact(
      "vest-other-after-proof",
      { kind: "vest-other", beneficiary: p },
      "A",
    );
    const after = await proxySet(p, [m1], maintenance.blockHash);
    requireCondition(
      after.frozen <= before.frozen,
      "Vesting refresh unexpectedly increased the lock",
    );
    requireCondition(
      !maintenance.events.some(
        (item) => item.pallet === "Revive" && item.name === "ContractEmitted",
      ),
      "Direct vesting refresh cannot supply a grant continuation event",
    );
    requireCondition(
      JSON.stringify(plain(session.continuation)) === historicalContinuation,
      "Maintenance rewrote the historical continuation proof",
    );
    session.maintenance = {
      before,
      after,
      receipt: maintenance,
      completedAfterContinuation: true,
    };
    save(sessionPath, session);
  }

  if (action === "negative") {
    // The grant parties are mapped by upstream genesis. Exercise direct mapping
    // separately on a fresh deterministic native identity, without changing them.
    if (!session.mappingProbe) {
      const unmapped = await connection.readAccount(actors.X);
      requireCondition(
        unmapped.mappedTo === null,
        "Direct-mapping probe must begin with a verified unmapped native account",
      );
      session.mappingProbe = {
        address: actors.X,
        initiallyUnmapped: true,
        reservedBefore: unmapped.reserved.toString(),
      };
      save(sessionPath, session);
    }
    requireCondition(
      session.mappingProbe.address === actors.X,
      "Direct-mapping probe identity differs from its retained plan",
    );
    await transact(
      "fund-direct-mapping-probe",
      { kind: "transfer", destination: actors.X, amount: 100n * UNIT },
      "A",
    );
    const mappedReceipt = await transact(
      "map-direct-native-actor-probe",
      { kind: "map-account" },
      "X",
    );
    const mapped = await connection.readAccount(actors.X);
    const holds = mapped.holds as { amount: string }[];
    requireCondition(
      mapped.mappedTo === actors.X &&
        mapped.reserved > BigInt(session.mappingProbe.reservedBefore) &&
        JSON.stringify(holds).includes("AddressMapping") &&
        holds.reduce((total, item) => total + BigInt(item.amount), 0n) ===
          mapped.reserved,
      "Direct native mapping lacks exact reverse mapping or attributed backing",
    );
    if (!session.mappingProbe.result) {
      session.mappingProbe.result = await connection.readAccount(
        actors.X,
        mappedReceipt.blockHash,
      );
      session.mappingProbe.receiptHash = mappedReceipt.txHash;
      save(sessionPath, session);
    }
  }
}
