/** Finite wire declarations corresponding to grc-v2-local-1. Runtime validation enforces conditional schema constraints. */

export type * from "./records/primitives.js";
export type * from "./records/runtime.js";
export type * from "./records/state.js";
export type * from "./records/intents.js";
export type * from "./records/calls.js";
export type * from "./records/transactions.js";
export type * from "./records/receipts.js";
export type * from "./records/continuity.js";
export type * from "./records/package.js";

export const CONTRACT_REVISION = "grc-v2-local-1" as const;
