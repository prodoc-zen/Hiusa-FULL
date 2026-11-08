import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPicker from './PersonPicker';

const peopleMocks = vi.hoisted(() => ({ searchPeople: vi.fn() }));

vi.mock('../../services/peopleService', () => peopleMocks);

const MARIA = {
  school_id: 2100142,
  name: 'Maria Santos',
  email: 'maria@example.edu',
  role: 'STUDENT',
  program: 'BSIT',
  year_level: '3',
  college: 'College of Computing',
  organizations: [],
};
const JUAN = { ...MARIA, school_id: 2100143, name: 'Maria Cruz', email: 'cruz@example.edu', program: 'BSCS' };

function type(value) {
  fireEvent.change(screen.getByRole('combobox', { name: /find a student/i }), { target: { value } });
}

function renderPicker(props = {}) {
  const onSelect = vi.fn();
  render(<PersonPicker label="Find a student" onSelect={onSelect} {...props} />);
  return onSelect;
}

describe('PersonPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peopleMocks.searchPeople.mockResolvedValue([MARIA, JUAN]);
  });

  it('waits for two characters and debounces to one request with the scope sent along', async () => {
    renderPicker({ scope: 'college', organizationId: 7, role: 'STUDENT' });

    type('m');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(peopleMocks.searchPeople).not.toHaveBeenCalled();

    type('ma');
    type('mar');
    await screen.findByRole('option', { name: /Maria Santos/ });

    expect(peopleMocks.searchPeople).toHaveBeenCalledTimes(1);
    expect(peopleMocks.searchPeople).toHaveBeenCalledWith({ q: 'mar', scope: 'college', organization_id: 7, role: 'STUDENT' });
  });

  it('shows name first, college or organization and email muted, and the school ID small', async () => {
    renderPicker();
    type('mar');

    const option = await screen.findByRole('option', { name: /Maria Santos/ });
    expect(option).toHaveTextContent('Maria Santos');
    expect(option).toHaveTextContent('College of Computing · maria@example.edu');
    expect(option).toHaveTextContent('2100142');
  });

  it('shows the organization instead of the college when the person is in one', async () => {
    peopleMocks.searchPeople.mockResolvedValue([{ ...MARIA, organizations: [{ id: 3, name: 'Computing Society', position_title: 'Treasurer' }] }]);
    renderPicker();
    type('mar');

    const option = await screen.findByRole('option', { name: /Maria Santos/ });
    expect(option).toHaveTextContent('Computing Society · maria@example.edu');
    expect(option).not.toHaveTextContent('College of Computing');
  });

  it('shows nothing for an internal account number', async () => {
    peopleMocks.searchPeople.mockResolvedValue([{ ...MARIA, school_id: 95000001, name: 'Dean Reyes' }]);
    renderPicker();
    type('dea');

    const option = await screen.findByRole('option', { name: /Dean Reyes/ });
    expect(option).not.toHaveTextContent('95000001');
  });

  it('moves through the results with the arrow keys and picks with Enter', async () => {
    const onSelect = renderPicker();
    type('mar');
    await screen.findByRole('option', { name: /Maria Santos/ });
    const input = screen.getByRole('combobox');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(MARIA);
    expect(screen.getByRole('group', { name: /find a student/i })).toHaveTextContent('Maria Santos');
  });

  it('closes the list with Escape and picks with a click', async () => {
    const onSelect = renderPicker();
    type('mar');
    await screen.findByRole('option', { name: /Maria Cruz/ });

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');

    type('mari');
    fireEvent.click(await screen.findByRole('option', { name: /Maria Cruz/ }));
    expect(onSelect).toHaveBeenCalledWith(JUAN);
  });

  it('shows the picked person as a chip and Remove clears it', async () => {
    const onSelect = renderPicker();
    type('mar');
    fireEvent.click(await screen.findByRole('option', { name: /Maria Santos/ }));

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maria Santos' }));

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('can be controlled by the parent', async () => {
    function Parent() {
      const [person, setPerson] = useState(MARIA);
      return <PersonPicker label="Find a student" value={person} onSelect={setPerson} />;
    }
    render(<Parent />);

    expect(screen.getByRole('group', { name: /find a student/i })).toHaveTextContent('Maria Santos');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maria Santos' }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('leaves out people who are already chosen', async () => {
    renderPicker({ excludeIds: [2100142] });
    type('mar');

    await screen.findByRole('option', { name: /Maria Cruz/ });
    expect(screen.queryByRole('option', { name: /Maria Santos/ })).not.toBeInTheDocument();
  });

  it('says so when no one matches', async () => {
    peopleMocks.searchPeople.mockResolvedValue([]);
    renderPicker();
    type('zzz');

    expect(await screen.findByText('No one matches "zzz"')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry that searches again', async () => {
    peopleMocks.searchPeople.mockRejectedValueOnce(new Error('offline'));
    renderPicker();
    type('mar');

    expect(screen.getByText('Searching...')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not search. Try again.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('option', { name: /Maria Santos/ })).toBeInTheDocument();
    await waitFor(() => expect(peopleMocks.searchPeople).toHaveBeenCalledTimes(2));
  });

  it('can search another source and describe each person its own way', async () => {
    const search = vi.fn().mockResolvedValue([{ school_id: 7100101, name: 'Marites Dizon', position: 'Department Secretary' }]);
    const onSelect = renderPicker({ search, describe: (person) => person.position });

    type('mar');
    const option = await screen.findByRole('option', { name: /Marites Dizon/ });
    expect(option).toHaveTextContent('Department Secretary');
    expect(search).toHaveBeenCalledWith({ q: 'mar' });
    expect(peopleMocks.searchPeople).not.toHaveBeenCalled();

    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ school_id: 7100101 }));
    expect(screen.getByRole('group')).toHaveTextContent('Department Secretary');
  });

  it('ignores a slow answer to an older query', async () => {
    let releaseFirst;
    peopleMocks.searchPeople
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve([MARIA]); }))
      .mockResolvedValueOnce([JUAN]);
    renderPicker();

    type('mar');
    await waitFor(() => expect(peopleMocks.searchPeople).toHaveBeenCalledTimes(1));
    type('mari');
    expect(await screen.findByRole('option', { name: /Maria Cruz/ })).toBeInTheDocument();
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('option', { name: /Maria Santos/ })).not.toBeInTheDocument();
  });
});
