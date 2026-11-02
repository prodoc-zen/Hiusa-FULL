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
const audioCacheDir = path.join(rootDir, 'test-results', '.voiceover-audio-cache');
const tempVideoDir = path.join(rootDir, 'test-results', '.temp-voiceover-videos');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(audioCacheDir, { recursive: true });
fs.mkdirSync(tempVideoDir, { recursive: true });

const DEEPGRAM_KEY = process.env.LORE_DEEPGRAM_KEY || process.env.DEEPGRAM_API_KEY;
if (!DEEPGRAM_KEY) {
  console.error('ERROR: No Deepgram API key found in environment.');
  process.exit(1);
}

// Deepgram Aura TTS generation helper with metadata verification and backoff retries
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

// Injects the virtual motion capture cursor, click ripple, and camera zoom engine
async function setupVirtualDirector(context) {
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      document.body.style.overflowX = 'hidden';

      // 1. Pan & Zoom Camera Controller with mathematical boundary clamping
      window.__camera = {
        currentScale: 1.0,
        currentPanX: 0,
        currentPanY: 0,
        focusOn: function (targetX, targetY, scale = 1.18, durationMs = 850) {
          const root = document.getElementById('root');
          if (!root) return;

          // Desired focal point: centered in upper-left main stage, leaving room for HUD at bottom-right
          const desiredScreenX = 940;
          const desiredScreenY = 480;

          let panX = desiredScreenX - (targetX * scale);
          let panY = desiredScreenY - (targetY * scale);

          // Clamping so root never exposes white borders or overflows viewport
          // Keep sidebar and top bar anchored: limit panX between -140px and 0px, and panY between -90px and 0px
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

      // 2. Persistent HUD Engine
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
          hud.style.width = '480px';
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
                <span>🎓</span> UCLM ONBOARDING • STEP ${data.step} OF ${data.total}
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

async function motionType(page, selectorOrLocator, text, { moveDuration = 500, charDelay = 40 } = {}) {
  try {
    const clicked = await motionClick(page, selectorOrLocator, { moveDuration });
    if (clicked) {
      const loc = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator;
      await loc.fill('');
      await loc.pressSequentially(text, { delay: charDelay });
      await page.waitForTimeout(200);
      return true;
    }
  } catch {}
  return false;
}

async function cameraFocus(page, targetSelector, scale = 1.18, durationMs = 850) {
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

const MODULES = [
  {
    key: 'student',
    title: 'Student Training & SOP Walkthrough',
    schoolId: '2100142',
    password: 'Demo@12345',
    baseName: '01_student_voiceover_walkthrough',
    introText: 'Welcome to the University of Cebu Lapu-Lapu and Mandaue Student Portal Walkthrough. In this guide, we will step through your essential campus services. Let us begin by logging in with our student ID to access our campus hub.',
    steps: [
      {
        title: 'Student Dashboard & Campus Activity Feed',
        path: '/dashboard/student',
        sidebarText: 'Dashboard',
        instruction: 'The central student hub. Access urgent university announcements, view upcoming events, and check live voting deadlines directly from your campus feed.',
        tip: 'Check this feed weekly for official academic updates and organization activities.',
        narration: 'Your journey begins on the Student Dashboard, your primary campus hub. From here, you can view urgent university announcements, track upcoming deadlines, and inspect active campus polls. Check this feed regularly for official academic updates.',
        zoomTarget: 'h1, h2:has-text("Good"), div:has-text("Announcements")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'h2:has-text("Good"), div:has-text("Announcements")', { hoverWait: 800 });
          await motionHover(page, 'div:has-text("Upcoming events"), div:has-text("Deadlines")', { hoverWait: 800 });
        },
      },
      {
        title: 'Activity Calendar & Event Registration',
        path: '/dashboard/events',
        sidebarText: 'Events',
        instruction: 'Browse accredited college events and workshops. Switch to the Calendar view to inspect the venue, schedule, and register for slots.',
        tip: 'Clicking Register reserves your slot. Attendance is confirmed on event day via QR or biometric scanners.',
        narration: 'Next, let us open Events from the sidebar, and switch to the Calendar view. Here students can explore college workshops, seminars, and assemblies. Clicking on any event card reveals the venue, schedule, and registration details to secure your slot.',
        zoomTarget: 'div.bg-card, table, .fc',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Calendar")', { moveDuration: 550 });
          await page.waitForTimeout(600);
          await motionHover(page, '.fc-event, div[role="row"], tr, td', { hoverWait: 900 });
          await motionHover(page, 'button:has-text("List")', { hoverWait: 600 });
        },
      },
      {
        title: 'Student Council Elections & Voting Portal',
        path: '/dashboard/elections/cast-vote',
        sidebarText: 'Vote',
        instruction: 'Exercise your voting rights during active council elections. Review certified party lists, candidate qualifications, and cast your encrypted ballot.',
        tip: 'Elections are audited and tamper-evident. You can only vote once per elective council position.',
        narration: 'During active council elections, navigate to Voting in the sidebar. Students can review certified party lists, inspect candidate qualifications, and cast their encrypted ballot. When an election concludes, you can view the certified election results.',
        zoomTarget: 'div:has-text("Election"), div.rounded-xl',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Election"), div.rounded-xl', { hoverWait: 800 });
          await motionClick(page, 'a:has-text("View results"), button:has-text("View results")', { moveDuration: 550 });
          await page.waitForTimeout(500);
          await motionHover(page, 'div:has-text("Result"), div:has-text("Tally"), div:has-text("Vote")', { hoverWait: 900 });
        },
      },
      {
        title: 'Official Department Merchandise Store',
        path: '/dashboard/merchandise/order-merchandise',
        sidebarText: 'Store',
        instruction: 'Order official organization shirts, lanyards, and accessories. Select your size, upload payment proof, and receive a secure claim token.',
        tip: 'Save your digital release token. Present it to SBO officers at the release desk to claim your order.',
        narration: 'To purchase official department apparel and accessories, click Store in the sidebar. Select your desired shirt or lanyard, choose your size, and submit your payment verification. The system generates a digital release token for booth pickup.',
        zoomTarget: 'div:has-text("Shirt"), div.grid > div',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Shirt"), div:has-text("Merchandise")', { hoverWait: 800 });
          await motionClick(page, 'button:has-text("Order"), button:has-text("Select"), div.cursor-pointer', { moveDuration: 550 });
          await page.waitForTimeout(500);
          await motionHover(page, 'button:has-text("M"), button:has-text("L"), div:has-text("Size")', { hoverWait: 700 });
        },
      },
      {
        title: 'Statement of Account & Official Receipts',
        path: '/dashboard/finance/statement-of-account',
        sidebarText: 'Statement of account',
        instruction: 'Track personal fee balances, membership dues, and verified payment receipts with full accounting transparency.',
        tip: 'Official receipts are archived digitally for end-of-semester clearance verification.',
        narration: 'Under My Payments, open Statement of Account. Here you can inspect your semester dues, payment balance, and digital official receipts. Every verified payment is permanently archived for clearance.',
        zoomTarget: 'div:has-text("Balance"), div:has-text("Total"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Total"), div:has-text("Balance"), div:has-text("Paid")', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("OR-"), div:has-text("Receipt")', { hoverWait: 850 });
        },
      },
      {
        title: 'Semester Clearance Checklist & Progress',
        path: '/dashboard/my-clearance',
        sidebarText: 'My clearance',
        instruction: 'Monitor your graduation and enrollment clearance status across organization, department, and university signatories.',
        tip: 'All organization dues and library returns must be cleared to complete your signing.',
        narration: 'Next, navigate to My Clearance to track your end-of-semester signing status. You can monitor approval progress across organization leaders, department heads, and university signatories in real time.',
        zoomTarget: 'div:has-text("Clearance"), svg.lucide',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Clearance"), div:has-text("%")', { hoverWait: 850 });
          await motionHover(page, 'div:has-text("Signatory"), div:has-text("Cleared"), div:has-text("Pending")', { hoverWait: 850 });
        },
      },
      {
        title: 'Student Inquiries & Grievances Portal',
        path: '/dashboard/my-grievances',
        sidebarText: 'Support',
        instruction: 'Submit formal appeals, concerns, or academic inquiries directly to organization leaders and the Student Affairs Office with full privacy.',
        tip: 'Each grievance receives a tracking ID and documented response from designated signatories.',
        narration: 'Finally, access Support to submit formal inquiries or appeals directly to student leadership and the Student Affairs Office. Every concern receives a confidential tracking number and documented resolution.',
        zoomTarget: 'button:has-text("Submit"), div:has-text("Grievance"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("Submit"), button:has-text("New"), button:has-text("File")', { hoverWait: 800 });
          await motionHover(page, 'div:has-text("Inquiry"), div:has-text("Tracking"), table', { hoverWait: 800 });
        },
      },
    ],
  },
  {
    key: 'officer',
    title: 'SBO Officer Training & SOP Walkthrough',
    schoolId: '900004',
    password: 'Demo@12345',
    baseName: '02_sbo_officer_voiceover_walkthrough',
    introText: 'Welcome to the University of Cebu Lapu-Lapu and Mandaue SBO Officer Walkthrough. This guide covers daily operational briefing, milestone tracking, event attendance check-in, merchandise distribution, and financial oversight. Let us log in with our officer credentials to access our command center.',
    steps: [
      {
        title: 'Officer Operational Command & Duty Briefing',
        path: '/dashboard/officer',
        sidebarText: 'Dashboard',
        instruction: 'Your officer workspace. Review priority assignments, monitor event logistics, and access specialized operational tools.',
        tip: 'Urgent task deadlines and upcoming check-in rosters appear at the top of your briefing.',
        narration: 'Your officer workspace opens to the Duty Briefing. Here, officers review prioritized assignments, monitor upcoming event rosters, and track critical deadlines delegated by executive leadership.',
        zoomTarget: 'h1, h2, div:has-text("Briefing"), div:has-text("Upcoming")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Briefing"), div:has-text("Upcoming")', { hoverWait: 850 });
          await motionHover(page, 'div:has-text("Priority"), div:has-text("Roster"), table', { hoverWait: 800 });
        },
      },
      {
        title: 'Task Execution & Milestone Progress Updates',
        path: '/dashboard/tasks/assigned-tasks',
        sidebarText: 'My tasks',
        instruction: 'Manage operational assignments delegated by the organization president. Transition tasks from pending to in progress and log milestone notes.',
        tip: 'Completing tasks on time updates your officer performance and workload balance score.',
        narration: 'Next, click My Tasks in the sidebar. This board organizes duties assigned to your committee. You can transition tasks from pending to in progress and log milestone notes to maintain your workload balance score.',
        zoomTarget: 'div:has-text("Task"), table, div.rounded-xl',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("In progress"), button:has-text("Pending"), div[role="tab"]', { moveDuration: 550 });
          await motionHover(page, 'div:has-text("Task"), div.rounded-xl, table tr', { hoverWait: 900 });
        },
      },
      {
        title: 'Event Attendee Check-In & Biometric Scanner',
        path: '/dashboard/events/check-in',
        sidebarText: 'Check-in',
        instruction: 'Verify student attendance at college events using optical QR code scanners or DigitalPersona fingerprint biometrics.',
        tip: 'Biometric verification records a tamper-proof timestamp directly into the official attendance register.',
        narration: 'During campus events, open Check-in from the sidebar. You can record student attendance instantly using optical QR code scanners or DigitalPersona fingerprint biometrics for tamper-proof timestamping.',
        zoomTarget: 'div:has-text("Scanner"), button:has-text("QR")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Biometric"), button:has-text("Fingerprint"), button:has-text("QR")', { moveDuration: 600 });
          await motionHover(page, 'div:has-text("Scanner"), div:has-text("Attendance"), table', { hoverWait: 900 });
        },
      },
      {
        title: 'Merchandise Order Queue & Token Validation',
        path: '/dashboard/merchandise/claim-tokens',
        sidebarText: 'Orders',
        instruction: 'Verify student payment receipts, approve paid merchandise orders, and scan digital release tokens when handing out merchandise items.',
        tip: 'Switch to the Token Validator tab to release items instantly by entering the 6-character claim token.',
        narration: 'To manage merchandise distribution, open Orders, then switch to Claim Desk. Enter the student six-character digital claim token to verify payment proof and release merchandise items instantly.',
        zoomTarget: 'input[placeholder*="token" i], button:has-text("Token"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'aside a:has-text("Claim desk"), nav a:has-text("Claim desk"), button:has-text("Token")', { moveDuration: 600 });
          await page.waitForTimeout(300);
          await motionType(page, 'input[placeholder*="token" i], input[type="text"]', 'TK-9418', { moveDuration: 500 });
          await motionHover(page, 'button:has-text("Verify"), button:has-text("Validate"), button:has-text("Claim")', { hoverWait: 800 });
        },
      },
      {
        title: 'Drafting Announcements & Executive Requests',
        path: '/dashboard/announcements/manage-announcements',
        sidebarText: 'Announcements',
        instruction: 'Draft official bulletins and event announcements. Submit drafts for executive review and dean approval before public broadcast.',
        tip: 'Announcements can be targeted to specific year levels, programs, or the entire department.',
        narration: 'Under Announcements, officers can draft official student notices. Drafts are routed through the executive workflow for dean authorization before broadcasting across the college feed.',
        zoomTarget: 'button:has-text("Create"), button:has-text("New"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("Create"), button:has-text("New announcement")', { hoverWait: 800 });
          await motionHover(page, 'table tr, div:has-text("Draft"), div:has-text("Approved")', { hoverWait: 800 });
        },
      },
      {
        title: 'Organization Treasury & Account Oversight',
        path: '/dashboard/finance/financial-ledger',
        sidebarText: 'Ledger',
        instruction: 'Inspect organization fund balances, bank accounts, and recorded cash advances with read-only audit transparency.',
        tip: 'All disbursement vouchers and liquidation receipts are logged in the financial audit trail.',
        narration: 'Finally, open Ledger under Finance. Officers can review available fund balances, collection accounts, and recorded cash advances with complete audit trail transparency.',
        zoomTarget: 'div:has-text("Balance"), div:has-text("Total"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Balance"), div:has-text("Total funds"), div:has-text("Cash")', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("Disbursement"), div:has-text("Voucher")', { hoverWait: 850 });
        },
      },
    ],
  },
  {
    key: 'dept_head',
    title: 'Department Head & Dean Training Walkthrough',
    schoolId: '940001',
    password: 'Demo@12345',
    baseName: '03_dean_department_head_voiceover_walkthrough',
    introText: 'Welcome to the College of Computer Studies Department Head and Dean Executive Walkthrough. In this module, executive leaders learn how to monitor student bodies, review activity permits, coordinate the college calendar, and audit departmental finances. Let us log in with our dean credentials.',
    steps: [
      {
        title: 'College Executive Briefing & Department Overview',
        path: '/dashboard/department-head',
        sidebarText: 'Dashboard',
        instruction: 'The Dean command center. Monitor student organization health, review pending approvals count, and inspect college-wide activity metrics.',
        tip: 'The briefing highlights critical items requiring executive dean review and signature.',
        narration: 'The Dean command center provides high-level visibility across college student organizations, pending administrative permits, and college-wide participation metrics.',
        zoomTarget: 'div:has-text("Getting started"), div:has-text("Review approvals")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'h2:has-text("Good"), div:has-text("Getting started")', { hoverWait: 850 });
          await motionHover(page, 'div:has-text("Review approvals"), div:has-text("Progress")', { hoverWait: 750 });
        },
      },
      {
        title: 'College Student Organizations & Accreditation',
        path: '/dashboard/department-head/organizations',
        sidebarText: 'Organizations',
        instruction: 'Oversee recognized student bodies (such as PSITS-CCS). Audit officer qualifications, membership rosters, and compliance submissions.',
        tip: 'Organizations must maintain active accreditation compliance to qualify for university funding.',
        narration: 'Next, click Organizations in the sidebar. Here, department heads supervise recognized groups like PSITS-CCS, audit officer rosters, and verify constitution compliance to maintain active university accreditation.',
        zoomTarget: 'table tr, div:has-text("PSITS")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Active"), button:has-text("All"), div:has-text("Active (2)")', { moveDuration: 550 });
          await motionHover(page, 'table tr, div:has-text("PSITS"), div:has-text("Active")', { hoverWait: 900 });
        },
      },
      {
        title: 'Department Approvals Inbox (Events, Budgets, Elections)',
        path: '/dashboard/department-head/approvals',
        sidebarText: 'Approvals',
        instruction: 'Administrative review pipeline. Review submitted event permits, venue reservations, budget proposals, and student council elections.',
        tip: 'Inspect uploaded informative letters and safety plans before issuing official dean approval.',
        narration: 'Open Approvals in the sidebar to access your administrative review pipeline. Review submitted event permits, venue reservations, budget allocations, and council elections before issuing official dean authorization.',
        zoomTarget: 'div:has-text("Pending"), table, button:has-text("Review")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Pending"), button:has-text("Events"), [role="tab"]', { moveDuration: 550 });
          await motionHover(page, 'table tr, div:has-text("Pending"), button:has-text("Review")', { hoverWait: 900 });
        },
      },
      {
        title: 'Master College Calendar & Scheduling Coordination',
        path: '/dashboard/events/activity-calendar',
        sidebarText: 'Calendar',
        instruction: 'Oversee all scheduled student activities across the college calendar to prevent scheduling conflicts with university examinations.',
        tip: 'Approved events automatically synchronize with campus venue reservations.',
        narration: 'Click Calendar under College View to oversee all scheduled student activities. Coordinate event timelines across the academic semester to prevent scheduling conflicts with midterm and final examinations.',
        zoomTarget: '.fc, div:has-text("Calendar")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Month"), button:has-text("Today"), button.fc-today-button', { moveDuration: 500 });
          await motionHover(page, '.fc, div:has-text("Exam"), div:has-text("College")', { hoverWait: 900 });
        },
      },
      {
        title: 'College Financial Ledger & Fund Auditing',
        path: '/dashboard/finance/financial-ledger',
        sidebarText: 'Finance',
        instruction: 'Audit organization financial statements, verified fee collections, and approved budget disbursements across the college.',
        tip: 'Financial statements are archived by academic semester for university accreditation audits.',
        narration: 'Under Finance, open the College Financial Ledger. Audit organization fund balances, verified fee collections, and approved budget disbursements to guarantee institutional accountability.',
        zoomTarget: 'div:has-text("Balance"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Balance"), div:has-text("Total"), table', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("Disbursement"), div:has-text("Audit")', { hoverWait: 850 });
        },
      },
      {
        title: 'Broadcasting Official College Announcements',
        path: '/dashboard/department-head/announcements',
        sidebarText: 'Announcements',
        instruction: 'Broadcast official administrative notices and executive memos to all faculty and students within the College of Computer Studies.',
        tip: 'Dean announcements are pinned to the top of all department student feeds.',
        narration: 'Finally, click Announcements to broadcast executive notices and academic bulletins to all faculty and students within the College of Computer Studies.',
        zoomTarget: 'button:has-text("Create"), button:has-text("Announcement")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("Create"), button:has-text("New announcement")', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("Memo"), div:has-text("Dean")', { hoverWait: 850 });
        },
      },
    ],
  },
  {
    key: 'admin',
    title: 'Organization Admin & President Training Walkthrough',
    schoolId: '900001',
    password: 'Demo@12345',
    baseName: '04_organization_admin_voiceover_walkthrough',
    introText: 'Welcome to the Organization Admin and President Leadership Walkthrough. This guide covers executive operations for student body leaders, including event planning, financial ledger management, task delegation, council elections, and member registries. Let us sign in with our presidential credentials.',
    steps: [
      {
        title: 'Organization Leadership Command Center',
        path: '/dashboard/admin',
        sidebarText: 'Dashboard',
        instruction: 'The executive hub for PSITS-CCS leadership. Monitor active member counts, operational funds, pending approvals, and active tasks.',
        tip: 'High-level KPIs summarize organizational readiness and semester milestones at a glance.',
        narration: 'Your executive control room summarizes total active members, available funds, pending approvals, and active tasks, giving leaders an instant snapshot of organizational health.',
        zoomTarget: 'div:has-text("Active members"), div:has-text("Total funds")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'h1, h2, div:has-text("Active members"), div:has-text("Total funds")', { hoverWait: 850 });
          await motionHover(page, 'div:has-text("Pending approvals"), div:has-text("Tasks")', { hoverWait: 750 });
        },
      },
      {
        title: 'Event Planning, Requirements & Approval Lifecycle',
        path: '/dashboard/events/manage-events',
        sidebarText: 'Events',
        instruction: 'Plan official events, reserve campus facilities, upload safety permits and informative letters, and submit for dean authorization.',
        tip: 'Events move through structured lifecycle states: Planning, Pending Approval, Approved, and Ongoing.',
        narration: 'Click Events in the sidebar to manage your activity calendar. Create official events, upload safety permits and informative letters, and submit complete dossiers for dean review.',
        zoomTarget: 'button:has-text("Create"), div:has-text("Event")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("Create event"), button:has-text("New event")', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("Status"), div:has-text("Approved")', { hoverWait: 850 });
        },
      },
      {
        title: 'Comprehensive 7-Tab Financial Management Suite',
        path: '/dashboard/finance/financial-ledger',
        sidebarText: 'Ledger',
        instruction: 'Manage organization finances across seven modules: Ledger, Budget Allocation, Fee Collections, Cash Advances, Remittances, and AI Forecasting.',
        tip: 'AI decision-support models analyze historical spending patterns to forecast future budget health.',
        narration: 'Under Finance, explore the full management suite. Leaders can seamlessly navigate between Ledger, Budget Allocation, Fee Collections, Cash Advances, and AI spending forecasting.',
        zoomTarget: 'aside nav, div:has-text("Budget"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'aside a:has-text("Budgets"), nav a:has-text("Budgets"), button:has-text("Budgets")', { moveDuration: 600 });
          await page.waitForTimeout(400);
          await motionClick(page, 'aside a:has-text("Collections"), nav a:has-text("Collections"), button:has-text("Collections")', { moveDuration: 600 });
          await page.waitForTimeout(400);
          await motionClick(page, 'aside a:has-text("Ledger"), nav a:has-text("Ledger"), button:has-text("Ledger")', { moveDuration: 600 });
        },
      },
      {
        title: 'Officer Task Delegation & Workload Scoring Board',
        path: '/dashboard/tasks/task-board',
        sidebarText: 'Tasks',
        instruction: 'Delegate operational duties to executive officers. The system calculates workload, role affinity, and performance scores for balanced delegation.',
        tip: 'Review officer scores before assigning critical logistical responsibilities.',
        narration: 'Navigate to Tasks to manage the delegation board. The system calculates workload balance, committee affinity, and performance scores to ensure fair and balanced task distribution.',
        zoomTarget: 'div:has-text("Workload"), div:has-text("Score")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Workload"), div:has-text("Score"), div:has-text("Officer")', { hoverWait: 850 });
          await motionHover(page, 'button:has-text("Create task"), button:has-text("Delegate")', { hoverWait: 750 });
        },
      },
      {
        title: 'Student Council Election Setup & Ballot Finalization',
        path: '/dashboard/elections/manage-elections',
        sidebarText: 'Elections',
        instruction: 'Configure council elections: establish voting timelines, define elective positions, certify party lists, and finalize official voter ballots.',
        tip: 'Once finalized and active, ballots are locked to prevent tampering during live voting.',
        narration: 'Under Voting, open Elections to configure student council races. Establish voting timelines, certify party lists, and finalize ballots, locking them securely against tampering.',
        zoomTarget: 'div:has-text("Election"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("New election"), button:has-text("Create election")', { hoverWait: 800 });
          await motionHover(page, 'table tr, div:has-text("Active"), div:has-text("Ballot")', { hoverWait: 850 });
        },
      },
      {
        title: 'Member Dock, Student Roster & Biometric Records',
        path: '/dashboard/admin/users',
        sidebarText: 'People',
        instruction: 'Maintain the official membership registry. Filter by year level or section, assign officer privileges, and verify fingerprint enrollment.',
        tip: 'Biometric templates are stored securely as cryptographic hashes for identity verification.',
        narration: 'Click People under Members to access the certified student directory. Filter members by section, assign officer privileges, and verify fingerprint biometric enrollments.',
        zoomTarget: 'input[placeholder*="search" i], table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionType(page, 'input[placeholder*="search" i], input[type="text"]', 'Carlo', { moveDuration: 500 });
          await page.waitForTimeout(400);
          await motionHover(page, 'table tr, div:has-text("Biometric"), svg.lucide-fingerprint', { hoverWait: 850 });
        },
      },
      {
        title: 'Merchandise Inventory, Stock Control & Revenue',
        path: '/dashboard/merchandise/manage-inventory',
        sidebarText: 'Inventory',
        instruction: 'Configure official department apparel, set size inventory thresholds, establish retail pricing, and monitor net sales revenue.',
        tip: 'Low-stock warnings automatically flag items requiring procurement replenishment.',
        narration: 'Finally, open Inventory under Store to configure department apparel, set size stock thresholds, establish pricing, and track verified sales revenue in real time.',
        zoomTarget: 'table tr, div:has-text("Stock")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("Add product"), button:has-text("New item")', { hoverWait: 800 });
          await motionHover(page, 'table tr, div:has-text("Stock"), div:has-text("Price")', { hoverWait: 850 });
        },
      },
    ],
  },
  {
    key: 'sao',
    title: 'Student Affairs Office (SAO) Super Admin Training Walkthrough',
    schoolId: '990001',
    password: 'Admin@123456',
    baseName: '05_sao_super_admin_voiceover_walkthrough',
    introText: 'Welcome to the University of Cebu Lapu-Lapu and Mandaue Student Affairs Office Super Admin Walkthrough. In this briefing, SAO administrators learn institutional governance, academic semester scheduling, organization recognition, compliance standards, and campus security auditing. Let us sign in with our super admin credentials.',
    steps: [
      {
        title: 'University Student Affairs Office (SAO) Command',
        path: '/dashboard/super-admin',
        sidebarText: 'Dashboard',
        instruction: 'The central institutional agency dashboard. Monitor all colleges, recognized student organizations, total campus membership, and active terms.',
        tip: 'Provides university-wide visibility over governance, accreditation, and student welfare.',
        narration: 'The central SAO dashboard provides university-wide visibility over recognized colleges, accredited student bodies, campus enrollment, and active academic terms.',
        zoomTarget: 'div:has-text("Total colleges"), div:has-text("Organizations")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'h1, h2, div:has-text("Total colleges"), div:has-text("Organizations")', { hoverWait: 850 });
          await motionHover(page, 'div:has-text("Accreditation"), div:has-text("Governance")', { hoverWait: 750 });
        },
      },
      {
        title: 'Academic Structure & Semester Lifecycle Management',
        path: '/dashboard/super-admin/academic-years',
        sidebarText: 'Academic years',
        instruction: 'Define academic years and schedule semester dates. Activating the current semester establishes the baseline for all organization activities.',
        tip: 'All event schedules, budget appropriations, and elections are scoped to the active academic semester.',
        narration: 'Click Academic Years under Setup to manage institutional calendars. Defining semester date ranges and activating the current term baselines all university organization activities.',
        zoomTarget: 'div:has-text("Active"), button:has-text("Set active"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'div:has-text("Active"), button:has-text("Set active"), table', { hoverWait: 850 });
          await motionHover(page, 'button:has-text("New academic year"), button:has-text("Add semester")', { hoverWait: 750 });
        },
      },
      {
        title: 'Master Registry of Recognized Student Organizations',
        path: '/dashboard/super-admin/organizations?status=pending',
        sidebarText: 'Registrations and organizations',
        instruction: 'Maintain the official university registry. Review annual accreditation filings, inspect constitutions, and oversee college council recognition.',
        tip: 'De-recognized or inactive organizations are automatically restricted from booking university venues.',
        narration: 'Under Governance, open Registrations and Organizations to oversee accredited bodies across all colleges. Review annual filings, inspect constitutions, and monitor council status.',
        zoomTarget: 'table tr, div:has-text("Accredited")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Active"), button:has-text("Accredited"), a:has-text("Active")', { moveDuration: 550 });
          await motionHover(page, 'table tr, div:has-text("Accredited"), div:has-text("CCS")', { hoverWait: 850 });
        },
      },
      {
        title: 'Institutional Compliance Requirements Builder',
        path: '/dashboard/super-admin/compliance',
        sidebarText: 'Compliance',
        instruction: 'Establish mandatory university compliance standards (constitutions, financial audits, semestral accomplishment reports, and activity permits).',
        tip: 'Organizations must fulfill these institutional requirements to qualify for annual university awards.',
        narration: 'Navigate to Compliance under Reviews to establish mandatory standards, including semestral financial audits, accomplishment reports, and venue safety clearances.',
        zoomTarget: 'table tr, div:has-text("Audit"), button:has-text("Add requirement")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionClick(page, 'button:has-text("Financial"), button:has-text("Events"), [role="tab"]', { moveDuration: 550 });
          await motionHover(page, 'table tr, div:has-text("Audit"), button:has-text("Add requirement")', { hoverWait: 850 });
        },
      },
      {
        title: 'Broadcasting University-Wide Official Announcements',
        path: '/dashboard/super-admin/announcements',
        sidebarText: 'University announcements',
        instruction: 'Publish emergency bulletins and institutional notices broadcast to all student, officer, and faculty workspaces across all colleges.',
        tip: 'Emergency notices trigger high-priority alerts across all mobile and web dashboards.',
        narration: 'Click University Announcements under Updates to broadcast institutional memos. Announcements can be scoped to specific colleges or broadcast campus-wide with high priority.',
        zoomTarget: 'button:has-text("New announcement"), table',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'button:has-text("New announcement"), button:has-text("Broadcast")', { hoverWait: 850 });
          await motionHover(page, 'table tr, div:has-text("Global"), div:has-text("Priority")', { hoverWait: 750 });
        },
      },
      {
        title: 'System Security Audit Trail & Access Logs',
        path: '/dashboard/super-admin/audit-logs',
        sidebarText: 'Audit trail',
        instruction: 'Review tamper-evident security audit logs: track user logins, credential changes, role modifications, financial transactions, and configuration updates.',
        tip: 'Every sensitive administrative action is logged with user identity, timestamp, and network IP details.',
        narration: 'Finally, open Audit Trail to inspect tamper-evident security logs. Track user sign-ins, role updates, sensitive financial transactions, and configuration updates across the network.',
        zoomTarget: 'table tr, div:has-text("Login")',
        zoomScale: 1.18,
        interactiveMotion: async (page) => {
          await motionHover(page, 'table tr, div:has-text("Login"), div:has-text("IP")', { hoverWait: 850 });
          await motionHover(page, 'input[placeholder*="filter" i], select, button:has-text("Filter")', { hoverWait: 750 });
        },
      },
    ],
  },
];

async function recordVoiceoverModule(browser, module) {
  console.log(`\n============================================================`);
  console.log(`[MASTER 10/10] ${module.title}`);
  console.log(`Target: ${targetUrl} | User: ${module.schoolId}`);
  console.log(`Resolution: 1920x1080 Full HD | Features: Pan-and-Zoom Camera, Motion Capture Physics, Zero Dead Air`);
  console.log(`============================================================`);

  const webmOutput = path.join(outputDir, `${module.baseName}.webm`);
  const mp4Output = path.join(outputDir, `${module.baseName}.mp4`);

  const moduleAudioDir = path.join(audioCacheDir, module.key);
  fs.mkdirSync(moduleAudioDir, { recursive: true });

  // 1. Generate Voiceover Audio Clips with Deepgram TTS
  console.log(`  -> Generating Deepgram Aura voiceover audio clips...`);
  const introAudioPath = path.join(moduleAudioDir, 'intro.mp3');
  await generateSpeechAudio(module.introText, introAudioPath);
  const introDuration = getAudioDuration(introAudioPath);
  console.log(`    - Intro narration: ${introDuration.toFixed(2)}s`);

  const stepAudioList = [];
  for (let i = 0; i < module.steps.length; i++) {
    const step = module.steps[i];
    const stepAudioPath = path.join(moduleAudioDir, `step_${i + 1}.mp3`);
    await generateSpeechAudio(step.narration, stepAudioPath);
    const stepDuration = getAudioDuration(stepAudioPath);
    stepAudioList.push({
      index: i + 1,
      path: stepAudioPath,
      duration: stepDuration,
    });
    console.log(`    - Step ${i + 1} (${step.title.slice(0, 30)}...): ${stepDuration.toFixed(2)}s`);
  }

  // 2. Launch browser recording session at 1920x1080 Full HD
  const rawVideoSubDir = path.join(tempVideoDir, module.key);
  fs.mkdirSync(rawVideoSubDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
    recordVideo: {
      dir: rawVideoSubDir,
      size: { width: 1920, height: 1080 },
    },
  });

  await setupVirtualDirector(context);

  const page = await context.newPage();
  const recordingStart = Date.now();
  const stepEvents = [];

  try {
    // Navigate to Login
    console.log(`  -> Navigating to Login...`);
    await page.goto(`${targetUrl}/login`, { waitUntil: 'networkidle', timeout: 30000 });

    const introOffsetMs = Date.now() - recordingStart;
    stepEvents.push({
      name: 'intro',
      delayMs: Math.max(0, introOffsetMs),
      path: introAudioPath,
    });

    // Intro card on login screen while intro voiceover plays
    await showTrainingCard(page, {
      step: 0,
      total: module.steps.length,
      title: module.title,
      instruction: module.introText,
      tip: 'Official 10/10 Interactive Master Demonstration for University of Cebu Lapu-Lapu and Mandaue.',
      durationSec: Math.round(introDuration),
    });

    // Integrated Login Choreography: Camera focus, typing, and sign in happen concurrently with intro narration
    await cameraFocus(page, 'form', 1.15, 800);
    await page.waitForTimeout(500);

    // Smooth typing credentials
    console.log(`  -> Submitting credentials for ${module.schoolId}...`);
    await motionType(page, 'input[name="school_id"], input[id*="school" i], input[type="text"]', module.schoolId, { moveDuration: 450, charDelay: 35 });
    await motionType(page, 'input[type="password"]', module.password, { moveDuration: 350, charDelay: 30 });

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

    // Wait for intro narration to conclude smoothly before beginning step 1
    const elapsedIntro = Date.now() - (recordingStart + introOffsetMs);
    const remainingIntroWait = Math.max(250, Math.round(introDuration * 1000) - elapsedIntro);
    await page.waitForTimeout(remainingIntroWait);
    await page.waitForTimeout(300); // 300ms natural conversational pause

    // Step through each training step with continuous 4-beat choreography
    for (let i = 0; i < module.steps.length; i++) {
      const step = module.steps[i];
      const audioInfo = stepAudioList[i];
      const stepTargetDurationMs = Math.round(audioInfo.duration * 1000);
      console.log(`  -> Choreographing Step ${i + 1}/${module.steps.length}: ${step.title} (${audioInfo.duration.toFixed(2)}s)`);

      // 1. Schedule audio to begin right at step start
      const stepStartMs = Date.now() - recordingStart;
      stepEvents.push({
        name: `step_${i + 1}`,
        delayMs: Math.max(0, stepStartMs),
        path: audioInfo.path,
      });

      // 2. Beat 1: Navigation & Page Mount (0.0s - ~1.8s)
      if (step.sidebarText) {
        const sidebarLocator = page.locator(`aside a:has-text("${step.sidebarText}"), nav a:has-text("${step.sidebarText}"), a[href*="${step.path.split('?')[0]}"]`).first();
        await motionClick(page, sidebarLocator, { timeout: 2000, moveDuration: 600 });
      }

      // Ensure target route is active
      const targetPathBase = step.path.split('?')[0];
      if (!page.url().includes(targetPathBase)) {
        await page.goto(`${targetUrl}${step.path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      } else {
        await page.waitForTimeout(250);
      }

      // Mount/Update training HUD card on the active page
      await showTrainingCard(page, {
        step: i + 1,
        total: module.steps.length,
        title: step.title,
        instruction: step.instruction,
        tip: step.tip,
        durationSec: Math.round(audioInfo.duration),
      });

      // 3. Beat 2: Smooth camera focus onto target workspace (1.8s - 3.8s)
      if (step.zoomTarget) {
        await cameraFocus(page, step.zoomTarget, step.zoomScale || 1.18, 850);
        await page.waitForTimeout(300);
      }

      // 4. Beat 3: Interactive Motion (3.8s - ~audioDuration - 1.2s)
      if (step.interactiveMotion) {
        try {
          await step.interactiveMotion(page);
        } catch {}
      }

      // 5. Beat 4: Concluding takeaway & smooth camera reset
      await page.waitForTimeout(350);
      await cameraReset(page, 750);

      // Settle smoothly: remaining time bound strictly to audio duration
      const elapsedStep = Date.now() - (recordingStart + stepStartMs);
      const remainingWaitMs = Math.max(250, stepTargetDurationMs - elapsedStep);
      await page.waitForTimeout(remainingWaitMs);
      await page.waitForTimeout(350); // Natural 350ms conversational breath pause
    }

    console.log(`  -> Completed walkthrough actions for ${module.key}`);
    await page.waitForTimeout(800);
  } catch (err) {
    console.error(`  [WARN] Exception during ${module.key} session:`, err.message);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      const rawVideoPath = await video.path();
      if (fs.existsSync(rawVideoPath)) {
        const videoDuration = getAudioDuration(rawVideoPath);
        console.log(`  -> Raw video captured: ${videoDuration.toFixed(2)}s`);

        // Build synchronized audio track with FFmpeg
        console.log(`  -> Muxing synchronized voiceover audio track...`);
        const mixedAudioPath = path.join(moduleAudioDir, 'full_narration.mp3');

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
        console.log(`  [COMPLETE 10/10 MASTER] ${module.baseName}:`);
        console.log(`    - WebM: ${webmSize} MB`);
        console.log(`    - MP4:  ${mp4Size} MB`);
      }
    }
  }
}

async function main() {
  console.log(`============================================================`);
  console.log(`HIUSA 10/10 Interactive Master Walkthrough Generation`);
  console.log(`Features: Pan-and-Zoom Camera, Motion Capture Physics, Zero Dead Air`);
  console.log(`Broadcast Loudness (-14 LUFS) & Seamless Conversational Cadence`);
  console.log(`Target: ${targetUrl}`);
  console.log(`Output Directory: ${outputDir}`);
  console.log(`============================================================\n`);

  const browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 60 : 0,
  });

  const startTime = Date.now();
  const roleArg = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
  const activeModules = roleArg ? MODULES.filter((m) => m.key === roleArg) : MODULES;

  for (let i = 0; i < activeModules.length; i++) {
    const module = activeModules[i];
    await recordVoiceoverModule(browser, module);
    if (i < activeModules.length - 1) {
      console.log(`\n  (Cooling down 8 seconds between role modules to prevent 429 throttling)`);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }

  await browser.close();

  // Cleanup temporary video directory
  try {
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  } catch {}

  const durationMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n============================================================`);
  console.log(`All 10/10 Master Walkthroughs Completed in ${durationMin} minutes!`);
  console.log(`Files located in: ${outputDir}`);
  console.log(`============================================================`);

  const files = fs.readdirSync(outputDir);
  for (const f of files) {
    const s = fs.statSync(path.join(outputDir, f));
    console.log(`  - ${f} (${(s.size / (1024 * 1024)).toFixed(2)} MB)`);
  }
}

main().catch((err) => {
  console.error('Fatal error during voiceover video generation:', err);
  process.exit(1);
});
