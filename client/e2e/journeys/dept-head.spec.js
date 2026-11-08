import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { HEAD_CCS, PSITS_ADMIN, SAO, apiAs, liveEnabled, minimalPdf, shot, uiLogin } from '../support/live.js';
import { allowToApply, ensureOpenSemester, newStudent, submitApplication, uniqueAcronym } from '../support/pipeline.js';

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

// A student of the college applies through the one pipeline: seeded here through the API, so a journey
// starts from "the application is with the dean".
async function seedApplication(label) {
  const student = await newStudent(label);
  await allowToApply(student);
  return submitApplication(student, { name: unique(`Journey ${label} Society`), acronym: uniqueAcronym('J') });
}

// The Department Head's Allow a student to apply modal: type a name, pick the person, confirm.
async function allowThroughModal(page, journey, student) {
  await journey.tap(page.getByRole('button', { name: 'Allow a student to apply' }).first());
  const dialog = page.getByRole('dialog', { name: 'Allow a student to apply' });
  await dialog.getByRole('combobox', { name: 'Student' }).fill(student.firstName);
  await journey.tap(dialog.getByRole('option', { name: new RegExp(escapeRegExp(student.name)) }));
  await journey.tap(dialog.getByRole('button', { name: 'Allow to apply' }));
  await expect(dialog).toBeHidden();
}

async function signedInStudent(browser, student, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await uiLogin(page, student);
  return { context, page };
}

async function openApplicationQueue(page, journey, application) {
  await goTo(page, journey, 'Organization applications');
  await journey.tap(page.getByRole('button', { name: `Open application of ${application.name}`, exact: true }));
  const drawer = page.getByRole('dialog', { name: application.name });
  await expect(drawer).toBeVisible();
  return drawer;
}


// Runs before any semester exists: the fresh seed has none, and the next group opens one.
for (const { label, viewport } of WIDTHS) {
  test.describe(`Department Head with no active semester at ${label}px`, () => {
    test.use({ viewport });

    test(`DH-1b ${label}px: allow a student to apply while applications are closed`, async ({ page, browser }) => {
      test.setTimeout(120_000);
      const sao = await apiAs(SAO);
      const active = await sao.get('/academic-periods/active');
      expect(active.body?.id ?? null, 'this journey needs a database where the SAO has not opened a semester yet').toBeNull();

      const student = await newStudent('Closed');
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await goTo(page, journey, 'Organizations', organizationsShortcut(page));
        await allowThroughModal(page, journey, student);

        const applicant = await signedInStudent(browser, student, viewport);
        await applicant.page.goto('/dashboard/student/apply-organization');
        await expect(applicant.page.getByText('Applications are closed')).toBeVisible();
        await expect(applicant.page.getByLabel('Organization name')).toHaveCount(0);
        await applicant.context.close();
      } finally {
        await conclude(page, journey, { id: 'DH-1b', width: viewport.width, ceiling: 4 });
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

    test(`DH-1 ${label}px: allow a student to apply and see the application arrive`, async ({ page, browser }) => {
      test.setTimeout(150_000);
      const student = await newStudent('Applicant');
      const name = unique('Journey Registered Society');
      const acronym = uniqueAcronym('JR');
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await goTo(page, journey, 'Organizations', organizationsShortcut(page));
        await allowThroughModal(page, journey, student);

        const applicant = await signedInStudent(browser, student, viewport);
        await applicant.page.goto('/dashboard/student/apply-organization');
        const form = applicant.page.locator('main');
        await form.getByLabel('Organization name').fill(name);
        await form.getByLabel('Acronym').fill(acronym);
        await form.getByLabel('Your position').fill('President');
        const pickers = form.locator('input[type="file"]');
        const required = await pickers.count();
        expect(required, 'one file picker per open requirement').toBeGreaterThan(0);
        for (let index = 0; index < required; index += 1) {
          await pickers.nth(index).setInputFiles({ name: `requirement-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: minimalPdf(`${name} ${index + 1}`) });
        }
        await form.getByRole('button', { name: 'Send application' }).click();
        await expect(applicant.page.getByText('Your Department Head is reviewing it.')).toBeVisible();
        await applicant.context.close();

        await goTo(page, journey, 'Organization applications');
        const row = listRow(page, name);
        await expect(row).toBeVisible();
        await expect(row).toContainText('With the Department Head');
      } finally {
        await conclude(page, journey, { id: 'DH-1', width: viewport.width, ceiling: 5 });
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

    test(`DH-3 ${label}px: endorse an application to the SAO`, async ({ page }) => {
      test.setTimeout(120_000);
      const application = await seedApplication('Endorse');
      const journey = startJourney();
      await signInAsHead(page);
      try {
        const drawer = await openApplicationQueue(page, journey, application);
        await journey.tap(drawer.getByRole('button', { name: 'Endorse to SAO' }));

        await expect(page.getByText('Endorsed. The SAO is next.')).toBeVisible();
        await journey.tap(page.getByRole('tab', { name: /^With the SAO/ }));
        await expect(listRow(page, application.name)).toContainText('With the SAO');
      } finally {
        await conclude(page, journey, { id: 'DH-3', width: viewport.width, ceiling: 4 });
      }
    });

    test(`DH-3b ${label}px: return an application, the student fixes it and sends it again`, async ({ page, browser }) => {
      test.setTimeout(150_000);
      const application = await seedApplication('Return');
      const note = 'Replace the constitution with the signed copy.';
      const journey = startJourney();
      await signInAsHead(page);
      try {
        const drawer = await openApplicationQueue(page, journey, application);
        await drawer.getByLabel('General note').fill(note);
        await journey.tap(drawer.getByRole('button', { name: 'Return to applicant' }));
        await expect(page.getByText('Returned to the applicant.')).toBeVisible();

        const applicant = await signedInStudent(browser, application.student, viewport);
        await applicant.page.goto(`/dashboard/student/organization-applications/${application.id}`);
        await expect(applicant.page.getByText(note).first()).toBeVisible();
        await applicant.page.getByRole('button', { name: 'Send again' }).click();
        await expect(applicant.page.getByText('Your Department Head is reviewing it.')).toBeVisible();
        await applicant.context.close();

        await page.reload();
        await expect(listRow(page, application.name)).toContainText('With the Department Head');
      } finally {
        await conclude(page, journey, { id: 'DH-3b', width: viewport.width, ceiling: 4 });
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

    test(`DH-4c ${label}px: a notification about an application opens that application`, async ({ page }) => {
      test.setTimeout(120_000);
      const application = await seedApplication('Notified');
      const journey = startJourney();
      await signInAsHead(page);
      try {
        await journey.tap(page.getByRole('button', { name: 'Notifications' }));
        await journey.tap(page.getByRole('region', { name: 'Notifications panel' }).getByRole('button').filter({ hasText: application.name }));

        const drawer = page.getByRole('dialog', { name: application.name });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'Endorse to SAO' })).toBeVisible();
      } finally {
        await conclude(page, journey, { id: 'DH-4c', width: viewport.width, ceiling: 2 });
      }
    });
  });
}
