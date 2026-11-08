import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
});

test('the workflow adds no outbound channel besides ssh to the server and a health check of the site', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
    assert.deepEqual(uses, ['actions/checkout@v4']);
    assert.doesNotMatch(workflow, /slack|webhook|sendgrid|smtp|mailgun|twilio|notify/i);
});
