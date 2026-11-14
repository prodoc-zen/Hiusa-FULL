import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EngineBadge from './EngineBadge';

describe('EngineBadge', () => {
  it('names the built-in rules in plain words instead of a fallback engine', () => {
    render(<EngineBadge engine="php-fallback" />);

    expect(screen.getByText('Built-in rules')).toBeInTheDocument();
    expect(screen.queryByText(/fallback/i)).not.toBeInTheDocument();
  });

  it('shows nothing when no engine was reported', () => {
    const { container } = render(<EngineBadge engine={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
