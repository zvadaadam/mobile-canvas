import { Component, type ReactNode } from 'react';
const noop = () => {};
export const Observe = { configure: noop, logEvent: noop, setGlobalAttributes: noop, reportError: (error: unknown) => console.error(error) };
export const ObserveRoot = { wrap: <T,>(component: T) => component };
const observe = { markInteractive: noop };
export const useObserve = () => observe;
export class ObserveErrorBoundary extends Component<{ children: ReactNode; fallback: (props: { error: Error; retry: () => void; resetError: () => void }) => ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() { const retry = () => this.setState({ error: null }); return this.state.error ? this.props.fallback({ error: this.state.error, retry, resetError: retry }) : this.props.children; }
}
