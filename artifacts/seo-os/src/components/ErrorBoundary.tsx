import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
          <div className="max-w-lg border border-rule rounded-md bg-background p-8">
            <h1 className="font-serif text-xl mb-2">Something broke</h1>
            <p className="text-sm text-ink-muted mb-4">
              An unexpected error occurred while rendering the page.
            </p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-destructive bg-secondary/40 p-3 rounded-sm mb-4">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => {
                this.setState({ error: null });
                const base = import.meta.env.BASE_URL || "/";
                window.location.assign(base);
              }}
              className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
            >
              Reload home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
