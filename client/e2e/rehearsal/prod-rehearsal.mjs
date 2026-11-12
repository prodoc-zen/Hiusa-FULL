// Production rehearsal of the whole HIUSA chain, driven in a real browser as the people who use it.
//
//   BASE_URL=https://13.228.227.182 SUFFIX=r1110 ID_BASE=25991400 node e2e/rehearsal/prod-rehearsal.mjs      (from client/)
//
// Env: BASE_URL (required), SUFFIX (required, goes into emails, the college code and the organization acronym so runs
// never collide), CREDS_FILE (default D:/Claude/scratch/hiusa-rehearsal/creds.json), ROUND (default 1; names the shots
// folder), SHOTS_DIR, ONLY (comma list of step keys to run), VIEWPORT_WIDTH/VIEWPORT_HEIGHT (default 1366x900), ID_BASE (first
// synthetic school ID minus one, default 25991100; pick an unused 2599xxxx range for every new SUFFIX; round r1110 uses
// ID_BASE=25991400).
//
// The rehearsal SAO account lives in the creds file under "sao". Every account and link the run creates is written back to
// that file (never to the repo). Passwords are generated at first use and stay in the creds file.
//
// Rules this script keeps: synthetic people only (example.com emails, school IDs 2599xxxx), one fresh browser context per
// person, nothing is deleted or edited that the script did not create, every step checks whether its outcome already exists
// and skips creation if so. The domain hiusa.space is refused.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const BASE = String(process.env.BASE_URL || '').replace(/\/+$/, '');
const SUFFIX = String(process.env.SUFFIX || '').trim();
const CREDS_FILE = process.env.CREDS_FILE || 'D:/Claude/scratch/hiusa-rehearsal/creds.json';
const ROUND = process.env.ROUND || '1';
const SHOTS = process.env.SHOTS_DIR || `D:/Claude/scratch/hiusa-rehearsal/shots/${ROUND}`;
const RESULTS = path.join(path.dirname(CREDS_FILE), `results-${ROUND}.json`);
const ONLY = (process.env.ONLY || '').split(',').map((item) => item.trim()).filter(Boolean);
const DESKTOP = { width: Number(process.env.VIEWPORT_WIDTH || 1366), height: Number(process.env.VIEWPORT_HEIGHT || 900) };
const PHONE = { width: 390, height: 844 };

if (!BASE || !SUFFIX) {
  console.error('BASE_URL and SUFFIX are required.');
  process.exit(2);
}
if (/hiusa\.space/i.test(BASE)) {
  console.error('Refusing hiusa.space: it does not resolve. Use the server IP.');
  process.exit(2);
}
fs.mkdirSync(SHOTS, { recursive: true });

const DIGITS = SUFFIX.replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^R/, '') || '0000';
const COLLEGE = { name: `Rehearsal College ${SUFFIX}`, code: `RHR${DIGITS}` };
const ORG = { name: `Rehearsal Society ${SUFFIX}`, acronym: `RSR${DIGITS}`, purpose: 'Rehearsal organization for the dean check. Synthetic data.' };
const ID_BASE = Number(process.env.ID_BASE || 25991100);
const SPEC = {
  dean: { first: 'Dario', last: 'Rehearsal', email: `dean.${SUFFIX}@example.com`, schoolId: ID_BASE + 5 },
  staff: { first: 'Sela', last: 'Rehearsal', email: `staff.${SUFFIX}@example.com`, schoolId: ID_BASE + 4, birth: '1985-02-11', position: 'Department Secretary' },
  a: { first: 'Lia', last: 'Rehearsal', email: `lia.${SUFFIX}@example.com`, schoolId: ID_BASE + 1, birth: '2004-03-05' },
  b: { first: 'Ben', last: 'Rehearsal', email: `ben.${SUFFIX}@example.com`, schoolId: ID_BASE + 2, birth: '2004-06-17' },
  c: { first: 'Cora', last: 'Rehearsal', email: `cora.${SUFFIX}@example.com`, schoolId: ID_BASE + 3, birth: '2003-12-23' },
};
const fullName = (key) => `${SPEC[key].first} ${SPEC[key].last}`;
const RECORDS_CSV = [
  'school_id,first_name,last_name,birth_date,program,year_level,section,record_type,position',
  ...['a', 'b', 'c'].map((key) => `${SPEC[key].schoolId},${SPEC[key].first},${SPEC[key].last},${SPEC[key].birth},BSIT,3,A,student,`),
  `${SPEC.staff.schoolId},${SPEC.staff.first},${SPEC.staff.last},${SPEC.staff.birth},,,,employee,${SPEC.staff.position}`,
].join('\n') + '\n';

// ------------------------------------------------------------------ creds file (never printed)
function readCreds() {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')); } catch { return {}; }
}
function writeCreds(mutate) {
  const data = readCreds();
  mutate(data);
  const temp = `${CREDS_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, CREDS_FILE);
}
function account(key) {
  const data = readCreds();
  if (key === 'sao') return data.sao;
  return data.people?.[key] ?? null;
}
function ensureAccount(key) {
  const existing = account(key);
  if (existing?.password) return existing;
  const fresh = { email: SPEC[key].email, password: `Rh-${crypto.randomBytes(9).toString('base64url')}-9a`, school_id: SPEC[key].schoolId ?? null, created: false };
  writeCreds((data) => { data.people = { ...(data.people ?? {}), [key]: fresh }; });
  return fresh;
}
function patchAccount(key, patch) {
  writeCreds((data) => {
    if (key === 'sao') data.sao = { ...data.sao, ...patch };
    else data.people = { ...(data.people ?? {}), [key]: { ...(data.people?.[key] ?? {}), ...patch } };
  });
}
function saveFact(group, key, value) {
  writeCreds((data) => { data[group] = { ...(data[group] ?? {}), [key]: value }; });
}

// ------------------------------------------------------------------ small PDF and CSV payloads
function minimalPdf(label) {
  const text = `BT /F1 18 Tf 40 100 Td (${String(label).replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => { body += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
const pdf = (name, label) => ({ name, mimeType: 'application/pdf', buffer: minimalPdf(label || name) });

// ------------------------------------------------------------------ browser, people, issue collection
const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const people = new Map();
const issues = [];
let stepKey = 'setup';
let allowed = [];
// Shot numbers continue from what the folder already holds, so a later run never overwrites an earlier one.
let shotNo = fs.readdirSync(SHOTS).reduce((highest, name) => Math.max(highest, Number(name.match(/^(\d+)-/)?.[1] ?? 0)), 0);
let apiBase = null;

const routeOf = (url) => { try { const parsed = new URL(url); return parsed.pathname + (parsed.search ? '?' : ''); } catch { return url; } };

async function person(key, { viewport = DESKTOP } = {}) {
  const existing = people.get(key);
  if (existing) return existing.page;
  const context = await browser.newContext({ viewport, baseURL: BASE, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  const record = (kind, text) => {
    const entry = { step: stepKey, who: key, route: routeOf(page.url()), kind, text };
    const expected = allowed.some((pattern) => pattern.test(`${kind} ${text}`));
    issues.push({ ...entry, expected });
  };
  page.on('console', (message) => { if (message.type() === 'error') record('console', message.text().slice(0, 240)); });
  page.on('pageerror', (error) => record('pageerror', String(error.message).slice(0, 240)));
  page.on('requestfailed', (request) => record('failed', `${request.method()} ${routeOf(request.url())} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    const url = response.url();
    if (!apiBase && /\/api\//.test(url)) apiBase = url.slice(0, url.indexOf('/api/') + 4);
    if (response.status() >= 400) record('http', `${response.status()} ${response.request().method()} ${routeOf(url)}`);
  });
  people.set(key, { context, page, key });
  return page;
}

async function closePerson(key) {
  const entry = people.get(key);
  if (!entry) return;
  await entry.context.close().catch(() => {});
  people.delete(key);
}

// ------------------------------------------------------------------ page helpers
async function waitSettled(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, null, { timeout: 20000 }).catch(() => {});
}

async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      height: document.documentElement.scrollHeight + (main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0),
    };
  });
}

// The signed-in shell is one viewport tall with <main> scrolling inside it, so a plain full-page shot holds one screen.
// The shot grows the viewport to the measured page height for one capture so the whole page is visible, then restores it.
async function shot(who, name, rec) {
  const page = people.get(who)?.page;
  if (!page) return;
  const viewport = page.viewportSize();
  // A skeleton is not the screen: wait for loading placeholders to go before looking.
  await page.waitForFunction(() => !document.querySelector('[role="status"][aria-label^="Loading"], [aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);
  let measured = { overflow: 0, height: viewport.height };
  try { measured = await measure(page); } catch { /* page may be navigating */ }
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(3, '0')}-${stepKey}-${who}-${name}.png`);
  try {
    if (measured.height > viewport.height + 4) {
      await page.setViewportSize({ width: viewport.width, height: Math.min(measured.height + 8, 4200) });
      await page.waitForTimeout(200);
      await page.screenshot({ path: file });
      await page.setViewportSize(viewport);
    } else {
      await page.screenshot({ path: file });
    }
  } catch {
    await page.setViewportSize(viewport).catch(() => {});
  }
  if (rec) {
    rec.shots.push(path.basename(file));
    if (measured.overflow > 1) rec.overflow.push(`${who}/${name}: ${measured.overflow}px sideways at ${viewport.width}px wide`);
  }
  return file;
}

async function bodyText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

// Data lands after the shell settles: wait for the words a person would be looking for before judging the page.
async function waitForText(page, text, timeout = 15000) {
  return page.waitForFunction((needle) => document.body.innerText.replace(/\s+/g, ' ').includes(needle), text, { timeout }).then(() => true, () => false);
}

async function pickPerson(page, text, optionPattern, labelPattern) {
  const combo = labelPattern ? page.getByRole('combobox', { name: labelPattern }) : page.getByRole('combobox').last();
  await combo.click();
  await combo.pressSequentially(text, { delay: 40 });
  const option = page.getByRole('option').filter({ hasText: optionPattern || text }).first();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
}

// Reads the app's own API as the signed-in person, with the token the browser holds (what the page itself would send).
async function api(who, method, route, body) {
  const page = people.get(who).page;
  const base = apiBase || `${BASE}/api`;
  // A page that is still navigating destroys the evaluation context; let it settle and ask again.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await apiOnce(page, base, method, route, body); } catch (error) {
      if (!/context was destroyed|navigation/i.test(String(error?.message)) || attempt === 3) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(800);
    }
  }
}
async function apiOnce(page, base, method, route, body) {
  return page.evaluate(async ({ method: verb, route: target, body: payload, base: root }) => {
    const token = window.localStorage.getItem('auth_token');
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (payload) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${root}${target}`, { method: verb, headers, body: payload ? JSON.stringify(payload) : undefined });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, ok: response.ok, body: data };
  }, { method, route, body, base });
}

// Signs the named person in through the login screen, the way they would. Returns the signed-in user the API sent back.
async function signIn(who, rec, { fresh = true, key = who, viewport } = {}) {
  const page = await person(key, viewport ? { viewport } : {});
  const cred = who === 'sao' ? account('sao') : ensureAccount(who);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto('/login');
    if (fresh) await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.goto('/login');
    await page.getByLabel(/Email or school ID/i).waitFor();
    await page.getByLabel(/Email or school ID/i).fill(cred.email);
    await page.getByLabel('Password', { exact: true }).fill(cred.password);
    const answered = page.waitForResponse((response) => response.request().method() === 'POST' && /\/login$/.test(response.url()), { timeout: 30000 });
    await page.getByRole('button', { name: /^Sign in/ }).click();
    const response = await answered;
    if (response.status() === 429) {
      rec?.notes.push('sign-in was throttled (429), waited and tried again');
      await page.waitForTimeout(20000);
      continue;
    }
    if (!response.ok()) return { ok: false, status: response.status() };
    const body = await response.json().catch(() => ({}));
    await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 30000 });
    await page.getByRole('navigation').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    await waitSettled(page);
    return { ok: true, status: response.status(), user: body.user ?? null };
  }
  return { ok: false, status: 429 };
}

// Below the lg breakpoint the sidebar is an off-canvas drawer: it stays "visible" to Playwright while translated away.
async function openMenuIfDrawer(page) {
  const width = page.viewportSize().width;
  if (width < 1024) await page.getByRole('button', { name: 'Open menu' }).click();
}

async function logOutThroughMenu(page) {
  await openMenuIfDrawer(page);
  await page.getByRole('button', { name: /^Log out$/ }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Log out' });
  if (await confirm.count()) await confirm.click();
  await page.waitForURL(/\/login/, { timeout: 15000 });
}

// A real user finds the page through the sidebar. If the link is not there, the step goes to the address and says so.
async function goSidebar(page, rec, name, fallbackPath) {
  await openMenuIfDrawer(page);
  const nav = page.getByRole('navigation');
  const link = nav.getByRole('link', { name }).first();
  // The sidebar groups its links; a person opens the group that should hold it.
  if (!(await link.isVisible().catch(() => false))) {
    const groups = nav.locator('button[aria-expanded="false"]');
    const total = await groups.count();
    for (let index = 0; index < total && !(await link.isVisible().catch(() => false)); index += 1) {
      await groups.nth(0).click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
  if (await link.isVisible().catch(() => false)) {
    const target = await link.getAttribute('href');
    const here = new URL(page.url()).pathname;
    await link.click();
    if (target && target.split('?')[0] !== here) await page.waitForURL((url) => url.pathname !== here, { timeout: 10000 }).catch(() => {});
  } else {
    rec.defect('ux_gap', `Sidebar has no "${name}" link; a person cannot reach this screen without the address.`, ['client/src/config/navigation.js']);
    await page.goto(fallbackPath);
  }
  await waitSettled(page);
}

const requirementRows = (page) => page.locator('section[aria-label="Requirements"] > ul > li');
async function markRow(page, index, label) {
  const row = requirementRows(page).nth(index);
  const select = row.locator('select[aria-label^="Review of "]');
  if (!(await select.count())) await row.locator('button[aria-expanded]').click();
  await select.selectOption({ label });
}
async function acceptAll(page) {
  const total = await requirementRows(page).count();
  if (total === 0) throw new Error('no requirement rows to review');
  for (let index = 0; index < total; index += 1) await markRow(page, index, 'Accepted');
  return total;
}

// ------------------------------------------------------------------ step runner
const ORDER = ['sao_login', 'college_add', 'dean_invite', 'records_load', 'staff_add', 'office_staff_walk', 'student_signup', 'allow_apply', 'apply', 'dean_review', 'sao_review', 'officer_access', 'election_handover', 'records', 'console_and_layout'];
// A partial run (ONLY) keeps what earlier runs recorded for the steps it does not run.
const results = (() => { try { return JSON.parse(fs.readFileSync(RESULTS, 'utf8')).results ?? []; } catch { return []; } })();
const skippedOnly = (key) => ONLY.length > 0 && !ONLY.includes(key);

async function step(key, title, fn) {
  if (skippedOnly(key)) return;
  stepKey = key;
  allowed = [];
  const startedIssues = issues.length;
  const rec = {
    key, title, pass: false, skipped: false, evidence: [], notes: [], shots: [], overflow: [], defects: [], error: null,
    defect(kind, text, files = []) { this.defects.push({ kind, text, files }); },
  };
  const started = Date.now();
  try {
    await fn(rec);
  } catch (error) {
    rec.error = String(error?.message ?? error).split('\n').slice(0, 5).join(' | ').slice(0, 700);
    for (const who of people.keys()) await shot(who, 'failure', rec);
  }
  const mine = issues.slice(startedIssues).filter((item) => !item.expected);
  rec.issues = mine;
  rec.seconds = Math.round((Date.now() - started) / 1000);
  rec.pass = !rec.error && mine.length === 0 && rec.overflow.length === 0 && rec.defects.length === 0;
  const at = results.findIndex((item) => item.key === key);
  if (at >= 0) results.splice(at, 1);
  results.push(rec);
  results.sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
  const tag = rec.skipped ? 'SKIP' : rec.pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${key} (${rec.seconds}s) ${rec.error ? `-> ${rec.error}` : ''}${mine.length ? ` issues:${mine.length}` : ''}${rec.defects.length ? ` defects:${rec.defects.length}` : ''}${rec.overflow.length ? ` overflow:${rec.overflow.length}` : ''}`);
  for (const note of rec.evidence) console.log(`        . ${note}`);
  for (const note of rec.notes) console.log(`        ~ ${note}`);
  for (const defect of rec.defects) console.log(`        ! ${defect.kind}: ${defect.text}`);
  for (const item of mine.slice(0, 6)) console.log(`        x ${item.who} ${item.route} ${item.kind} ${item.text}`);
  fs.writeFileSync(RESULTS, JSON.stringify({ base: BASE, suffix: SUFFIX, round: ROUND, results, issues }, null, 2));
}

// ================================================================== the steps
await step('sao_login', 'Rehearsal SAO signs in by email and lands on the SAO dashboard with the process tracker', async (rec) => {
  const cred = account('sao');
  if (!cred?.email || !cred?.password) throw new Error('the creds file has no sao account');
  const session = await signIn('sao', rec);
  if (!session.ok) throw new Error(`SAO sign-in answered ${session.status}`);
  const page = people.get('sao').page;
  if (!/\/dashboard\/super-admin/.test(page.url())) rec.defect('app_bug', `SAO landed on ${routeOf(page.url())}, not the SAO dashboard.`, ['client/src/App.jsx']);
  const tracker = page.getByRole('region', { name: 'Where you are in the process' });
  await tracker.waitFor({ state: 'visible', timeout: 20000 }).catch(() => rec.defect('app_bug', 'The SAO dashboard has no process tracker region.', ['client/src/components/process/ProcessTracker.jsx']));
  if (await tracker.count()) rec.evidence.push(`tracker: ${(await tracker.innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  rec.evidence.push(`landed on ${routeOf(page.url())}`);
  await shot('sao', 'dashboard', rec);
});

await step('college_add', `SAO adds the college ${COLLEGE.name} (code ${COLLEGE.code}) from Colleges`, async (rec) => {
  if (!people.has('sao')) await signIn('sao', rec);
  const page = people.get('sao').page;
  await goSidebar(page, rec, /^Colleges$/, '/dashboard/super-admin/colleges');
  await shot('sao', 'colleges', rec);
  if (await page.getByRole('heading', { name: COLLEGE.name }).count()) {
    rec.skipped = true;
    rec.evidence.push('college already exists');
    return;
  }
  await page.getByRole('button', { name: 'Add college' }).first().click();
  await page.getByLabel(/College name/).fill(COLLEGE.name);
  await page.getByLabel(/^Code/).fill(COLLEGE.code);
  await shot('sao', 'add-college-form', rec);
  const submit = page.getByRole('dialog').getByRole('button', { name: /^(Add college|Save|Create)/ });
  if (await submit.count()) await submit.last().click();
  else await page.locator('button[form="add-college-form"]').click();
  await page.getByRole('heading', { name: COLLEGE.name }).waitFor({ state: 'visible', timeout: 20000 });
  await waitSettled(page);
  rec.evidence.push('college card shown after Add college');
  await shot('sao', 'college-added', rec);
});

await step('dean_invite', 'SAO creates the dean invite link (link only), the dean opens it in a fresh context, accepts and signs in by email', async (rec) => {
  const dean = ensureAccount('dean');
  if (dean.created) {
    const probe = await signIn('dean', rec);
    if (probe.ok) {
      rec.skipped = true;
      rec.evidence.push(`dean already exists and signs in by email (School ID ${probe.user?.school_id ?? 'unknown'})`);
      await shot('dean', 'home', rec);
      return;
    }
    rec.notes.push(`saved dean did not sign in (${probe.status}); making a new link`);
    await closePerson('dean');
  }
  // Part 1, SAO creates the link, unless a saved one still opens.
  let link = readCreds().links?.dean_invite ?? null;
  const dp = await person('dean');
  const opens = async (candidate) => {
    const url = new URL(candidate);
    await dp.goto(`/accept-invitation${url.search}`);
    await waitSettled(dp);
    return (await dp.getByRole('heading', { name: new RegExp(`invited to lead ${COLLEGE.name}`, 'i') }).count()) > 0;
  };
  if (!link || !(await opens(link))) {
    if (!people.has('sao')) await signIn('sao', rec);
    const sp = people.get('sao').page;
    await goSidebar(sp, rec, /^Colleges$/, '/dashboard/super-admin/colleges');
    await sp.getByRole('button', { name: 'Invite Department Head' }).first().click();
    await sp.getByLabel('College', { exact: true }).selectOption({ label: COLLEGE.name });
    await shot('sao', 'invite-form', rec);
    await sp.getByRole('button', { name: 'Create link' }).click();
    const linkInput = sp.getByLabel('Invitation link');
    await linkInput.waitFor({ state: 'visible', timeout: 20000 });
    link = await linkInput.inputValue();
    saveFact('links', 'dean_invite', link);
    await shot('sao', 'invite-link', rec);
    await sp.getByRole('button', { name: 'Done' }).click();
    rec.evidence.push('link created from the SAO Colleges page (no identity fields, optional email left empty); the dean types their own School ID on the invitation page');
  }
  const origin = new URL(link).origin;
  if (origin !== BASE) rec.defect('app_bug', `The invitation link points to ${origin.replace(/^https?:\/\//, '')}, not the address the app is served on, so the dean cannot open it as given.`, ['server/config/app.php', 'server/app/Http/Controllers/DepartmentHeadInvitationController.php']);
  // Part 2, the dean opens it in a fresh context.
  if (!(await opens(link))) throw new Error('the dean link does not open to "You\'re invited to lead <college>"');
  const intro = await bodyText(dp);
  if (!/Student Affairs Office invited you|invited you/i.test(intro)) rec.defect('ux_gap', 'The invitation page does not say who invited you.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  const deanSchoolId = dp.getByLabel(/school id/i);
  if (!(await deanSchoolId.count())) rec.defect('app_bug', 'The dean form does not ask for a School ID.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  await shot('dean', 'invitation', rec);
  await dp.getByLabel('First name').fill(SPEC.dean.first);
  await dp.getByLabel('Last name').fill(SPEC.dean.last);
  await deanSchoolId.fill(String(SPEC.dean.schoolId));
  await dp.getByLabel('Email').fill(dean.email);
  await dp.getByLabel('Password', { exact: true }).fill(dean.password);
  await dp.getByLabel('Confirm password').fill(dean.password);
  await dp.getByRole('button', { name: 'Create account' }).click();
  await dp.waitForURL(/\/dashboard\/department-head/, { timeout: 30000 });
  await waitSettled(dp);
  patchAccount('dean', { created: true });
  await shot('dean', 'first-dashboard', rec);
  await logOutThroughMenu(dp);
  await shot('dean', 'signed-out', rec);
  const session = await signIn('dean', rec, { fresh: false });
  if (!session.ok) throw new Error(`dean sign-in by email answered ${session.status}`);
  const deanId = Number(session.user?.school_id);
  patchAccount('dean', { school_id: deanId || null });
  rec.evidence.push(`dean signed in by email; School ID ${deanId || 'not returned'}`);
  if (deanId !== SPEC.dean.schoolId) rec.defect('app_bug', `The dean's School ID is ${deanId}, expected the ${SPEC.dean.schoolId} they typed.`, ['server/app/Http/Controllers/DepartmentHeadInvitationController.php']);
  await shot('dean', 'signed-in-by-email', rec);
});

await step('records_load', 'Dean loads a synthetic student records CSV (3 students, 1 employee) from People, Students and sees them listed', async (rec) => {
  if (!people.has('dean')) { const s = await signIn('dean', rec); if (!s.ok) throw new Error(`dean sign-in ${s.status}`); }
  const page = people.get('dean').page;
  await goSidebar(page, rec, /^People$/, '/dashboard/department-head/people');
  await shot('dean', 'people-students', rec);
  const names = ['a', 'b', 'c'].map(fullName);
  const listed = async () => {
    const text = await bodyText(page);
    return names.filter((name) => text.includes(name));
  };
  if ((await listed()).length === names.length) {
    rec.skipped = true;
    rec.evidence.push('the three students are already listed');
    return;
  }
  await page.getByRole('button', { name: /Upload student records/ }).first().click();
  await shot('dean', 'upload-open', rec);
  await page.locator('input[type="file"]').first().setInputFiles({ name: `rehearsal-records-${SUFFIX}.csv`, mimeType: 'text/csv', buffer: Buffer.from(RECORDS_CSV) });
  await page.getByRole('button', { name: /^Check file/ }).click();
  const save = page.getByRole('button', { name: /^Save \d+ records?/ });
  await save.waitFor({ state: 'visible', timeout: 20000 });
  rec.evidence.push(`preview offers: ${await save.innerText()}`);
  await shot('dean', 'upload-checked', rec);
  await save.click();
  await waitSettled(page);
  await page.waitForTimeout(1200);
  await shot('dean', 'upload-saved', rec);
  // The drawer stays open to show the saved count; close it so its overlay does not block the next click.
  const drawer = page.getByRole('dialog', { name: /Upload student records/ });
  await drawer.getByRole('button', { name: /^Close/ }).first().click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
  await drawer.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => rec.defect('ux_gap', 'The Upload student records drawer cannot be closed with its close button or Escape.', ['client/src/pages/roles/department-head/CollegePeoplePage.jsx']));
  const found = await listed();
  rec.evidence.push(`listed after save: ${found.join(', ') || 'none'}`);
  if (found.length < names.length) {
    // The list may sit behind a refresh or a search.
    await page.goto('/dashboard/department-head/people');
    await waitSettled(page);
    const again = await listed();
    if (again.length < names.length) rec.defect('app_bug', `After saving the records, People > Students lists ${again.length} of ${names.length} students.`, ['client/src/pages/department-head/CollegePeoplePage.jsx', 'client/src/components/students/StudentRecordsPanel.jsx']);
    await shot('dean', 'people-after-reload', rec);
  }
});

await step('staff_add', 'Dean adds office staff from the employee records (link only, ID read only, students not offered), the staff member accepts and signs in', async (rec) => {
  const staff = ensureAccount('staff');
  if (staff.created) {
    const probe = await signIn('staff', rec);
    if (probe.ok) {
      rec.skipped = true;
      rec.evidence.push('staff account already exists and signs in by email');
      return;
    }
    await closePerson('staff');
  }
  if (!people.has('dean')) { const s = await signIn('dean', rec); if (!s.ok) throw new Error(`dean sign-in ${s.status}`); }
  const page = people.get('dean').page;
  await goSidebar(page, rec, /^People$/, '/dashboard/department-head/people');
  await page.getByRole('tab', { name: /Office staff/ }).click();
  await waitSettled(page);
  await shot('dean', 'staff-tab', rec);
  let link = readCreds().links?.staff_invite ?? null;
  if (!link) {
    await page.getByRole('button', { name: 'Add staff' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add office staff' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const finder = dialog.getByRole('combobox', { name: /Find in the employee records/ });
    await finder.waitFor({ state: 'visible', timeout: 20000 });
    // Office staff are employees only: a student record must never be offered. Each student's first name is searched.
    const answered = () => page.waitForFunction(() => {
      const list = document.querySelector('[role="listbox"]:not([hidden])');
      return Boolean(list) && !/Searching/.test(list.textContent) && (list.querySelectorAll('[role="option"]').length > 0 || /No one matches/.test(list.textContent));
    }, null, { timeout: 10000 }).then(() => true, () => false);
    const offeredStudents = [];
    const unanswered = [];
    for (const key of ['a', 'b', 'c']) {
      await finder.fill(SPEC[key].first);
      await page.waitForTimeout(500);
      if (!(await answered())) unanswered.push(SPEC[key].first);
      const offered = await dialog.getByRole('option').allInnerTexts();
      if (offered.some((text) => text.includes(fullName(key)))) offeredStudents.push(fullName(key));
    }
    await shot('dean', 'staff-search-students', rec);
    if (offeredStudents.length) rec.defect('app_bug', `The employee search offers student records (${offeredStudents.join(', ')}); office staff must come from employees only.`, ['server/app/Http/Controllers/CollegePeopleController.php']);
    else if (!unanswered.length) rec.evidence.push('searching the three student first names offers no student record');
    for (const name of unanswered) rec.defect('ux_gap', `The employee search did not answer for ${name}; students-not-offered is unproven.`, ['client/src/components/people/StaffInvitePanel.jsx']);
    await finder.fill(SPEC.staff.first);
    const option = dialog.getByRole('option').filter({ hasText: fullName('staff') }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await shot('dean', 'staff-search', rec);
    await option.click();
    const idField = dialog.getByLabel('ID number');
    await idField.waitFor({ state: 'visible' });
    const readOnly = await idField.evaluate((node) => node.readOnly || node.disabled);
    if (!readOnly) rec.defect('app_bug', 'The staff ID number can be edited.', ['client/src/components/people/StaffInvitePanel.jsx']);
    const idShown = await idField.inputValue();
    if (idShown !== String(SPEC.staff.schoolId)) rec.defect('app_bug', `The picked record shows ID ${idShown}, expected ${SPEC.staff.schoolId}.`, ['client/src/components/people/StaffInvitePanel.jsx']);
    // The position starts as the record's own; the dean may reword it in this form, so it is checked for the value, not for read only.
    const position = await dialog.getByLabel('Position').inputValue();
    rec.evidence.push(`ID shown ${idShown} (read only), position filled from the record: "${position}"`);
    if (!new RegExp(SPEC.staff.position, 'i').test(position)) rec.defect('app_bug', `The picked record shows position "${position}", expected ${SPEC.staff.position}.`, ['server/app/Http/Controllers/CollegePeopleController.php']);
    await shot('dean', 'staff-picked', rec);
    await dialog.getByRole('button', { name: 'Create invite link' }).click();
    const linkInput = dialog.getByLabel('Invite link');
    await linkInput.waitFor({ state: 'visible', timeout: 20000 });
    link = await linkInput.inputValue();
    saveFact('links', 'staff_invite', link);
    // The link is not emailed, so the unused link is listed under "Waiting for a reply" until the person accepts.
    const pending = dialog.getByRole('region', { name: 'Waiting for a reply' });
    const listedPending = await pending.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    if (!listedPending) rec.defect('ux_gap', 'After the invite link is made, the drawer does not list it under "Waiting for a reply".', ['client/src/components/people/PendingStaffInvites.jsx']);
    else if (!(await pending.innerText()).includes(fullName('staff'))) rec.defect('ux_gap', `"Waiting for a reply" does not name ${fullName('staff')}.`, ['client/src/components/people/PendingStaffInvites.jsx']);
    else rec.evidence.push(`pending list shows: ${(await pending.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
    await shot('dean', 'staff-link', rec);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
  if (new URL(link).origin !== BASE) rec.defect('app_bug', `The staff invite link points to ${new URL(link).origin.replace(/^https?:\/\//, '')}, not the served address.`, ['server/app/Http/Controllers/DepartmentHeadInvitationController.php']);
  else rec.evidence.push('the staff invite link points at the served address');
  const sp = await person('staff');
  await sp.goto(`/accept-invitation${new URL(link).search}`);
  await waitSettled(sp);
  const heading = sp.getByRole('heading', { name: /invited to .* as office staff/i });
  await heading.waitFor({ state: 'visible', timeout: 20000 });
  rec.evidence.push(`staff page heading: ${await heading.first().innerText()}`);
  const intro = await bodyText(sp);
  if (!/Department Head.*invited you|Invited by the Department Head/i.test(intro)) rec.defect('ux_gap', 'The staff invitation page does not say the Department Head invited them.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  if (!new RegExp(`Your role: ${SPEC.staff.position}`, 'i').test(intro)) rec.defect('ux_gap', `The staff invitation page does not show "Your role: ${SPEC.staff.position}".`, ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  await shot('staff', 'invitation', rec);
  // A link made from an employee record shows the name and ID from the records, locked; the email is the staff member's own.
  const nameField = sp.getByLabel(/^Name$/);
  if (await nameField.count()) {
    const locked = await nameField.evaluate((node) => node.readOnly || node.disabled);
    if (!locked) rec.defect('app_bug', 'The staff name is editable on a school-record link.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  } else rec.defect('app_bug', 'The staff invitation made from an employee record does not show the locked Name from the records.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  const acceptId = sp.getByLabel('School ID');
  if (await acceptId.count()) {
    if (!(await acceptId.evaluate((node) => node.readOnly || node.disabled))) rec.defect('app_bug', 'The staff School ID is editable on a school-record link.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
    if ((await acceptId.inputValue()) !== String(SPEC.staff.schoolId)) rec.defect('app_bug', `The invitation page shows ID ${await acceptId.inputValue()}, expected ${SPEC.staff.schoolId}.`, ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  } else rec.defect('app_bug', 'The staff invitation page shows no School ID.', ['client/src/pages/auth/AcceptInvitationPage.jsx']);
  const acceptEmail = sp.getByLabel('Email');
  if (await acceptEmail.isEditable()) await acceptEmail.fill(staff.email);
  else rec.evidence.push(`the invitation locked the email to ${await acceptEmail.inputValue()}`);
  await sp.getByLabel('Password', { exact: true }).fill(staff.password);
  await sp.getByLabel('Confirm password').fill(staff.password);
  await sp.getByRole('button', { name: 'Create account' }).click();
  await sp.waitForURL(/\/dashboard/, { timeout: 30000 });
  await waitSettled(sp);
  patchAccount('staff', { created: true });
  rec.evidence.push(`after Create account the staff member landed on ${routeOf(sp.url())}`);
  await shot('staff', 'first-dashboard', rec);
  await logOutThroughMenu(sp);
  const session = await signIn('staff', rec, { fresh: false });
  if (!session.ok) throw new Error(`staff sign-in by email answered ${session.status}`);
  patchAccount('staff', { school_id: Number(session.user?.school_id) || SPEC.staff.schoolId });
  rec.evidence.push(`staff signed in by email; role ${session.user?.role}; ID ${session.user?.school_id}`);
  await shot('staff', 'signed-in-by-email', rec);
  // The dean now finds the new staff member in People > Office staff.
  await page.goto('/dashboard/department-head/people');
  await waitSettled(page);
  await page.getByRole('tab', { name: /Office staff/ }).click();
  await waitSettled(page);
  const staffListed = await waitForText(page, fullName('staff'));
  await shot('dean', 'staff-listed', rec);
  if (!staffListed) rec.defect('app_bug', 'After the staff member accepts, People > Office staff does not list them.', ['server/app/Http/Controllers/CollegePeopleController.php']);
  else rec.evidence.push('the dean lists the staff member under Office staff');
});

// Office staff take the dean's role on every request (User::getRoleAttribute) and meet the dean's pages, but the routes in
// EnsureRole::DEAN_ONLY refuse them with 403 "Only the dean can do this." and the matching controls are not drawn for them.
await step('office_staff_walk', 'Office staff act as the dean: dashboard, People, Organizations and Approvals read cleanly, the dean-only controls are hidden, a dean-only write is refused with 403, phone shot', async (rec) => {
  if (!account('staff')?.created) throw new Error('the staff account does not exist yet; run staff_add first');
  if (!people.has('staff')) { const s = await signIn('staff', rec); if (!s.ok) throw new Error(`staff sign-in ${s.status}`); }
  const page = people.get('staff').page;
  const walkIssues = issues.length;
  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard\/admin/, { timeout: 20000 }).catch(() => {});
  await waitSettled(page);
  rec.evidence.push(`staff lands on ${routeOf(page.url())}`);
  if (!/\/dashboard\/admin/.test(page.url())) rec.defect('app_bug', `Office staff landed on ${routeOf(page.url())}, not /dashboard/admin.`, ['client/src/App.jsx']);
  else {
    // An ADMIN profile on the college home organization shows the office staff home: the applications queue of the college.
    const home = await waitForText(page, 'Applications for', 15000);
    if (!home) rec.defect('app_bug', 'The office staff home does not show "Applications for <college>".', ['client/src/pages/roles/admin/OfficeStaffHomePage.jsx']);
    else rec.evidence.push('the office staff home shows the college applications queue');
  }
  await shot('staff', 'dashboard', rec);

  // The sidebar is the dean's review sections; every row must be there.
  await openMenuIfDrawer(page);
  const nav = page.getByRole('navigation');
  const sections = [/^Organization applications$/, /^Approvals$/, /^Organizations$/, /^People$/, /^College files$/];
  const missing = [];
  for (const name of sections) if (!(await nav.getByRole('link', { name }).first().isVisible().catch(() => false))) missing.push(String(name).replace(/[/^$\\]/g, ''));
  if (missing.length) rec.defect('ux_gap', `The office staff sidebar has no link for: ${missing.join(', ')}.`, ['client/src/components/layout/navigation.js']);
  else rec.evidence.push('the sidebar shows Organization applications, Approvals, Organizations, People and College files');

  // People, read paths. The dean's controls (Add staff, Remove, Allow a student to apply, Upload student records) must not be drawn.
  await goSidebar(page, rec, /^People$/, '/dashboard/department-head/people');
  await waitForText(page, 'Search students', 15000);
  await shot('staff', 'people-students', rec);
  const hiddenControls = async (where, names, file = 'client/src/pages/roles/department-head/CollegePeoplePage.jsx') => {
    const shown = [];
    for (const name of names) if (await page.getByRole('button', { name }).count()) shown.push(String(name).replace(/[/^$\\]/g, ''));
    if (shown.length) rec.defect('ux_gap', `Office staff are shown dean-only controls on ${where}: ${shown.join(', ')}.`, [file]);
    return shown.length === 0;
  };
  const studentsClean = await hiddenControls('People > Students', [/^Allow a student to apply$/, /^Upload student records$/]);
  await page.getByRole('tab', { name: /Office staff/ }).click();
  await waitSettled(page);
  const listed = await waitForText(page, fullName('staff'), 15000);
  if (!listed) rec.defect('app_bug', 'Office staff do not see themselves under People > Office staff.', ['server/app/Http/Controllers/CollegePeopleController.php']);
  await shot('staff', 'people-staff', rec);
  const staffClean = await hiddenControls('People > Office staff', [/^Add staff$/, /^Remove /]);
  await page.getByRole('tab', { name: /Leaders/ }).click();
  await waitSettled(page);
  await shot('staff', 'people-leaders', rec);
  rec.evidence.push(`People opens on Students, Office staff and Leaders; dean-only controls hidden: ${studentsClean && staffClean ? 'yes' : 'NO'}`);

  // Organizations and Approvals, read paths.
  await goSidebar(page, rec, /^Organizations$/, '/dashboard/department-head/organizations');
  await page.waitForTimeout(800);
  await hiddenControls('Organizations', [/^Allow a student to apply$/, /^Office staff$/, /^Open organization space for /], 'client/src/pages/roles/department-head/CollegeOrganizationsPage.jsx');
  await shot('staff', 'organizations', rec);
  await goSidebar(page, rec, /^Approvals$/, '/dashboard/department-head/approvals');
  await page.waitForTimeout(800);
  await shot('staff', 'approvals', rec);
  const walkNew = issues.slice(walkIssues).filter((item) => !item.expected).length;
  if (walkNew) rec.evidence.push(`${walkNew} unexpected issues during the walk`);
  else rec.evidence.push('People, Organizations and Approvals opened without console errors or refused reads');

  // One dean-only write that is safe to attempt. POST api/college/staff/invitations is refused by the role gate before the
  // controller runs, and this body has no email, so the invitation would fail validation even if the gate were open: nothing is created either way.
  allowed = [/^http 403 POST \/api\/college\/staff\/invitations/, /^console Failed to load resource: the server responded with a status of 403/];
  const refused = await api('staff', 'POST', '/college/staff/invitations', { first_name: 'Refused', last_name: 'Probe', position_title: 'Probe' });
  await page.waitForTimeout(500);
  allowed = [];
  rec.evidence.push(`staff POST /college/staff/invitations answered ${refused.status}: ${JSON.stringify(refused.body).slice(0, 120)}`);
  if (refused.status !== 403) rec.defect('app_bug', `Office staff were not refused a dean-only write: POST /college/staff/invitations answered ${refused.status}, expected 403.`, ['server/app/Http/Middleware/EnsureRole.php']);
  else if (refused.body?.message !== 'Only the dean can do this.') rec.defect('app_bug', `The refusal says "${refused.body?.message}", expected "Only the dean can do this.".`, ['server/app/Http/Middleware/EnsureRole.php']);
  if (people.has('dean')) {
    const pendingNow = await api('dean', 'GET', '/college/staff/invitations');
    const rows = Array.isArray(pendingNow.body?.data) ? pendingNow.body.data : [];
    if (rows.some((row) => /Refused/.test(String(row.name)))) rec.defect('app_bug', 'The refused staff request still left an invitation behind.', ['server/app/Http/Middleware/EnsureRole.php']);
    else rec.evidence.push('the refused request left no invitation for the dean');
  }

  // Phone shot of the staff dashboard.
  await phoneTour(rec, 'staff', [['dashboard', '/dashboard/admin']]);
  await closePerson('phone-staff');
});

// Student sign-up through /sign-up: school ID and birth date, "We found you", then email and password.
async function studentSignUp(rec, key) {
  const student = ensureAccount(key);
  if (student.created) {
    const probe = await signIn(key, rec);
    if (probe.ok) {
      rec.evidence.push(`${fullName(key)} already has an account and signs in by email`);
      return { reused: true };
    }
    await closePerson(key);
  }
  const page = await person(key);
  await page.goto('/login');
  await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  await page.goto('/login');
  const signUpLink = page.getByRole('link', { name: /Create your account/i }).first();
  await signUpLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await signUpLink.count()) await signUpLink.click();
  else { rec.defect('ux_gap', 'The login page has no "Create your account" link for a new student.', ['client/src/pages/auth/LoginPage.jsx']); await page.goto('/sign-up'); }
  await page.waitForURL(/\/sign-up/);
  await page.getByLabel('School ID').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel('School ID').fill(String(SPEC[key].schoolId));
    await page.getByLabel('Birth date').fill(SPEC[key].birth);
    if ((await page.getByLabel('School ID').inputValue()) === String(SPEC[key].schoolId)) break;
    await page.waitForTimeout(600);
  }
  const emailField = page.getByLabel('Email');
  // The built page is one form (design brief section 5): the school record is shown on "Your account is ready", not before.
  // The task text and contract S2 describe a "We found you" step first; this run follows the built UI.
  if (key === 'a') rec.notes.push('UI differs from the task text: sign-up is one form and the school record (name, college, program) shows on "Your account is ready", not as a "We found you" step.');
  await shot(key, 'sign-up-form', rec);
  await emailField.fill(student.email);
  await page.getByLabel('Password', { exact: true }).fill(student.password);
  await page.getByLabel('Confirm password').fill(student.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Your account is ready').waitFor({ state: 'visible', timeout: 25000 });
  const ready = await bodyText(page);
  if (!ready.includes(SPEC[key].first) || !ready.includes(SPEC[key].last)) rec.defect('app_bug', 'The account-ready screen does not show the name from the school record.', ['client/src/pages/auth/StudentSignUpPage.jsx']);
  rec.evidence.push(`${key} account ready: ${ready.slice(ready.indexOf('Your account is ready'), ready.indexOf('Your account is ready') + 220)}`);
  patchAccount(key, { created: true });
  await shot(key, 'account-ready', rec);
  await page.getByRole('button', { name: 'Open my dashboard' }).click();
  await page.waitForURL(/\/dashboard\/student/, { timeout: 25000 });
  await waitSettled(page);
  await shot(key, 'dashboard-before-grant', rec);
  await logOutThroughMenu(page);
  const session = await signIn(key, rec, { fresh: false });
  if (!session.ok) throw new Error(`${key} sign-in by email answered ${session.status}`);
  rec.evidence.push(`${key} signed in by email`);
  return { reused: false };
}

await step('student_signup', 'Student A signs up at /sign-up with school ID and birth date, sees "We found you", sets email and password, signs in by email', async (rec) => {
  const outcome = await studentSignUp(rec, 'a');
  if (outcome.reused) rec.skipped = true;
});

await step('allow_apply', 'Dean allows student A to apply, finding them by name', async (rec) => {
  if (!people.has('a')) { const s = await signIn('a', rec); if (!s.ok) throw new Error(`student A sign-in ${s.status}`); }
  const aPage = people.get('a').page;
  const alreadyAllowed = async () => {
    await aPage.goto('/dashboard/student');
    await waitSettled(aPage);
    const nav = aPage.getByRole('navigation');
    return (await nav.getByRole('link', { name: /Apply for an organization/ }).count()) > 0;
  };
  if (await alreadyAllowed()) {
    rec.skipped = true;
    rec.evidence.push('student A already sees "Apply for an organization"');
    return;
  }
  if (!people.has('dean')) { const s = await signIn('dean', rec); if (!s.ok) throw new Error(`dean sign-in ${s.status}`); }
  const page = people.get('dean').page;
  await goSidebar(page, rec, /^People$/, '/dashboard/department-head/people');
  await page.getByRole('tab', { name: /^Students/ }).click();
  await waitSettled(page);
  await page.getByRole('button', { name: 'Allow a student to apply' }).first().click();
  await pickPerson(page, SPEC.a.first, new RegExp(fullName('a')), /^Student$/);
  await shot('dean', 'allow-picked', rec);
  await page.getByRole('button', { name: 'Allow to apply' }).click();
  await waitSettled(page);
  await page.waitForTimeout(800);
  await shot('dean', 'allowed', rec);
  if (!(await alreadyAllowed())) rec.defect('app_bug', 'After the dean allows student A, the student still has no "Apply for an organization" in the sidebar.', ['server/app/Http/Controllers/ApplicantGrantController.php', 'client/src/config/navigation.js']);
  else rec.evidence.push('student A now sees "Apply for an organization"');
  await shot('a', 'dashboard-with-grant', rec);
});

await step('apply', `Student A applies for ${ORG.name} (${ORG.acronym}), position President, every requirement uploaded as a small PDF`, async (rec) => {
  if (!people.has('a')) { const s = await signIn('a', rec); if (!s.ok) throw new Error(`student A sign-in ${s.status}`); }
  const page = people.get('a').page;
  const mine = await api('a', 'GET', '/my/organization-applications');
  const existing = (mine.body?.applications ?? []).find((item) => item.name === ORG.name);
  if (existing) {
    saveFact('org', 'application_id', existing.id);
    rec.skipped = true;
    rec.evidence.push(`application ${existing.id} already exists (${existing.status ?? 'status unknown'})`);
    return;
  }
  await goSidebar(page, rec, /Apply for an organization/, '/dashboard/student/apply-organization');
  const closed = await page.getByText(/Applications are closed|You cannot apply yet/i).count();
  if (closed) {
    await shot('a', 'apply-blocked', rec);
    rec.defect('data_or_env', `The apply page says: ${(await page.getByText(/Applications are closed|You cannot apply yet/i).first().innerText()).slice(0, 120)}`, ['server/app/Http/Controllers/OrganizationApplicationController.php']);
    throw new Error('the apply page is closed for student A');
  }
  await page.getByLabel('Organization name').fill(ORG.name);
  await page.getByLabel('Acronym').fill(ORG.acronym);
  await page.getByLabel('Your position').fill('President');
  await page.getByLabel('What the organization is for').fill(ORG.purpose);
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  if (count === 0) throw new Error('no requirement uploads on the apply page');
  for (let index = 0; index < count; index += 1) {
    const file = pdf(`requirement-${index + 1}.pdf`, `${ORG.name} requirement ${index + 1}`);
    await inputs.nth(index).setInputFiles(file);
  }
  rec.evidence.push(`${count} requirement files uploaded`);
  await shot('a', 'apply-form', rec);
  await page.getByRole('button', { name: /^Send application/ }).click();
  await page.getByText(/Application sent to your Department Head/i).waitFor({ state: 'visible', timeout: 25000 });
  await waitSettled(page);
  await shot('a', 'applied', rec);
  const after = await api('a', 'GET', '/my/organization-applications');
  const found = (after.body?.applications ?? []).find((item) => item.name === ORG.name);
  if (!found) throw new Error('the application is not listed for student A after sending');
  saveFact('org', 'application_id', found.id);
  rec.evidence.push(`application ${found.id} sent`);
});

const appId = () => readCreds().org?.application_id;
const applicationQueueFor = async (rec, who) => {
  const page = people.get(who).page;
  await goSidebar(page, rec, /Organization applications|^Applications$/, '/dashboard/organization-applications');
  return page;
};
async function openApplicationAs(rec, who) {
  const page = await applicationQueueFor(rec, who);
  // The queue loads after the page does; wait for the organization's row (or the empty state) before looking for Review.
  const row = page.getByRole('row').filter({ hasText: ORG.name }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await waitSettled(page);
  await shot(who, 'application-queue', rec);
  if (await row.count()) {
    const action = row.getByRole('button', { name: /Review/ }).or(row.getByRole('link', { name: /Review/ })).first();
    if (await action.count()) await action.click();
    else await row.click();
  } else {
    rec.defect('ux_gap', `${who} does not see the application "${ORG.name}" in the queue it should be in.`, ['client/src/pages/modules/approvals/OrganizationApplicationsPage.jsx']);
    await page.goto(`/dashboard/organization-applications?record=${appId()}`);
  }
  await page.getByRole('heading', { name: ORG.name }).waitFor({ state: 'visible', timeout: 25000 });
  await waitSettled(page);
  return page;
}

await step('dean_review', 'Dean returns the application with a per-requirement note; student A sees it and resubmits; dean endorses to the SAO', async (rec) => {
  if (!appId()) throw new Error('no application id in the creds file');
  if (!people.has('dean')) { const s = await signIn('dean', rec); if (!s.ok) throw new Error(`dean sign-in ${s.status}`); }
  if (!people.has('a')) { const s = await signIn('a', rec); if (!s.ok) throw new Error(`student A sign-in ${s.status}`); }
  const status = (await api('a', 'GET', '/my/organization-applications')).body?.applications?.find((item) => item.name === ORG.name)?.status;
  rec.evidence.push(`application status at start: ${status}`);
  if (status && !['pending_dean', 'returned'].includes(status)) {
    rec.skipped = true;
    rec.evidence.push('already past the dean review');
    return;
  }
  const page = people.get('dean').page;
  if (status === 'pending_dean') {
    await openApplicationAs(rec, 'dean');
    await shot('dean', 'review-open', rec);
    const total = await requirementRows(page).count();
    if (total === 0) throw new Error('no per-requirement rows on the dean review page');
    await markRow(page, 0, 'Needs changes');
    await page.getByLabel('Note for the applicant').first().fill('Use the signed copy of this requirement.');
    for (let index = 1; index < total; index += 1) await markRow(page, index, 'Accepted');
    await shot('dean', 'review-marked', rec);
    await page.getByRole('button', { name: 'Return with comments' }).click();
    await page.getByText(/Returned to the applicant\./).first().waitFor({ state: 'visible', timeout: 25000 });
    rec.evidence.push('dean returned the application with a per-requirement note');
    await shot('dean', 'review-returned', rec);
  }
  // Student A sees the note and resubmits.
  const aPage = people.get('a').page;
  await aPage.goto('/dashboard/student');
  await waitSettled(aPage);
  await shot('a', 'dashboard-after-return', rec);
  const trackerAction = aPage.getByRole('link', { name: /Update and send again|Fix and send again/ }).or(aPage.getByRole('button', { name: /Update and send again|Fix and send again/ })).first();
  if (await trackerAction.count()) {
    await trackerAction.click();
    await waitSettled(aPage);
  } else {
    rec.defect('ux_gap', 'The student dashboard tracker has no link to the returned application.', ['client/src/components/process/ProcessTracker.jsx']);
    await aPage.goto(`/dashboard/student/organization-applications/${appId()}`);
    await waitSettled(aPage);
  }
  if (!/organization-applications\/\d+/.test(aPage.url())) await aPage.goto(`/dashboard/student/organization-applications/${appId()}`);
  await waitSettled(aPage);
  const sawNote = await waitForText(aPage, 'signed copy');
  if (!sawNote) rec.defect('app_bug', 'Student A does not see the dean\'s per-requirement note on the application page.', ['client/src/pages/student/MyOrganizationApplicationPage.jsx']);
  else rec.evidence.push('student A sees the dean note');
  await shot('a', 'sees-return', rec);
  await aPage.locator('input[type="file"]').first().setInputFiles(pdf('signed-copy.pdf', `${ORG.name} signed copy`));
  await shot('a', 'fix-ready', rec);
  await aPage.getByRole('button', { name: /^Send again/ }).first().click();
  await aPage.getByText(/Sent again to your Department Head/).waitFor({ state: 'visible', timeout: 25000 });
  await shot('a', 'resent', rec);
  // Dean endorses.
  await openApplicationAs(rec, 'dean');
  await acceptAll(page);
  await shot('dean', 'all-accepted', rec);
  await page.getByRole('button', { name: 'Endorse', exact: true }).click();
  await page.getByText(/Endorsed\. The SAO is next\./).waitFor({ state: 'visible', timeout: 25000 });
  rec.evidence.push('dean endorsed to the SAO');
  await shot('dean', 'endorsed', rec);
});

await step('sao_review', 'SAO returns once with a note and an attached file; student A resubmits; dean endorses; SAO approves; organization exists and A holds the head profile', async (rec) => {
  if (!appId()) throw new Error('no application id in the creds file');
  for (const who of ['sao', 'dean', 'a']) {
    if (!people.has(who)) { const s = await signIn(who, rec); if (!s.ok) throw new Error(`${who} sign-in ${s.status}`); }
  }
  const state = async () => (await api('a', 'GET', '/my/organization-applications')).body?.applications?.find((item) => item.name === ORG.name)?.status;
  let status = await state();
  rec.evidence.push(`application status at start: ${status}`);
  if (status === 'approved') {
    rec.skipped = true;
    rec.evidence.push('already approved');
    return;
  }
  const sp = people.get('sao').page;
  if (status === 'pending_sao') {
    await openApplicationAs(rec, 'sao');
    await shot('sao', 'review-open', rec);
    await markRow(sp, 0, 'Needs changes');
    await sp.getByLabel('Note for the applicant').first().fill('The first file is not the signed copy.');
    const attach = sp.getByLabel(/^Attach a file to/).first();
    if (await attach.count()) {
      await attach.setInputFiles(pdf('sao-sample.pdf', 'SAO sample'));
      rec.evidence.push('SAO attached a file to the requirement');
    } else {
      rec.defect('ux_gap', 'The SAO review has no "Attach a file to <requirement>" control.', ['client/src/pages/modules/approvals/OrganizationApplicationsPage.jsx']);
    }
    await sp.getByLabel('Comments for the applicant').fill('Replace the first file with the signed copy and send it again.');
    await shot('sao', 'return-filled', rec);
    await sp.getByRole('button', { name: 'Return with comments' }).click();
    await sp.getByText(/Returned to the applicant\./).first().waitFor({ state: 'visible', timeout: 25000 });
    await shot('sao', 'returned', rec);
    status = await state();
    rec.evidence.push(`status after the SAO return: ${status}`);
  }
  if (status === 'returned') {
    const aPage = people.get('a').page;
    await aPage.goto(`/dashboard/student/organization-applications/${appId()}`);
    await waitSettled(aPage);
    const text = await bodyText(aPage);
    if (!text.includes('signed copy')) rec.defect('app_bug', 'Student A does not see the SAO per-requirement note.', ['client/src/pages/student/MyOrganizationApplicationPage.jsx']);
    if (!/Files from the reviewers|sao-sample/i.test(text)) rec.defect('ux_gap', 'Student A does not see the file the SAO attached.', ['client/src/pages/student/MyOrganizationApplicationPage.jsx']);
    await shot('a', 'sees-sao-return', rec);
    await aPage.locator('input[type="file"]').first().setInputFiles(pdf('signed-copy-2.pdf', `${ORG.name} signed copy 2`));
    await aPage.getByRole('button', { name: /^Send again/ }).first().click();
    await aPage.getByText(/Sent again to your Department Head/).waitFor({ state: 'visible', timeout: 25000 });
    await shot('a', 'resent', rec);
    status = await state();
  }
  if (status === 'pending_dean') {
    const dp = await openApplicationAs(rec, 'dean');
    await acceptAll(dp);
    await dp.getByRole('button', { name: 'Endorse', exact: true }).click();
    await dp.getByText(/Endorsed\. The SAO is next\./).waitFor({ state: 'visible', timeout: 25000 });
    await shot('dean', 'endorsed-again', rec);
    status = await state();
  }
  if (status !== 'pending_sao') throw new Error(`expected pending_sao before approval, found ${status}`);
  await openApplicationAs(rec, 'sao');
  await acceptAll(sp);
  await shot('sao', 'before-approve', rec);
  await sp.getByRole('button', { name: 'Approve', exact: true }).click();
  await sp.getByText(/Approved\. The organization now exists\./).first().waitFor({ state: 'visible', timeout: 25000 });
  await shot('sao', 'approved', rec);
  // The organization sits in the rehearsal college and student A holds the head (ADMIN) profile.
  const profiles = await api('a', 'GET', '/user/profiles');
  const list = profiles.body?.profiles ?? [];
  const head = list.find((item) => item.role === 'ADMIN' && item.organization?.name === ORG.name);
  if (!head) rec.defect('app_bug', 'After approval student A has no ADMIN profile in the new organization.', ['server/app/Http/Controllers/OrganizationApplicationReviewController.php']);
  else {
    saveFact('org', 'organization_id', head.organization_id);
    saveFact('org', 'a_profile_id', head.id);
    rec.evidence.push(`student A holds ${head.role} "${head.position_title}" in organization ${head.organization_id}`);
  }
  const dp = people.get('dean').page;
  await goSidebar(dp, rec, /^Organizations$/, '/dashboard/department-head/organizations');
  await dp.getByText(ORG.name).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await waitSettled(dp);
  await shot('dean', 'organizations-after-approval', rec);
  if (!(await bodyText(dp)).includes(ORG.name)) rec.defect('app_bug', 'The dean Organizations list does not show the approved organization.', ['client/src/pages/department-head/CollegeOrganizationsPage.jsx']);
  else rec.evidence.push('the dean Organizations list shows the new organization');
});

// ---------------------------------------------------------------- officer_access
async function switchToOrganization(who, rec) {
  const page = people.get(who).page;
  const switcher = page.getByRole('button', { name: /^Workspace:/ });
  // A person with a single space has no switcher (it hides under 2 spaces); their own dashboard is that space.
  const hasSwitcher = await switcher.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
  if (!hasSwitcher) {
    // A plain member (STUDENT profiles) has no Workspace switcher; their profiles live in the account menu.
    await page.getByRole('button', { name: /^Account menu for/ }).click();
    const panel = page.getByRole('region', { name: 'Account and profiles' });
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    const orgProfile = panel.getByRole('button', { name: new RegExp(ORG.name, 'i') });
    const hasOrgProfile = await orgProfile.first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (!hasOrgProfile) {
      rec && (await shot(who, 'profiles-no-org', rec));
      rec && rec.notes.push(`${who} account menu shows: ${(await panel.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
      await page.keyboard.press('Escape');
      rec && rec.notes.push(`${who} has no organization profile in the account menu; stayed on their own dashboard`);
      return page;
    }
    if (await orgProfile.first().isDisabled()) {
      // Already the active profile.
      await page.keyboard.press('Escape');
      return page;
    }
    rec && (await shot(who, 'profiles-open', rec));
    await orgProfile.first().click();
    await page.getByText(new RegExp(`Viewing ${ORG.name}`)).first().waitFor({ state: 'visible', timeout: 25000 });
    await waitSettled(page);
    return page;
  }
  const label = await switcher.innerText();
  if (new RegExp(ORG.name, 'i').test(label)) return page;
  await switcher.click();
  const region = page.getByRole('region', { name: 'Workspaces' });
  await region.waitFor({ state: 'visible', timeout: 10000 });
  rec && (await shot(who, 'switcher-open', rec));
  await region.getByRole('button', { name: new RegExp(ORG.name, 'i') }).click();
  await page.getByRole('button', { name: new RegExp(`^Workspace:.*${ORG.name}`, 'i') }).waitFor({ state: 'visible', timeout: 25000 });
  await waitSettled(page);
  return page;
}

async function sidebarLabels(page) {
  await openMenuIfDrawer(page);
  const labels = await page.getByRole('navigation').first().locator('a, button').evaluateAll((nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean));
  return [...new Set(labels)];
}

const MODULES = ['Members', 'Events', 'Finance', 'Tasks', 'Merchandise', 'Elections', 'Compliance', 'Announcements'];
const OFFICER_KEEPS = ['Events', 'Tasks'];

async function giveAccess(rec, who, key, levelPattern, keeps) {
  const page = people.get(who).page;
  await page.getByRole('button', { name: 'Give access' }).first().click();
  await pickPerson(page, SPEC[key].first, new RegExp(fullName(key)), /Student/);
  const level = page.getByLabel('Access level');
  const options = await level.locator('option').allTextContents();
  const wanted = options.find((text) => levelPattern.test(text));
  if (!wanted) throw new Error(`no access level matching ${levelPattern} in ${JSON.stringify(options)}`);
  await level.selectOption({ label: wanted });
  const position = page.getByLabel('Position');
  if (await position.count()) {
    if ((await position.evaluate((node) => node.tagName)) === 'SELECT') {
      const choices = await position.locator('option').evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent.trim() })).filter((item) => item.value));
      rec.notes.push(`${key} position choices: ${choices.map((item) => item.text).join(', ') || 'none'}`);
      if (choices.length) await position.selectOption(choices[0].value);
      else rec.notes.push('Position is optional and the list is empty for a new organization ("No positions are set up for this level yet."); left as No position.');
    } else {
      await position.fill(key === 'b' ? 'Secretary' : 'Auditor');
    }
  }
  if (keeps) {
    for (const module of MODULES) {
      const box = page.getByRole('checkbox', { name: new RegExp(`^${module}`) });
      if (await box.count()) await box.setChecked(keeps.includes(module));
    }
  }
  await shot(who, `give-access-${key}`, rec);
  await page.getByRole('dialog').getByRole('button', { name: 'Give access' }).click().catch(async () => page.getByRole('button', { name: 'Give access' }).last().click());
  await page.getByText(fullName(key)).first().waitFor({ state: 'visible', timeout: 20000 });
  await waitSettled(page);
  await shot(who, `access-given-${key}`, rec);
}

await step('officer_access', 'Students B and C sign up; A switches into the org space and gives B officer access with selected modules; B sees only those modules', async (rec) => {
  await studentSignUp(rec, 'b');
  await studentSignUp(rec, 'c');
  if (!people.has('a')) { const s = await signIn('a', rec); if (!s.ok) throw new Error(`student A sign-in ${s.status}`); }
  const aPage = await switchToOrganization('a', rec);
  rec.evidence.push(`A is in the org space at ${routeOf(aPage.url())}`);
  await shot('a', 'org-home', rec);
  await goSidebar(aPage, rec, /^People$/, '/dashboard/admin/users');
  await aPage.getByText('People and access').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => rec.defect('ux_gap', 'The People page has no "People and access" card.', ['client/src/components/org/OrgAccessPanel.jsx']));
  await waitSettled(aPage);
  await shot('a', 'people-and-access', rec);
  const listed = (key) => bodyText(aPage).then((text) => text.includes(fullName(key)));
  if (!(await listed('b'))) await giveAccess(rec, 'a', 'b', /officer/i, OFFICER_KEEPS);
  else rec.notes.push('B already has access');
  if (!(await listed('c'))) await giveAccess(rec, 'a', 'c', /member/i, null);
  else rec.notes.push('C already has access');
  // B opens the organization and sees only the ticked modules.
  const bPage = people.get('b').page;
  await bPage.goto('/dashboard/student');
  await waitSettled(bPage);
  await shot('b', 'before-switch', rec);
  await switchToOrganization('b', rec);
  await waitSettled(bPage);
  await shot('b', 'org-home', rec);
  const labels = await sidebarLabels(bPage);
  rec.evidence.push(`B sidebar: ${labels.join(' | ')}`);
  const mustHave = [/Events|Calendar|Check-in/i, /Tasks|Assigned/i];
  const mustNot = [/^Finance$/i, /^Merchandise|^Store$/i, /^Compliance$/i, /Manage announcements|Create announcement/i, /^Members$|^People$/i];
  for (const pattern of mustHave) if (!labels.some((label) => pattern.test(label))) rec.defect('app_bug', `Officer B should see ${pattern} but the sidebar has no such item.`, ['client/src/config/navigation.js', 'server/app/Http/Middleware/EnsureOrganizationModule.php']);
  for (const pattern of mustNot) {
    const hit = labels.find((label) => pattern.test(label));
    if (hit) rec.defect('app_bug', `Officer B was not given "${hit}" but the sidebar shows it.`, ['client/src/config/navigation.js', 'server/app/Http/Middleware/EnsureOrganizationModule.php']);
  }
});

// ---------------------------------------------------------------- election_handover
const ELECTION_BASE = `Election of officers ${SUFFIX}`;
const manilaLocal = (offsetMs) => new Date(Date.now() + 8 * 3600 * 1000 + offsetMs).toISOString().slice(0, 16);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listElections(who) {
  const response = await api(who, 'GET', '/elections');
  const list = response.body?.data ?? response.body ?? [];
  return (Array.isArray(list) ? list : []).filter((item) => String(item.title).startsWith(ELECTION_BASE));
}
async function currentElection(who) {
  const mine = await listElections(who);
  if (!mine.length) return null;
  return mine.sort((x, y) => y.id - x.id)[0];
}
async function waitForElection(who, wanted, seconds, rec) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const election = await currentElection(who);
    last = election?.status;
    if (last === wanted) return election;
    await sleep(8000);
  }
  rec.defect('app_bug', `The election did not become ${wanted} within ${seconds} seconds of its window (last status ${last}); the scheduled status sync did not move it.`, ['server/app/Console/Commands/SyncElectionStatuses.php', 'server/app/Models/Election.php']);
  throw new Error(`election never became ${wanted} (last ${last})`);
}
async function openElectionAsAdmin(page, rec, election) {
  await goSidebar(page, rec, /^Elections$/, '/dashboard/elections/manage-elections');
  await waitSettled(page);
  const pattern = new RegExp(election.title.replace(/[()]/g, '.'), 'i');
  const choice = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern })).first();
  await choice.waitFor({ state: 'visible', timeout: 15000 });
  await choice.click();
  await page.getByRole('navigation', { name: 'Election workspace steps' }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await waitSettled(page);
}

// After the window closes the scheduler hands the head access to the winner. Checked from the results page and the profiles.
async function verifyHandover(rec, resultsWho, resultsPage) {
  await resultsPage.goto('/dashboard/elections/election-results');
  await waitSettled(resultsPage);
  const listed = resultsPage.getByRole('link', { name: /^Election of officers/i }).or(resultsPage.getByRole('button', { name: /^Election of officers/i })).first();
  if (await listed.count()) { await listed.click(); await waitSettled(resultsPage); }
  await resultsPage.getByText(/^Access handed over$/i).waitFor({ state: 'visible', timeout: 20000 }).catch(() => rec.defect('app_bug', 'The results page does not say "Access handed over" after the results were released.', ['client/src/pages/modules/elections/ElectionResultsPage.jsx', 'server/app/Services/ElectionHandoverService.php']));
  await shot(resultsWho, 'results', rec);
  // Winner C holds the head access; outgoing A holds none for the same position (contract S5).
  const profilesOf = async (who) => (await api(who, 'GET', '/user/profiles')).body?.profiles ?? [];
  const cProfiles = await profilesOf('c');
  const cWon = cProfiles.find((item) => item.organization?.name === ORG.name && item.position_title === 'President');
  rec.evidence.push(`winner C: ${cWon ? `${cWon.role} ${cWon.position_title} ${cWon.account_status}` : 'no President profile'}`);
  if (!cWon || cWon.account_status !== 'active' || cWon.role !== 'ADMIN') rec.defect('app_bug', 'The winner did not get active organization head access for President.', ['server/app/Services/ElectionHandoverService.php']);
  const aProfiles = await profilesOf('a');
  const aOld = aProfiles.find((item) => item.organization?.name === ORG.name && item.position_title === 'President');
  rec.evidence.push(`outgoing A: ${aOld ? `${aOld.role} ${aOld.position_title} ${aOld.account_status}` : 'no President profile left'}`);
  if (aOld && aOld.account_status === 'active') rec.defect('app_bug', 'The outgoing President still has active access after the handover.', ['server/app/Services/ElectionHandoverService.php']);
  const cPage = await switchToOrganization('c', rec);
  await cPage.getByRole('navigation').getByRole('link', { name: 'Dashboard' }).first().click();
  await waitSettled(cPage);
  await shot('c', 'winner-home', rec);
}

await step('election_handover', 'In the org: an election for President with candidates B and C, members vote, it ends, results are released, the winner gets access and the outgoing holder is handled', async (rec) => {
  for (const who of ['a', 'b', 'c', 'dean']) {
    if (!people.has(who)) { const s = await signIn(who, rec); if (!s.ok) throw new Error(`${who} sign-in ${s.status}`); }
  }
  // A re-run after the close finds the outgoing President already inactive: only the handover is left to check.
  const spent = ((await api('a', 'GET', '/user/profiles')).body?.profiles ?? []).find((item) => item.organization?.name === ORG.name && item.position_title === 'President' && item.account_status !== 'active');
  if (spent) {
    rec.notes.push('the handover already happened in an earlier run; checking it from the winner');
    await verifyHandover(rec, 'c', await switchToOrganization('c', rec));
    return;
  }
  const aPage = await switchToOrganization('a', rec);
  await waitSettled(aPage);
  // The voting window must fall inside the active semester. When today is outside it, the election can only be planned for the
  // semester's own dates, which means voting and the handover cannot happen today. That is reported, not worked around.
  const period = (await api('a', 'GET', '/academic-periods/active')).body;
  const active = period?.data ?? period?.period ?? period ?? {};
  const semStart = new Date(active.starts_on ?? active.semester?.starts_on ?? 0).getTime();
  const semEnd = new Date(active.ends_on ?? active.semester?.ends_on ?? 0).getTime();
  const todayInside = Date.now() >= semStart && Date.now() < semEnd;
  rec.evidence.push(`active semester runs ${new Date(semStart).toISOString().slice(0, 10)} to ${new Date(semEnd).toISOString().slice(0, 10)}; today is ${todayInside ? 'inside' : 'outside'} it`);
  let election = await currentElection('a');
  const stale = election && election.status === 'upcoming' && new Date(election.end_time).getTime() < Date.now();
  if (stale) rec.notes.push(`election ${election.id} went stale before opening; making a new one`);

  // 1. A creates the election request.
  if (!election || stale) {
    const attempt = (readCreds().election?.attempt ?? 0) + (election ? 1 : 0);
    saveFact('election', 'attempt', attempt);
    const title = attempt ? `${ELECTION_BASE} (${attempt + 1})` : ELECTION_BASE;
    await goSidebar(aPage, rec, /^Elections$/, '/dashboard/elections/manage-elections');
    await waitSettled(aPage);
    await shot('a', 'elections-start', rec);
    await aPage.getByRole('button', { name: /^Create (your first )?election/ }).first().click();
    await aPage.getByLabel('Election title').waitFor({ state: 'visible' });
    await aPage.getByLabel('Election title').fill(title);
    const plannedDay = new Date(semStart + 8 * 3600 * 1000 + 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await aPage.getByLabel('Voting starts').fill(todayInside ? manilaLocal(4 * 60 * 1000) : `${plannedDay}T09:00`);
    await aPage.getByLabel('Voting ends').fill(todayInside ? manilaLocal(11 * 60 * 1000) : `${plannedDay}T17:00`);
    await aPage.getByLabel('Position 1 title').fill('President');
    await aPage.getByLabel(/Informative letter/).setInputFiles(pdf('informative-letter.pdf', `${title} letter`));
    await shot('a', 'election-form', rec);
    await aPage.getByRole('button', { name: /^Submit for approval/ }).click();
    await aPage.getByText(/submitted|sent|waiting for/i).first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    await waitSettled(aPage);
    await shot('a', 'election-submitted', rec);
    election = await currentElection('a');
    if (!election) throw new Error('the election is not listed after Submit for approval');
    rec.evidence.push(`election ${election.id} "${election.title}" submitted, status ${election.status}`);
  }
  saveFact('election', 'id', election.id);

  // 2. The dean approves it under Approvals.
  if (election.status === 'pending_approval') {
    const dp = people.get('dean').page;
    const titlePattern = election.title.replace(/[()]/g, '.');
    await goSidebar(dp, rec, /^Approvals$/, '/dashboard/department-head/approvals');
    await dp.getByRole('button', { name: new RegExp(`(Review|Details): .*${titlePattern}`, 'i') }).first().waitFor({ state: 'visible', timeout: 20000 });
    await shot('dean', 'approvals-list', rec);
    const listText = await bodyText(dp);
    if (/pending_approval|Requested status:/.test(listText)) rec.defect('ux_gap', 'The dean approvals row shows a raw code, "Requested status: pending_approval", instead of plain words.', ['client/src/components/approvals/approvalFormat.js']);
    const shown = listText.match(/Requested by [^·]+· ([A-Z][a-z]{2} \d+, \d{4}, \d+:\d{2} [AP]M)/)?.[1];
    const stamp = election.created_at ? new Date(election.created_at) : null;
    if (shown && stamp) {
      const manila = new Date(stamp.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
      rec.notes.push(`approvals row shows the request time "${shown}"; the election was created at ${manila} Manila`);
    }
    await dp.getByRole('button', { name: new RegExp(`Review: .*${titlePattern}`, 'i') }).first().click();
    await waitSettled(dp);
    await shot('dean', 'approval-open', rec);
    await dp.getByRole('button', { name: /^Approve/ }).first().click();
    await shot('dean', 'approve-confirm', rec);
    const confirm = dp.getByRole('dialog').getByRole('button', { name: /^Approve/ });
    if (await confirm.count()) await confirm.last().click();
    else await dp.getByRole('button', { name: /^Approve/ }).last().click();
    await waitSettled(dp);
    await dp.waitForTimeout(1200);
    await shot('dean', 'approved', rec);
    election = await currentElection('a');
    rec.evidence.push(`after the dean approves: status ${election?.status}`);
  }

  if (process.env.ELECTION_UNTIL === 'approve') return;

  // 3. A builds the ballot: one party list, candidates B and C, then Finalize ballot.
  if (election.status === 'upcoming' && !election.finalized_at) {
    await openElectionAsAdmin(aPage, rec, election);
    await shot('a', 'workspace', rec);
    await aPage.getByRole('link', { name: /Party lists/ }).first().click();
    await waitSettled(aPage);
    await aPage.waitForTimeout(1200);
    if (!(await bodyText(aPage)).includes(`Rehearsal Party ${SUFFIX}`)) {
      await aPage.getByRole('button', { name: /Register party list/ }).first().click();
      await aPage.getByLabel('Party list name').fill(`Rehearsal Party ${SUFFIX}`);
      await shot('a', 'party-form', rec);
      await aPage.getByRole('dialog').getByRole('button', { name: /^Register party list/ }).click();
      await waitSettled(aPage);
      await aPage.getByText(`Rehearsal Party ${SUFFIX}`).first().waitFor({ state: 'visible', timeout: 15000 });
    }
    await shot('a', 'party-added', rec);
    await aPage.getByRole('link', { name: /Candidates/ }).first().click();
    await waitSettled(aPage);
    await aPage.waitForTimeout(1200);
    for (const key of ['b', 'c']) {
      if ((await aPage.locator('main').innerText()).includes(fullName(key))) continue;
      await aPage.getByRole('button', { name: /Add candidate/ }).first().click();
      const combo = aPage.getByRole('dialog').getByRole('combobox').first();
      await combo.click();
      await combo.pressSequentially(SPEC[key].first, { delay: 40 });
      const option = aPage.getByRole('option').filter({ hasText: fullName(key) }).first();
      const found = await option.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
      if (!found) {
        await shot('a', `candidate-not-found-${key}`, rec);
        rec.defect('ux_gap', `${fullName(key)} holds officer access and cannot be added as a candidate: the Student list on Add candidate shows "No students found" because it holds only members with the Student role. An officer cannot run for a higher seat.`, ['client/src/pages/modules/elections/ManageCandidatesPage.jsx']);
        await aPage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
        continue;
      }
      await option.click();
      await aPage.getByRole('dialog').getByLabel('Position').selectOption({ label: 'President' });
      const partyValue = await aPage.getByRole('dialog').getByLabel('Party list').locator('option').evaluateAll((nodes) => nodes.find((node) => /Rehearsal Party/.test(node.textContent))?.value);
      await aPage.getByRole('dialog').getByLabel('Party list').selectOption(partyValue);
      await shot('a', `candidate-form-${key}`, rec);
      await aPage.getByRole('dialog').getByRole('button', { name: /^Add candidate/ }).click();
      await aPage.getByText(fullName(key)).first().waitFor({ state: 'visible', timeout: 15000 });
      await waitSettled(aPage);
      await shot('a', `candidate-added-${key}`, rec);
    }
    await aPage.getByRole('link', { name: /Overview/ }).first().click();
    await waitSettled(aPage);
    await shot('a', 'before-finalize', rec);
    await aPage.getByRole('button', { name: 'Finalize ballot' }).click();
    await aPage.getByRole('button', { name: 'Open voting' }).or(aPage.getByText(/finalized|ballot is final/i)).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await shot('a', 'finalized', rec);
    election = await currentElection('a');
    rec.evidence.push(`ballot finalized: finalized_at ${election?.finalized_at ? 'set' : 'missing'}, status ${election?.status}`);
  }

  if (process.env.ELECTION_UNTIL === 'finalize') return;
  if (!todayInside) {
    rec.defect('data_or_env', `Voting, closing, results release and the access handover cannot be rehearsed on production today: the active semester starts ${new Date(semStart).toISOString().slice(0, 10)} and the first semester is already completed, so no election window can fall on a day that has happened. The ballot was built and finalized for ${new Date(election.start_time).toISOString().slice(0, 10)}. Needs the SAO to set the active semester to cover today, which edits a non-rehearsal row.`, ['server/app/Http/Controllers/ElectionController.php', 'server/app/Http/Controllers/AcademicSemesterController.php']);
    rec.defect('ux_gap', 'The error "The voting period must fall within the semester you are working in." does not name the semester or its dates, so an organization head cannot tell what to change.', ['server/app/Http/Controllers/ElectionController.php', 'client/src/pages/modules/elections/ElectionPickerPage.jsx']);
    return;
  }

  // 4. Voting opens by itself when the window starts (the scheduled status sync).
  if (election.status === 'upcoming') {
    const secondsToStart = Math.max(0, (new Date(election.start_time).getTime() - Date.now()) / 1000);
    rec.notes.push(`waiting ${Math.round(secondsToStart)}s for the voting window, then up to 150s for the scheduler to open it`);
    election = await waitForElection('a', 'active', secondsToStart + 150, rec);
  }

  // 5. A, B and C vote through the ballot screens: A and B pick C, C picks B.
  const cast = async (who, pickKey) => {
    const page = people.get(who).page;
    await switchToOrganization(who, rec);
    // The member votes from the organization profile here; the college profile lists this election too, so this is not the only way in.
    // The strip under the top bar names the profile in view; a head or officer also has the Workspace switcher.
    const onOrg = await page.getByText(new RegExp(`Viewing ${ORG.name}`)).first().isVisible().catch(() => false)
      || new RegExp(ORG.name, 'i').test(await page.getByRole('button', { name: /^Workspace:/ }).innerText({ timeout: 2000 }).catch(() => ''));
    if (!onOrg) rec.defect('app_bug', `${fullName(who)} is not on the organization profile, where the election is voted in.`, ['client/src/components/layout/WorkspaceBanner.jsx']);
    await goSidebar(page, rec, /^Vote$/, '/dashboard/elections/cast-vote');
    await page.waitForURL(/\/elections\/\d+\/vote/, { timeout: 8000 }).catch(() => {});
    await waitSettled(page);
    // The Vote page lists open elections; a person opens theirs with "Vote in this election".
    const openElection = page.getByRole('link', { name: /Vote in this election/ }).or(page.getByRole('button', { name: /Vote in this election/ })).first();
    if (await openElection.count()) {
      await shot(who, 'vote-list', rec);
      await openElection.click();
      await page.waitForURL(/\/elections\/\d+\/vote/, { timeout: 20000 }).catch(() => {});
      await waitSettled(page);
    }
    await shot(who, 'ballot-overview', rec);
    if (/Vote already recorded|Your ballot receipt/i.test(await bodyText(page))) { rec.notes.push(`${who} had already voted`); return; }
    const start = page.getByRole('button', { name: /Start my ballot/ });
    if (!(await start.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false))) {
      const sees = (await bodyText(page)).includes('No election is open for voting');
      rec.defect('app_bug', `${fullName(who === 'a' ? 'a' : who)} holds an active member profile in the organization (an eligible voter) and cannot vote: ${sees ? 'the Vote page says "No election is open for voting" while the election is open' : 'there is no ballot to start'}.`, ['server/app/Http/Controllers/ElectionController.php', 'client/src/pages/elections/']);
      return;
    }
    await start.click();
    await page.getByRole('radio', { name: new RegExp(fullName(pickKey)) }).or(page.getByRole('button', { name: new RegExp(fullName(pickKey)) })).first().click();
    await shot(who, 'ballot-picked', rec);
    await page.getByRole('button', { name: /Review ballot/ }).click();
    await shot(who, 'ballot-review', rec);
    await page.getByRole('button', { name: 'Submit final ballot' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Confirm|Submit/ }).last().click();
    await page.getByText(/Vote recorded|Your ballot was submitted|submitted/i).first().waitFor({ state: 'visible', timeout: 20000 });
    await shot(who, 'ballot-submitted', rec);
  };
  await cast('a', 'c');
  await cast('b', 'c');
  await cast('c', 'b');
  rec.evidence.push('A, B and C voted');

  // C is the plain member: a STUDENT profile in the organization, no officer access, switched into the organization profile and voted there (a member can also vote from the college profile without switching).
  const memberProfile = ((await api('c', 'GET', '/user/profiles')).body?.profiles ?? []).find((item) => item.organization?.name === ORG.name);
  rec.evidence.push(`member C holds ${memberProfile ? `${memberProfile.role} in the organization` : 'no profile in the organization'} and voted`);
  if (memberProfile?.role !== 'STUDENT') rec.defect('app_bug', `The member C has ${memberProfile?.role ?? 'no'} access, not the plain STUDENT member profile, so the rehearsal did not prove a member can vote.`, ['server/app/Http/Controllers/AccountProfileController.php']);
  const voters = (await api('a', 'GET', `/elections/${election.id}/voters`)).body?.summary;
  if (voters) {
    rec.evidence.push(`turnout ${voters.voted_count} of ${voters.eligible_total} eligible voters`);
    if (voters.voted_count !== voters.eligible_total) rec.defect('app_bug', `${voters.eligible_total} members are eligible but ${voters.voted_count} votes were counted.`, ['server/app/Http/Controllers/ElectionController.php', 'server/app/Models/AccountProfile.php']);
  } else rec.notes.push('the voters summary was not readable by A, so turnout was not compared with the eligible count');

  if (process.env.ELECTION_UNTIL === 'vote') return;

  // 6. The window ends, the scheduler closes it, A releases the results, the winner gets access.
  const secondsToEnd = Math.max(0, (new Date(election.end_time).getTime() - Date.now()) / 1000);
  rec.notes.push(`waiting ${Math.round(secondsToEnd)}s for the voting window to end`);
  // The close, the released results and the head access for the winner happen in one move, and the outgoing head loses the
  // workspace in that same move (their API reads answer 403), so the dean watches for the close and the winner checks it.
  election = await waitForElection('dean', 'closed', secondsToEnd + 150, rec);
  // C is still on the full-screen ballot receipt, which has no top bar; step back to a dashboard before opening the menu.
  await people.get('c').page.goto('/dashboard/student');
  await waitSettled(people.get('c').page);
  await verifyHandover(rec, 'c', await switchToOrganization('c', rec));
});

// ---------------------------------------------------------------- records
await step('records', 'SAO opens School year records for the current semester and sees the rehearsal org with officers; opens the org space (Overview, People, Transactions, Documents) read only', async (rec) => {
  if (!people.has('sao')) { const s = await signIn('sao', rec); if (!s.ok) throw new Error(`SAO sign-in ${s.status}`); }
  const page = people.get('sao').page;
  await goSidebar(page, rec, /^Records$|School year records/, '/dashboard/records');
  await waitSettled(page);
  await shot('sao', 'records-start', rec);
  if (!(await page.getByLabel('Find an organization').count())) {
    rec.defect('app_bug', 'School year records opened from the sidebar right after sign-in shows no list of organizations ("Choose an organization" with nothing to choose from) until the page is reloaded: the route reads the role once when the app first renders.', ['client/src/App.jsx', 'client/src/pages/modules/records/RecordsPage.jsx']);
    await page.reload();
    await waitSettled(page);
    await shot('sao', 'records-after-reload', rec);
  }
  const search = page.getByRole('searchbox').or(page.getByPlaceholder(/Find an organization|Search/i)).first();
  if (await search.count()) { await search.fill(ORG.acronym); await page.waitForTimeout(600); }
  const orgRow = page.getByRole('button', { name: new RegExp(ORG.name, 'i') }).or(page.getByRole('link', { name: new RegExp(ORG.name, 'i') })).or(page.getByText(ORG.name)).first();
  await orgRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => rec.defect('app_bug', `School year records does not list the rehearsal organization "${ORG.name}" for the current semester.`, ['server/app/Http/Controllers/RecordsController.php', 'client/src/pages/modules/records/RecordsPage.jsx']));
  if (await orgRow.count()) await orgRow.click();
  await waitSettled(page);
  await page.waitForTimeout(800);
  await shot('sao', 'records-org', rec);
  await waitForText(page, fullName('b'), 8000);
  const text = await bodyText(page);
  const officers = ['a', 'b', 'c'].filter((key) => text.includes(fullName(key)));
  rec.evidence.push(`records page shows the organization and officers: ${officers.map(fullName).join(', ') || 'none'}`);
  if (!officers.includes('b') || !(officers.includes('a') || officers.includes('c'))) rec.defect('app_bug', 'School year records lists fewer officers than the organization has (expected the head and the officer).', ['server/app/Http/Controllers/RecordsController.php']);
  if (!/Read only/i.test(text)) rec.notes.push('the current semester shows no "Read only" badge (expected: it is the live period)');

  // Org space, read only.
  await goSidebar(page, rec, /^Organizations$/, '/dashboard/super-admin/organizations');
  await waitSettled(page);
  if (/Pending review \(0\)/.test(await bodyText(page))) rec.notes.push('the SAO Organizations page opens on the empty "Pending review (0)" tab while "Active (9)" holds the organizations');
  const activeTab = page.getByRole('tab', { name: /^Active/ }).or(page.getByRole('button', { name: /^Active \(\d+\)/ })).or(page.getByText(/^Active \(\d+\)/)).first();
  await activeTab.click();
  await page.waitForTimeout(600);
  await waitSettled(page);
  const find = page.getByRole('searchbox').or(page.getByPlaceholder(/Search/i)).first();
  if (await find.count()) { await find.fill(ORG.acronym); await page.waitForTimeout(800); }
  await shot('sao', 'organizations-list', rec);
  await page.getByRole('button', { name: new RegExp(`Actions for ${ORG.name}`, 'i') }).click();
  await page.getByRole('menuitem', { name: /Open organization/ }).click();
  await page.waitForURL(/\/dashboard\/super-admin\/(org|organizations)\//, { timeout: 20000 });
  await waitSettled(page);
  await shot('sao', 'org-space-overview', rec);
  for (const tab of ['People', 'Transactions', 'Documents']) {
    const control = page.getByRole('tab', { name: new RegExp(tab, 'i') }).first();
    if (!(await control.count())) {
      rec.defect('ux_gap', `The SAO organization space has no "${tab}" tab.`, ['client/src/pages/roles/department-head/OrgSpacePage.jsx']);
      continue;
    }
    await control.click();
    await waitSettled(page);
    await page.waitForTimeout(700);
    const writers = await page.getByRole('tabpanel').getByRole('button', { name: /^(Add|New|Edit|Delete|Record|Remove|Give access|Change)/i }).count();
    if (writers) rec.defect('app_bug', `The SAO ${tab} tab has ${writers} write controls; oversight must be read only.`, ['client/src/pages/roles/department-head/OrgSpacePage.jsx', 'client/src/components/org/OrgAccessPanel.jsx']);
    await shot('sao', `org-space-${tab.toLowerCase()}`, rec);
  }
  rec.evidence.push('SAO opened Overview, People, Transactions and Documents of the organization');
});

// ---------------------------------------------------------------- console_and_layout
async function phoneTour(rec, who, routes, prepare) {
  const key = `phone-${who}`;
  const session = await signIn(who, rec, { key, viewport: PHONE });
  if (!session.ok) throw new Error(`${who} phone sign-in ${session.status}`);
  const page = people.get(key).page;
  if (prepare) await prepare(page);
  for (const [name, route] of routes) {
    await page.goto(route);
    await waitSettled(page);
    await page.waitForTimeout(500);
    await shot(key, name, rec);
    const small = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('button, a[href], input, select, textarea').forEach((node) => {
        if (node.closest('aside, nav, [role="dialog"], [aria-hidden="true"], [inert]')) return;
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height || getComputedStyle(node).visibility === 'hidden') return;
        if (box.left < -1 || box.right > window.innerWidth + 1) bad.push(`${node.tagName.toLowerCase()} "${(node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 30)}" outside the screen`);
      });
      return bad.slice(0, 4);
    });
    for (const item of small) rec.overflow.push(`${who} ${name}: ${item}`);
  }
}

await step('console_and_layout', 'Zero console errors and unexpected failed API calls across every page visited; key screens at 390x844 with no overlap or sideways scroll', async (rec) => {
  // 1. Everything collected in the steps above (this run and earlier ones kept in the results file).
  const all = results.filter((item) => item.key !== 'console_and_layout');
  const seen = new Set();
  const unexpected = [];
  for (const item of all) for (const issue of item.issues ?? []) {
    const id = `${issue.who} ${issue.route} ${issue.kind} ${issue.text}`;
    if (issue.kind === 'console' && /Failed to load resource/.test(issue.text)) continue;
    if (issue.who === 'phone-guest' && /accept-invitation/.test(issue.route)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unexpected.push({ step: item.key, ...issue });
  }
  rec.evidence.push(`${unexpected.length} distinct console errors or failed responses in ${all.length} steps`);
  for (const issue of unexpected.slice(0, 12)) rec.notes.push(`${issue.step}: ${issue.who} ${issue.route} ${issue.kind} ${issue.text}`);
  if (unexpected.length) rec.defect('app_bug', `${unexpected.length} unexpected console errors or failed API calls across the run (see notes).`, ['server/app/Http/Controllers/OrganizationApplicationController.php']);

  // 2. Key screens at 390x844, one fresh phone context per person.
  const app = appId();
  const orgId = readCreds().org?.organization_id;
  await phoneTour(rec, 'sao', [
    ['dashboard', '/dashboard/super-admin'],
    ['colleges', '/dashboard/super-admin/colleges'],
    ['applications', '/dashboard/organization-applications'],
    ['records', '/dashboard/records'],
    ['org-space', `/dashboard/super-admin/org/${orgId}`],
  ]);
  await phoneTour(rec, 'dean', [
    ['dashboard', '/dashboard/department-head'],
    ['people', '/dashboard/department-head/people'],
    ['organizations', '/dashboard/department-head/organizations'],
    ['application', `/dashboard/organization-applications?record=${app}`],
    ['approvals', '/dashboard/department-head/approvals'],
    ['org-space', `/dashboard/department-head/org/${orgId}`],
  ]);
  await phoneTour(rec, 'staff', [
    ['dashboard', '/dashboard/admin'],
    ['people', '/dashboard/department-head/people'],
    ['organizations', '/dashboard/department-head/organizations'],
    ['approvals', '/dashboard/department-head/approvals'],
  ]);
  await phoneTour(rec, 'a', [
    ['dashboard', '/dashboard/student'],
    ['application', `/dashboard/student/organization-applications/${app}`],
  ]);
  await phoneTour(rec, 'b', [
    ['org-dashboard', '/dashboard/student'],
  ], async (page) => {
    const switcher = page.getByRole('button', { name: /^Workspace:/ });
    if (await switcher.count()) {
      await switcher.click();
      await page.getByRole('region', { name: 'Workspaces' }).getByRole('button', { name: new RegExp(ORG.name, 'i') }).click();
      await page.waitForURL(/\/dashboard\/(admin|officer)/, { timeout: 20000 }).catch(() => {});
    }
  });
  const guest = await person('phone-guest', { viewport: PHONE });
  for (const [name, route] of [['login', '/login'], ['sign-up', '/sign-up'], ['bad-invite', '/accept-invitation?token=x']]) {
    // The made-up token is meant to answer 404; the page must then show the expired-link message.
    allowed = name === 'bad-invite' ? [/GET \/api\/department-head-invitations\/x/, /^console Failed to load resource: the server responded with a status of 404/] : [];
    await guest.goto(route);
    await waitSettled(guest);
    await shot('phone-guest', name, rec);
  }
});


await browser.close();
const failed = results.filter((item) => !item.skipped && !item.pass);
console.log(`\n${results.length} steps, ${failed.length} not passing. Results: ${RESULTS}`);
process.exit(failed.length ? 1 : 0);
