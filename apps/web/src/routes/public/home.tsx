import { Button, Card, Icon, PageHeader } from "../../components/ui";
import type { ScreenProps } from "../screen-types";

export function Home({ snapshot, navigate }: ScreenProps) {
  return (
    <>
      <PageHeader
        icon="home"
        eyebrow="Account Handoff"
        title="The team changes. The grant stays."
        description="Keep the same grant beneficiary when the people who control it change."
      />
      <div className="home-intro">
        <div>
          <p className="home-lead">
            Your team signs through a native multisig. A separate Pure account
            holds the grant identity, so replacing the signing group does not
            require a new beneficiary.
          </p>
          <div className="actions">
            <Button
              variant="primary"
              icon="arrow"
              onClick={() =>
                navigate(snapshot.network.connected ? "workspaces" : "network")
              }
            >
              Get started
            </Button>
            <Button icon="book" onClick={() => navigate("docs")}>
              Read the guide
            </Button>
            {snapshot.workspace && (
              <Button variant="ghost" onClick={() => navigate("overview")}>
                Open current workspace
              </Button>
            )}
          </div>
          <p className="home-note">
            Your keys stay in your wallet. Every transaction needs an explicit
            review and signature.
          </p>
        </div>
        <Card title="One identity. Different signing teams.">
          <div className="home-account-flow">
            <span>
              <Icon name="team" />
              <strong>Your team</strong>
              <small>Multisig controller</small>
            </span>
            <Icon name="arrow" size={18} />
            <span className="home-account-flow__stable">
              <Icon name="shield" />
              <strong>Beneficiary</strong>
              <small>Stable Pure account</small>
            </span>
            <Icon name="arrow" size={18} />
            <span>
              <Icon name="grant" />
              <strong>Your grant</strong>
              <small>Same recipient</small>
            </span>
          </div>
        </Card>
      </div>
      <div className="section-heading">
        <h2>Start in three steps</h2>
      </div>
      <div className="home-steps">
        <Card title="Connect your wallet">
          <span className="home-step">1</span>
          <p>
            Choose the network and a personal signing account. The app checks
            the network before enabling transactions.
          </p>
        </Card>
        <Card title="Create or connect a workspace">
          <span className="home-step">2</span>
          <p>
            Set up your current multisig, or connect an existing one. Create a
            dedicated beneficiary or verify one you already use.
          </p>
        </Card>
        <Card title="Work together, then hand off">
          <span className="home-step">3</span>
          <p>
            Manage grant milestones. When your team changes, choose a
            replacement group and verify the transfer of control.
          </p>
        </Card>
      </div>
      <Card title="Before you begin">
        <p className="muted">
          The supported group is 2 of 3 signers. Keep an available quorum, and
          make sure the grant names the dedicated beneficiary. An existing
          personal grant cannot be moved to a Pure account through this flow.
        </p>
        <Button variant="ghost" icon="book" onClick={() => navigate("docs")}>
          How accounts and handoffs work
        </Button>
      </Card>
    </>
  );
}
