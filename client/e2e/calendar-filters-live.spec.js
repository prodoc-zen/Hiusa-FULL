import { expect, test } from '@playwright/test';
import { HEAD_CCS, OFFICER, PSITS_ADMIN } from './support/accounts.js';
import { apiAs, collect, injectSession, liveEnabled, newSink, sessionFor, shot } from './support/live.js';

// Renders the activity calendar the way a person uses it: Month, Week and Day with previous, next and
// Today, the status and date range filters, the filtered empty state and Clear, at desktop and phone
// width, then an officer reading an event's plan and team and checking a member in. Every page is
// watched for console errors, uncaught errors and failed requests.
//
// Set HIUSA_LIVE_E2E=1 to run it. The check-in writes one attendance row to the seeded database.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const MONTH_OF = (date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const DAY_OF = (date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

async function watched(browser, account, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const sink = newSink();
  collect(page, account.schoolId, sink);
  await injectSession(page, await sessionFor(account));
  return { context, page, sink };
}

function expectClean(sink) {
  expect(sink.pageErrors).toEqual([]);
  expect(sink.console).toEqual([]);
  expect(sink.http).toEqual([]);
}

async function openCalendar(page, path) {
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Go to today' })).toBeVisible();
}

const heading = (page) => page.locator('main h2').first();

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const CALENDARS = [
  { name: 'admin', account: PSITS_ADMIN, path: '/dashboard/events/manage-events?view=calendar' },
  { name: 'dean', account: HEAD_CCS, path: '/dashboard/events/activity-calendar' },
];

test.describe('calendar views and filters at 1440 px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const { name, account, path } of CALENDARS) {
    test(`${name} moves through month, week and day and filters the calendar`, async ({ browser }) => {
      const { context, page, sink } = await watched(browser, account, { viewport: { width: 1440, height: 900 } });
      const today = new Date();
      await openCalendar(page, path);

      await expect(heading(page)).toHaveText(MONTH_OF(today));
      await page.screenshot({ path: shot(`calendar-${name}-1440-month.png`), fullPage: true });
      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(heading(page)).not.toHaveText(MONTH_OF(today));
      await page.getByRole('button', { name: 'Previous month' }).click();
      await expect(heading(page)).toHaveText(MONTH_OF(today));
      await page.getByRole('button', { name: 'Go to today' }).click();

      await page.getByRole('radio', { name: 'Week' }).click();
      const week = await heading(page).innerText();
      expect(week).toMatch(/\d{4}$/);
      await page.getByRole('button', { name: 'Next week' }).click();
      await expect(heading(page)).not.toHaveText(week);
      await page.getByRole('button', { name: 'Previous week' }).click();
      await expect(heading(page)).toHaveText(week);
      await page.getByRole('button', { name: 'Next week' }).click();
      await page.getByRole('button', { name: 'Go to today' }).click();
      await expect(heading(page)).toHaveText(week);
      await page.screenshot({ path: shot(`calendar-${name}-1440-week.png`), fullPage: true });

      await page.getByRole('radio', { name: 'Day' }).click();
      await expect(heading(page)).toHaveText(DAY_OF(today));
      await page.getByRole('button', { name: 'Next day' }).click();
      await expect(heading(page)).not.toHaveText(DAY_OF(today));
      await page.getByRole('button', { name: 'Previous day' }).click();
      await expect(heading(page)).toHaveText(DAY_OF(today));
      await page.screenshot({ path: shot(`calendar-${name}-1440-day.png`), fullPage: true });

      await page.getByRole('radio', { name: 'Month' }).click();
      const status = page.getByLabel('Status');
      await status.selectOption({ label: 'Ongoing' });
      await expect(page.getByRole('button', { name: /, Ongoing/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /, Completed/ })).toHaveCount(0);

      const calls = [];
      page.on('request', (request) => { if (/\/api\/events(\?|$)/.test(request.url())) calls.push(request.url()); });
      await page.getByLabel('From date').fill('2999-01-01');
      await page.getByLabel('To date').fill('2999-01-31');
      await expect(page.getByText('No events match these filters')).toBeVisible();
      expect(calls).toEqual([]);
      await page.screenshot({ path: shot(`calendar-${name}-1440-empty.png`), fullPage: true });

      await page.getByLabel('To date').fill('2998-12-01');
      await expect(page.getByText('The end date must be on or after the start date.')).toBeVisible();

      await page.getByRole('button', { name: 'Clear filters' }).first().click();
      await expect(page.getByLabel('From date')).toHaveValue('');
      await expect(page.getByLabel('To date')).toHaveValue('');
      await expect(status).toHaveValue('');
      await page.getByRole('button', { name: 'Go to today' }).click();
      await expect(heading(page)).toHaveText(MONTH_OF(today));
      await expect(page.getByText('No events match these filters')).toHaveCount(0);

      expectClean(sink);
      await context.close();
    });
  }
});

test.describe('calendar views and filters at 390 px', () => {
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

  for (const { name, account, path } of CALENDARS) {
    test(`${name} calendar fits a phone with touch-sized controls`, async ({ browser }) => {
      const { context, page, sink } = await watched(browser, account, phone);
      await openCalendar(page, path);

      for (const view of ['Month', 'Week', 'Day']) {
        await page.getByRole('radio', { name: view }).click();
        await expect(page.getByRole('radio', { name: view })).toHaveAttribute('aria-checked', 'true');
        expect(await horizontalOverflow(page), `${view} view overflows`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: shot(`calendar-${name}-390-${view.toLowerCase()}.png`), fullPage: true });
      }

      await page.getByRole('radio', { name: 'Month' }).click();
      await page.getByLabel('From date').fill('2999-01-01');
      await expect(page.getByText('No events match these filters')).toBeVisible();
      expect(await horizontalOverflow(page), 'empty state overflows').toBeLessThanOrEqual(0);
      await page.screenshot({ path: shot(`calendar-${name}-390-empty.png`), fullPage: true });

      const controls = [
        ...['Month', 'Week', 'Day'].map((view) => page.getByRole('radio', { name: view })),
        page.getByRole('button', { name: 'Previous month' }),
        page.getByRole('button', { name: 'Go to today' }),
        page.getByRole('button', { name: 'Next month' }),
        page.getByLabel('Status'),
        page.getByLabel('From date'),
        page.getByLabel('To date'),
        page.getByRole('button', { name: 'Clear filters' }).first(),
      ];
      for (const control of controls) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0, await control.evaluate((node) => node.getAttribute('aria-label') || node.textContent || node.id)).toBeGreaterThanOrEqual(42);
      }

      expectClean(sink);
      await context.close();
    });
  }
});

test('an officer reads the event plan and team without edit controls, then checks a member in', async ({ browser }) => {
  const admin = await apiAs(PSITS_ADMIN);
  const officer = await apiAs(OFFICER);
  const list = await officer.get('/events?per_page=100');
  const ongoing = (list.body.data || list.body).find((event) => event.status === 'ongoing');
  expect(ongoing, 'the seed has an ongoing event').toBeTruthy();

  const available = (await admin.get(`/events/${ongoing.id}/personnel/available`)).body;
  const roster = (await admin.get(`/events/${ongoing.id}/personnel`)).body;
  const teamMember = (roster.data || roster)[0]?.name
    || (await admin.post(`/events/${ongoing.id}/personnel`, { user_school_id: available[0].school_id, role_label: 'Registration lead' })).body.name;

  const attended = new Set(((await officer.get(`/events/${ongoing.id}/attendance`)).body.records || []).map((record) => record.user_id));
  const candidate = available.find((person) => !attended.has(person.school_id) && person.name !== teamMember) || available.find((person) => !attended.has(person.school_id));
  expect(candidate, 'a member who is not checked in yet').toBeTruthy();

  const { context, page, sink } = await watched(browser, OFFICER, { viewport: { width: 1440, height: 900 } });
  await openCalendar(page, '/dashboard/events/activity-calendar');
  await page.getByRole('button', { name: new RegExp(ongoing.title) }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: ongoing.title })).toBeVisible();
  const plan = dialog.getByRole('region', { name: 'Event plan' });
  await expect(plan.getByRole('heading', { name: 'Event plan' })).toBeVisible();
  await expect(plan.getByText(/Confirmed by the Admin|Draft, not confirmed yet|No plan has been prepared for this event yet/)).toBeVisible();
  await expect(plan.getByRole('button')).toHaveCount(0);

  await expect(dialog.getByText(teamMember)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add to team' })).toHaveCount(0);
  await expect(dialog.getByLabel('Add person')).toHaveCount(0);
  await page.screenshot({ path: shot('calendar-officer-1440-details.png') });

  await dialog.getByRole('link', { name: 'Open check-in' }).click();
  await expect(page.getByRole('heading', { name: 'Manual check-in' })).toBeVisible();
  const member = page.getByRole('combobox', { name: 'Member' });
  await member.fill(candidate.name);
  await page.getByRole('option', { name: new RegExp(candidate.name) }).first().click();
  await expect(page.getByText('Eligibility', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm check-in' }).click();
  await expect(page.getByText('Check-in recorded.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: candidate.name })).toBeVisible();
  await page.screenshot({ path: shot('calendar-officer-1440-checked-in.png'), fullPage: true });

  expectClean(sink);
  await context.close();
});
