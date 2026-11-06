import { describe, expect, it } from "vitest";
import {
  JsonRpcError,
  MaxRetryAttemptedError,
  NetworkDisconnectedError,
} from "dedot";
import { DedotError } from "dedot/utils";
import {
  isRetryableNetworkFailure,
  normalizeNetworkFailure,
} from "../../../apps/web/src/application/network-failure";

describe("browser socket error presentation", () => {
  it.each([
    new Event("error"),
    new Error("[object Event]"),
    new Error("[object ErrorEvent]"),
  ])(
    "normalizes only known browser failures and preserves the cause %#",
    (cause) => {
      const error = normalizeNetworkFailure(cause);
      expect(error).toBeInstanceOf(NetworkDisconnectedError);
      expect((error as Error).message).toContain("Could not reach the network");
      expect((error as Error).cause).toBe(cause);
      expect(isRetryableNetworkFailure(error)).toBe(true);
      expect(normalizeNetworkFailure(error)).toBe(error);
    },
  );
  it.each([
    new Error("Native runtime differs from the immutable metadata binding"),
    new DOMException("Disk full", "QuotaExceededError"),
    new Error("Unknown [object Event] failure"),
    new Error("[object Event] suffix"),
    new Error("[object Event]\n"),
    new Event("close"),
    "[object Event]",
    new NetworkDisconnectedError("Already classified"),
    undefined,
  ])("retains all other failures unchanged %#", (error) => {
    expect(normalizeNetworkFailure(error)).toBe(error);
  });
});

describe("automatic connection retry classification", () => {
  it.each([
    new MaxRetryAttemptedError("retry budget exhausted"),
    new NetworkDisconnectedError("disconnected"),
    new Event("error"),
    new Error("[object Event]"),
    new Error("[object ErrorEvent]"),
    new DedotError("Request timed out after 60000ms"),
  ])("recognizes pinned provider transport failures %#", (error) => {
    expect(isRetryableNetworkFailure(error)).toBe(true);
  });
  it.each([
    new Error("The endpoint is not the configured PortalDot V3 testnet."),
    new Error("Native runtime differs from the immutable metadata binding"),
    new Error("Pinned metadata does not match its immutable native source"),
    new Error("Invalid LOCAL manifest"),
    new DOMException("Disk full", "QuotaExceededError"),
    new JsonRpcError({ code: -32601, message: "Unsupported method" }),
    new Error("Request timed out after 60000ms"),
    new DedotError("Expected an object from the native codec"),
    new Event("close"),
    undefined,
    "network failed",
  ])(
    "leaves policy, storage, codec and unknown failures nonretryable %#",
    (error) => {
      expect(isRetryableNetworkFailure(error)).toBe(false);
    },
  );
});
