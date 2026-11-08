import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagePartylistsPage from './ManagePartylistsPage';

const { getPartylists, createPartylist, outlet } = vi.hoisted(() => ({
  getPartylists: vi.fn(),
  createPartylist: vi.fn(),
  outlet: {
    election: {
      id: 5,
      title: 'Council Election',
      status: 'upcoming',
      finalized_at: null,
      positions: [{ id: 1, title: 'President' }],
      candidates: [{ id: 10, partylist_id: 3, position_id: 1, user: { first_name: 'Ana', last_name: 'Reyes' } }],
    },
    refreshElection: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/electionService', () => ({ getPartylists, createPartylist, deletePartylist: vi.fn(), updatePartylist: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

function renderPage() {
  return render(<MemoryRouter><ManagePartylistsPage /></MemoryRouter>);
}

describe('ManagePartylistsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists each party list with its candidate count and one Register party list button', async () => {
    getPartylists.mockResolvedValue([{ id: 3, name: 'Forward', acronym: 'FWD', description: 'Open books.' }]);
    renderPage();
    expect((await screen.findAllByText('Forward')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Register party list' })).toHaveLength(1);
    const row = screen.getAllByText('Forward')[0].closest('tr');
    expect(within(row).getByText('1')).toBeInTheDocument();
  });

  it('tells the Admin what to do first when there are no party lists', async () => {
    getPartylists.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No party lists yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Register party list' })).toHaveLength(1);
  });

  it('registers a party list from the drawer, with only the name required', async () => {
    getPartylists.mockResolvedValue([]);
    createPartylist.mockResolvedValue({ id: 4, name: 'Alab' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Register party list' }));

    const dialog = await screen.findByRole('dialog', { name: 'Register party list' });
    expect(within(dialog).getAllByText('(optional)')).toHaveLength(3);
    const submit = within(dialog).getByRole('button', { name: 'Register party list' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Party list name'), { target: { value: 'Alab' } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(createPartylist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alab' })));
  });
});
