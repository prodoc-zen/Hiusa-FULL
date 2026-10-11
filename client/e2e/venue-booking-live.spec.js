import { expect, test } from '@playwright/test';
import { OFFICER, PSITS_ADMIN, SAO, apiAs, collect, liveEnabled, newSink, uiLogin } from './support/live.js';

// The Admin and the Officer book venues from /dashboard/venues. This checks, against a real API, that the
// availability timeline still shows who holds a slot, that a clashing request is refused with the server's
// reason, and that a free slot can be requested, both from the booking page and from an event's Book venue link.
// Set HIUSA_LIVE_E2E=1 to run it. It writes real rows to the dev database.

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');
test.describe.configure({ mode: 'serial' });
test.use({ timezoneId: 'Asia/Manila' });

const sink = newSink();

function manilaDay(offsetDays) {
  return new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// Frees every slot the organization holds on a day, so the spec can run again on the same database.
async function releaseDay(api, venueId, day) {
  const rows = (await api.get('/venue-bookings?per_page=100')).body.data;
  const held = rows.filter((row) => row.venue_id === venueId && ['pending', 'approved'].includes(row.status)
    && new Date(new Date(row.start_time).getTime() + 8 * 3600_000).toISOString().slice(0, 10) === day);
  for (const row of held) await api.patch(`/venue-bookings/${row.id}/withdraw`);
}

for (const [index, account] of [[1, PSITS_ADMIN], [3, OFFICER]]) {
  test(`${account.role} sees availability, is told about a conflict and books a free slot`, async ({ page }) => {
    test.setTimeout(150_000);
    collect(page, account.role, sink);
    const api = await apiAs(account);
    const sao = await apiAs(SAO);
    const venues = (await api.get('/venues?per_page=100')).body.data;
    const venue = venues.find((item) => item.is_active !== false);
    expect(venue, 'a seeded active venue').toBeTruthy();

    const day = manilaDay(index);
    await releaseDay(api, venue.id, day);
    const held = await api.post('/venue-bookings', { venue_id: venue.id, start_time: `${day}T09:00:00+08:00`, end_time: `${day}T11:00:00+08:00` });
    expect(held.status, 'the held booking is created').toBe(201);

    try {
      await uiLogin(page, account);
      await page.goto('/dashboard/venues', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
      await expect(page.getByLabel('Venue', { exact: true })).toHaveValue(String(venues[0].id), { timeout: 15000 });
      if (String(venues[0].id) !== String(venue.id)) await page.getByLabel('Venue', { exact: true }).selectOption(String(venue.id));

      await page.getByRole('button', { name: new RegExp(`^${new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
      await expect(page.getByText(/Pending request from Your organization/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByLabel('Booking hours, 5 AM to 10 PM')).toBeVisible();

      await page.getByRole('button', { name: 'Request this venue' }).click();
      const dialog = page.getByRole('dialog', { name: 'Request a venue booking' });
      await dialog.getByLabel(/^Start/).fill(`${day}T10:00`);
      await dialog.getByLabel(/^End/).fill(`${day}T12:00`);
      await dialog.getByRole('button', { name: 'Send request' }).click();
      await expect(dialog.getByRole('alert')).toContainText(/already has a pending or approved booking/i, { timeout: 15000 });

      await dialog.getByLabel(/^Start/).fill(`${day}T13:00`);
      await dialog.getByLabel(/^End/).fill(`${day}T15:00`);
      await dialog.getByRole('button', { name: 'Send request' }).click();
      const sent = page.getByRole('dialog', { name: 'Booking request sent' });
      await expect(sent).toBeVisible({ timeout: 15000 });
      await sent.getByRole('button').first().click();
      await expect(page.getByText('Waiting for SAO approval').first()).toBeVisible({ timeout: 15000 });

      const mine = (await api.get('/venue-bookings?per_page=100')).body.data.filter((item) => item.venue_id === venue.id && String(item.start_time).startsWith(day));
      expect(mine.length, 'the held booking and the new request are both on file').toBeGreaterThanOrEqual(2);

      const slots = (await sao.get(`/venues/${venue.id}/availability?from=${day}&to=${manilaDay(index + 1)}`)).body;
      expect(slots.every((slot) => slot.organization && 'event_title' in slot), 'the SAO payload still names the organization and event').toBe(true);
      const own = (await api.get(`/venues/${venue.id}/availability?from=${day}&to=${manilaDay(index + 1)}`)).body;
      expect(own.length).toBeGreaterThanOrEqual(2);
      expect(own.every((slot) => !('organization' in slot) && !('event_title' in slot)), 'organizations only get their own slots by name').toBe(true);
    } finally {
      await releaseDay(api, venue.id, day);
    }
  });
}

test('Admin books a venue from an event and the booking is linked and withdrawn with the cancelled event', async ({ page }) => {
  test.setTimeout(150_000);
  collect(page, 'ADMIN', sink);
  const api = await apiAs(PSITS_ADMIN);
  const venue = (await api.get('/venues?per_page=100')).body.data.find((item) => item.is_active !== false);
  const day = manilaDay(6);
  const title = `E2E venue picker event ${Date.now()}`;
  const event = await api.post('/events', {
    title, description: 'throwaway', start_time: `${day}T14:00:00`, end_time: `${day}T16:00:00`, location: venue.name,
    planning_details: { venue_type: 'on_campus', venue_id: venue.id },
  });
  expect([200, 201], `the event is created: ${JSON.stringify(event.body).slice(0, 200)}`).toContain(event.status);

  await uiLogin(page, PSITS_ADMIN);
  await page.goto(`/dashboard/venues?event=${event.body.id}`, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Request a venue booking' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByRole('combobox', { name: /Link to an event/ })).toHaveValue(String(event.body.id));
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('dialog', { name: 'Booking request sent' })).toBeVisible({ timeout: 15000 });

  const linked = (await api.get('/venue-bookings?per_page=100')).body.data.find((item) => item.event_id === event.body.id);
  expect(linked?.status).toBe('pending');
  expect((await api.delete(`/events/${event.body.id}`)).status, 'a held venue blocks deleting the event').toBe(409);
  expect((await api.patch(`/events/${event.body.id}/status`, { status: 'cancelled' })).status).toBe(200);
  const after = (await api.get('/venue-bookings?per_page=100')).body.data.find((item) => item.id === linked.id);
  expect(after.status, 'cancelling the event frees the venue').toBe('withdrawn');
  expect((await api.delete(`/events/${event.body.id}`)).status).toBe(200);
  expect(sink.pageErrors, 'uncaught page errors on the booking page').toEqual([]);
});
