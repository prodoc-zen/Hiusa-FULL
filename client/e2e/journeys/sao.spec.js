import { expect, test } from '@playwright/test';
import { SAO, PSITS_ADMIN, HEAD_CCS, STUDENT, apiAs, liveEnabled, pdfFile, shot, uiLogin } from '../support/live.js';
import { allowToApply, endorse, ensureOpenSemester, newStudent, submitApplication, uniqueAcronym, uniqueName } from '../support/pipeline.js';
import { acceptEveryRequirement, applicationLink } from '../support/review.js';

// UX_FLOW section 9, SUPER_ADMIN journeys. Every journey starts at the SAO home after a real sign-in,
// counts mouse and tap actions only (typing is free), and ends on an assertion about what is visible.
// Each runs at 1440 and 390 px. Prerequisites that belong to other roles are seeded through the API.
//
// Set HIUSA_LIVE_E2E=1 to run it against a freshly seeded local Laravel API.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

const RUN = Array.from({ length: 5 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
let seedCounter = 0;
const nextSeed = () => { seedCounter += 1; return `${RUN}${String.fromCharCode(96 + seedCounter)}`; };

// The data tables render a table for wide screens and cards for narrow ones; only the one on screen counts.
const onScreen = (locator) => locator.filter({ visible: true }).first();

// A row of views is tabs from 640 px and one select below it (ResponsiveTabs).
async function chooseView(page, name, selectLabel) {
  const tab = page.getByRole('tab', { name });
  if (await tab.first().isVisible()) {
    await tab.first().click();
    return;
  }
  const select = page.getByRole('combobox', { name: selectLabel });
  const option = select.locator('option').filter({ hasText: name }).first();
  await select.selectOption({ label: (await option.innerText()).trim() });
}

// A confirmation modal is found by its heading, because a drawer behind it can repeat the same words.
const modalTitled = (page, title) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A mouse or tap action is one call to tap(); typing, filling and waiting never go through it.
function tracker() {
  const state = { clicks: 0 };
  return {
    tap: async (locator, options) => { state.clicks += 1; await locator.click(options); },
    get clicks() { return state.clicks; },
  };
}

async function signInAsSao(page) {
  await uiLogin(page, SAO);
  await expect(page.getByText('Review inbox').first()).toBeVisible({ timeout: 20000 });
}

// The sidebar is always rendered; below the desktop breakpoint it sits off canvas behind "Open menu".
// Opening it is chrome, not a step, so that tap is not counted (docs/UX_FLOW.md section 9, Counting rules).
async function chooseFromMenu(page, tap, width, groupLabel, leafLabel) {
  if (width < 768) await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.locator('aside, nav, [role="navigation"]').first();
  const group = groupLabel instanceof RegExp ? { name: groupLabel } : { name: groupLabel, exact: true };
  const leaf = leafLabel instanceof RegExp ? { name: leafLabel } : { name: leafLabel, exact: true };
  await tap(nav.getByRole('button', group));
  await tap(nav.getByRole('link', leaf));
}

// Reports sideways scroll and anything that pokes out of the viewport, so a narrow-screen problem is
// written down even when the journey itself passes. It informs the report and never fails a journey.
async function layoutNotes(page, label) {
  const notes = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = window.innerWidth;
    const scrollsSideways = doc.scrollWidth > viewport + 1;
    const insideScroller = (element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const { overflowX } = getComputedStyle(node);
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };
    const clipped = [];
    for (const element of document.querySelectorAll('main *, [role="dialog"] *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= viewport + 1) continue;
      if (insideScroller(element)) continue;
      clipped.push(`${element.tagName.toLowerCase()}:${(element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 40)} right=${Math.round(box.right)}`);
      if (clipped.length >= 5) break;
    }
    return { scrollsSideways, scrollWidth: doc.scrollWidth, viewport, clipped };
  });
  console.log(`LAYOUT ${label} ${JSON.stringify(notes)}`);
  return notes;
}

// Taken at the journey's own end state, before any follow-up check navigates away from it.
async function endState(page, width, journeyId) {
  await layoutNotes(page, `${journeyId} ${width}`);
  if (width === 390) await page.screenshot({ path: shot(`${journeyId}-390.png`), fullPage: true });
}

function finish(info, width, journeyId, ceiling, clicks) {
  console.log(`JOURNEY ${journeyId} width=${width} clicks=${clicks} ceiling=${ceiling}`);
  info.annotations.push({ type: 'clicks', description: `${clicks} of ${ceiling}` });
}

// ---------------------------------------------------------------- seeding through the API

// A student of the college applies and the Department Head endorses, so the application waits for the SAO.
async function seedEndorsedApplication() {
  const student = await newStudent('Sao');
  await allowToApply(student);
  const application = await submitApplication(student, { name: uniqueName('Journey Club'), acronym: uniqueAcronym('JC') });
  await endorse(application);
  return application;
}


// The organization Admin generates a financial report and files it, the Department Head clears the first
// stage, so it reaches the SAO as a request waiting for the final approval.
async function fileFinancialReport(seed) {
  const admin = await apiAs(PSITS_ADMIN);
  const head = await apiAs(HEAD_CCS);
  const offset = 1 + (Date.now() % 300);
  const end = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
  const generated = await admin.post('/financial-reports/generate', {
    report_type: 'custom',
    period_start: '2026-01-01',
    period_end: end,
    signatories: { treasurer: `Treasurer ${seed}`, president: 'President', adviser: 'Adviser', sbo_adviser: 'SBO Adviser' },
  });
  expect(generated.status, `report generated: ${JSON.stringify(generated.body).slice(0, 300)}`).toBe(201);
  const report = generated.body.report;
  const submitted = await admin.post(`/financial-reports/${report.id}/submit`);
  expect(submitted.status, `report submitted: ${JSON.stringify(submitted.body).slice(0, 300)}`).toBe(200);
  const pending = await head.get(`/approval-requests?entity_type=financial_report&status=pending&per_page=100`);
  const request = (pending.body.data || []).find((item) => Number(item.entity_id) === Number(report.id));
  expect(request, 'the Department Head sees the report request').toBeTruthy();
  const cleared = await head.patch(`/approval-requests/${request.id}`, { status: 'approved' });
  expect(cleared.status, `first stage cleared: ${JSON.stringify(cleared.body).slice(0, 300)}`).toBe(200);
  return { id: report.id, title: report.title };
}

// The organization Admin files one more requirement the SAO has not seen yet.
async function fileComplianceSubmission() {
  const admin = await apiAs(PSITS_ADMIN);
  const status = await admin.get('/compliance/status');
  const organization = [status.body.organizations].flat()[0];
  const requirement = organization.requirements.find((item) => item.status === 'not_submitted') || organization.requirements.find((item) => item.status === 'returned');
  expect(requirement, 'the organization still has a requirement to file').toBeTruthy();
  const file = pdfFile(`${requirement.requirement_name}.pdf`, requirement.requirement_name);
  const form = new FormData();
  form.append('requirement_type_id', String(requirement.requirement_type_id));
  form.append('document', new Blob([file.buffer], { type: file.mimeType }), file.name);
  const filed = await admin.post('/compliance/submissions', form);
  expect(filed.status, `requirement filed: ${JSON.stringify(filed.body).slice(0, 300)}`).toBeLessThan(300);
  return { organizationId: organization.organization_id, organizationName: organization.organization_name, requirementName: requirement.requirement_name };
}

async function fileGrievance(seed) {
  const student = await apiAs(STUDENT);
  const title = `Journey grievance ${seed}`;
  const filed = await student.post('/grievances', {
    title,
    description: 'The study area near the library has had no working lights for a week.',
    addressed_to: 'sao',
    is_anonymous: false,
  });
  expect(filed.status, `grievance filed: ${JSON.stringify(filed.body).slice(0, 300)}`).toBe(201);
  return { id: filed.body.id, title };
}

async function signedInContext(browser, account, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await uiLogin(page, account);
  return { context, page };
}

test.beforeAll(async () => {
  await ensureOpenSemester();
});

for (const { width, height } of WIDTHS) {
  test.describe(`SAO journeys at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test.describe.configure({ timeout: 240_000 });
    test.use({ actionTimeout: 20_000 });

    test('1. Approve an application (ceiling 4)', async ({ page, browser }, info) => {
      const ceiling = 4;
      const application = await seedEndorsedApplication();
      const namePattern = new RegExp(escapeRegExp(application.name), 'i');
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await chooseFromMenu(page, tap, width, 'Governance', 'Applications');
        await tap(applicationLink(page, application.name));
        const review = page.getByRole('main');
        await expect(review.getByRole('heading', { level: 1, name: application.name })).toBeVisible({ timeout: 20000 });
        await acceptEveryRequirement(page);
        await expect(review.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled({ timeout: 20000 });

        await tap(review.getByRole('button', { name: 'Approve', exact: true }));
        clicks = counter.clicks;

        await expect(review.getByRole('region', { name: 'Summary' })).toContainText('Approved. The organization now exists.', { timeout: 20000 });
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j1');

        // The organization exists and is active, with no password or administrator account to set up.
        await page.goto('/dashboard/super-admin/organizations?status=active');
        const activeCard = onScreen(page.getByRole('tabpanel', { name: 'Active' }).locator('tr, article, li').filter({ hasText: namePattern }));
        await expect(activeCard).toBeVisible({ timeout: 20000 });

        // The applicant is told, and the Department Head sees the organization in the college.
        const applicant = await signedInContext(browser, application.student, width, height);
        await applicant.page.goto(`/dashboard/student/organization-applications/${application.id}`);
        await expect(applicant.page.getByText(new RegExp(`Approved\\. You are now President of ${escapeRegExp(application.name)}`))).toBeVisible({ timeout: 20000 });
        await applicant.context.close();

        const head = await signedInContext(browser, HEAD_CCS, width, height);
        await head.page.goto('/dashboard/department-head/organizations');
        await head.page.getByRole('tab', { name: /^Active/ }).click();
        const headRow = onScreen(head.page.getByRole('tabpanel', { name: 'Active organizations' }).locator('article, tr, li').filter({ hasText: namePattern }));
        await expect(headRow).toBeVisible({ timeout: 20000 });
        await head.context.close();
      } finally {
        finish(info, width, 'sao-j1', ceiling, clicks || counter.clicks);
      }
    });


    test('2. Review compliance (ceiling 4)', async ({ page }, info) => {
      const ceiling = 4;
      const target = await fileComplianceSubmission();
      const { organizationName, requirementName } = target;
      const sao = await apiAs(SAO);
      const before = await sao.get('/compliance/status');
      const orgRow = before.body.organizations.find((item) => Number(item.organization_id) === Number(target.organizationId));
      const approvedBefore = orgRow.requirements.filter((item) => item.status === 'approved').length;
      const totalRequirements = orgRow.requirements.length;
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await tap(page.getByRole('link', { name: /compliance submissions awaiting review/i }));
        const panel = page.getByRole('tabpanel', { name: /Review (submissions|queue)/i });
        await expect(panel).toBeVisible({ timeout: 20000 });
        const orgFolder = panel.locator('tr, article, li').filter({ hasText: organizationName }).getByRole('button').first();
        await orgFolder.waitFor({ state: 'visible', timeout: 10000 }).then(() => orgFolder.click()).catch(() => {});
        const queueRow = onScreen(panel.locator('tr, article, li').filter({ hasText: requirementName }));
        await expect(queueRow).toBeVisible({ timeout: 20000 });

        await tap(queueRow.getByRole('button', { name: organizationName, exact: true }));
        const drawer = page.getByRole('dialog', { name: requirementName });
        await expect(drawer).toBeVisible();

        await tap(drawer.getByRole('button', { name: 'Approve' }));
        await tap(modalTitled(page, 'Approve this submission?').getByRole('button', { name: 'Approve' }));
        clicks = counter.clicks;

        await expect(drawer.getByText(/Approved/).first()).toBeVisible({ timeout: 20000 });
        await expect(drawer.getByRole('button', { name: 'Approve' })).toHaveCount(0);
        await expect(page.getByText(/^Approved ".*" for /).first()).toBeVisible();
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j2');

        // The accreditation roll up moved with the decision.
        await drawer.getByRole('button', { name: 'Close panel' }).click();
        await chooseView(page, /Accreditation/i, 'Organizations view');
        const accreditationRow = onScreen(page.locator('tr, article, li').filter({ hasText: organizationName }));
        await expect(accreditationRow).toContainText(`${approvedBefore + 1}/${totalRequirements}`, { timeout: 20000 });
      } finally {
        finish(info, width, 'sao-j2', ceiling, clicks || counter.clicks);
      }
    });

    test('3. Decide a financial report (ceiling 4)', async ({ page, browser }, info) => {
      const ceiling = 4;
      const seed = nextSeed();
      const report = await fileFinancialReport(seed);
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await tap(page.getByRole('link', { name: /financial reports to approve/i }));
        const panel = page.getByRole('tabpanel', { name: /Financial Report/i });
        await expect(panel).toBeVisible({ timeout: 20000 });
        const orgFolder = panel.locator('tr, article, li').filter({ hasText: /PSITS|Information Technology Students/i }).getByRole('button').first();
        await orgFolder.waitFor({ state: 'visible', timeout: 10000 }).then(() => orgFolder.click()).catch(() => {});
        const reportRow = onScreen(panel.locator('tr, article, li').filter({ hasText: report.title }));
        await expect(reportRow).toBeVisible({ timeout: 20000 });

        await tap(reportRow.getByRole('button', { name: /^Review / }));
        const detail = page.getByRole('dialog');
        await expect(detail.getByRole('button', { name: /Approve/ })).toBeVisible({ timeout: 20000 });

        await tap(detail.getByRole('button', { name: /Approve/ }));
        await tap(modalTitled(page, 'Approve financial report').getByRole('button', { name: 'Approve report' }));
        clicks = counter.clicks;

        await expect(page.getByText('Financial report approved.')).toBeVisible({ timeout: 20000 });
        // An organization with reports waiting opens on those reports, so the decided one leaves the list;
        // the Approved filter shows it with its decision. Filtering is a look, not a step of the journey.
        await expect(reportRow).toHaveCount(0, { timeout: 20000 });
        await page.getByRole('combobox', { name: 'Report status' }).selectOption('approved');
        await expect(reportRow).toContainText(/approved/i, { timeout: 20000 });
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j3');

        // The submitting organization sees the same decision.
        const admin = await signedInContext(browser, PSITS_ADMIN, width, height);
        await admin.page.goto('/dashboard/finance/transaction-history');
        const adminCard = admin.page.getByRole('list', { name: 'Saved reports' }).getByRole('listitem').filter({ hasText: report.title });
        await expect(adminCard).toContainText(/approved/i, { timeout: 60000 });
        await admin.context.close();
      } finally {
        finish(info, width, 'sao-j3', ceiling, clicks || counter.clicks);
      }
    });

    test('4. See the colleges and who leads them (ceiling 2)', async ({ page }, info) => {
      const ceiling = 2;
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await chooseFromMenu(page, tap, width, 'Governance', 'Colleges');
        clicks = counter.clicks;

        // The seeded list starts with five colleges. The SAO adds a college from the one primary button; deleting is a row action.
        const sections = page.locator('article[aria-labelledby^="college-"]');
        await expect(sections.first()).toBeVisible({ timeout: 20000 });
        await expect(sections).toHaveCount(5);
        await expect(page.getByRole('button', { name: 'Add college', exact: true })).toHaveCount(1);

        // Each college says who leads it, or offers the one way to get a leader: a link.
        const ccs = sections.filter({ hasText: 'College of Computer Studies' });
        await expect(ccs).toContainText('Ramon Castillo');
        if (width >= 768) {
          for (const section of await sections.all()) {
            await expect(section.getByText(/^Department Head$/)).toBeVisible();
            if (await section.getByText('No Department Head yet').count()) {
              await expect(section.getByRole('button', { name: 'Invite Department Head' })).toBeVisible();
            }
          }
        } else {
          // On a phone the Department Head sits in the college drawer, one tap from the card, not inline.
          for (const section of await sections.all()) {
            await section.getByRole('heading', { level: 2 }).getByRole('button').click();
            const drawer = page.getByRole('dialog');
            await expect(drawer.getByText(/^Department Head$/)).toBeVisible();
            if (await section.getByRole('heading', { level: 2 }).innerText() === 'College of Computer Studies') await expect(drawer).toContainText('Ramon Castillo');
            await drawer.getByRole('button', { name: 'Close panel' }).click();
            await expect(drawer).toBeHidden();
          }
        }
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j4');
      } finally {
        finish(info, width, 'sao-j4', ceiling, clicks || counter.clicks);
      }
    });


    test('5. Answer a grievance (ceiling 6)', async ({ page, browser }, info) => {
      const ceiling = 6;
      const seed = nextSeed();
      const grievance = await fileGrievance(seed);
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await chooseFromMenu(page, tap, width, 'Reviews', 'Grievances');
        const row = onScreen(page.locator('tr, article, li').filter({ hasText: grievance.title }));
        await expect(row).toBeVisible({ timeout: 20000 });

        await tap(row.getByRole('button', { name: new RegExp(escapeRegExp(grievance.title), 'i') }));
        const drawer = page.getByRole('dialog', { name: new RegExp(escapeRegExp(grievance.title), 'i') });
        await expect(drawer).toBeVisible();

        await tap(drawer.getByRole('button', { name: 'Move to under review' }));
        await expect(drawer.getByText('Under review').first()).toBeVisible({ timeout: 20000 });

        await tap(drawer.getByRole('button', { name: 'Resolve', exact: true }));
        const resolveDialog = modalTitled(page, 'Resolve');
        await resolveDialog.getByLabel(/Remarks/).fill('The lights in the study area were replaced and checked.');
        await tap(resolveDialog.getByRole('button', { name: 'Resolve', exact: true }));
        clicks = counter.clicks;

        await expect(resolveDialog).toBeHidden({ timeout: 20000 });
        await expect(drawer.getByText('Resolved').first()).toBeVisible({ timeout: 20000 });
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j5');

        // The student who filed it reads the answer on My grievances.
        const student = await signedInContext(browser, STUDENT, width, height);
        await student.page.goto(`/dashboard/my-grievances?record=${grievance.id}`);
        await expect(student.page.getByText('Resolved').first()).toBeVisible({ timeout: 20000 });
        await student.context.close();
      } finally {
        finish(info, width, 'sao-j5', ceiling, clicks || counter.clicks);
      }
    });
  });
}
