import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import UiKitPage from './UiKitPage';

describe('UiKitPage', () => {
  it('renders the flow stepper, next step and page header demos', () => {
    render(
      <MemoryRouter>
        <UiKitPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Flow stepper' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Event progress, every state' })).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar', { name: /^Compact/ }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { level: 2, name: 'Next step' })).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('button', { name: 'Finalize ballot' })).toBeDisabled();
    expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(2);
  });
});
