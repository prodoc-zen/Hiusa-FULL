import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { HEAD_CCS, PSITS_ADMIN, STUDENT, STUDENT_B, apiAs, injectSession, liveEnabled, openRowMenu, pdfFile, sessionFor } from './support/live.js';

test.skip(!liveEnabled, 'Set HIUSA_LIVE_E2E=1 to run against the seeded local Laravel API.');

// The election process where students file their own candidacy (docs/qa/ELECTION-DEMO-IMPACT.md), from the
// Admin's proposal to a student's ballot receipt. The phases move by themselves from the schedule: filing
// closes about a minute and a half after the proposal, and the election then waits in screening until the
// Admin has answered every application, so the Admin's click never races the clock.
test.describe.configure({ timeout: 300_000 });

const FILING_SECONDS = 100;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function formFor(fields) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  return form;
}

function attach(form, name, file) {
  form.append(name, new Blob([file.buffer], { type: file.mimeType }), file.name);
}

// A proposal with every date near: filing is already open, closes in FILING_SECONDS, and voting opens the
// moment screening has nothing left to decide. The ballot has two positions so a voter can skip one.
function proposal(title) {
  const now = Date.now();
  const at = (seconds) => new Date(now + seconds * 1000).toISOString();
  const form = formFor({
    title,
    description: 'Created by the full process end-to-end spec.',
    filing_starts_at: at(-60),
    filing_ends_at: at(FILING_SECONDS),
    screening_starts_at: at(FILING_SECONDS),
    screening_ends_at: at(FILING_SECONDS + 5),
    campaign_starts_at: at(FILING_SECONDS + 5),
    campaign_ends_at: at(FILING_SECONDS + 10),
    start_time: at(FILING_SECONDS + 10),
    end_time: at(2 * 86400),
    results_publish_at: at(2 * 86400 + 600),
    rules: 'Candidates follow the organization code of conduct.\nOne candidacy per student.',
    tie_break_rule: 'The Department Head decides by the candidate with the higher attendance record.',
    min_units: '10',
    'positions[0][title]': 'Full Process Representative',
    'positions[0][max_winners]': '1',
    'positions[1][title]': 'Full Process Secretary',
    'positions[1][max_winners]': '1',
  });
  attach(form, 'informative_letter', pdfFile('informative-letter.pdf', 'Informative letter'));
  return form;
}

async function fileCandidacyAsApi(student, electionId, positionId) {
  const form = formFor({ position_id: String(positionId), platform: 'Added through the API.', rules_accepted: '1', submit: '1' });
  attach(form, 'photo', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  attach(form, 'coc', pdfFile('coc.pdf', 'Certificate of candidacy'));
  attach(form, 'credentials', pdfFile('credentials.pdf', 'Credentials'));
  return student.post(`/elections/${electionId}/applications`, form);
}

test('a student files, the Admin approves, and the student votes with a skipped position', async ({ page }) => {
  const admin = await apiAs(PSITS_ADMIN);
  const head = await apiAs(HEAD_CCS);
  const studentB = await apiAs(STUDENT_B);
  const title = `Full process ${Date.now()}`;
  let electionId = null;

  try {
    // 1. The Admin proposes the election and the Department Head approves it.
    const created = await admin.post('/elections', proposal(title));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    electionId = created.body.id;
    expect(created.body.approval_id).toBeTruthy();
    const approved = await head.patch(`/approval-requests/${created.body.approval_id}`, { status: 'approved' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    // Reading the election runs the phase sync, so filing has opened by itself.
    const opened = await admin.get(`/elections/${electionId}`);
    expect(opened.status).toBe(200);
    expect(opened.body.phase).toBe('filing');
    const [representative, secretary] = [...opened.body.positions].sort((a, b) => a.id - b.id);

    // 2. A student reads the rules and files as an individual.
    await injectSession(page, await sessionFor(STUDENT));
    await page.goto('/dashboard/elections/cast-vote');
    const card = page.getByRole('article').filter({ hasText: title });
    await expect(card.getByText('Filing', { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'Read the rules and file candidacy' }).click();

    await expect(page.getByRole('heading', { name: 'Official rules' })).toBeVisible();
    await expect(page.getByText('Candidates follow the organization code of conduct.')).toBeVisible();
    // Nothing can be filed until the rules are accepted.
    await expect(page.getByRole('button', { name: 'File as an individual' })).toBeDisabled();
    await page.getByLabel('I have read and accept the official rules').check();
    await page.getByRole('button', { name: 'File as an individual' }).click();
    await page.getByLabel('Position', { exact: true }).selectOption({ label: representative.title });
    await page.getByLabel('Formal photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    const coc = pdfFile('coc.pdf', 'Certificate of candidacy');
    await page.getByLabel('Certificate of Candidacy').setInputFiles({ name: coc.name, mimeType: coc.mimeType, buffer: coc.buffer });
    const credentials = pdfFile('credentials.pdf', 'Credentials');
    await page.getByLabel('Credentials', { exact: true }).setInputFiles({ name: credentials.name, mimeType: credentials.mimeType, buffer: credentials.buffer });
    await page.getByLabel('Campaign platform').fill('Simple, open and on time.');
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Candidacy submitted for screening.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My candidacy' })).toBeVisible();
    await expect(page.getByText('Pending review')).toBeVisible();

    // A second student fills the other position through the API, so the ballot has two positions.
    const second = await fileCandidacyAsApi(studentB, electionId, secretary.id);
    expect(second.status, JSON.stringify(second.body)).toBeLessThan(300);

    // 3. Filing closes by itself; the election waits in screening for the Admin.
    await expect.poll(async () => (await admin.get(`/elections/${electionId}`)).body.phase, { timeout: 150_000, intervals: [3000] }).toBe('screening');

    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await injectSession(page, await sessionFor(PSITS_ADMIN));
    await page.goto(`/dashboard/elections/applications?record=${electionId}`);
    const row = page.getByRole('row').filter({ hasText: 'Juan Dela Vega' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending review')).toBeVisible();
    await openRowMenu(page, row);
    await page.getByRole('menuitem', { name: 'Approve', exact: true }).click();
    await page.getByRole('dialog', { name: 'Approve application' }).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(row.getByText('Approved')).toBeVisible();

    const pending = await admin.get(`/elections/${electionId}/applications`);
    const other = pending.body.applications.find((application) => application.status === 'pending_review');
    expect(other, 'the second application is still waiting').toBeTruthy();
    const reviewed = await admin.patch(`/elections/${electionId}/applications/${other.id}/review`, { decision: 'approve' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);

    // 4. With nothing left to decide the election moves on and the ballot locks when voting opens.
    await expect.poll(async () => (await admin.get(`/elections/${electionId}`)).body.phase, { timeout: 60_000, intervals: [3000] }).toBe('voting');

    // 5. The student votes for one position and skips the other.
    await page.evaluate(() => window.localStorage.clear());
    await injectSession(page, await sessionFor(STUDENT));
    await page.goto(`/elections/${electionId}/vote`);
    await page.getByRole('button', { name: 'Start my ballot' }).click();
    await expect(page.getByRole('heading', { name: representative.title })).toBeVisible();
    await expect(page.getByText('Choose one candidate, or skip this position.')).toBeVisible();
    await page.getByRole('button', { name: /Juan Dela Vega/ }).click();
    await page.getByRole('button', { name: 'Next position' }).click();
    await expect(page.getByRole('heading', { name: secretary.title })).toBeVisible();
    await page.getByRole('button', { name: 'Review ballot' }).click();
    await expect(page.getByRole('heading', { name: 'Review your ballot' })).toBeVisible();
    await expect(page.getByText('No selection (abstain)').first()).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and submit' }).click();

    // 6. The receipt carries a reference and the submission time.
    await expect(page.getByRole('heading', { name: 'Ballot submitted' })).toBeVisible();
    await expect(page.getByText(/^Submitted .+\d{4}/)).toBeVisible();
    await expect(page.getByText('Ballot receipt', { exact: true })).toBeVisible();
    const receipt = (await page.locator('p.font-mono').first().innerText()).trim();
    expect(receipt.length).toBeGreaterThan(5);

    // The Vote page now reads Voted with the same receipt, and the server never lists the choices again.
    await page.goto('/dashboard/elections/cast-vote');
    const voted = page.getByRole('article').filter({ hasText: title });
    await expect(voted.getByText('Voted', { exact: true })).toBeVisible();
    await expect(voted.getByText('Your ballot receipt')).toBeVisible();
    await expect(voted.getByText(receipt)).toBeVisible();
    const mine = await (await apiAs(STUDENT)).get(`/elections/${electionId}`);
    expect(mine.body.has_voted).toBe(true);
    expect(mine.body.my_ballot.receipt_ref).toBe(receipt);
    expect(mine.body.my_votes ?? []).toEqual([]);
  } finally {
    // The election stays out of the way of the specs that run after this one.
    if (electionId) await admin.post(`/elections/${electionId}/cancel`, { reason: 'End-to-end run finished.' });
  }
});
