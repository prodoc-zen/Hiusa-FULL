import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataDonutChart from './DataDonutChart';

const SEGMENTS = [
  { label: 'Published', value: 60, color: '#0B8ED0' },
  { label: 'Unpublished / draft', value: 40, color: '#64748B' },
];

describe('DataDonutChart', () => {
  it('renders its own title and description above the delegated Donut ring', () => {
    render(
      <DataDonutChart
        title="Publication distribution"
        description="Published and unpublished announcements matching the active filters."
        centerValue={100}
        centerLabel="matching records"
        segments={SEGMENTS}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Publication distribution' })).toBeInTheDocument();
    expect(screen.getByText('Published and unpublished announcements matching the active filters.')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('matching records')).toBeInTheDocument();
  });

  it('delegates to Donut for the ring, legend, and accessible table so call sites get the new rendering unchanged', () => {
    render(<DataDonutChart title="Filtered user distribution" segments={SEGMENTS} centerValue={100} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(within(table).getByText('Published')).toBeInTheDocument();
    expect(within(table).getByText('60%')).toBeInTheDocument();

    const segment = screen.getByRole('img', { name: 'Published, 60, 60%' });
    fireEvent.focus(segment);
    expect(document.querySelector('[data-chart-tooltip]')).toHaveTextContent('60%');
    fireEvent.blur(segment);
  });

  it('renders a quiet empty state when every segment is zero', () => {
    render(<DataDonutChart title="Publication distribution" segments={[{ label: 'Published', value: 0 }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });
});
