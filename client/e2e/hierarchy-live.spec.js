import fs from 'node:fs';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { newStudent, randomPassword } from './support/pipeline.js';
import { acceptEveryRequirement, applicationLink, flagRequirement } from './support/review.js';
import { SHOTS, PSITS_ORGANIZATION_ID, SAO, HEAD_CCS, HEAD_CBE, PSITS_ADMIN, STUDENT, apiUrl, bearer, apiLogin, collect, liveEnabled, newSink, apiAs, pdfFile, shot, uiLogin, clickAndCaptureOpenedPdf, openRowMenu } from './support/live.js';

// Drives the SAO / college / organization hierarchy end to end in a real browser:
// semester setup, a student the dean allowed to apply, the dean's and the SAO's review
// (return, resend, endorse, approve), the applicant becoming the organization head,
// archive / restore, compliance tabs, the venue calendar, Department Head scoping and
// the delete controls.
//
// Set HIUSA_LIVE_E2E=1 to run it. It writes real rows to the dev database.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');
test.describe.configure({ mode: 'serial' });

const SUFFIX = process.env.HIUSA_E2E_SUFFIX || '';
const ORG_NAME = `Robotics Guild E2E${SUFFIX}`;
const ORG_ACRONYM = `ROBOE2E${SUFFIX}`;

const sink = newSink();
const contexts = {};
const state = { orgId: null, applicant: null, applicationUrl: null };

async function roleContext(browser, role, account) {
  if (contexts[role]) return contexts[role];
  const context = await browser.newContext();
  const page = await context.newPage();
  collect(page, role, sink);
  await uiLogin(page, account);
  contexts[role] = { context, page };
  return contexts[role];
}

async function goto(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 15000 });
}

async function lookupOrgId(request, token) {
  const response = await request.get(`${apiUrl}/system/organizations`, { headers: bearer(token), params: { search: ORG_ACRONYM, per_page: 50 } });
  const body = await response.json();
  const found = (body.data || []).find((item) => item.acronym === ORG_ACRONYM);
  return found?.id ?? null;
}

test.afterAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(`${SHOTS}\\..\\hierarchy-collected.json`, JSON.stringify(sink, null, 2));
  await Promise.all(Object.values(contexts).map(({ context }) => context.close().catch(() => {})));
});

test('Step 1: SAO sets up and activates an academic semester', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/academic-years');
  await expect(page.getByText(/is the current year|No academic year set/)).toBeVisible({ timeout: 15000 });

  if (await page.getByText('No academic year set').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Add academic year' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Starts on/).fill('2026-08-03');
    await dialog.getByLabel(/Ends on/).fill('2027-05-28');
    await dialog.getByLabel(/^Label/).fill('2026-2027');
    await dialog.getByRole('button', { name: 'Add academic year' }).click();
    await expect(page.getByText('2026-2027 is the current year')).toBeVisible();
  }
  await expect(page.getByText(/2026-2027 is the current year/)).toBeVisible();

  const semesters = page.getByRole('heading', { name: 'Semesters' }).locator('xpath=ancestor::*[self::section or self::div][1]');
  const alreadyActive = await page.getByText(/1st Semester.*active/i).first().isVisible().catch(() => false);
  if (!alreadyActive) {
    if (!(await page.getByText('1st Semester').first().isVisible().catch(() => false))) {
      const addBtn = page.getByRole('button', { name: 'Add semester' });
      if (await addBtn.first().isVisible().catch(() => false)) {
        await addBtn.first().click();
      } else {
        await page.getByRole('button', { name: /Actions for Semesters of/i }).first().click();
        await page.getByRole('menuitem', { name: 'Add semester' }).click();
      }
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/^Semester/).selectOption('1');
      await dialog.getByLabel(/Starts on/).fill('2026-08-03');
      await dialog.getByLabel(/Ends on/).fill('2026-12-18');
      await dialog.getByRole('button', { name: 'Add semester' }).click();
      await expect(page.getByText('Semester added').first()).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: /Activate 1st semester of AY 2026-2027/ }).click();
    // Activate asks first (AcademicYearsPage ConfirmModal); the dialog's button carries the same name.
    await page.getByRole('dialog', { name: 'Activate semester' }).getByRole('button', { name: 'Activate semester' }).click();
    await expect(page.getByText('Academic semester activated').first()).toBeVisible({ timeout: 10000 });
  }
  await expect(page.getByText(/1st semester/i).first()).toBeVisible();
  await expect(page.locator('main')).toContainText(/active/i);
  void semesters;
  // Ensure the 10 organization requirements are active and have sample formats so registration is open for Department Head.
  const { token } = await apiLogin(page.request, SAO);
  const legacyReqs = await page.request.get(`${apiUrl}/compliance/requirement-types`, {
    headers: bearer(token),
    params: { per_page: 100, academic_year: '2026-2027' },
  });
  const legacyList = (await legacyReqs.json()).data || [];
  for (const type of legacyList) {
    if (!type.academic_semester_id && type.is_active) {
      await page.request.put(`${apiUrl}/compliance/requirement-types/${type.id}`, {
        headers: bearer(token),
        data: { is_active: false },
      });
    }
  }

  const reqListRes = await page.request.get(`${apiUrl}/compliance/requirement-types`, {
    headers: bearer(token),
    params: { per_page: 100, category: 'organization', academic_year: '2026-2027' },
  });
  const reqList = (await reqListRes.json()).data || [];
  for (const type of reqList) {
    if (type.academic_semester_id) {
      const res = await page.request.put(`${apiUrl}/compliance/requirement-types/${type.id}`, {
        headers: bearer(token),
        data: { is_active: true, template_url: 'https://example.edu/format.pdf' },
      });
      expect(res.ok(), `activate requirement ${type.name}: ${await res.text()}`).toBe(true);
    }
  }
  await page.screenshot({ path: shot('A1-academic-years.png'), fullPage: true });
});

test('Step 2: SAO Colleges and Organizations have no create controls', async ({ browser }) => {
  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/colleges');
  await expect(page.getByRole('heading', { name: /College of Computer Studies/ }).first()).toBeVisible({ timeout: 15000 });
  const cards = page.locator('main article');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('main')).toContainText(/organization/i);
  const buttonNames = (await page.locator('main button, main a').allInnerTexts()).join(' | ');
  expect(buttonNames, 'colleges page controls').not.toMatch(/(new|create|add) organization|register/i);
  const orgCounts = (await cards.allInnerTexts()).map((text) => text.match(/(\d+) organization/)?.[0]);
  console.log('COLLEGE ORG COUNTS', JSON.stringify(orgCounts));
  await page.screenshot({ path: shot('A2-colleges.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/organizations');
  await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 15000 });
  const orgControls = (await page.locator('main button, main a').allInnerTexts()).join(' | ');
  expect(orgControls, 'organizations page controls').not.toMatch(/(new|create|add) organization|register/i);
  await page.screenshot({ path: shot('A2-organizations.png'), fullPage: true });
});


test('Step 3: Department Head allows a student to apply, the student sends the 10 requirements', async ({ browser }) => {
  test.setTimeout(150_000);
  state.applicant = await newStudent('Robo');
  const { page } = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(page, '/dashboard/department-head/organizations');
  await page.getByRole('button', { name: 'Allow a student to apply' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Allow a student to apply' });
  await modal.getByRole('combobox', { name: 'Student' }).fill(state.applicant.firstName);
  await modal.getByRole('option', { name: new RegExp(state.applicant.name) }).click();
  await modal.getByRole('button', { name: 'Allow to apply' }).click();
  await expect(modal).toBeHidden({ timeout: 15000 });
  await expect(page.getByText(state.applicant.name).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: shot('A3-head-allowed.png'), fullPage: true });

  const student = await roleContext(browser, 'APPLICANT', state.applicant);
  await goto(student.page, '/dashboard/student/apply-organization');
  const form = student.page.getByRole('main');
  await expect(form.locator('input[type=file]')).toHaveCount(10, { timeout: 15000 });
  await form.getByLabel(/^Organization name/).fill(ORG_NAME);
  await form.getByLabel(/^Acronym/).fill(ORG_ACRONYM);
  await form.getByLabel(/^Your position/).fill('President');
  await form.getByLabel(/^What the organization is for/).fill('Builds and competes with small robots. Created by the end to end hierarchy spec.');
  const inputs = form.locator('input[type=file]');
  for (let index = 0; index < 10; index += 1) {
    await inputs.nth(index).setInputFiles(pdfFile(`doc-${index + 1}.pdf`, `Requirement ${index + 1}`));
  }
  await form.getByRole('button', { name: 'Send application' }).click();
  await expect(student.page.getByText('Your Department Head is reviewing it.')).toBeVisible({ timeout: 60000 });
  state.applicationUrl = student.page.url();
  await student.page.screenshot({ path: shot('A3-applicant-sent.png'), fullPage: true });
});

test('Step 4: Department Head opens a file, marks a requirement and returns the application', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(page, '/dashboard/organization-applications');
  await applicationLink(page, ORG_NAME).click();
  const review = page.getByRole('main');
  await expect(review.getByRole('button', { name: /^doc-\d+\.pdf$/ })).toHaveCount(10, { timeout: 15000 });

  const opened = await clickAndCaptureOpenedPdf(page, context, () => review.getByRole('button', { name: /^doc-\d+\.pdf$/ }).first().click());
  console.log('REVIEW OPEN', JSON.stringify(opened));
  expect(opened.apiStatus).toBe(200);
  expect(opened.apiType).toContain('application/pdf');
  expect(opened.reachedBlob).toBe(true);

  // Returning needs a reason: nothing is sent while there is no note and no marked requirement.
  await expect(review.getByRole('button', { name: 'Return with comments' })).toBeDisabled();
  await flagRequirement(page, 'doc-1.pdf', 'Missing charter signature');
  await expect(review.getByRole('button', { name: 'Endorse', exact: true })).toBeDisabled();
  await review.screenshot({ path: shot('A4-marked-requirement.png') });
  await review.getByRole('button', { name: 'Return with comments' }).click();
  await expect(review.getByRole('region', { name: 'Summary' })).toContainText('Returned to the applicant.', { timeout: 15000 });
  await review.getByRole('link', { name: 'Back to applications' }).click();
  await page.getByRole('tab', { name: /^Returned/ }).click();
  await expect(page.locator('tbody tr, ul[data-view="cards"] > li').filter({ hasText: ORG_NAME }).first()).toContainText('Returned');
  await page.screenshot({ path: shot('A4-returned-tab.png'), fullPage: true });
});

test('Step 5: the student reads the note and sends the application again', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await roleContext(browser, 'APPLICANT', state.applicant);
  await goto(page, state.applicationUrl);
  await expect(page.getByText('Missing charter signature').first()).toBeVisible({ timeout: 15000 });
  const fix = page.getByRole('main').locator('form');
  await fix.locator('input[type=file]').first().setInputFiles(pdfFile('charter-signed.pdf', 'Signed charter'));
  await page.screenshot({ path: shot('A5-resubmit-form.png'), fullPage: true });
  await fix.getByRole('button', { name: 'Send again' }).click();
  await expect(page.getByText('Your Department Head is reviewing it.')).toBeVisible({ timeout: 30000 });
});

test('Step 6: Department Head endorses, the SAO approves and the student becomes the head of the new organization', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const head = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(head.page, '/dashboard/organization-applications');
  await applicationLink(head.page, ORG_NAME).click();
  const endorse = head.page.getByRole('main');
  await expect(endorse).toContainText('charter-signed.pdf', { timeout: 15000 });
  await acceptEveryRequirement(head.page);
  await endorse.getByRole('button', { name: 'Endorse', exact: true }).click();
  await expect(endorse.getByRole('region', { name: 'Summary' })).toContainText('With the SAO for a decision', { timeout: 15000 });

  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/organization-applications');
  await applicationLink(page, ORG_NAME).click();
  const decision = page.getByRole('main');
  await expect(decision.getByRole('button', { name: /^doc-\d+\.pdf$|^charter-signed\.pdf$/ })).toHaveCount(10, { timeout: 15000 });
  await expect(decision).toContainText('charter-signed.pdf');
  await acceptEveryRequirement(page);
  await decision.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(decision.getByRole('region', { name: 'Summary' })).toContainText('Approved. The organization now exists.', { timeout: 15000 });

  await goto(page, '/dashboard/super-admin/organizations?status=active');
  await expect(page.getByRole('tabpanel', { name: 'Active' }).locator('tbody tr, ul[data-view="cards"] > li').filter({ hasText: ORG_NAME }).first()).toBeVisible({ timeout: 15000 });
  state.orgId = await lookupOrgId(request, (await apiLogin(request, SAO)).token);
  expect(state.orgId, 'the approved application created the organization').toBeTruthy();
  await page.screenshot({ path: shot('A6-org-active.png'), fullPage: true });
});

test('Step 7: the student keeps their own account and holds the organization head profile', async ({ browser }) => {
  test.setTimeout(90_000);
  const { page } = await roleContext(browser, 'APPLICANT', state.applicant);
  await goto(page, state.applicationUrl);
  await expect(page.getByText(new RegExp(`You are now President of ${ORG_NAME}`))).toBeVisible({ timeout: 15000 });
  const me = await apiAs(state.applicant);
  const profiles = await me.get('/user/profiles');
  const list = profiles.body.profiles;
  const held = list.find((profile) => Number(profile.organization_id ?? profile.organization?.id) === state.orgId);
  expect(held, 'a profile on the new organization').toBeTruthy();
  expect(held.role).toBe('ADMIN');
  expect(list.some((profile) => profile.role === 'STUDENT'), 'the student profile is still there').toBe(true);
  await page.screenshot({ path: shot('A7-applicant-approved.png'), fullPage: true });
});

test('Step 8: archive, read-only views, lock-out, restore, overview', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/organizations?status=active');
  const card = page.locator('tbody tr').filter({ hasText: ORG_NAME });
  await expect(async () => {
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
    }
    await expect(card).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 25000, intervals: [1000, 2000] });

  await expect(async () => {
    if (!await page.getByText(/archived\./).isVisible()) {
      const dialog = page.getByRole('dialog', { name: 'Archive organization' });
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: 'Archive organization' }).click();
      } else {
        await openRowMenu(page, card);
        await page.getByRole('menuitem', { name: 'Archive organization' }).click();
        const dlg = page.getByRole('dialog', { name: 'Archive organization' });
        await dlg.getByLabel(/Reason/).fill('Semester wrap up from the e2e run');
        await dlg.getByRole('button', { name: 'Archive organization' }).click();
      }
    }
    await expect(page.getByText(/archived\./)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000, intervals: [1000, 2000] });

  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(page.getByRole('note')).toContainText('read-only');
  const archived = page.locator('tbody tr').filter({ hasText: ORG_NAME });
  await expect(async () => {
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
    }
    await expect(archived).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 20000, intervals: [1000, 2000] });
  await openRowMenu(page, archived);
  await expect(page.getByRole('menuitem', { name: 'Restore organization' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Edit|Archive|Review/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({ path: shot('A8-archived-tab.png'), fullPage: true });

  // The student still signs in with their own account, but the archived organization no longer opens as a workspace.
  const me = await apiAs(state.applicant);
  const profiles = await me.get('/user/profiles');
  const held = profiles.body.profiles.find((profile) => Number(profile.organization_id ?? profile.organization?.id) === state.orgId);
  const locked = await me.post(`/user/profiles/${held.id}/switch`);
  console.log('ARCHIVED ORG SWITCH ->', locked.status, JSON.stringify(locked.body).slice(0, 160));
  expect(locked.ok, 'an archived organization cannot be entered').toBe(false);

  // Department Head still sees it as Archived (read only)
  const head = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(head.page, '/dashboard/department-head/organizations');
  const headRow = head.page.getByRole('row', { name: new RegExp(ORG_ACRONYM) });
  await expect(headRow).toContainText('Archived', { timeout: 15000 });
  await expect(headRow).toContainText('Read only');
  // Read only: the one control left is the checklist view, nothing that edits, resubmits or restores.
  await expect(headRow.getByRole('button')).toHaveText('View checklist');
  await expect(headRow.getByRole('button', { name: /^(Edit|Resubmit|Archive|Restore|Delete)/ })).toHaveCount(0);
  await head.page.screenshot({ path: shot('A8-head-archived.png'), fullPage: true });

  // Restore
  await openRowMenu(page, archived);
  await page.getByRole('menuitem', { name: 'Restore organization' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore organization' }).click();
  await expect(page.getByText(/restored\./)).toBeVisible({ timeout: 15000 });

  const again = await me.post(`/user/profiles/${held.id}/switch`);
  expect(again.ok, 'the restored organization opens again').toBe(true);

  // Organization overview
  if (!state.orgId) state.orgId = await lookupOrgId(request, (await apiLogin(request, SAO)).token);
  await goto(page, `/dashboard/super-admin/organizations/${state.orgId}`);
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(ORG_NAME) })).toBeVisible({ timeout: 15000 });
  for (const section of ['Leadership', 'Members by role', 'Events', 'Approved budgets']) {
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  }
  await expect(page.locator('body')).not.toContainText(/unavailable|something went wrong/i);
  await page.screenshot({ path: shot('A8-org-overview.png'), fullPage: true });
});

test('Step 9: Compliance tabs, redirects and Track documents', async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/compliance');
  // [tab, tab inside it (or null), the ?tab= value the page ends on]
  const expected = [
    ['Organizations', 'Organization accreditation', 'accreditation'],
    ['Organizations', 'Review submissions', 'review'],
    ['Event reviews', null, 'event-reviews'],
    ['Semestral and financial report', null, 'financial'],
    ['Requirement settings', 'Organization requirements', 'requirements'],
    ['Requirement settings', 'Event requirements', 'events'],
  ];
  const errorsBefore = sink.console.length + sink.pageErrors.length;
  for (const [group, inner, key] of expected) {
    await page.getByRole('tab', { name: group, exact: true }).click();
    if (inner) await page.getByRole('tab', { name: new RegExp('^' + inner + '( [(][0-9]+[)])?$') }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}`));
    const panel = page.getByRole('tabpanel').last();
    await expect(panel).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect.poll(async () => (await panel.innerText()).trim().length, { timeout: 15000 }).toBeGreaterThan(20);
    await expect(panel).not.toContainText(/Skeleton|something went wrong/i);
    await page.screenshot({ path: shot(`A9-compliance-${key}.png`), fullPage: true });
    if (key === 'requirements') console.log('REQUIREMENTS TAB TEXT:', (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 600));
  }
  expect(sink.console.length + sink.pageErrors.length, 'console errors while clicking the Compliance tabs').toBe(errorsBefore);

  await goto(page, '/dashboard/super-admin/financial-reports');
  await expect(page).toHaveURL(/\/compliance\?tab=financial/);
  await goto(page, '/dashboard/super-admin/event-requirements');
  await expect(page).toHaveURL(/\/compliance\?tab=events/);

  await goto(page, '/dashboard/super-admin/compliance?tab=documents');
  await expect(page).toHaveURL(/\/dashboard\/super-admin\/documents/);
  const searchInput = page.getByPlaceholder(/Name or acronym/i);
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill(ORG_NAME);
  }
  const folder = page.getByRole('button', { name: new RegExp(ORG_NAME) });
  await expect(folder).toBeVisible({ timeout: 20000 });
  await expect(folder).toContainText('10 files', { timeout: 15000 });
  await folder.click();

  const fileRows = page.locator('tbody tr');
  await expect(fileRows.first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => fileRows.count(), { timeout: 20000, message: 'Track documents rows for the selected organization' }).toBe(10);
  const count = await fileRows.count();
  console.log('TRACK DOCUMENTS rows for the new organization:', count);
  expect(count).toBe(10);

  const opened = await clickAndCaptureOpenedPdf(page, context, async () => {
    await openRowMenu(page, fileRows.first());
    await page.getByRole('menuitem', { name: 'View file' }).click();
  });
  console.log('TRACK OPEN', JSON.stringify(opened));
  expect(opened.apiStatus).toBe(200);
  expect(opened.reachedBlob).toBe(true);
  await page.screenshot({ path: shot('A9-track-documents.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/compliance?tab=semestral-requirements');
  await expect(page.getByRole('tabpanel').last()).toContainText(/Accomplishment Report/i, { timeout: 15000 });
});

test('Step 10: SAO venues booking calendar', async ({ browser }) => {
  test.setTimeout(90_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  const before = sink.console.length + sink.pageErrors.length;
  await goto(page, '/dashboard/super-admin/venues');
  await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Booking requests/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Venue catalog' })).toBeVisible();
  await expect(page.getByLabel('Venue to show')).toBeVisible({ timeout: 15000 });
  const previous = page.getByRole('button', { name: /^Previous (day|week|month)$/ });
  const next = page.getByRole('button', { name: /^Next (day|week|month)$/ });
  await expect(previous).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(next).toBeVisible();
  const header = page.locator('main');
  const initial = await header.innerText();
  await next.click();
  await expect.poll(async () => (await header.innerText()) !== initial, { timeout: 8000 }).toBe(true);
  await previous.click();
  await previous.click();
  await page.getByRole('button', { name: 'Today' }).click();
  const options = await page.getByLabel('Venue to show').locator('option').count();
  console.log('VENUE OPTIONS', options);
  if (options > 1) await page.getByLabel('Venue to show').selectOption({ index: 1 });
  await page.screenshot({ path: shot('A10-venues-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('A10-venues-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow on 390px venues calendar').toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(sink.console.length + sink.pageErrors.length, 'console errors on venues page').toBe(before);
});

test('Step 11: Department Head scope', async ({ browser, request }) => {
  test.setTimeout(150_000);
  if (!state.orgId) state.orgId = await lookupOrgId(request, (await apiLogin(request, SAO)).token);
  const { page } = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(page, '/dashboard/department-head/approvals');
  await expect(page.getByLabel('Organization', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => page.getByLabel('Organization', { exact: true }).locator('option').count(), { timeout: 15000 }).toBeGreaterThan(1);
  await expect(page.locator('main')).toContainText(/Pending [(][1-9][0-9]*[)]/);
  await page.waitForLoadState('networkidle');
  const options = (await page.getByLabel('Organization', { exact: true }).locator('option').allInnerTexts()).map((text) => text.trim());
  console.log('HEAD CCS approvals org filter options', JSON.stringify(options));
  expect(options.join(' ')).not.toMatch(/Junior Philippine|Future Educators|Nursing Student|Engineering Innovators/);
  expect(options.join(' ')).toMatch(/Philippine Society of Information Technology/);
  const headAuth = await apiLogin(request, HEAD_CCS);
  const headApprovals = await request.get(`${apiUrl}/approval-requests`, { headers: bearer(headAuth.token), params: { per_page: 100 } });
  const headBody = await headApprovals.json();
  const headRows = headBody.data || headBody;
  console.log('HEAD CCS approvals rows', headRows.length, JSON.stringify([...new Set(headRows.map((row) => row.organization_id))]));
  expect(headRows.length).toBeGreaterThan(0);
  expect(headRows.every((row) => [PSITS_ORGANIZATION_ID, state.orgId].includes(row.organization_id))).toBe(true);
  const cbeAuthEarly = await apiLogin(request, HEAD_CBE);
  const cbeApprovals = await (await request.get(`${apiUrl}/approval-requests`, { headers: bearer(cbeAuthEarly.token), params: { per_page: 100 } })).json();
  console.log('HEAD CBE approvals rows', (cbeApprovals.data || cbeApprovals).length);
  expect((cbeApprovals.data || cbeApprovals).filter((row) => row.organization_id === PSITS_ORGANIZATION_ID)).toHaveLength(0);
  const bodyText = await page.locator('main').innerText();
  expect(bodyText).not.toMatch(/JPIA-CBE|FES-CTE|NSC-CHS|EIG-COE/);
  await page.screenshot({ path: shot('A11-head-approvals.png'), fullPage: true });

  const nav = (await page.getByRole('navigation').first().innerText()).replace(/\s+/g, ' ');
  console.log('HEAD SIDEBAR:', nav);
  expect(nav).not.toMatch(/Cast Vote|Merchandise/i);

  await page.goto('/dashboard/elections/cast-vote', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  console.log('HEAD cast-vote ->', new URL(page.url()).pathname);
  await expect(page.getByRole('heading', { name: /cast.*vote|ballot/i })).toHaveCount(0);
  await page.goto('/dashboard/merchandise/my-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  console.log('HEAD my-orders ->', new URL(page.url()).pathname);
  await expect(page.getByRole('heading', { name: /my orders|order merchandise/i })).toHaveCount(0);
  expect(new URL(page.url()).pathname).not.toBe('/dashboard/merchandise/my-orders');

  // CBE head never sees CCS org data
  const cbe = await apiLogin(request, HEAD_CBE);
  const list = await request.get(`${apiUrl}/college/organizations`, { headers: bearer(cbe.token), params: { per_page: 100 } });
  const body = JSON.stringify(await list.json());
  console.log('CBE /college/organizations', list.status());
  expect(list.status()).toBe(200);
  expect(body).not.toContain(ORG_ACRONYM);
  expect(body).not.toContain('PSITS-CCS');
  const cbeCtx = await roleContext(browser, 'HEAD_CBE', HEAD_CBE);
  await goto(cbeCtx.page, '/dashboard/department-head/organizations');
  await expect(cbeCtx.page.getByText('JPIA-CBE').first()).toBeVisible({ timeout: 15000 });
  await expect(cbeCtx.page.locator('main')).not.toContainText(ORG_ACRONYM);
  await expect(cbeCtx.page.locator('main')).not.toContainText('PSITS-CCS');
  await goto(cbeCtx.page, '/dashboard/department-head/approvals');
  await cbeCtx.page.waitForLoadState('networkidle');
  await expect(cbeCtx.page.locator('main')).not.toContainText(/PSITS-CCS|ROBOE2E/);
  const directFetch = await request.get(`${apiUrl}/system/organizations/${state.orgId}/overview`, { headers: bearer(cbe.token) });
  console.log('CBE head GET system overview of the new org ->', directFetch.status());
  expect([401, 403, 404]).toContain(directFetch.status());
  const orgsRead = await request.get(`${apiUrl}/organizations/${state.orgId}`, { headers: bearer(cbe.token) });
  console.log('CBE head GET /organizations/{new} ->', orgsRead.status());
  await cbeCtx.page.screenshot({ path: shot('A11-cbe-organizations.png'), fullPage: true });
});

test('Step 12: security spot checks', async ({ request }) => {
  // Sign-ins are throttled per address; apiLogin waits out a 429, which can outlast the 30s default.
  test.setTimeout(90_000);
  const admin = await apiLogin(request, PSITS_ADMIN);
  const dhPassword = randomPassword();
  const create = await request.post(`${apiUrl}/users`, {
    headers: bearer(admin.token),
    data: { school_id: 987654, first_name: 'Bad', last_name: 'Head', email: 'bad.head@hiusa.local', role: 'DEPARTMENT_HEAD', password: dhPassword, password_confirmation: dhPassword },
  });
  console.log('ADMIN POST /users role=DEPARTMENT_HEAD ->', create.status(), (await create.text()).slice(0, 200));
  expect(create.status()).toBe(422);

  const student = await apiLogin(request, STUDENT);
  const agency = await request.get(`${apiUrl}/system/agency`, { headers: bearer(student.token) });
  console.log('STUDENT GET /system/agency ->', agency.status());
  expect(agency.status()).toBe(403);

  const anon = await request.get(`${apiUrl}/financial-reports/1/documents/0`, { headers: { Accept: 'application/json' } });
  console.log('ANON GET /financial-reports/1/documents/0 ->', anon.status());
  expect(anon.status()).toBe(401);

  // the allowed direction still works
  const sao = await apiLogin(request, SAO);
  const ok = await request.get(`${apiUrl}/system/agency`, { headers: bearer(sao.token) });
  expect(ok.status()).toBe(200);
});

test('Step 12b: another college head cannot reach this college application or organization', async ({ request }) => {
  test.setTimeout(90_000);
  const cbe = await apiLogin(request, HEAD_CBE);
  const sao = await apiLogin(request, SAO);
  const id = state.orgId || await lookupOrgId(request, sao.token);
  const space = await request.get(`${apiUrl}/college/organizations/${id}/space`, { headers: bearer(cbe.token) });
  console.log('CBE head GET org space of a CCS organization ->', space.status());
  expect([403, 404]).toContain(space.status());
  const psits = await request.get(`${apiUrl}/college/organizations/${PSITS_ORGANIZATION_ID}/space`, { headers: bearer(cbe.token) });
  console.log('CBE head GET org space of PSITS ->', psits.status());
  expect([403, 404]).toContain(psits.status());
  const queue = await request.get(`${apiUrl}/organization-applications`, { headers: bearer(cbe.token), params: { per_page: 100 } });
  expect(queue.status()).toBe(200);
  expect(JSON.stringify(await queue.json())).not.toContain(ORG_NAME);
  const grant = await request.post(`${apiUrl}/college/applicant-grants`, { headers: bearer(cbe.token), data: { school_id: state.applicant.schoolId } });
  console.log('CBE head grant to a CCS student ->', grant.status());
  expect([404, 422]).toContain(grant.status());
});

test('Step 13a: Admin delete controls on Events, Finance budgets and Tasks', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const { page } = await roleContext(browser, 'PSITS_ADMIN', PSITS_ADMIN);
  const admin = await apiLogin(request, PSITS_ADMIN);
  const stamp = Date.now();
  const eventTitle = `E2E throwaway event ${stamp}`;
  const budgetTitle = `E2E throwaway budget ${stamp}`;

  const eventResponse = await request.post(`${apiUrl}/events`, {
    headers: bearer(admin.token),
    data: { title: eventTitle, description: 'throwaway', start_time: '2026-11-20T09:00:00', end_time: '2026-11-20T11:00:00', location: 'E2E hall', planning_details: { venue_type: 'off_campus' } },
  });
  console.log('THROWAWAY EVENT create ->', eventResponse.status(), (await eventResponse.text()).slice(0, 160));
  const budgetResponse = await request.post(`${apiUrl}/budgets`, { headers: bearer(admin.token), data: { title: budgetTitle, allocated_amount: 100, warning_threshold: 50 } });
  console.log('THROWAWAY BUDGET create ->', budgetResponse.status());

  await goto(page, '/dashboard/events/manage-events');
  await page.waitForLoadState('networkidle');
  expect([200, 201], 'the throwaway event is created').toContain(eventResponse.status());
  const throwaway = page.getByRole('row').filter({ hasText: eventTitle });
  await expect(throwaway).toBeVisible({ timeout: 15000 });
  await openRowMenu(page, throwaway);
  await expect(page.getByRole('menuitem', { name: 'Delete event' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Cancel event' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Delete event' }).click();
  const cancelDialog = page.getByRole('dialog', { name: 'Delete this event?' });
  await expect(cancelDialog).toContainText(eventTitle);
  await cancelDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelDialog).toBeHidden();
  await openRowMenu(page, throwaway);
  await page.getByRole('menuitem', { name: 'Delete event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this event?' });
  await dialog.getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByText(`"${eventTitle}" deleted.`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('row').filter({ hasText: eventTitle })).toHaveCount(0);

  const venues = await (await request.get(`${apiUrl}/venues`, { headers: bearer(admin.token) })).json();
  const venue = (venues.data || []).find((item) => item.is_active !== false);
  expect(venue, 'a seeded active venue to book').toBeTruthy();
  const heldTitle = `E2E held-venue event ${stamp}`;
  const heldResponse = await request.post(`${apiUrl}/events`, {
    headers: bearer(admin.token),
    data: { title: heldTitle, description: 'throwaway', start_time: '2026-11-21T09:00:00', end_time: '2026-11-21T11:00:00', location: venue.name, planning_details: { venue_type: 'on_campus', venue_id: venue.id } },
  });
  expect([200, 201], 'the held-venue event is created').toContain(heldResponse.status());
  const held = await heldResponse.json();
  const bookingResponse = await request.post(`${apiUrl}/venue-bookings`, {
    headers: bearer(admin.token),
    data: { venue_id: venue.id, event_id: held.id, start_time: '2026-11-21T09:00:00+08:00', end_time: '2026-11-21T11:00:00+08:00' },
  });
  expect(bookingResponse.status(), 'the venue booking for the held-venue event').toBe(201);
  const booking = await bookingResponse.json();

  await goto(page, '/dashboard/events/manage-events');
  await page.waitForLoadState('networkidle');
  const heldRow = page.getByRole('row').filter({ hasText: heldTitle });
  await expect(heldRow).toBeVisible({ timeout: 15000 });
  await openRowMenu(page, heldRow);
  await expect(page.getByRole('menuitem', { name: 'Delete event' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Cancel event' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Cancel event' }).click();
  const heldDialog = page.getByRole('dialog', { name: 'Cancel this event?' });
  await expect(heldDialog).toContainText(heldTitle);
  await heldDialog.getByRole('button', { name: 'Cancel event' }).click();
  await expect(heldDialog).toBeHidden({ timeout: 15000 });
  const bookings = await (await request.get(`${apiUrl}/venue-bookings`, { headers: bearer(admin.token), params: { venue_id: venue.id, per_page: 100 } })).json();
  expect((bookings.data || []).find((item) => item.id === booking.id)?.status, 'cancelling the event releases its venue booking').toBe('withdrawn');
  // The list reloads after the cancellation; open the row menu only once the row has settled on its new status.
  await expect(heldRow).toContainText(/cancelled/i, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await openRowMenu(page, heldRow);
  await page.getByRole('menuitem', { name: 'Delete event' }).click();
  await page.getByRole('dialog', { name: 'Delete this event?' }).getByRole('button', { name: 'Delete event' }).click();
  await expect(page.getByText(`"${heldTitle}" deleted.`)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: shot('A13-admin-events.png'), fullPage: true });

  await goto(page, '/dashboard/finance/budget-allocation');
  await page.waitForLoadState('networkidle');
  // The budget list is cards, so the row menu is found by its own label (the app title-cases the name).
  const budgetActions = page.getByRole('button', { name: new RegExp(`^Actions for ${budgetTitle}$`, 'i') });
  const openBudgetMenu = async () => {
    await budgetActions.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await budgetActions.click();
    await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 });
  };
  await expect(budgetActions).toBeVisible({ timeout: 15000 });
  await openBudgetMenu();
  await page.getByRole('menuitem', { name: 'Delete budget' }).click();
  const budgetCancel = page.getByRole('dialog', { name: 'Delete this budget?' });
  await expect(budgetCancel).toBeVisible();
  await budgetCancel.getByRole('button', { name: 'Cancel' }).click();
  await expect(budgetCancel).toBeHidden();
  if (budgetResponse.status() === 201 || budgetResponse.status() === 200) {
    await openBudgetMenu();
    await page.getByRole('menuitem', { name: 'Delete budget' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this budget?' });
    await expect(dialog).toContainText(budgetTitle);
    await dialog.getByRole('button', { name: /^Delete budget$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(budgetTitle)).toHaveCount(0, { timeout: 15000 });
  }
  await page.screenshot({ path: shot('A13-admin-budgets.png'), fullPage: true });

  const taskTitle = `E2E throwaway task ${stamp}`;
  const taskResponse = await request.post(`${apiUrl}/tasks`, { headers: bearer(admin.token), data: { title: taskTitle, deadline: '2026-11-30', status: 'pending', assigned_to: 900005, task_kind: 'standalone', category: 'documentation', priority: 'low' } });
  console.log('THROWAWAY TASK create ->', taskResponse.status(), (await taskResponse.text()).slice(0, 160));
  expect([200, 201]).toContain(taskResponse.status());
  await goto(page, '/dashboard/tasks/task-board');
  await page.waitForLoadState('networkidle');
  const taskCard = page.locator('article:visible, tr:visible').filter({ hasText: taskTitle }).first();
  await expect(taskCard).toBeVisible({ timeout: 15000 });
  const inlineDelete = taskCard.getByRole('button', { name: /^Delete$/ });
  if (await inlineDelete.count()) {
    await inlineDelete.first().click();
  } else {
    await openRowMenu(page, taskCard);
    await page.getByRole('menuitem', { name: 'Delete task' }).click();
  }
  const taskDialog = page.getByRole('dialog', { name: 'Delete this task?' });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog).toContainText(taskTitle);
  await taskDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(taskDialog).toBeHidden();
  if (await inlineDelete.count()) {
    await inlineDelete.first().click();
  } else {
    await openRowMenu(page, taskCard);
    await page.getByRole('menuitem', { name: 'Delete task' }).click();
  }
  await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: /^Delete/ }).last().click();
  await expect(page.getByText(`"${taskTitle}" deleted.`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(taskTitle)).toHaveCount(0);
  await page.screenshot({ path: shot('A13-admin-tasks.png'), fullPage: true });
});

test('Step 13b: SAO delete controls (semesters, drafts, clearance periods)', async ({ browser }) => {
  test.setTimeout(240_000);
  let { page } = await roleContext(browser, 'SAO', SAO);

  await goto(page, '/dashboard/super-admin/academic-years');
  if (!page.url().includes('/dashboard/super-admin')) {
    const context = await browser.newContext();
    page = await context.newPage();
    collect(page, 'SAO', sink);
    await uiLogin(page, SAO);
    contexts['SAO'] = { context, page };
    await goto(page, '/dashboard/super-admin/academic-years');
  }
  await expect(page.getByText(/1st Semester/).first()).toBeVisible({ timeout: 15000 });
  if (!(await page.getByText('2nd Semester').first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Add semester' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Semester/).selectOption('2');
    await dialog.getByLabel(/Starts on/).fill('2027-01-11');
    await dialog.getByLabel(/Ends on/).fill('2027-05-28');
    await dialog.getByRole('button', { name: 'Add semester' }).click();
    await expect(page.getByText('Semester added').first()).toBeVisible({ timeout: 10000 });
  }

  await expect(page.getByRole('button', { name: /^Delete 1st semester/ })).toHaveCount(0);
  const sem1Row = page.locator('div').filter({ hasText: '1st Semester' }).filter({ has: page.getByRole('button', { name: /^Actions for / }) }).last();
  if (await sem1Row.isVisible().catch(() => false)) {
    await openRowMenu(page, sem1Row);
    await expect(page.getByRole('menuitem', { name: /Delete 1st semester/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  await expect(page.getByRole('button', { name: /^Remove 2026-2027/ })).toHaveCount(0);
  const yearRow = page.getByRole('row').filter({ hasText: '2026-2027' }).first();
  if (await yearRow.isVisible().catch(() => false)) {
    await openRowMenu(page, yearRow);
    await expect(page.getByRole('menuitem', { name: /Remove 2026-2027/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  const sem2Row = page.locator('div').filter({ hasText: '2nd Semester' }).filter({ has: page.getByRole('button', { name: /^Actions for / }) }).last();
  await expect(sem2Row).toBeVisible({ timeout: 15000 });
  const inlineSem2Delete = sem2Row.getByRole('button', { name: /^Delete 2nd semester/ });
  if (await inlineSem2Delete.count()) {
    await inlineSem2Delete.first().click();
  } else {
    await openRowMenu(page, sem2Row);
    const deleteSem2 = page.getByRole('menuitem', { name: /Delete 2nd semester/i });
    await expect(deleteSem2).toBeVisible();
    await deleteSem2.click();
  }

  const semesterDialog = page.getByRole('dialog', { name: 'Delete semester' });
  await expect(semesterDialog).toBeVisible();
  await semesterDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(semesterDialog).toBeHidden();
  await page.screenshot({ path: shot('A13-sao-academic-years.png'), fullPage: true });

  if (await inlineSem2Delete.count()) {
    await inlineSem2Delete.first().click();
  } else {
    await openRowMenu(page, sem2Row);
    await page.getByRole('menuitem', { name: /Delete 2nd semester/i }).click();
  }
  await page.getByRole('dialog', { name: 'Delete semester' }).getByRole('button', { name: 'Delete semester' }).click();
  await expect(page.getByText('Semester removed').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /^Delete 2nd semester/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Actions for 2nd semester/i })).toHaveCount(0);

  await goto(page, '/dashboard/super-admin/announcements');
  const draftTitle = `E2E throwaway notice ${Date.now()}`;
  await page.getByRole('button', { name: /Create official notice/ }).click();
  const form = page.getByRole('dialog', { name: /Create official announcement/ });
  await form.getByLabel('Title').fill(draftTitle);
  await form.locator('textarea, #official-announcement').fill('Draft body for the delete control check.');
  await form.getByRole('button', { name: 'Save draft' }).click();
  await expect(form).toBeHidden({ timeout: 15000 });

  const draft = page.locator('section, article').filter({ hasText: draftTitle }).first();
  await expect(draft).toBeVisible({ timeout: 15000 });
  await expect(draft).toContainText(/Draft/i, { timeout: 15000 });

  const inlineDraftDelete = draft.getByRole('button', { name: /^Delete draft/ });
  if (await inlineDraftDelete.count()) {
    await inlineDraftDelete.first().click();
  } else {
    await openRowMenu(page, draft);
    await expect(page.getByRole('menuitem', { name: /Delete draft/i })).toBeVisible();
    await page.keyboard.press('Escape');
  }

  const published = page.locator('section, article').filter({ hasText: /Published/i });
  const publishedCount = await published.count();
  console.log('GLOBAL ANNOUNCEMENTS published', publishedCount);
  for (let index = 0; index < publishedCount; index += 1) {
    const pubCard = published.nth(index);
    await expect(pubCard.getByRole('button', { name: /^Delete draft/ })).toHaveCount(0);
    if (await pubCard.getByRole('button', { name: /^Actions for / }).isVisible().catch(() => false)) {
      await openRowMenu(page, pubCard);
      await expect(page.getByRole('menuitem', { name: /Delete draft/i })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  }

  if (await inlineDraftDelete.count()) {
    await inlineDraftDelete.first().click();
  } else {
    await openRowMenu(page, draft);
    await page.getByRole('menuitem', { name: /Delete draft/i }).click();
  }
  const draftDialog = page.getByRole('dialog', { name: 'Delete this draft?' });
  await expect(draftDialog).toBeVisible();
  await draftDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(draftDialog).toBeHidden();

  if (await inlineDraftDelete.count()) {
    await inlineDraftDelete.first().click();
  } else {
    await openRowMenu(page, draft);
    await page.getByRole('menuitem', { name: /Delete draft/i }).click();
  }
  await page.getByRole('dialog', { name: 'Delete this draft?' }).getByRole('button', { name: 'Delete draft' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this draft?' })).toBeHidden({ timeout: 15000 });
  await expect(page.locator('section, article').filter({ hasText: draftTitle })).toHaveCount(0, { timeout: 15000 });
  await page.screenshot({ path: shot('A13-sao-announcements.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/clearances');
  await page.waitForLoadState('networkidle');
  const periodCard = page.locator('section, article, div').filter({ has: page.getByRole('button', { name: /^Actions for / }) }).first();
  await expect(periodCard).toBeVisible({ timeout: 15000 });
  const inlinePeriodDelete = periodCard.getByRole('button', { name: /^Delete / });
  if (await inlinePeriodDelete.count()) {
    await inlinePeriodDelete.first().click();
  } else {
    await openRowMenu(page, periodCard);
    await page.getByRole('menuitem', { name: /Delete period/i }).click();
  }
  const periodDialog = page.getByRole('dialog', { name: 'Delete this clearance period?' });
  await expect(periodDialog).toBeVisible();
  await periodDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(periodDialog).toBeHidden();
  await page.screenshot({ path: shot('A13-sao-clearances.png'), fullPage: true });
});
