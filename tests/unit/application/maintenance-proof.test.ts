import { describe, expect, it, vi } from "vitest";
import { loadOperationInputs } from "../../../apps/web/src/application/operation-inputs";
import { workspaceView } from "../../../apps/web/src/application/presentation";

vi.mock("../../../apps/web/src/application/presentation", () => ({
  workspaceView: vi.fn(),
}));

describe("historical proof at the maintenance preparation boundary", () => {
  it.each([
    ["continued", true],
    ["drift", true],
    ["rotated", false],
    ["unknown", false],
    ["not-started", false],
  ] as const)(
    "maps %s to verified history = %s",
    async (continuity, verified) => {
      vi.mocked(workspaceView).mockReturnValue({ continuity } as ReturnType<
        typeof workspaceView
      >);
      const address = `0x${"11".repeat(32)}`;
      const context = {
        workspace: {
          participants: { S: address },
          M0: { account: address },
          M1: null,
          pure: null,
          contract: null,
          grantId: null,
          baseline: null,
        },
        chain: { profile: { digest: "profile" } },
        connection: {
          readAccount: vi.fn().mockResolvedValue({ address }),
          currentBlockTime: vi.fn().mockResolvedValue(1000n),
          api: {
            consts: {
              balances: { existentialDeposit: 1n },
              multisig: { depositBase: 1n, depositFactor: 1n },
              proxy: { proxyDepositBase: 1n, proxyDepositFactor: 1n },
              revive: { depositPerItem: 1n, depositPerByte: 1n },
            },
          },
        },
        accounting: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof loadOperationInputs>[0];
      const pending = {
        action: { kind: "vest-other", target: address },
        actionId: "GRC-VESTING-VEST-OTHER",
        signer: address,
        phase: "direct",
        envelope: { controller: null, innerRuntimeCallHash: null },
      } as unknown as Parameters<typeof loadOperationInputs>[1];
      const fingerprint = {
        anchor: { hash: `0x${"22".repeat(32)}`, number: 100 },
      } as Parameters<typeof loadOperationInputs>[2];
      const inputs = await loadOperationInputs(context, pending, fingerprint);
      expect(inputs.continuityVerified).toBe(verified);
    },
  );
});
