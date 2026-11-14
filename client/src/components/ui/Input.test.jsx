import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Input from './Input';

describe('Input', () => {
  it('styles a file picker with the app button look instead of the browser default', () => {
    render(<Input type="file" aria-label="CSV file" />);
    const picker = screen.getByLabelText('CSV file');
    expect(picker).toHaveClass('file:bg-subtle', 'file:font-sans', 'file:text-brand-700', 'file:h-10');
    expect(picker).toHaveClass('rounded-control', 'border-line');
  });

  it('keeps the plain text box height and padding for other types', () => {
    render(<Input aria-label="Name" />);
    const box = screen.getByLabelText('Name');
    expect(box).toHaveClass('h-10', 'px-3');
    expect(box.className).not.toContain('file:');
  });
});
