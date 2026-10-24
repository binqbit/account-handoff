import { describe, expect, it } from "vitest";
import { assessNativeEra } from "@account-handoff/domain";
import { $Era } from "dedot/codecs";
import { u8aToHex } from "dedot/utils";

describe("native SCALE era lifetime", () => {
  it("uses the original phase/incarnation and expires at death, including period wrap", () => {
    const era = u8aToHex($Era.tryEncode({ period: 64n, current: 63n }));
    expect(assessNativeEra(era, 63n, 126n)).toMatchObject({
      period: 64n,
      phase: 63n,
      birth: 63n,
      death: 127n,
      state: "valid",
    });
    expect(assessNativeEra(era, 63n, 127n).state).toBe("expired");
    expect(assessNativeEra(era, 63n, 191n).state).toBe("expired");
    const wrapped = u8aToHex($Era.tryEncode({ period: 64n, current: 64n }));
    expect(assessNativeEra(wrapped, 64n, 127n)).toMatchObject({
      phase: 0n,
      birth: 64n,
      death: 128n,
      state: "valid",
    });
    expect(assessNativeEra(wrapped, 64n, 128n).state).toBe("expired");
  });
  it("matches native quantized phases and the minimum period without using wall time", () => {
    const era = u8aToHex($Era.tryEncode({ period: 8192n, current: 5001n }));
    expect(assessNativeEra(era, 5001n, 13191n)).toMatchObject({
      period: 8192n,
      phase: 5000n,
      birth: 5000n,
      death: 13192n,
      state: "valid",
    });
    expect(assessNativeEra(era, 5001n, 13192n).state).toBe("expired");
    const minimum = u8aToHex($Era.tryEncode({ period: 4n, current: 6n }));
    expect(assessNativeEra(minimum, 6n, 9n)).toMatchObject({
      birth: 6n,
      death: 10n,
      state: "valid",
    });
    expect(assessNativeEra(minimum, 6n, 10n).state).toBe("expired");
    expect(assessNativeEra(minimum, 6n, 5n).state).toBe("not_yet_valid");
  });
  it("never labels malformed or immortal bytes as a definitively expired packet", () => {
    expect(assessNativeEra("0x00", 0n, 1_000_000n)).toEqual({
      kind: "immortal",
      birth: 0n,
      death: null,
      state: "valid",
    });
    for (const bytes of [
      "0x",
      "0x01",
      "0x0000",
      "0xf000",
      "0x1000",
      "0x010000",
    ])
      expect(() => assessNativeEra(bytes, 10n, 100n)).toThrow();
  });
});
