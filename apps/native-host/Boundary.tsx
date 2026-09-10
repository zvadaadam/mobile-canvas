import { Component, type ReactNode } from 'react';
import UnavailablePreview from './UnavailablePreview';

export default class Boundary extends Component<{ children: ReactNode; version: string; onError: (message: string) => void; onRetry?: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error) { this.props.onError(error.message); }
  componentDidUpdate(previous: Readonly<{ version: string }>) {
    if (previous.version !== this.props.version && this.state.error) this.setState({ error: null });
  }
  render() {
    return this.state.error ? <UnavailablePreview kind="error" title="This preview hit an error" reason="The rest of your canvas is still available. Retry this frame or edit its source." detail={this.state.error} onRetry={this.props.onRetry} /> : this.props.children;
  }
}
