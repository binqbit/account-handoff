import type { SignerPayloadJSON } from "dedot/types";

export interface WalletAccount {
  address: string;
  name?: string;
  type?: string;
  source: string;
}
export interface WalletSession {
  source: string;
  version: string;
  accounts: WalletAccount[];
  signPayload: (payload: SignerPayloadJSON) => Promise<unknown>;
  subscribe: (
    callback: (accounts: WalletAccount[]) => void,
  ) => Promise<() => void>;
}
export interface InjectedAccount {
  address: string;
  name?: string;
  type?: string;
}
export interface EnabledWallet {
  accounts: {
    get: () => Promise<InjectedAccount[]>;
    subscribe?: (
      cb: (accounts: InjectedAccount[]) => void,
    ) => (() => void) | Promise<() => void>;
  };
  signer: { signPayload?: (payload: SignerPayloadJSON) => Promise<unknown> };
}
export interface Injection {
  version?: string;
  enable: (name: string) => Promise<EnabledWallet>;
}
declare global {
  interface Window {
    injectedWeb3?: Record<string, Injection>;
  }
}
