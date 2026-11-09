import { expect } from '@playwright/test';

// The application review is a page of its own (ApplicationReview): a row per requirement with a review
// select, a Decision section below. Passing it on needs every requirement marked Accepted.

// The queue row's link to the review page. The label is "Review application of X" while the application
// waits for this reviewer, "View application of X" afterwards.
export function applicationLink(page, name) {
  return page.getByRole('link', { name: new RegExp(`^(Review|View) application of ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
}

// Marks one requirement row. A row that needs nothing starts closed, so its Review button opens it first.
async function mark(row, value, note) {
  const toggle = row.getByRole('button', { name: /^(Review|Change) / });
  if (await toggle.count()) await toggle.click();
  await row.getByRole('combobox', { name: /^Review of / }).selectOption(value);
  if (note) await row.getByLabel('Note for the applicant').fill(note);
}

// The queue's status list is a tab row from 640 px and one select below it (ResponsiveTabs). The hidden one is
// not in the accessibility tree, so exactly one of the two matches. Waiting for it covers the list still loading.
function statusList(page, label) {
  return {
    tab: page.getByRole('tab', { name: new RegExp(`^${label}`) }),
    select: page.getByRole('combobox', { name: 'Application status' }),
  };
}

export async function openApplicationList(page, label) {
  const { tab, select } = statusList(page, label);
  await expect(tab.or(select)).toBeVisible();
  if (await tab.count()) {
    await tab.click();
    return;
  }
  const option = select.locator('option').filter({ hasText: new RegExp(`^${label}`) }).first();
  await select.selectOption({ label: (await option.innerText()).trim() });
}

export async function expectApplicationList(page, label) {
  const { tab, select } = statusList(page, label);
  await expect(tab.or(select)).toBeVisible();
  if (await tab.count()) {
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    return;
  }
  await expect(select.locator('option:checked')).toHaveText(new RegExp(`^${label}`));
}

function requirementRows(page) {
  return page.getByRole('region', { name: 'Requirements' }).locator(':scope > ul > li');
}

export async function acceptEveryRequirement(page) {
  const rows = requirementRows(page);
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) await mark(rows.nth(index), 'ok');
  return count;
}

// Flags the row whose file is called `fileName` as needing changes, with the note the applicant will read.
export async function flagRequirement(page, fileName, note) {
  const row = requirementRows(page).filter({ has: page.getByRole('button', { name: fileName, exact: true }) });
  await mark(row, 'needs_changes', note);
}
