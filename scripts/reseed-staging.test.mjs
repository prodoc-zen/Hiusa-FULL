import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, test } from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const script = resolve('scripts/reseed-staging.ps1');
const root = mkdtempSync(join(tmpdir(), 'reseed-staging-test-')).replaceAll('\\', '/');
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function dump(name, extra = []) {
    const dir = join(root, name);
    const result = spawnSync(powershell, ['-NoProfile', '-File', script, '-DumpScripts', dir, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return readFileSync(join(dir, 'step1.sh'), 'utf8');
}

// A fake server folder. The stub prints Laravel 12's real "artisan env" line, and answers the election count
// only when tinker runs with HOME and XDG_CONFIG_HOME set to /tmp (as the real one needs), so a command
// without them gives empty output, which the script must treat as a refusal.
function server({ marker, appEnv, elections = '0' }) {
    const dir = mkdtempSync(join(root, 'server-')).replaceAll('\\', '/');
    mkdirSync(`${dir}/etc-hiusa`);
    mkdirSync(`${dir}/backups`);
    mkdirSync(`${dir}/app`, { recursive: true });
    if (marker !== undefined && marker !== false) writeFileSync(`${dir}/etc-hiusa/ALLOW_RESEED`, marker === true ? '' : marker);
    const envLine = appEnv ? `printf 'The application environment is [%s].\\n' "${appEnv}"` : ':';
    const count = elections === '' ? ':' : `printf 'OPEN_ELECTIONS=%s\\n' "${elections}"`;
    writeFileSync(`${dir}/artisan`, `#!/bin/bash
case "$1" in
  env) ${envLine} ;;
  tinker) [ "$HOME" = /tmp ] && [ "$XDG_CONFIG_HOME" = /tmp ] && ${count} ;;
esac
exit 0
`, { mode: 0o755 });
    return dir;
}

// Runs a real remote script text with the server paths pointed at the fake folder and the system commands stubbed.
function run(dir, text, name) {
    const stubs = `
sudo() { [ "$1" = "-n" ] && return 0; [ "$1" = "-u" ] && shift 2; "$@"; }
systemctl() { case "$*" in *LoadState*) echo loaded ;; *) echo active ;; esac; }
df() { echo stub; }
whoami() { echo tester; }
hostname() { echo testhost; }
`;
    const body = stubs + text
        .replaceAll('/etc/hiusa', `${dir}/etc-hiusa`)
        .replaceAll('/var/backups/hiusa', `${dir}/backups`)
        .replaceAll('/usr/local/bin/hiusa-artisan', `${dir}/artisan`)
        .replaceAll('/var/www/hiusa/server/storage/app', `${dir}/app`);
    const file = `${dir}/${name}`;
    writeFileSync(file, body);
    return spawnSync(bash, [file], { encoding: 'utf8', input: '' });
}

const preflight = (step1, options) => run(server(options), step1, 'step1.sh');

let step1;
before(() => {
    step1 = dump('plain');
});

test('the preflight refuses without the ALLOW_RESEED marker file on the server', () => {
    const result = preflight(step1, { marker: false, appEnv: 'staging' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /ALLOW_RESEED/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight reads the environment from the real artisan env line', () => {
    const result = preflight(step1, { marker: true, appEnv: 'staging' });
    assert.match(result.stdout, /app environment: staging/);
});

test('the preflight refuses a bare marker when the server app environment is production', () => {
    const result = preflight(step1, { marker: true, appEnv: 'production' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /reseed-production/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight refuses wrong marker content on production', () => {
    const result = preflight(step1, { marker: `reseed ${today}`, appEnv: 'production' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight refuses a stale dated marker on production', () => {
    const result = preflight(step1, { marker: `reseed-production ${yesterday}\n`, appEnv: 'production' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /reseed-production/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight passes on production with the correct dated marker and no open election', () => {
    const result = preflight(step1, { marker: `reseed-production ${today}\n`, appEnv: 'production' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /preflight ok/);
});

test('the preflight refuses when the app environment cannot be read', () => {
    const result = preflight(step1, { marker: true, appEnv: '' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight passes with the marker present and a non production environment', () => {
    const result = preflight(step1, { marker: true, appEnv: 'staging' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /preflight ok/);
});

test('the preflight refuses while an election is active, or approved, finalized and upcoming', () => {
    const result = preflight(step1, { marker: `reseed-production ${today}`, appEnv: 'production', elections: '2' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /election\(s\) are active, or approved, finalized and upcoming/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight refuses when the election count comes back empty', () => {
    const result = preflight(step1, { marker: true, appEnv: 'staging', elections: '' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the cleanup step removes the marker after a failed preflight and after a passed one', () => {
    const cleanup = readFileSync(join(root, 'plain', 'cleanup.sh'), 'utf8');
    for (const options of [{ marker: true, appEnv: 'staging', elections: '1' }, { marker: true, appEnv: 'staging' }]) {
        const dir = server(options);
        run(dir, step1, 'step1.sh');
        assert.ok(existsSync(`${dir}/etc-hiusa/ALLOW_RESEED`));
        const result = run(dir, cleanup, 'cleanup.sh');
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(!existsSync(`${dir}/etc-hiusa/ALLOW_RESEED`));
    }
});

test('the live run removes the marker last, in the finally block, whatever the outcome', () => {
    const text = readFileSync(script, 'utf8');
    assert.match(text, /Write-RunEnd\r?\n\s*Remove-ReseedMarker\r?\n\s*\}/);
});

test('-Force and -AllowOtherHost do not change the server-side preflight', () => {
    assert.equal(dump('forced', ['-Force', '-AllowOtherHost']), step1);
});

test('migrate:fresh keeps the APP_ENV=staging override the seeders need', () => {
    assert.match(readFileSync(join(root, 'plain', 'step4.sh'), 'utf8'), /env APP_ENV=staging APP_DEBUG=false .*migrate:fresh --seed --force/);
});
