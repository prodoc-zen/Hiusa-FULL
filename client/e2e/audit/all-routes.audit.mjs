// Rendered audit: boots a throwaway stack (own sqlite file, ports 8020 and 5190), signs in once per role,
// visits every path server/config/client_routes.php lists for that role at two viewports and checks the
// design contract on the rendered DOM. Writes report.json and screenshots under D:/Claude/scratch/hiusa-audit
// and exits 1 on any failure.
//
//   node client/e2e/audit/all-routes.audit.mjs [--roles=ADMIN,STUDENT] [--match=finance] [--limit=5] [--keep-stack]
//
// It never touches the dev database: server/.env is backed up, pointed at the audit sqlite file and restored
// (also on failure); the audit stack has its own rate limits raised so a 300-page sweep is not answered 429.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { BY_ROLE } from '../support/accounts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..', '..');
const ROOT = path.resolve(CLIENT, '..');
const SERVER = path.join(ROOT, 'server');
const OUT = 'D:/Claude/scratch/hiusa-audit';
const DB_FILE = `${OUT}/audit.sqlite`;
const API_PORT = 8020;
const WEB_PORT = 5190;
const API = `http://127.0.0.1:${API_PORT}/api`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const ENV_FILE = path.join(SERVER, '.env');
const ENV_BACKUP = path.join(SERVER, '.env.audit-backup');
const VIEWPORTS = [
  { name: '1366x900', width: 1366, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];
const ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'];

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const onlyRoles = arg('roles')?.split(',');
const match = arg('match');
const limit = Number(arg('limit')) || Infinity;
const keepStack = process.argv.includes('--keep-stack');

const log = (...parts) => console.log('[audit]', ...parts);
const children = [];
let envChanged = false;

function setEnvKeys(text, values) {
  const lines = text.split(/\r?\n/);
  const remaining = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const key = line.split('=')[0].trim();
    if (remaining.has(key)) {
      const value = remaining.get(key);
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [key, value] of remaining) next.push(`${key}=${value}`);
  return next.join('\n');
}

function prepareEnv() {
  // A leftover backup means an earlier run died before restoring; it is the original, so restore it first.
  if (fs.existsSync(ENV_BACKUP)) fs.copyFileSync(ENV_BACKUP, ENV_FILE);
  else fs.copyFileSync(ENV_FILE, ENV_BACKUP);
  envChanged = true;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(DB_FILE, '');
  const high = '100000';
  fs.writeFileSync(ENV_FILE, setEnvKeys(fs.readFileSync(ENV_BACKUP, 'utf8'), {
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: DB_FILE,
    APP_ENV: 'local',
    MAIL_MAILER: 'log',
    FRONTEND_URL: WEB,
    FRONTEND_URLS: WEB,
    QUEUE_CONNECTION: 'sync',
    SESSION_DRIVER: 'array',
    CACHE_STORE: 'array',
    RATE_LIMIT_PUBLIC_PER_MINUTE: high,
    RATE_LIMIT_READ_PER_MINUTE: high,
    RATE_LIMIT_WRITE_PER_MINUTE: high,
    RATE_LIMIT_PEOPLE_SEARCH_PER_MINUTE: high,
    RATE_LIMIT_EXPENSIVE_PER_MINUTE: high,
    RATE_LIMIT_LOGIN_PER_MINUTE: high,
    RATE_LIMIT_PASSWORD_PER_MINUTE: high,
    RATE_LIMIT_REGISTRATION_PER_MINUTE: high,
  }));
}

function restoreEnv() {
  if (!envChanged) return;
  try {
    fs.copyFileSync(ENV_BACKUP, ENV_FILE);
    fs.rmSync(ENV_BACKUP, { force: true });
    envChanged = false;
    log('server/.env restored');
  } catch (error) {
    console.error('[audit] FAILED TO RESTORE server/.env, copy .env.audit-backup over it by hand:', error.message);
  }
}

function stopChildren() {
  while (children.length) {
    const child = children.pop();
    if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  // artisan serve hands the port to a php -S grandchild that can outlive the tree kill: stop whatever still listens on our ports.
  const listing = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout || '';
  for (const line of listing.split(/\r?\n/)) {
    const m = line.match(/127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && [String(API_PORT), String(WEB_PORT)].includes(m[1])) spawnSync('taskkill', ['/pid', m[2], '/F'], { stdio: 'ignore' });
  }
}

function cleanup() {
  if (!keepStack) stopChildren();
  restoreEnv();
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

async function waitFor(url, label, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

function artisan(...args) {
  const result = spawnSync('php', ['artisan', ...args], { cwd: SERVER, encoding: 'utf8', env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB_FILE, APP_ENV: 'local' } });
  if (result.status !== 0) throw new Error(`php artisan ${args.join(' ')} failed:\n${(result.stdout || '').slice(-600)}\n${(result.stderr || '').slice(-600)}`);
}

async function bootStack() {
  prepareEnv();
  log('migrate:fresh --seed on', DB_FILE);
  artisan('migrate:fresh', '--seed', '--force');
  const serverEnv = { ...process.env, FRONTEND_URL: WEB, FRONTEND_URLS: WEB, DB_CONNECTION: 'sqlite', DB_DATABASE: DB_FILE, APP_ENV: 'local', MAIL_MAILER: 'log', QUEUE_CONNECTION: 'sync' };
  children.push(spawn('php', ['artisan', 'serve', '--host=127.0.0.1', `--port=${API_PORT}`, '--no-reload'], { cwd: SERVER, env: serverEnv, stdio: 'ignore', windowsHide: true }));
  children.push(spawn(process.execPath, [path.join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: CLIENT, env: { ...process.env, VITE_API_URL: API }, stdio: 'ignore', windowsHide: true,
  }));
  await waitFor(`${API}/organizations`, 'API');
  await waitFor(WEB, 'Vite');
  log('stack up');
}

async function call(token, apiPath) {
  const response = await fetch(`${API}${apiPath}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function signIn(account) {
  const response = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ school_id: account.schoolId, password: account.password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`sign-in as ${account.role} answered ${response.status}`);
  return { token: payload.access_token, user: payload.user, expires: payload.session_expires_in_seconds };
}

// The first list inside an API envelope ({data:[...]}, {data:{data:[...]}}, [...]).
function rows(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const value of [body.data, body.items, body.organizations, body.applications, body.results]) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const inner = rows(value);
      if (inner.length) return inner;
    }
  }
  return [];
}

async function firstId(token, candidates, pick = () => true) {
  for (const apiPath of candidates) {
    const { status, body } = await call(token, apiPath);
    if (status !== 200) continue;
    const row = rows(body).find((r) => r && r.id != null && pick(r));
    if (row) return row.id;
  }
  return null;
}

// Fills route params with seeded ids; a null value means no record can be fetched and the route is skipped.
async function paramValues(role, session) {
  const values = {};
  const token = session.token;
  if (role === 'SUPER_ADMIN') {
    const id = await firstId(token, ['/system/organizations', '/organizations'], (r) => r.lifecycle_status === undefined || r.lifecycle_status === 'active');
    values.organizationId = id;
    values.orgId = id;
  }
  if (role === 'DEPARTMENT_HEAD') {
    values.orgId = await firstId(token, ['/college/organizations', '/organizations']);
  }
  if (role === 'STUDENT') {
    let id = await firstId(token, ['/my/organization-applications']);
    if (!id) {
      // The seeders create no organization application, but any student can file one, so the audit files one
      // directly in its own sqlite file (no uploads: the page is audited as a just-submitted application).
      seedStudentApplication(session.user);
      id = await firstId(token, ['/my/organization-applications']);
    }
    values.applicationId = id;
  }
  return values;
}

function seedStudentApplication(user) {
  const code = `$p = new PDO('sqlite:' . $argv[1]); $u = json_decode($argv[2], true); $now = date('Y-m-d H:i:s');
    $p->prepare("insert into organization_applications (college_id, name, acronym, description, school_id, first_name, last_name, email, position_title, status, round, submitted_at, created_at, updated_at) values (1, 'Audit Sample Society', 'AUDIT', 'Filed by the rendered audit.', ?, ?, ?, ?, 'President', 'pending_dean', 1, ?, ?, ?)")
      ->execute([$u['school_id'], $u['first_name'], $u['last_name'], $u['email'], $now, $now, $now]);`;
  const result = spawnSync('php', ['-r', code, DB_FILE, JSON.stringify({ school_id: user.school_id, first_name: user.first_name, last_name: user.last_name, email: user.email })], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`could not file the sample application: ${(result.stderr || '').slice(0, 300)}`);
}

const slugOf = (p) => (p.replace(/^\/dashboard\/?/, '').replace(/[/:]+/g, '-') || 'dashboard');

// Runs inside the page. Returns every measurement for one route at one viewport.
function measurePage() {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (rect.right <= 0) return false; // slid-out drawer
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return true;
  };
  const visibleDeep = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    }
    return visible(el);
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 6).join(' ') : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls.replace(/\s+/g, '.')}` : ''} "${text}"`;
  };

  const root = document.documentElement;
  // The app shell clips its own overflow, so the document never scrolls sideways; a wide child is then cut off silently.
  // Treat a wide clipping container (hidden or clip, not an ellipsis truncation) whose content is wider than it is as overflow too.
  const clipped = [...document.body.querySelectorAll('*')].filter((el) => {
    if (el.clientWidth < window.innerWidth * 0.6 || el.scrollWidth <= el.clientWidth + 1) return false;
    const style = getComputedStyle(el);
    return ['hidden', 'clip'].includes(style.overflowX) && style.textOverflow !== 'ellipsis' && visibleDeep(el);
  });
  const overflowX = root.scrollWidth > root.clientWidth + 1 || clipped.length > 0;
  const wide = overflowX
    ? [...clipped.slice(0, 2).map((el) => `clips ${el.scrollWidth}>${el.clientWidth}: ${describe(el)}`), ...[...document.body.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && visibleDeep(el)).slice(0, 4).map(describe)]
    : [];

  const h1s = [...document.querySelectorAll('h1')].filter(visibleDeep);

  const probe = document.createElement('span');
  probe.className = 'bg-brand-700';
  document.body.appendChild(probe);
  const brand = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const primary = new Set(document.querySelectorAll('[data-variant="primary"]'));
  document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
    // A selected pagination page or tab is the same blue fill but marks state, not an action.
    if (el.hasAttribute('aria-current') || el.hasAttribute('aria-selected') || el.hasAttribute('aria-pressed')) return;
    if (brand && brand !== 'rgba(0, 0, 0, 0)' && getComputedStyle(el).backgroundColor === brand) primary.add(el);
  });
  const primaries = [...primary].filter(visibleDeep);

  const small = [];
  const heavy = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenHeavy = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !visibleDeep(el)) continue;
    const style = getComputedStyle(el);
    if (parseFloat(style.fontSize) < 12) small.push(`${parseFloat(style.fontSize)}px ${describe(el)}`);
    if (Number(style.fontWeight) >= 800 && !seenHeavy.has(el)) {
      seenHeavy.add(el);
      heavy.push(`${style.fontWeight} ${describe(el)}`);
    }
  }

  return {
    overflowX,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    wide,
    h1Count: h1s.length,
    h1Text: h1s.map((el) => (el.textContent || '').trim().slice(0, 40)),
    primaryCount: primaries.length,
    primaryText: primaries.map(describe),
    smallText: [...new Set(small)].slice(0, 8),
    smallTextCount: small.length,
    heavyText: heavy.slice(0, 8),
    heavyTextCount: heavy.length,
  };
}

async function auditRoute(context, viewport, role, route, filledPath, roleRoutes) {
  const page = await context.newPage();
  const consoleErrors = [];
  const apiFailures = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)); });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 240)}`));
  page.on('response', (response) => {
    if (response.url().startsWith(API) && response.status() >= 500) apiFailures.push(`${response.status()} ${response.request().method()} ${response.url().replace(API, '')}`.slice(0, 200));
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || '';
    if (request.url().startsWith(API) && !/ERR_ABORTED/.test(reason)) apiFailures.push(`failed ${request.method()} ${request.url().replace(API, '')} ${reason}`.slice(0, 200));
  });

  const result = { role, route, path: filledPath, viewport: viewport.name, checks: {}, screenshot: null };
  try {
    try {
      await page.goto(`${WEB}${filledPath}`, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (error) {
      result.navigationNote = `no network idle: ${String(error.message).split('\n')[0]}`;
    }
    await page.waitForTimeout(400);
    const landed = new URL(page.url()).pathname;
    result.landed = landed;
    const measured = await page.evaluate(measurePage);
    Object.assign(result, { measured });
    const shotDir = path.join(OUT, role, viewport.name);
    fs.mkdirSync(shotDir, { recursive: true });
    result.screenshot = path.join(shotDir, `${slugOf(filledPath)}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(async () => { await page.screenshot({ path: result.screenshot }); });

    const fail = (name, detail) => { result.checks[name] = detail; };
    if (landed !== filledPath.split('?')[0]) {
      // A route that forwards to another page of the same role is an alias (that page is audited on its own); anything else is a dead end.
      if (roleRoutes.some((r) => new RegExp(`^${r.replace(/:\w+/g, '[^/]+')}$`).test(landed))) result.note = `redirects to ${landed}`;
      else fail('redirected', `landed on ${landed}`);
    }
    if (measured.overflowX) fail('overflow-x', `document ${measured.scrollWidth}/${measured.clientWidth}; ${measured.wide.join(' | ')}`);
    if (consoleErrors.length) fail('console-errors', [...new Set(consoleErrors)].slice(0, 5).join(' | '));
    if (apiFailures.length) fail('api-failed', [...new Set(apiFailures)].slice(0, 5).join(' | '));
    if (measured.h1Count !== 1) fail('h1-count', `${measured.h1Count} visible h1 ${JSON.stringify(measured.h1Text)}`);
    if (measured.primaryCount > 1) fail('primary-buttons', `${measured.primaryCount} filled primary: ${measured.primaryText.join(' | ')}`);
    if (measured.smallTextCount) fail('font-under-12px', `${measured.smallTextCount} nodes, e.g. ${measured.smallText.slice(0, 4).join(' | ')}`);
    if (measured.heavyTextCount) fail('font-weight-800+', `${measured.heavyTextCount} elements, e.g. ${measured.heavyText.slice(0, 4).join(' | ')}`);
  } catch (error) {
    result.checks.crashed = String(error.message).split('\n')[0];
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function main() {
  const startedAt = new Date().toISOString();
  const routesConfig = JSON.parse(spawnSync('php', ['-r', "echo json_encode(require 'config/client_routes.php');"], { cwd: SERVER, encoding: 'utf8' }).stdout);
  await bootStack();

  const accounts = {};
  const roles = ROLES.filter((r) => !onlyRoles || onlyRoles.includes(r));
  for (const role of ROLES) {
    if (roles.includes(role)) accounts[role] = { ...(await signIn(BY_ROLE[role])), role };
  }

  const results = [];
  const skipped = [];
  // A fresh browser every few pages keeps memory flat (one long-lived Chromium crashed after a dozen heavy pages);
  // a crash relaunches it and retries the route once.
  const PAGES_PER_BROWSER = 10;
  let browser = null;
  let context = null;
  let served = 0;
  const closeBrowser = async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    browser = null;
    context = null;
    served = 0;
  };
  const openBrowser = async (viewport, session) => {
    await closeBrowser();
    browser = await chromium.launch({ args: ['--mute-audio'] });
    context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await context.addInitScript(({ token, user, expires }) => {
      try {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('auth_expires_at', String(Date.now() + (Number(expires) || 14400) * 1000));
      } catch { /* storage unavailable */ }
    }, { token: session.token, user: session.user, expires: session.expires });
  };
  try {
    for (const role of roles) {
      const session = accounts[role];
      const values = await paramValues(role, session);
      const paths = (routesConfig[role] || []).filter((p) => !match || p.includes(match)).slice(0, limit);
      for (const viewport of VIEWPORTS) {
        await closeBrowser();
        for (const route of paths) {
          const params = [...route.matchAll(/:(\w+)/g)].map((m) => m[1]);
          const missing = params.filter((p) => values[p] == null);
          if (missing.length) {
            const reason = `no record for :${missing.join(', :')} in the seeded database`;
            if (viewport === VIEWPORTS[0]) skipped.push(`${role} ${route}: ${reason}`);
            continue;
          }
          const filled = route.replace(/:(\w+)/g, (_, name) => String(values[name]));
          const started = Date.now();
          let result = null;
          for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
            if (!browser || served >= PAGES_PER_BROWSER) await openBrowser(viewport, session);
            const candidate = await auditRoute(context, viewport, role, route, filled, routesConfig[role] || []);
            served += 1;
            if (/crashed|closed/i.test(candidate.checks.crashed || '') && attempt === 0) {
              log(`${role} ${viewport.name} ${filled} browser crashed, relaunching`);
              await closeBrowser();
            } else {
              result = candidate;
            }
          }
          results.push(result);
          const failed = Object.keys(result.checks);
          log(`${role} ${viewport.name} ${filled} ${failed.length ? `FAIL ${failed.join(',')}` : 'ok'} (${Math.round((Date.now() - started) / 1000)}s)`);
        }
        await closeBrowser();
      }
    }
  } finally {
    await closeBrowser();
  }

  const failures = results.flatMap((r) => Object.entries(r.checks).map(([check, detail]) => ({
    role: r.role, route: r.path, viewport: r.viewport, check, detail, screenshot: r.screenshot,
  })));
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    routesChecked: new Set(results.map((r) => `${r.role} ${r.path}`)).size,
    pagesChecked: results.length,
    skippedRoutes: skipped,
    failureCount: failures.length,
    failures,
    results: results.map(({ role, route, path: p, viewport, landed, note, navigationNote, checks, screenshot, measured }) => ({ role, route, path: p, viewport, landed, note, navigationNote, checks, screenshot, measured })),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  log(`${report.routesChecked} routes, ${report.pagesChecked} pages, ${failures.length} failures, ${skipped.length} skipped -> ${path.join(OUT, 'report.json')}`);
  return failures.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error('[audit] aborted:', error.stack || error.message);
} finally {
  cleanup();
}
process.exit(code);
