import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Tooltip from './Tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the tooltip content after a hover delay', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Saves the current form">
        <button type="button">Save</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Save' });
    fireEvent.mouseEnter(trigger.parentElement);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Saves the current form');
  });

  it('dismisses on Escape', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Saves the current form">
        <button type="button">Save</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Save' });
    fireEvent.mouseEnter(trigger.parentElement);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
