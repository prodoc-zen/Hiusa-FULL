import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { SHOTS, SAO, HEAD_CCS, apiLogin, apiUrl, bearer, injectSession, liveEnabled, minimalPdf, shot } from './support/live.js';

// Layout evidence for the screens changed by the SAO / college / organization
// restructure. Every screen is opened at 1440x900 and 390x844 and checked for:
// horizontal page scroll, uncaught console errors, the body font starting with
// Poppins, and (mobile) primary buttons shorter than 42px. A screenshot of every
// pass is written to the shots folder. Violations are collected and reported
// together at the end of each role's walk.
//
// Fixture organizations (pending, returned, archived) are created through the API
// if they are missing so the lifecycle tabs show real cards rather than empty states.
//
// Set HIUSA_LIVE_E2E=1 to run it.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const FIXTURES = [
  { name: 'Visual Pending E2E', acronym: 'VISPEND', target: 'pending' },
  { name: 'Visual Returned E2E', acronym: 'VISRET', target: 'returned' },
  { name: 'Visual Archived E2E', acronym: 'VISARC', target: 'archived' },
];

const report = { screens: [], violations: [] };

async function findOrganization(request, token, acronym) {
  const response = await request.get(`${apiUrl}/system/organizations`, { headers: bearer(token), params: { search: acronym, per_page: 50 } });
  const body = await response.json();
  return (body.data || []).find((item) => item.acronym === acronym) || null;
}

async function ensureFixtures(request) {
  const sao = await apiLogin(request, SAO);
  const head = await apiLogin(request, HEAD_CCS);
  const requirements = (await (await request.get(`${apiUrl}/college/organizations/requirements`, { headers: bearer(head.token) })).json()).requirements;
  const ids = {};
  for (const fixture of FIXTURES) {
    let organization = await findOrganization(request, sao.token, fixture.acronym);
    if (!organization) {
      const multipart = { name: fixture.name, acronym: fixture.acronym, description: `Fixture for the layout evidence run (${fixture.target}).`, color: '#0F2F62' };
      requirements.forEach((requirement) => {
        multipart[`files[${requirement.id}]`] = { name: `${requirement.id}.pdf`, mimeType: 'application/pdf', buffer: minimalPdf(requirement.name) };
      });
      const created = await request.post(`${apiUrl}/college/organizations`, { headers: bearer(head.token), multipart });
      expect(created.status(), `register ${fixture.acronym}: ${await created.text()}`).toBe(201);
      organization = await findOrganization(request, sao.token, fixture.acronym);
      if (fixture.target !== 'pending') {
        const review = await request.patch(`${apiUrl}/system/organizations/${organization.id}/review`, {
          headers: bearer(sao.token),
          data: fixture.target === 'returned'
            ? { decision: 'return', remarks: 'Please re-upload the Constitutional By-Laws with the adviser signature.', submitted_at: organization.submitted_at }
            : { decision: 'approve', submitted_at: organization.submitted_at },
        });
        expect(review.status(), `review ${fixture.acronym}`).toBe(200);
      }
      if (fixture.target === 'archived') {
        const archive = await request.post(`${apiUrl}/system/organizations/${organization.id}/archive`, { headers: bearer(sao.token), data: { reason: 'Fixture for the layout evidence run' } });
        expect(archive.status(), 'archive fixture').toBe(200);
      }
    }
    ids[fixture.acronym] = organization.id;
  }
  const anyActive = await findOrganization(request, sao.token, 'PSITS-CCS');
  ids.PSITS = anyActive.id;
  return ids;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect.poll(async () => page.locator('[aria-busy="true"], [aria-label^="Loading"], .animate-pulse').count(), { timeout: 20000 }).toBe(0);
  await page.waitForTimeout(250);
}

async function measure(page, viewportName) {
  return page.evaluate((isMobile) => {
    const doc = document.documentElement;
    const family = getComputedStyle(document.body).fontFamily;
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const main = document.querySelector('main') || document.body;
    const clickable = [...main.querySelectorAll('button, a[href], [role="button"]')].filter(visible);
    const isPrimary = (el) => {
      const style = getComputedStyle(el);
      const background = style.backgroundColor;
      const filled = background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent' && background !== 'rgb(255, 255, 255)';
      return filled && style.color === 'rgb(255, 255, 255)';
    };
    const short = (el) => el.getBoundingClientRect().height < 41.5;
    const describe = (el) => `${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)} (${Math.round(el.getBoundingClientRect().height)}px)`;
    const wide = [...document.querySelectorAll('body *')].filter((el) => visible(el) && el.getBoundingClientRect().right > doc.clientWidth + 1 && !el.closest('[class*="overflow-x-auto"], [class*="overflow-auto"], [class*="overflow-hidden"], [class*="overflow-x-hidden"], [role="tablist"]')).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowCulprits: wide,
      fontFamily: family,
      primaryShort: isMobile ? clickable.filter(isPrimary).filter(short).map(describe) : [],
      interactiveShort: isMobile ? clickable.filter(short).length : 0,
      interactiveTotal: clickable.length,
    };
  }, viewportName === 'mobile');
}

async function walk(browser, request, accountSession, screens, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await injectSession(page, accountSession);
  let current = { label: 'setup' };
  const events = [];
  page.on('console', (message) => { if (message.type() === 'error') events.push({ label: current.label, text: message.text().slice(0, 200) }); });
  page.on('pageerror', (error) => events.push({ label: current.label, text: `pageerror: ${String(error.message).slice(0, 200)}` }));

  for (const screen of screens) {
    for (const viewport of VIEWPORTS) {
      const label = `${role} ${screen.name} ${viewport.name}`;
      current = { label };
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 });
      await settle(page);
      if (screen.after) await screen.after(page);
      const picture = shot(`C-${role}-${screen.name}-${viewport.name}.png`);
      await page.screenshot({ path: picture, fullPage: true });
      const result = await measure(page, viewport.name);
      const problems = [];
      if (result.scrollWidth > result.clientWidth) problems.push(`horizontal scroll ${result.scrollWidth} > ${result.clientWidth} (${result.overflowCulprits.join('; ')})`);
      if (!/^["']?Poppins/i.test(result.fontFamily)) problems.push(`body font-family is ${result.fontFamily}`);
      if (result.primaryShort.length) problems.push(`primary buttons under 42px: ${result.primaryShort.join(', ')}`);
      const consoleErrors = events.filter((event) => event.label === label);
      consoleErrors.forEach((event) => problems.push(`console error: ${event.text}`));
      const pathNow = new URL(page.url()).pathname + new URL(page.url()).search;
      if (new URL(page.url()).pathname !== screen.path.split('?')[0]) problems.push(`redirected to ${pathNow}`);
      report.screens.push({ label, picture, interactiveShort: result.interactiveShort, interactiveTotal: result.interactiveTotal, problems });
      problems.forEach((problem) => report.violations.push({ label, picture, problem }));
    }
  }
  await context.close();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(`${SHOTS}/../visual-report-${role}.json`, JSON.stringify(report, null, 2));
}

test.afterAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(`${SHOTS}/../visual-report.json`, JSON.stringify(report, null, 2));
});

let ids = null;

test('SAO screens at desktop and mobile', async ({ browser, request }) => {
  test.setTimeout(900_000);
  ids = await ensureFixtures(request);
  const session = await apiLogin(request, SAO);
  const orgPath = (id) => `/dashboard/super-admin/organizations/${id}`;
  const screens = [
    { name: 'agency', path: '/dashboard/super-admin/agency' },
    { name: 'organizations-pending', path: '/dashboard/super-admin/organizations?status=pending' },
    { name: 'organizations-active', path: '/dashboard/super-admin/organizations?status=active' },
    { name: 'organizations-returned', path: '/dashboard/super-admin/organizations?status=returned' },
    { name: 'organizations-archived', path: '/dashboard/super-admin/organizations?status=archived' },
    { name: 'org-overview-active', path: orgPath(ids.PSITS) },
    { name: 'org-overview-pending', path: orgPath(ids.VISPEND) },
    { name: 'org-overview-archived', path: orgPath(ids.VISARC) },
    { name: 'colleges', path: '/dashboard/super-admin/colleges' },
    { name: 'compliance-accreditation', path: '/dashboard/super-admin/compliance?tab=accreditation' },
    { name: 'compliance-requirements', path: '/dashboard/super-admin/compliance?tab=requirements' },
    { name: 'compliance-review', path: '/dashboard/super-admin/compliance?tab=review' },
    { name: 'compliance-events', path: '/dashboard/super-admin/compliance?tab=events' },
    { name: 'compliance-financial', path: '/dashboard/super-admin/compliance?tab=financial' },
    { name: 'compliance-documents', path: '/dashboard/super-admin/compliance?tab=documents' },
    {
      name: 'venues-calendar',
      path: '/dashboard/super-admin/venues',
      after: async (page) => {
        await page.getByRole('tab', { name: /Booking requests/ }).click();
        await expect(page.getByLabel('Venue to show')).toBeVisible({ timeout: 15000 });
        await settle(page);
      },
    },
  ];
  await walk(browser, request, session, screens, 'SAO');
  const own = report.violations.filter((violation) => violation.label.startsWith('SAO'));
  expect.soft(own, `SAO layout violations:\n${own.map((violation) => `${violation.label}: ${violation.problem} [${violation.picture}]`).join('\n')}`).toEqual([]);
});

test('Department Head screens at desktop and mobile', async ({ browser, request }) => {
  test.setTimeout(600_000);
  const session = await apiLogin(request, HEAD_CCS);
  const screens = [
    { name: 'home', path: '/dashboard/department-head' },
    { name: 'organizations', path: '/dashboard/department-head/organizations' },
    {
      name: 'organizations-register-form',
      path: '/dashboard/department-head/organizations',
      after: async (page) => {
        await page.getByRole('button', { name: 'Register an organization' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog').locator('input[type=file]').first()).toBeVisible({ timeout: 15000 });
        await settle(page);
      },
    },
    { name: 'approvals', path: '/dashboard/department-head/approvals' },
  ];
  await walk(browser, request, session, screens, 'HEAD');
  const own = report.violations.filter((violation) => violation.label.startsWith('HEAD'));
  expect.soft(own, `Department Head layout violations:\n${own.map((violation) => `${violation.label}: ${violation.problem} [${violation.picture}]`).join('\n')}`).toEqual([]);
});

test('harness control: the measurements can fail', async ({ browser, request }) => {
  const session = await apiLogin(request, HEAD_CCS);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await injectSession(page, session);
  await page.goto('/dashboard/department-head', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 });
  await settle(page);
  await page.addStyleTag({ content: 'body { min-width: 1200px !important; font-family: serif !important; } main button, main a[href] { display: inline-block !important; height: 20px !important; background: rgb(11,142,208) !important; color: #fff !important; }' });
  const result = await measure(page, 'mobile');
  expect(result.scrollWidth).toBeGreaterThan(result.clientWidth);
  expect(result.fontFamily).not.toMatch(/Poppins/i);
  expect(result.primaryShort.length).toBeGreaterThan(0);
  await context.close();
});
