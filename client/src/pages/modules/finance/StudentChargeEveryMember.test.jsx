import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudentFinancialAccountsPage from './StudentFinancialAccountsPage';

const mocks = vi.hoisted(() => ({
  getStudentDebts: vi.fn(), createInvoice: vi.fn(), recordInvoicePayment: vi.fn(), updateInvoiceStatus: vi.fn(),
}));
vi.mock('../../../services/financeService', () => mocks);
vi.mock('../../../services/peopleService', () => ({ searchPeople: vi.fn() }));

const page = { data: { data: [], summary: {}, filter_options: { departments: [], programs: [], year_levels: [] }, total: 0, per_page: 10, current_page: 1 } };
const preview = (overrides) => ({ data: { preview: true, members: 60, to_charge: 58, skipped: 2, total: 8700, ...overrides } });

async function openCharge() {
  render(<MemoryRouter><StudentFinancialAccountsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Add student charge' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add student charge' });
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Every member' }));

  return dialog;
}

function fillFee(dialog, amount = '150', description = 'Membership fee') {
  fireEvent.change(within(dialog).getByLabelText(/Amount due/), { target: { value: amount } });
  fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: description } });
}

describe('Add student charge to every member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStudentDebts.mockResolvedValue(page);
  });

  it('hides the student picker and shows no count until the fee is filled in', async () => {
    const dialog = await openCharge();

    expect(within(dialog).queryByText('Student')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Enter the amount and a description to see who will be charged.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Charge every member' })).toBeDisabled();
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });

  it('previews the count and the total, then charges everyone in one request', async () => {
    mocks.createInvoice.mockImplementation(async (body) => (body.preview ? preview() : { data: { preview: false, charged: 58, skipped: 2, total: 8700 } }));
    const dialog = await openCharge();
    fillFee(dialog);

    expect(await within(dialog).findByText(/58 members will be charged/)).toBeInTheDocument();
    expect(within(dialog).getByText(/₱8,700\.00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 already have an open charge named Membership fee and are skipped/)).toBeInTheDocument();
    expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, preview: true, description: 'Membership fee', amount_due: '150', due_date: null });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Charge 58 members' }));

    await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, description: 'Membership fee', amount_due: '150', due_date: null }));
    expect(await screen.findByText('Charged 58 members. 2 already had it.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add student charge' })).not.toBeInTheDocument());
  });

  describe('members who already paid a charge with this name', () => {
    const TICK = 'Charge members who already paid a charge with this name';

    it('shows the three counts and leaves the tick off, so the paid members are skipped', async () => {
      mocks.createInvoice.mockImplementation(async (body) => (body.preview ? preview({ to_charge: 40, skipped: 2, already_paid: 18, total: 6000 }) : { data: { preview: false, charged: 40, skipped: 2, already_paid: 18, total: 6000 } }));
      const dialog = await openCharge();
      fillFee(dialog);

      expect(await within(dialog).findByText(/40 members will be charged/)).toBeInTheDocument();
      expect(within(dialog).getByText(/2 already have an open charge named Membership fee and are skipped/)).toBeInTheDocument();
      expect(within(dialog).getByText(/18 already paid a charge named Membership fee and are skipped/)).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: TICK })).not.toBeChecked();
      expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, preview: true, description: 'Membership fee', amount_due: '150', due_date: null });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Charge 40 members' }));

      await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, description: 'Membership fee', amount_due: '150', due_date: null }));
      expect(mocks.createInvoice.mock.calls.every(([body]) => !('charge_already_paid' in body))).toBe(true);
    });

    it('counts them in again only after the tick, and sends the tick with the charge', async () => {
      mocks.createInvoice.mockImplementation(async (body) => {
        if (body.preview) return body.charge_already_paid ? preview({ to_charge: 58, skipped: 2, already_paid: 18, total: 8700 }) : preview({ to_charge: 40, skipped: 2, already_paid: 18, total: 6000 });
        return { data: { preview: false, charged: 58, skipped: 2, already_paid: 18, total: 8700 } };
      });
      const dialog = await openCharge();
      fillFee(dialog);
      expect(await within(dialog).findByText(/40 members will be charged/)).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('checkbox', { name: TICK }));

      expect(await within(dialog).findByText(/58 members will be charged/)).toBeInTheDocument();
      expect(within(dialog).getByText(/18 already paid a charge named Membership fee and will be charged again/)).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: TICK })).toBeChecked();
      expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, preview: true, charge_already_paid: true, description: 'Membership fee', amount_due: '150', due_date: null });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Charge 58 members' }));

      await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith({ all_members: true, charge_already_paid: true, description: 'Membership fee', amount_due: '150', due_date: null }));
    });

    it('offers the tick when everyone left has already paid, and the button stays off until it is ticked', async () => {
      mocks.createInvoice.mockImplementation(async (body) => preview(body.charge_already_paid ? { to_charge: 18, skipped: 0, already_paid: 18, total: 2700 } : { to_charge: 0, skipped: 0, already_paid: 18, total: 0 }));
      const dialog = await openCharge();
      fillFee(dialog);

      expect(await within(dialog).findByText('Every active member already has or has paid a charge named Membership fee.')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Charge every member' })).toBeDisabled();

      fireEvent.click(within(dialog).getByRole('checkbox', { name: TICK }));

      expect(await within(dialog).findByRole('button', { name: 'Charge 18 members' })).toBeEnabled();
    });

    it('clears the tick when the description changes, because it belongs to that name', async () => {
      mocks.createInvoice.mockImplementation(async () => preview({ to_charge: 40, skipped: 0, already_paid: 18, total: 6000 }));
      const dialog = await openCharge();
      fillFee(dialog);
      fireEvent.click(await within(dialog).findByRole('checkbox', { name: TICK }));
      await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: TICK })).toBeChecked());

      fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: 'Shirt fee' } });

      await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: TICK })).not.toBeChecked());
    });

    it('shows no tick when nobody has paid a charge with this name', async () => {
      mocks.createInvoice.mockResolvedValue(preview());
      const dialog = await openCharge();
      fillFee(dialog);

      expect(await within(dialog).findByText(/58 members will be charged/)).toBeInTheDocument();
      expect(within(dialog).queryByRole('checkbox', { name: TICK })).not.toBeInTheDocument();
    });
  });

  it('says plainly when everyone already has the charge and keeps the button off', async () => {
    mocks.createInvoice.mockResolvedValue(preview({ to_charge: 0, skipped: 60, total: 0 }));
    const dialog = await openCharge();
    fillFee(dialog);

    expect(await within(dialog).findByText('Every active member already has an open charge named Membership fee.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Charge every member' })).toBeDisabled();
  });

  it('says plainly when the organization has no members', async () => {
    mocks.createInvoice.mockResolvedValue(preview({ members: 0, to_charge: 0, skipped: 0, total: 0 }));
    const dialog = await openCharge();
    fillFee(dialog);

    expect(await within(dialog).findByText('Your organization has no active members to charge. Add members first.')).toBeInTheDocument();
  });

  it('shows the error when the count cannot load and does not charge', async () => {
    mocks.createInvoice.mockRejectedValue({ response: { status: 422, data: { message: 'Server broke.' } } });
    const dialog = await openCharge();
    fillFee(dialog);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Server broke.');
    expect(within(dialog).getByRole('button', { name: 'Charge every member' })).toBeDisabled();
    expect(mocks.createInvoice.mock.calls.every(([body]) => body.preview === true)).toBe(true);
  });

  it('shows a loading line while the count is being worked out', async () => {
    mocks.createInvoice.mockReturnValue(new Promise(() => {}));
    const dialog = await openCharge();
    fillFee(dialog);

    expect(await within(dialog).findByText('Counting members...')).toBeInTheDocument();
  });

  it('keeps one student charging as before', async () => {
    mocks.createInvoice.mockResolvedValue({ data: {} });
    render(<MemoryRouter><StudentFinancialAccountsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Add student charge' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add student charge' });

    expect(within(dialog).getByRole('radio', { name: 'One student' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Add charge' })).toBeDisabled();
  });
});
