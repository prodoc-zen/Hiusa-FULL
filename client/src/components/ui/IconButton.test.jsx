import { render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import IconButton from './IconButton';

describe('IconButton', () => {
  it('exposes its label as an accessible name', () => {
    render(<IconButton icon={Trash2} label="Delete record" />);
    expect(screen.getByRole('button', { name: 'Delete record' })).toBeInTheDocument();
  });
});
