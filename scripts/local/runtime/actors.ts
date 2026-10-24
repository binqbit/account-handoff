import { Keyring } from "@polkadot/keyring";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady, createKeyMulti } from "@polkadot/util-crypto";
import { u8aToHex } from "dedot/utils";
import { account, type Hex } from "@account-handoff/native-adapter";
import type { LocalActors, Role } from "./types.js";
export async function createLocalActors(): Promise<LocalActors> {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519" });
  const pairs: Record<Role, KeyringPair> = {
    A: keyring.addFromUri("//Alice"),
    B: keyring.addFromUri("//Bob"),
    C: keyring.addFromUri("//Charlie"),
    D: keyring.addFromUri("//Dave"),
    F: keyring.addFromUri("//Eve"),
    R1: keyring.addFromUri("//Ferdie"),
    R2: keyring.addFromUri("//Alice//stash"),
    X: keyring.addFromUri("//Alice//AccountHandoffMappingProbe"),
  };
  const actors = Object.fromEntries(
    Object.entries(pairs).map(([role, pair]) => [role, account(pair.address)]),
  ) as Record<Role, Hex>;
  const m0 = account(
    u8aToHex(createKeyMulti([actors.A, actors.B, actors.C].sort(), 2)),
  );
  const m1 = account(
    u8aToHex(createKeyMulti([actors.A, actors.B, actors.D].sort(), 2)),
  );

  return { pairs, actors, m0, m1 };
}
