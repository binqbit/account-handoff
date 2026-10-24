# How it works

## Start with your current multisig

Create a workspace for a new group or connect an existing native multisig. Both routes use the complete member list and threshold to derive its address; connecting also checks the supplied address. A multisig configuration has no deployment transaction of its own. Saving it does not send funds or grant authority.

Only the current group is required. Choose a replacement later, from Control handoff. You can also attach a Pure account controlled by that group and its existing grant: the application verifies the creation receipt, current permissions, identity mapping and grant history before accepting the connection.

## 1. Establish the beneficiary before funding

The team agrees on its signing group and threshold. That group creates a dedicated Pure beneficiary. The application verifies its native identity and the application address that resolves back to it. This identity relationship must be established before grant creation and before a native vesting payout.

Wallets, multisigs and Pure accounts are displayed and copied as native SS58 addresses. The contract recipient and grant contract use a separate 20-byte H160 representation, labelled in the interface. Address formatting does not change the underlying account or its signing authority.

The funder then creates a compatible grant for that beneficiary. The funder and reviewers retain their existing roles. The team must separately confirm any grant terms or consent requirements; a valid blockchain operation does not answer those legal or organizational questions.

## 2. Submit and review the first milestone

The team submits milestone evidence through its native controller multisig. The grant application sees the stable beneficiary as the caller, not the particular human who submits the outer transaction.

Reviewers decide whether to approve the milestone. In the chosen native-token, vesting-enabled example, a released tranche becomes a native vesting schedule associated with the beneficiary account. Approval, release and vesting are separate from the team's control policy.

## 3. Prepare the replacement group

When one signer needs to leave or replace a key, a healthy current quorum defines the replacement group. The interface shows the exact accounts and threshold, checks that the replacement participant can use the intended wallet, and distinguishes account balances from funds available for fees and deposits.

A lost current quorum is a different problem. This workflow cannot authorize itself when the existing threshold is unavailable.

## 4. Transfer native control in two stages

The current group first authorizes the new group. During the transition, both groups can control the beneficiary. This is a real period of shared authority, not a freeze or a simulation.

The new group then removes the exact old controller permission. The application checks the finalized native permission list and accepts the rotation only when the new group is the sole remaining controller under the supported profile. It does not silently clear unexpected permissions or claim to prevent concurrent authorized changes. The workflow removes only the specified old controller permission; it never resets every permission as a shortcut.

If removal fails, the interface must not report success merely because the surrounding transaction was accepted. It determines the actual result from the relevant nested execution evidence and finalized state.

## 5. Prove continuity by doing the next task

The application verifies the new native controller and the same beneficiary identities. The new group then submits the next open milestone on the existing grant.

Only after that application action is verified does the workflow say that grant work has continued. Review approval and payout remain separate future steps. Existing vesting follows its original timeline; the interface distinguishes the schedule from the current lock and spendable balance.

## Repeat a control change

After the replacement is the verified sole controller, choose **Start another handoff**. The application rechecks the native approval and removal receipts, retains the previous handoff, and makes the authorized group the current group for the next change. The Pure address, application address, grant contract and grant ID stay with the workspace.

A controller change and a grant submission are separate outcomes. Another control change does not need an open next milestone; it still checks the beneficiary, grant, current vesting state and reserve backing. Continued grant work is reported only when a separate eligible submission is verified. The original Pure creator remains recorded for its historical reserve even after several controller changes.
