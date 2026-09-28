import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader';

describe('PageHeader', () => {
  it('uses the accessible muted-strong tone for the description on the page background, at or under 75ch', () => {
    render(<PageHeader title="Members" description="Everyone in your organization." />);
    const description = screen.getByText('Everyone in your organization.');
    expect(description).toHaveClass('text-ink-muted-strong');
    expect(description).not.toHaveClass('text-ink-muted');
    expect(description).toHaveClass('max-w-[75ch]');
  });
});
