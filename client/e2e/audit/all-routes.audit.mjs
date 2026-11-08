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
// The widths where a Department Head with the workspace switcher changes shape: the label shows from xl up (1366),
// folds into an icon at 1279 and 1024, and stays an icon on a phone (390).
const SWITCHER_WIDTHS = [1366, 1279, 1024, 390];
const ROLES = ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'];

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const onlyRoles = arg('roles')?.split(',');
const match = arg('match');
const limit = Number(arg('limit')) || Infinity;
const keepStack = process.argv.includes('--keep-stack');
const periodOnly = process.argv.includes('--period-only'); // skip the route sweep, run only the top bar period capture
const noSemesters = process.argv.includes('--no-semesters'); // leave the database without semesters: the period capture must go red

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

// The seeders create an academic year but no semester, so the top bar has no period to show and its period
// button never mounts. The audit adds an active first semester and an upcoming second one to that year (and
// creates the year if a future seeder drops it), directly in its own sqlite file.
function seedAcademicSemesters() {
  const code = `$p = new PDO('sqlite:' . $argv[1]); $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $now = date('Y-m-d H:i:s');
    $year = $p->query("select id, starts_on, ends_on from academic_years order by is_current desc, id desc limit 1")->fetch(PDO::FETCH_ASSOC);
    if (!$year) {
      $y = (int) date('Y');
      $p->prepare("insert into academic_years (label, starts_on, ends_on, is_current, created_at, updated_at) values (?, ?, ?, 1, ?, ?)")
        ->execute([$y . '-' . ($y + 1), $y . '-06-01', ($y + 1) . '-05-31', $now, $now]);
      $year = ['id' => $p->lastInsertId(), 'starts_on' => $y . '-06-01', 'ends_on' => ($y + 1) . '-05-31'];
    }
    $mid = date('Y-m-d', (strtotime($year['starts_on']) + strtotime($year['ends_on'])) / 2);
    $next = date('Y-m-d', strtotime($mid . ' +1 day'));
    $semester = $p->prepare("insert into academic_semesters (academic_year_id, number, starts_on, ends_on, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)");
    $semester->execute([$year['id'], 1, $year['starts_on'], $mid, 'active', $now, $now]);
    $semester->execute([$year['id'], 2, $next, $year['ends_on'], 'upcoming', $now, $now]);`;
  const result = spawnSync('php', ['-r', code, DB_FILE], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`could not seed the academic semesters: ${(result.stderr || result.stdout || '').slice(0, 300)}`);
}

// /dashboard/records only shows its read-only state for a closed period, and the seeders close none. The audit
// adds the school year before the current one with two closed semesters, then snapshots them the way closing a
// semester does, so that period lists organizations and officers. Skipped when a closed semester already exists.
function seedClosedSchoolYear() {
  const code = `$p = new PDO('sqlite:' . $argv[1]); $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $now = date('Y-m-d H:i:s');
    if ((int) $p->query("select count(*) from academic_semesters where status = 'completed'")->fetchColumn() === 0) {
      $current = $p->query("select starts_on, ends_on from academic_years order by is_current desc, id desc limit 1")->fetch(PDO::FETCH_ASSOC);
      $from = (int) date('Y', strtotime($current['starts_on'])) - 1;
      $label = $from . '-' . ($from + 1);
      $p->prepare("insert into academic_years (label, starts_on, ends_on, is_current, created_at, updated_at) values (?, ?, ?, 0, ?, ?)")
        ->execute([$label, $from . '-06-01', ($from + 1) . '-05-31', $now, $now]);
      $yearId = $p->lastInsertId();
      $semester = $p->prepare("insert into academic_semesters (academic_year_id, number, starts_on, ends_on, status, created_at, updated_at) values (?, ?, ?, ?, 'completed', ?, ?)");
      $semester->execute([$yearId, 1, $from . '-06-01', $from . '-10-31', $now, $now]);
      $semester->execute([$yearId, 2, $from . '-11-01', ($from + 1) . '-05-31', $now, $now]);
    }
    echo json_encode(array_map('intval', $p->query("select id from academic_semesters where status = 'completed' order by id")->fetchAll(PDO::FETCH_COLUMN)));`;
  const result = spawnSync('php', ['-r', code, DB_FILE], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`could not seed the closed school year: ${(result.stderr || result.stdout || '').slice(0, 300)}`);
  for (const id of JSON.parse(result.stdout || '[]')) artisan('hiusa:snapshot-semester', String(id));
}

async function bootStack() {
  prepareEnv();
  log('migrate:fresh --seed on', DB_FILE);
  artisan('migrate:fresh', '--seed', '--force');
  if (!noSemesters) {
    seedAcademicSemesters();
    seedClosedSchoolYear();
  }
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
    // The SAO opens the application the Department Head already endorsed, with that stage's note and file on it.
    seedApplication('sao');
    values.applicationId = await firstId(token, ['/organization-applications?status=pending_sao'], (r) => r.name === SAO_APPLICATION);
  }
  if (role === 'DEPARTMENT_HEAD') {
    values.orgId = await firstId(token, ['/college/organizations', '/organizations']);
    seedApplication('dean');
    values.applicationId = await firstId(token, ['/organization-applications?status=pending_dean'], (r) => r.name === DEAN_APPLICATION);
  }
  if (role === 'STUDENT') {
    seedApplication('dean');
    values.applicationId = await firstId(token, ['/my/organization-applications'], (r) => r.name === DEAN_APPLICATION);
  }
  return values;
}

const DEAN_APPLICATION = 'Audit Review Society';
const SAO_APPLICATION = 'Audit Endorsed Society';

// The review screens are empty without an active semester that publishes organization requirements and an
// application that carries one uploaded document per requirement, so the audit files both directly in its own
// sqlite file. 'dean' files an application waiting for the Department Head; 'sao' files one the Department Head
// already endorsed, with a requirement review and a review file on it. A second call keeps what is already filed.
function seedApplication(stage) {
  const code = `$p = new PDO('sqlite:' . $argv[1]); $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $o = json_decode($argv[2], true); $now = date('Y-m-d H:i:s');
    function q($p, $sql, $args = []) { $s = $p->prepare($sql); $s->execute($args); return $s; }
    $name = $o['stage'] === 'sao' ? $o['saoName'] : $o['deanName'];
    if (q($p, 'select id from organization_applications where name = ?', [$name])->fetchColumn()) exit(0);

    $sem = q($p, "select id, academic_year_id from academic_semesters where status = 'active' limit 1")->fetch(PDO::FETCH_ASSOC);
    if (!$sem) {
      $year = q($p, 'select id from academic_years order by is_current desc, id desc limit 1')->fetchColumn();
      if (!$year) {
        $y = (int) date('Y');
        q($p, 'insert into academic_years (label, starts_on, ends_on, is_current, created_at, updated_at) values (?, ?, ?, 1, ?, ?)', [$y . '-' . ($y + 1), $y . '-06-01', ($y + 1) . '-05-31', $now, $now]);
        $year = $p->lastInsertId();
      }
      $number = 1 + (int) q($p, 'select coalesce(max(number), 0) from academic_semesters where academic_year_id = ?', [$year])->fetchColumn();
      q($p, "insert into academic_semesters (academic_year_id, number, starts_on, ends_on, status, created_at, updated_at) values (?, ?, ?, ?, 'active', ?, ?)", [$year, $number, date('Y-m-d', strtotime('-30 days')), date('Y-m-d', strtotime('+120 days')), $now, $now]);
      $sem = ['id' => $p->lastInsertId(), 'academic_year_id' => $year];
    }
    $label = q($p, 'select label from academic_years where id = ?', [$sem['academic_year_id']])->fetchColumn();

    $types = [];
    foreach (['Letter of intent', 'Constitution and by-laws', 'List of proposed officers'] as $title) {
      $id = q($p, "select id from compliance_requirement_types where name = ? and academic_semester_id = ? and category = 'organization'", [$title, $sem['id']])->fetchColumn();
      if (!$id) {
        q($p, "insert into compliance_requirement_types (category, academic_year, academic_semester_id, name, description, deadline_at, is_active, created_by, allowed_extensions, created_at, updated_at) values ('organization', ?, ?, ?, 'Filed by the rendered audit.', ?, 1, ?, ?, ?, ?)", [$label, $sem['id'], $title, date('Y-m-d H:i:s', strtotime('+60 days')), $o['sao'], json_encode(['pdf']), $now, $now]);
        $id = $p->lastInsertId();
      }
      $types[] = $id;
    }

    $college = q($p, 'select o.college_id from users u join organizations o on o.id = u.organization_id where u.school_id = ?', [$o['dean']])->fetchColumn() ?: 1;
    $user = q($p, 'select first_name, last_name, email from users where school_id = ?', [$o['student']])->fetch(PDO::FETCH_ASSOC) ?: ['first_name' => 'Audit', 'last_name' => 'Student', 'email' => 'audit.student@hiusa.local'];
    $endorsed = $o['stage'] === 'sao';
    q($p, 'insert into organization_applications (college_id, name, acronym, description, school_id, first_name, last_name, email, position_title, status, round, submitted_at, requires_documents, required_documents_count, endorsed_by, endorsed_at, endorsement_note, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?)', [
      $college, $name, $endorsed ? 'AUDEND' : 'AUDREV', 'Filed by the rendered audit so the review screen has requirements to show.', $o['student'], $user['first_name'], $user['last_name'], $user['email'], 'President',
      $endorsed ? 'pending_sao' : 'pending_dean', $now, count($types), $endorsed ? $o['dean'] : null, $endorsed ? $now : null, $endorsed ? 'Every officer on the list is enrolled in the college.' : null, $now, $now,
    ]);
    $app = $p->lastInsertId();
    foreach ($types as $i => $type) {
      q($p, 'insert into organization_application_documents (organization_application_id, requirement_type_id, file_path, file_original_name, mime_type, file_size, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)', [$app, $type, 'organization-applications/audit/' . $app . '-' . $i . '.pdf', 'requirement-' . ($i + 1) . '.pdf', 'application/pdf', 2048, $now, $now]);
      if ($endorsed) {
        q($p, "insert into organization_application_requirement_reviews (organization_application_id, requirement_type_id, round, stage, status, note, reviewed_by, created_at, updated_at) values (?, ?, 1, 'dean', 'ok', ?, ?, ?, ?)", [$app, $type, $i === 0 ? 'The signatures are clear.' : null, $o['dean'], $now, $now]);
      }
    }
    if ($endorsed) {
      q($p, "insert into organization_application_review_files (organization_application_id, requirement_type_id, round, stage, uploaded_by, file_path, file_original_name, mime_type, file_size, created_at, updated_at) values (?, null, 1, 'dean', ?, ?, 'endorsement-letter.pdf', 'application/pdf', 2048, ?, ?)", [$app, $o['dean'], 'organization-applications/audit/' . $app . '-review.pdf', $now, $now]);
    }`;
  const payload = { stage, student: BY_ROLE.STUDENT.schoolId, dean: BY_ROLE.DEPARTMENT_HEAD.schoolId, sao: BY_ROLE.SUPER_ADMIN.schoolId, deanName: DEAN_APPLICATION, saoName: SAO_APPLICATION };
  const result = spawnSync('php', ['-r', code, DB_FILE, JSON.stringify(payload)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`could not file the ${stage} sample application: ${(result.stderr || result.stdout || '').slice(0, 400)}`);
}

const slugOf = (p) => (p.replace(/^\/dashboard\/?/, '').replace(/[/:?=&]+/g, '-') || 'dashboard');

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

// Pages that carry the organization application pipeline are checked past first paint, because an empty queue or
// an empty requirement list still passes every layout check. Each inspector returns { checkName: detail } for
// what is wrong; the review screen also gets a screenshot per state next to the route's own.
const REVIEW_PATH = '/dashboard/organization-applications?record=:applicationId';
const QUEUE_PATH = '/dashboard/organization-applications';
const REVIEW_PASS = { DEPARTMENT_HEAD: 'Endorse', SUPER_ADMIN: 'Approve' };

// The queue must list the filed application under its first tab, with a way to open it.
async function queueInspector(page) {
  const problems = {};
  // The tabs are a row from 640px and a select below it; both carry the label, so the page text is the same at either width.
  const text = (await page.locator('body').textContent()) || '';
  const found = text.match(/To review \((\d+)\)/);
  if (!found || Number(found[1]) < 1) problems['queue-count'] = `the To review tab reads ${found ? found[0] : 'nothing'}, expected at least one application`;
  // The table and the card list are both in the page; only one of them is showing at a given width.
  if ((await page.locator('[aria-label^="Review application of "]:visible').count()) < 1) problems['queue-review-link'] = 'no Review button on the queue';
  return problems;
}

// The student page must list the requirements of the semester, not the empty state.
async function studentApplicationInspector(page) {
  const problems = {};
  if (await page.getByText('No requirements are listed for this application.').isVisible().catch(() => false)) problems['student-requirements'] = 'the page says no requirements are listed';
  if (!(await page.getByText('Letter of intent').first().isVisible().catch(() => false))) problems['student-requirements'] = 'the seeded requirement is not on the page';
  return problems;
}

// The review screen: one row per requirement, the passing button off until every row is Accepted, a note field on
// Needs changes, Return on once there is a note, and the comment-only form behind its link.
function reviewInspector(role) {
  const passLabel = REVIEW_PASS[role];
  return async (page, result) => {
    const problems = {};
    const shot = (state) => page.screenshot({ path: result.screenshot.replace(/\.png$/, `-${state}.png`), fullPage: true }).catch(() => {});
    const rows = page.locator('section[aria-label="Requirements"] > ul > li');
    const count = await rows.count();
    if (count < 3) return { 'review-requirements': `${count} requirement rows, expected 3` };

    const pass = page.getByRole('button', { name: passLabel, exact: true });
    const giveBack = page.getByRole('button', { name: 'Return with comments', exact: true });
    const comment = page.getByRole('button', { name: 'Add a comment', exact: true });
    if (!(await pass.isDisabled())) problems['review-pass-early'] = `${passLabel} is on before every requirement is Accepted`;
    if (!(await giveBack.isDisabled())) problems['review-return-early'] = 'Return with comments is on with no note';
    if (!(await comment.isVisible())) problems['review-comment-link'] = 'no Add a comment link';
    if (role === 'SUPER_ADMIN' && !(await page.getByText('Department Head:').first().isVisible().catch(() => false))) problems['review-prior-stage'] = 'the Department Head review is not shown to the SAO';

    // The app shell scrolls inside itself, so a full-page shot stops at the first screen: scroll to the decision first.
    await page.getByRole('heading', { name: 'Decision', exact: true }).scrollIntoViewIfNeeded();
    await shot('decision');

    const marks = page.locator('select[aria-label^="Review of "]');
    await marks.first().selectOption('needs_changes');
    const note = rows.first().locator('textarea');
    if ((await note.count()) !== 1) {
      problems['review-note-field'] = 'Needs changes did not open a note field';
    } else {
      await note.fill('Add the signed page.');
      if (!(await giveBack.isEnabled())) problems['review-return-late'] = 'Return with comments stays off with a note on a flagged requirement';
      if (!(await pass.isDisabled())) problems['review-pass-flagged'] = `${passLabel} is on with a requirement that needs changes`;
    }
    await shot('needs-changes');

    for (let i = 0; i < count; i += 1) await marks.nth(i).selectOption('ok');
    if (!(await pass.isEnabled())) problems['review-pass-late'] = `${passLabel} stays off with every requirement Accepted`;
    await shot('accepted');

    await comment.click();
    if (!(await page.getByRole('button', { name: 'Save comment', exact: true }).isVisible())) problems['review-comment-form'] = 'Add a comment did not open the comment form';
    await shot('comment');
    return problems;
  };
}

function inspectorFor(role, route) {
  if (route === REVIEW_PATH) return reviewInspector(role);
  if (route === QUEUE_PATH && REVIEW_PASS[role]) return queueInspector;
  if (role === 'STUDENT' && route === '/dashboard/student/organization-applications/:applicationId') return studentApplicationInspector;
  return null;
}

// Records opens on the current period. Switch it to the closed school year the audit seeded so the read-only state is
// what gets measured, and for the roles that pick an organization open the first one so its sections render too.
async function prepareRecords(page, role, result) {
  const year = page.getByLabel('School year');
  if (!(await year.isVisible().catch(() => false))) {
    result.checks['records-period'] = 'the school year picker did not render';
    return;
  }
  const options = await year.locator('option').evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, selected: node.selected })));
  const closed = options.find((option) => !option.selected);
  if (!closed) {
    result.checks['records-period'] = 'only one school year is listed, so no closed period could be opened';
    return;
  }
  await year.selectOption(closed.value);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  if (role === 'SUPER_ADMIN' || role === 'DEPARTMENT_HEAD') {
    const first = page.locator('ul[class*="max-h-"] button').first();
    if (await first.isVisible().catch(() => false)) {
      await first.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  if (!(await page.getByText('Read only', { exact: true }).first().isVisible().catch(() => false))) {
    result.checks['records-read-only'] = 'the closed period does not show the Read only badge';
  }
}

async function auditRoute(context, viewport, role, route, filledPath, roleRoutes, inspect = null) {
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
    if (route === '/dashboard/records') await prepareRecords(page, role, result);
    const landed = new URL(page.url()).pathname;
    result.landed = landed;
    const measured = await page.evaluate(measurePage);
    Object.assign(result, { measured });
    const shotDir = path.join(OUT, role, viewport.name);
    fs.mkdirSync(shotDir, { recursive: true });
    result.screenshot = path.join(shotDir, `${slugOf(filledPath)}.png`);
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(async () => { await page.screenshot({ path: result.screenshot }); });

    const inspected = inspect ? await inspect(page, result) : {};
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
    Object.assign(result.checks, inspected);
  } catch (error) {
    result.checks.crashed = String(error.message).split('\n')[0];
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

// Department Head top bar: below xl the period button must stay as an icon only square button (40px, 44px on touch
// widths) with its aria-label; from xl up it shows the label. Its dropdown must open and list the closed, current and
// upcoming semester with an Open records link; picking the upcoming one must show the planning banner and send the
// X-Academic-Semester header. Screenshots of the closed, open and planning states go next to the route screenshots.
async function auditPeriodSwitcher(session, width) {
  const viewport = `${width}x800`;
  const result = { role: 'DEPARTMENT_HEAD', route: 'top bar period button', path: '/dashboard/department-head', viewport, checks: {}, screenshot: null };
  const requestsAfterPick = [];
  let picked = false;
  let browser = null;
  try {
    browser = await chromium.launch({ args: ['--mute-audio'] });
    const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript(({ token, user, expires }) => {
      try {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('auth_expires_at', String(Date.now() + (Number(expires) || 14400) * 1000));
      } catch { /* storage unavailable */ }
    }, { token: session.token, user: session.user, expires: session.expires });
    const page = await context.newPage();
    page.on('request', (request) => {
      if (picked && request.url().startsWith(API)) requestsAfterPick.push(request.headers()['x-academic-semester'] || null);
    });
    await page.goto(`${WEB}/dashboard/department-head`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    const shotDir = path.join(OUT, 'DEPARTMENT_HEAD', 'top-bar');
    fs.mkdirSync(shotDir, { recursive: true });
    const button = page.locator('header button[aria-label^="Academic Period"]').first();
    const mounted = await button.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
    result.screenshot = path.join(shotDir, `period-closed-${width}.png`);
    await page.screenshot({ path: result.screenshot, clip: { x: 0, y: 0, width, height: 120 } });
    if (!mounted) {
      result.checks['period-button'] = 'the period button did not mount in the top bar';
    } else {
      const box = await button.boundingBox();
      const label = await button.getAttribute('aria-label');
      const text = ((await button.innerText()) || '').trim();
      if (width < 1280 && (!box || Math.round(box.width) !== Math.round(box.height) || box.width < 40)) result.checks['period-button-size'] = `expected a square of 40px or more, got ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box'}`;
      if (!label || !/Academic Period: AY .+ Semester/.test(label)) result.checks['period-button-label'] = `aria-label was ${JSON.stringify(label)}`;
      if (width < 1280 && text) result.checks['period-button-icon-only'] = `button shows text ${JSON.stringify(text)} below xl`;
      const switcherBox = await page.locator('header button[aria-label^="Workspace:"]').first().boundingBox().catch(() => null);
      if (!switcherBox) result.checks['switcher-missing'] = 'the Department Head shows no workspace switcher, so the shared top bar layout is not the one being captured';
      else if (box && box.x < switcherBox.x + switcherBox.width && switcherBox.x < box.x + box.width && box.y < switcherBox.y + switcherBox.height && switcherBox.y < box.y + box.height) result.checks['period-switcher-overlap'] = 'the period button overlaps the workspace switcher';
      if (width >= 1280 && !/AY .+ Semester/.test(text)) result.checks['period-button-text'] = `from xl up the button shows ${JSON.stringify(text)}, expected the school year and semester`;
      if (box && box.x + box.width > width + 1) result.checks['period-button-bounds'] = `button ends at ${Math.round(box.x + box.width)} of ${width}`;
      await button.click();
      const list = page.locator('[role="listbox"][aria-label="Academic Periods"]');
      const opened = await list.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      await page.waitForTimeout(250);
      result.openScreenshot = path.join(shotDir, `period-open-${width}.png`);
      await page.screenshot({ path: result.openScreenshot, clip: { x: 0, y: 0, width, height: 420 } });
      if (!opened) {
        result.checks['period-dropdown'] = 'the period dropdown did not open';
      } else {
        const listBox = await list.boundingBox();
        if (!listBox || listBox.x < -1 || listBox.x + listBox.width > width + 1) result.checks['period-dropdown-bounds'] = `dropdown at ${listBox ? `${Math.round(listBox.x)}..${Math.round(listBox.x + listBox.width)}` : 'no box'} of ${width}`;
        const listText = ((await list.innerText()) || '').replace(/\s+/g, ' ');
        for (const needed of ['Current semester', 'Upcoming, for planning', 'Closed, open in Records']) {
          if (!listText.includes(needed)) result.checks[`period-dropdown-${needed.split(',')[0].toLowerCase().replace(/\s+/g, '-')}`] = `the dropdown has no "${needed}" entry: ${listText.slice(0, 160)}`;
        }
        if (!(await page.locator('header').getByRole('button', { name: 'Open records' }).first().isVisible().catch(() => false))) result.checks['open-records'] = 'the dropdown has no Open records link';

        // Picking the upcoming semester shows the planning banner and sends the period header with the next requests.
        picked = true;
        await list.getByRole('button').filter({ hasText: 'Upcoming, for planning' }).first().click();
        const banner = page.locator('aside[aria-label="Planning"]');
        const bannerShown = await banner.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        result.planningScreenshot = path.join(shotDir, `period-planning-${width}.png`);
        await page.screenshot({ path: result.planningScreenshot, clip: { x: 0, y: 0, width, height: 260 } });
        if (!bannerShown) {
          result.checks['planning-banner'] = 'no Planning banner after picking the upcoming semester';
        } else {
          const bannerBox = await banner.boundingBox();
          const bannerText = ((await banner.innerText()) || '').replace(/\s+/g, ' ');
          if (!bannerBox || bannerBox.x < -1 || bannerBox.x + bannerBox.width > width + 1) result.checks['planning-banner-bounds'] = `banner at ${bannerBox ? `${Math.round(bannerBox.x)}..${Math.round(bannerBox.x + bannerBox.width)}` : 'no box'} of ${width}`;
          if (!/planning/i.test(bannerText)) result.checks['planning-banner-copy'] = bannerText.slice(0, 120);
        }
        if (!(await page.evaluate(() => localStorage.getItem('hiusa_selected_academic_period')))) result.checks['period-not-stored'] = 'hiusa_selected_academic_period is empty after the pick';
        if (!requestsAfterPick.some(Boolean)) result.checks['period-header'] = requestsAfterPick.length ? `${requestsAfterPick.length} API calls after the pick, none carried X-Academic-Semester` : 'no API call after the pick to read the header from';
      }
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) result.checks['overflow-x'] = 'document scrolls sideways';
  } catch (error) {
    result.checks.crashed = String(error.message).split('\n')[0];
  } finally {
    await browser?.close().catch(() => {});
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
    for (const role of periodOnly ? [] : roles) {
      const session = accounts[role];
      const values = await paramValues(role, session);
      // The review screen is one query-string state of the queue route, so client_routes.php has no row for it.
      const paths = [...(routesConfig[role] || []).filter((p) => !match || p.includes(match)).slice(0, limit), ...(REVIEW_PASS[role] && (!match || REVIEW_PATH.includes(match)) ? [REVIEW_PATH] : [])];
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
            const candidate = await auditRoute(context, viewport, role, route, filled, routesConfig[role] || [], inspectorFor(role, route));
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
    if (accounts.DEPARTMENT_HEAD && !match) {
      for (const width of SWITCHER_WIDTHS) {
        const result = await auditPeriodSwitcher(accounts.DEPARTMENT_HEAD, width);
        results.push(result);
        const failed = Object.keys(result.checks);
        log(`DEPARTMENT_HEAD ${result.viewport} top bar period button ${failed.length ? `FAIL ${failed.join(',')}` : 'ok'}`);
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
