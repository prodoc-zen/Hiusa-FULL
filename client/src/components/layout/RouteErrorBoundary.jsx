import { Component } from 'react';
import ErrorState from '../ui/ErrorState';

const CHUNK_FAILURE = /dynamically imported module|importing a module script|loading chunk|failed to fetch/i;

// A page file that could not be fetched stays failed for React.lazy until the app reloads.
export default class RouteErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  retry = () => {
    if (CHUNK_FAILURE.test(this.state.error?.message ?? '')) window.location.reload();
    else this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const offline = CHUNK_FAILURE.test(error.message ?? '');
    return (
      <ErrorState
        title="This page could not load"
        description={offline ? 'Check your connection and try again.' : 'Something went wrong showing this page. Try again, or open another page.'}
        onRetry={this.retry}
      />
    );
  }
}
