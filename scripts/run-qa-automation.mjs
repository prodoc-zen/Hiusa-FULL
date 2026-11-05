import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../client/node_modules/playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = 'C:\\Users\\JM\\.gemini\\antigravity\\brain\\4ac8fa2c-3b42-4b82-a016-00a1085c702d\\screenshots';

const API_BASE = 'http://127.0.0.1:8000/api';
const CLIENT_BASE = 'http://127.0.0.1:5173';

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function getAuthSession(school_id, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ school_id, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${school_id}: HTTP ${res.status}`);
  }
  return await res.json();
}

async function injectSession(page, session) {
  const expiresAt = Date.now() + (session.session_expires_in_seconds || 14400) * 1000;
  await page.goto(`${CLIENT_BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user, expiresAt }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('auth_expires_at', String(expiresAt));
  }, { token: session.access_token, user: session.user, expiresAt });
}

async function capture(page, name, options = {}) {
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: options.fullPage ?? false });
  return filePath;
}

const RESULTS = [];

async function runTest(id, module, title, fn) {
  const start = Date.now();
  console.log(`\n▶ [${id}] ${title}...`);
  try {
    const screenshot = await fn();
    const duration = Date.now() - start;
    console.log(`  ✓ PASS (${duration}ms) -> ${screenshot ? path.basename(screenshot) : 'no screenshot'}`);
    RESULTS.push({ id, module, title, status: 'PASS', duration, screenshot: screenshot ? path.basename(screenshot) : null });
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`  ✗ FAIL (${duration}ms): ${err.message}`);
    RESULTS.push({ id, module, title, status: 'FAIL', duration, error: err.message });
  }
}

async function main() {
  console.log('=== HIUSA AUTOMATED SPREADSHEET QA TEST RUNNER ===');
  console.log(`Client Base: ${CLIENT_BASE}`);
  console.log(`API Base: ${API_BASE}`);
  console.log(`Screenshots Directory: ${SCREENSHOTS_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  // Pre-fetch auth sessions
  console.log('\nAuthenticating demo accounts...');
  const saoSession = await getAuthSession(990001, 'Admin@123456');
  const deanSession = await getAuthSession(940001, 'Demo@12345');
  const adminSession = await getAuthSession(900001, 'Demo@12345');
  const officerSession = await getAuthSession(900004, 'Demo@12345');
  const studentSession = await getAuthSession(2100142, 'Demo@12345');
  console.log('✓ All 5 role sessions acquired.');

  // ==========================================
  // SECTION 1: GENERAL & AUTH (GEN)
  // ==========================================
  await runTest('GEN-001', 'Landing & Public', 'Public Landing Page Hero & Navigation', async () => {
    await page.goto(`${CLIENT_BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=HIUSA');
    return await capture(page, '01_GEN-001_Landing_Page', { fullPage: true });
  });

  await runTest('GEN-002', 'Sign in & Auth', 'Official Sign In Page with School ID Input', async () => {
    await page.goto(`${CLIENT_BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[inputmode="numeric"]');
    return await capture(page, '02_GEN-002_Sign_In_Page');
  });

  await runTest('GEN-003', 'Sign in & Auth', 'Wrong password validation error message', async () => {
    await page.goto(`${CLIENT_BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[inputmode="numeric"]').fill('990001');
    await page.locator('input[type="password"]').fill('WrongPassword123');
    await page.locator('button[type="submit"]').click();
    await page.waitForSelector('[role="alert"]', { timeout: 10000 });
    return await capture(page, '03_GEN-003_Invalid_Password_Alert');
  });

  // ==========================================
  // SECTION 2: SAO REGULATOR (SAO)
  // ==========================================
  await runTest('SAO-001', 'Dashboard & Oversight', 'SAO Command Center Dashboard with Welcome Banner', async () => {
    await injectSession(page, saoSession);
    await page.evaluate(() => localStorage.removeItem('hiusa_tour_seen_SUPER_ADMIN'));
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=SAO');
    await page.waitForSelector('text=Welcome to your HIUSA Workspace');
    return await capture(page, '04_SAO-001_Dashboard_Welcome');
  });

  await runTest('SAO-002', 'Interactive Tour', 'Interactive Onboarding Tour HUD with 4 Tracks', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('hiusa-open-onboarding-tour')));
    await page.waitForSelector('[role="dialog"][aria-label="Interactive role onboarding tour"]');
    await page.waitForSelector('text=SAO University-Wide Command Center');
    return await capture(page, '05_SAO-002_Interactive_Role_Tour_HUD');
  });

  await runTest('SAO-008', 'Organizations', 'System Organizations Oversight & Management', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin/organizations`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '06_SAO-008_Organizations_Management');
  });

  await runTest('SAO-019', 'Academic Terms', 'University Academic Years & Semesters Administration', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin/academic-terms`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '07_SAO-019_Academic_Terms_Calendar');
  });

  await runTest('SAO-027', 'Compliance', 'Accreditation Requirements & Document Upload Checklist', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin/compliance`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '08_SAO-027_Compliance_Requirements');
  });

  await runTest('SAO-035', 'Venues', 'Campus Venue Catalog & Reservation Review', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin/venues`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '09_SAO-035_Campus_Venues_Management');
  });

  await runTest('SAO-040', 'Clearances', 'Stage 3 University-Wide Final Clearance Sign-Off', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/super-admin/clearances`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '10_SAO-040_Stage3_University_Clearances');
  });

  // ==========================================
  // SECTION 3: DEPARTMENT HEAD / DEAN (DH)
  // ==========================================
  await runTest('DH-001', 'Dean Governance', 'College Dean Governance Workspace (College of Computer Studies)', async () => {
    await injectSession(page, deanSession);
    await page.evaluate(() => localStorage.setItem('hiusa_tour_seen_DEPARTMENT_HEAD', 'true'));
    await page.goto(`${CLIENT_BASE}/dashboard/department-head`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=College of Computer Studies');
    return await capture(page, '11_DH-001_Dean_College_Dashboard');
  });

  await runTest('DH-008', 'College Organizations', 'Dean Oversight of College Student Organizations', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/department-head/organizations`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '12_DH-008_College_Organizations_Roster');
  });

  await runTest('DH-020', 'Approvals', 'Stage 1 Academic Endorsement Queue (Budgets & Events)', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/department-head/approvals`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '13_DH-020_Dean_Stage1_Approvals_Queue');
  });

  await runTest('DH-025', 'Clearances', 'Stage 2 College Clearances Review & Holds', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/department-head/clearances`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '14_DH-025_Dean_Stage2_College_Clearances');
  });

  // ==========================================
  // SECTION 4: ORGANIZATION ADMIN / PRESIDENT (ADM)
  // ==========================================
  await runTest('ADM-001', 'Admin Command Center', 'Organization President Command Center (PSITS-CCS)', async () => {
    await injectSession(page, adminSession);
    await page.evaluate(() => localStorage.setItem('hiusa_tour_seen_ADMIN', 'true'));
    await page.goto(`${CLIENT_BASE}/dashboard/admin`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '15_ADM-001_Admin_Dashboard');
  });

  await runTest('ADM-010', 'People & Members', 'Organization Members Directory & Officer Roles', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/admin/users`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '16_ADM-010_Members_Directory');
  });

  await runTest('ADM-020', 'Finance', 'Auditable Financial Suite & Budget Allocation', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/finance/budget-allocation`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '17_ADM-020_Finance_Budget_Allocation');
  });

  await runTest('ADM-035', 'Events', 'Event Proposals, Scheduling & Venue Bookings', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/events/manage-events`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '18_ADM-035_Events_Proposals_Management');
  });

  await runTest('ADM-045', 'Tasks', 'AI-Assisted Task Delegation Board', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/tasks/task-board`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '19_ADM-045_AI_Task_Delegation_Board');
  });

  await runTest('ADM-060', 'Elections', 'Student Council Elections & Candidate Slates', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/elections`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '20_ADM-060_Elections_Management');
  });

  await runTest('ADM-075', 'Store & Merchandise', 'Organization Merchandise Inventory Management', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/merchandise/manage-items`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '21_ADM-075_Merchandise_Inventory_Store');
  });

  // ==========================================
  // SECTION 5: SBO OFFICER (SBO)
  // ==========================================
  await runTest('SBO-001', 'Officer Workspace', 'SBO Officer Operational Dashboard', async () => {
    await injectSession(page, officerSession);
    await page.evaluate(() => localStorage.setItem('hiusa_tour_seen_SBO_OFFICER', 'true'));
    await page.goto(`${CLIENT_BASE}/dashboard/officer`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '22_SBO-001_Officer_Workspace');
  });

  await runTest('SBO-010', 'My Tasks', 'Officer Assigned Tasks & Milestone Tracker', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/tasks/assigned-tasks`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '23_SBO-010_Officer_Assigned_Tasks');
  });

  await runTest('SBO-020', 'Orders Verification', 'Merchandise Orders & GCash Payment Proof Verification', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/merchandise/manage-orders`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '24_SBO-020_Orders_GCash_Verification');
  });

  // ==========================================
  // SECTION 6: STUDENT PORTAL (STU)
  // ==========================================
  await runTest('STU-001', 'Student Portal', 'Student Self-Service Portal & Personal Account', async () => {
    await injectSession(page, studentSession);
    await page.evaluate(() => localStorage.setItem('hiusa_tour_seen_STUDENT', 'true'));
    await page.goto(`${CLIENT_BASE}/dashboard/student`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '25_STU-001_Student_Self_Service_Portal');
  });

  await runTest('STU-010', 'My Clearance', 'Student 3-Stage Clearance Tracker & Status Verification', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/my-clearance`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '26_STU-010_Student_Clearance_Tracker');
  });

  await runTest('STU-020', 'Statement of Account', 'Student Statement of Account & Fee Invoices', async () => {
    await page.goto(`${CLIENT_BASE}/dashboard/finance/statement-of-account`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main');
    return await capture(page, '27_STU-020_Student_Statement_Of_Account');
  });

  await browser.close();

  console.log('\n==========================================');
  console.log('QA AUTOMATION EXECUTION SUMMARY:');
  const passCount = RESULTS.filter((r) => r.status === 'PASS').length;
  const failCount = RESULTS.filter((r) => r.status === 'FAIL').length;
  console.log(`TOTAL TESTS: ${RESULTS.length}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`PASS RATE: ${((passCount / RESULTS.length) * 100).toFixed(1)}%`);
  console.log('==========================================\n');

  fs.writeFileSync(
    path.join(SCREENSHOTS_DIR, 'qa_automation_results.json'),
    JSON.stringify(RESULTS, null, 2)
  );
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});

