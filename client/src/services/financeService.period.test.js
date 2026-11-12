import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('finance reads follow the top bar semester', () => {
  let seen;
  let finance;
  let orgSpace;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('hiusa_selected_academic_period', JSON.stringify({ id: 41, number: 2 }));
    const { default: api } = await import('./api');
    seen = [];
    api.defaults.adapter = async (config) => {
      seen.push(config);
      return { data: {}, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    };
    finance = await import('./financeService');
    orgSpace = await import('./orgSpaceService');
  });

  it('sends the chosen semester with the ledger, budgets, reports and collections reads', async () => {
    await finance.getTransactions({ page: 1 });
    await finance.getTransactionSummary({});
    await finance.getBudgets({ page: 1 });
    await finance.getFinancialReports({ page: 1 });
    await finance.getCollections({});
    await finance.getFinancialDashboard();

    expect(seen).toHaveLength(6);
    expect(seen.map((config) => config.headers.get('X-Academic-Semester'))).toEqual(Array(6).fill('41'));
  });

  it('sends the chosen semester with the organization space reads', async () => {
    await orgSpace.getOrganizationSpace(7);
    await orgSpace.getOrganizationTransactions(7, { page: 1 });

    expect(seen.map((config) => config.headers.get('X-Academic-Semester'))).toEqual(['41', '41']);
  });

  it('does not put a semester of its own on those reads', async () => {
    await finance.getTransactions({ page: 1 });
    await finance.getBudgets({ page: 1 });

    expect(seen.every((config) => !('academic_semester_id' in (config.params || {})))).toBe(true);
  });
});
