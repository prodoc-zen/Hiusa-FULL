import fs from 'node:fs';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { SHOTS, SAO, HEAD_CCS, HEAD_CBE, PSITS_ADMIN, STUDENT, apiUrl, bearer, apiLogin, collect, liveEnabled, newSink, pdfFile, shot, uiLogin, clickAndCaptureOpenedPdf, openRowMenu } from './support/live.js';

// Drives the SAO / college / organization hierarchy end to end in a real browser:
// semester setup, Department Head registration, SAO review (return, resubmit,
// approve), administrator provisioning, archive / restore, compliance tabs, the
// venue calendar, Department Head scoping and the delete controls.
//
// Set HIUSA_LIVE_E2E=1 to run it. It writes real rows to the dev database.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');
test.describe.configure({ mode: 'serial' });

const SUFFIX = process.env.HIUSA_E2E_SUFFIX || '';
const ORG_NAME = `Robotics Guild E2E${SUFFIX}`;
const ORG_ACRONYM = `ROBOE2E${SUFFIX}`;
const ADMIN_ID = Number(process.env.HIUSA_E2E_ADMIN_ID || 910091);
const ADMIN_PASSWORD = 'Demo@12345';
const FIRST_NAME = 'Robo';
const LAST_NAME = `Admin${SUFFIX}`;

const sink = newSink();
const contexts = {};
const state = { orgId: null };

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
      await page.getByRole('button', { name: 'Add semester' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/^Semester/).selectOption('1');
      await dialog.getByLabel(/Starts on/).fill('2026-08-03');
      await dialog.getByLabel(/Ends on/).fill('2026-12-18');
      await dialog.getByRole('button', { name: 'Add semester' }).click();
      await expect(page.getByText('Semester added').first()).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: 'Set as active' }).first().click();
    await expect(page.getByText('Academic semester activated').first()).toBeVisible({ timeout: 10000 });
  }
  await expect(page.getByText(/1st Semester/).first()).toBeVisible();
  await expect(page.locator('main')).toContainText(/active/i);
  void semesters;
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
  expect(buttonNames, 'colleges page controls').not.toMatch(/\b(new|add|create|edit|delete|remove)\b/i);
  const orgCounts = (await cards.allInnerTexts()).map((text) => text.match(/(\d+) organization/)?.[0]);
  console.log('COLLEGE ORG COUNTS', JSON.stringify(orgCounts));
  await page.screenshot({ path: shot('A2-colleges.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/organizations');
  await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 15000 });
  const orgControls = (await page.locator('main button, main a').allInnerTexts()).join(' | ');
  expect(orgControls, 'organizations page controls').not.toMatch(/(new|create|add) organization|register/i);
  await page.screenshot({ path: shot('A2-organizations.png'), fullPage: true });
});

test('Step 3: Department Head registers an organization with 10 PDFs', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(page, '/dashboard/department-head/organizations');
  await expect(page.getByRole('button', { name: 'Register an organization' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Register an organization' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('input[type=file]')).toHaveCount(10, { timeout: 15000 });
  await dialog.getByLabel(/^Organization name/).fill(ORG_NAME);
  await dialog.getByLabel(/^Acronym/).fill(ORG_ACRONYM);
  await dialog.getByLabel(/^Description/).fill('Builds and competes with small robots. Created by the end to end hierarchy spec.');
  await dialog.getByLabel(/^Color/).fill('#0B8ED0');

  const inputs = dialog.locator('input[type=file]');
  for (let index = 0; index < 9; index += 1) {
    await inputs.nth(index).setInputFiles(pdfFile(`doc-${index + 1}.pdf`, `Requirement ${index + 1}`));
  }
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  const missing = dialog.getByText('Attach a PDF for this requirement.');
  await expect(missing).toHaveCount(1);
  const lastField = inputs.nth(9).locator('xpath=ancestor::div[.//text()[contains(.,"Attach a PDF for this requirement.")]][1]');
  await expect(lastField).toContainText('Attach a PDF for this requirement.');
  await dialog.screenshot({ path: shot('A3-register-validation.png') });

  await inputs.nth(9).setInputFiles(pdfFile('doc-10.pdf', 'Requirement 10'));
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
  const row = page.getByRole('row', { name: new RegExp(ORG_ACRONYM) });
  await expect(row).toContainText('Pending review', { timeout: 15000 });
  await page.screenshot({ path: shot('A3-head-pending.png'), fullPage: true });
});

test('Step 4: SAO agency overview, review drawer, open document, return with remarks', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const { page, context } = await roleContext(browser, 'SAO', SAO);
  const session = await apiLogin(request, SAO);
  state.orgId = await lookupOrgId(request, session.token);
  expect(state.orgId, 'organization id for the new registration').toBeTruthy();

  await goto(page, '/dashboard/super-admin/agency');
  const ccs = page.getByRole('region', { name: /College of Computer Studies/ });
  await expect(ccs).toBeVisible({ timeout: 15000 });
  const agencyRow = ccs.getByRole('row', { name: new RegExp(ORG_ACRONYM) });
  await expect(agencyRow).toContainText(/Pending/i);
  await page.screenshot({ path: shot('A4-agency.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/organizations');
  await page.getByRole('tab', { name: /^Pending review/ }).click();
  await expect(page).toHaveURL(/status=pending/);
  await page.getByRole('button', { name: `Review ${ORG_NAME}` }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Review registration' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Open / })).toHaveCount(10, { timeout: 15000 });

  const opened = await clickAndCaptureOpenedPdf(page, context, () => drawer.getByRole('button', { name: /^Open / }).first().click());
  console.log('REVIEW OPEN', JSON.stringify(opened));
  expect(opened.apiStatus).toBe(200);
  expect(opened.apiType).toContain('application/pdf');
  expect(opened.reachedBlob).toBe(true);

  const reviewRequests = [];
  page.on('request', (req) => { if (/\/review$/.test(req.url()) && req.method() === 'PATCH') reviewRequests.push(req.url()); });
  await drawer.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(drawer.getByText('Add remarks explaining what the Department Head needs to fix.')).toBeVisible();
  expect(reviewRequests, 'Return with empty remarks must not call the API').toHaveLength(0);
  await drawer.screenshot({ path: shot('A4-return-empty-remarks.png') });

  await drawer.getByLabel(/Remarks/).fill('Missing charter signature');
  await drawer.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(page.getByText(/returned to its Department Head/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: /^Returned/ }).click();
  const card = page.locator('article').filter({ hasText: ORG_NAME });
  await expect(card).toContainText('Returned');
  await expect(card).toContainText('Missing charter signature');
  await page.screenshot({ path: shot('A4-returned-tab.png'), fullPage: true });
});

test('Step 5: Department Head sees Returned, edits and resubmits', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page } = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(page, '/dashboard/department-head/organizations');
  const row = page.getByRole('row', { name: new RegExp(ORG_ACRONYM) });
  await expect(row).toContainText('Returned', { timeout: 15000 });
  await expect(row).toContainText('SAO remarks: Missing charter signature');
  await row.getByRole('button', { name: 'Edit and resubmit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Missing charter signature');
  await expect(dialog.locator('input[type=file]')).toHaveCount(10);
  await dialog.locator('input[type=file]').first().setInputFiles(pdfFile('charter-signed.pdf', 'Signed charter'));
  await expect(dialog).toContainText('charter-signed.pdf');
  await dialog.screenshot({ path: shot('A5-resubmit-form.png') });
  await dialog.getByRole('button', { name: 'Resubmit to SAO' }).click();
  await expect(dialog).toBeHidden({ timeout: 30000 });
  await expect(page.getByRole('row', { name: new RegExp(ORG_ACRONYM) })).toContainText('Pending review', { timeout: 15000 });
});

test('Step 6: SAO approves and provisions an Administrator', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/organizations?status=pending');
  await page.getByRole('button', { name: `Review ${ORG_NAME}` }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Review registration' });
  await expect(drawer.getByRole('button', { name: /^Open / })).toHaveCount(10, { timeout: 15000 });
  await expect(drawer).toContainText('charter-signed.pdf');
  await drawer.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/approved and activated/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: /^Active/ }).click();
  await expect(page.locator('article').filter({ hasText: ORG_NAME })).toContainText('Active', { timeout: 15000 });

  await goto(page, '/dashboard/super-admin/admins');
  await page.getByRole('button', { name: 'New Admin User' }).click();
  const form = page.getByRole('dialog', { name: /Create administrator/ });
  await form.getByLabel(/School ID/).fill(String(ADMIN_ID));
  await form.getByLabel(/First name/).fill(FIRST_NAME);
  await form.getByLabel(/Last name/).fill(LAST_NAME);
  await form.getByLabel(/Email address/).fill(`robo.admin${ADMIN_ID}@hiusa.local`);
  await form.getByLabel(/Position title/).fill('President');
  await form.getByLabel(/Assigned organization/).selectOption({ label: `${ORG_ACRONYM}: ${ORG_NAME}` });
  await form.getByLabel(/^Password \*/).fill(ADMIN_PASSWORD);
  await form.getByLabel(/Confirm password/).fill(ADMIN_PASSWORD);
  await form.getByRole('button', { name: 'Create Admin User' }).click();
  await expect(form).toBeHidden({ timeout: 20000 });
  await expect(page.getByText(String(ADMIN_ID)).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: shot('A6-admins.png'), fullPage: true });
  void request;
});

test('Step 7: new Administrator logs in through the UI', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  collect(page, 'NEW_ADMIN', sink);
  await uiLogin(page, { schoolId: ADMIN_ID, password: ADMIN_PASSWORD });
  await expect(page).toHaveURL(/\/dashboard\/admin/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/403|forbidden/i);
  await page.screenshot({ path: shot('A7-new-admin-dashboard.png'), fullPage: true });
  await page.getByRole('button', { name: /^Logout/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log Out' }).click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
  await context.close();
});

test('Step 8: archive, read-only views, login refusal, restore, overview', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  await goto(page, '/dashboard/super-admin/organizations?status=active');
  const card = page.locator('article').filter({ hasText: ORG_NAME });
  await expect(card).toBeVisible({ timeout: 15000 });
  await openRowMenu(page, card);
  await page.getByRole('menuitem', { name: 'Archive organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive organization' });
  await dialog.getByLabel(/Reason/).fill('Semester wrap up from the e2e run');
  await dialog.getByRole('button', { name: 'Archive organization' }).click();
  await expect(page.getByText(/archived\./)).toBeVisible({ timeout: 15000 });

  await page.getByRole('tab', { name: /^Archived/ }).click();
  await expect(page.getByRole('note')).toContainText('read-only');
  const archived = page.locator('article').filter({ hasText: ORG_NAME });
  await expect(archived).toBeVisible();
  await expect(archived.getByRole('button', { name: `Restore ${ORG_NAME}` })).toBeVisible();
  await expect(archived.getByRole('button', { name: /^Actions for|Edit|Review|Archive/ })).toHaveCount(0);
  await page.screenshot({ path: shot('A8-archived-tab.png'), fullPage: true });

  // New Admin login now fails with a clear message
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  collect(adminPage, 'NEW_ADMIN_ARCHIVED', sink);
  await adminPage.goto('/login');
  await adminPage.getByLabel(/School ID/i).fill(String(ADMIN_ID));
  await adminPage.getByLabel(/^Password/i).fill(ADMIN_PASSWORD);
  await adminPage.getByRole('button', { name: /^Sign in/ }).click();
  const alert = adminPage.getByRole('alert').first();
  await expect(alert).toBeVisible({ timeout: 15000 });
  console.log('ARCHIVED LOGIN MESSAGE:', (await alert.innerText()).trim());
  await expect(adminPage).toHaveURL(/\/login/);
  await adminPage.screenshot({ path: shot('A8-archived-login.png') });
  await adminContext.close();

  // Department Head still sees it as Archived (read only)
  const head = await roleContext(browser, 'HEAD_CCS', HEAD_CCS);
  await goto(head.page, '/dashboard/department-head/organizations');
  const headRow = head.page.getByRole('row', { name: new RegExp(ORG_ACRONYM) });
  await expect(headRow).toContainText('Archived', { timeout: 15000 });
  await expect(headRow).toContainText('Read only');
  await expect(headRow.getByRole('button')).toHaveCount(0);
  await head.page.screenshot({ path: shot('A8-head-archived.png'), fullPage: true });

  // Restore
  await archived.getByRole('button', { name: `Restore ${ORG_NAME}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore organization' }).click();
  await expect(page.getByText(/restored\./)).toBeVisible({ timeout: 15000 });

  const again = await apiLogin(request, { schoolId: ADMIN_ID, password: ADMIN_PASSWORD });
  expect(again.status, 'restored Admin can authenticate').toBe(200);
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await uiLogin(loginPage, { schoolId: ADMIN_ID, password: ADMIN_PASSWORD });
  await expect(loginPage).toHaveURL(/\/dashboard\/admin/);
  await loginContext.close();

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
  const expected = [
    ['Accreditation', 'accreditation'],
    ['Requirements', 'requirements'],
    ['Review queue', 'review'],
    ['Event requirements', 'events'],
    ['Financial reports', 'financial'],
    ['Track documents', 'documents'],
  ];
  const errorsBefore = sink.console.length + sink.pageErrors.length;
  for (const [label, key] of expected) {
    await page.getByRole('tab', { name: new RegExp('^' + label + '( [(][0-9]+[)])?$') }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${key}`));
    const panel = page.getByRole('tabpanel');
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
  const orgSelect = page.getByLabel('Organization', { exact: true });
  await expect(orgSelect.locator('option', { hasText: ORG_ACRONYM })).toHaveCount(1, { timeout: 15000 });
  await orgSelect.selectOption({ value: await orgSelect.locator('option', { hasText: ORG_ACRONYM }).getAttribute('value') });
  const openButtons = page.getByRole('tabpanel').getByRole('button', { name: /^Open / });
  await expect(openButtons.first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => openButtons.count(), { timeout: 20000, message: 'Track documents rows for the selected organization' }).toBe(10);
  const count = await openButtons.count();
  console.log('TRACK DOCUMENTS rows for the new organization:', count);
  expect(count).toBe(10);
  const opened = await clickAndCaptureOpenedPdf(page, context, () => openButtons.first().click());
  console.log('TRACK OPEN', JSON.stringify(opened));
  expect(opened.apiStatus).toBe(200);
  expect(opened.reachedBlob).toBe(true);
  await page.screenshot({ path: shot('A9-track-documents.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/compliance?tab=requirements');
  await expect(page.getByRole('tabpanel')).toContainText(/Semestral Accomplishment Report/i, { timeout: 15000 });
});

test('Step 10: SAO venues booking calendar', async ({ browser }) => {
  test.setTimeout(90_000);
  const { page } = await roleContext(browser, 'SAO', SAO);
  const before = sink.console.length + sink.pageErrors.length;
  await goto(page, '/dashboard/super-admin/venues');
  await page.getByRole('tab', { name: /Booking requests/ }).click();
  await expect(page.getByLabel('Venue to show')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
  const header = page.locator('main');
  const initial = await header.innerText();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect.poll(async () => (await header.innerText()) !== initial, { timeout: 8000 }).toBe(true);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
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
  await expect(page.locator('main')).toContainText(/[1-9][0-9]* matching requests?/);
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
  expect(headRows.every((row) => [1, state.orgId].includes(row.organization_id))).toBe(true);
  const cbeAuthEarly = await apiLogin(request, HEAD_CBE);
  const cbeApprovals = await (await request.get(`${apiUrl}/approval-requests`, { headers: bearer(cbeAuthEarly.token), params: { per_page: 100 } })).json();
  console.log('HEAD CBE approvals rows', (cbeApprovals.data || cbeApprovals).length);
  expect((cbeApprovals.data || cbeApprovals).filter((row) => row.organization_id === 1)).toHaveLength(0);
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
  const admin = await apiLogin(request, PSITS_ADMIN);
  const create = await request.post(`${apiUrl}/users`, {
    headers: bearer(admin.token),
    data: { school_id: 987654, first_name: 'Bad', last_name: 'Head', email: 'bad.head@hiusa.local', role: 'DEPARTMENT_HEAD', password: 'Demo@12345', password_confirmation: 'Demo@12345' },
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

test('Step 12b: another college head cannot edit this college organization', async ({ request }) => {
  const cbe = await apiLogin(request, HEAD_CBE);
  const sao = await apiLogin(request, SAO);
  const id = state.orgId || await lookupOrgId(request, sao.token);
  const update = await request.put(`${apiUrl}/college/organizations/${id}`, { headers: bearer(cbe.token), multipart: { name: 'Hijacked', acronym: 'HIJACK' } });
  console.log('CBE head PUT /college/organizations/{CCS org} ->', update.status());
  expect([403, 404]).toContain(update.status());
  const psits = await request.put(`${apiUrl}/college/organizations/1`, { headers: bearer(cbe.token), multipart: { name: 'Hijacked', acronym: 'HIJACK' } });
  console.log('CBE head PUT /college/organizations/1 ->', psits.status());
  expect([403, 404]).toContain(psits.status());
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
  const eventRows = page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Actions for / }) });
  await expect(eventRows.first()).toBeVisible({ timeout: 15000 });
  await openRowMenu(page, eventRows.first());
  await expect(page.getByRole('menuitem', { name: 'Delete event' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete event' }).click();
  const cancelDialog = page.getByRole('dialog', { name: 'Delete this event?' });
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelDialog).toBeHidden();
  if (eventResponse.status() === 201 || eventResponse.status() === 200) {
    const throwaway = page.getByRole('row').filter({ hasText: eventTitle });
    await expect(throwaway).toBeVisible({ timeout: 15000 });
    await openRowMenu(page, throwaway);
    await page.getByRole('menuitem', { name: 'Delete event' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this event?' });
    await expect(dialog).toContainText(eventTitle);
    await dialog.getByRole('button', { name: 'Delete event' }).click();
    await expect(page.getByText(`"${eventTitle}" deleted.`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('row').filter({ hasText: eventTitle })).toHaveCount(0);
  }
  await page.screenshot({ path: shot('A13-admin-events.png'), fullPage: true });

  await goto(page, '/dashboard/finance/budget-allocation');
  await page.waitForLoadState('networkidle');
  const deleteBudgetButtons = page.getByRole('button', { name: 'Delete budget' });
  await expect(deleteBudgetButtons.first()).toBeVisible({ timeout: 15000 });
  console.log('BUDGET DELETE BUTTONS', await deleteBudgetButtons.count());
  await deleteBudgetButtons.first().click();
  const budgetCancel = page.getByRole('dialog', { name: 'Delete this budget?' });
  await expect(budgetCancel).toBeVisible();
  await budgetCancel.getByRole('button', { name: 'Cancel' }).click();
  await expect(budgetCancel).toBeHidden();
  if (budgetResponse.status() === 201 || budgetResponse.status() === 200) {
    await page.reload();
    await page.waitForLoadState('networkidle');
    const card = page.locator('div').filter({ hasText: budgetTitle }).filter({ has: page.getByRole('button', { name: 'Delete budget' }) }).last();
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.getByRole('button', { name: 'Delete budget' }).click();
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
  const { page } = await roleContext(browser, 'SAO', SAO);

  await goto(page, '/dashboard/super-admin/academic-years');
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
  await expect(page.getByRole('button', { name: /^Delete 2nd semester/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Remove 2026-2027/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Delete 2nd semester/ }).click();
  const semesterDialog = page.getByRole('dialog', { name: 'Delete semester' });
  await expect(semesterDialog).toBeVisible();
  await semesterDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(semesterDialog).toBeHidden();
  await page.screenshot({ path: shot('A13-sao-academic-years.png'), fullPage: true });
  await page.getByRole('button', { name: /^Delete 2nd semester/ }).click();
  await page.getByRole('dialog', { name: 'Delete semester' }).getByRole('button', { name: 'Delete semester' }).click();
  await expect(page.getByText('Semester removed').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /^Delete 2nd semester/ })).toHaveCount(0);

  await goto(page, '/dashboard/super-admin/announcements');
  const draftTitle = `E2E throwaway notice ${Date.now()}`;
  await page.getByRole('button', { name: /Create official notice/ }).click();
  const form = page.getByRole('dialog', { name: /Create official announcement/ });
  await form.getByLabel('Title').fill(draftTitle);
  await form.locator('#official-announcement').fill('Draft body for the delete control check.');
  await form.getByRole('button', { name: 'Save draft' }).click();
  await expect(form).toBeHidden({ timeout: 15000 });
  const draft = page.locator('article').filter({ hasText: draftTitle });
  await expect(draft).toContainText('DRAFT', { timeout: 15000 });
  await expect(draft.getByRole('button', { name: /Delete draft/ })).toBeVisible();
  const published = page.locator('article').filter({ hasText: 'PUBLISHED' });
  const publishedCount = await published.count();
  console.log('GLOBAL ANNOUNCEMENTS published', publishedCount);
  for (let index = 0; index < publishedCount; index += 1) {
    await expect(published.nth(index).getByRole('button', { name: /Delete draft/ })).toHaveCount(0);
  }
  await draft.getByRole('button', { name: /Delete draft/ }).click();
  const draftDialog = page.getByRole('dialog', { name: 'Delete this draft?' });
  await expect(draftDialog).toBeVisible();
  await draftDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(draftDialog).toBeHidden();
  await draft.getByRole('button', { name: /Delete draft/ }).click();
  await page.getByRole('dialog', { name: 'Delete this draft?' }).getByRole('button', { name: 'Delete draft' }).click();
  await expect(page.getByText('Draft deleted.').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('article').filter({ hasText: draftTitle })).toHaveCount(0);
  await page.screenshot({ path: shot('A13-sao-announcements.png'), fullPage: true });

  await goto(page, '/dashboard/super-admin/clearances');
  await page.waitForLoadState('networkidle');
  const periodDeletes = page.getByRole('button', { name: /^Delete / });
  await expect(periodDeletes.first()).toBeVisible({ timeout: 15000 });
  console.log('CLEARANCE delete buttons', await periodDeletes.count());
  await periodDeletes.first().click();
  const periodDialog = page.getByRole('dialog', { name: 'Delete this clearance period?' });
  await expect(periodDialog).toBeVisible();
  await periodDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(periodDialog).toBeHidden();
  await page.screenshot({ path: shot('A13-sao-clearances.png'), fullPage: true });
});
