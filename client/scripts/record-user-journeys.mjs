import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isHeaded = process.argv.includes('--headed');
const targetUrl = process.env.HIUSA_BASE_URL || 'https://13.228.227.182';
const outputDir = path.join(rootDir, 'test-results', 'sop-videos');
const tempVideoDir = path.join(rootDir, 'test-results', '.temp-videos');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(tempVideoDir, { recursive: true });

const ROLES = [
  {
    key: 'student',
    title: 'Student SOP Journey (Juan Dela Vega)',
    schoolId: '2100142',
    password: 'Demo@12345',
    fileName: '01_student_juan_delavega_sop.webm',
    expectedHome: '/dashboard/student',
    steps: [
      { name: 'Student Dashboard & Feed', path: '/dashboard/student', pause: 2500, scroll: true },
      { name: 'SOP 1: Events & Activity Calendar', path: '/dashboard/events', pause: 2500, scroll: true },
      { name: 'SOP 2: Student Council Elections & Voting', path: '/dashboard/elections', pause: 2500, scroll: true },
      { name: 'SOP 3: Merchandise & Official Store', path: '/dashboard/merchandise', pause: 2500, scroll: true },
      { name: 'SOP 4: Financial Statement of Account / Receipts', path: '/dashboard/finance', pause: 2500, scroll: true },
      { name: 'SOP 5: Student Clearance Requirements', path: '/dashboard/clearance', pause: 2500, scroll: true },
      { name: 'SOP 6: Student Grievances Portal', path: '/dashboard/grievances', pause: 2500, scroll: true },
    ],
  },
  {
    key: 'officer',
    title: 'SBO Officer SOP Journey (Diego Villanueva)',
    schoolId: '900004',
    password: 'Demo@12345',
    fileName: '02_officer_diego_villanueva_sop.webm',
    expectedHome: '/dashboard/officer',
    steps: [
      { name: 'SBO Officer Dashboard & Tasks Briefing', path: '/dashboard/officer', pause: 2500, scroll: true },
      { name: 'SOP 1: Assigned Tasks & Execution', path: '/dashboard/tasks', pause: 2500, scroll: true },
      { name: 'SOP 2: Event Attendee Check-In & Scanner', path: '/dashboard/events/check-in', pause: 2500, scroll: true },
      { name: 'SOP 3: Merchandise Orders & Token Validation', path: '/dashboard/merchandise/manage-orders', pause: 2500, scroll: true },
      { name: 'SOP 4: Announcements & Request Submissions', path: '/dashboard/announcements', pause: 2500, scroll: true },
      { name: 'SOP 5: Organization Financial Overview', path: '/dashboard/finance', pause: 2500, scroll: true },
    ],
  },
  {
    key: 'dept_head',
    title: 'Department Head / Dean SOP Journey (Dean Ramon Castillo)',
    schoolId: '940001',
    password: 'Demo@12345',
    fileName: '03_dean_ramon_castillo_sop.webm',
    expectedHome: '/dashboard/department-head',
    steps: [
      { name: 'Dean Executive Dashboard & College Overview', path: '/dashboard/department-head', pause: 2500, scroll: true },
      { name: 'SOP 1: College Organizations & Compliance', path: '/dashboard/college/organizations', pause: 2500, scroll: true },
      { name: 'SOP 2: Department Approvals Inbox', path: '/dashboard/department-head/approvals', pause: 2500, scroll: true },
      { name: 'SOP 3: College Activity Calendar', path: '/dashboard/events', pause: 2500, scroll: true },
      { name: 'SOP 4: Department Financial Ledger Auditing', path: '/dashboard/finance', pause: 2500, scroll: true },
      { name: 'SOP 5: College Announcements', path: '/dashboard/department-head/announcements', pause: 2500, scroll: true },
    ],
  },
  {
    key: 'admin',
    title: 'Admin / Org President SOP Journey (Marco Dela Cruz)',
    schoolId: '900001',
    password: 'Demo@12345',
    fileName: '04_admin_marco_delacruz_sop.webm',
    expectedHome: '/dashboard/admin',
    steps: [
      { name: 'Organization Leadership Dashboard', path: '/dashboard/admin', pause: 2500, scroll: true },
      { name: 'SOP 1: Event Lifecycle & Management', path: '/dashboard/events/manage-events', pause: 2500, scroll: true },
      { name: 'SOP 2: Comprehensive Financial Suite & Ledgers', path: '/dashboard/finance/financial-ledger', pause: 2500, scroll: true },
      { name: 'SOP 3: Task Delegation Board & Scoring', path: '/dashboard/tasks/task-board', pause: 2500, scroll: true },
      { name: 'SOP 4: Student Council Election Management', path: '/dashboard/elections/manage-elections', pause: 2500, scroll: true },
      { name: 'SOP 5: Organization Member Dock & Roster', path: '/dashboard/users', pause: 2500, scroll: true },
      { name: 'SOP 6: Merchandise Inventory & Pricing', path: '/dashboard/merchandise/manage-inventory', pause: 2500, scroll: true },
    ],
  },
  {
    key: 'sao',
    title: 'SAO / Super Admin SOP Journey (SAO Director)',
    schoolId: '990001',
    password: 'Admin@123456',
    fileName: '05_sao_super_admin_sop.webm',
    expectedHome: '/dashboard/super-admin',
    steps: [
      { name: 'SAO Institutional Agency Dashboard', path: '/dashboard/super-admin', pause: 2500, scroll: true },
      { name: 'SOP 1: Academic Semesters & Lifecycle', path: '/dashboard/academic-semesters', pause: 2500, scroll: true },
      { name: 'SOP 2: University Organizations Master Registry', path: '/dashboard/organizations', pause: 2500, scroll: true },
      { name: 'SOP 3: Institutional Compliance Requirements', path: '/dashboard/compliance', pause: 2500, scroll: true },
      { name: 'SOP 4: University-wide Official Announcements', path: '/dashboard/announcements', pause: 2500, scroll: true },
      { name: 'SOP 5: Security Audit Trail & Access Logs', path: '/dashboard/audit-logs', pause: 2500, scroll: true },
    ],
  },
];

async function recordJourney(browser, roleConfig) {
  console.log(`\n============================================================`);
  console.log(`Starting: ${roleConfig.title}`);
  console.log(`Target: ${targetUrl} | User: ${roleConfig.schoolId}`);
  console.log(`============================================================`);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  try {
    // 1. Navigate to login
    console.log(`  -> Opening Login Page...`);
    await page.goto(`${targetUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    // 2. Perform Login with throttle retry
    console.log(`  -> Submitting credentials for ${roleConfig.schoolId}...`);
    await page.getByLabel(/School ID/i).fill(roleConfig.schoolId);
    await page.waitForTimeout(400);
    await page.getByLabel(/^Password/i).fill(roleConfig.password);
    await page.waitForTimeout(600);

    let signedIn = false;
    for (let attempt = 0; attempt < 5 && !signedIn; attempt++) {
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/login') && r.request().method() === 'POST', { timeout: 20000 }),
        page.getByRole('button', { name: /^Sign in/i }).click(),
      ]);

      if (response.status() === 429) {
        console.log(`  (Login throttled 429, waiting 15s before retrying...)`);
        await page.waitForTimeout(15000);
      } else if (response.status() === 200) {
        signedIn = true;
      }
    }

    await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 25000 });
    await page.waitForTimeout(2000);

    // 3. Step through each SOP
    for (const step of roleConfig.steps) {
      console.log(`  -> Executing: ${step.name} (${step.path})`);
      await page.goto(`${targetUrl}${step.path}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(async () => {
        await page.waitForTimeout(1500);
      });

      await page.waitForTimeout(step.pause || 2000);

      if (step.scroll) {
        // Smooth scroll down to show the full dashboard content
        await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.scrollBy({ top: -350, behavior: 'smooth' }));
        await page.waitForTimeout(800);
      }
    }

    console.log(`  -> Completed SOP walkthrough for ${roleConfig.key}`);
    await page.waitForTimeout(1500);
  } catch (err) {
    console.error(`  [WARN] Issue during ${roleConfig.key} walkthrough:`, err.message);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const rawPath = await video.path();
      const finalPath = path.join(outputDir, roleConfig.fileName);
      if (fs.existsSync(rawPath)) {
        fs.copyFileSync(rawPath, finalPath);
        const stats = fs.statSync(finalPath);
        const mb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`  [VIDEO SAVED] ${roleConfig.fileName} (${mb} MB)`);
      }
    }
  }
}

async function main() {
  console.log(`Starting HIUSA User Journey & SOP Video Recording`);
  console.log(`Target Address: ${targetUrl}`);
  console.log(`Browser Mode: ${isHeaded ? 'HEADED (Visible Desktop Window)' : 'HEADLESS'}`);
  console.log(`Resolution: 1280x720 HD`);
  console.log(`Output Directory: ${outputDir}\n`);

  const browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 100 : 0,
  });

  const startTime = Date.now();

  const roleArg = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
  const activeRoles = roleArg ? ROLES.filter((r) => r.key === roleArg) : ROLES;

  for (let i = 0; i < activeRoles.length; i++) {
    const role = activeRoles[i];
    await recordJourney(browser, role);
    if (i < activeRoles.length - 1) {
      console.log(`  (cooling down 4 seconds between role sessions)`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  await browser.close();

  // Clean up temp video folder
  try {
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  } catch {}

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n============================================================`);
  console.log(`All User Journey Videos Recorded Successfully in ${durationSec}s!`);
  console.log(`Location: ${outputDir}`);
  console.log(`============================================================`);

  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.webm'));
  for (const f of files) {
    const s = fs.statSync(path.join(outputDir, f));
    console.log(`  - ${f} (${(s.size / (1024 * 1024)).toFixed(2)} MB)`);
  }
}

main().catch((err) => {
  console.error('Fatal error during video recording:', err);
  process.exit(1);
});
