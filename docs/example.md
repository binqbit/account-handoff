# Worked example: continue the same grant

An illustrative team scenario shows the complete workflow.

A team initially uses Alice, Ben and Casey with a two-person threshold. Their native multisig creates a dedicated Pure beneficiary. A grant is created for its verified application address.

The first milestone has released 18 test POT into native vesting. A second milestone of 12 test POT remains open. The first tranche uses a 1,800-block vesting schedule; the second tranche is configured without a new vesting schedule. These are illustrative demonstration parameters.

Casey can no longer participate. Alice and Ben still form a valid current quorum. They prepare a replacement group consisting of Alice, Ben and Dana, still requiring two signers.

1. The interface confirms the existing grant beneficiary, native vesting owner and current controller.
2. Alice and Ben authorize the replacement group. Both groups temporarily have native control.
3. Alice and Dana approve the operation that removes the original controller. Dana's participation is deliberately included; Alice and Ben alone would not demonstrate that Dana's key works.
4. The interface verifies that the new group is the only native proxy controller and that the beneficiary identities are unchanged.
5. Alice and Dana submit the next milestone through the same grant beneficiary.
6. The interface verifies that submission in the existing grant. It does not claim that reviewers have approved it or that the second tranche has been paid.

If an operation fails, the interface shows the actual result, keeps the correct current authority state and explains the next permitted step. An outer transaction can be accepted while an inner call fails, so a green transaction status alone does not complete the workflow.

