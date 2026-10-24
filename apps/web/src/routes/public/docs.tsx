import { Button, Card, Icon, PageHeader } from "../../components/ui";
import type { ScreenProps } from "../screen-types";

const sections = [
  ["getting-started", "Getting started"],
  ["accounts", "Accounts"],
  ["handoffs", "Control handoffs"],
  ["recovery", "Verification and recovery"],
] as const;
function showSection(id: string) {
  const heading = document.getElementById(`docs-${id}`);
  heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  heading?.focus({ preventScroll: true });
}
export function Docs({ navigate }: ScreenProps) {
  return (
    <>
      <PageHeader
        icon="book"
        eyebrow="Docs"
        title="A guide to Account Handoff"
        description="Set up a team, understand the accounts, and change control without changing the grant beneficiary."
      />
      <nav className="docs-index" aria-label="Guide sections">
        {sections.map(([id, label]) => (
          <button key={id} onClick={() => showSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="docs-content">
        <section aria-labelledby="docs-getting-started">
          <h2 id="docs-getting-started" tabIndex={-1}>
            Getting started
          </h2>
          <ol className="docs-steps">
            <li>
              <strong>Connect the network and your wallet.</strong> Open Network
              and readiness, choose the intended endpoint, and run its checks.
              Connect a native wallet, then choose your personal account from
              the wallet menu.
            </li>
            <li>
              <strong>Create or connect a workspace.</strong> Enter the three
              current signers, the funder and two reviewers. The supported
              threshold is 2 of 3. Connecting an existing multisig also requires
              its address so the app can check the membership.
            </li>
            <li>
              <strong>Establish the beneficiary.</strong> Follow the workspace's
              next step to fund the required reserves, create a Pure account and
              verify its application-address mapping. Saving a multisig
              configuration alone sends no transaction.
            </li>
            <li>
              <strong>Connect the grant.</strong> Create a grant for the
              beneficiary, or attach an existing Pure and grant using the Pure
              creation block and transaction hashes, contract address and grant
              ID. The app verifies the original creator, current controller and
              grant history.
            </li>
            <li>
              <strong>Submit and review milestones.</strong> The team submits
              evidence through the beneficiary. Reviewers approve separately.
              Submission, approval and payment are different outcomes.
            </li>
          </ol>
          <Button icon="network" onClick={() => navigate("network")}>
            Open network setup
          </Button>
        </section>
        <section aria-labelledby="docs-accounts">
          <h2 id="docs-accounts" tabIndex={-1}>
            Which account does what?
          </h2>
          <div className="docs-accounts">
            <Card title="Personal wallet">
              <Icon name="wallet" />
              <p>
                Your individual signing account. Connecting it does not give you
                permission to act for another account.
              </p>
            </Card>
            <Card title="Multisig controller">
              <Icon name="team" />
              <p>
                The team's approval policy. Two of its three members authorize
                each supported operation. A different membership produces a
                different multisig address.
              </p>
            </Card>
            <Card title="Pure beneficiary">
              <Icon name="shield" />
              <p>
                The stable native account behind the grant. Its verified
                application address stays the recipient when the controller
                changes.
              </p>
            </Card>
          </div>
          <p>
            Use native SS58 or 32-byte account addresses for signers. A grant
            contract uses a 20-byte address. The interface lets you inspect and
            copy complete addresses without putting long hashes in every label.
          </p>
        </section>
        <section aria-labelledby="docs-handoffs">
          <h2 id="docs-handoffs" tabIndex={-1}>
            Changing the signing group
          </h2>
          <ol className="docs-steps">
            <li>
              <strong>Prepare the replacement.</strong> Open Control handoff
              when needed. Keep two current members and choose one replacement.
              Nothing changes on-chain when you save this plan.
            </li>
            <li>
              <strong>Authorize the new group.</strong> Review the operation and
              collect the required signatures. Both groups can control the
              beneficiary during this transition.
            </li>
            <li>
              <strong>Remove the previous group.</strong> The replacement group
              removes the exact old permission. The app verifies that the new
              controller is the sole remaining controller.
            </li>
            <li>
              <strong>Continue or start another handoff.</strong> Submit the
              next eligible milestone separately, or choose Start another
              handoff after the completed change is verified. Previous changes
              remain in History.
            </li>
          </ol>
          <p>
            The beneficiary, its application address and the existing grant stay
            the same. An unavailable current quorum cannot authorize its own
            replacement. Removing a controller does not cancel old native
            proposals.
          </p>
        </section>
        <section aria-labelledby="docs-recovery">
          <h2 id="docs-recovery" tabIndex={-1}>
            Review, verification and recovery
          </h2>
          <dl className="docs-states">
            <div>
              <dt>Prepared</dt>
              <dd>
                A local review of the exact operation, signer and costs. No
                signature has been requested yet.
              </dd>
            </div>
            <div>
              <dt>Signed</dt>
              <dd>
                Your wallet authorized the reviewed transaction. Sending it is
                still a separate action.
              </dd>
            </div>
            <div>
              <dt>Control changed</dt>
              <dd>
                The new controller and beneficiary identity have been checked
                against finalized native state.
              </dd>
            </div>
            <div>
              <dt>Continued</dt>
              <dd>
                A separate next-milestone submission was verified. It does not
                mean reviewers have approved or paid it.
              </dd>
            </div>
            <div>
              <dt>Unknown outcome</dt>
              <dd>
                Use Reconcile outcome. Do not create another attempt until the
                existing transaction or proposal has been checked.
              </dd>
            </div>
          </dl>
          <p>
            Fees, signer proposal deposits, beneficiary liquidity and grant
            funds are separate budgets. If an action is blocked, open its review
            to see the missing requirement. A changed runtime, unexpected
            permissions or an unverified mapping can block signing.
          </p>
          <p>
            The qualified LOCAL environment is intended for local testing. Other
            network modes require their own verified profile. A successful RPC
            connection alone does not establish compatibility.
          </p>
        </section>
      </div>
    </>
  );
}
