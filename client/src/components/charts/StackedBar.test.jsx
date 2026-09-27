import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StackedBar from './StackedBar';

const SEGMENTS = [
  { label: 'Paid', value: 75 },
  { label: 'Pending', value: 25 },
];

describe('StackedBar', () => {
  it('renders an accessible table fallback with the right values and percents', () => {
    render(<StackedBar title="Order status" segments={SEGMENTS} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(table).toHaveClass('table-fixed');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75').length).toBeGreaterThan(0);
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
  });

  it('renders a quiet empty state when every segment is zero', () => {
    render(<StackedBar title="Order status" segments={[{ label: 'Paid', value: 0 }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });

  it('renders a quiet empty state with no segments at all', () => {
    render(<StackedBar title="Order status" segments={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });

  it('only the individual bar segments carry role=img, not a wrapping element', () => {
    const { container } = render(<StackedBar title="Order status" segments={SEGMENTS} />);

    const imgRoleElements = container.querySelectorAll('[role="img"]');
    expect(imgRoleElements.length).toBe(SEGMENTS.length);
    imgRoleElements.forEach((element) => {
      expect(element).toHaveAttribute('tabindex', '0');
    });
  });

  it('reveals a keyboard-reachable tooltip with the value and percent when a bar segment is focused or hovered', () => {
    const { container } = render(<StackedBar title="Order status" segments={SEGMENTS} />);

    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();

    const segment = screen.getByRole('img', { name: 'Paid, 75, 75%' });
    fireEvent.focus(segment);
    const tooltip = container.querySelector('[data-chart-tooltip]');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('75%');
    fireEvent.blur(segment);
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();

    fireEvent.mouseEnter(segment);
    expect(container.querySelector('[data-chart-tooltip]')).toBeInTheDocument();
    fireEvent.mouseLeave(segment);
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();
  });
});
