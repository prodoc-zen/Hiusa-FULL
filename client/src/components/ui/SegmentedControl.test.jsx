import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SegmentedControl from './SegmentedControl';

const OPTIONS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

describe('SegmentedControl', () => {
  it('gives only the active option a tab stop', () => {
    render(<SegmentedControl options={OPTIONS} value="month" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'This month' })).toHaveAttribute('tabIndex', '0');
    expect(screen.getByRole('radio', { name: 'This week' })).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByRole('radio', { name: 'This year' })).toHaveAttribute('tabIndex', '-1');
  });

  it('moves selection and focus with the arrow keys', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="week" onChange={onChange} />);

    const week = screen.getByRole('radio', { name: 'This week' });
    week.focus();
    fireEvent.keyDown(week, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('month');
    expect(screen.getByRole('radio', { name: 'This month' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('radio', { name: 'This month' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('selects an option on click', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="week" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'This year' }));
    expect(onChange).toHaveBeenCalledWith('year');
  });
});
