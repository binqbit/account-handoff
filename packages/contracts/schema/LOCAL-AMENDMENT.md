# LOCAL metadata binding

The executable schema preserves the first PortalDot profile's metadata version 14 requirement. The explicitly selected modified upstream runtime identifies itself as `account-handoff-local`; its accepted profile may use exact metadata version 14, 15 or 16 selected by the native client.

This exception requires the same raw metadata, runtime bytecode, source/build relationship and generated decoder evidence as the original profile. It does not infer acceptance from a version number or relax the runtime API, contract, mapping, wallet or operation gates. Other spec names cannot use this branch.

The preserved pre-implementation schema in the private research reference records the original design. This directory owns the executable schema; `schemas.test.ts` covers the scoped LOCAL exception and remote rejection.
