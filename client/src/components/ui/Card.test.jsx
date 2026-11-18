import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Card from './Card';

describe('Card', () => {
  it('lets header actions wrap and shrink so a long button stays inside a narrow card', () => {
    render(<Card title="Records" actions={<button type="button">Upload school records</button>} />);

    const wrapper = screen.getByRole('button', { name: 'Upload school records' }).parentElement;
    expect(wrapper).toHaveClass('flex-wrap', 'min-w-0', 'max-w-full');
    expect(wrapper).not.toHaveClass('shrink-0');
  });
});
