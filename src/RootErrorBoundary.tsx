import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordDiagnostic } from "./diagnostics";
import { DiagnosticHelp } from "./DiagnosticHelp";

export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    recordDiagnostic({ kind: "render", service: "app", resource: "render" });
  }

  render() {
    if (this.state.failed) {
      return <main className="app-unavailable" role="alert">
        <h1>Сайт временно недоступен</h1>
        <p>Попробуйте обновить страницу немного позже.</p>
        <button type="button" onClick={() => window.location.reload()}>Обновить страницу</button>
        <DiagnosticHelp />
      </main>;
    }
    return this.props.children;
  }
}
