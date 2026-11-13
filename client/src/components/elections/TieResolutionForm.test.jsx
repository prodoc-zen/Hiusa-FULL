import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TieResolutionForm from './TieResolutionForm';

const { resolveTie } = vi.hoisted(() => ({ resolveTie: vi.fn() }));
vi.mock('../../services/electionService', () => ({ resolveTie }));

// Treasurer has two seats. Ana won one outright; three candidates tied at the last seat and the runoff tied again.
const result = {
  position: { id: 4, title: 'Treasurer', max_winners: 2 },
  status: 'tie_pending',
  winner_ids: [20],
  candidates: [
    { id: 20, name: 'Ana Reyes', votes: 9, runoff_votes: null },
    { id: 21, name: 'Mia Lopez', votes: 5, runoff_votes: 3 },
    { id: 22, name: 'Rey Tan', votes: 5, runoff_votes: 3 },
    { id: 23, name: 'Lia Gomez', votes: 5, runoff_votes: 3 },
  ],
  runoff: { candidate_ids: [21, 22, 23], seats: 1 },
};

const rule = { tie_break_rule: 'Longest membership.' };
const fill = () => fireEvent.change(screen.getByLabelText('Written explanation'), { target: { value: 'Longest service in the organization.' } });

describe('TieResolutionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTie.mockResolvedValue({ success: true });
  });

  it('lists only the still tied candidates and states that totals cannot change', () => {
    render(<TieResolutionForm electionId={5} election={rule} result={result} />);
    expect(screen.getByRole('checkbox', { name: /Mia Lopez/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Rey Tan/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Ana Reyes/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Vote totals cannot be changed/)).toBeInTheDocument();
    expect(screen.getByText('Longest membership.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rule used')).not.toBeInTheDocument();
  });

  it('limits the selection to the remaining seats', () => {
    render(<TieResolutionForm electionId={5} election={rule} result={result} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mia Lopez/ }));
    expect(screen.getByRole('checkbox', { name: /Rey Tan/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Lia Gomez/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Mia Lopez/ })).toBeEnabled();
    expect(screen.getByText(/Choose 1 candidate/)).toBeInTheDocument();
  });

  it('needs the exact number of winners and an explanation', () => {
    render(<TieResolutionForm electionId={5} election={rule} result={result} />);
    const button = screen.getByRole('button', { name: 'Record decision' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Mia Lopez/ }));
    expect(button).toBeDisabled();
    fill();
    expect(button).toBeEnabled();
  });

  it('asks for confirmation, then sends the winners and the explanation', async () => {
    const onResolved = vi.fn();
    render(<TieResolutionForm electionId={5} election={rule} result={result} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Rey Tan/ }));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(resolveTie).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(resolveTie).toHaveBeenCalledWith(5, 4, { winner_candidate_ids: [22], explanation: 'Longest service in the organization.' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
  });

  it('asks for the rule used when the election has no tie-break rule and sends it', async () => {
    render(<TieResolutionForm electionId={5} election={{ tie_break_rule: null }} result={result} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mia Lopez/ }));
    fill();
    expect(screen.getByRole('button', { name: 'Record decision' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rule used'), { target: { value: 'Drawing of lots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(resolveTie).toHaveBeenCalledWith(5, 4, { winner_candidate_ids: [21], explanation: 'Longest service in the organization.', rule_used: 'Drawing of lots' }));
  });

  it('shows the server refusal', async () => {
    resolveTie.mockRejectedValue({ response: { data: { message: 'Choose exactly 1 of the tied candidates.' } } });
    render(<TieResolutionForm electionId={5} election={rule} result={result} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mia Lopez/ }));
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByText('Choose exactly 1 of the tied candidates.')).toBeInTheDocument();
  });

  it('allows every seat to be filled when the tie came straight from round 1', () => {
    const first = { ...result, winner_ids: [], runoff: { candidate_ids: [21, 22], seats: 2 } };
    render(<TieResolutionForm electionId={5} election={rule} result={first} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mia Lopez/ }));
    expect(screen.getByRole('checkbox', { name: /Rey Tan/ })).toBeEnabled();
  });
});
