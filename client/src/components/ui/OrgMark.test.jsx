import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OrgMark from './OrgMark';
import Kbd from './Kbd';

describe('OrgMark', () => {
  it('never renders below 12px or at weight 800+', () => {
    render(<OrgMark name="PSITS Council" acronym="PSITS-CCS" size="sm" />);
    const mark = screen.getByRole('img', { name: 'PSITS Council' });
    expect(mark).toHaveClass('text-xs', 'font-semibold');
    expect(mark.className).not.toMatch(/text-\[\d+px\]|font-extrabold|font-black/);
  });

  it('trims the acronym to what fits the size', () => {
    render(<OrgMark name="PSITS Council" acronym="PSITS" size="sm" />);
    expect(screen.getByRole('img', { name: 'PSITS Council' })).toHaveTextContent(/^PSI$/);
  });

  it('shows the first segment of a hyphenated acronym', () => {
    render(<OrgMark name="PSITS Council" acronym="PSITS-CCS" size="lg" />);
    expect(screen.getByRole('img', { name: 'PSITS Council' })).toHaveTextContent(/^PSIT$/);
  });

  it('falls back to initials from the name', () => {
    render(<OrgMark name="College of Engineering" />);
    expect(screen.getByRole('img', { name: 'College of Engineering' })).toHaveTextContent('COE');
  });
});

describe('Kbd', () => {
  it('renders at 12px or larger', () => {
    render(<Kbd>Ctrl K</Kbd>);
    const kbd = screen.getByText('Ctrl K');
    expect(kbd).toHaveClass('text-xs');
    expect(kbd.className).not.toMatch(/text-\[\d+px\]/);
  });
});
