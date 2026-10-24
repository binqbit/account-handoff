import { Icon } from "../../components/ui";

export function ContinuityDiagram() {
  return (
    <div
      className="continuity-diagram"
      role="img"
      aria-label="A current two-of-three team can be replaced by a new two-of-three team while the Pure beneficiary and grant recipient stay the same."
    >
      <div className="continuity-diagram__heading">
        <span>How control changes</span>
        <span className="continuity-diagram__pill">
          <Icon name="shield" size={13} />
          Same grant
        </span>
      </div>
      <div className="controller-pair">
        <div className="controller-preview">
          <span className="controller-preview__label">Current team</span>
          <div className="signer-stack">
            <i>A</i>
            <i>B</i>
            <i>C</i>
          </div>
          <strong>2 of 3 signers</strong>
        </div>
        <div className="controller-preview controller-preview--next">
          <span className="controller-preview__label">Next team</span>
          <div className="signer-stack">
            <i>A</i>
            <i>B</i>
            <i className="signer-stack__new">D</i>
          </div>
          <strong>2 of 3 signers</strong>
        </div>
      </div>
      <div className="continuity-connector">
        <span />
        <span />
      </div>
      <div className="beneficiary-preview">
        <span className="beneficiary-preview__icon">
          <Icon name="shield" size={23} />
        </span>
        <div>
          <strong>Pure beneficiary</strong>
          <span>Your stable grant account</span>
        </div>
        <Icon name="check" size={18} />
      </div>
      <div className="preserved-identities">
        <span>
          <Icon name="check" size={13} />
          Native address
        </span>
        <span>
          <Icon name="check" size={13} />
          Grant recipient
        </span>
        <span>
          <Icon name="check" size={13} />
          Grant ID
        </span>
      </div>
      <p>The controlling group changes. The beneficiary stays.</p>
    </div>
  );
}
