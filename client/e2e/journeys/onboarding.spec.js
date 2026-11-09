import { expect, test } from '@playwright/test';
import { HEAD_CCS, SAO, apiAs, liveEnabled, shot, uiLogin } from '../support/live.js';
import { addStudentRecord, randomPassword } from '../support/pipeline.js';

// How people get an account without anyone typing a school ID for them: a student signs up against the
// school records, the SAO sends the dean a link, and the dean sends office staff a link. Each runs at 1440
// and 390 px, signs in through the screens, and ends on what the new person sees.
test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

const WIDTHS = [
  { label: '1440', viewport: { width: 1440, height: 900 } },
  { label: '390', viewport: { width: 390, height: 844 } },
];

// Each width takes its own college, so the two runs in one database do not compete.
const COLLEGE_FOR_DEAN = { 1440: 'College of Teacher Education', 390: 'College of Health Sciences' };

const runTag = Date.now().toString(36).slice(-5);

async function noSidewaysScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(1);
}

function tokenOf(link) {
  const token = new URL(link).searchParams.get('token');
  expect(token, 'the link carries a token').toBeTruthy();
  return token;
}

// The seed gives every college a dean. The SAO takes one off its college first, the way a change of dean starts.
async function vacateDeanOf(collegeName) {
  const sao = await apiAs(SAO);
  const colleges = await sao.get('/system/colleges');
  const college = (colleges.body?.data ?? colleges.body).find((item) => item.name === collegeName);
  expect(college, `${collegeName} is a college`).toBeTruthy();
  const head = college.department_head;
  if (head && head.account_status === 'active') {
    const deactivated = await sao.put(`/system/department-heads/${head.school_id ?? head.id}`, { account_status: 'inactive' });
    expect(deactivated.ok, JSON.stringify(deactivated.body).slice(0, 200)).toBe(true);
  }
}

// Sign-up and invitation endpoints share a short per-address limit (5 a minute), so a long run can be told to
// wait. Wait it out and submit again instead of failing on the limit.
async function retryWhileThrottled(page, action, check) {
  for (let attempt = 0; ; attempt += 1) {
    await action();
    try {
      await check();
      return;
    } catch (error) {
      const throttled = await page.getByText(/Too many requests/).isVisible().catch(() => false);
      if (!throttled || attempt >= 5) throw error;
      await page.waitForTimeout(15_000);
    }
  }
}

async function acceptInvitation(page, token, person, landing) {
  await page.goto(`/accept-invitation?token=${encodeURIComponent(token)}`);
  await page.getByLabel('First name').fill(person.firstName);
  await page.getByLabel('Last name').fill(person.lastName);
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByLabel('Confirm password').fill(person.password);
  await retryWhileThrottled(
    page,
    () => page.getByRole('button', { name: 'Create account' }).click(),
    () => expect(page).toHaveURL(landing, { timeout: 20_000 }),
  );
}

for (const { label, viewport } of WIDTHS) {
  test.describe(`Getting an account at ${label}px`, () => {
    test.use({ viewport });
    test.describe.configure({ timeout: 150_000 });

    test(`ON-1 ${label}px: a student signs up with a school ID and birth date`, async ({ page }) => {
      const record = await addStudentRecord('Signup');
      const email = `signup.${runTag}.${label}@journey.test`;
      const password = randomPassword();

      await page.goto('/login');
      await expect(page.getByRole('link', { name: /Create your account/ })).toHaveAttribute('href', '/sign-up');
      await page.goto('/sign-up');
      // One form: the school ID and birth date are matched against the school records when the account is created.
      await page.getByLabel('School ID').fill(String(record.schoolId));
      await page.getByLabel('Birth date').fill(record.birthDate);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm password').fill(password);
      const found = page.getByRole('region', { name: 'Your school record' });
      await retryWhileThrottled(
        page,
        () => page.getByRole('button', { name: 'Create account' }).click(),
        () => expect(found).toContainText(record.name, { timeout: 20_000 }),
      );
      await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
      await expect(found).toContainText('College of Computer Studies');
      await noSidewaysScroll(page);
      await page.screenshot({ path: shot(`ON-1-${label}.png`) });

      await page.getByRole('button', { name: 'Open my dashboard' }).click();
      await expect(page).toHaveURL(/\/dashboard\/student/, { timeout: 20_000 });
      await expect(page.getByRole('navigation').first()).toBeVisible();
    });

    test(`ON-1b ${label}px: a wrong birth date gets the same answer as a wrong school ID`, async ({ page }) => {
      const record = await addStudentRecord('Mismatch');
      await page.goto('/sign-up');
      await page.getByLabel('School ID').fill(String(record.schoolId));
      await page.getByLabel('Birth date').fill('2001-01-01');
      await page.getByLabel('Email').fill(`mismatch.${runTag}.${label}@journey.test`);
      const password = randomPassword();
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm password').fill(password);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('alert').filter({ hasText: "We couldn't match that school ID and birth date with the school records." })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Your school record' })).toHaveCount(0);
    });

    test(`ON-2 ${label}px: the SAO sends a dean a link and the dean sets up their own account`, async ({ page, browser }) => {
      const college = COLLEGE_FOR_DEAN[viewport.width];
      await vacateDeanOf(college);
      const dean = { firstName: 'Journey', lastName: `Dean ${runTag}${label}`, email: `dean.${runTag}.${label}@journey.test`, password: randomPassword() };

      await uiLogin(page, SAO);
      await page.goto('/dashboard/super-admin/colleges');
      await page.getByRole('button', { name: 'Invite Department Head' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Invite Department Head' });
      await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
      await dialog.getByLabel('College').selectOption({ label: college });
      await dialog.getByRole('button', { name: 'Create link' }).click();
      const ready = page.getByRole('dialog', { name: 'Link ready' });
      const link = await ready.getByLabel('Invitation link').inputValue();
      await page.screenshot({ path: shot(`ON-2-link-${label}.png`) });
      await ready.getByRole('button', { name: 'Done' }).click();

      const context = await browser.newContext({ viewport });
      const invited = await context.newPage();
      await invited.goto(`/accept-invitation?token=${encodeURIComponent(tokenOf(link))}`);
      await expect(invited.getByRole('heading', { name: `You're invited to lead ${college}` })).toBeVisible();
      await expect(invited.getByLabel('School ID')).toHaveCount(0);
      await noSidewaysScroll(invited);
      await acceptInvitation(invited, tokenOf(link), dean, /\/dashboard\/department-head/);
      await expect(invited.getByRole('navigation').first()).toBeVisible();

      await context.close();

      // The same link a second time, from a browser that is not signed in, is refused.
      const stranger = await browser.newContext({ viewport });
      const again = await stranger.newPage();
      await again.goto(`/accept-invitation?token=${encodeURIComponent(tokenOf(link))}`);
      await expect(again.getByText('This invitation link was already used')).toBeVisible();
      await stranger.close();
    });

    test(`ON-3 ${label}px: a dean sends office staff a link`, async ({ page, browser }) => {
      const staff = { firstName: 'Journey', lastName: `Staff ${runTag}${label}`, email: `staff.${runTag}.${label}@journey.test`, password: randomPassword() };

      await uiLogin(page, HEAD_CCS);
      await page.goto('/dashboard/department-head/people');
      await page.getByRole('tab', { name: 'Office staff' }).click();
      await page.getByRole('button', { name: 'Add staff' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add office staff' });
      // With no employee records loaded the drawer opens on the plain link form; with records it offers it as a link.
      const plainLink = dialog.getByRole('button', { name: /Create a plain invite link/ });
      await expect(dialog.getByLabel(/^Position/).or(plainLink)).toBeVisible();
      if (await plainLink.isVisible()) await plainLink.click();
      await dialog.getByLabel(/^Position/).fill('College Secretary');
      await dialog.getByRole('button', { name: 'Create invite link' }).click();
      const link = await dialog.getByLabel('Invite link').inputValue();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();

      const context = await browser.newContext({ viewport });
      const invited = await context.newPage();
      await invited.goto(`/accept-invitation?token=${encodeURIComponent(tokenOf(link))}`);
      await expect(invited.getByRole('heading', { name: "You're invited to College of Computer Studies as office staff" })).toBeVisible();
      await noSidewaysScroll(invited);
      await acceptInvitation(invited, tokenOf(link), staff, /\/dashboard\//);
      await context.close();

      await page.reload();
      const staffTab = page.getByRole('tab', { name: 'Office staff' });
      await expect(async () => {
        await staffTab.click();
        await expect(staffTab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await expect(page.getByText(`Journey Staff ${runTag}${label}`).filter({ visible: true }).first()).toBeVisible();
    });
  });
}
