import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Donut from './Donut';

const SEGMENTS = [
  { label: 'Paid', value: 60 },
  { label: 'Pending', value: 40 },
];

describe('Donut', () => {
  it('renders an accessible table fallback with values and percents', () => {
    render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    const table = screen.getByRole('table', { hidden: true });
    expect(table).toHaveClass('sr-only');
    expect(table).toHaveClass('table-fixed');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
  });

  it('shows the center total by default', () => {
    render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('renders a quiet empty state instead of a broken ring', () => {
    render(<Donut title="Order status" segments={[]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
  });

  it('treats all-zero segments as empty', () => {
    render(<Donut title="Order status" segments={[{ label: 'Paid', value: 0 }]} />);

    expect(screen.getByText('No data for this period yet')).toBeInTheDocument();
  });

  it('only the individual ring segments carry role=img, not a wrapping element', () => {
    const { container } = render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    const imgRoleElements = container.querySelectorAll('[role="img"]');
    expect(imgRoleElements.length).toBe(SEGMENTS.length);
    imgRoleElements.forEach((element) => {
      expect(element.tagName.toLowerCase()).toBe('circle');
      expect(element).toHaveAttribute('tabindex', '0');
    });
  });

  it('reveals a keyboard-reachable tooltip with the value and percent when a ring segment is focused or hovered', () => {
    const { container } = render(<Donut title="Order status" segments={SEGMENTS} centerLabel="Orders" />);

    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();

    const segment = screen.getByRole('img', { name: 'Paid, 60, 60%' });
    fireEvent.focus(segment);
    const tooltip = container.querySelector('[data-chart-tooltip]');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('60%');
    fireEvent.blur(segment);
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();

    fireEvent.mouseEnter(segment);
    expect(container.querySelector('[data-chart-tooltip]')).toBeInTheDocument();
    fireEvent.mouseLeave(segment);
    expect(container.querySelector('[data-chart-tooltip]')).not.toBeInTheDocument();
  });
});
