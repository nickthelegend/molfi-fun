import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render that throws, instead of letting it blank the table.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so before this
 * a single bad card value or a malformed poll response left a black page with no explanation
 * and no way back. That is the worst possible failure during a demo: it looks like the
 * project is broken rather than like one request went wrong.
 *
 * Reloading is offered rather than performed. A crash loop that reloads itself is harder to
 * diagnose than one that sits still and shows the error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[poker] render failed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-6">
        <div className="max-w-lg">
          <p className="font-mono text-xs uppercase tracking-widest text-white/30">
            The table stopped
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Something threw while drawing the game</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/50">
            Your seat and your cards live on chain, not in this page, so nothing here was lost.
            Reloading rejoins the same hand where it stands.
          </p>

          <pre className="mt-6 max-h-40 overflow-auto rounded-lg border border-white/10 bg-white/[0.03] p-3 font-mono text-[11px] text-white/40">
            {error.message || String(error)}
          </pre>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition-all hover:bg-white/80 active:scale-95"
            >
              Reload
            </button>
            <a
              href="https://molfi.fun"
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 no-underline transition-all hover:border-white/30 hover:text-white"
            >
              Back to molfi.fun
            </a>
          </div>
        </div>
      </div>
    );
  }
}
