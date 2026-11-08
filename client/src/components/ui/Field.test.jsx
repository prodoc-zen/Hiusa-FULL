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

  it('shows no asterisk for a required field and still marks the control required', () => {
    render(
      <Field label="Email address" required>
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email address');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('Email address').textContent).not.toContain('*');
  });

  it('adds an (optional) suffix only when the field is marked optional', () => {
    const { unmount } = render(
      <Field label="Nickname" optional>
        <Input />
      </Field>,
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    unmount();

    render(
      <Field label="Nickname">
        <Input />
      </Field>,
    );
    expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
  });

  it('renders no icon before the label', () => {
    render(
      <Field label="Email address">
        <Input type="email" />
      </Field>,
    );
    expect(screen.getByText('Email address').querySelector('svg')).toBeNull();
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
