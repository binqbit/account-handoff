import { expect, type Page, type TestInfo } from "@playwright/test";
import type { Hex, NativeConnection } from "@account-handoff/native-adapter";
import type { injectLocalWallet } from "../browser-wallet";
import { performApproval } from "../browser-support";

/** Maintenance must use the workspace that holds the verified handoff proof. */
export async function completeVestingFromUi(
  page: Page,
  testInfo: TestInfo,
  input: {
    connection: NativeConnection;
    wallet: Awaited<ReturnType<typeof injectLocalWallet>>;
    pure: Hex;
  },
): Promise<void> {
  const { connection, wallet, pure } = input;
  const before = await connection.readAccount(pure);
  const schedules = before.vesting as {
    locked: string;
    perBlock: string;
    startingBlock: number;
  }[];
  expect(schedules).toHaveLength(1);
  const schedule = schedules[0]!;
  const locked = BigInt(schedule.locked);
  const perBlock = BigInt(schedule.perBlock);
  const unlockBlock =
    Number(schedule.startingBlock) +
    Number((locked + perBlock - 1n) / perBlock);
  await expect
    .poll(
      async () => {
        const head = await connection.api.rpc.chain_getFinalizedHead();
        return (await connection.api.rpc.chain_getHeader(head))!.number;
      },
      {
        message: "The actual LOCAL chain must reach the vesting end block",
        intervals: [1000, 3000, 6000],
        timeout: 420000,
      },
    )
    .toBeGreaterThanOrEqual(unlockBlock);
  await performApproval(page, "A", wallet.accounts.A, "GRC-VESTING-VEST-OTHER");
  const after = await connection.readAccount(pure);
  expect(after.frozen).toBe(0n);
  expect(after.vesting).toEqual([]);
  expect(after.free).toBe(before.free);
  expect(after.reserved).toBe(before.reserved);
  expect(after.proxies).toEqual(before.proxies);
  await testInfo.attach("completed-native-vesting", {
    body: JSON.stringify(
      { unlockBlock, before, after },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
    contentType: "application/json",
  });
  console.info(
    "[LOCAL] Native vesting fully unlocked using the verified handoff workspace",
  );
}
