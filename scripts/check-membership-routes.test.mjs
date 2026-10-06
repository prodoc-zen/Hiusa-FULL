import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const script = resolve('scripts/check-membership-routes.sh').replaceAll('\\', '/');
const mockCurl = `
curl() {
    local url="\${!#}"
    printf '%s\\n' "$url" >> "$MOCK_CALL_LOG"
    [[ " $* " == *" Accept: application/json "* ]] || return 98
    [[ "$MOCK_NETWORK_FAILURE" != 1 ]] || return 6
    case "$url" in
        */organizations) printf '%s' "$MOCK_ORGANIZATIONS_STATUS" ;;
        */candidates) printf '%s' "$MOCK_CANDIDATES_STATUS" ;;
        *) return 99 ;;
    esac
}
export -f curl
bash "$1" "$2"
`;

function check(overrides = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'hiusa-membership-check-'));
    const log = join(directory, 'calls');
    try {
        const result = spawnSync(bash, ['-c', mockCurl, 'membership-test', script, 'https://example.test/'], {
            encoding: 'utf8',
            env: { ...process.env, MOCK_CALL_LOG: log.replaceAll('\\', '/'), MOCK_ORGANIZATIONS_STATUS: '401', MOCK_CANDIDATES_STATUS: '401', MOCK_NETWORK_FAILURE: '0', ...overrides },
        });
        if (result.error) throw result.error;
        return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
    } finally {
        if (existsSync(log)) unlinkSync(log);
        rmdirSync(directory);
    }
}

test('checks both protected endpoints with JSON requests and accepts 401', () => {
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, ['https://example.test/api/account-profiles/organizations', 'https://example.test/api/account-profiles/candidates']);
});

test('rejects a missing organization route', () => {
    const result = check({ MOCK_ORGANIZATIONS_STATUS: '404' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /organizations returned HTTP 404/);
});

test('rejects a missing candidate route even when organizations work', () => {
    const result = check({ MOCK_CANDIDATES_STATUS: '404' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /candidates returned HTTP 404/);
});

test('rejects an HTML fallback returning 200', () => {
    const result = check({ MOCK_ORGANIZATIONS_STATUS: '200' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTTP 200; expected 401/);
});

test('fails when the backend cannot be reached', () => {
    const result = check({ MOCK_NETWORK_FAILURE: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not reach/);
});
