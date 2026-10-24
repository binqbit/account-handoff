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
        <h1>Інтерфейс не вдалося відкрити</h1>
        <p>
          Записи залишаються у сховищі. Перезавантаження відновить перегляд без
          автоматичного підпису чи надсилання.
        </p>
        <Button onClick={() => window.location.reload()}>Відкрити знову</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
