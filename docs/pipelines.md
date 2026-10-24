# Workflow stages

## Prepare the operation

Identify the intended network, beneficiary, grant and controllers. Read authoritative state, check the application-address mapping and confirm the supported account profile. Explain deposits, fee payers, deadlines and the limits of the change before requesting any authorization.

## Collect signer approvals

Each signer reviews the same operation and uses their own wallet. A pending approval is not an executed change. A coordinator can prepare the work but cannot manufacture another participant's approval.

## Execute and verify

The final required approval can cause a native operation to execute. The interface tracks submission, inclusion and finality separately, inspects nested execution results and checks the resulting state. It does not treat a transaction hash or a top-level success event as the business outcome.

## Continue grant work

After control is verified, the replacement group performs the next grant action. The application confirms that the same beneficiary was authorized and that the expected milestone changed state. Grant approval and payout are not silently included in a control-rotation success message.

## Reconcile and resume

After a refresh, disconnect or uncertain submission, the application reconstructs the relevant operation from chain evidence and the locally saved review context before proposing another transaction. Cancellation can stop some pending work, but it does not undo an already finalized action. A failed final operation may require a new approval round rather than a retry button that resends the same request.

If authority is ambiguous, the runtime changes, the mapping is wrong or the required current quorum is unavailable, the flow stops at that specific boundary. It never labels an unverified state as safe merely to keep the workflow moving.
