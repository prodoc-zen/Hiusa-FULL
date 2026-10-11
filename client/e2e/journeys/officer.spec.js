import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { OFFICER, PSITS_ADMIN, STUDENT_B, apiAs, liveEnabled, uiLogin } from '../support/live.js';

// Acceptance journeys for the SBO_OFFICER role (docs/UX_FLOW.md section 9). Each journey starts at the
// role home after a real sign-in, counts only mouse or tap actions, and ends on a visible-state assertion.
test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const SHOTS = process.env.HIUSA_JOURNEY_SHOTS || path.join(process.cwd(), 'test-results', 'journeys', 'officer');
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

function flowFor() {
  let clicks = 0;
  return {
    get clicks() { return clicks; },
    async tap(locator, options) {
      await locator.click(options);
      clicks += 1;
    },
  };
}

// Opens a sidebar leaf the way a person does: the menu button below the desktop breakpoint, the group
// row, then the leaf unless the group already landed on it. A leaf that is already listed is tapped directly.
async function openFromMenu(page, flow, group, leaf) {
  const mobile = page.viewportSize().width < 1024;
  if (mobile) await flow.tap(page.getByRole('button', { name: 'Open menu' }));
  const sidebar = page.locator('aside');
  const link = sidebar.getByRole('link', { name: leaf, exact: true });
  if (await link.isVisible()) {
    await flow.tap(link);
    return;
  }
  await flow.tap(sidebar.getByRole('button', { name: group, exact: true }));
  const landed = mobile ? false : await expect(link).toHaveAttribute('aria-current', 'page', { timeout: 2500 }).then(() => true, () => false);
  if (!landed) await flow.tap(link);
}

async function openRowActions(page, flow, scope) {
  const trigger = scope.getByRole('button', { name: /^Actions for / });
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await flow.tap(trigger);
  await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 });
}

async function layoutReport(page) {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    const overflowing = [];
    const scrollsInside = [];
    const describe = (element) => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(/\s+/)[0]}` : ''}`;
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || element.closest('[inert]')) continue;
      if (['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1 && scrollsInside.length < 4) {
        scrollsInside.push(`${describe(element)} content=${element.scrollWidth} box=${element.clientWidth}`);
      }
      if (box.right > viewport + 1) {
        let clipped = false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflowX = window.getComputedStyle(parent).overflowX;
          if (['auto', 'scroll', 'hidden'].includes(overflowX) && parent.getBoundingClientRect().right <= viewport + 1) { clipped = true; break; }
        }
        if (!clipped && overflowing.length < 5) overflowing.push(`${describe(element)} right=${Math.round(box.right)}`);
      }
    }
    return { viewport, scrollWidth: document.documentElement.scrollWidth, horizontalScroll: document.documentElement.scrollWidth > viewport + 1, overflowing, scrollsInside };
  });
}

// Ends a journey: the tap count is checked first (soft, so the end state is still judged), then the
// visible-state assertion runs last. Whatever it decides, the end screen is photographed and measured.
async function finish(page, flow, { id, ceiling, endLocator, end, notes }) {
  expect.soft(flow.clicks, 'mouse or tap actions').toBeLessThanOrEqual(ceiling);
  try {
    await end();
  } finally {
    fs.mkdirSync(SHOTS, { recursive: true });
    const viewport = page.viewportSize();
    const box = await endLocator().first().boundingBox().catch(() => null);
    const endInView = Boolean(box) && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height;
    await page.screenshot({ path: path.join(SHOTS, `${id}-${viewport.width}.png`) });
    await endLocator().first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, `${id}-${viewport.width}-scrolled.png`) });
    const layout = await layoutReport(page);
    const line = { id, width: viewport.width, clicks: flow.clicks, ceiling, notes, endInView, endBox: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }, layout };
    fs.appendFileSync(path.join(SHOTS, 'results.jsonl'), `${JSON.stringify(line)}\n`);
    console.log(`JOURNEY ${JSON.stringify(line)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const viewport of WIDTHS) {
  test.describe(`SBO_OFFICER journeys at ${viewport.width}px`, () => {
    test.use({ viewport });
    test.describe.configure({ timeout: 120_000 });

    test('O1 check someone in (ceiling 4)', async ({ page }) => {
      const admin = await apiAs(PSITS_ADMIN);
      const events = (await admin.get('/events?per_page=100')).body.data;
      const event = events.find((row) => row.status === 'ongoing') || events.find((row) => row.status === 'approved');
      expect(event, 'an ongoing or approved event to check in to').toBeTruthy();
      const attendance = (await admin.get(`/events/${event.id}/attendance?per_page=50`)).body;
      const present = new Set((attendance.records || []).map((record) => String(record.user?.school_id)));
      const students = (await admin.get('/users?role=STUDENT&per_page=100')).body.data;
      const member = students.find((student) => !present.has(String(student.school_id)));
      expect(member, 'a student who is not yet checked in').toBeTruthy();

      await uiLogin(page, OFFICER);
      const flow = flowFor();

      await openFromMenu(page, flow, 'Events and tasks', 'Check-in');
      await flow.tap(page.getByRole('button', { name: new RegExp(`^Open attendance for ${escapeRegExp(event.title)}`, 'i') }));
      const attendanceCount = page.getByText('Attendance records', { exact: true }).locator('xpath=following-sibling::p[1]');
      await expect(attendanceCount).toHaveText(/^\d+$/);
      const before = Number(await attendanceCount.textContent());

      await page.locator('#attendance-member-search').fill(String(member.school_id));
      await flow.tap(page.getByRole('button', { name: new RegExp(`${member.school_id} · `) }));
      await flow.tap(page.getByRole('button', { name: /Confirm Check-In/ }));

      await finish(page, flow, {
        id: 'O1',
        ceiling: 4,
        endLocator: () => attendanceCount,
        end: () => expect(attendanceCount).toHaveText(String(before + 1)),
      });
    });

    test('O2 verify a payment and release an order (ceiling 6)', async ({ page }) => {
      const student = await apiAs(STUDENT_B);
      const catalog = (await student.get('/merchandise?per_page=50')).body.data;
      const item = catalog.find((row) => row.is_active && row.stock_quantity > 2 && !(row.variants || []).length);
      expect(item, 'a stocked product without variants').toBeTruthy();
      const placed = await student.post('/orders', { merchandise_id: item.id, quantity: 1, payment_method: 'cash' });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const orderId = placed.body.id;

      await uiLogin(page, OFFICER);
      const flow = flowFor();

      await openFromMenu(page, flow, 'Store', 'Orders');
      const orderEntry = () => page.getByRole('row').filter({ hasText: `ORD-${orderId}` }).or(page.locator('article:visible').filter({ hasText: `ORD-${orderId}` }));
      await expect(orderEntry()).toBeVisible();
      const verifyButton = orderEntry().getByRole('button', { name: 'Verify', exact: true });
      if (await verifyButton.isVisible()) {
        await flow.tap(verifyButton);
      } else {
        await openRowActions(page, flow, orderEntry());
        await flow.tap(page.getByRole('menuitem', { name: 'Verify & submit' }));
      }
      await flow.tap(page.getByRole('dialog', { name: 'Verify merchandise payment' }).getByRole('button', { name: 'Verify & Submit' }));
      await expect(page.getByRole('dialog', { name: 'Verify merchandise payment' })).toBeHidden();

      // An officer's verification is only the first review: the Admin approves it and the buyer's token is issued.
      const admin = await apiAs(PSITS_ADMIN);
      const approved = await admin.patch(`/orders/${orderId}/status`, { status: 'paid' });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const token = (await student.get(`/orders/${orderId}`)).body.claim_token;
      expect(token, 'the buyer sees the claim token once the payment is approved').toMatch(/^[A-Z0-9]{16}$/);

      await openFromMenu(page, flow, 'Store', 'Claim desk');
      await page.getByLabel('16-character claim token').fill(token);
      await flow.tap(page.getByRole('button', { name: 'Claim', exact: true }));
      await flow.tap(page.getByRole('button', { name: 'Confirm Claim / Release' }));

      // The claim desk register only lists orders still waiting, so the stepper is looked for where the order shows it.
      const stepper = page.getByRole('progressbar', { name: `ORD-${orderId} progress` });
      if (!(await stepper.isVisible().catch(() => false))) {
        await openFromMenu(page, flow, 'Store', 'Orders');
      }
      await expect(orderEntry()).toBeVisible();

      await finish(page, flow, {
        id: 'O2',
        ceiling: 6,
        endLocator: () => orderEntry().getByText('Claimed', { exact: true }),
        end: async () => {
          await expect(orderEntry().getByText('Claimed', { exact: true })).toBeVisible();
          await expect(orderEntry().getByRole('progressbar', { name: `ORD-${orderId} progress` })).toHaveAttribute('aria-valuetext', /^Complete:/);
        },
      });
    });

    test('O3 update my task (ceiling 3)', async ({ page }) => {
      const admin = await apiAs(PSITS_ADMIN);
      // Earlier runs leave open journey tasks behind; an officer with too many open tasks stops being eligible.
      const leftovers = (await admin.get('/tasks?per_page=50')).body.data.filter((task) => task.title.startsWith('Journey task'));
      for (const task of leftovers) await admin.delete(`/tasks/${task.id}`);
      const title = `Journey task ${viewport.width} ${Date.now()}`;
      const recommendation = await admin.post('/tasks/recommendation', { title, task_type: 'regular', category: 'coordination', preferred_role: null });
      const eligible = (recommendation.body?.delegation?.rankings || []).map((entry) => String(entry.officer_id));
      expect(eligible, 'the officer must be eligible for a task').toContain(String(OFFICER.schoolId));
      const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const created = await admin.post('/tasks', { title, description: 'Acceptance journey task.', deadline, status: 'pending', assigned_to: OFFICER.schoolId, task_kind: 'standalone', category: 'coordination', priority: 'medium', task_type: 'regular' });
      expect(created.status, JSON.stringify(created.body)).toBe(201);

      await uiLogin(page, OFFICER);
      const flow = flowFor();

      await openFromMenu(page, flow, 'Events and tasks', 'My tasks');
      await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
      const taskRow = page.getByRole('row').filter({ hasText: title });
      const card = (await taskRow.count()) > 0
        ? taskRow.first()
        : page.locator('div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: 'View details' }) }).last();
      await expect(card).toBeVisible();
      const start = card.getByRole('button', { name: 'Start', exact: true });
      if (await start.isVisible()) {
        await flow.tap(start);
      } else {
        await openRowActions(page, flow, card);
        await flow.tap(page.getByRole('menuitem', { name: 'Start task' }));
      }

      await finish(page, flow, {
        id: 'O3',
        ceiling: 3,
        endLocator: () => card.getByText(/^In[ _]progress$/i),
        end: () => expect(card.getByText(/^In[ _]progress$/i)).toBeVisible(),
      });
    });

    test('O4 send an announcement for approval (ceiling 4)', async ({ page }) => {
      const title = `Journey announcement ${viewport.width} ${Date.now()}`;
      await uiLogin(page, OFFICER);
      const flow = flowFor();

      await openFromMenu(page, flow, 'Updates', 'Announcements');
      await flow.tap(page.getByRole('link', { name: 'New announcement' }).or(page.getByRole('button', { name: 'New announcement' })).first());
      await page.locator('#announcement-title').fill(title);
      await page.locator('#announcement-content').fill('Acceptance journey announcement body.');
      await flow.tap(page.getByRole('button', { name: /^Publish Now$/ }));
      await flow.tap(page.getByRole('dialog').getByRole('button', { name: 'Publish Now' }));
      await expect(page.getByRole('button', { name: 'Go Back' })).toBeVisible();
      const sentHeading = page.getByRole('heading', { level: 2 }).filter({ hasText: /Posted|Saved/ });
      const sentScreen = `${await sentHeading.innerText()} | ${await sentHeading.locator('xpath=following-sibling::p[1]').innerText()}`;

      const rowFor = () => page.getByRole('row').filter({ hasText: title });
      await flow.tap(page.getByRole('button', { name: 'Go Back' }));
      await expect(rowFor()).toBeVisible();

      await finish(page, flow, {
        id: 'O4',
        ceiling: 4,
        notes: { sentScreen },
        endLocator: () => rowFor().getByText('Waiting for Admin approval'),
        end: () => expect(rowFor().getByText('Waiting for Admin approval')).toBeVisible(),
      });
    });
  });
}
