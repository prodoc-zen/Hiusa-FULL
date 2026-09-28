import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('keeps its accessible label and sets aria-busy while loading', () => {
    render(<Button loading>Save changes</Button>);
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('is not busy or disabled when not loading', () => {
    render(<Button>Save changes</Button>);
    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toBeDisabled();
  });

  it('defaults the primary variant to brand-700 so white text passes 4.5:1 contrast', () => {
    render(<Button variant="primary">Record transaction</Button>);
    const button = screen.getByRole('button', { name: 'Record transaction' });
    expect(button).toHaveClass('bg-brand-700');
    expect(button).not.toHaveClass('bg-brand-600');
  });

  it('renders as a router link when given a "to" prop', () => {
    render(
      <MemoryRouter>
        <Button to="/dashboard">Go to dashboard</Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Go to dashboard' });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});
