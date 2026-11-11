import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReceiptDocument from './ReceiptDocument';

const base = {
  id: 7,
  receipt_reference: 'FIN-ABC123',
  amount: 150,
  description: 'Payment for INV-1',
  category: 'Student Payment',
  transaction_date: '2026-11-11T20:14:00+08:00',
  payer: { first_name: 'Pia', last_name: 'Torres' },
  recorder: { first_name: 'Marco', last_name: 'Dela Cruz' },
};

describe('ReceiptDocument for a personal receipt', () => {
  it('ticks the one method an order was paid with', () => {
    render(<ReceiptDocument transaction={{ ...base, merchandise_order: { payment_method: 'gcash' } }} />);

    const modes = screen.getByLabelText('Mode of payment');
    expect(modes).toHaveTextContent('☐ Cash');
    expect(modes).toHaveTextContent('☑ GCash');
    expect(modes).toHaveTextContent('☐ Other');
  });

  it('says the method was not recorded instead of showing every box empty when none is known', () => {
    render(<ReceiptDocument transaction={base} />);

    expect(screen.queryByLabelText('Mode of payment')).not.toBeInTheDocument();
    expect(screen.getByText(/Mode of payment:/).parentElement).toHaveTextContent('Mode of payment: Not recorded');
    expect(screen.queryByText(/☐/)).not.toBeInTheDocument();
  });

  it('lets the receipt number drop to its own line on a narrow screen instead of floating over the divider', () => {
    render(<ReceiptDocument transaction={base} />);

    const line = screen.getByText('Received from:').closest('p');
    expect(line).toHaveClass('flex', 'flex-wrap');
    expect(line.querySelector('.float-right')).toBeNull();
  });

  it('prints the payment method of an order with the brand spelling', () => {
    render(<ReceiptDocument order={{ id: 5, merchandise: { name: 'HIUSA Shirt' }, quantity: 1, total_price: '350.00', status: 'pending', payment_method: 'gcash' }} />);

    expect(screen.getByText('Method').parentElement).toHaveTextContent('MethodGCash');
  });
});
