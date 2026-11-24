import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('finance transaction requests', () => {
  let seen;
  let finance;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    const { default: api } = await import('./api');
    seen = [];
    api.defaults.adapter = async (config) => {
      seen.push(config);
      return { data: {}, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    };
    finance = await import('./financeService');
  });

  it('records a transaction as multipart form data with the official receipt file', async () => {
    const file = new File(['%PDF'], 'or-1042.pdf', { type: 'application/pdf' });
    await finance.createTransaction({ description: 'Sound system', amount: 1250.5, type: 'expense', budget_id: null, event_id: 4, receipt_reference: '', receipt_file: file });

    expect(seen[0].method).toBe('post');
    expect(seen[0].url).toBe('/transactions');
    const body = seen[0].data;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('description')).toBe('Sound system');
    expect(body.get('amount')).toBe('1250.5');
    expect(body.get('event_id')).toBe('4');
    expect(body.get('budget_id')).toBe('');
    expect(body.get('receipt_file')).toBeInstanceOf(File);
    expect(body.get('receipt_file').name).toBe('or-1042.pdf');
  });

  it('leaves the file field out when no file is chosen', async () => {
    await finance.createTransaction({ description: 'Donation', amount: 100, type: 'income', receipt_file: null });

    expect(seen[0].data.has('receipt_file')).toBe(false);
  });

  it('edits through a POST that spoofs PUT so the file can travel with it', async () => {
    await finance.updateTransaction(9, { description: 'Sound system', edit_reason: 'Wrong amount typed', receipt_file: null });

    expect(seen[0].method).toBe('post');
    expect(seen[0].url).toBe('/transactions/9');
    expect(seen[0].data.get('_method')).toBe('PUT');
    expect(seen[0].data.get('edit_reason')).toBe('Wrong amount typed');
    expect(seen[0].data.has('receipt_file')).toBe(false);
  });

  it('archives with a reason through PATCH and no longer offers a delete', async () => {
    await finance.archiveTransaction(9, 'Duplicate entry');

    expect(seen[0].method).toBe('patch');
    expect(seen[0].url).toBe('/transactions/9/archive');
    expect(JSON.parse(seen[0].data)).toEqual({ reason: 'Duplicate entry' });
    expect(finance.deleteTransaction).toBeUndefined();
  });

  it('reads the history of one transaction', async () => {
    await finance.getTransactionHistory(9);

    expect(seen[0].method).toBe('get');
    expect(seen[0].url).toBe('/transactions/9/history');
  });
});
