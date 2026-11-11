import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const script = resolve('scripts/deploy-lightsail.sh').replaceAll('\\', '/');
const workflow = readFileSync(resolve('.github/workflows/deploy.yml'), 'utf8');

function run(args, env = {}) {
    return spawnSync(bash, [script, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        input: '',
    });
}

function guard(mail, edp) {
    return run([], { HIUSA_DEPLOY_GUARD_ONLY: '1', GUARD_MAIL: mail, GUARD_EDP: edp });
}

test('the guard passes only when mail is log and EDP is local', () => {
    assert.equal(guard('log', 'local').status, 0);
});

test('the guard refuses a mailer that could send email', () => {
    for (const mail of ['smtp', 'ses', 'mailgun', 'resend', 'sendmail', 'null', '']) {
        const result = guard(mail, 'local');
        assert.notEqual(result.status, 0, `mail.default=${mail} must be refused`);
        assert.match(result.stderr, /must be 'log'/);
    }
});

test('the guard refuses an EDP driver that makes outside calls', () => {
    for (const edp of ['http', 'remote', '']) {
        const result = guard('log', edp);
        assert.notEqual(result.status, 0, `services.edp.driver=${edp} must be refused`);
        assert.match(result.stderr, /must be 'local'/);
    }
});

function checkWithConfig(config) {
    const root = mkdtempSync(join(tmpdir(), 'hiusa-deploy-test-')).replaceAll('\\', '/');
    mkdirSync(`${root}/server`);
    const fake = `${root}/artisan.sh`;
    writeFileSync(
        fake,
        [
            '#!/usr/bin/env bash',
            'case "$2" in',
            `  mail.default) ${config.mail} ;;`,
            `  services.edp.driver) ${config.edp} ;;`,
            'esac',
            '',
        ].join('\n'),
        { mode: 0o755 },
    );
    return run([], {
        HIUSA_DEPLOY_CHECK_ONLY: '1',
        HIUSA_APP_DIR: root,
        HIUSA_ARTISAN: fake,
    });
}

const show = (value) => `printf '\\n  ${value}\\n'`;
const missingKey = "echo 'Configuration file or key services.edp.driver does not exist.'; exit 1";

test('code from before the EDP setting existed (no services.edp key) passes the check when mail is log', () => {
    const result = checkWithConfig({ mail: show('log'), edp: missingKey });
    assert.equal(result.status, 0, result.stderr);
});

test('a missing services.edp key does not excuse a mailer that could send email', () => {
    const result = checkWithConfig({ mail: show('smtp'), edp: missingKey });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be 'log'/);
});

test('the check reads the values the server reports and refuses an EDP driver that is not local', () => {
    assert.equal(checkWithConfig({ mail: show('log'), edp: show('local') }).status, 0);
    const result = checkWithConfig({ mail: show('log'), edp: show('http') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be 'local'/);
});

test('the deploy script rejects anything but a full commit sha before touching the server', () => {
    for (const arg of [[], ['main'], ['abc123'], ['$(id)'], ['0'.repeat(39)], ['G'.repeat(40)]]) {
        const result = run(arg, { HIUSA_APP_DIR: '/nonexistent-hiusa-test' });
        assert.equal(result.status, 2, `args ${JSON.stringify(arg)} must be a usage error`);
        assert.match(result.stderr, /Usage/);
    }
});

test('the workflow deploys only main, only after Tests passed, and through the guarded script', () => {
    assert.match(workflow, /workflows: \[Tests\]/);
    assert.match(workflow, /branches: \[main\]/);
    assert.match(workflow, /workflow_run\.conclusion == 'success'/);
    assert.match(workflow, /merge-base --is-ancestor "\$TARGET_SHA" origin\/main/);
    assert.match(workflow, /StrictHostKeyChecking=yes/);
    assert.match(workflow, /scripts\/deploy-lightsail\.sh/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch'[\s\S]*?actions\/workflows\/tests\.yml\/runs\?head_sha=\$TARGET_SHA&status=success/);
});

test('the workflow adds no outbound channel besides ssh to the server and a health check of the site', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
    assert.deepEqual(uses, ['actions/checkout@v4']);
    assert.doesNotMatch(workflow, /slack|webhook|sendgrid|smtp|mailgun|twilio|notify/i);
});

const deployScript = readFileSync(resolve('scripts/deploy-lightsail.sh'), 'utf8');

test('the deploy previews and then holds stock for open orders right after the migrations', () => {
    const migrate = deployScript.indexOf('migrate --force');
    const dryRun = deployScript.indexOf('orders:hold-stock --dry-run');
    const hold = deployScript.search(/orders:hold-stock\)/);
    const caches = deployScript.indexOf('== 6. Caches and restart');
    assert.ok(migrate > 0, 'migrate step is missing');
    assert.ok(dryRun > migrate, 'the dry run must come after migrate');
    assert.ok(hold > dryRun, 'the real hold must come after the dry run');
    assert.ok(caches > hold, 'the hold must finish before the caches step');
});

test('the queue and scheduler units set StartLimitIntervalSec in [Unit], where systemd reads it', () => {
    for (const name of ['hiusa-queue', 'hiusa-scheduler']) {
        const unit = readFileSync(resolve(`scripts/server/systemd/${name}.service`), 'utf8');
        const [beforeService] = unit.split('[Service]');
        assert.match(beforeService, /^StartLimitIntervalSec=0$/m, `${name}: StartLimitIntervalSec=0 must be under [Unit]`);
        assert.doesNotMatch(unit.slice(unit.indexOf('[Service]')), /StartLimitIntervalSec/);
    }
});

test('the ops check runs every 5 minutes through the wrapper and fails the unit on a non-zero exit', () => {
    const service = readFileSync(resolve('scripts/server/systemd/hiusa-ops-check.service'), 'utf8');
    const timer = readFileSync(resolve('scripts/server/systemd/hiusa-ops-check.timer'), 'utf8');
    assert.match(service, /^Type=oneshot$/m);
    assert.match(service, /^ExecStart=\/usr\/local\/bin\/hiusa-artisan hiusa:ops-check$/m);
    assert.match(service, /^User=www-data$/m);
    assert.match(timer, /^OnUnitActiveSec=5min$/m);
    assert.match(timer, /^Unit=hiusa-ops-check\.service$/m);
    assert.match(timer, /^WantedBy=timers\.target$/m);
});
