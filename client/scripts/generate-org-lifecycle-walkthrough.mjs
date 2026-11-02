import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isHeaded = process.argv.includes('--headed');
const targetUrl = process.env.HIUSA_BASE_URL || 'https://13.228.227.182';
const outputDir = path.join(rootDir, 'test-results', 'voiceover-walkthroughs');
const audioCacheDir = path.join(rootDir, 'test-results', '.voiceover-audio-cache', 'org_lifecycle');
const tempVideoDir = path.join(rootDir, 'test-results', '.temp-org-lifecycle-video');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(audioCacheDir, { recursive: true });
fs.mkdirSync(tempVideoDir, { recursive: true });

const DEEPGRAM_KEY = process.env.LORE_DEEPGRAM_KEY || process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_KEY) {
  console.error('ERROR: No Deepgram API key found in environment.');
  process.exit(1);
}

// Deepgram Aura Asteria TTS Generator with metadata verification and backoff retries
async function generateSpeechAudio(text, outputPath, voice = 'aura-asteria-en') {
  const metaPath = outputPath.replace(/\.mp3$/, '.json');
  if (fs.existsSync(outputPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.text === text && meta.voice === voice && fs.statSync(outputPath).size > 1000) {
        return outputPath;
      }
    } catch {}
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${DEEPGRAM_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (res.status === 200) {
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
        fs.writeFileSync(metaPath, JSON.stringify({ text, voice, generatedAt: new Date().toISOString() }));
        await new Promise((r) => setTimeout(r, 600));
        return outputPath;
      }

      const errText = await res.text();
      console.warn(`    [TTS retry ${attempt}/3] HTTP ${res.status}: ${errText}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    } catch (err) {
      console.warn(`    [TTS retry ${attempt}/3] Network error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`Failed to generate speech for text: "${text.slice(0, 40)}..."`);
}

function getAudioDuration(filePath) {
  try {
    const raw = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return parseFloat(raw) || 5.0;
  } catch {
    return 5.0;
  }
}

async function showTrainingCard(page, { step, total, title, instruction, tip, durationSec }) {
  try {
    await page.evaluate(({ step, total, title, instruction, tip, durationSec }) => {
      if (window.__renderHUD) {
        window.__renderHUD({ step, total, title, instruction, tip, durationSec });
      }
    }, { step, total, title, instruction, tip, durationSec });
  } catch {}
}

async function setupVirtualDirector(context) {
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      document.body.style.overflowX = 'hidden';

      // 1. Pan & Zoom Camera Controller with mathematical boundary clamping
      window.__camera = {
        currentScale: 1.0,
        currentPanX: 0,
        currentPanY: 0,
        focusOn: function (targetX, targetY, scale = 1.15, durationMs = 850) {
          const root = document.getElementById('root');
          if (!root) return;

          const desiredScreenX = 940;
          const desiredScreenY = 480;

          let panX = desiredScreenX - (targetX * scale);
          let panY = desiredScreenY - (targetY * scale);

          // Clamping so root never exposes white borders or overflows viewport
          const minPanX = Math.max(-140, 1920 * (1 - scale));
          const maxPanX = 0;
          const minPanY = Math.max(-90, 1080 * (1 - scale));
          const maxPanY = 0;

          panX = Math.max(minPanX, Math.min(maxPanX, panX));
          panY = Math.max(minPanY, Math.min(maxPanY, panY));

          root.style.transformOrigin = '0 0';
          root.style.transition = `transform ${durationMs}ms cubic-bezier(0.23, 1, 0.32, 1)`;
          root.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
          this.currentScale = scale;
          this.currentPanX = panX;
          this.currentPanY = panY;
        },
        reset: function (durationMs = 700) {
          const root = document.getElementById('root');
          if (!root) return;
          root.style.transformOrigin = '0 0';
          root.style.transition = `transform ${durationMs}ms cubic-bezier(0.23, 1, 0.32, 1)`;
          root.style.transform = 'translate(0px, 0px) scale(1.0)';
          this.currentScale = 1.0;
          this.currentPanX = 0;
          this.currentPanY = 0;
        },
      };

      // 2. Persistent Training HUD Engine
      window.__renderHUD = function (data) {
        if (!data) return;
        window.__currentHUDData = data;
        let hud = document.getElementById('hiusa-training-hud');
        if (!hud) {
          hud = document.createElement('div');
          hud.id = 'hiusa-training-hud';
          hud.style.position = 'fixed';
          hud.style.bottom = '24px';
          hud.style.right = '28px';
          hud.style.width = '500px';
          hud.style.backgroundColor = 'rgba(15, 23, 42, 0.96)';
          hud.style.color = '#ffffff';
          hud.style.borderRadius = '16px';
          hud.style.padding = '0';
          hud.style.overflow = 'hidden';
          hud.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 12px 24px -6px rgba(0, 0, 0, 0.4)';
          hud.style.border = '1px solid rgba(56, 189, 248, 0.45)';
          hud.style.backdropFilter = 'blur(20px)';
          hud.style.fontFamily = 'Poppins, ui-sans-serif, system-ui, sans-serif';
          hud.style.zIndex = '99999999';
          hud.style.pointerEvents = 'none';
          hud.style.transition = 'opacity 0.3s ease';
          document.body.appendChild(hud);
        }

        const duration = data.durationSec || 10;
        hud.innerHTML = `
          <div style="height: 4px; width: 100%; background: rgba(51, 65, 85, 0.6); position: relative; overflow: hidden;">
            <div id="hiusa-progress-fill" style="height: 100%; width: 0%; background: linear-gradient(90deg, #38bdf8, #0284c7); transition: width ${duration}s linear;"></div>
          </div>
          <div style="padding: 16px 22px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                <span>🏛️</span> UCLM ORGANIZATION LIFECYCLE • ${data.step === 0 ? 'OVERVIEW' : `PHASE ${data.step} OF ${data.total}`}
              </span>
              <span style="display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 9999px; font-size: 10.5px; font-weight: 700; background-color: rgba(56, 189, 248, 0.2); color: #bae6fd; border: 1px solid rgba(56, 189, 248, 0.4);">
                10/10 MASTER DEMO
              </span>
            </div>
            <div style="font-size: 15.5px; font-weight: 700; color: #ffffff; margin-bottom: 5px; line-height: 1.35;">
              ${data.title}
            </div>
            <div style="font-size: 12.8px; color: #cbd5e1; line-height: 1.5; margin-bottom: 8px;">
              ${data.instruction}
            </div>
            ${data.tip ? `
              <div style="display: flex; align-items: flex-start; gap: 7px; font-size: 11.8px; color: #fde68a; background: rgba(245, 158, 11, 0.16); padding: 7px 11px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                <span style="font-size: 13px;">💡</span><span style="line-height: 1.45;">${data.tip}</span>
              </div>
            ` : ''}
          </div>
        `;

        setTimeout(() => {
          const fill = document.getElementById('hiusa-progress-fill');
          if (fill) fill.style.width = '100%';
        }, 50);

        hud.style.opacity = '1';
      };

      if (window.__currentHUDData) {
        window.__renderHUD(window.__currentHUDData);
      }

      // 3. Virtual Motion Cursor & Expanding Ripple
      if (document.getElementById('hiusa-virtual-cursor')) return;

      const style = document.createElement('style');
      style.textContent = `
        #hiusa-virtual-cursor {
          position: fixed;
          top: 0;
          left: 0;
          width: 28px;
          height: 28px;
          pointer-events: none;
          z-index: 999999999;
          transform: translate(960px, 540px);
          transition: transform 0.04s linear;
        }
        .hiusa-click-ripple {
          position: fixed;
          border-radius: 50%;
          border: 3px solid #38bdf8;
          pointer-events: none;
          z-index: 999999998;
          transform: translate(-50%, -50%) scale(0.2);
          opacity: 1;
          animation: hiusaRippleAnim 0.55s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
        }
        @keyframes hiusaRippleAnim {
          0% { transform: translate(-50%, -50%) scale(0.2); opacity: 1; border-width: 4px; border-color: #38bdf8; }
          60% { opacity: 0.85; border-color: #0284c7; }
          100% { transform: translate(-50%, -50%) scale(2.8); opacity: 0; border-width: 1px; }
        }
      `;
      document.head.appendChild(style);

      const cursor = document.createElement('div');
      cursor.id = 'hiusa-virtual-cursor';
      cursor.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L5.5 3.21z" fill="#0284c7" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
      `;
      document.body.appendChild(cursor);

      window.__cursorX = 960;
      window.__cursorY = 540;

      window.__animateCursorTo = function (targetX, targetY, durationMs = 600) {
        return new Promise((resolve) => {
          const startX = window.__cursorX;
          const startY = window.__cursorY;
          const startTime = performance.now();

          function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / durationMs);
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const curX = startX + (targetX - startX) * ease;
            const curY = startY + (targetY - startY) * ease;
            cursor.style.transform = `translate(${curX}px, ${curY}px)`;
            window.__cursorX = curX;
            window.__cursorY = curY;

            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              resolve();
            }
          }
          requestAnimationFrame(step);
        });
      };

      window.__triggerClickRipple = function (x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'hiusa-click-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.width = '36px';
        ripple.style.height = '36px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      };
    });
  });
}

async function motionClick(page, selectorOrLocator, { timeout = 2500, moveDuration = 600 } = {}) {
  try {
    const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.waitFor({ state: 'visible', timeout });
    const box = await loc.boundingBox();
    if (box) {
      const targetX = box.x + Math.min(box.width / 2, 120);
      const targetY = box.y + box.height / 2;

      await page.evaluate(({ x, y, duration }) => window.__animateCursorTo(x, y, duration), {
        x: targetX,
        y: targetY,
        duration: moveDuration,
      });
      await page.waitForTimeout(80);
      await page.evaluate(({ x, y }) => window.__triggerClickRipple(x, y), { x: targetX, y: targetY });

      // Button press visual feedback
      await loc.evaluate((el) => {
        el.style.transition = 'transform 120ms ease-out';
        el.style.transform = 'scale(0.97)';
        setTimeout(() => {
          el.style.transform = '';
        }, 180);
      }).catch(() => {});

      await loc.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(180);
      return true;
    }
  } catch {}
  return false;
}

async function motionHover(page, selectorOrLocator, { timeout = 2500, moveDuration = 550, hoverWait = 700 } = {}) {
  try {
    const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.waitFor({ state: 'visible', timeout });
    const box = await loc.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2;
      const targetY = box.y + box.height / 2;

      await page.evaluate(({ x, y, duration }) => window.__animateCursorTo(x, y, duration), {
        x: targetX,
        y: targetY,
        duration: moveDuration,
      });
      await page.waitForTimeout(hoverWait);
      return true;
    }
  } catch {}
  return false;
}

async function motionType(page, selectorOrLocator, text, { moveDuration = 500, charDelay = 35 } = {}) {
  try {
    const clicked = await motionClick(page, selectorOrLocator, { moveDuration });
    if (clicked) {
      const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
      await loc.fill('');
      await loc.pressSequentially(text, { delay: charDelay });
      await page.waitForTimeout(180);
      return true;
    }
  } catch {}
  return false;
}

async function cameraFocus(page, targetSelector, scale = 1.15, durationMs = 850) {
  try {
    const loc = page.locator(targetSelector).first();
    await loc.waitFor({ state: 'visible', timeout: 2000 });
    const box = await loc.boundingBox();
    if (box) {
      const state = await page.evaluate(() => ({
        scale: window.__camera?.currentScale || 1.0,
        panX: window.__camera?.currentPanX || 0,
        panY: window.__camera?.currentPanY || 0,
      }));
      const screenCenterX = box.x + box.width / 2;
      const screenCenterY = box.y + box.height / 2;
      const rootX = (screenCenterX - state.panX) / state.scale;
      const rootY = (screenCenterY - state.panY) / state.scale;

      await page.evaluate(({ x, y, s, d }) => {
        if (window.__camera) window.__camera.focusOn(x, y, s, d);
      }, {
        x: rootX,
        y: rootY,
        s: scale,
        d: durationMs,
      });
      return true;
    }
  } catch {}
  return false;
}

async function cameraReset(page, durationMs = 700) {
  try {
    await page.evaluate((d) => {
      if (window.__camera) window.__camera.reset(d);
    }, durationMs);
  } catch {}
}

// Full Organization Lifecycle Walkthrough Choreography
const LIFECYCLE_SCRIPT = {
  title: 'Full Student Organization Lifecycle Walkthrough',
  baseName: '00_full_organization_lifecycle_master_walkthrough',
  introText: 'Welcome to the University of Cebu Lapu-Lapu and Mandaue Organization Lifecycle Master Walkthrough. In this comprehensive demonstration, we will trace the entire journey of a campus organization from public charter registration and dean endorsement, to institutional chartering, executive delegation, event planning, and transparent fiscal governance. Let us begin at the public portal.',
  conclusionText: 'From public registration and academic endorsement to institutional chartering, executive delegation, event planning, and transparent fiscal governance, HIUSA delivers a unified, secure, and modern digital lifecycle for every student organization at UC Lapu-Lapu and Mandaue.',
  steps: [
    {
      key: 'step1_public_registration',
      title: 'Public Organization Registration Portal',
      path: '/register-organization',
      instruction: 'Founding students submit the organization charter, acronym, academic college, verified founder credentials, and review institutional accreditation requirements.',
      tip: 'Accreditation requires a verified constitution, proposed officer roster, and annual operational plan.',
      narration: 'Every student organization begins at the Public Registration Portal. Founding students submit their official charter name, acronym, academic college, and verified applicant credentials. To meet university accreditation standards, founders review required institutional documents, including their constitution and proposed executive roster. Once submitted, the filing automatically enters the formal academic governance pipeline.',
      zoomTarget: 'form, section.rounded-lg',
      zoomScale: 1.14,
      action: async (page) => {
        await motionType(page, 'input[name="name"], input[id*="name" i]', 'Robotics and Innovation Society', { moveDuration: 450, charDelay: 25 });
        await motionType(page, 'input[name="acronym"], input[id*="acronym" i]', 'ROBO-CCS', { moveDuration: 350, charDelay: 25 });
        await motionType(page, 'input[name="first_name"], input[id*="first_name" i]', 'Alex', { moveDuration: 300, charDelay: 25 });
        await motionType(page, 'input[name="last_name"], input[id*="last_name" i]', 'Rivera', { moveDuration: 300, charDelay: 25 });
        await motionType(page, 'input[name="school_id"], input[id*="school" i]', '2100888', { moveDuration: 300, charDelay: 25 });
        await motionType(page, 'input[type="email"], input[name="email"]', 'founder@uclm.edu.ph', { moveDuration: 300, charDelay: 25 });
        await motionType(page, 'input[name="position_title"], input[id*="position" i]', 'Founding President', { moveDuration: 300, charDelay: 25 });
        await motionClick(page, 'select', { moveDuration: 350 });
        await page.selectOption('select', { index: 1 }).catch(() => {});
        await page.waitForTimeout(400);
        await motionHover(page, 'fieldset:has-text("Registration requirements"), div:has-text("Constitution")', { hoverWait: 800 });
      },
    },
    {
      key: 'step2_dept_head_endorsement',
      title: 'College Department Head Academic Endorsement',
      loginAs: { schoolId: '940001', password: 'Demo@12345' },
      path: '/dashboard/organization-applications',
      instruction: 'College deans review incoming organization filings from their academic department, inspect bylaws and constitution, and endorse accredited bodies to SAO.',
      tip: 'Academic endorsement certifies that the organization complements the collegiate curriculum and student development goals.',
      narration: 'The application immediately routes to the College Department Head. As academic leaders, deans review the organization\'s charter, bylaws, and faculty alignment to ensure student activities complement collegiate goals. With the constitution verified, the department head enters endorsement remarks and approves the submission, advancing the organization directly to the Student Affairs Office.',
      zoomTarget: 'div.bg-card, table, div:has-text("Organization applications")',
      zoomScale: 1.15,
      action: async (page) => {
        await motionHover(page, 'table tbody tr, div:has-text("Organization"), div[role="row"]', { hoverWait: 900 });
        const viewBtn = page.locator('button:has-text("View"), button[aria-label*="Action" i], td button').first();
        if (await viewBtn.isVisible().catch(() => false)) {
          await motionClick(page, viewBtn, { moveDuration: 500 });
          await page.waitForTimeout(600);
        }
        await motionHover(page, 'div[role="dialog"], div:has-text("Registration documents"), textarea', { hoverWait: 900 });
        const remarksBox = page.locator('textarea').first();
        if (await remarksBox.isVisible().catch(() => false)) {
          await motionType(page, remarksBox, 'Charter verified and aligned with collegiate objectives.', { moveDuration: 400, charDelay: 20 });
        }
        await motionHover(page, 'button:has-text("Endorse to SAO"), button:has-text("Approve"), button:has-text("Close")', { hoverWait: 700 });
      },
    },
    {
      key: 'step3_sao_chartering',
      title: 'Student Affairs Office (SAO) Institutional Chartering',
      loginAs: { schoolId: '990001', password: 'Admin@123456' },
      path: '/dashboard/super-admin/organizations',
      instruction: 'SAO evaluates university-wide accreditation standards, reviews collegiate endorsements, officially charters the organization, and provisions admin credentials.',
      tip: 'Once chartered, the organization is permanently recognized across the university system and can conduct official activities.',
      narration: 'At the university level, the Student Affairs Office evaluates the endorsed application. SAO administrators verify compliance with institutional safety guidelines, non-discrimination policies, and university accreditation rules. Upon approval, SAO officially charters the organization in the central registry and provisions administrator credentials, empowering the student founders to begin campus operations.',
      zoomTarget: 'div:has-text("Organizations"), div[role="tablist"], div.grid',
      zoomScale: 1.15,
      action: async (page) => {
        await motionClick(page, 'button:has-text("Pending review"), [role="tab"]:has-text("Pending")', { moveDuration: 500 }).catch(() => {});
        await page.waitForTimeout(600);
        await motionHover(page, 'article, div.rounded-xl, div.bg-card', { hoverWait: 800 });
        await motionClick(page, 'button:has-text("Active"), [role="tab"]:has-text("Active")', { moveDuration: 500 }).catch(() => {});
        await page.waitForTimeout(600);
        await motionHover(page, 'span:has-text("Active"), div:has-text("Admins")', { hoverWait: 900 });
      },
    },
    {
      key: 'step4_admin_command_center',
      title: 'Organization Admin Command Center & Launchpad',
      loginAs: { schoolId: '900001', password: 'Demo@12345' },
      path: '/dashboard/admin',
      instruction: 'The newly chartered administrator enters their central operational hub. Monitor activity KPIs, role briefings, approval queues, and launchpad workflows.',
      tip: 'The command center links directly to all administrative workspaces: People, Officer Positions, Programs, and Event Planning.',
      narration: 'With official recognition granted, the Organization Administrator logs into their dedicated Command Center. The dashboard serves as executive headquarters, providing real-time visibility over pending approvals, member records, announcements, and financial movement. Here, administrators initiate the foundational setup required to govern their active student body.',
      zoomTarget: 'section[aria-label="Administration summary"], div.grid',
      zoomScale: 1.15,
      action: async (page) => {
        await motionHover(page, 'a:has-text("Pending Orders"), a:has-text("Approval Requests")', { hoverWait: 800 });
        await motionHover(page, 'a:has-text("People"), a:has-text("Officer positions")', { hoverWait: 800 });
        await motionHover(page, 'h2:has-text("Financial status"), div[role="img"]', { hoverWait: 900 });
      },
    },
    {
      key: 'step5_member_management',
      title: 'Executive Governance & Member Management',
      path: '/dashboard/admin/users',
      sidebarText: 'People',
      instruction: 'Assign executive officer roles, manage committee positions, verify student enrollment, and enforce institutional separation of duties.',
      tip: 'Biometric and digital identity verification protect election integrity and attendance logging.',
      narration: 'Organizational governance begins with establishing leadership. Within the Member Management workspace, administrators appoint executive officers, assign committee chairs, and maintain active rosters. Strict role-based access control enforces institutional separation of duties, ensuring officers hold distinct responsibilities for finances, activities, and communication.',
      zoomTarget: 'table, div.bg-card, div:has-text("Users"), div:has-text("People")',
      zoomScale: 1.15,
      action: async (page) => {
        await motionHover(page, 'table tbody tr, div[role="row"]', { hoverWait: 800 });
        await motionClick(page, 'button:has-text("Officer"), select, [role="tab"]:has-text("Officer")', { moveDuration: 500 }).catch(() => {});
        await page.waitForTimeout(500);
        await motionHover(page, 'span:has-text("Admin"), span:has-text("Officer"), span:has-text("Student")', { hoverWait: 800 });
      },
    },
    {
      key: 'step6_event_planning',
      title: 'Inaugural Event Planning & Multi-Tier Clearance',
      path: '/dashboard/events/manage-events',
      sidebarText: 'Events',
      instruction: 'Plan the organization\'s inaugural flagship event, specify venues and quotas, and submit proposals into the automated university clearance chain.',
      tip: 'Proposals route automatically to the Department Head for academic clearance and SAO for venue authorization.',
      narration: 'To launch its campus presence, the organization schedules its inaugural activity. Administrators submit detailed event proposals specifying venues, schedules, safety plans, and participant quotas. The system automatically routes the proposal through the university\'s multi-tier approval chain, securing dean and venue authorization without paper forms or delays.',
      zoomTarget: 'button:has-text("New event"), table, div.bg-card, div:has-text("Events")',
      zoomScale: 1.15,
      action: async (page) => {
        await motionHover(page, 'button:has-text("New event"), a:has-text("New event")', { hoverWait: 700 });
        await motionHover(page, 'table tbody tr, div[role="row"], div.border', { hoverWait: 900 });
        const firstRow = page.locator('table tbody tr, td button').first();
        if (await firstRow.isVisible().catch(() => false)) {
          await motionClick(page, firstRow, { moveDuration: 550 });
          await page.waitForTimeout(600);
          await motionHover(page, 'div[role="dialog"], div:has-text("Event progress"), div:has-text("approval")', { hoverWait: 900 });
        }
      },
    },
    {
      key: 'step7_financial_treasury',
      title: 'Financial Treasury Setup & AI Fiscal Forecasting',
      path: '/dashboard/finance/financial-ledger',
      sidebarText: 'Financial ledger',
      instruction: 'Initialize the double-entry financial ledger, allocate program budgets, and generate explainable AI financial forecasts.',
      tip: 'Integrated Ordinary Least Squares algorithms forecast spending trends while AI provides explainable budget recommendations.',
      narration: 'Finally, the organization establishes its financial treasury. The double-entry ledger enforces strict accountability across membership fees, disbursements, and event budgets. Integrated AI algorithms analyze transaction histories, projecting monthly fiscal health and providing explainable advisory recommendations to keep student funds transparent and audit-ready.',
      zoomTarget: 'table, div.bg-card, div:has-text("Ledger"), div:has-text("Balance")',
      zoomScale: 1.15,
      action: async (page) => {
        await motionHover(page, 'table tbody tr, div:has-text("General Operations"), div:has-text("₱")', { hoverWait: 800 });
        const forecastNav = page.locator('aside a:has-text("Forecast"), aside a:has-text("Insights"), a[href*="forecast"]').first();
        if (await forecastNav.isVisible().catch(() => false)) {
          await motionClick(page, forecastNav, { moveDuration: 550 });
          await page.waitForTimeout(800);
          const genBtn = page.locator('button:has-text("Generate forecast"), button:has-text("Forecast")').first();
          if (await genBtn.isVisible().catch(() => false)) {
            await motionClick(page, genBtn, { moveDuration: 500 });
            await page.waitForTimeout(600);
          }
          await motionHover(page, 'div:has-text("projections"), div:has-text("OLS"), svg, canvas', { hoverWait: 900 });
        }
      },
    },
  ],
};

async function loginUser(page, schoolId, password) {
  console.log(`  -> Logging in as ${schoolId}...`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${targetUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(400);

  await cameraFocus(page, 'form', 1.14, 750);
  await motionType(page, 'input[name="school_id"], input[id*="school" i], input[type="text"]', schoolId, { moveDuration: 400, charDelay: 25 });
  await motionType(page, 'input[type="password"]', password, { moveDuration: 350, charDelay: 25 });

  let signedIn = false;
  for (let attempt = 0; attempt < 5 && !signedIn; attempt++) {
    const answered = page.waitForResponse(
      (r) => r.url().includes('/api/login') && r.request().method() === 'POST',
      { timeout: 20000 }
    );
    await motionClick(page, 'button[type="submit"], button:has-text("Sign in")', { moveDuration: 450 });
    const response = await answered;

    if (response.status() === 429) {
      console.log(`  (Login throttled 429, waiting 15s before retrying...)`);
      await page.waitForTimeout(15000);
    } else if (response.status() === 200) {
      signedIn = true;
    }
  }

  await page.waitForURL(/\/(dashboard|change-password)/, { timeout: 25000 });
  await cameraReset(page, 600);
  await page.waitForTimeout(300);
}

async function recordMasterLifecycleWalkthrough(browser) {
  const webmOutput = path.join(outputDir, `${LIFECYCLE_SCRIPT.baseName}.webm`);
  const mp4Output = path.join(outputDir, `${LIFECYCLE_SCRIPT.baseName}.mp4`);

  console.log(`\n============================================================`);
  console.log(`Starting 10/10 Master Walkthrough: ${LIFECYCLE_SCRIPT.title}`);
  console.log(`Target: ${targetUrl}`);
  console.log(`Outputs:`);
  console.log(`  - WebM: ${webmOutput}`);
  console.log(`  - MP4:  ${mp4Output}`);
  console.log(`============================================================\n`);

  // 1. Generate Voiceover Audio Clips for Intro, Steps, and Conclusion
  console.log(`-> Generating Deepgram Aura voiceover audio clips...`);
  const introAudioPath = path.join(audioCacheDir, 'intro.mp3');
  await generateSpeechAudio(LIFECYCLE_SCRIPT.introText, introAudioPath);
  const introDuration = getAudioDuration(introAudioPath);
  console.log(`   - Intro Audio: ${introDuration.toFixed(2)}s`);

  const stepAudioList = [];
  for (let i = 0; i < LIFECYCLE_SCRIPT.steps.length; i++) {
    const step = LIFECYCLE_SCRIPT.steps[i];
    const stepAudioPath = path.join(audioCacheDir, `step_${i + 1}.mp3`);
    await generateSpeechAudio(step.narration, stepAudioPath);
    const stepDuration = getAudioDuration(stepAudioPath);
    stepAudioList.push({ path: stepAudioPath, duration: stepDuration });
    console.log(`   - Step ${i + 1} (${step.title}): ${stepDuration.toFixed(2)}s`);
  }

  const conclusionAudioPath = path.join(audioCacheDir, 'conclusion.mp3');
  await generateSpeechAudio(LIFECYCLE_SCRIPT.conclusionText, conclusionAudioPath);
  const conclusionDuration = getAudioDuration(conclusionAudioPath);
  console.log(`   - Conclusion Audio: ${conclusionDuration.toFixed(2)}s`);

  // 2. Launch Browser Context with 1080p Video Recording
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1920, height: 1080 },
    },
  });

  await setupVirtualDirector(context);

  const page = await context.newPage();
  const recordingStart = Date.now();
  const stepEvents = [];

  try {
    // Phase 0: Intro on Public Portal
    console.log(`  -> Loading Public Portal for Intro...`);
    await page.goto(`${targetUrl}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(400);

    const introOffsetMs = Date.now() - recordingStart;
    stepEvents.push({
      name: 'intro',
      delayMs: Math.max(0, introOffsetMs),
      path: introAudioPath,
    });

    await showTrainingCard(page, {
      step: 0,
      total: LIFECYCLE_SCRIPT.steps.length,
      title: LIFECYCLE_SCRIPT.title,
      instruction: LIFECYCLE_SCRIPT.introText,
      tip: 'Official 10/10 Interactive Master Demonstration for University of Cebu Lapu-Lapu and Mandaue.',
      durationSec: Math.round(introDuration),
    });

    await cameraFocus(page, 'header, nav, h1', 1.12, 800);
    await motionHover(page, 'a:has-text("Register an organization"), a:has-text("Sign in"), h1', { hoverWait: 800 });
    await cameraReset(page, 600);

    const elapsedIntro = Date.now() - (recordingStart + introOffsetMs);
    const remainingIntroWait = Math.max(250, Math.round(introDuration * 1000) - elapsedIntro);
    await page.waitForTimeout(remainingIntroWait);
    await page.waitForTimeout(300);

    // Step through each phase
    for (let i = 0; i < LIFECYCLE_SCRIPT.steps.length; i++) {
      const step = LIFECYCLE_SCRIPT.steps[i];
      const audioInfo = stepAudioList[i];
      const stepTargetDurationMs = Math.round(audioInfo.duration * 1000);
      console.log(`\n  -> Choreographing Phase ${i + 1}/${LIFECYCLE_SCRIPT.steps.length}: ${step.title} (${audioInfo.duration.toFixed(2)}s)`);

      // If step requires role authentication, sign in first
      if (step.loginAs) {
        await loginUser(page, step.loginAs.schoolId, step.loginAs.password);
      }

      const stepStartMs = Date.now() - recordingStart;
      stepEvents.push({
        name: `step_${i + 1}`,
        delayMs: Math.max(0, stepStartMs),
        path: audioInfo.path,
      });

      // Beat 1: Navigation & Page Mount
      if (step.sidebarText) {
        const sidebarLocator = page.locator(`aside a:has-text("${step.sidebarText}"), nav a:has-text("${step.sidebarText}"), a[href*="${step.path.split('?')[0]}"]`).first();
        await motionClick(page, sidebarLocator, { timeout: 2000, moveDuration: 600 });
      }

      const targetPathBase = step.path.split('?')[0];
      if (!page.url().includes(targetPathBase)) {
        await page.goto(`${targetUrl}${step.path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      } else {
        await page.waitForTimeout(250);
      }

      await showTrainingCard(page, {
        step: i + 1,
        total: LIFECYCLE_SCRIPT.steps.length,
        title: step.title,
        instruction: step.instruction,
        tip: step.tip,
        durationSec: Math.round(audioInfo.duration),
      });

      // Beat 2: Smooth camera focus onto target workspace
      if (step.zoomTarget) {
        await cameraFocus(page, step.zoomTarget, step.zoomScale || 1.15, 850);
        await page.waitForTimeout(300);
      }

      // Beat 3: Interactive Motion
      if (step.action) {
        try {
          await step.action(page);
        } catch (actionErr) {
          console.warn(`    [Notice] Action step info: ${actionErr.message}`);
        }
      }

      // Beat 4: Camera reset & Settle smoothly
      await page.waitForTimeout(350);
      await cameraReset(page, 750);

      const elapsedStep = Date.now() - (recordingStart + stepStartMs);
      const remainingWaitMs = Math.max(250, stepTargetDurationMs - elapsedStep);
      await page.waitForTimeout(remainingWaitMs);
      await page.waitForTimeout(350);
    }

    // Conclusion Phase on Admin Home
    console.log(`\n  -> Choreographing Conclusion Phase...`);
    const conclusionStartMs = Date.now() - recordingStart;
    stepEvents.push({
      name: 'conclusion',
      delayMs: Math.max(0, conclusionStartMs),
      path: conclusionAudioPath,
    });

    await page.goto(`${targetUrl}/dashboard/admin`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await showTrainingCard(page, {
      step: LIFECYCLE_SCRIPT.steps.length,
      total: LIFECYCLE_SCRIPT.steps.length,
      title: 'Full Lifecycle Complete',
      instruction: LIFECYCLE_SCRIPT.conclusionText,
      tip: 'The organization is now fully accredited, chartered, and operational on HIUSA.',
      durationSec: Math.round(conclusionDuration),
    });

    await motionHover(page, 'section[aria-label="Administration summary"]', { hoverWait: 1000 });
    await cameraReset(page, 700);

    const elapsedConclusion = Date.now() - (recordingStart + conclusionStartMs);
    const remainingConcWait = Math.max(250, Math.round(conclusionDuration * 1000) - elapsedConclusion);
    await page.waitForTimeout(remainingConcWait);
    await page.waitForTimeout(800);

    console.log(`  -> Completed all choreography successfully!`);
  } catch (err) {
    console.error(`  [WARN] Exception during recording session:`, err.message);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const rawVideoPath = await video.path();
      if (fs.existsSync(rawVideoPath)) {
        const videoDuration = getAudioDuration(rawVideoPath);
        console.log(`\n  -> Raw video captured: ${videoDuration.toFixed(2)}s`);

        // Build synchronized audio track with FFmpeg
        console.log(`  -> Muxing synchronized voiceover audio track...`);
        const mixedAudioPath = path.join(audioCacheDir, 'full_narration.mp3');

        let filterInputs = '';
        let filterMix = '';
        const ffmpegArgs = ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${Math.ceil(videoDuration) + 1}`];

        for (let idx = 0; idx < stepEvents.length; idx++) {
          const ev = stepEvents[idx];
          ffmpegArgs.push('-i', ev.path);
          const inputIndex = idx + 1;
          filterInputs += `[${inputIndex}]adelay=${Math.round(ev.delayMs)}|${Math.round(ev.delayMs)}[a${inputIndex}];`;
          filterMix += `[a${inputIndex}]`;
        }

        const filterComplex = `${filterInputs}[0]${filterMix}amix=inputs=${stepEvents.length + 1}:dropout_transition=0:duration=first`;
        ffmpegArgs.push('-filter_complex', filterComplex, '-c:a', 'libmp3lame', '-b:a', '192k', mixedAudioPath);

        execSync(`ffmpeg ${ffmpegArgs.map((a) => (a.includes(' ') || a.includes(';') || a.includes('|') || a.includes('=') ? `"${a}"` : a)).join(' ')}`, {
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        // Produce WebM Output with broadcast loudness normalization
        console.log(`  -> Creating final 1080p WebM with broadcast loudness: ${path.basename(webmOutput)}...`);
        execSync(`ffmpeg -y -i "${rawVideoPath}" -i "${mixedAudioPath}" -c:v copy -af "loudnorm=I=-14:TP=-0.5:LRA=11" -c:a libopus -b:a 160k -shortest "${webmOutput}"`, {
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        // Produce Universal 1080p MP4 Output with broadcast loudness normalization (H.264 + AAC)
        console.log(`  -> Creating universal 1080p MP4 with broadcast loudness: ${path.basename(mp4Output)}...`);
        execSync(`ffmpeg -y -i "${rawVideoPath}" -i "${mixedAudioPath}" -c:v libx264 -preset fast -crf 20 -af "loudnorm=I=-14:TP=-0.5:LRA=11" -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${mp4Output}"`, {
          stdio: ['ignore', 'ignore', 'pipe'],
        });

        const webmSize = (fs.statSync(webmOutput).size / (1024 * 1024)).toFixed(2);
        const mp4Size = (fs.statSync(mp4Output).size / (1024 * 1024)).toFixed(2);
        console.log(`\n============================================================`);
        console.log(`[COMPLETE 10/10 MASTER] ${LIFECYCLE_SCRIPT.baseName}:`);
        console.log(`  - WebM: ${webmSize} MB`);
        console.log(`  - MP4:  ${mp4Size} MB`);
        console.log(`============================================================\n`);
      }
    }
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 60 : 0,
  });

  await recordMasterLifecycleWalkthrough(browser);
  await browser.close();

  try {
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  } catch {}
}

main().catch((err) => {
  console.error('Fatal error during master walkthrough generation:', err);
  process.exit(1);
});
