import { expect, test } from '@playwright/test';
import { OFFICER_AUDITOR, OFFICER_BOOKER, PSITS_ADMIN, PSITS_ORGANIZATION_ID, apiAs, liveEnabled, uiLogin } from '../support/live.js';

// An officer is limited to the areas the organization head ticked for the profile (account_profiles.modules).
// The seeded officers hold every area, so this spec narrows two of them through the Admin's People and access API,
// proves the ticked area works in the browser and an unticked one is refused, then gives every area back.
// Runs on the seeded database after student, so the seeded events and the ledger are still as the seeder left them.
test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');
test.describe.configure({ mode: 'serial' });

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

// Narrows the officer's profile in the PSITS organization to these areas. Returns what to put back.
async function limitModules(officer, modules) {
  const admin = await apiAs(PSITS_ADMIN);
  const found = await admin.get(`/account-profiles?organization_id=${PSITS_ORGANIZATION_ID}&user_school_id=${officer.schoolId}`);
  expect(found.ok, JSON.stringify(found.body).slice(0, 200)).toBe(true);
  const profile = found.body.data.find((row) => row.role === 'SBO_OFFICER');
  expect(profile, `officer ${officer.schoolId} has an officer profile in the organization`).toBeTruthy();
  const changed = await admin.put(`/account-profiles/${profile.id}`, { role: 'SBO_OFFICER', position_title: profile.position_title, modules });
  expect(changed.ok, JSON.stringify(changed.body).slice(0, 200)).toBe(true);
  expect(changed.body.modules).toEqual(modules);
  return { id: profile.id, position_title: profile.position_title, modules: profile.modules };
}

async function restoreModules(original) {
  const admin = await apiAs(PSITS_ADMIN);
  const restored = await admin.put(`/account-profiles/${original.id}`, { role: 'SBO_OFFICER', position_title: original.position_title, modules: original.modules });
  expect(restored.ok, JSON.stringify(restored.body).slice(0, 200)).toBe(true);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const viewport of WIDTHS) {
  test.describe(`SBO_OFFICER with limited areas at ${viewport.width}px`, () => {
    test.use({ viewport });
    test.describe.configure({ timeout: 120_000 });

    test(`OM-1 ${viewport.width}px: an officer ticked for events and tasks checks a member in and is kept out of finance`, async ({ page }) => {
      const original = await limitModules(OFFICER_BOOKER, ['events', 'tasks']);
      try {
        const admin = await apiAs(PSITS_ADMIN);
        const events = (await admin.get('/events?per_page=100')).body.data;
        const event = events.find((row) => row.status === 'ongoing') || events.find((row) => row.status === 'approved');
        expect(event, 'an ongoing or approved event to check in to').toBeTruthy();
        const attendance = (await admin.get(`/events/${event.id}/attendance?per_page=50`)).body;
        const present = new Set((attendance.records || []).map((record) => String(record.user?.school_id)));
        const students = (await admin.get('/users?role=STUDENT&per_page=100')).body.data;
        const member = students.find((student) => !present.has(String(student.school_id)));
        expect(member, 'a student who is not yet checked in').toBeTruthy();

        const officer = await apiAs(OFFICER_BOOKER);
        const ledger = await officer.get('/transactions?per_page=10');
        expect(ledger.status, 'finance is not one of this officer\'s areas').toBe(403);

        await uiLogin(page, OFFICER_BOOKER);
        await page.goto('/dashboard/events/check-in');
        const attendanceCount = page.locator('dt').filter({ hasText: /^Arrivals$/ }).locator('xpath=following-sibling::dd[1]');
        const preselected = await attendanceCount.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
        if (!preselected) await page.getByRole('button', { name: new RegExp(`^Open attendance for ${escapeRegExp(event.title)}`, 'i') }).click();
        await expect(attendanceCount).toHaveText(/^\d+$/);
        const before = Number(await attendanceCount.textContent());

        const memberName = `${member.first_name} ${member.last_name}`;
        await page.getByRole('combobox', { name: 'Member' }).fill(memberName);
        await page.getByRole('option', { name: new RegExp(escapeRegExp(memberName)) }).first().click();
        await page.getByRole('button', { name: /Confirm check-in/i }).click();
        await expect(attendanceCount).toHaveText(String(before + 1));

        await expect(page.getByRole('link', { name: 'Ledger', exact: true })).toHaveCount(0);
      } finally {
        await restoreModules(original);
      }
    });

    test(`OM-2 ${viewport.width}px: an officer ticked for finance sees the ledger and is kept out of events`, async ({ page }) => {
      const original = await limitModules(OFFICER_AUDITOR, ['finance']);
      try {
        const admin = await apiAs(PSITS_ADMIN);
        const rows = (await admin.get('/transactions?per_page=10')).body.data;
        const entry = rows.find((row) => row.description && row.description.length > 8);
        expect(entry, 'a seeded ledger entry with a description').toBeTruthy();

        const officer = await apiAs(OFFICER_AUDITOR);
        const eventsRead = await officer.get('/events/1/attendance');
        expect(eventsRead.status, 'events are not one of this officer\'s areas').toBe(403);

        await uiLogin(page, OFFICER_AUDITOR);
        await page.goto('/dashboard/finance/financial-ledger');
        await expect(page.getByRole('main').getByRole('heading', { name: 'Ledger', level: 1 })).toBeVisible();
        await expect(page.getByRole('main').getByText(entry.description, { exact: false }).locator('visible=true').first()).toBeVisible();
      } finally {
        await restoreModules(original);
      }
    });
  });
}
