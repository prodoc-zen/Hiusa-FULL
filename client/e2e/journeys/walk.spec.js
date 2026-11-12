import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { HEAD_CCS, SAO, apiAs, collect, injectSession, liveEnabled, newSink, sessionFor, shot } from '../support/live.js';
import { allowToApply, ensureOpenSemester, newStudent, submitApplication, uniqueAcronym, uniqueName } from '../support/pipeline.js';

// A rendered walk of the screens added by the one-pipeline restructure: sign-up, invitations, the dean's
// People page and organization space, Records, applying, the SAO's student records and colleges, and the two
// access modals. Each screen is opened at 390 and 1280 px and must open with no console error, no uncaught
// error and no sideways scroll and no workspace chip over the bell or the semester selector; a screenshot of each is written next to the other live shots.
//
// Set HIUSA_LIVE_E2E=1 to run it against a seeded local Laravel API.
test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
];

const fixtures = {};
const report = { screens: [], problems: [] };

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function sidewaysOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

// The top bar's workspace chip must never sit over the notification bell or the semester selector, which is how
// the 390px bar looked when the chip had no room to shrink. Reports the overlap in px, or 0 when either control
// is not on screen.
async function topBarOverlap(page) {
  const bell = page.getByRole('button', { name: 'Notifications' }).first();
  const chip = page.getByRole('button', { name: /^Workspace:/ }).first();
  const period = page.getByRole('button', { name: /^Academic Period:/ }).first();
  if (!(await chip.isVisible())) return 0;
  const boxOf = async (control) => ((await control.isVisible()) ? control.boundingBox() : null);
  const area = (a, b) => {
    if (!a || !b) return 0;
    const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return across > 0 && down > 0 ? Math.round(across * down) : 0;
  };
  const chipBox = await boxOf(chip);
  return area(chipBox, await boxOf(bell)) + area(chipBox, await boxOf(period));
}

async function openContext(browser, viewport, account) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const sink = newSink();
  collect(page, account ? String(account.schoolId) : 'guest', sink);
  if (account) await injectSession(page, await sessionFor(account));
  return { context, page, sink };
}

// Opens one screen, lets it settle, runs the optional steps and records what it saw. A screen that shows an
// error state on purpose names the HTTP status the browser is expected to log for it.
async function visit(session, viewport, id, path, steps, expectedStatuses = []) {
  const { page, sink } = session;
  const before = { console: sink.console.length, errors: sink.pageErrors.length };
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 20_000 });
  await settle(page);
  if (steps) {
    await steps(page);
    await settle(page);
  }
  const overflow = await sidewaysOverflow(page);
  const overlap = await topBarOverlap(page);
  const picture = shot(`walk-${id}-${viewport.name}.png`);
  await page.screenshot({ path: picture, fullPage: true });
  const consoleErrors = sink.console.slice(before.console).filter((error) => !expectedStatuses.some((status) => error.text.includes(`status of ${status}`)));
  const pageErrors = sink.pageErrors.slice(before.errors);
  report.screens.push({ id, width: viewport.name, path, overflow, overlap, console: consoleErrors, pageErrors, picture });
  if (overflow > 1) report.problems.push(`${id} @${viewport.name}: the page scrolls sideways by ${overflow}px`);
  if (overlap > 0) report.problems.push(`${id} @${viewport.name}: the workspace chip covers the bell or the semester selector (${overlap}px2)`);
  for (const error of consoleErrors) report.problems.push(`${id} @${viewport.name}: console error ${error.text}`);
  for (const error of pageErrors) report.problems.push(`${id} @${viewport.name}: uncaught ${error.text}`);
}

test.afterAll(async () => {
  fs.writeFileSync(shot('walk-report.json'), JSON.stringify(report, null, 2));
});

// Runs again if a failed screen restarts the worker, so the rest of the walk still has its fixtures.
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await ensureOpenSemester();
  const sao = await apiAs(SAO);
  const dean = await apiAs(HEAD_CCS);

  const colleges = await sao.get('/system/colleges');
  const list = colleges.body?.data ?? colleges.body;
  const target = list.find((college) => college.code === 'COE');
  if (target.department_head?.account_status === 'active') {
    const off = await sao.put(`/system/department-heads/${target.department_head.school_id ?? target.department_head.id}`, { account_status: 'inactive' });
    expect(off.ok, JSON.stringify(off.body).slice(0, 200)).toBe(true);
  }
  const deanInvite = await sao.post(`/system/colleges/${target.id}/invite-department-head`, {});
  expect(deanInvite.status, JSON.stringify(deanInvite.body).slice(0, 200)).toBe(201);
  fixtures.deanToken = new URL(deanInvite.body.magic_link).searchParams.get('token');

  const staffInvite = await dean.post('/college/staff/invitations', {
    email: `walk.staff.${Date.now()}@journey.test`,
    position_title: 'College Secretary',
  });
  expect(staffInvite.status, JSON.stringify(staffInvite.body).slice(0, 200)).toBe(201);
  fixtures.staffToken = new URL(staffInvite.body.magic_link).searchParams.get('token');

  fixtures.applicant = await newStudent('Walk');
  await allowToApply(fixtures.applicant);
  fixtures.open = fixtures.applicant;

  fixtures.sent = await newStudent('Sent');
  await allowToApply(fixtures.sent);
  fixtures.application = await submitApplication(fixtures.sent, { name: uniqueName('Walk Society'), acronym: uniqueAcronym('WS') });
});

for (const viewport of VIEWPORTS) {
  test.describe(`Changed screens at ${viewport.name}px`, () => {
    test.describe.configure({ timeout: 300_000 });

    test('Guest: sign-up and both invitation pages', async ({ browser }) => {
      const mark = report.problems.length;
      const session = await openContext(browser, viewport, null);
      await visit(session, viewport, 'sign-up', '/sign-up');
      await visit(session, viewport, 'sign-up-failed-lookup', '/sign-up', async (page) => {
        await page.getByLabel('School ID').fill('12345');
        await page.getByLabel('Birth date').fill('2001-01-01');
        await page.getByLabel('Email').fill('walk.lookup@example.test');
        await page.getByLabel('Password', { exact: true }).fill('Walk-lookup-2026-x');
        await page.getByLabel('Confirm password').fill('Walk-lookup-2026-x');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByRole('alert').filter({ hasText: "We couldn't match that school ID and birth date with the school records." })).toBeVisible({ timeout: 15_000 });
      }, [422]);
      await visit(session, viewport, 'accept-invitation-dean', `/accept-invitation?token=${fixtures.deanToken}`, async (page) => {
        await expect(page.getByRole('heading', { name: /You're invited to lead/ })).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'accept-invitation-staff', `/accept-invitation?token=${fixtures.staffToken}`, async (page) => {
        await expect(page.getByRole('heading', { name: /as office staff/ })).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'accept-invitation-bad-link', '/accept-invitation?token=not-a-real-link', async (page) => {
        await expect(page.getByText('This invitation link has expired')).toBeVisible({ timeout: 15_000 });
      }, [404]);
      await session.context.close();
      expect(report.problems.slice(mark), report.problems.slice(mark).join('\n')).toEqual([]);
    });

    test('Dean: People (three tabs, student records, invite modal), organizations, organization space, Records', async ({ browser }) => {
      const mark = report.problems.length;
      const session = await openContext(browser, viewport, HEAD_CCS);
      await visit(session, viewport, 'dean-people-students', '/dashboard/department-head/people');
      await visit(session, viewport, 'dean-people-student-records', '/dashboard/department-head/people', async (page) => {
        await page.getByRole('button', { name: 'Upload student records' }).first().click();
        await expect(page.getByRole('dialog', { name: 'Upload student records' })).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'dean-people-allow-modal', '/dashboard/department-head/people', async (page) => {
        await page.getByRole('button', { name: 'Allow a student to apply' }).click();
        const dialog = page.getByRole('dialog', { name: 'Allow a student to apply' });
        await dialog.getByRole('combobox', { name: 'Student' }).fill(fixtures.applicant.firstName);
        await expect(dialog.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'dean-people-staff', '/dashboard/department-head/people', async (page) => {
        await page.getByRole('tab', { name: 'Office staff' }).click();
        await expect(page.getByRole('button', { name: 'Add staff' })).toBeVisible();
      });
      await visit(session, viewport, 'dean-people-invite-modal', '/dashboard/department-head/people', async (page) => {
        await page.getByRole('tab', { name: 'Office staff' }).click();
        await page.getByRole('button', { name: 'Add staff' }).click();
        const dialog = page.getByRole('dialog', { name: 'Add office staff' });
        const notInRecords = dialog.getByRole('button', { name: 'Not in the records? Invite by name and email' });
        await expect(dialog.getByLabel(/^First name/).or(notInRecords)).toBeVisible();
        if (await notInRecords.isVisible()) await notInRecords.click();
        await dialog.getByLabel(/^First name/).fill('Walk');
        await dialog.getByLabel(/^Last name/).fill('Modal');
        await dialog.getByLabel(/^Email/).fill(`walk.modal.${Date.now()}@journey.test`);
        await dialog.getByLabel(/^Position/).fill('College Secretary');
        await dialog.getByRole('button', { name: 'Create invite link' }).click();
        await expect(dialog.getByLabel('Invite link')).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'dean-people-leaders', '/dashboard/department-head/people', async (page) => {
        await page.getByRole('tab', { name: 'Leaders' }).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
      });
      await visit(session, viewport, 'dean-organizations', '/dashboard/department-head/organizations');
      await visit(session, viewport, 'dean-applicant-modal', '/dashboard/department-head/organizations', async (page) => {
        await page.getByRole('button', { name: 'Allow a student to apply' }).first().click();
        await expect(page.getByRole('dialog', { name: 'Allow a student to apply' })).toBeVisible();
      });
      for (const tab of ['overview', 'people', 'events', 'finance', 'documents']) {
        await visit(session, viewport, `dean-org-space-${tab}`, `/dashboard/department-head/org/2?tab=${tab}`);
      }
      await visit(session, viewport, 'dean-org-space-give-access', '/dashboard/department-head/org/2?tab=people', async (page) => {
        await page.getByRole('button', { name: 'Give access' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('combobox', { name: 'Student' }).fill(fixtures.sent.firstName);
        await expect(dialog.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'dean-applications', '/dashboard/organization-applications');
      await visit(session, viewport, 'dean-application-review', `/dashboard/organization-applications?record=${fixtures.application.id}`, async (page) => {
        await expect(page.getByRole('main').getByRole('heading', { level: 1, name: fixtures.application.name })).toBeVisible({ timeout: 15_000 });
      });
      await visit(session, viewport, 'dean-records', '/dashboard/records');
      await session.context.close();
      expect(report.problems.slice(mark), report.problems.slice(mark).join('\n')).toEqual([]);
    });

    test('Student: apply for an organization and follow an application', async ({ browser }) => {
      const mark = report.problems.length;
      const applicant = await openContext(browser, viewport, fixtures.open);
      await visit(applicant, viewport, 'student-apply-form', '/dashboard/student/apply-organization', async (page) => {
        await expect(page.getByLabel('Organization name')).toBeVisible({ timeout: 15_000 });
      });
      await applicant.context.close();

      const sent = await openContext(browser, viewport, fixtures.sent);
      await visit(sent, viewport, 'student-my-application', `/dashboard/student/organization-applications/${fixtures.application.id}`, async (page) => {
        await expect(page.getByText('Your Department Head is reviewing it.')).toBeVisible({ timeout: 15_000 });
      });
      await visit(sent, viewport, 'student-apply-list', '/dashboard/student/apply-organization');
      await sent.context.close();
      expect(report.problems.slice(mark), report.problems.slice(mark).join('\n')).toEqual([]);
    });

    test('SAO: student records, colleges and its invite modal, applications, Records', async ({ browser }) => {
      const mark = report.problems.length;
      const session = await openContext(browser, viewport, SAO);
      await visit(session, viewport, 'sao-student-records', '/dashboard/super-admin/student-records');
      await visit(session, viewport, 'sao-colleges', '/dashboard/super-admin/colleges');
      await visit(session, viewport, 'sao-colleges-invite-modal', '/dashboard/super-admin/colleges', async (page) => {
        await page.getByRole('button', { name: 'Invite Department Head' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Invite Department Head' });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('College').selectOption({ index: 1 });
      });
      await visit(session, viewport, 'sao-applications', '/dashboard/organization-applications');
      await visit(session, viewport, 'sao-records', '/dashboard/records');
      await session.context.close();
      expect(report.problems.slice(mark), report.problems.slice(mark).join('\n')).toEqual([]);
    });
  });
}
