import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = process.env.PAPER_ALIGNMENT_DOC || join(root, 'docs', 'PAPER-ALIGNMENT.md');
const doc = readFileSync(docPath, 'utf8');
const docLines = doc.split('\n');

const sourceRoots = ['server/app', 'server/routes', 'server/config', 'client/src'].map((dir) => join(root, dir));
const byName = new Map();
function index(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) index(full);
        else byName.set(entry.name, [...(byName.get(entry.name) || []), full]);
    }
}
sourceRoots.filter(existsSync).forEach(index);

const fileCache = new Map();
function linesOf(path) {
    if (!fileCache.has(path)) fileCache.set(path, readFileSync(path, 'utf8').split('\n'));
    return fileCache.get(path);
}

// A citation is `Name.ext:N`, optionally followed by "to `N`", ", `:N`" or "and `:N`" for the same file.
function citations() {
    const found = [];
    docLines.forEach((line, i) => {
        for (const match of line.matchAll(/([A-Za-z0-9_]+\.(?:php|jsx|js))\\?`?:(\d+)((?:`?(?:,| to| and)? ?`?:?\d+`?)*)/g)) {
            const lines = [Number(match[2]), ...[...match[3].matchAll(/\d+/g)].map((n) => Number(n[0]))];
            found.push({ doc: i + 1, name: match[1], lines });
        }
    });
    return found;
}

test('the sheet names the release commit it was read at, and that commit exists', () => {
    const header = docLines.find((line) => line.startsWith('- The system is'));
    assert.ok(header, 'the system line is missing');
    assert.doesNotMatch(header, /aa2d4b64|not merged yet|unmerged/);
    const sha = header.match(/commit `([0-9a-f]{8,40})`/)?.[1];
    assert.ok(sha, 'the system line must name the commit it was read at');
    const git = spawnSync('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`]);
    if (git.error || (git.status !== 0 && /not a git repository/i.test(String(git.stderr)))) return;
    assert.equal(git.status, 0, `commit ${sha} is not in this repository`);
});

test('every cited file resolves to one file and every cited line exists', () => {
    const cited = citations();
    assert.ok(cited.length > 60, `expected the sheet to cite many lines, found ${cited.length}`);
    for (const { doc: at, name, lines } of cited) {
        const paths = byName.get(name) || [];
        assert.equal(paths.length, 1, `doc line ${at}: ${name} resolves to ${paths.length} files`);
        const source = linesOf(paths[0]);
        for (const n of lines) {
            assert.ok(n >= 1 && n <= source.length, `doc line ${at}: ${name}:${n} is past the end of the file`);
            assert.notEqual(source[n - 1].trim(), '', `doc line ${at}: ${name}:${n} is a blank line`);
        }
    }
});

test('every api.php citation lands on a route line', () => {
    const source = linesOf(byName.get('api.php').find((path) => path.endsWith(join('routes', 'api.php'))));
    const wrong = [];
    for (const { doc: at, name, lines } of citations().filter((c) => c.name === 'api.php')) {
        for (const n of lines) {
            if (!/Route::/.test(source[n - 1] || '')) wrong.push(`doc line ${at}: api.php:${n} is "${(source[n - 1] || 'end of file').trim().slice(0, 50)}"`);
        }
    }
    assert.deepEqual(wrong, []);
});

const ANCHORS = [
    ['api.php', 300, /Route::get\('\/tasks'.*role:ADMIN,SBO_OFFICER'/],
    ['api.php', 286, /Route::get\('\/events\/\{id\}\/workflows'.*role:ADMIN,SBO_OFFICER'/],
    ['api.php', 285, /generate-plan'.*role:ADMIN'/],
    ['api.php', 398, /Route::post\('\/elections\/\{id\}\/vote'/],
    ['api.php', 402, /finalize'.*role:ADMIN'/],
    ['api.php', 404, /\/elections\/\{id\}\/positions'.*role:ADMIN,SBO_OFFICER'/],
    ['api.php', 291, /Route::post\('\/events\/\{id\}\/attendance'/],
    ['api.php', 343, /audit-logs\/export'/],
    ['api.php', 269, /Route::post\('\/event-requirements'.*role:SUPER_ADMIN'/],
    ['api.php', 462, /Route::post\('\/venues'.*role:SUPER_ADMIN'/],
    ['api.php', 385, /orders\/claim\/verify'/],
    ['api.php', 384, /Route::post\('\/orders\/claim'/],
    ['api.php', 379, /Route::post\('\/orders'/],
    ['api.php', 263, /attendance\/fingerprint\/confirm'/],
    ['api.php', 259, /Route::post\('\/users\/\{id\}\/fingerprint'/],
    ['api.php', 290, /attendance\/eligibility'/],
    ['api.php', 292, /Route::get\('\/events\/\{id\}\/personnel'/],
    ['EventController.php', 1266, /function workflowHistory/],
    ['EventController.php', 1296, /function attendanceEligibility/],
    ['EventController.php', 1432, /function recordAttendance/],
    ['EventController.php', 1452, /'approved', 'ongoing'/],
    ['EventController.php', 1513, /'resources'/],
    ['EventPersonnelController.php', 75, /function store/],
    ['EventPersonnelController.php', 125, /function destroy/],
    ['EventEligibility.php', 23, /function forMembers/],
    ['EventEligibility.php', 56, /function forMember\(/],
    ['EventTeamPanel.jsx', 163, /export default function EventTeamPanel/],
    ['EventPlanReadOnly.jsx', 15, /export default function EventPlanReadOnly/],
    ['EligibilityBadges.jsx', 16, /export default function EligibilityBadges/],
    ['EventsPage.jsx', 2087, /<EventPlanReadOnly/],
    ['EventsPage.jsx', 2089, /<EventTeamPanel/],
    ['ChangesSinceReturn.jsx', 11, /Changed since you approved it/],
    ['ChangesSinceReturn.php', 31, /private const SOURCES/],
    ['ChangesSinceReturn.php', 108, /function describeApprovals/],
    ['AccountProfileController.php', 198, /SUPER_ADMIN/],
    ['OrderController.php', 916, /Notification::create/],
    ['OrderController.php', 517, /claim_token/],
];

test('the sheet cites each anchor and the line says what the sheet says it does', () => {
    const cited = citations();
    for (const [name, line, pattern] of ANCHORS) {
        const named = cited.some((c) => c.name === name && c.lines.includes(line)) || (!cited.some((c) => c.name === name) && doc.includes(name));
        assert.ok(named, `the sheet no longer cites ${name}:${line}`);
        const path = (byName.get(name) || []).find((candidate) => name !== 'api.php' || candidate.endsWith(join('routes', 'api.php')));
        assert.ok(path, `${name} is missing`);
        assert.match(linesOf(path)[line - 1] || '', pattern, `${name}:${line}`);
    }
});

test('F05c says officers read the plan history and ends in the r27 behaviour', () => {
    const row = docLines.find((line) => line.startsWith('| F05c |'));
    assert.ok(row, 'the F05c row is missing');
    assert.match(row, /`api\.php:286`\)/);
    assert.match(row, /role:ADMIN,SBO_OFFICER/);
    assert.match(row, /EventPlanReadOnly\.jsx/);
    assert.doesNotMatch(row, /Reading the plan history is `role:ADMIN` too/);
    assert.doesNotMatch(row, /closed in r27, see section 10|true after the r27 merge/);
});

test('section 10 gives the shipped location of every r27 item', () => {
    const start = docLines.findIndex((line) => line.startsWith('## 10.'));
    const end = docLines.findIndex((line, i) => i > start && line.startsWith('## 11.'));
    const section = docLines.slice(start, end).join('\n');
    assert.doesNotMatch(section, /not merged|re-read|After the merge, check/i);
    const rowOf = (id) => docLines.slice(start, end).find((line) => line.startsWith(`| ${id} |`)) || '';
    const expected = {
        F07: ['EventPersonnelController.php', 'EventTeamPanel.jsx'],
        F12: ['EventController::workflowHistory', 'EventPlanReadOnly.jsx'],
        F10: ['ActivityCalendar.jsx'],
        F19: ['AnnouncementsFeedPage.jsx'],
        F09: ['EventEligibility.php', 'EligibilityBadges.jsx'],
        REAPP: ['ChangesSinceReturn.php'],
    };
    for (const [id, names] of Object.entries(expected)) {
        for (const name of names) assert.ok(rowOf(id).includes(name), `section 10 row ${id} does not name ${name}`);
    }
});
