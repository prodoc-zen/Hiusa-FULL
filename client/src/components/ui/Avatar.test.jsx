import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar';

const NAMES = [
  'Maria Santos', 'Juan Cruz', 'Liza Reyes', 'Pedro Penduko', 'Ana Villamor',
  'Carlos Diaz', 'Rosa Lim', 'Miguel Torres', 'Elena Ramos', 'Diego Cruz',
];

describe('Avatar', () => {
  it('gives every initials avatar the same brand tone, so color never reads as a status', () => {
    const tones = NAMES.map((name) => {
      const { container } = render(<Avatar name={name} />);
      return Array.from(container.querySelector('span').classList).find((cls) => cls.startsWith('bg-'));
    });
    expect(new Set(tones)).toEqual(new Set(['bg-brand-700']));
  });

  it('shows first and last initials, or two letters of a single name', () => {
    render(<><Avatar name="Maria Elena Santos" /><Avatar name="Cher" /></>);
    expect(screen.getByRole('img', { name: 'Maria Elena Santos' })).toHaveTextContent('MS');
    expect(screen.getByRole('img', { name: 'Cher' })).toHaveTextContent('CH');
  });
});
