import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CandidacyForm from './CandidacyForm';

const positions = [
  { id: 1, title: 'President' },
  { id: 2, title: 'Treasurer' },
];
const photo = new File(['p'], 'photo.png', { type: 'image/png' });
const coc = new File(['c'], 'coc.pdf', { type: 'application/pdf' });
const credentials = new File(['d'], 'credentials.pdf', { type: 'application/pdf' });

function chooseFiles({ withPhoto = true, withCoc = true, withCredentials = true } = {}) {
  if (withPhoto) fireEvent.change(screen.getByLabelText('Formal photo'), { target: { files: [photo] } });
  if (withCoc) fireEvent.change(screen.getByLabelText('Certificate of Candidacy'), { target: { files: [coc] } });
  if (withCredentials) fireEvent.change(screen.getByLabelText('Credentials'), { target: { files: [credentials] } });
}

describe('CandidacyForm', () => {
  it('saves a draft with the position and platform only, files under their own names', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CandidacyForm positions={positions} onSave={onSave} onSubmit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Campaign platform/), { target: { value: 'Open books.' } });
    chooseFiles({ withCredentials: false });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      position_id: 2,
      platform: 'Open books.',
      rules_accepted: true,
      submit: false,
      photoFile: photo,
      cocFile: coc,
      credentialsFile: null,
    });
  });

  it('submits only once the position and all three documents are chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CandidacyForm positions={positions} onSave={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '1' } });
    chooseFiles({ withCredentials: false });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    chooseFiles({ withPhoto: false, withCoc: false });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      position_id: 1,
      platform: '',
      rules_accepted: true,
      submit: true,
      photoFile: photo,
      cocFile: coc,
      credentialsFile: credentials,
    });
  });

  it('keeps both buttons disabled while the rules are not accepted', () => {
    render(<CandidacyForm positions={positions} disabled onSave={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '1' } });
    chooseFiles();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('lets a draft with documents on record be submitted without choosing them again', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const initial = { id: 8, status: 'draft', position: { id: 2, title: 'Treasurer' }, platform: 'Plan', has_coc: true, has_credentials: true, photo_url: '/uploads/candidates/a.png' };
    render(<CandidacyForm positions={positions} initial={initial} onSave={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByLabelText('Position')).toHaveValue('2');
    expect(screen.getByLabelText(/Campaign platform/)).toHaveValue('Plan');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ position_id: 2, submit: true, photoFile: null, cocFile: null, credentialsFile: null })));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('rules_accepted');
  });

  it('shows only the three file inputs when replacing documents for a correction', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CandidacyForm mode="documents" positions={positions} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Campaign platform/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Formal photo')).toBeInTheDocument();
    expect(screen.getByLabelText('Certificate of Candidacy')).toBeInTheDocument();
    expect(screen.getByLabelText('Credentials')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Replace documents' })).toBeDisabled();
    chooseFiles({ withPhoto: false, withCredentials: false });
    fireEvent.click(screen.getByRole('button', { name: 'Replace documents' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ photoFile: null, cocFile: coc, credentialsFile: null }));
  });

  it('asks for the school ID of a party list member and sends it as a number', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CandidacyForm mode="member" positions={positions} positionId={2} onSubmit={onSubmit} />);

    expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add member' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('School ID'), { target: { value: '900002' } });
    chooseFiles({ withCredentials: false });
    fireEvent.click(add);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      user_id: 900002,
      position_id: 2,
      platform: '',
      photoFile: photo,
      cocFile: coc,
      credentialsFile: null,
    }));
  });

  it('shows the server message as returned when the request is refused', async () => {
    const refusal = Object.assign(new Error('refused'), { response: { status: 422, data: { message: 'Fourth year students cannot run for an executive position.' } } });
    render(<CandidacyForm positions={positions} onSave={vi.fn().mockRejectedValue(refusal)} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fourth year students cannot run for an executive position.');
  });
});
