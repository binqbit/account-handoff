# How it works

## 1. Establish the beneficiary before funding

The team agrees on its signing group and threshold. That group creates a dedicated Pure beneficiary. The application verifies its native identity and the application address that resolves back to it. This identity relationship must be established before grant creation and before a native vesting payout.

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
