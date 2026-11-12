// Rendered journey smoke of the agency hierarchy flow, driven through the screens of a local stack.
//
//   node e2e/journeys/hierarchy-flow.smoke.mjs            (from client/, stack already running)
//
// Stack (nothing here touches a MariaDB instance): Laravel on a brand-new sqlite file after `migrate --seed`, Vite
// pointing at it. Defaults: API http://127.0.0.1:8030/api, client http://127.0.0.1:5200. Override with
// HIUSA_E2E_API_URL, HIUSA_E2E_BASE_URL. Screenshots go to HIUSA_SMOKE_OUT (default D:/Claude/scratch/hiusa-smoke2).
//
// Runs the whole journey twice, at 1366x900 and at 390x844, each on its own college so the two runs do not
// compete for the same seeded records. A run needs a freshly seeded database (it claims seeded school records).
// Passes only with zero console errors and no sideways scroll on every step. Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium, expect } from '@playwright/test';
import { assertLocalOnly } from '../support/local-only.mjs';

process.env.HIUSA_E2E_API_URL ??= 'http://127.0.0.1:8030/api';
const BASE = process.env.HIUSA_E2E_BASE_URL || 'http://127.0.0.1:5200';

// Writes real rows (registrations, claims, colleges), so refuse any host that is not this machine.
try {
  assertLocalOnly({ HIUSA_E2E_API_URL: process.env.HIUSA_E2E_API_URL, HIUSA_E2E_BASE_URL: BASE });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const OUT = process.env.HIUSA_SMOKE_OUT || 'D:/Claude/scratch/hiusa-smoke2';
const { SAO, PSITS_ADMIN, HEAD_CCS, STUDENT, STUDENT_B, PSITS_ORGANIZATION_ID, apiCall, pdfFile } = await import('../support/live.js');
const { ensureOpenSemester } = await import('../support/pipeline.js');

fs.mkdirSync(OUT, { recursive: true });
const TAG = Date.now().toString(36).slice(-5);
const PASSWORD = 'Smoke-pass-2026-x';

const RUNS = [
  {
    label: 'desktop',
    viewport: { width: 1366, height: 900 },
    college: 'College of Business Education',
    staff: { first: 'Lorna', name: 'Lorna Pangilinan' },
    student: { schoolId: 2400210, birthDate: '2005-07-21', first: 'Bianca', last: 'Ocampo' },
  },
  {
    label: 'mobile',
    viewport: { width: 390, height: 844 },
    college: 'College of Health Sciences',
    staff: { first: 'Cecilia', name: 'Cecilia Ramirez' },
    student: { schoolId: 2200320, birthDate: '2003-09-30', first: 'Patricia', last: 'Soriano' },
  },
];

const only = process.env.HIUSA_SMOKE_ONLY;

async function login(email, password = PASSWORD) {
  const response = await fetch(`${process.env.HIUSA_E2E_API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ school_id: email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, token: body.access_token, user: body.user };
}

async function runJourney(cfg) {
  const { label } = cfg;
  const isMobile = cfg.viewport.width < 640;
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const context = await browser.newContext({ viewport: cfg.viewport, baseURL: BASE });
  const page = await context.newPage();
  const consoleErrors = [];
  const httpFailures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url().replace(BASE, '')} :: ${message.text().slice(0, 240)}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${page.url().replace(BASE, '')} :: pageerror ${String(error.message).slice(0, 240)}`));
  // A "Failed to load resource" console error carries no URL; this names the request that never got an answer.
  page.on('requestfailed', (request) => httpFailures.push(`FAILED ${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '')} :: ${request.failure()?.errorText ?? 'unknown'}`));
  page.on('response', (response) => {
    if (response.status() >= 400) httpFailures.push(`${response.status()} ${response.request().method()} ${response.url().replace(/^https?:\/\/[^/]+/, '')}`);
  });

  const results = [];
  const state = { tag: `${TAG}${label[0]}` };
  // HIUSA_SMOKE_RESUME=1 skips the steps a previous run already passed (a debugging aid for a long run).
  const stateFile = path.join(OUT, `state-${label}.json`);
  const skipped = new Set();
  let saved = { done: [] };
  if (process.env.HIUSA_SMOKE_RESUME) {
    saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.tag = saved.tag;
    saved.done.forEach((id) => skipped.add(id));
  }
  let stepNo = 0;
  let currentStep = null;

  // The signed-in shell is one viewport tall with <main> scrolling inside it, so document.scrollHeight reads one
  // screen on every dashboard page; the page height is the document plus what <main> holds beyond its own box.
  const MAX_SCREENS = Number(process.env.HIUSA_SMOKE_MAX_SCREENS || 3);
  const heights = [];

  async function snap(name) {
    const measured = await page.evaluate(() => {
      const main = document.querySelector('main');
      // content: where the last visible, non-fixed element inside <main> actually ends, to cross-check the scroll measure.
      let content = 0;
      let lastEl = '';
      if (main) {
        const mainRect = main.getBoundingClientRect();
        const origin = mainRect.top - main.scrollTop;
        let lowest = 0;
        main.querySelectorAll('*').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (!rect.width || !rect.height || getComputedStyle(el).position === 'fixed') return;
          if (rect.bottom - origin > lowest) {
            lowest = rect.bottom - origin;
            lastEl = `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`;
          }
        });
        content = Math.round(mainRect.top + lowest + parseFloat(getComputedStyle(main).paddingBottom || '0'));
      }
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight + (main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0),
        doc: document.documentElement.scrollHeight,
        mainScroll: main ? main.scrollHeight : 0,
        content,
        lastEl,
      };
    });
    const file = path.join(OUT, `${label}-${String(stepNo).padStart(2, '0')}-${currentStep.id}-${currentStep.shots.length + 1}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    currentStep.shots.push(file);
    // The shell is one viewport tall, so the shot above holds only the first screen. HIUSA_SMOKE_TALL=1 also
    // writes a "-tall" shot of the whole page by growing the viewport to the measured height for that one capture.
    if (process.env.HIUSA_SMOKE_TALL && measured.height > cfg.viewport.height + 4) {
      await page.setViewportSize({ width: cfg.viewport.width, height: Math.min(measured.height + 8, 14000) });
      await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
      await page.screenshot({ path: file.replace(/\.png$/, '-tall.png') });
      await page.setViewportSize(cfg.viewport);
    }
    if (measured.overflow > 1) currentStep.overflow.push(`${name}: ${measured.overflow}px sideways`);
    const screens = measured.height / cfg.viewport.height;
    heights.push({ step: currentStep.id, shot: name, route: new URL(page.url()).pathname, px: measured.height, screens: Number(screens.toFixed(2)), doc: measured.doc, mainScroll: measured.mainScroll, content: measured.content, lastEl: measured.lastEl });
    // Reported for every run; it fails a step only when HIUSA_SMOKE_ENFORCE_HEIGHT=1 (the brief names no limit).
    if (isMobile && screens > MAX_SCREENS && process.env.HIUSA_SMOKE_ENFORCE_HEIGHT) currentStep.overflow.push(`${name}: ${measured.height}px tall, ${screens.toFixed(2)} screens`);
  }

  async function step(id, title, fn) {
    stepNo += 1;
    if (skipped.has(id)) return;
    currentStep = { id, title, shots: [], overflow: [], notes: [] };
    const before = consoleErrors.length;
    const httpBefore = httpFailures.length;
    let error = null;
    try {
      await fn(currentStep);
    } catch (caught) {
      error = caught;
      try { await snap('failure'); } catch { /* the page may be gone */ }
    }
    const newConsole = consoleErrors.slice(before);
    const record = {
      id,
      title,
      pass: !error && newConsole.length === 0 && currentStep.overflow.length === 0,
      error: error ? String(error.message).split('\n').slice(0, 4).join(' | ').slice(0, 500) : null,
      consoleErrors: newConsole,
      http: httpFailures.slice(httpBefore),
      overflow: currentStep.overflow,
      notes: currentStep.notes,
      shots: currentStep.shots,
    };
    results.push(record);
    fs.writeFileSync(stateFile, JSON.stringify({ tag: state.tag, applicationId, done: [...skipped, ...results.filter((item) => item.pass).map((item) => item.id)] }));
    console.log(`[${label}] ${record.pass ? 'PASS' : 'FAIL'} ${id} ${title}${record.error ? ` -> ${record.error}` : ''}${newConsole.length ? ` console:${newConsole.length}` : ''}${record.overflow.length ? ` overflow:${record.overflow.join(';')}` : ''}`);
  }

  async function signOutLocal() {
    await page.goto('/login');
    await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/login');
    await page.getByLabel(/Email or school ID/i).waitFor();
  }

  async function signIn(identifier, password) {
    await signOutLocal();
    await page.getByLabel(/Email or school ID/i).fill(String(identifier));
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    await page.getByRole('navigation').first().waitFor({ state: 'attached', timeout: 15000 });
    await waitSettled();
  }

  async function waitSettled() {
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20000 });
  }

  async function go(route) {
    await page.goto(route);
    await waitSettled();
  }

  async function pickPerson(text, optionPattern, labelPattern) {
    const combo = labelPattern ? page.getByRole('combobox', { name: labelPattern }) : page.getByRole('combobox').last();
    await combo.click();
    await combo.pressSequentially(text, { delay: 40 });
    const option = page.getByRole('option').filter({ hasText: optionPattern || text }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await option.click();
  }

  // Below the lg breakpoint the sidebar is an off-canvas drawer: it stays "visible" to Playwright while it is
  // translated away and inert, so the viewport decides whether the menu button has to be pressed first.
  const drawer = cfg.viewport.width < 1024;

  async function logOutThroughMenu() {
    if (drawer) await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: /^Log out$/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
  }

  // A requirement row that needs nothing sits on one line behind a "Review" or "Change" link; the status select
  // appears when the row is opened, as a reviewer opens it. Rows that already need action show it at once.
  const requirementRows = () => page.locator('section[aria-label="Requirements"] > ul > li');
  async function markRow(index, label) {
    const row = requirementRows().nth(index);
    const select = row.locator('select[aria-label^="Review of "]');
    if (!(await select.count())) await row.locator('button[aria-expanded]').click();
    await select.selectOption({ label });
  }

  async function acceptAll() {
    const total = await requirementRows().count();
    if (total === 0) throw new Error('no requirement rows to review');
    for (let index = 0; index < total; index += 1) await markRow(index, 'Accepted');
  }

  const api = {
    sao: null,
    dean: null,
  };
  const saoCall = (method, route, body) => apiCall(api.sao.token, method, route, body);
  const deanCall = (method, route, body) => apiCall(api.dean.token, method, route, body);

  const dean = { email: `dean.${state.tag}@smoke.test`, first: 'Delia', last: `Dean${state.tag}`, schoolId: 70000000 + (Date.now() % 20000000) };
  const applicant = { email: `${cfg.student.first}.${state.tag}@smoke.test`.toLowerCase() };
  const orgName = `Smoke Society ${state.tag}`;
  const orgAcronym = `SS${state.tag}`.toUpperCase();
  let inviteLink = '';
  let applicationId = saved.applicationId ?? null;
  if (skipped.size) {
    api.sao = await login(String(SAO.schoolId), SAO.password);
    api.dean = await login(dean.email);
  }

  // ---------------------------------------------------------------- 1
  await step('s1-sao-colleges', 'SAO: add a college, delete is disabled with a reason on a non-empty college, invite a Department Head', async () => {
    const session = await (async () => {
      const response = await fetch(`${process.env.HIUSA_E2E_API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ school_id: SAO.schoolId, password: SAO.password }),
      });
      const body = await response.json();
      return { token: body.access_token };
    })();
    api.sao = session;

    await signIn(SAO.schoolId, SAO.password);
    await go('/dashboard/super-admin/colleges');
    await snap('colleges-list');

    const newName = `Smoke College ${state.tag}`;
    await page.getByRole('button', { name: 'Add college' }).first().click();
    await page.getByLabel(/College name/).fill(newName);
    await page.getByLabel(/^Code/).fill(`SM${state.tag}`.toUpperCase());
    await snap('add-college-form');
    await page.locator('button[form="add-college-form"]').click();
    await expect(page.getByRole('heading', { name: newName })).toBeVisible({ timeout: 15000 });
    await waitSettled();
    await snap('college-added');
    const colleges = await saoCall('GET', '/system/colleges');
    const list = colleges.body?.data ?? colleges.body;
    const created = list.find((item) => item.name === newName);
    if (!created) throw new Error('the college is not in /system/colleges after Add college');
    currentStep.notes.push(`created college id ${created.id}`);

    // An empty college can be deleted; one with organizations or people cannot, and the menu says why.
    await page.getByRole('button', { name: `Actions for ${newName}` }).click();
    const deleteEmpty = page.getByRole('menuitem', { name: /^Delete college$/ });
    await expect(deleteEmpty).toBeVisible();
    await expect(deleteEmpty).toBeEnabled();
    await snap('menu-empty-college');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: `Actions for ${cfg.college}` }).click();
    const blocked = page.getByRole('menuitem', { name: /Delete college \(has organizations or people\)/ });
    await expect(blocked).toBeVisible();
    await expect(blocked).toBeDisabled();
    await snap('menu-non-empty-college');
    await page.keyboard.press('Escape');

    // The seeded college has a dean already; the SAO sets that one aside the way a change of dean starts.
    const target = list.find((item) => item.name === cfg.college);
    const head = target.department_head;
    if (head && head.account_status === 'active') {
      const off = await saoCall('PUT', `/system/department-heads/${head.school_id ?? head.id}`, { account_status: 'inactive' });
      if (!off.ok) throw new Error(`could not set the seeded dean aside: ${JSON.stringify(off.body).slice(0, 160)}`);
    }
    await go('/dashboard/super-admin/colleges');
    await page.getByRole('button', { name: 'Invite Department Head' }).first().click();
    await page.getByLabel('College', { exact: true }).selectOption({ label: cfg.college });
    await snap('invite-form');
    await page.getByRole('button', { name: 'Create link' }).click();
    const linkInput = page.getByLabel('Invitation link');
    await expect(linkInput).toBeVisible({ timeout: 15000 });
    inviteLink = await linkInput.inputValue();
    if (!/accept-invitation\?token=/.test(inviteLink)) throw new Error(`unexpected link ${inviteLink}`);
    currentStep.notes.push('invitation link created');
    await snap('invite-link');
    await page.getByRole('button', { name: 'Done' }).click();
  });

  // ---------------------------------------------------------------- 2
  await step('s2-open-link', 'Open the link logged out, register with their own School ID, land on the dean home, sign out, sign in by email', async () => {
    if (!inviteLink) throw new Error('no link from step 1');
    await signOutLocal();
    const url = new URL(inviteLink);
    await page.goto(`/accept-invitation${url.search}`);
    await expect(page.getByRole('heading', { name: new RegExp(`invited to lead ${cfg.college}`, 'i') })).toBeVisible({ timeout: 15000 });
    const intro = await page.locator('main, body').first().innerText();
    if (!/Student Affairs Office invited you to/.test(intro)) throw new Error('the page does not name who invited you');
    if (!intro.includes(cfg.college)) throw new Error('the page does not name the college');
    if (!(await page.getByLabel(/school id/i).count())) throw new Error('the dean form does not ask for a School ID');
    await snap('invitation');
    await page.getByLabel('First name').fill(dean.first);
    await page.getByLabel('Last name').fill(dean.last);
    await page.getByLabel(/school id/i).fill(String(dean.schoolId));
    await page.getByLabel('Email').fill(dean.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/dashboard\/department-head/, { timeout: 30000 });
    await waitSettled();
    await snap('dean-home');
    await logOutThroughMenu();
    await snap('signed-out');
    await signIn(dean.email, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard\/department-head/);
    await snap('dean-signed-in-by-email');
    api.dean = await login(dean.email);
    if (!api.dean.token) throw new Error('the API login by email failed');
  });

  // ---------------------------------------------------------------- 3
  await step('s3-dean-staff', 'Dean: People, Add staff from the school records (picked by name, ID read-only) creates an invite link', async () => {
    await go('/dashboard/department-head/people');
    await snap('people-students');
    await page.getByRole('tab', { name: /Office staff/ }).click();
    await waitSettled();
    await snap('people-staff');
    await page.getByRole('button', { name: 'Add staff' }).first().click();
    await page.getByRole('combobox', { name: /Find in the school records/ }).fill(cfg.staff.first.slice(0, 4));
    const option = page.getByRole('option').filter({ hasText: cfg.staff.name }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await snap('staff-search');
    await option.click();
    const idField = page.getByLabel('ID number');
    await expect(idField).toBeVisible();
    if (!(await idField.evaluate((node) => node.readOnly || node.disabled))) throw new Error('the ID number can be edited');
    if (!/^\d{5,}$/.test(await idField.inputValue())) throw new Error('the ID number is empty');
    await snap('staff-picked');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.getByLabel('Invite link')).toBeVisible({ timeout: 15000 });
    if (!/accept-invitation\?token=/.test(await page.getByLabel('Invite link').inputValue())) throw new Error('no staff link');
    await snap('staff-link');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  });

  // ---------------------------------------------------------------- 4
  await step('s4a-student-signup', 'Student signs up with school ID and birth date from the seeded registry', async () => {
    await ensureOpenSemester();
    await signOutLocal();
    await page.getByRole('link', { name: /Create your account/i }).first().click().catch(() => {});
    await page.goto('/sign-up');
    await page.getByLabel('School ID').fill(String(cfg.student.schoolId));
    await page.getByLabel('Birth date').fill(cfg.student.birthDate);
    await page.getByLabel('Email').fill(applicant.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await snap('sign-up-form');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Your account is ready')).toBeVisible({ timeout: 20000 });
    const body = await page.locator('body').innerText();
    if (!body.includes(cfg.student.first) || !body.includes(cfg.student.last)) throw new Error('the record names are not shown from the school records');
    await snap('account-ready');
    await page.getByRole('button', { name: 'Open my dashboard' }).click();
    await page.waitForURL(/\/dashboard\/student/, { timeout: 20000 });
    await waitSettled();
    await snap('student-home-before-grant');
  });

  await step('s3b-dean-allow', 'Dean: Allow a student to apply by typing a name', async () => {
    await signIn(dean.email, PASSWORD);
    await go('/dashboard/department-head/organizations');
    await snap('organizations');
    await page.getByRole('button', { name: 'Allow a student to apply' }).first().click();
    await pickPerson(cfg.student.first, new RegExp(`${cfg.student.first} ${cfg.student.last}`));
    await snap('allow-picked');
    await page.getByRole('button', { name: 'Allow to apply' }).click();
    await waitSettled();
    await snap('allowed');
  });

  await step('s4b-student-apply', 'Student applies for an organization', async () => {
    await signIn(applicant.email, PASSWORD);
    await snap('student-home-with-grant');
    await go('/dashboard/student/apply-organization');
    await page.getByLabel('Organization name').fill(orgName);
    await page.getByLabel('Acronym').fill(orgAcronym);
    await page.getByLabel('Your position').fill('President');
    await page.getByLabel('What the organization is for').fill('Smoke journey organization.');
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();
    if (count === 0) throw new Error('no requirement uploads on the apply page');
    for (let index = 0; index < count; index += 1) {
      const file = pdfFile(`requirement-${index + 1}.pdf`, `${orgName} ${index + 1}`);
      await inputs.nth(index).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
    }
    currentStep.notes.push(`${count} requirement files`);
    await snap('apply-form');
    await page.locator('form').getByRole('button', { name: /send|submit|apply/i }).last().click();
    await expect(page.getByText(/Application sent to your Department Head/i)).toBeVisible({ timeout: 20000 });
    await waitSettled();
    await snap('applied');
    const mine = await apiCall((await login(applicant.email)).token, 'GET', '/my/organization-applications');
    const found = (mine.body?.applications ?? []).find((item) => item.name === orgName);
    applicationId = found?.id ?? null;
    if (!applicationId) throw new Error('the application is not listed for the student');
  });

  // ---------------------------------------------------------------- 5
  await step('s5-dean-review', 'Dean reviews: per-requirement status words, a note on Needs changes, a comment-only note, Endorse', async () => {
    await signIn(dean.email, PASSWORD);
    await go(`/dashboard/organization-applications?record=${applicationId}`);
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible({ timeout: 20000 });
    await snap('review-open');
    const total = await requirementRows().count();
    if (total === 0) throw new Error('no per-requirement rows');
    await markRow(0, 'Needs changes');
    await page.getByLabel('Note for the applicant').first().fill('Use the signed copy.');
    for (let index = 1; index < total; index += 1) await markRow(index, 'Accepted');
    await snap('review-marked');
    await markRow(0, 'Accepted');
    await page.getByRole('button', { name: 'Add a comment' }).click();
    await page.getByLabel('Comment', { exact: true }).fill('Looks complete from here. Sending it to the SAO.');
    await snap('comment-open');
    await page.getByRole('button', { name: 'Save comment' }).click();
    await expect(page.getByText('Comment saved.')).toBeVisible({ timeout: 15000 });
    await snap('comment-saved');
    await page.getByRole('button', { name: 'Endorse', exact: true }).click();
    await expect(page.getByText(/Endorsed\. The SAO is next\./)).toBeVisible({ timeout: 20000 });
    await snap('endorsed');
  });

  // ---------------------------------------------------------------- 6
  await step('s6-sao-return-approve', 'SAO returns with comments, then approves after resubmission', async () => {
    await signIn(SAO.schoolId, SAO.password);
    await go(`/dashboard/organization-applications?record=${applicationId}`);
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible({ timeout: 20000 });
    await snap('sao-review-open');
    await markRow(0, 'Needs changes');
    await page.getByLabel('Note for the applicant').first().fill('The first file is not the signed copy.');
    await page.getByLabel('Comments for the applicant').fill('Replace the first file with the signed copy and send it again.');
    await snap('sao-return-filled');
    await page.getByRole('button', { name: 'Return with comments' }).click();
    await expect(page.getByText(/Returned to the applicant\./).first()).toBeVisible({ timeout: 20000 });
    await snap('sao-returned');

    await signIn(applicant.email, PASSWORD);
    await go(`/dashboard/student/organization-applications/${applicationId}`);
    await expect(page.getByText(/signed copy/).first()).toBeVisible({ timeout: 15000 });
    await snap('student-sees-return');
    const first = page.locator('input[type="file"]').first();
    const replacement = pdfFile('signed-copy.pdf', `${orgName} signed`);
    await first.setInputFiles({ name: replacement.name, mimeType: replacement.mimeType, buffer: replacement.buffer });
    await snap('student-fix');
    await page.getByRole('button', { name: /send.*again|resubmit/i }).first().click();
    await expect(page.getByText(/Sent again to your Department Head/)).toBeVisible({ timeout: 20000 });
    await snap('student-resent');

    await signIn(dean.email, PASSWORD);
    await go(`/dashboard/organization-applications?record=${applicationId}`);
    await expect(page.getByRole('button', { name: 'Endorse', exact: true })).toBeVisible({ timeout: 20000 });
    await acceptAll();
    await page.getByRole('button', { name: 'Endorse', exact: true }).click();
    await expect(page.getByText(/Endorsed\. The SAO is next\./)).toBeVisible({ timeout: 20000 });
    await snap('dean-endorsed-again');

    await signIn(SAO.schoolId, SAO.password);
    await go(`/dashboard/organization-applications?record=${applicationId}`);
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible({ timeout: 20000 });
    await acceptAll();
    await snap('sao-before-approve');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(/Approved\. The organization now exists\./).first()).toBeVisible({ timeout: 20000 });
    await snap('sao-approved');
  });

  // ---------------------------------------------------------------- 7
  const officer = { first: `Olive${state.tag}`, last: 'Officer', email: `officer.${state.tag}@smoke.test`.toLowerCase() };
  let orgId = null;

  async function adminToken() {
    return page.evaluate(() => window.localStorage.getItem('auth_token'));
  }

  async function openOrganizationAsHead() {
    await signIn(applicant.email, PASSWORD);
    await page.getByRole('button', { name: /^Workspace:/ }).click();
    await page.getByRole('region', { name: 'Workspaces' }).getByRole('button', { name: new RegExp(orgName, 'i') }).click();
    await page.waitForURL(/\/dashboard\/admin/, { timeout: 20000 });
    await waitSettled();
  }

  // A student of the dean's college who signs up the way a real one does: the dean loads the record, the
  // student matches it with school ID and birth date.
  async function newStudentAccount(person, offset) {
    const record = { schoolId: 27000000 + (Date.now() % 900000) * 10 + offset, birthDate: '2004-04-04' };
    const csv = `school_id,first_name,last_name,birth_date,program,year_level,section\n${record.schoolId},${person.first},${person.last},${record.birthDate},BSIT,3,A\n`;
    const upload = () => {
      const form = new FormData();
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'student.csv');
      return form;
    };
    const preview = await deanCall('POST', '/students/registry/preview', upload());
    if (!preview.ok) throw new Error(`registry preview ${preview.status} ${JSON.stringify(preview.body).slice(0, 160)}`);
    const apply = upload();
    apply.append('hash', preview.body.hash);
    apply.append('preview_token', preview.body.preview_token);
    apply.append('confirm', '1');
    const applied = await deanCall('POST', '/students/registry/apply', apply);
    if (!applied.ok) throw new Error(`registry apply ${applied.status}`);
    const registered = await apiCall('', 'POST', '/register', { school_id: record.schoolId, birth_date: record.birthDate, email: person.email, password: PASSWORD, password_confirmation: PASSWORD });
    if (registered.status !== 201) throw new Error(`register ${registered.status} ${JSON.stringify(registered.body).slice(0, 160)}`);
    return record.schoolId;
  }

  await step('s7a-org-access', 'The new organization head opens the organization and gives officer access', async () => {
    await newStudentAccount(officer, label === 'mobile' ? 1 : 0);
    await openOrganizationAsHead();
    await snap('organization-home');
    await go('/dashboard/admin/users');
    await snap('people-and-access');
    await page.getByRole('button', { name: 'Give access' }).first().click();
    await pickPerson(officer.first, new RegExp(`${officer.first} ${officer.last}`), /Student/);
    const level = page.getByLabel('Access level');
    const options = await level.locator('option').allTextContents();
    const officerOption = options.find((text) => /officer/i.test(text));
    if (!officerOption) throw new Error(`no Officer access level in ${JSON.stringify(options)}`);
    await level.selectOption({ label: officerOption });
    const position = page.getByLabel('Position');
    if ((await position.evaluate((node) => node.tagName)) === 'SELECT') {
      const choices = await position.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
      if (choices.length) await position.selectOption(choices[0]);
    } else {
      await position.fill('Treasurer');
    }
    await snap('give-access-form');
    await page.getByRole('button', { name: 'Give access' }).last().click();
    await expect(page.getByText(`${officer.first} ${officer.last}`).first()).toBeVisible({ timeout: 20000 });
    await waitSettled();
    await snap('access-given');
    const profiles = await apiCall(await adminToken(), 'GET', '/user/profiles');
    const active = (profiles.body?.profiles ?? []).find((item) => item.id === profiles.body?.active_profile_id) ?? {};
    orgId = active.organization_id ?? null;
    currentStep.notes.push(`organization id ${orgId}`);
  });

  // ---------------------------------------------------------------- 7b
  // An election of officers ends and hands access over. Real clock, real approval, real vote: the ballot opens
  // a few minutes after it is made and closes two minutes later, and the script waits for each.
  const memberPerson = { first: `Mara${state.tag}`, last: 'Member', email: `member.${state.tag}@smoke.test`.toLowerCase() };
  const manila = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  async function waitForElectionStatus(token, electionId, wanted, seconds) {
    const deadline = Date.now() + seconds * 1000;
    let last = '';
    while (Date.now() < deadline) {
      const shown = await apiCall(token, 'GET', `/elections/${electionId}`);
      last = shown.body?.status;
      if (last === wanted) return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`the election never became ${wanted} (last status ${last})`);
  }

  await step('s7b-election-handover', 'An election of officers hands access over to its winner', async () => {
    // Part A: the organization the pipeline just created. Part B: the seeded PSITS organization as the control that
    // shows the hand-over itself works. Both ballots run on the real clock and share one wait.
    const startAt = Date.now() + 150 * 1000;
    async function ballot({ admin, dean: approver, title, position, candidateId, party }) {
      const form = new FormData();
      form.append('title', title);
      form.append('start_time', manila(startAt));
      form.append('end_time', manila(startAt + 120 * 1000));
      form.append('positions[0][title]', position);
      form.append('positions[0][max_winners]', '1');
      const letter = pdfFile('letter.pdf', 'informative letter');
      form.append('informative_letter', new Blob([letter.buffer], { type: 'application/pdf' }), 'letter.pdf');
      const created = await apiCall(admin, 'POST', '/elections', form);
      if (created.status !== 201) throw new Error(`election ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
      const electionId = created.body.id;
      const pending = await apiCall(approver, 'GET', '/approval-requests?status=pending&per_page=100');
      const request = (pending.body?.data ?? []).find((item) => item.entity_type === 'election' && item.entity_id === electionId);
      if (!request) throw new Error('no approval request for the election');
      const approved = await apiCall(approver, 'PATCH', `/approval-requests/${request.id}`, { status: 'approved', remarks: 'Smoke journey' });
      if (!approved.ok) throw new Error(`approval ${approved.status}`);
      const partylist = await apiCall(admin, 'POST', '/partylists', { name: party });
      const candidate = await apiCall(admin, 'POST', `/elections/${electionId}/candidates`, { user_id: candidateId, position_id: created.body.positions[0].id, partylist_id: partylist.body.id });
      if (candidate.status !== 201) return { electionId, candidateStatus: candidate.status, candidateBody: candidate.body };
      const finalized = await apiCall(admin, 'PATCH', `/elections/${electionId}/finalize`);
      if (!finalized.ok) throw new Error(`finalize ${finalized.status} ${JSON.stringify(finalized.body).slice(0, 160)}`);
      return { electionId, candidateStatus: 201 };
    }

    // Part A set-up: a student of the college with Member access, working from the organization's own profile.
    const memberId = await newStudentAccount(memberPerson, 2);
    const adminSession = await login(applicant.email);
    const profiles = await apiCall(adminSession.token, 'GET', '/user/profiles');
    const adminProfile = profiles.body.profiles.find((item) => item.role === 'ADMIN' && /smoke society/i.test(item.organization?.name || ''));
    if (!adminProfile) throw new Error('the applicant has no organization head profile after approval');
    orgId = adminProfile.organization_id;
    await apiCall(adminSession.token, 'POST', `/user/profiles/${adminProfile.id}/switch`);
    const invited = await apiCall(adminSession.token, 'POST', '/account-profiles/invite', { school_id: memberId, role: 'STUDENT' });
    if (invited.status !== 201) throw new Error(`member access ${invited.status} ${JSON.stringify(invited.body).slice(0, 160)}`);
    const memberSession = await login(memberPerson.email);
    const memberProfiles = await apiCall(memberSession.token, 'GET', '/user/profiles');
    const memberProfile = memberProfiles.body.profiles.find((item) => item.organization_id === orgId);
    await apiCall(memberSession.token, 'POST', `/user/profiles/${memberProfile.id}/switch`);
    // Secretary, not President: the head keeps the President seat the later steps sign in with.
    const newOrg = await ballot({ admin: adminSession.token, dean: api.dean.token, title: `Election of officers ${state.tag}`, position: 'Secretary', candidateId: memberId, party: `Smoke Party ${state.tag}` });
    currentStep.notes.push(`new organization: adding its member as a candidate answered ${newOrg.candidateStatus}${newOrg.candidateStatus === 201 ? '' : ` ${JSON.stringify(newOrg.candidateBody)}`}`);
    if (newOrg.candidateStatus !== 201) {
      throw new Error(`in the organization created by the application pipeline, adding its own member as a candidate answers ${newOrg.candidateStatus} "${newOrg.candidateBody?.message}", so its election cannot reach the hand-over`);
    }

    // Part B: the control.
    const psitsAdmin = await login(String(PSITS_ADMIN.schoolId), PSITS_ADMIN.password);
    const psitsDean = await login(String(HEAD_CCS.schoolId), HEAD_CCS.password);
    const candidate = label === 'mobile' ? STUDENT_B : STUDENT;
    const candidateSession = await login(String(candidate.schoolId), candidate.password);
    const control = await ballot({ admin: psitsAdmin.token, dean: psitsDean.token, title: `Control election ${state.tag}`, position: 'Auditor', candidateId: candidate.schoolId, party: `Control Party ${state.tag}` });
    if (control.candidateStatus !== 201) throw new Error(`control candidate ${control.candidateStatus} ${JSON.stringify(control.candidateBody).slice(0, 160)}`);

    async function castOwnVote(session, electionId, schoolId) {
      const ballotList = await apiCall(session.token, 'GET', `/elections/${electionId}/candidates`);
      const list = ballotList.body?.data ?? ballotList.body;
      const mine = list.find((item) => Number(item.user_id) === schoolId) ?? list[0];
      const voted = await apiCall(session.token, 'POST', `/elections/${electionId}/vote`, { votes: [{ position_id: mine.position_id, candidate_id: mine.id }] });
      if (!voted.ok) throw new Error(`vote ${voted.status} ${JSON.stringify(voted.body).slice(0, 160)}`);
    }

    await waitForElectionStatus(psitsAdmin.token, control.electionId, 'active', 300);
    await waitForElectionStatus(adminSession.token, newOrg.electionId, 'active', 300);
    await castOwnVote(candidateSession, control.electionId, candidate.schoolId);
    await castOwnVote(memberSession, newOrg.electionId, memberId);
    await waitForElectionStatus(psitsAdmin.token, control.electionId, 'closed', 300);
    await waitForElectionStatus(adminSession.token, newOrg.electionId, 'closed', 300);

    const handedOver = async () => {
      const own = await apiCall(candidateSession.token, 'GET', '/user/profiles');
      return own.body.profiles.find((item) => item.organization_id === PSITS_ORGANIZATION_ID && item.position_title === 'Auditor' && item.account_status === 'active');
    };
    let profile = await handedOver();
    if (!profile) {
      await apiCall(psitsAdmin.token, 'PUT', `/elections/${control.electionId}`, { results_visible: false });
      await apiCall(psitsAdmin.token, 'PUT', `/elections/${control.electionId}`, { results_visible: true });
      profile = await handedOver();
      currentStep.notes.push('control: the hand-over needed the results to be released again');
    }
    if (!profile) throw new Error('control: the winner has no access after the results were released');
    currentStep.notes.push(`control: winner now ${profile.role} ${profile.position_title}`);

    // The results page names the state in its own words: a badge "Access handed over" and a sentence under it.
    async function openResultsOf(title) {
      await go('/dashboard/elections/election-results');
      await page.getByRole('button', { name: new RegExp(title, 'i') }).click();
      await waitSettled();
    }
    async function expectHandedOver() {
      await expect(page.getByText(/^Access handed over$/i)).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/Winners now have access to the organization/)).toBeVisible();
    }

    await signIn(PSITS_ADMIN.schoolId, PSITS_ADMIN.password);
    await go('/dashboard/elections/election-results');
    await snap('control-results');
    await openResultsOf(`Control election ${state.tag}`);
    await expectHandedOver();
    await snap('control-handed-over');

    // The organization the pipeline created: its member was on the ballot, voted, won and now holds the seat.
    const wonSeat = (await apiCall(memberSession.token, 'GET', '/user/profiles')).body.profiles
      .find((item) => item.organization_id === orgId && item.position_title === 'Secretary' && item.account_status === 'active');
    if (!wonSeat) throw new Error('new organization: the winner has no Secretary access after the election closed');
    currentStep.notes.push(`new organization: winner now ${wonSeat.role} ${wonSeat.position_title}`);
    await openOrganizationAsHead();
    await openResultsOf(`Election of officers ${state.tag}`);
    await expectHandedOver();
    await snap('new-organization-handed-over');
  });

  // ---------------------------------------------------------------- 8
  async function checkTracker(who, token) {
    const status = await apiCall(token, 'GET', '/process/status');
    if (!status.ok) throw new Error(`${who}: /process/status ${status.status}`);
    const data = status.body;
    if (!data.steps?.length) {
      currentStep.notes.push(`${who}: no tracker for this account`);
      return;
    }
    if (data.complete) {
      await expect(page.getByText('Setup complete').first()).toBeVisible({ timeout: 20000 });
      currentStep.notes.push(`${who}: setup complete`);
      return;
    }
    const section = page.getByRole('region', { name: 'Where you are in the process' });
    await expect(section).toBeVisible({ timeout: 20000 });
    const current = data.steps.find((item) => item.state === 'current');
    await expect(section.locator('li[aria-current="step"]').first()).toContainText(current.label);
    const done = data.steps.filter((item) => item.state === 'done');
    if (done.some((item) => item.action) && (await section.locator('ol a').count()) === 0) throw new Error(`${who}: done steps do not link`);
    currentStep.notes.push(`${who}: current "${current.label}", ${done.length} done`);
  }

  await step('s8-trackers', 'Process tracker on SAO, dean, admin and student homes shows the right current step', async () => {
    await signIn(SAO.schoolId, SAO.password);
    await go('/dashboard/super-admin');
    await checkTracker('SAO', (await login(String(SAO.schoolId), SAO.password)).token);
    const toggle = page.getByRole('button', { name: /Show each college/ });
    if (await toggle.count()) await toggle.click();
    await snap('sao-home');
    await signIn(dean.email, PASSWORD);
    await go('/dashboard/department-head');
    await checkTracker('Dean', (await login(dean.email)).token);
    await snap('dean-home');
    await openOrganizationAsHead();
    await go('/dashboard/admin');
    await checkTracker('Admin', await adminToken());
    await snap('admin-home');
    await signIn(applicant.email, PASSWORD);
    const here = page.getByRole('button', { name: /^Workspace:/ });
    if (/Smoke Society/i.test(await here.innerText())) {
      await here.click();
      await page.getByRole('region', { name: 'Workspaces' }).getByRole('button', { name: /My account/i }).first().click();
    }
    await go('/dashboard/student');
    await checkTracker('Student', (await login(applicant.email)).token);
    await snap('student-home');
  });

  // ---------------------------------------------------------------- 9
  async function openTransactions() {
    const tab = page.getByRole('tab', { name: /Transactions/ });
    if (await tab.isVisible().catch(() => false)) await tab.click();
    else await page.goto(`${new URL(page.url()).pathname}?tab=transactions`);
    await expect(page).toHaveURL(/tab=transactions/);
    await expect(page.getByText('Everything this organization recorded')).toBeVisible({ timeout: 20000 });
    // The tab frame renders before its data; the totals read "..." until the request has answered, and a
    // load state that was already idle before the tab opened would return at once.
    await expect(page.getByText('...', { exact: true })).toHaveCount(0, { timeout: 20000 });
    await waitSettled();
  }

  await step('s9-sao-org-space', 'SAO opens the organization space with its transactions read only', async () => {
    await signIn(SAO.schoolId, SAO.password);
    await go(`/dashboard/super-admin/organizations?search=${encodeURIComponent(orgName)}`);
    await snap('sao-organizations');
    await page.getByRole('button', { name: new RegExp(`Actions for ${orgName}`, 'i') }).click();
    await page.getByRole('menuitem', { name: 'Open organization' }).click();
    await page.waitForURL(/\/dashboard\/super-admin\/(org|organizations)\//, { timeout: 20000 });
    await waitSettled();
    await snap('org-space');
    // The space loads behind a skeleton that carries no aria-busy, so wait for the name instead of reading the body once.
    await expect(page.getByRole('main')).toContainText(new RegExp(orgName, 'i'), { timeout: 20000 });
    await openTransactions();
    await expect(page.getByText('No transactions yet')).toBeVisible({ timeout: 20000 });
    await snap('org-transactions');
    const panel = page.getByRole('tabpanel');
    const writers = await panel.getByRole('button', { name: /^(Add|New|Edit|Delete|Record|Remove)/i }).count();
    if (writers) throw new Error(`the transactions tab has ${writers} write controls`);
    // The seeded Computer Studies society has real transactions; open the same screen on it.
    await go('/dashboard/super-admin/org/2');
    await openTransactions();
    await snap('seeded-transactions');
    const pesoAmounts = async () => ((await page.getByRole('tabpanel').innerText()).match(/₱[\d,]+\.\d\d/g) || []).length;
    const amounts = await pesoAmounts();
    currentStep.notes.push(`${amounts} peso amounts on the seeded organization's transactions tab (2 totals plus rows)`);
    if (amounts < 4) throw new Error('the seeded organization shows no transactions');
  });

  // ---------------------------------------------------------------- 10
  await step('s10-records', 'Records page with a school year', async () => {
    await signIn(SAO.schoolId, SAO.password);
    await go('/dashboard/records');
    await snap('records');
    const selects = page.getByRole('combobox');
    const count = await selects.count();
    currentStep.notes.push(`${count} comboboxes on the records page`);
    const year = page.getByLabel(/school year|academic year/i).first();
    if (await year.count()) {
      const values = await year.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
      if (values.length > 1) await year.selectOption(values[values.length - 1]);
      await waitSettled();
      await snap('records-year');
    }
    const link = page.getByRole('button', { name: new RegExp(orgName, 'i') }).or(page.getByRole('link', { name: new RegExp(orgName, 'i') })).first();
    if (await link.count()) {
      await link.click();
      await waitSettled();
      await snap('records-organization');
    }
  });

  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, `results-${label}.json`), JSON.stringify({ label, viewport: cfg.viewport, results, heights, consoleErrors, httpFailures }, null, 2));
  const tallest = [...heights].sort((a, b) => b.px - a.px).slice(0, 5);
  console.log(`[${label}] tallest screens (limit ${MAX_SCREENS} x ${cfg.viewport.height}px = ${MAX_SCREENS * cfg.viewport.height}px): ${tallest.map((item) => `${item.px}px ${item.screens} screens ${item.step}/${item.shot}`).join(' ; ')}`);
  return { label, results, heights, consoleErrors, httpFailures };
}

let failed = false;
for (const cfg of RUNS) {
  if (only && only !== cfg.label) continue;
  const summary = await runJourney(cfg);
  const bad = summary.results.filter((item) => !item.pass);
  console.log(`[${cfg.label}] ${summary.results.length - bad.length}/${summary.results.length} steps passed, ${summary.consoleErrors.length} console errors`);
  if (bad.length || summary.consoleErrors.length) failed = true;
}
process.exit(failed ? 1 : 0);
