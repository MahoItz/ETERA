import { Component, type ErrorInfo, type ReactNode } from "react";

export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Keep the public screen free of implementation details; hosting logs retain diagnostics.
  }

  render() {
    if (this.state.failed) {
      return <main className="app-unavailable" role="alert">
        <h1>Сайт временно недоступен</h1>
        <p>Попробуйте обновить страницу немного позже.</p>
      </main>;
    }
    return this.props.children;
  }
}
