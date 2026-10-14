import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Select from './Select';

function Example({ multiple = false, disabled = false }) {
  const [value, setValue] = useState(multiple ? ['arts'] : '');
  return <label>College<Select multiple={multiple} disabled={disabled} value={value} onChange={(event) => setValue(multiple ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value)}>
    {!multiple && <option value="">Choose a college</option>}
    <option value="arts">Arts</option><option value="engineering">Engineering</option><option disabled value="closed">Closed college</option>
  </Select></label>;
}

describe('Searchable Select', () => {
  it('keeps several filter options selected, removes one, and clears with All', () => {
    function Filters() {
      const [value, setValue] = useState('');
      return <Select filter aria-label="Status filter" value={value} onChange={(event) => setValue(event.target.value)}><option value="">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option></Select>;
    }
    render(<Filters />);
    const select = screen.getByRole('combobox', { name: 'Status filter' });
    fireEvent.click(select);
    const options = () => within(screen.getByRole('listbox', { name: 'Dropdown options' }));
    fireEvent.click(options().getByRole('option', { name: 'Pending' }));
    fireEvent.click(options().getByRole('option', { name: 'Approved' }));
    expect(select).toHaveValue('["pending","approved"]');
    expect(options().getByRole('option', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pending' }));
    expect(select).toHaveValue('approved');
    fireEvent.click(options().getByRole('option', { name: 'All statuses' }));
    expect(select).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remove Approved' })).not.toBeInTheDocument();
  });
  it('searches options, selects a single value, and returns focus', async () => {
    render(<Example />);
    const select = screen.getByRole('combobox', { name: 'College' });
    fireEvent.click(select);
    const search = screen.getByRole('searchbox', { name: 'Search dropdown options' });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: 'engineer' } });
    const list = screen.getByRole('listbox', { name: 'Dropdown options' });
    expect(within(list).queryByRole('option', { name: 'Arts' })).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('option', { name: 'Engineering' }));
    expect(select).toHaveValue('engineering');
    expect(select).toHaveFocus();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('supports keyboard opening, arrow navigation and Escape', async () => {
    render(<Example />);
    const select = screen.getByRole('combobox', { name: 'College' });
    fireEvent.keyDown(select, { key: 'ArrowDown' });
    const search = screen.getByRole('searchbox');
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: 'engineering' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const option = within(screen.getByRole('listbox', { name: 'Dropdown options' })).getByRole('option', { name: 'Engineering' });
    expect(option).toHaveFocus();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(select).toHaveFocus();
    expect(select).toHaveValue('');
  });

  it('adds multiple values and removes a selected chip', () => {
    render(<Example multiple />);
    const select = screen.getByRole('listbox', { name: 'College' });
    fireEvent.click(select);
    const list = screen.getByRole('listbox', { name: 'Dropdown options' });
    fireEvent.click(within(list).getByRole('option', { name: 'Engineering' }));
    expect(select).toHaveValue(['arts', 'engineering']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Arts' }));
    expect(select).toHaveValue(['engineering']);
  });

  it('keeps disabled options unavailable and shows an empty search state', () => {
    render(<Example />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(within(screen.getByRole('listbox', { name: 'Dropdown options' })).getByRole('option', { name: 'Closed college' })).toBeDisabled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getByRole('status')).toHaveTextContent('No matching options');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
