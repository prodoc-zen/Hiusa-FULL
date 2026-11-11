import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, test } from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const script = resolve('scripts/reseed-staging.ps1');
const root = mkdtempSync(join(tmpdir(), 'reseed-staging-test-')).replaceAll('\\', '/');

function dump(name, extra = []) {
    const dir = join(root, name);
    const result = spawnSync(powershell, ['-NoProfile', '-File', script, '-DumpScripts', dir, ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return readFileSync(join(dir, 'step1.sh'), 'utf8');
}

// Runs the real step 1 text with the server paths pointed at a temp folder and the system commands stubbed.
function preflight(step1, { marker, appEnv }) {
    const server = mkdtempSync(join(root, 'server-')).replaceAll('\\', '/');
    mkdirSync(`${server}/etc-hiusa`);
    mkdirSync(`${server}/backups`);
    mkdirSync(`${server}/app`, { recursive: true });
    if (marker) writeFileSync(`${server}/etc-hiusa/ALLOW_RESEED`, '');
    writeFileSync(`${server}/artisan`, `#!/bin/bash\n[ "$1" = env ] && printf '%s' "${appEnv}"\n`, { mode: 0o755 });
    const stubs = `
sudo() { [ "$1" = "-n" ] && return 0; [ "$1" = "-u" ] && shift 2; "$@"; }
systemctl() { case "$*" in *LoadState*) echo loaded ;; *) echo active ;; esac; }
df() { echo stub; }
whoami() { echo tester; }
hostname() { echo testhost; }
`;
    const text = stubs + step1
        .replaceAll('/etc/hiusa', `${server}/etc-hiusa`)
        .replaceAll('/var/backups/hiusa', `${server}/backups`)
        .replaceAll('/usr/local/bin/hiusa-artisan', `${server}/artisan`)
        .replaceAll('/var/www/hiusa/server/storage/app', `${server}/app`);
    const file = `${server}/step1.sh`;
    writeFileSync(file, text);
    return spawnSync(bash, [file], { encoding: 'utf8', input: '' });
}

let step1;
before(() => {
    step1 = dump('plain');
});

test('the preflight refuses without the ALLOW_RESEED marker file on the server', () => {
    const result = preflight(step1, { marker: false, appEnv: 'Current application environment: staging' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /ALLOW_RESEED/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight refuses when the server app environment is production', () => {
    const result = preflight(step1, { marker: true, appEnv: 'Current application environment: production' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /production/);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight refuses when the app environment cannot be read', () => {
    const result = preflight(step1, { marker: true, appEnv: '' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /preflight ok/);
});

test('the preflight passes with the marker present and a non production environment', () => {
    const result = preflight(step1, { marker: true, appEnv: 'Current application environment: staging' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /preflight ok/);
});

test('-Force and -AllowOtherHost do not change the server-side preflight', () => {
    assert.equal(dump('forced', ['-Force', '-AllowOtherHost']), step1);
});
