import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Field from './Field';
import Input from './Input';

describe('Field', () => {
  it('associates the label with its control', () => {
    render(
      <Field label="Email address">
        <Input type="email" />
      </Field>,
    );
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('wires an inline error to the control through aria-describedby', () => {
    render(
      <Field label="Email address" error="Enter a valid email address.">
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email address');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Enter a valid email address.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });
});
