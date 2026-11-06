import { describe, expect, it } from "vitest";
import { readNetworkPreference } from "../../../apps/web/src/application/network-preference";

describe("public network preferences", () => {
  it("normalizes a supported endpoint and restores only its public configuration", () => {
    expect(
      readNetworkPreference({
        version: 1,
        mode: "DEMO",
        endpoint: "wss://rpc.invalid",
        connected: true,
        qualification: "accepted",
      }),
    ).toEqual({ version: 1, mode: "DEMO", endpoint: "wss://rpc.invalid/" });
  });
  it("does not restore a different mode into the testnet build", () => {
    expect(
      readNetworkPreference(
        { version: 1, mode: "LIVE", endpoint: "wss://rpc.invalid/" },
        ["DEMO"],
      ),
    ).toBeNull();
    expect(
      readNetworkPreference(
        { version: 1, mode: "DEMO", endpoint: "wss://rpc.invalid/" },
        ["DEMO"],
      ),
    ).not.toBeNull();
  });
  it.each([
    null,
    {},
    { version: 2, mode: "DEMO", endpoint: "wss://rpc.invalid/" },
    { version: 1, mode: "OTHER", endpoint: "wss://rpc.invalid/" },
    { version: 1, mode: "DEMO", endpoint: "http://rpc.invalid/" },
    { version: 1, mode: "DEMO", endpoint: "ws://rpc.invalid/" },
    { version: 1, mode: "LOCAL", endpoint: "ws://remote.invalid/" },
    { version: 1, mode: "DEMO", endpoint: "wss://user:password@rpc.invalid/" },
    { version: 1, mode: "DEMO", endpoint: "wss://rpc.invalid/#secret" },
    { version: 1, mode: "DEMO", endpoint: "wss://rpc.invalid/?token=secret" },
    {
      version: 1,
      mode: "DEMO",
      endpoint: `wss://rpc.invalid/${"a".repeat(2048)}`,
    },
  ])(
    "ignores malformed, disallowed or credential-bearing configuration %#",
    (value) => {
      expect(readNetworkPreference(value)).toBeNull();
    },
  );
});
