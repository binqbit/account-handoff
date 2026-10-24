import { Button, Icon } from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { ContinuityDiagram } from "./continuity-diagram";

const steps = [
  {
    title: "Connect your wallet",
    text: "Choose the network and your personal signing account. The app verifies the environment before you act.",
    icon: "wallet",
  },
  {
    title: "Create or connect a workspace",
    text: "Bring your current multisig, or create a new group. Establish the beneficiary your grant will use.",
    icon: "team",
  },
  {
    title: "Work together, then hand off",
    text: "Manage milestones. When the team changes, replace its controller and keep the same grant.",
    icon: "handoff",
  },
];
export function Home({ snapshot, navigate }: ScreenProps) {
  return (
    <>
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="home-eyebrow">
            <span />
            Native account continuity
          </p>
          <h1
            id="page-heading"
            tabIndex={-1}
            aria-label="The team changes. The grant stays."
          >
            The team changes.<span>The grant stays.</span>
          </h1>
          <p className="home-hero__description">
            Keep one grant beneficiary as your team evolves. Native multisig
            controls who can act; a separate Pure account keeps the identity
            that matters.
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
          </div>
          {snapshot.workspace ? (
            <button
              className="home-resume"
              aria-label="Open current workspace"
              onClick={() => navigate("overview")}
            >
              Continue to {snapshot.workspace.name}
              <Icon name="arrow" size={15} />
            </button>
          ) : (
            <p className="home-reassurance">
              <Icon name="shield" size={14} />
              Your keys stay in your wallet. You approve every transaction.
            </p>
          )}
        </div>
        <ContinuityDiagram />
      </section>
      <section className="home-journey" aria-labelledby="home-steps-title">
        <div className="home-section-title">
          <p className="home-eyebrow">From setup to handoff</p>
          <h2 id="home-steps-title">Start in three steps</h2>
        </div>
        <ol>
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className="home-step-heading">
                <span className="home-step-number">0{index + 1}</span>
                <Icon name={step.icon} size={19} />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <div className="home-boundary">
        <Icon name="info" size={17} />
        <p>
          A current 2-of-3 quorum is required. The grant must use the dedicated
          beneficiary from the beginning.
        </p>
        <button className="text-button" onClick={() => navigate("docs")}>
          See the supported flow
          <Icon name="chevron" size={14} />
        </button>
      </div>
    </>
  );
}
