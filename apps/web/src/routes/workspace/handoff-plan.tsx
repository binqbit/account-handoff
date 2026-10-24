import { useState, type FormEvent } from "react";
import { AddressList } from "../../components/addresses/address-list";
import { participantOptions } from "../../components/addresses/options";
import { Button, Card } from "../../components/ui";
import type { ScreenProps } from "../screen-types";

export function HandoffPlan({ snapshot, run }: ScreenProps) {
  const workspace = snapshot.workspace!;
  const [members, setMembers] = useState(
    workspace.oldController.members.slice(0, 2).map((member) => member.address),
  );
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (members.length !== 3) {
      setError("Choose the three members of the replacement group.");
      return;
    }
    try {
      await run({ type: "plan-handoff", members });
    } catch {
      /* Command errors are shown by the application. */
    }
  }
  return (
    <Card title="Choose the replacement group">
      <p className="muted">
        Keep two current members and choose one replacement. The threshold
        remains 2 of 3.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <AddressList
          label="Replacement signers"
          values={members}
          onChange={setMembers}
          count={3}
          help="Choose the full membership of the new group."
          options={participantOptions(snapshot)}
          disabled={!!snapshot.busy}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!!snapshot.busy || members.length !== 3}
        >
          Prepare handoff
        </Button>
      </form>
      <p className="form-reassurance">
        This saves the plan. Your current group keeps control until the reviewed
        transactions complete.
      </p>
    </Card>
  );
}
