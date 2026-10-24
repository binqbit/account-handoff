# LOCAL metadata binding

The executable schema preserves the first PortalDot profile's metadata version 14 requirement. The explicitly selected modified upstream runtime identifies itself as `account-handoff-local`; its accepted profile may use exact metadata version 14, 15 or 16 selected by the native client.

This exception requires the same raw metadata, runtime bytecode, source/build relationship and generated decoder evidence as the original profile. It does not infer acceptance from a version number or relax the runtime API, contract, mapping, wallet or operation gates. Other spec names cannot use this branch.

The preserved pre-implementation schema in the private research reference records the original design. This directory owns the executable schema; `schemas.test.ts` covers the scoped LOCAL exception and remote rejection.

## Exact decoder metadata and live state

LOCAL uses an explicit metadata binding: the exact SCALE blob, its SHA256, genesis, spec version, runtime code hash, and the immutable block from which the blob was captured. The native client verifies that source and injects these exact bytes into Dedot for encoding and decoding. `metadataSha256` continues to mean SHA256 of those complete bytes; no field is removed or normalized.

The pinned upstream runtime constructs the `Revive.EthBlockBuilderIR` storage default using the live EVM base fee. Consequently, a new metadata capture can have different default bytes while its runtime code, types, calls, events and APIs remain unchanged. Decoder provenance therefore identifies its own source block separately from the block whose live state is read. This follows the implementation in [the pinned block builder](https://github.com/paritytech/polkadot-sdk/blob/b76182dd335abcc07b0ff876d4889416a4c08ab7/substrate/frame/revive/src/evm/block_hash/block_builder.rs).

Every bound state/API read verifies the runtime code identity at its requested block. Balances, fees, contract state and other live values come from anchored RPC calls; the dynamic metadata default is not used as a live value. A changed code hash, mismatched source block or wrong metadata blob refuses the binding. Unbound discovery clients cannot qualify an application operation. This preserves the raw-byte fingerprint rule while making the decoder's source explicit instead of treating a client cache as a current-block observation.
