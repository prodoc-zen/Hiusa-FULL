import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RoleOnboardingTour from './RoleOnboardingTour';

describe('RoleOnboardingTour', () => {
  it('renders nothing when closed', () => {
    render(
      <MemoryRouter>
        <RoleOnboardingTour role="DEPARTMENT_HEAD" open={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog', { name: 'Interactive role onboarding tour' })).not.toBeInTheDocument();
  });

  it('shows role steps, presenter script, and track switchers when open', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/dashboard/department-head']}>
        <RoleOnboardingTour role="DEPARTMENT_HEAD" open onClose={onClose} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('dialog', { name: 'Interactive role onboarding tour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'College Dean Governance Workspace' })).toBeInTheDocument();
    expect(screen.getByText(/Presenter \/ Demo Script/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'College-Scoped Ask AI Copilot' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Create Org & Term/i }));
    expect(screen.getByRole('heading', { name: /Step 1: Create Academic Year & Activate Semester/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ask AI Guide/i }));
    expect(screen.getByRole('heading', { name: 'Inline Dashboard Ask AI Spotlight' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close interactive tour' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
