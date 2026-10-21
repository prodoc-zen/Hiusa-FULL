import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { HEAD_CCS, PSITS_ADMIN, SAO, apiAs, liveEnabled, minimalPdf, shot, uiLogin } from '../support/live.js';

// DEPARTMENT_HEAD acceptance journeys, docs/UX_FLOW.md section 9. Each journey starts on the role home
// after a real sign-in, counts only mouse or tap actions (typing and file choosing are free) and ends
// on an assertion about what the person can see. State is seeded through the API as the SAO and the
// organization Admin, never through the database.
test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const WIDTHS = [
  { label: '1440', viewport: { width: 1440, height: 900 } },
  { label: '390', viewport: { width: 390, height: 844 } },
];

// The sidebar is a drawer below this width (Tailwind lg), so opening it is one more tap.
const DESKTOP_MENU_WIDTH = 1024;

const runTag = Date.now().toString(36).slice(-5);
let seedCounter = 0;
const unique = (label) => `${label} ${runTag}${seedCounter += 1}`;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startJourney() {
  const journey = {
    clicks: 0,
    async tap(locator, options) {
      journey.clicks += 1;
      await locator.click(options);
    },
  };
  return journey;
}

async function layoutNotes(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const notes = [];
    if (document.documentElement.scrollWidth > viewportWidth + 1) notes.push(`the page scrolls sideways (${document.documentElement.scrollWidth}px wide in ${viewportWidth}px)`);
    const main = document.querySelector('main');
    if (main && main.scrollWidth > main.clientWidth + 1) notes.push(`main clips content sideways (${main.scrollWidth}px in ${main.clientWidth}px)`);
    const scrolls = (element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
      }
      return false;
    };
    const spilling = [...document.querySelectorAll('main *, [role="dialog"] *')].filter((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && box.right > viewportWidth + 1 && !scrolls(element);
    });
    spilling.slice(0, 4).forEach((element) => {
      notes.push(`${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}" ends at ${Math.round(element.getBoundingClientRect().right)}px`);
    });
    return notes;
  });
}

async function conclude(page, journey, { id, width, ceiling }) {
  let notes = [];
  if (width === 390) {
    // A drawer is still sliding in for a moment after it opens, and its boxes are offset until it stops.
    await page.waitForTimeout(500);
    notes = await layoutNotes(page).catch(() => []);
    await page.screenshot({ path: shot(`${id}-390.png`) }).catch(() => {});
  }
  fs.appendFileSync(shot('results.log'), `${id} ${width}px clicks=${journey.clicks} ceiling=${ceiling}${notes.length ? ` layout: ${notes.join('; ')}` : ''}\n`);
  expect.soft(journey.clicks, `${id} at ${width}px took ${journey.clicks} taps, the ceiling is ${ceiling}`).toBeLessThanOrEqual(ceiling);
}

// The documented route is the sidebar item. Below the desktop width the sidebar is a drawer that costs one
// more tap to open, so a person on a phone takes the home page's own link to the same page when it has
// one, and only opens the drawer when it does not. Every tap is counted except the one that opens the
// drawer, which is chrome, not a step (docs/UX_FLOW.md section 9, Counting rules).
async function goTo(page, journey, menuName, homeShortcut) {
  const phone = (page.viewportSize()?.width ?? 0) < DESKTOP_MENU_WIDTH;
  if (phone && homeShortcut) {
    const offered = await homeShortcut.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    if (offered) {
      await journey.tap(homeShortcut.first());
      return;
    }
  }
  if (phone) await page.getByRole('button', { name: 'Open menu' }).click();
  await journey.tap(page.getByRole('link', { name: menuName, exact: true }));
}

const organizationsShortcut = (page) => page.getByRole('link', { name: 'Manage organizations', exact: true });
const approvalsShortcut = (page) => page.getByRole('link', { name: /items? awaiting your approval/ });

async function signInAsHead(page) {
  await uiLogin(page, HEAD_CCS);
  await expect(page).toHaveURL(/\/dashboard\/department-head$/);
}

// A list row at either width: a table row on desktop, a card on a phone.
function listRow(page, text) {
  return page.locator('main').locator('tr, ul[data-view="cards"] > li').filter({ hasText: text }).filter({ visible: true });
}

async function ensureOpenSemester() {
  const sao = await apiAs(SAO);
  const years = await sao.get('/system/academic-years');
  expect(years.ok, 'the SAO can list academic years').toBe(true);
  const year = years.body.find((candidate) => candidate.is_current) ?? years.body[0];
  let semester = year.semesters.find((candidate) => candidate.status === 'active');
  if (!semester) {
    semester = year.semesters[0];
    if (!semester) {
      const created = await sao.post(`/system/academic-years/${year.id}/semesters`, { number: 1, starts_on: year.starts_on, ends_on: year.ends_on });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      semester = created.body;
    }
    const activated = await sao.patch(`/system/academic-semesters/${semester.id}/active`);
    expect(activated.ok, JSON.stringify(activated.body)).toBe(true);
  }
  const requirements = await sao.get(`/compliance/requirement-types?per_page=100&category=organization&academic_year=${year.label}`);
  for (const type of (requirements.body?.data ?? [])) {
    if (!type.is_active) {
      await sao.put(`/compliance/requirement-types/${type.id}`, { is_active: true, template_url: 'https://example.edu/format.pdf' });
    }
  }
}

function eventDate(offsetDays) {
  const day = new Date(Date.now() + offsetDays * 86400000);
  const iso = day.toISOString().slice(0, 10);
  return { start: `${iso}T09:00:00`, end: `${iso}T11:00:00` };
}

// The Admin proposes an event, which waits for the Department Head. Returns the approval request.
async function proposeEvent(title) {
  const admin = await apiAs(PSITS_ADMIN);
  const head = await apiAs(HEAD_CCS);
  const { start, end } = eventDate(14 + seedCounter);
  const created = await admin.post('/events', { title, description: 'Acceptance journey seed', start_time: start, end_time: end, location: 'Journey hall', planning_details: { venue_type: 'off_campus' } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const approvals = await head.get('/approval-requests?status=pending&per_page=50');
  const approval = approvals.body.data.find((item) => item.entity_type === 'event' && item.title === title);
  expect(approval, `the Department Head has an approval request for "${title}"`).toBeTruthy();
  return approval;
}

// The Admin generates and submits a financial report, which waits for the Department Head.
async function submitReport() {
  const admin = await apiAs(PSITS_ADMIN);
  const head = await apiAs(HEAD_CCS);
  const month = String(1 + (seedCounter % 12)).padStart(2, '0');
  const day = String(1 + (seedCounter % 27)).padStart(2, '0');
  const generated = await admin.post('/financial-reports/generate', {
    report_type: 'custom',
    period_start: '2026-01-01',
    period_end: `2026-${month}-${day}`,
    signatories: { treasurer: 'Journey Treasurer', president: 'Journey President', adviser: 'Journey Adviser', sbo_adviser: 'Journey SBO Adviser' },
  });
  expect(generated.status, JSON.stringify(generated.body)).toBe(201);
  const report = generated.body.report;
  const submitted = await admin.post(`/financial-reports/${report.id}/submit`, new FormData());
  expect(submitted.ok, JSON.stringify(submitted.body)).toBe(true);
  const approvals = await head.get('/approval-requests?status=pending&per_page=50');
  const approval = approvals.body.data.find((item) => item.entity_type === 'financial_report' && item.title === report.title);
  expect(approval, `the Department Head has an approval request for "${report.title}"`).toBeTruthy();
  return approval;
}

// The Department Head registers an organization through the API with one PDF per open requirement.
async function registerOrganization(name, acronym) {
  const head = await apiAs(HEAD_CCS);
  const requirements = await head.get('/college/organizations/requirements');
  expect(requirements.body.requirements.length, 'registration requirements are open').toBeGreaterThan(0);
  const form = new FormData();
  form.append('name', name);
  form.append('acronym', acronym);
  requirements.body.requirements.forEach((requirement) => {
    form.append(`files[${requirement.id}]`, new Blob([minimalPdf(`${name} ${requirement.name}`)], { type: 'application/pdf' }), `requirement-${requirement.id}.pdf`);
  });
  const created = await head.post('/college/organizations', form);
  expect(created.ok, JSON.stringify(created.body)).toBe(true);
  const list = await head.get('/college/organizations?per_page=100');
  const organization = list.body.data.find((item) => item.name === name);
  expect(organization, `the registration "${name}" is in the college list`).toBeTruthy();
  return organization;
}

// The SAO returns a pending registration to the Department Head, which notifies the head.
async function returnRegistration(organization, remarks) {
  const sao = await apiAs(SAO);
  const reviewed = await sao.patch(`/system/organizations/${organization.id}/review`, { decision: 'return', remarks, submitted_at: organization.submitted_at });
  expect(reviewed.ok, JSON.stringify(reviewed.body)).toBe(true);
}

// Puts a returned registration back with the SAO so a journey leaves no returned item on the home page of
// the next one (the briefing lists only the first few by name). A no-op for one that is no longer returned.
async function settleRegistration(organization) {
  const head = await apiAs(HEAD_CCS);
  const list = await head.get('/college/organizations?per_page=100');
  const current = list.body.data.find((item) => item.id === organization.id);
  if (!current || current.lifecycle_status !== 'returned') return;
  const form = new FormData();
  form.append('_method', 'PUT');
  form.append('name', current.name);
  form.append('acronym', current.acronym);
  await head.post(`/college/organizations/${organization.id}`, form);
}

async function seedReturnedRegistration() {
  const name = unique('Journey Returned Society');
  const organization = await registerOrganization(name, unique('JR'));
  await returnRegistration(organization, 'Replace the constitution with the signed copy.');
  return organization;
}

// Runs before any semester exists: the fresh seed has none, and the next group opens one.
for (const { label, viewport } of WIDTHS) {
  test.describe(`Department Head with no active semester at ${label}px`, () => {
    test.use({ viewport });

    test(`DH-1b ${label}px: the register form says why it cannot submit`, async ({ page }) => {
      test.setTimeout(90_000);
      const head = await apiAs(HEAD_CCS);
      const open = await head.get('/college/organizations/requirements');
      expect(open.body.requirements, 'this journey needs a database where the SAO has not opened a semester yet').toHaveLength(0);

      const journey = startJourney();
      await signInAsHead(page);
      try {
        await goTo(page, journey, 'Organizations', organizationsShortcut(page));
        await journey.tap(page.getByRole('button', { name: 'Register an organization' }).first());
        const form = page.getByRole('dialog', { name: 'Register an organization' });
        await expect(form.getByRole('status')).toContainText('The SAO must activate a semester first.');
        await expect(form.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
      } finally {
        await conclude(page, journey, { id: 'DH-1b', width: viewport.width, ceiling: 3 });
      }
    });
  });
}

for (const { label, viewport } of WIDTHS) {
  test.describe(`Department Head journeys at ${label}px`, () => {
    test.use({ viewport });
    test.beforeAll(async () => {
      await ensureOpenSemester();
    });

    test(`DH-1 ${label}px: register an organization`, async ({ page }) => {
      test.setTimeout(120_000);
      const name = unique('Journey Registered Society');
      const acronym = unique('JS');
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await goTo(page, journey, 'Organizations', organizationsShortcut(page));
        await journey.tap(page.getByRole('button', { name: 'Register an organization' }).first());
        const form = page.getByRole('dialog', { name: 'Register an organization' });
        await expect(form.getByLabel('Organization name')).toBeVisible();
        await form.getByLabel('Organization name').fill(name);
        await form.getByLabel('Acronym').fill(acronym);
        const pickers = form.locator('input[type="file"]');
        const required = await pickers.count();
        expect(required, 'one file picker per open requirement').toBeGreaterThan(0);
        for (let index = 0; index < required; index += 1) {
          await pickers.nth(index).setInputFiles({ name: `requirement-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: minimalPdf(`${name} ${index + 1}`) });
        }
        await journey.tap(form.getByRole('button', { name: 'Submit for review' }));

        await expect(page.getByRole('dialog', { name: 'Register an organization' })).toBeHidden();
        const row = listRow(page, name);
        await expect(row).toBeVisible();
        await expect(row).toContainText('Pending review: waiting for SAO review');
      } finally {
        await conclude(page, journey, { id: 'DH-1', width: viewport.width, ceiling: 3 });
      }
    });

    test(`DH-2 ${label}px: approve an item`, async ({ page }) => {
      test.setTimeout(120_000);
      const title = unique('Journey Approval Fair');
      await proposeEvent(title);
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await goTo(page, journey, 'Approvals', approvalsShortcut(page));
        await journey.tap(page.getByRole('button', { name: `Review: ${title}`, exact: true }));
        const drawer = page.getByRole('dialog', { name: title });
        await expect(drawer).toBeVisible();
        await journey.tap(drawer.getByRole('button', { name: 'Approve', exact: true }));
        await journey.tap(page.getByRole('dialog', { name: 'Approve request' }).getByRole('button', { name: 'Approve', exact: true }));

        await expect(drawer.getByText(/^Approved/).first()).toBeVisible();
        await expect(drawer.getByRole('link', { name: 'Open event' })).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

        const admin = await apiAs(PSITS_ADMIN);
        await expect.poll(async () => {
          const notices = await admin.get('/notifications?per_page=30');
          return (notices.body?.data ?? []).some((notice) => `${notice.title} ${notice.message}`.includes(title));
        }, { message: `the Admin is told that "${title}" was decided`, timeout: 10_000 }).toBe(true);
      } finally {
        await conclude(page, journey, { id: 'DH-2', width: viewport.width, ceiling: 4 });
      }
    });

    test(`DH-3 ${label}px: follow up a returned registration`, async ({ page }) => {
      test.setTimeout(120_000);
      const organization = await seedReturnedRegistration();
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await journey.tap(page.getByRole('link', { name: new RegExp(`Registration returned: ${escapeRegExp(organization.name)}`) }));
        await journey.tap(page.getByRole('button', { name: `Edit and resubmit ${organization.name}`, exact: true }));
        const form = page.getByRole('dialog', { name: `Edit and resubmit ${organization.name}` });
        await journey.tap(form.getByRole('button', { name: 'Resubmit to SAO' }));

        await expect(form).toBeHidden();
        const row = listRow(page, organization.name);
        await expect(row).toBeVisible();
        await expect(row).toContainText(/waiting for SAO review/i);
      } finally {
        await conclude(page, journey, { id: 'DH-3', width: viewport.width, ceiling: 3 });
        await settleRegistration(organization);
      }
    });

    test(`DH-4a ${label}px: a notification about an event approval opens that approval`, async ({ page }) => {
      test.setTimeout(120_000);
      const title = unique('Journey Notified Fair');
      const approval = await proposeEvent(title);
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await journey.tap(page.getByRole('button', { name: 'Notifications' }));
        await journey.tap(page.getByRole('region', { name: 'Notifications panel' }).getByRole('button').filter({ hasText: `"${title}"` }));

        const drawer = page.getByRole('dialog', { name: title });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(`Request #${approval.id}`);
        await expect(drawer.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
      } finally {
        await conclude(page, journey, { id: 'DH-4a', width: viewport.width, ceiling: 2 });
      }
    });

    test(`DH-4b ${label}px: a notification about a financial report opens that report's approval`, async ({ page }) => {
      test.setTimeout(120_000);
      const approval = await submitReport();
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await journey.tap(page.getByRole('button', { name: 'Notifications' }));
        await journey.tap(page.getByRole('region', { name: 'Notifications panel' }).getByRole('button').filter({ hasText: `"${approval.title}"` }));

        const drawer = page.getByRole('dialog', { name: approval.title });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(`Request #${approval.id}`);
        await expect(drawer.getByRole('button', { name: 'Download submitted report' })).toBeVisible();
      } finally {
        await conclude(page, journey, { id: 'DH-4b', width: viewport.width, ceiling: 2 });
      }
    });

    test(`DH-4c ${label}px: a notification about an organization opens that organization`, async ({ page }) => {
      test.setTimeout(120_000);
      const organization = await seedReturnedRegistration();
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await journey.tap(page.getByRole('button', { name: 'Notifications' }));
        await journey.tap(page.getByRole('region', { name: 'Notifications panel' }).getByRole('button').filter({ hasText: organization.name }));

        const drawer = page.getByRole('dialog', { name: organization.name });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText('Returned: edit and resubmit');
        await expect(drawer.getByRole('button', { name: 'Edit and resubmit' })).toBeVisible();
      } finally {
        await conclude(page, journey, { id: 'DH-4c', width: viewport.width, ceiling: 2 });
        await settleRegistration(organization);
      }
    });
  });
}
