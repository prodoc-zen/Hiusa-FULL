import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('resolves a known status to its tone and human label', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('falls back safely for an unknown status and still shows a text label', () => {
    render(<StatusBadge status="some_new_workflow_state" />);
    expect(screen.getByText('Some New Workflow State')).toBeInTheDocument();
  });

  it('shows a text label for an empty status rather than nothing', () => {
    render(<StatusBadge status={undefined} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
