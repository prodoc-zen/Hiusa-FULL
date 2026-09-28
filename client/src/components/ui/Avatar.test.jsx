import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar';

const NAMES = [
  'Maria Santos', 'Juan Cruz', 'Liza Reyes', 'Pedro Penduko', 'Ana Villamor',
  'Carlos Diaz', 'Rosa Lim', 'Miguel Torres', 'Elena Ramos', 'Diego Cruz',
];

describe('Avatar', () => {
  it('only ever tints initials avatars from the brand or navy family, never status colours', () => {
    NAMES.forEach((name) => {
      const { container } = render(<Avatar name={name} />);
      const span = container.querySelector('span');
      const toneClass = Array.from(span.classList).find((cls) => cls.startsWith('bg-'));
      expect(toneClass).toMatch(/^bg-(brand|navy)-\d+$/);
    });
  });
});
