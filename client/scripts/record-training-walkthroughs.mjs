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
const outputDir = path.join(rootDir, 'test-results', 'training-walkthroughs');
const tempVideoDir = path.join(rootDir, 'test-results', '.temp-training-videos');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(tempVideoDir, { recursive: true });

async function showTrainingCard(page, { step, total, title, instruction, tip }) {
  await page.evaluate(({ step, total, title, instruction, tip }) => {
    let hud = document.getElementById('hiusa-training-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'hiusa-training-hud';
      hud.style.position = 'fixed';
      hud.style.bottom = '22px';
      hud.style.right = '24px';
      hud.style.maxWidth = '460px';
      hud.style.backgroundColor = 'rgba(15, 23, 42, 0.94)';
      hud.style.color = '#ffffff';
      hud.style.borderRadius = '14px';
      hud.style.padding = '16px 20px';
      hud.style.boxShadow = '0 20px 30px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.2)';
      hud.style.border = '1px solid rgba(56, 189, 248, 0.35)';
      hud.style.backdropFilter = 'blur(16px)';
      hud.style.fontFamily = 'Poppins, ui-sans-serif, system-ui, sans-serif';
      hud.style.zIndex = '9999999';
      hud.style.pointerEvents = 'none';
      hud.style.transition = 'all 0.35s ease';
      document.body.appendChild(hud);
    }
    hud.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #38bdf8; display: flex; align-items: center; gap: 5px;">
          <span>🎓</span> UCLM ONBOARDING • STEP ${step} OF ${total}
        </span>
        <span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background-color: rgba(56, 189, 248, 0.2); color: #bae6fd; border: 1px solid rgba(56, 189, 248, 0.4);">
          SOP GUIDE
        </span>
      </div>
      <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 5px; line-height: 1.35;">
        ${title}
      </div>
      <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.5; margin-bottom: 10px;">
        ${instruction}
      </div>
      ${tip ? `
        <div style="display: flex; align-items: flex-start; gap: 6px; font-size: 11.5px; color: #fde68a; background: rgba(245, 158, 11, 0.15); padding: 7px 10px; border-radius: 8px; border-left: 3px solid #f59e0b;">
          <span style="font-size: 13px;">💡</span><span style="line-height: 1.4;">${tip}</span>
        </div>
      ` : ''}
    `;
    hud.style.opacity = '1';
    hud.style.transform = 'translateY(0)';
  }, { step, total, title, instruction, tip });
}

const MODULES = [
  {
    key: 'student',
    title: 'Student Training & SOP Walkthrough',
    schoolId: '2100142',
    password: 'Demo@12345',
    fileName: '01_student_training_walkthrough.webm',
    steps: [
      {
        title: 'Student Dashboard & Campus Activity Feed',
        path: '/dashboard/student',
        instruction: 'The central student hub. Access urgent university announcements, view upcoming events, and check live voting deadlines directly from your campus feed.',
        tip: 'Check this feed weekly for official academic updates and organization activities.',
        scroll: true,
      },
      {
        title: 'Activity Calendar & Event Registration',
        path: '/dashboard/events',
        instruction: 'Browse accredited college events and workshops. Open any event card to view the venue, time schedule, and available registration slots.',
        tip: 'Clicking Register reserves your slot. Attendance is confirmed on event day via QR or biometric scanners.',
        scroll: true,
      },
      {
        title: 'Student Council Elections & Digital Ballot',
        path: '/dashboard/elections',
        instruction: 'Exercise your voting rights during active council elections. Inspect certified party lists, candidate qualifications, and cast your encrypted ballot.',
        tip: 'Elections are finalized and audited. You can only vote once per elective council position.',
        scroll: true,
      },
      {
        title: 'Official Department Merchandise Store',
        path: '/dashboard/merchandise',
        instruction: 'Order official organization shirts, lanyards, and accessories. Select your size, upload payment proof (GCash), and receive a secure claim token.',
        tip: 'Save your digital release token. Present it to SBO officers at the release desk to claim your order.',
        scroll: true,
      },
      {
        title: 'Statement of Account & Official Receipts',
        path: '/dashboard/finance',
        instruction: 'Track personal fee balances, membership dues, and verified payment receipts with full accounting transparency.',
        tip: 'Official receipts are archived digitally for end-of-semester clearance verification.',
        scroll: true,
      },
      {
        title: 'Semester Clearance Checklist & Progress',
        path: '/dashboard/clearance',
        instruction: 'Monitor your graduation and enrollment clearance status across organization, department, and university signatories.',
        tip: 'All organization dues and library returns must be cleared to complete your signing.',
        scroll: true,
      },
      {
        title: 'Student Inquiries & Grievances Portal',
        path: '/dashboard/grievances',
        instruction: 'Submit formal appeals, concerns, or academic inquiries directly to organization leaders and the Student Affairs Office with full privacy.',
        tip: 'Each grievance receives a tracking ID and documented response from designated signatories.',
        scroll: true,
      },
    ],
  },
  {
    key: 'officer',
    title: 'SBO Officer Training & SOP Walkthrough',
    schoolId: '900004',
    password: 'Demo@12345',
    fileName: '02_sbo_officer_training_walkthrough.webm',
    steps: [
      {
        title: 'Officer Operational Command & Duty Briefing',
        path: '/dashboard/officer',
        instruction: 'Your officer workspace. Review priority assignments, monitor event logistics, and access specialized operational tools.',
        tip: 'Urgent task deadlines and upcoming check-in rosters appear at the top of your briefing.',
        scroll: true,
      },
      {
        title: 'Task Execution & Milestone Progress Updates',
        path: '/dashboard/tasks',
        instruction: 'Manage operational assignments delegated by the organization president. Transition tasks from pending to in progress and log milestone notes.',
        tip: 'Completing tasks on time updates your officer performance and workload balance score.',
        scroll: true,
      },
      {
        title: 'Event Attendee Check-In & Biometric Scanner',
        path: '/dashboard/events/check-in',
        instruction: 'Verify student attendance at college events using optical QR code scanners or DigitalPersona fingerprint biometrics.',
        tip: 'Biometric verification records a tamper-proof timestamp directly into the official attendance register.',
        scroll: true,
      },
      {
        title: 'Merchandise Order Queue & Token Validation',
        path: '/dashboard/merchandise/manage-orders',
        instruction: 'Verify student payment receipts, approve paid merchandise orders, and scan digital release tokens when handing out merchandise items.',
        tip: 'Switch to the Token Validator tab to release items instantly by entering the 6-character claim token.',
        scroll: true,
      },
      {
        title: 'Drafting Announcements & Executive Requests',
        path: '/dashboard/announcements',
        instruction: 'Draft official bulletins and event announcements. Submit drafts for executive review and dean approval before public broadcast.',
        tip: 'Announcements can be targeted to specific year levels, programs, or the entire department.',
        scroll: true,
      },
      {
        title: 'Organization Treasury & Account Oversight',
        path: '/dashboard/finance',
        instruction: 'Inspect organization fund balances, bank accounts, and recorded cash advances with read-only audit transparency.',
        tip: 'All disbursement vouchers and liquidation receipts are logged in the financial audit trail.',
        scroll: true,
      },
    ],
  },
  {
    key: 'dept_head',
    title: 'Department Head & Dean Training Walkthrough',
    schoolId: '940001',
    password: 'Demo@12345',
    fileName: '03_dean_department_head_training_walkthrough.webm',
    steps: [
      {
        title: 'College Executive Briefing & Department Overview',
        path: '/dashboard/department-head',
        instruction: 'The Dean command center. Monitor student organization health, review pending approvals count, and inspect college-wide activity metrics.',
        tip: 'The briefing highlights critical items requiring executive dean review and signature.',
        scroll: true,
      },
      {
        title: 'College Student Organizations & Accreditation',
        path: '/dashboard/college/organizations',
        instruction: 'Oversee recognized student bodies (such as PSITS-CCS). Audit officer qualifications, membership rosters, and compliance submissions.',
        tip: 'Organizations must maintain active accreditation compliance to qualify for university funding.',
        scroll: true,
      },
      {
        title: 'Department Approvals Inbox (Events, Budgets, Elections)',
        path: '/dashboard/department-head/approvals',
        instruction: 'Administrative review pipeline. Review submitted event permits, venue reservations, budget proposals, and student council elections.',
        tip: 'Inspect uploaded informative letters and safety plans before issuing official dean approval.',
        scroll: true,
      },
      {
        title: 'Master College Calendar & Scheduling Coordination',
        path: '/dashboard/events',
        instruction: 'Oversee all scheduled student activities across the college calendar to prevent scheduling conflicts with university examinations.',
        tip: 'Approved events automatically synchronize with campus venue reservations.',
        scroll: true,
      },
      {
        title: 'College Financial Ledger & Fund Auditing',
        path: '/dashboard/finance',
        instruction: 'Audit organization financial statements, verified fee collections, and approved budget disbursements across the college.',
        tip: 'Financial statements are archived by academic semester for university accreditation audits.',
        scroll: true,
      },
      {
        title: 'Broadcasting Official College Announcements',
        path: '/dashboard/department-head/announcements',
        instruction: 'Broadcast official administrative notices and executive memos to all faculty and students within the College of Computer Studies.',
        tip: 'Dean announcements are pinned to the top of all department student feeds.',
        scroll: true,
      },
    ],
  },
  {
    key: 'admin',
    title: 'Organization Admin & President Training Walkthrough',
    schoolId: '900001',
    password: 'Demo@12345',
    fileName: '04_organization_admin_training_walkthrough.webm',
    steps: [
      {
        title: 'Organization Leadership Command Center',
        path: '/dashboard/admin',
        instruction: 'The executive hub for PSITS-CCS leadership. Monitor active member counts, operational funds, pending approvals, and active tasks.',
        tip: 'High-level KPIs summarize organizational readiness and semester milestones at a glance.',
        scroll: true,
      },
      {
        title: 'Event Planning, Requirements & Approval Lifecycle',
        path: '/dashboard/events/manage-events',
        instruction: 'Plan official events, reserve campus facilities, upload safety permits and informative letters, and submit for dean authorization.',
        tip: 'Events move through structured lifecycle states: Planning, Pending Approval, Approved, and Ongoing.',
        scroll: true,
      },
      {
        title: 'Comprehensive 7-Tab Financial Management Suite',
        path: '/dashboard/finance/financial-ledger',
        instruction: 'Manage organization finances across seven modules: Ledger, Budget Allocation, Fee Collections, Cash Advances, Remittances, and AI Forecasting.',
        tip: 'AI decision-support models analyze historical spending patterns to forecast future budget health.',
        scroll: true,
      },
      {
        title: 'Officer Task Delegation & Workload Scoring Board',
        path: '/dashboard/tasks/task-board',
        instruction: 'Delegate operational duties to executive officers. The system calculates workload, role affinity, and performance scores for balanced delegation.',
        tip: 'Review officer scores before assigning critical logistical responsibilities.',
        scroll: true,
      },
      {
        title: 'Student Council Election Setup & Ballot Finalization',
        path: '/dashboard/elections/manage-elections',
        instruction: 'Configure council elections: establish voting timelines, define elective positions, certify party lists, and finalize official voter ballots.',
        tip: 'Once finalized and active, ballots are locked to prevent tampering during live voting.',
        scroll: true,
      },
      {
        title: 'Member Dock, Student Roster & Biometric Records',
        path: '/dashboard/users',
        instruction: 'Maintain the official membership registry. Filter by year level or section, assign officer privileges, and verify fingerprint enrollment.',
        tip: 'Biometric templates are stored securely as cryptographic hashes for identity verification.',
        scroll: true,
      },
      {
        title: 'Merchandise Inventory, Stock Control & Revenue',
        path: '/dashboard/merchandise/manage-inventory',
        instruction: 'Configure official department apparel, set size inventory thresholds, establish retail pricing, and monitor net sales revenue.',
        tip: 'Low-stock warnings automatically flag items requiring procurement replenishment.',
        scroll: true,
      },
    ],
  },
  {
    key: 'sao',
    title: 'Student Affairs Office (SAO) Super Admin Training Walkthrough',
    schoolId: '990001',
    password: 'Admin@123456',
    fileName: '05_sao_super_admin_training_walkthrough.webm',
    steps: [
      {
        title: 'University Student Affairs Office (SAO) Command',
        path: '/dashboard/super-admin',
        instruction: 'The central institutional agency dashboard. Monitor all colleges, recognized student organizations, total campus membership, and active terms.',
        tip: 'Provides university-wide visibility over governance, accreditation, and student welfare.',
        scroll: true,
      },
      {
        title: 'Academic Structure & Semester Lifecycle Management',
        path: '/dashboard/academic-semesters',
        instruction: 'Define academic years and schedule semester dates. Activating the current semester establishes the baseline for all organization activities.',
        tip: 'All event schedules, budget appropriations, and elections are scoped to the active academic semester.',
        scroll: true,
      },
      {
        title: 'Master Registry of Recognized Student Organizations',
        path: '/dashboard/organizations',
        instruction: 'Maintain the official university registry. Review annual accreditation filings, inspect constitutions, and oversee college council recognition.',
        tip: 'De-recognized or inactive organizations are automatically restricted from booking university venues.',
        scroll: true,
      },
      {
        title: 'Institutional Compliance Requirements Builder',
        path: '/dashboard/compliance',
        instruction: 'Establish mandatory university compliance standards (constitutions, financial audits, semestral accomplishment reports, and activity permits).',
        tip: 'Organizations must fulfill these institutional requirements to qualify for annual university awards.',
        scroll: true,
      },
      {
        title: 'Broadcasting University-Wide Official Announcements',
        path: '/dashboard/announcements',
        instruction: 'Publish emergency bulletins and institutional notices broadcast to all student, officer, and faculty workspaces across all colleges.',
        tip: 'Emergency notices trigger high-priority alerts across all mobile and web dashboards.',
        scroll: true,
      },
      {
        title: 'System Security Audit Trail & Access Logs',
        path: '/dashboard/audit-logs',
        instruction: 'Review tamper-evident security audit logs: track user logins, credential changes, role modifications, financial transactions, and configuration updates.',
        tip: 'Every sensitive administrative action is logged with user identity, timestamp, and network IP details.',
        scroll: true,
      },
    ],
  },
];

async function recordTrainingModule(browser, module) {
  console.log(`\n============================================================`);
  console.log(`Starting Training Walkthrough: ${module.title}`);
  console.log(`Target: ${targetUrl} | User: ${module.schoolId}`);
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
    console.log(`  -> Submitting credentials for ${module.schoolId}...`);
    await page.getByLabel(/School ID/i).fill(module.schoolId);
    await page.waitForTimeout(400);
    await page.getByLabel(/^Password/i).fill(module.password);
    await page.waitForTimeout(600);

    let signedIn = false;
    for (let attempt = 0; attempt < 5 && !signedIn; attempt++) {
      const answered = page.waitForResponse((r) => r.url().includes('/api/login') && r.request().method() === 'POST', { timeout: 20000 });
      await page.getByRole('button', { name: /^Sign in/i }).click();
      const response = await answered;

      if (response.status() === 429) {
        console.log(`  (Login throttled 429, waiting 15s before retrying...)`);
        await page.waitForTimeout(15000);
      } else if (response.status() === 200) {
        signedIn = true;
      }
    }

    await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 25000 });
    await page.waitForTimeout(2000);

    // 3. Step through each training step
    for (let i = 0; i < module.steps.length; i++) {
      const step = module.steps[i];
      console.log(`  -> Step ${i + 1}/${module.steps.length}: ${step.title}`);

      await page.goto(`${targetUrl}${step.path}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(async () => {
        await page.waitForTimeout(1500);
      });

      // Inject the educational training card
      await showTrainingCard(page, {
        step: i + 1,
        total: module.steps.length,
        title: step.title,
        instruction: step.instruction,
        tip: step.tip,
      });

      // Smooth pacing so viewers can read the slide and observe the UI
      await page.waitForTimeout(1500);

      if (step.scroll) {
        await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }));
        await page.waitForTimeout(1800);
        await page.evaluate(() => window.scrollBy({ top: -380, behavior: 'smooth' }));
        await page.waitForTimeout(1200);
      } else {
        await page.waitForTimeout(2000);
      }
    }

    console.log(`  -> Completed training walkthrough for ${module.key}`);
    await page.waitForTimeout(2000);
  } catch (err) {
    console.error(`  [WARN] Issue during ${module.key} training walkthrough:`, err.message);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const rawPath = await video.path();
      const finalPath = path.join(outputDir, module.fileName);
      if (fs.existsSync(rawPath)) {
        fs.copyFileSync(rawPath, finalPath);
        const stats = fs.statSync(finalPath);
        const mb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`  [TRAINING VIDEO SAVED] ${module.fileName} (${mb} MB)`);
      }
    }
  }
}

async function main() {
  console.log(`Starting HIUSA User Training & Onboarding Video Generation`);
  console.log(`Target Address: ${targetUrl}`);
  console.log(`Browser Mode: ${isHeaded ? 'HEADED (Visible Desktop Window)' : 'HEADLESS'}`);
  console.log(`Resolution: 1280x720 HD with On-Screen Training HUD`);
  console.log(`Output Directory: ${outputDir}\n`);

  const browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 60 : 0,
  });

  const startTime = Date.now();

  const roleArg = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
  const activeModules = roleArg ? MODULES.filter((m) => m.key === roleArg) : MODULES;

  for (let i = 0; i < activeModules.length; i++) {
    const module = activeModules[i];
    await recordTrainingModule(browser, module);
    if (i < activeModules.length - 1) {
      console.log(`  (cooling down 8 seconds between role modules)`);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }

  await browser.close();

  // Clean up temp video folder
  try {
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  } catch {}

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n============================================================`);
  console.log(`All Training & Onboarding Walkthrough Videos Recorded in ${durationSec}s!`);
  console.log(`Location: ${outputDir}`);
  console.log(`============================================================`);

  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.webm'));
  for (const f of files) {
    const s = fs.statSync(path.join(outputDir, f));
    console.log(`  - ${f} (${(s.size / (1024 * 1024)).toFixed(2)} MB)`);
  }
}

main().catch((err) => {
  console.error('Fatal error during training video generation:', err);
  process.exit(1);
});
