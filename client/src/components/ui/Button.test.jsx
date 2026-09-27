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
