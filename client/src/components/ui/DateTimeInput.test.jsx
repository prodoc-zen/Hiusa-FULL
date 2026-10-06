import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Modal from '../Modal';
import DateTimeInput from './DateTimeInput';

function Controlled({ initial = '2026-10-06', ...props }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="picker-test">Deadline</label><DateTimeInput id="picker-test" type="date" {...props} value={value} onChange={(event) => setValue(event.target.value)} /><output data-testid="value">{value}</output></>;
}

describe('DateTimeInput', () => {
  it('selects a date through the styled popup and updates the controlled form value', () => {
    render(<Controlled />);
    fireEvent.click(screen.getByLabelText('Deadline'));
    expect(screen.getByRole('dialog', { name: 'Deadline' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, October 7, 2026' }));
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-07');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Deadline')).toHaveFocus();
  });

  it('keeps manual typing and clearing available', () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText('Deadline'), { target: { value: '2026-11-20' } });
    expect(screen.getByTestId('value')).toHaveTextContent('2026-11-20');
    fireEvent.click(screen.getByLabelText('Deadline'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('value')).toBeEmptyDOMElement();
  });

  it('enforces min, max, and step constraints on selectable dates', () => {
    render(<Controlled min="2026-10-06" max="2026-10-10" step="2" />);
    fireEvent.click(screen.getByLabelText('Deadline'));
    expect(screen.getByRole('button', { name: 'Monday, October 5, 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wednesday, October 7, 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thursday, October 8, 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sunday, October 11, 2026' })).toBeDisabled();
  });

  it('selects a local date and time without changing its timezone', () => {
    render(<Controlled type="datetime-local" initial="2026-10-06T09:00" />);
    fireEvent.click(screen.getByLabelText('Deadline'));
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, October 7, 2026' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '14' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-07T14:30');
  });

  it('enforces the allowed time window before applying', () => {
    render(<Controlled type="time" initial="09:00" min="10:00" max="17:00" step="900" />);
    fireEvent.click(screen.getByLabelText('Deadline'));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hour' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Minute' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('value')).toHaveTextContent('10:15');
  });

  it('opens by keyboard and lets arrow keys select a date', async () => {
    render(<Controlled />);
    fireEvent.keyDown(screen.getByLabelText('Deadline'), { key: 'ArrowDown', altKey: true });
    const selected = screen.getByRole('button', { name: 'Tuesday, October 6, 2026' });
    expect(selected).toHaveFocus();
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    const next = screen.getByRole('button', { name: 'Wednesday, October 7, 2026' });
    await waitFor(() => expect(next).toHaveFocus());
    fireEvent.click(next);
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-07');
  });

  it('closes the picker with Escape without closing its containing modal', () => {
    const onClose = vi.fn();
    render(<Modal open title="Edit event" onClose={onClose}><Controlled /></Modal>);
    fireEvent.click(screen.getByLabelText('Deadline'));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Deadline' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Deadline')).toHaveFocus();
  });

  it.each([{ disabled: true }, { readOnly: true }])('keeps locked fields locked: %j', (props) => {
    render(<Controlled {...props} />);
    fireEvent.click(screen.getByLabelText('Deadline'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose date: picker-test' })).toBeDisabled();
  });
});
