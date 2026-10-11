import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { HEAD_CCS, OFFICER, PSITS_ADMIN, STUDENT, apiAs, liveEnabled, uiLogin } from '../support/live.js';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

// docs/UX_FLOW.md section 9, STUDENT. Every journey starts at the role home after a real UI login and
// runs at both widths. Only mouse or tap actions count toward the ceiling (typing does not). Actions
// that only check the end state (opening the home again, the Vote page or a drawer's panel) go through
// page.goto or the page API and are never counted, so a person's clicks are never padded or hidden.

const SHOTS_DIR = process.env.HIUSA_E2E_JOURNEY_SHOTS || path.join(process.cwd(), 'test-results', 'journeys', 'student');
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const PASSWORD = 'Demo@12345';

// Seeded students. A registration row, even a cancelled one, ticks the home checklist, so journey 1 takes
// the first student of EVENT_POOL who has none yet; a run needs a freshly seeded database after five runs.
const fresh = (schoolId) => ({ schoolId, password: PASSWORD, role: 'STUDENT', home: '/dashboard/student' });
const EVENT_POOL = [2400093, 2400067, 2300247, 2400019, 2300312].map(fresh);
const BY_WIDTH = {
  1440: { order: fresh(2400019), owing: fresh(2200055), grievance: fresh(2200451) },
  390: { order: fresh(2300312), owing: fresh(2200298), grievance: fresh(2300078) },
};

function counter() {
  return { n: 0, menu: 0, log: [] };
}

async function tap(c, locator, what) {
  await locator.click();
  c.n += 1;
  c.log.push(what);
}

// A person on a phone must open the drawer first. That tap is chrome, not a step, so it is kept in
// c.menu and never counted toward the ceiling (docs/UX_FLOW.md section 9, Counting rules).
async function menuTo(page, c, { group, leaf }) {
  const opener = page.getByRole('button', { name: 'Open menu' });
  const onPhone = await opener.isVisible();
  if (onPhone) {
    await opener.click();
    c.menu += 1;
  }
  const nav = (onPhone ? page.getByRole('dialog', { name: 'Navigation menu' }) : page.getByRole('complementary').first()).getByRole('navigation');
  const link = nav.getByRole('link', { name: leaf, exact: true });
  if (group && !(await link.isVisible())) await tap(c, nav.getByRole('button', { name: group, exact: true }), group);
  await tap(c, link, leaf);
}

function record(testInfo, c, extra = {}) {
  const line = { test: testInfo.title, clicks: c.n, menuTaps: c.menu, path: c.log.join(' > '), ...extra };
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.appendFileSync(path.join(SHOTS_DIR, 'clicks.jsonl'), `${JSON.stringify(line)}\n`);
  console.log(`JOURNEY ${JSON.stringify(line)}`);
}

async function overflow(page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

async function inViewport(page, locator) {
  const box = await locator.boundingBox();
  const view = page.viewportSize();
  return Boolean(box) && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1;
}

async function closeActiveElections(admin) {
  const list = await admin.get('/elections');
  for (const election of list.body || []) {
    if (election.status === 'active' && election.finalized_at !== undefined && /^Journey ballot /.test(election.title)) {
      await admin.put(`/elections/${election.id}`, { status: 'closed' });
    }
  }
}

// A real ballot through the API: Admin proposes, Department Head approves, a candidate is added, the
// ballot is finalized and opens because its window has started. The seeded election is never finalized,
// so no student could vote in it. Settings are what the Admin form creates, including the server default
// for results_visible.
async function seedOpenElection() {
  const admin = await apiAs(PSITS_ADMIN);
  const head = await apiAs(HEAD_CCS);
  await closeActiveElections(admin);
  const stamp = Date.now();
  const created = await admin.post('/elections', {
    title: `Journey ballot ${stamp}`,
    start_time: new Date(stamp - 3600e3).toISOString(),
    end_time: new Date(stamp + 2 * 86400e3).toISOString(),
    positions: [{ title: 'Journey President', max_winners: 1 }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const election = created.body;
  const approved = await head.patch(`/approval-requests/${election.approval_id}`, { status: 'approved' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const party = await admin.post('/partylists', { name: `Journey Party ${stamp}`, acronym: 'JP' });
  expect(party.status, JSON.stringify(party.body)).toBe(201);
  const positions = await admin.get(`/elections/${election.id}/positions`);
  const candidate = await admin.post(`/elections/${election.id}/candidates`, { user_id: 2100389, position_id: positions.body[0].id, partylist_id: party.body.id });
  expect(candidate.status, JSON.stringify(candidate.body)).toBe(201);
  const finalized = await admin.patch(`/elections/${election.id}/finalize`);
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  // The window has started but the status only flips to active when an election list is read.
  const opened = await admin.get('/elections');
  expect((opened.body || []).find((item) => item.id === election.id)?.status).toBe('active');
  return { id: election.id, title: election.title };
}

async function ensureInvoice(student) {
  const api = await apiAs(student);
  const mine = await api.get('/invoices');
  const rows = Array.isArray(mine.body) ? mine.body : mine.body?.data || [];
  if (rows.some((invoice) => Number(invoice.remaining_balance) > 0)) return;
  const admin = await apiAs(PSITS_ADMIN);
  const created = await admin.post('/invoices', { student_id: student.schoolId, description: 'Organization fee', amount_due: '500.00' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

for (const viewport of WIDTHS) {
  const who = BY_WIDTH[viewport.width];

  test.describe(`student journeys at ${viewport.width}px`, () => {
    test.use({ viewport });
    test.describe.configure({ timeout: 60_000 });

    test.afterEach(async ({ page }, testInfo) => {
      if (viewport.width !== 390) return;
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const id = testInfo.title.split(' ')[0];
      await page.screenshot({ path: path.join(SHOTS_DIR, `${id}-390-end.png`) }).catch(() => {});
      const size = await overflow(page).catch(() => null);
      if (size) console.log(`OVERFLOW ${id} ${JSON.stringify(size)}`);
    });

    test('J1 join an event (ceiling 3)', async ({ page }, testInfo) => {
      let account = null;
      for (const candidate of EVENT_POOL) {
        const steps = (await (await apiAs(candidate)).get('/dashboard/briefing')).body?.setup?.steps ?? [];
        if (steps.find((step) => step.key === 'event')?.done === false) { account = candidate; break; }
      }
      expect(account, 'a seeded student who is still asked to register for an event; reseed the database').toBeTruthy();
      await uiLogin(page, account);
      const c = counter();

      await menuTo(page, c, { leaf: 'Events' });
      const eventItem = page.getByRole('main').getByRole('button', { name: /Sports Fest 2024/ }).first();
      await tap(c, eventItem, 'open event');
      const drawer = page.getByRole('dialog').first();
      await tap(c, drawer.getByRole('button', { name: 'Register for this event' }), 'Register');

      await expect(drawer.getByText('You are registered', { exact: true })).toBeVisible();
      record(testInfo, c);
      expect.soft(c.n, c.log.join(' > ')).toBeLessThanOrEqual(3);

      await page.goto(account.home);
      await expect(page.getByRole('heading', { name: 'Next for you' })).toBeVisible();
      await expect(page.getByText('Register for an upcoming event')).toHaveCount(0);
    });

    test('J2 vote (ceiling 6 from home)', async ({ page }, testInfo) => {
      const election = await seedOpenElection();
      const account = STUDENT;
      await uiLogin(page, account);
      const c = counter();

      const shortcuts = page.getByRole('complementary', { name: 'Student shortcuts' });
      await tap(c, shortcuts.getByRole('link', { name: 'Enter secure voting' }), 'home Enter secure voting');
      await tap(c, page.getByRole('button', { name: /Start my ballot/ }), 'Start my ballot');
      await tap(c, page.getByRole('button', { name: /Carlo Mendoza/ }), 'choose candidate');
      await tap(c, page.getByRole('button', { name: /Review ballot/ }), 'Review ballot');
      await tap(c, page.getByRole('button', { name: /Submit final ballot/ }), 'Submit final ballot');
      await tap(c, page.getByRole('dialog').getByRole('button', { name: 'Confirm and submit' }), 'Confirm and submit');

      await expect(page.getByRole('heading', { name: 'Ballot submitted' })).toBeVisible();
      await expect(page.getByText('Ballot receipt hash')).toBeVisible();
      record(testInfo, c);
      expect.soft(c.n, c.log.join(' > ')).toBeLessThanOrEqual(6);

      await page.goto('/dashboard/elections/cast-vote');
      const card = page.getByRole('article').filter({ hasText: election.title });
      await expect(card.getByText('Voted', { exact: true })).toBeVisible();
      // Live totals during voting: UseCaseComplianceTest::test_live_standings_and_results_remain_anonymous_during_voting and PAPER M4.7.
      await expect(card.getByRole('link', { name: 'View live totals' })).toBeVisible();
      await expect(card.getByText('Available when voting closes')).toHaveCount(0);
    });

    test('J3 order and claim (ceiling 5 to place, 1 to check)', async ({ page }, testInfo) => {
      const account = who.order;
      const api = await apiAs(account);
      await uiLogin(page, account);
      const place = counter();

      await menuTo(page, place, { group: 'Store', leaf: 'Shop' });
      const product = page.getByRole('article').filter({ hasText: 'HIUSA Tote Bag' }).first();
      await tap(place, product.getByRole('button', { name: /Add to Cart/ }), 'Add to Cart');
      await tap(place, page.getByRole('button', { name: /^My Cart/ }), 'My Cart');
      await tap(place, page.getByRole('button', { name: 'Review & Continue' }), 'Review & Continue');
      await tap(place, page.getByRole('button', { name: 'Place Reservation' }), 'Place Reservation');
      await expect(page.getByText(/ORD-\d+ reserved/).first()).toBeVisible();
      record(testInfo, place, { phase: 'place' });
      expect.soft(place.n, place.log.join(' > ')).toBeLessThanOrEqual(5);

      const orders = await api.get('/orders');
      const placed = (orders.body.data || []).reduce((latest, order) => (!latest || order.id > latest.id ? order : latest), null);
      expect(placed, 'the order was created').toBeTruthy();
      const tag = `ORD-${placed.id}`;

      const check = counter();
      await menuTo(page, check, { group: 'Store', leaf: 'My orders' });
      record(testInfo, check, { phase: 'check' });
      expect.soft(check.n, check.log.join(' > ')).toBeLessThanOrEqual(1);

      const cardFor = () => page.getByRole('main').locator('div').filter({ has: page.getByText(tag, { exact: true }) }).filter({ hasText: /Step \d of \d/ }).last();
      await expect(cardFor()).toBeVisible();
      await expect(cardFor().getByText('Step 1 of 4: Reserved')).toBeVisible();
      await expect(cardFor().getByText(/pay cash at pickup/i).first()).toBeVisible();

      // Journey O-F2 through the API: the officer's Verify & Submit sends this same PATCH and only hands the
      // payment to the Admin, so the token is released once the Admin approves it too.
      const officer = await apiAs(OFFICER);
      const verified = await officer.patch(`/orders/${placed.id}/status`, { status: 'paid', verified_amount: placed.total_price });
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      await page.reload();
      await expect(cardFor().getByText('Payment verified: waiting for Admin approval').first()).toBeVisible();
      await expect(cardFor().getByText(/\b[A-Z0-9]{16}\b/)).toHaveCount(0);

      const admin = await apiAs(PSITS_ADMIN);
      const approved = await admin.patch(`/orders/${placed.id}/status`, { status: 'paid' });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      await page.reload();
      await expect(cardFor().getByText('Paid', { exact: true }).first()).toBeVisible();
      await expect(cardFor().getByText(/\b[A-Z0-9]{16}\b/).first()).toBeVisible();
    });

    test('J4 see what I owe (ceiling 2)', async ({ page }, testInfo) => {
      const account = who.owing;
      await ensureInvoice(account);
      await uiLogin(page, account);
      const c = counter();

      await menuTo(page, c, { group: 'My payments', leaf: 'Statement of account' });
      const main = page.getByRole('main');
      const balance = main.getByText('₱500.00').first();
      await expect(balance).toBeVisible();
      record(testInfo, c);
      expect.soft(c.n, c.log.join(' > ')).toBeLessThanOrEqual(2);
      expect.soft(await inViewport(page, balance), 'the balance is visible without scrolling').toBe(true);
      const clearance = main.getByText(/cleared|on hold|held/i).first();
      await expect.soft(clearance, 'the page says whether this student is cleared').toBeVisible({ timeout: 3000 });
      if (await clearance.count()) expect.soft(await inViewport(page, clearance), 'the clearance status is visible without scrolling').toBe(true);
    });

    test('J5 file a grievance and check clearance (ceiling 4 and 2)', async ({ page }, testInfo) => {
      const account = who.grievance;
      const description = `Journey grievance ${Date.now()}`;
      await uiLogin(page, account);
      const file = counter();

      await menuTo(page, file, { group: 'Support', leaf: 'My grievances' });
      const fileTab = page.getByRole('tab', { name: 'File a grievance' });
      if ((await fileTab.getAttribute('aria-selected')) !== 'true') await tap(file, fileTab, 'File a grievance');
      await page.getByRole('textbox', { name: "What's this about?" }).fill('Journey check');
      await page.getByRole('textbox', { name: 'Tell us what happened' }).fill(description);
      await tap(file, page.getByRole('button', { name: 'File this grievance' }), 'File this grievance');

      const row = page.getByText(description).first();
      await expect(row).toBeVisible();
      await expect(page.getByText(/Waiting for (Admin|SAO) to review/).first()).toBeVisible();
      record(testInfo, file, { phase: 'file' });
      expect.soft(file.n, file.log.join(' > ')).toBeLessThanOrEqual(4);

      const api = await apiAs(account);
      const signatories = (await api.get('/clearances/mine')).body?.[0]?.signatures ?? [];
      expect(signatories.length).toBeGreaterThan(0);

      const check = counter();
      await menuTo(page, check, { group: 'Support', leaf: 'My clearance' });
      record(testInfo, check, { phase: 'clearance' });
      expect.soft(check.n, check.log.join(' > ')).toBeLessThanOrEqual(2);
      const steps = page.getByRole('list', { name: 'Clearance signatures' });
      await expect(steps).toBeVisible();
      await expect(steps.getByRole('listitem'), 'one step per signatory').toHaveCount(signatories.length);
    });
  });
}
