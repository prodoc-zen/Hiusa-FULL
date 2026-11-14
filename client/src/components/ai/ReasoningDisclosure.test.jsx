import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReasoningDisclosure from './ReasoningDisclosure';

const reasoning = {
  steps: ['Understood this as a question about missing requirements', 'Read 142 records'],
  summary: 'Checked the three overdue files first.',
};

describe('ReasoningDisclosure', () => {
  it('shows a Thinking line with the latest status label while live', () => {
    render(<ReasoningDisclosure live reasoning={{ steps: ['Reading your records'], label: 'Writing the answer' }} />);
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent('Thinking');
    expect(line).toHaveTextContent('Writing the answer');
    expect(document.querySelector('details')).toBeNull();
  });

  it('falls back to the last step as the live label', () => {
    render(<ReasoningDisclosure live reasoning={{ steps: ['Reading your records', 'Checking numbers'] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking numbers');
  });

  it('turns off its pulse for reduced motion', () => {
    render(<ReasoningDisclosure live reasoning={{ steps: [] }} />);
    expect(screen.getByRole('status').querySelector('.motion-reduce\\:animate-none')).not.toBeNull();
  });

  it('is a closed disclosure reading Thought for N seconds when finished', () => {
    render(<ReasoningDisclosure reasoning={reasoning} seconds={6} />);
    const details = document.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('Thought for 6 seconds')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Thought for 6 seconds'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Read 142 records')).toBeInTheDocument();
    expect(screen.getByText('Checked the three overdue files first.')).toHaveClass('text-ink-muted');
  });

  it('uses the singular for one second', () => {
    render(<ReasoningDisclosure reasoning={reasoning} seconds={1} />);
    expect(screen.getByText('Thought for 1 second')).toBeInTheDocument();
  });

  it('reads How this was answered when seconds is 0 or missing', () => {
    const { rerender } = render(<ReasoningDisclosure reasoning={reasoning} seconds={0} />);
    expect(screen.getByText('How this was answered')).toBeInTheDocument();
    rerender(<ReasoningDisclosure reasoning={reasoning} />);
    expect(screen.getByText('How this was answered')).toBeInTheDocument();
  });

  it('renders nothing when finished with nothing to show', () => {
    const { container } = render(<ReasoningDisclosure reasoning={{ steps: [], summary: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
