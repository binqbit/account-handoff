# Operating boundaries

## A dedicated beneficiary from the beginning

The grant must name the Pure account's correct application identity when it is created. The workflow does not rewrite a fixed personal beneficiary after a key loss. The supported account profile is a dedicated grant beneficiary with known creation and permission history.

The application checks the network profile, identity mapping, account permissions, balances and grant state before preparing an operation. Unsupported configuration or incomplete evidence blocks the affected action.

PortalDot uses automatic account mapping. The application still requires the funded native account's persisted reverse mapping to resolve to that same account; it does not substitute a fallback address or submit manual mapping calls. LOCAL uses its separately qualified explicit-mapping configuration.

## Supported multisig profile

The current profile uses two-of-three native multisigs and replaces one member per handoff. It supports successive handoffs; it does not provide arbitrary thresholds or a general-purpose wallet dashboard. The configured approval sequence remains explicit in each operation review.

Connecting a multisig verifies its derived identity, not ownership of a signing key. Connecting an existing Pure requires its creation block and transaction and verifies that the supplied group is its sole current controller. An unrelated personal beneficiary cannot be converted into this dedicated-account workflow. Native operations remain gated by the qualified network profile.

## Continuity is not universal recovery

An available current quorum is necessary. One unavailable signer in a two-of-three group can be replaced by the remaining quorum; losing that quorum is a different problem. An authorized compromised quorum can still act, and changing controllers does not undo earlier transfers or submissions.

## Shared authority is visible

Both old and new groups have authority during the two-stage transition. This is not an account freeze or an expected-state lock. The second stage removes the exact old controller permission and checks that only the intended new controller remains.

Unexpected delegates are not silently removed. Independent recovery paths, application delegates, asset allowances and historical approvals require separate treatment. Concurrent authorized changes can make the result differ from the reviewed plan.

## Funding stays explicit

The interface separates each signer's transaction fees, proposal deposits, proxy reserves, mapping holds and grant principal. Existing native vesting is not automatically spendable liquidity for operational costs. Replacing a controller does not promise an automatic refund of the original account-creation reserve.

## The grant keeps its own rules

Deadlines, reviewer decisions and payout conditions remain in force. A reviewer approval can release a tranche in that same transaction when it reaches the required threshold. A controller replacement is not funder consent or legal reassignment of the grant.

The first workflow supports one submission per milestone in a known open round. Reopened review and resubmission are outside that workflow. In the reference Vestry contract, pending calls are not bound to the round in which they were prepared. A stale warning or local deletion does not cancel native approvals, and an old call may remain executable after a review round changes. Such a change stops preparation of new grant actions and requires explicit proposal reconciliation, rather than an automatic resubmission. The grant contract still allows its authorized reviewers and controllers to act outside the interface.

## Completion has a precise meaning

Rotated means that the expected new native controller is verified at the stated finalized checkpoint. Continued additionally means that this controller has successfully submitted the next milestone on the same grant. Neither label means that reviewers have approved the next tranche or that it has been paid.

An open milestone can still be submitted after the original vesting period ends, provided the original schedule, grant identity and current authority still pass verification. The active-vesting continuity certificate remains stricter: a late submission does not receive that certificate, and the interface identifies the finalized submission separately.

After a disconnect or uncertain wallet response, the application reconciles actual chain evidence before offering another action. It never substitutes a successful simulation, transaction hash or top-level event for the completed grant task.
