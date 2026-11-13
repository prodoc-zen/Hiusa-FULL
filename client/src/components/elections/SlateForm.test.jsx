import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SlateForm from './SlateForm';

const positions = [
  { id: 1, title: 'President', max_winners: 1 },
  { id: 2, title: 'Treasurer', max_winners: 1 },
];
const banner = new File(['b'], 'banner.png', { type: 'image/png' });

describe('SlateForm', () => {
  it('creates the party list from a name, motto and color, with the banner optional', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SlateForm positions={positions} onCreate={onCreate} />);

    const create = screen.getByRole('button', { name: 'Create party list' });
    expect(create).toBeDisabled();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Party list name'), { target: { value: 'Unity' } });
    fireEvent.change(screen.getByLabelText('Motto'), { target: { value: 'Together' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#112233' } });
    fireEvent.change(screen.getByLabelText(/Banner/), { target: { files: [banner] } });
    fireEvent.click(create);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Unity', motto: 'Together', color: '#112233', rules_accepted: true, bannerFile: banner }));
    expect(screen.queryByText('Vacant')).not.toBeInTheDocument();
  });

  it('keeps the create button disabled until the rules are accepted', () => {
    render(<SlateForm positions={positions} disabled onCreate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Party list name'), { target: { value: 'Unity' } });
    fireEvent.change(screen.getByLabelText('Motto'), { target: { value: 'Together' } });
    expect(screen.getByRole('button', { name: 'Create party list' })).toBeDisabled();
  });

  it('lists every position with its members or Vacant once the party list exists', () => {
    const slate = {
      id: 6,
      name: 'Unity',
      motto: 'Together',
      color: '#112233',
      members: [{ id: 21, status: 'draft', position: { id: 1, title: 'President' }, user: { name: 'Ana Reyes', school_id: 900002 } }],
    };
    render(<SlateForm positions={positions} slate={slate} onCreate={vi.fn()} onAddMember={vi.fn()} onSubmitSlate={vi.fn()} />);

    const president = screen.getByRole('listitem', { name: 'President' });
    expect(within(president).getByText('Ana Reyes')).toBeInTheDocument();
    const treasurer = screen.getByRole('listitem', { name: 'Treasurer' });
    expect(within(treasurer).getByText('Vacant')).toBeInTheDocument();
    expect(within(treasurer).getByRole('button', { name: 'Add member' })).toBeInTheDocument();
    expect(within(president).queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit party list' })).toBeEnabled();
  });

  it('adds a member for a position with a school ID and then closes the member form', async () => {
    const slate = { id: 6, name: 'Unity', motto: 'Together', color: '#112233', members: [] };
    const onAddMember = vi.fn().mockResolvedValue(undefined);
    render(<SlateForm positions={positions} slate={slate} onCreate={vi.fn()} onAddMember={onAddMember} onSubmitSlate={vi.fn()} />);

    fireEvent.click(within(screen.getByRole('listitem', { name: 'Treasurer' })).getByRole('button', { name: 'Add member' }));
    fireEvent.change(screen.getByLabelText('School ID'), { target: { value: '900003' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add member' }).find((button) => !button.closest('li')));

    await waitFor(() => expect(onAddMember).toHaveBeenCalledWith(expect.objectContaining({ user_id: 900003, position_id: 2 })));
    await waitFor(() => expect(screen.queryByLabelText('School ID')).not.toBeInTheDocument());
  });

  it('submits the whole party list, disabled before any member and while the rules are not accepted', async () => {
    const slate = { id: 6, name: 'Unity', motto: 'Together', color: '#112233', members: [] };
    const onSubmitSlate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SlateForm positions={positions} slate={slate} onCreate={vi.fn()} onAddMember={vi.fn()} onSubmitSlate={onSubmitSlate} />);
    expect(screen.getByRole('button', { name: 'Submit party list' })).toBeDisabled();

    const withMember = { ...slate, members: [{ id: 21, status: 'draft', position: { id: 1, title: 'President' }, user: { name: 'Ana Reyes', school_id: 900002 } }] };
    rerender(<SlateForm positions={positions} slate={withMember} onCreate={vi.fn()} onAddMember={vi.fn()} onSubmitSlate={onSubmitSlate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit party list' }));
    await waitFor(() => expect(onSubmitSlate).toHaveBeenCalledTimes(1));

    rerender(<SlateForm positions={positions} slate={withMember} disabled onCreate={vi.fn()} onAddMember={vi.fn()} onSubmitSlate={onSubmitSlate} />);
    expect(screen.getByRole('button', { name: 'Submit party list' })).toBeDisabled();
  });

  it('shows the server message when the party list is refused', async () => {
    const refusal = Object.assign(new Error('refused'), { response: { status: 422, data: { message: 'That party list name is taken.' } } });
    render(<SlateForm positions={positions} onCreate={vi.fn().mockRejectedValue(refusal)} />);
    fireEvent.change(screen.getByLabelText('Party list name'), { target: { value: 'Unity' } });
    fireEvent.change(screen.getByLabelText('Motto'), { target: { value: 'Together' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create party list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That party list name is taken.');
  });
});
