# The concept

## A grant outlives an individual signing key

A grant-funded team may receive funding over several milestones. Some released funds may remain subject to native vesting, and the grant application may only accept future submissions from the beneficiary account recorded at creation. Changing people in the team should not necessarily require changing that beneficiary identity.

The application separates the account that owns the grant-related state from the group authorized to act for it. The team establishes the beneficiary before receiving the grant. Later, an available quorum replaces the controlling group and demonstrates that the new group can continue the same application workflow.

## Signers, controller and beneficiary

- Individual signers authorize their own transactions with their wallets.
- A native controller multisig represents the signing group's threshold policy.
- A stable Pure account is the beneficiary and native state owner. Its mapped application address is used by the grant contract.

The Pure account is not a secret shared among the team. It has no ordinary known private key. Its authorized controllers perform actions through native delegation.

## Why this fits Portaldot

The design uses native account delegation and multisig together with native vesting and a Revive application identity. The application coordinates these capabilities while preserving the distinction between native account state and grant-contract state.

The product connects these capabilities into one grant workflow: establish the right beneficiary, prepare a change of control, collect the required approvals and verify that the replacement group can perform the next milestone action. Native state stays with the beneficiary rather than being moved between individual signers.

## What is deliberately outside the first scope

The application does not provide arbitrary wallet management, a new grant marketplace, key custody, lending, token issuance, cross-chain recovery or a representative council. It does not turn a controller replacement into funder approval. It cannot retrofit a dedicated beneficiary into a grant whose application does not permit changing its existing personal beneficiary.

The reference grant workflow follows the milestone-review and native-vesting model in the MIT-licensed [Vestry contract](https://github.com/nftkingiii/vestry). Vestry is an attributed source example, not a project partner.
