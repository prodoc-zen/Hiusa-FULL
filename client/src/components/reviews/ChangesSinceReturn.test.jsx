import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChangesSinceReturn from './ChangesSinceReturn';

describe('ChangesSinceReturn', () => {
  it('lists every change under the heading, with before and after only where the server sent both', () => {
    render(<ChangesSinceReturn changes={[
      { field: 'title', label: 'Title', before: 'General Assembly', after: 'General Assembly 2026' },
      { field: 'description', label: 'Description' },
      { field: 'file:Event proposal', label: 'proposal-v2.pdf replaced proposal-v1.pdf' },
    ]}
    />);

    const note = screen.getByRole('region', { name: 'Changed since you returned it' });
    expect(within(note).getByText('Changed since you returned it:')).toBeInTheDocument();
    const rows = within(note).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Title: General Assembly to General Assembly 2026');
    expect(rows[1]).toHaveTextContent(/^Description$/);
    expect(rows[2]).toHaveTextContent('proposal-v2.pdf replaced proposal-v1.pdf');
  });

  it('says blank for an empty value rather than leaving a gap', () => {
    render(<ChangesSinceReturn changes={[{ field: 'location', label: 'Location', before: '', after: 'Gym' }]} />);

    expect(screen.getByRole('listitem')).toHaveTextContent('Location: blank to Gym');
  });

  it('renders nothing when there is no list, an empty list, or the organization side of the screen', () => {
    const { container, rerender } = render(<ChangesSinceReturn />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChangesSinceReturn changes={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChangesSinceReturn changes={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
