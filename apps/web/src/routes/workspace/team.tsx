import {
  Address,
  Badge,
  Button,
  Card,
  Identity,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { NoWorkspace } from "./shared";

export function Team(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        eyebrow="Team and authority"
        title="People change. The beneficiary stays."
        description="Each group has its own controller address. A personal wallet signs only actions allowed for its owner."
        actions={
          workspace && (
            <Button
              variant="primary"
              icon="arrow"
              onClick={() => navigate("handoff")}
            >
              Hand off control
            </Button>
          )
        }
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          <div className="equal-grid">
            {[workspace.oldController, workspace.newController].map(
              (controller, index) => (
                <Card
                  key={controller.address || index}
                  eyebrow={
                    index === 0 ? "Original group · M0" : "Next group · M1"
                  }
                  title={`${controller.threshold} of ${controller.members.length} signers`}
                  action={
                    <Badge
                      tone={
                        controller.active
                          ? workspace.authority === "DualControl"
                            ? "warning"
                            : "positive"
                          : "neutral"
                      }
                    >
                      {controller.active === null
                        ? "Not verified"
                        : controller.active
                          ? "Authorized"
                          : "Not authorized"}
                    </Badge>
                  }
                >
                  <Address value={controller.address} />
                  <ul className="member-list">
                    {controller.members.map((member, memberIndex) => (
                      <li key={member.address}>
                        <span className="member-avatar">
                          {member.label?.slice(0, 1) ?? memberIndex + 1}
                        </span>
                        <Identity identity={member} />
                      </li>
                    ))}
                  </ul>
                </Card>
              ),
            )}
          </div>
          <Card
            title="Budgets and identities"
            eyebrow="Funds for executing operations"
          >
            <div className="table-scroll">
              <table>
                <caption className="sr-only">
                  Operating budgets of participants and the beneficiary
                </caption>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Purpose</th>
                    <th>Free / available</th>
                    <th>Reserved</th>
                    <th>Mapping</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.balances.map((balance) => (
                    <tr key={`${balance.identity.address}-${balance.role}`}>
                      <td>
                        <Identity identity={balance.identity} />
                      </td>
                      <td>{balance.role}</td>
                      <td>
                        {balance.free ?? "Unknown"} /{" "}
                        {balance.available ?? "Unknown"}{" "}
                        <span className="muted">{balance.symbol}</span>
                      </td>
                      <td>{balance.reserved ?? "Unknown"}</td>
                      <td>
                        <Badge
                          tone={
                            balance.mapping === "verified"
                              ? "positive"
                              : balance.mapping === "missing"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {
                            {
                              verified: "Verified",
                              missing: "Required",
                              unknown: "Unknown",
                              "not-required": "Not required",
                            }[balance.mapping]
                          }
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!workspace.balances.length && (
                <p className="muted">
                  Balances appear after the finalized state is read.
                </p>
              )}
            </div>
            <div className="actions">
              {snapshot.actions
                .filter(
                  (action) =>
                    action.category === "funding" ||
                    action.id === "GRC-SETUP-MAP-ACTOR",
                )
                .map((action) => (
                  <Button key={action.id} onClick={() => openAction(action.id)}>
                    {action.title}
                  </Button>
                ))}
            </div>
            <p className="footnote">
              Signer fees, proposal reserves, funder escrow, mapping holds and P
              liquidity are tracked separately. Vested funds are not an
              available operating budget.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
