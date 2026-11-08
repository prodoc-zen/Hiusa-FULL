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

  it('draws no dot and is never interactive', () => {
    const { container } = render(<StatusBadge status="approved" />);
    const badge = screen.getByText('Approved');
    expect(badge.children).toHaveLength(0);
    expect(container.querySelector('button, a, [role="button"]')).toBeNull();
    expect(badge.className).toMatch(/\brounded\b/);
    expect(badge.className).not.toMatch(/rounded-full|font-bold/);
    expect(badge).toHaveClass('h-6', 'px-2', 'text-xs', 'font-medium');
  });

  it('uses amber for warning and a flat tone per status family', () => {
    render(
      <>
        <StatusBadge status="pending" />
        <StatusBadge status="approved" />
        <StatusBadge status="rejected" />
        <StatusBadge status="draft" />
        <StatusBadge status="under_review" />
      </>,
    );
    expect(screen.getByText('Pending')).toHaveClass('bg-amber-50', 'text-amber-800');
    expect(screen.getByText('Approved')).toHaveClass('bg-green-50', 'text-green-800');
    expect(screen.getByText('Rejected')).toHaveClass('bg-red-50', 'text-red-800');
    expect(screen.getByText('Draft')).toHaveClass('bg-slate-100', 'text-slate-700');
    expect(screen.getByText('Under Review').className).toMatch(/bg-brand-600\/10/);
  });

  it('lets an explicit tone override the resolved one', () => {
    render(<StatusBadge status="approved" tone="warning" label="On hold" />);
    expect(screen.getByText('On hold')).toHaveClass('bg-amber-50');
  });
});
