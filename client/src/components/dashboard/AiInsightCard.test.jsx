import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AiInsightCard from './AiInsightCard';

const insight = {
  engine: 'budget_advisory',
  title: '"Foundation Week" is at high overspending risk',
  body: 'Spending risk is elevated. Keep new commitments below the safe spending limit.',
  why: {
    method: 'Deterministic budget-advisory engine (BudgetController::advice)',
    inputs: { allocated_amount: 60000, remaining_amount: 8000, warning_threshold: 5000 },
    formula: 'available = current_available_budget + predicted_income - predicted_expense - committed_expenses',
  },
  generated_at: '2026-09-20T08:00:00+00:00',
  href: '/dashboard/finance/budget-allocation',
};

describe('AiInsightCard', () => {
  it('shows the advisory title, an engine badge, and a closed Why disclosure by default', () => {
    render(<MemoryRouter><AiInsightCard insight={insight} /></MemoryRouter>);

    expect(screen.getByText(insight.title)).toBeInTheDocument();
    expect(screen.getByText('Budget advisory engine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Why\?/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Deterministic budget-advisory engine/)).not.toBeInTheDocument();
  });

  it('reveals the method, inputs, and formula when Why? is opened', () => {
    render(<MemoryRouter><AiInsightCard insight={insight} /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /Why\?/i }));

    expect(screen.getByText(/Deterministic budget-advisory engine/)).toBeInTheDocument();
    expect(screen.getByText(/Allocated Amount: 60,000/)).toBeInTheDocument();
    expect(screen.getByText(/Formula:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/i })).toHaveAttribute('href', insight.href);
  });
});
