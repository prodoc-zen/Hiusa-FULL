import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const path = resolve('scripts/demo-smoke.ps1');
const text = readFileSync(path, 'utf8');
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

function step(id) {
    const start = text.indexOf(`Start-Step '${id}'`);
    assert.notEqual(start, -1, `step ${id} is missing`);
    const next = text.indexOf('Start-Step', start + 10);
    const result = text.indexOf('# ---- Result', start);
    return text.slice(start, next === -1 ? result : next);
}

test('the script parses', () => {
    const command = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.replaceAll('\\', '/')}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`;
    const result = spawnSync(powershell, ['-NoProfile', '-Command', command], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('-ReseedDemo is a documented switch and step 8 runs only with it', () => {
    assert.match(text, /\[switch\]\$ReseedDemo/);
    assert.match(text, /\.PARAMETER ReseedDemo/);
    const eight = step('8');
    assert.match(eight, /if \(-not \$ReseedDemo\)/);
    assert.match(eight, /Add-Row '[^']+' 'INFO' '[^']*from-scratch demo/);
});

test('the 15 MB probe no longer posts to the retired organizations endpoint', () => {
    const five = step('5');
    assert.doesNotMatch(five, /-Path '\/api\/college\/organizations'/);
    assert.match(five, /-SizeBytes 15MB[^\n]*-Path '\/api\/compliance\/submissions'/);
});

test('the 11 MB probe passes on the Laravel size rule and fails only on a PHP-level refusal', () => {
    const five = step('5');
    assert.match(five, /smaller\|kilobytes\|greater than/);
    assert.match(five, /failed to upload/);
    assert.doesNotMatch(five, /elseif \(\$fileErrors\) \{\s*Add-Row 'Upload limit 11 MB \(PHP per file\)' 'FAIL'/);
});
