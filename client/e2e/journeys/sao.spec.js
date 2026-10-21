import { expect, test } from '@playwright/test';
import { SAO, PSITS_ADMIN, HEAD_CCS, STUDENT, apiAs, liveEnabled, pdfFile, shot, uiLogin } from '../support/live.js';

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
  await tap(page.getByRole('button', { name: groupLabel, exact: true }));
  await tap(page.getByRole('link', { name: leafLabel, exact: true }));
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

async function ensureActiveSemester() {
  const sao = await apiAs(SAO);
  const years = await sao.get('/system/academic-years');
  const year = years.body.find((candidate) => candidate.is_current) || years.body[0];
  const active = await sao.get('/academic-periods/active');
  if (!active.body?.id) {
    let semester = year.semesters.find((candidate) => candidate.status === 'active');
    if (!semester) {
      semester = year.semesters[0];
      if (!semester) {
        const created = await sao.post(`/system/academic-years/${year.id}/semesters`, { number: 1, starts_on: year.starts_on, ends_on: year.ends_on });
        expect(created.status, `semester created: ${JSON.stringify(created.body).slice(0, 200)}`).toBe(201);
        semester = created.body;
      }
      const activated = await sao.patch(`/system/academic-semesters/${semester.id}/active`);
      expect(activated.status, `semester activated: ${JSON.stringify(activated.body).slice(0, 200)}`).toBe(200);
    }
  }
  const requirements = await sao.get(`/compliance/requirement-types?per_page=100&category=organization&academic_year=${year.label}`);
  for (const type of (requirements.body?.data ?? [])) {
    if (!type.is_active) {
      await sao.put(`/compliance/requirement-types/${type.id}`, { is_active: true, template_url: 'https://example.edu/format.pdf' });
    }
  }
}

// A Department Head registers a new student organization with every file the open semester requires.
async function registerOrganization(seed) {
  const head = await apiAs(HEAD_CCS);
  const requirements = await head.get('/college/organizations/requirements');
  expect(requirements.body.requirements.length, 'registration requirements are open').toBeGreaterThan(0);
  const form = new FormData();
  const name = `Journey Club ${seed}`;
  form.append('name', name);
  form.append('acronym', `JC${seed}`.toUpperCase());
  form.append('description', 'Registered by the SAO acceptance journey.');
  for (const requirement of requirements.body.requirements) {
    const file = pdfFile(`${requirement.name}.pdf`, requirement.name);
    form.append(`files[${requirement.id}]`, new Blob([file.buffer], { type: file.mimeType }), file.name);
  }
  const created = await head.post('/college/organizations', form);
  expect(created.status, `registration filed: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(201);
  return { id: created.body.id, name, submittedAt: created.body.submitted_at };
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
  await ensureActiveSemester();
});

for (const { width, height } of WIDTHS) {
  test.describe(`SAO journeys at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test.describe.configure({ timeout: 240_000 });
    test.use({ actionTimeout: 20_000 });

    test('1. Approve a registration and give it an administrator (ceiling 5)', async ({ page, browser }, info) => {
      const ceiling = 5;
      const seed = nextSeed();
      const organization = await registerOrganization(seed);
      const namePattern = new RegExp(escapeRegExp(organization.name), 'i');
      const counter = tracker();
      const { tap } = counter;
      const adminId = 9000000 + Math.floor(Math.random() * 900000);
      let clicks = 0;
      try {
        await signInAsSao(page);

        await tap(page.getByRole('link', { name: /registrations awaiting review/i }));
        const card = page.locator('article').filter({ hasText: namePattern });
        await expect(card).toBeVisible({ timeout: 20000 });

        await tap(card.getByRole('button', { name: /^Review / }));
        const drawer = page.getByRole('dialog', { name: 'Review registration' });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'Approve' })).toBeEnabled({ timeout: 20000 });

        await tap(drawer.getByRole('button', { name: 'Approve' }));
        await expect(drawer.getByText('Provision an administrator')).toBeVisible({ timeout: 20000 });

        await tap(drawer.getByRole('link', { name: 'Provision administrator' }));
        const form = page.getByRole('dialog', { name: 'Create administrator' });
        await expect(form).toBeVisible({ timeout: 20000 });
        await form.getByLabel(/School ID/).fill(String(adminId));
        await form.getByLabel(/First name/).fill('Journey');
        await form.getByLabel(/Last name/).fill(`Admin ${seed}`);
        await form.getByLabel(/Email address/).fill(`journey.${seed}@example.test`);
        await form.getByLabel(/^Password/).fill('Journey@12345');
        await form.getByLabel(/Confirm password/).fill('Journey@12345');

        await tap(form.getByRole('button', { name: 'Create Admin User' }));
        clicks = counter.clicks;

        await expect(page.getByText('New Admin user created with the password set by SAO.')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(`Journey Admin ${seed}`, { exact: false }).first()).toBeVisible();
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j1');

        // The organization is now Active with one administrator, and its Department Head sees it say so.
        await page.goto('/dashboard/super-admin/organizations?status=active');
        const activeCard = page.locator('article').filter({ hasText: namePattern });
        await expect(activeCard).toBeVisible({ timeout: 20000 });
        await expect(activeCard).toContainText(/1 admins/);
        await expect(activeCard.getByText(/Active/).first()).toBeVisible();

        const head = await signedInContext(browser, HEAD_CCS, width, height);
        await head.page.goto('/dashboard/department-head/organizations');
        const headRow = onScreen(head.page.locator('article, tr, li').filter({ hasText: namePattern }));
        await expect(headRow).toContainText(/Administrator can sign in/i, { timeout: 20000 });
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
        const panel = page.getByRole('tabpanel', { name: 'Review queue' });
        await expect(panel).toBeVisible({ timeout: 20000 });
        const queueRow = onScreen(panel.locator('tr, article, li').filter({ hasText: requirementName }).filter({ hasText: organizationName }));
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
        await page.getByRole('tab', { name: 'Accreditation' }).click();
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
        const panel = page.getByRole('tabpanel', { name: 'Financial reports' });
        await expect(panel).toBeVisible({ timeout: 20000 });
        const reportRow = onScreen(panel.locator('article').filter({ hasText: report.title }));
        await expect(reportRow).toBeVisible({ timeout: 20000 });

        await tap(reportRow.getByRole('button', { name: /View/ }));
        const detail = page.getByRole('dialog');
        await expect(detail.getByRole('button', { name: /Approve/ })).toBeVisible({ timeout: 20000 });

        await tap(detail.getByRole('button', { name: /Approve/ }));
        await tap(modalTitled(page, 'Approve financial report').getByRole('button', { name: 'Approve report' }));
        clicks = counter.clicks;

        await expect(page.getByText('Financial report approved.')).toBeVisible({ timeout: 20000 });
        await expect(reportRow).toContainText(/approved/i, { timeout: 20000 });
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j3');

        // The submitting organization sees the same decision.
        const admin = await signedInContext(browser, PSITS_ADMIN, width, height);
        await admin.page.goto('/dashboard/finance/transaction-history');
        const adminCard = admin.page.getByRole('button', { name: `View details for ${report.title}` }).locator('xpath=ancestor::div[contains(@class, "p-5")][1]');
        await expect(adminCard).toContainText(/approved/i, { timeout: 60000 });
        await admin.context.close();
      } finally {
        finish(info, width, 'sao-j3', ceiling, clicks || counter.clicks);
      }
    });

    test('4. See who needs attention (ceiling 2)', async ({ page }, info) => {
      const ceiling = 2;
      const seed = nextSeed();
      const pending = await registerOrganization(seed);
      const pendingPattern = new RegExp(escapeRegExp(pending.name), 'i');
      const counter = tracker();
      const { tap } = counter;
      let clicks = 0;
      try {
        await signInAsSao(page);

        await chooseFromMenu(page, tap, width, 'Organizations', 'Agency overview');
        clicks = counter.clicks;

        const sections = page.locator('section[aria-labelledby^="college-"]');
        await expect(sections.first()).toBeVisible({ timeout: 20000 });
        await expect(onScreen(page.getByText(pending.name, { exact: false }))).toBeVisible({ timeout: 20000 });

        // Colleges with something to do come before the quiet ones, and inside a college the registration
        // waiting for review sits above the organizations with nothing waiting.
        const summaries = await sections.evaluateAll((nodes) => nodes.map((node) => (node.querySelector('header p')?.textContent || '')));
        const needsAction = summaries.map((text) => {
          const pendingCount = Number((text.match(/(\d+)\s*pending/) || [])[1] || 0);
          return pendingCount > 0 || /awaiting administrator/.test(text);
        });
        expect(needsAction[0], `first college needs action: ${summaries[0]}`).toBe(true);
        expect(needsAction.join(','), 'colleges that need action are listed first').toBe([...needsAction].sort((left, right) => Number(right) - Number(left)).join(','));
        const rows = sections.first().locator('[data-view="table"] tbody tr, [data-view="cards"] > li').filter({ visible: true });
        await expect(rows.first()).toBeVisible();
        const rowTexts = await rows.allInnerTexts();
        const rowNeedsAction = rowTexts.map((text) => !/Nothing waiting/.test(text) || /Provision an administrator|Review this registration/.test(text));
        const mine = rowTexts.findIndex((text) => pendingPattern.test(text));
        expect(mine, `the new registration is listed in ${summaries[0]}`).toBeGreaterThanOrEqual(0);
        expect(rowNeedsAction[mine], 'the new registration is marked as waiting').toBe(true);
        expect(rowNeedsAction.join(','), 'rows that need action come before quiet ones').toBe([...rowNeedsAction].sort((left, right) => Number(right) - Number(left)).join(','));
        expect.soft(clicks, `clicks used (ceiling ${ceiling})`).toBeLessThanOrEqual(ceiling);
        await endState(page, width, 'sao-j4');
      } finally {
        finish(info, width, 'sao-j4', ceiling, clicks || counter.clicks);
        const sao = await apiAs(SAO);
        await sao.patch(`/system/organizations/${pending.id}/review`, { decision: 'approve', submitted_at: pending.submittedAt });
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
