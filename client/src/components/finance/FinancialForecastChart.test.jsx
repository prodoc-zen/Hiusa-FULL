import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FinancialForecastChart from './FinancialForecastChart';

describe('FinancialForecastChart', () => {
  it('writes a negative balance with the minus before the peso sign', () => {
    render(<FinancialForecastChart forecasts={[{ forecast_period: '2026-12-01', predicted_income: 1000, predicted_expense: 1325, predicted_balance: -325 }]} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('-₱325.00')).toBeInTheDocument();
    expect(within(table).queryByText('₱-325.00')).not.toBeInTheDocument();
  });

  it('anchors the last period label to the plot edge so it is not cut off', () => {
    const { container } = render(<FinancialForecastChart forecasts={[
      { forecast_period: '2026-09', predicted_income: 1000, predicted_expense: 800, predicted_balance: 200 },
      { forecast_period: '2026-12', predicted_income: 1200, predicted_expense: 900, predicted_balance: 300 },
      { forecast_period: '2027-03', predicted_income: 1500, predicted_expense: 950, predicted_balance: 550 },
    ]} />);

    const anchor = (label) => [...container.querySelectorAll('svg text')].find((node) => node.textContent === label).getAttribute('text-anchor');
    expect(anchor('2026-09')).toBe('middle');
    expect(anchor('2026-12')).toBe('middle');
    expect(anchor('2027-03')).toBe('end');
  });

  it('draws two forecasts for the same period without duplicate React keys', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FinancialForecastChart forecasts={[
      { forecast_period: '2026-12', predicted_income: 1000, predicted_expense: 800, predicted_balance: 200 },
      { forecast_period: '2026-12', predicted_income: 500, predicted_expense: 900, predicted_balance: -400 },
    ]} />);

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
