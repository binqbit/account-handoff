import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Icon } from "../ui";

export class InterfaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log application records or signing context. */
  }
  render() {
    return this.state.failed ? (
      <div className="critical-error">
        <Icon name="alert" size={32} />
        <h1>Could not open the interface</h1>
        <p>
          Records remain in storage. Reloading restores the view without
          automatically signing or sending.
        </p>
        <Button onClick={() => window.location.reload()}>Open again</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
