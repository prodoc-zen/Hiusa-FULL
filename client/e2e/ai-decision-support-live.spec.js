import { expect, test } from '@playwright/test';
import process from 'node:process';

const aiUrl = process.env.HIUSA_E2E_AI_URL || 'http://127.0.0.1:8001';
const aiServiceKey = process.env.HIUSA_E2E_AI_SERVICE_KEY;
const liveEnabled = process.env.HIUSA_AI_E2E === '1';

test.skip(!liveEnabled || !aiServiceKey, 'Set HIUSA_AI_E2E=1 and HIUSA_E2E_AI_SERVICE_KEY to test the live deterministic AI service.');

function aiHeaders(key = aiServiceKey) {
  return {
    Accept: 'application/json',
    'X-AI-Service-Key': key,
  };
}

test('deterministic AI service applies forecast, budget, and delegation rules', async ({ request }) => {
  const health = await request.get(`${aiUrl}/health`);
  await expect(health).toBeOK();
  await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

  const forecast = await request.post(`${aiUrl}/api/v1/financial-forecast`, {
    headers: aiHeaders(),
    data: {
      monthly_records: [
        { period: '2026-01', income: 1000, expense: 600 },
        { period: '2026-02', income: 1200, expense: 700 },
      ],
    },
  });
  await expect(forecast).toBeOK();
  await expect(forecast.json()).resolves.toMatchObject({
    algorithm: 'ordinary_least_squares',
    forecast_period: '2026-03',
    predicted_income: 1400,
    predicted_expense: 800,
    predicted_balance: 600,
  });

  const advice = await request.post(`${aiUrl}/api/v1/budget-advice`, {
    headers: aiHeaders(),
    data: {
      predicted_income: 500,
      predicted_expense: 300,
      current_available_budget: 1000,
      committed_expenses: 0,
      warning_threshold: 100,
      safety_ratio: 0.8,
    },
  });
  await expect(advice).toBeOK();
  await expect(advice.json()).resolves.toMatchObject({
    forecast_risk: 'stable',
    overspending_risk: 'low',
    safe_spending_limit: 960,
    recommended_allocation: 960,
    reserve_amount: 40,
    allocation_status: 'within_limit',
  });

  const delegation = await request.post(`${aiUrl}/api/v1/task-delegation`, {
    headers: aiHeaders(),
    data: {
      task_title: 'Playwright rule-based delegation check',
      max_active_tasks: 5,
      officers: [
        { officer_id: 1, name: 'Busy Officer', role: 'SBO_OFFICER', position_title: 'President', account_status: 'active', is_available: true, policy_eligible: true, active_tasks: 3, completed_tasks: 1, overdue_tasks: 1 },
        { officer_id: 2, name: 'Available Officer', role: 'SBO_OFFICER', position_title: 'President', account_status: 'active', is_available: true, policy_eligible: true, active_tasks: 0, completed_tasks: 3, overdue_tasks: 0 },
        { officer_id: 3, name: 'Ineligible Student', role: 'STUDENT', position_title: null, account_status: 'active', is_available: true, policy_eligible: true, active_tasks: 0, completed_tasks: 0, overdue_tasks: 0 },
      ],
    },
  });
  await expect(delegation).toBeOK();
  await expect(delegation.json()).resolves.toMatchObject({
    algorithm: 'rule_based_weighted_scoring',
    weights: { position: 0.4, workload: 0.35, performance: 0.25 },
    recommended_officer_id: 2,
  });

  const invalidKey = await request.post(`${aiUrl}/api/v1/budget-advice`, {
    headers: aiHeaders('incorrect-key'),
    data: { predicted_income: 1000, predicted_expense: 500 },
  });
  expect(invalidKey.status()).toBe(401);
});
