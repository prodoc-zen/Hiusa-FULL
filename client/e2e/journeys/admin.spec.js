import { expect, test } from '@playwright/test';
import { HEAD_CCS, PSITS_ADMIN, STUDENT, apiAs, liveEnabled, shot, uiLogin } from '../support/live.js';

// ADMIN acceptance journeys from docs/UX_FLOW.md section 9. Each runs at 1440 and 390 px, starts at the
// Admin home after a real sign-in, counts only mouse or tap actions (typing, selecting a value in a form
// field and the fixture navigation to a record are not counted) and ends on what the person can see.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const LONG = { timeout: 45_000 };
const RUN = Date.now().toString(36);

// Organizations the seed leaves with an Admin and nothing else set up, so the first-run checklist is real.
const SETUP_ADMINS = {
  1440: { schoolId: 990032, password: 'Admin@123456' },
  390: { schoolId: 990042, password: 'Admin@123456' },
};

// A failed test restarts the worker and drops its cached sign-ins; the login throttle then answers 429,
// so wait the window out instead of failing the seed.
async function signedApi(account) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await apiAs(account);
    } catch (error) {
      if (!/ 429 /.test(String(error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  return apiAs(account);
}

function tapper() {
  const state = { clicks: 0, steps: [] };
  return {
    state,
    async tap(locator, label) {
      await locator.click();
      state.clicks += 1;
      state.steps.push(label);
    },
    reset() {
      state.clicks = 0;
      state.steps = [];
    },
    summary() {
      return `${state.clicks} (${state.steps.join(' > ')})`;
    },
  };
}

async function homeReady(page) {
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible(LONG);
  await expect(page.getByText(/Administration workspace|Getting started/).first()).toBeVisible(LONG);
}

// Reaches a menu leaf the way a person does: on a phone the menu opens first, then the group, then the leaf.
async function openLeaf(t, page, width, group, leaf) {
  if (width < 1024) await t.tap(page.getByRole('button', { name: 'Open menu' }), 'open menu');
  if (group) await t.tap(page.getByRole('button', { name: group, exact: true }), group);
  await t.tap(page.getByRole('link', { name: leaf, exact: true }).first(), leaf);
}

function localDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`;
}

// An event window relative to now, in the app's local wall clock.
function eventWindow(startHours, durationHours) {
  const start = new Date(Date.now() + startHours * 3600 * 1000);
  return { start_time: stamp(start), end_time: stamp(new Date(start.getTime() + durationHours * 3600 * 1000)) };
}

async function headApprove(head, eventId) {
  const list = await head.get('/approval-requests?status=pending&per_page=100');
  const row = (list.body?.data ?? []).find((r) => r.entity_type === 'event' && r.entity_id === eventId);
  if (!row) throw new Error(`No pending approval for event ${eventId}: ${JSON.stringify(list.body).slice(0, 200)}`);
  const res = await head.patch(`/approval-requests/${row.id}`, { status: 'approved' });
  if (!res.ok) throw new Error(`Department Head approval failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
}

async function seedEvent(admin, title, extra = {}) {
  const res = await admin.post('/events', { title, description: 'Seeded for a journey.', location: 'Room 1', requires_budget: false, ...eventWindow(24 * 20, 3), ...extra });
  if (res.status !== 201) throw new Error(`Could not seed event ${title}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body;
}

async function approvedEvent(title, extra) {
  const admin = await signedApi(PSITS_ADMIN);
  const head = await signedApi(HEAD_CCS);
  const event = await seedEvent(admin, title, extra);
  await headApprove(head, event.id);
  return { admin, head, event };
}

async function setStatus(admin, eventId, status) {
  const res = await admin.patch(`/events/${eventId}/status`, { status });
  if (!res.ok) throw new Error(`Event ${eventId} to ${status}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
}

async function openEventRecord(page, eventId) {
  await page.goto(`/dashboard/events/manage-events?record=${eventId}`);
  const dialog = page.getByRole('dialog', { name: 'Event details' });
  await expect(dialog.getByRole('list', { name: 'Event progress' })).toBeVisible(LONG);
  return dialog;
}

async function endOfJourneyReport(page, width, id) {
  if (width !== 390) return;
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = [...document.querySelectorAll('body *')].filter((el) => {
      if (el.closest('.mobile-nav-overlay')) return false;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && (r.right > vw + 1 || r.left < -1);
    }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, clipped };
  });
  console.log(`[admin ${id} @390] horizontalScroll=${report.scrollWidth > report.clientWidth + 1} scrollWidth=${report.scrollWidth} clientWidth=${report.clientWidth} offscreen=${JSON.stringify(report.clipped)}`);
  await page.screenshot({ path: shot(`admin-${id}-end-390.png`) });
}

for (const viewport of VIEWPORTS) {
  const width = viewport.width;

  test.describe(`ADMIN journeys at ${width}px`, () => {
    test.use({ viewport });

    test.beforeEach(() => {
      test.setTimeout(300_000);
    });

    test('A1 propose an event (ceiling 4)', async ({ page }) => {
      const title = `Journey proposal ${width} ${RUN}`;
      const t = tapper();
      await uiLogin(page, PSITS_ADMIN);
      await homeReady(page);

      await openLeaf(t, page, width, 'Events and tasks', 'Events');
      await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible(LONG);
      await t.tap(page.getByRole('button', { name: 'New event' }).first(), 'New event');
      const form = page.getByRole('dialog', { name: 'New event' });
      await form.locator('#event-title').fill(title);
      await form.locator('#event-start-date').fill(localDate(30));
      await form.locator('#event-start-time').fill('09:00');
      await form.locator('#event-end-date').fill(localDate(30));
      await form.locator('#event-end-time').fill('12:00');
      await form.locator('#event-campus-venue').selectOption({ index: 1 });
      await t.tap(form.getByRole('button', { name: 'Submit proposal' }), 'Submit proposal');
      await expect(form).toBeHidden(LONG);

      await page.getByPlaceholder('Search events').fill(title);
      if (width < 1024) {
        const card = page.getByRole('article').filter({ hasText: title });
        await expect(card).toBeVisible(LONG);
        await expect.soft(card, 'the new row names its stage with no further click').toContainText('Waiting for Department Head approval');
        await t.tap(card.getByRole('button', { name: /View details/ }), 'View details');
      } else {
        const row = page.getByRole('row').filter({ hasText: title });
        await expect(row).toBeVisible(LONG);
        await expect.soft(row, 'the new row names its stage with no further click').toContainText('Waiting for Department Head approval');
        await row.getByRole('button', { name: /^Actions for / }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await t.tap(row.getByRole('button', { name: /^Actions for / }), 'Actions');
        await t.tap(page.getByRole('menuitem', { name: 'View event' }), 'View event');
      }

      const dialog = page.getByRole('dialog', { name: 'Event details' });
      console.log(`[admin A1 @${width}] clicks=${t.summary()}`);
      expect.soft(t.state.clicks, `clicks ${t.summary()}`).toBeLessThanOrEqual(4);
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible(LONG);
      await expect(dialog.getByRole('list', { name: 'Event progress' })).toBeVisible();
      await expect(dialog.getByRole('list', { name: 'Event progress' }).locator('[aria-current="step"]')).toContainText('Department Head approval');
      const nextStep = dialog.getByRole('region', { name: 'Event progress' }).getByRole('status');
      await expect(nextStep).toHaveCount(1);
      await expect(nextStep).toContainText('Waiting for Department Head approval');
    });

    test('A2 fund it (ceiling 3 from the event)', async ({ page }) => {
      const title = `Journey funding ${width} ${RUN}`;
      const { event } = await approvedEvent(title, { requires_budget: true, planning_details: { budget_notes: 'Food and printing' } });
      const t = tapper();
      await uiLogin(page, PSITS_ADMIN);
      await homeReady(page);

      // The journey starts from the event itself: opening a record by its link is not a counted action.
      const dialog = await openEventRecord(page, event.id);
      await expect(dialog.getByText('Propose the event budget')).toBeVisible(LONG);
      await t.tap(dialog.locator('a, button').filter({ hasText: /^Propose budget$/ }), 'Propose budget');

      const form = page.getByRole('dialog', { name: 'Propose budget' });
      await expect(form).toBeVisible(LONG);
      await expect(form.locator('select').first()).toHaveValue(String(event.id), LONG);
      await form.getByPlaceholder('e.g. Sports Fest 2026 Budget').fill(`${title} budget`);
      const amounts = form.locator('input[type="number"]');
      await amounts.nth(0).fill('5000');
      await amounts.nth(1).fill('4000');
      await t.tap(form.getByRole('button', { name: 'Submit for Approval' }), 'Submit for Approval');
      await expect(form).toBeHidden(LONG);

      // The Budgets list has no link to the event, so the only way back to its stepper is the browser Back.
      await page.goBack();
      t.state.clicks += 1;
      t.state.steps.push('browser Back');
      const eventPage = page.getByRole('dialog', { name: 'Event details' });
      console.log(`[admin A2 @${width}] clicks=${t.summary()}`);
      expect.soft(t.state.clicks, `clicks ${t.summary()}`).toBeLessThanOrEqual(3);
      await expect(eventPage.getByText('Budget waiting for Department Head approval', { exact: true })).toBeVisible(LONG);
    });

    test('A3 track my submissions (ceiling 3)', async ({ page }) => {
      const title = `Journey tracking ${width} ${RUN}`;
      const admin = await signedApi(PSITS_ADMIN);
      const event = await seedEvent(admin, title);
      const t = tapper();
      await uiLogin(page, PSITS_ADMIN);
      await homeReady(page);

      // On a phone the home's Approval Requests card is the one-tap way in; the menu would cost two.
      if (width < 1024) await t.tap(page.getByRole('link', { name: /^Approval Requests/ }), 'Approval Requests card');
      else await t.tap(page.getByRole('link', { name: 'Approvals', exact: true }).first(), 'Approvals');
      await t.tap(page.getByRole('tab', { name: /Submitted by me/ }), 'Submitted by me');
      const row = page.getByRole('listitem').filter({ hasText: title });
      await expect(row).toBeVisible(LONG);
      const rowText = await row.innerText();
      await t.tap(row.getByRole('link', { name: `Open event: ${title}` }), 'Open event');

      const dialog = page.getByRole('dialog', { name: 'Event details' });
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible(LONG);
      console.log(`[admin A3 @${width}] clicks=${t.summary()} event=${event.id}`);
      expect.soft(t.state.clicks, `clicks ${t.summary()}`).toBeLessThanOrEqual(3);
      const nextStep = dialog.getByRole('region', { name: 'Event progress' }).getByRole('status');
      const stage = (await nextStep.locator('p').first().innerText()).trim();
      expect.soft(rowText, 'the row stage text equals the event page stage text').toContain(stage);
      await expect(nextStep).toContainText('Waiting for Department Head approval');
    });

    test('A4 run and report (ceiling 3 and 3)', async ({ page }) => {
      const admin = await signedApi(PSITS_ADMIN);
      const listed = await admin.get('/events?per_page=100');
      for (const other of (listed.body?.data ?? []).filter((e) => e.status === 'ongoing')) await setStatus(admin, other.id, 'completed');
      const ongoingTitle = `Journey ongoing ${width} ${RUN}`;
      const completedTitle = `Journey completed ${width} ${RUN}`;
      const ongoing = await approvedEvent(ongoingTitle, eventWindow(-1, 20));
      await setStatus(admin, ongoing.event.id, 'ongoing');
      const completed = await approvedEvent(completedTitle, eventWindow(-24 * 3, 3));
      await setStatus(admin, completed.event.id, 'ongoing');
      await setStatus(admin, completed.event.id, 'completed');

      const t = tapper();
      await uiLogin(page, PSITS_ADMIN);
      await homeReady(page);

      await openLeaf(t, page, width, 'Events and tasks', 'Check-in');
      const queueButton = page.getByRole('button', { name: `Open attendance for ${ongoingTitle}` });
      const controls = page.getByText('Manual check-in', { exact: true });
      await expect(queueButton.or(controls)).toBeVisible({ timeout: 60_000 });
      const preselected = await controls.isVisible();
      if (!preselected) await t.tap(queueButton, `pick ${ongoingTitle}`);
      await page.getByLabel('Member', { exact: true }).fill(String(STUDENT.schoolId));
      await t.tap(page.locator('main').getByText(new RegExp(String(STUDENT.schoolId))).first(), 'pick member');
      await t.tap(page.getByRole('button', { name: 'Confirm Check-In' }), 'Confirm Check-In');
      await expect(page.getByText('Check-in recorded.')).toBeVisible(LONG);
      console.log(`[admin A4 check-in @${width}] clicks=${t.summary()} preselected=${preselected}`);
      expect.soft(preselected, 'the ongoing event is preselected on Check-in').toBe(true);
      expect.soft(t.state.clicks, `check-in clicks ${t.summary()}`).toBeLessThanOrEqual(3);

      const dialog = await openEventRecord(page, completed.event.id);
      await expect(dialog.getByText('Prepare the event financial report')).toBeVisible(LONG);
      t.reset();
      await t.tap(dialog.locator('a, button').filter({ hasText: /^Prepare event report$/ }), 'Prepare event report');
      await page.getByRole('button', { name: 'Generate Financial Report' }).waitFor({ state: 'visible', timeout: 60_000 });
      await expect(page.locator('select[required]', { has: page.locator('option', { hasText: completedTitle }) })).toHaveValue(String(completed.event.id), LONG);
      for (const label of ['Treasurer', 'President', 'Adviser', 'SBO Adviser']) await page.getByLabel(label, { exact: true }).fill(`${label} Journey`);
      await t.tap(page.getByRole('button', { name: 'Generate Financial Report' }), 'Generate');
      console.log(`[admin A4 report @${width}] clicks=${t.summary()}`);
      expect.soft(t.state.clicks, `report clicks ${t.summary()}`).toBeLessThanOrEqual(3);

      // Below 640 px the row shows the next action in place of the step label, so the stepper's own
      // text is read from its attribute and the guidance from what is visible on the saved report.
      const stepper = page.locator(`[aria-label^="Report progress for"][aria-label*="${completedTitle}" i]`);
      await expect(stepper).toHaveAttribute('aria-valuetext', 'Step 1 of 4: Draft', LONG);
      const report = stepper.locator('xpath=ancestor::*[.//button[normalize-space()="View details"]][1]');
      await expect(report.getByText(/draft/i).filter({ visible: true }).first()).toBeVisible();
      await expect(report.getByText('Review and submit', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    });

    test('A5 set up the organization (ceiling 3 per step)', async ({ page }) => {
      const account = SETUP_ADMINS[width];
      const admin = await signedApi(account);
      for (const position of (await admin.get('/sbo-positions')).body ?? []) await admin.delete(`/sbo-positions/${position.id}`);
      for (const member of ((await admin.get('/users?per_page=100')).body?.data ?? []).filter((u) => u.role === 'STUDENT')) await admin.delete(`/users/${member.school_id}`);
      for (const event of (await admin.get('/events?per_page=100')).body?.data ?? []) await admin.delete(`/events/${event.id}`);
      const home = '/dashboard/admin';

      const t = tapper();
      await uiLogin(page, account);
      await homeReady(page);
      const progress = page.getByRole('progressbar', { name: 'Progress' });
      await expect(progress).toBeVisible(LONG);
      const before = Number(await progress.getAttribute('aria-valuenow'));
      const steps = [];

      await t.tap(page.getByRole('link', { name: /Add (officer )?positions/ }), 'Add positions');
      await t.tap(page.getByRole('button', { name: /Add Position/ }).first(), 'Add Position');
      const position = page.getByRole('dialog', { name: 'Add Position' });
      await position.getByLabel(/Position title/).selectOption('President');
      await t.tap(position.getByRole('button', { name: 'Save Position' }), 'Save Position');
      await expect(position).toBeHidden(LONG);
      steps.push(`positions ${t.summary()}`);
      expect.soft(t.state.clicks, `positions ${t.summary()}`).toBeLessThanOrEqual(3);
      t.reset();

      await page.goto(home);
      await homeReady(page);
      await t.tap(page.getByRole('link', { name: /Add members/ }), 'Add members');
      await t.tap(page.getByRole('button', { name: /New User/ }), 'New User');
      const member = page.getByRole('dialog', { name: 'Create User' });
      await member.getByLabel(/^School ID/).fill(`2${String(Date.now()).slice(-6)}`);
      await member.getByLabel(/^Email/).fill(`journey.${RUN}.${width}@hiusa.local`);
      await member.getByLabel(/^First Name/).fill('Journey');
      await member.getByLabel(/^Last Name/).fill('Member');
      await member.getByLabel(/^Role/).selectOption('STUDENT');
      await member.getByLabel(/^Course \/ Program/).selectOption({ index: 1 });
      await member.getByLabel(/^Password/).fill('Journey@12345');
      await member.getByLabel(/^Confirm Password/).fill('Journey@12345');
      await t.tap(member.getByRole('button', { name: 'Create User' }), 'Create User');
      await expect(member).toBeHidden(LONG);
      steps.push(`members ${t.summary()}`);
      expect.soft(t.state.clicks, `members ${t.summary()}`).toBeLessThanOrEqual(3);
      t.reset();

      await page.goto(home);
      await homeReady(page);
      await t.tap(page.getByRole('link', { name: /Propose (an|first) event/ }), 'Propose an event');
      await t.tap(page.getByRole('button', { name: 'New event' }).first(), 'New event');
      const form = page.getByRole('dialog', { name: 'New event' });
      await form.locator('#event-title').fill(`Journey first event ${width} ${RUN}`);
      await form.locator('#event-start-date').fill(localDate(30));
      await form.locator('#event-start-time').fill('09:00');
      await form.locator('#event-end-date').fill(localDate(30));
      await form.locator('#event-end-time').fill('12:00');
      await form.locator('#event-campus-venue').selectOption({ index: 1 });
      await t.tap(form.getByRole('button', { name: 'Submit proposal' }), 'Submit proposal');
      await expect(form).toBeHidden(LONG);
      steps.push(`event ${t.summary()}`);
      expect.soft(t.state.clicks, `event ${t.summary()}`).toBeLessThanOrEqual(3);
      console.log(`[admin A5 @${width}] ${steps.join(' | ')}`);

      await page.goto(home);
      await homeReady(page);
      await expect(page.getByRole('link', { name: /Add (officer )?positions/ })).toHaveCount(0, LONG);
      await expect(page.getByRole('link', { name: /Add members/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Propose (an|first) event/ })).toHaveCount(0);
      await expect(progress).toHaveAttribute('aria-valuenow', String(before + 3));
    });

    test.afterEach(async ({ page }, testInfo) => {
      await endOfJourneyReport(page, width, testInfo.title.split(' ')[0]);
    });
  });
}
