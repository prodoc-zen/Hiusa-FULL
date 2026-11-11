import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FinancialForecastChart from './FinancialForecastChart';

describe('FinancialForecastChart', () => {
  it('writes a negative balance with the minus before the peso sign', () => {
    render(<FinancialForecastChart forecasts={[{ forecast_period: '2026-12-01', predicted_income: 1000, predicted_expense: 1325, predicted_balance: -325 }]} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('-₱325.00')).toBeInTheDocument();
    expect(within(table).queryByText('₱-325.00')).not.toBeInTheDocument();
  });
});
